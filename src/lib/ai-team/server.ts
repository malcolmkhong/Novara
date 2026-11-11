/**
 * Server-side orchestration for the AI Team workspace.
 *
 * Responsibilities:
 *  - seed the default team (leader + 4 specialists)
 *  - AI plumbing for agent replies (system role verified working)
 *  - parse/strip the ```team-delegate protocol from replies
 *  - task lifecycle: claim → progress logs → AI execution → reports
 *
 * Every AI call is bounded by withTimeout (see ai-heuristics) so a single
 * exchange always finishes well inside the gateway budget. Task execution
 * runs in the background via next/server `after()` — routes respond fast and
 * the UI polls task state.
 */
import ZAI from "@/lib/ai/router";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { capOutputTokens, extractJson, withTimeout } from "@/lib/ai-heuristics";
import { classifyAiFailure, extractRealUsage } from "@/lib/usage/usage-shapes";
import { recordProvenanceLink, recordUsageCall, GATEWAY_DEFAULT_MODEL_ID } from "@/lib/usage/usage-store";
import {
  chargeOrThrow,
  CreditError,
  requireChargeUid,
  settleCharge,
  settleMeasured,
} from "@/lib/credits/charge";
import {
  buildDelegationRepairMessages,
  buildLeaderSystemPrompt,
  buildMemberChatPrompt,
  buildTaskExecutionMessages,
} from "@/lib/ai-team/prompts";
import {
  buildCompactLibraryTruth,
  buildNovelToolPrompt,
  buildUnwrittenWorkSummary,
  collectWriteEvidence,
  executeNovelToolCalls,
  executeNovelWrites,
  formatToolResults,
  hasUnwrittenChapters,
  parseNovelToolCalls,
  parseNovelWriteBlocks,
} from "@/lib/ai-team/novel-tools";
import type {
  AgentDto,
  MessageDto,
  MessageRole,
  TaskDto,
  TaskStatus,
} from "@/lib/ai-team/types";

// ---------------------------------------------------------------------------
// AI plumbing
// ---------------------------------------------------------------------------

const AI_TIMEOUT_MS = 55_000;
/**
 * Step 58 — the charge surface of every AI-Team call. HARD: a team turn
 * must be affordable up front (reserve = team-turn).
 */
const CHARGE_SURFACE = "team-turn";

/** Settling must never break the call it settles. */
async function settleSafely(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error("[ai-team] settle failed:", error);
  }
}

/** Budget for the post-tool follow-up call of an agent turn. */
const TOOL_FOLLOWUP_TIMEOUT_MS = 35_000;
/** Per-message cap when replaying conversation history to AI. */
const HISTORY_MESSAGE_CAP = 1200;
/** How much of the conversation history (messages) is replayed. */
const HISTORY_WINDOW = 12;
/** Max chars of recent user/agent chat injected into a task execution. */
const TASK_CONTEXT_CAP = 1800;

type AiRole = "system" | "user" | "assistant";
interface AiMessage {
  role: AiRole;
  content: string;
}

/**
 * P5-g scope threading: attribution + model selection carried on every AI
 * call. novelId = workspace-pinned direct attribution (the conversation's
 * pinned scope); correlationId = pre-novel session namespace
 * ("ai-team:<sessionKey>", wizard precedent — provenance links retro-adopt
 * these rows into the created novel's ledger); model = explicit request-side
 * model id (undefined = gateway default, recorded as "gateway-default").
 */
export interface AiScope {
  novelId?: string;
  correlationId?: string;
  model?: string;
}

/** Pull the plain-text reply out of an untyped SDK completion payload. */
function extractCompletionContent(completion: unknown): string | null {
  if (typeof completion !== "object" || completion === null) return null;
  const choices = (completion as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/**
 * Backoff schedule for rate-limited (HTTP 429) AI calls. The multi-agent
 * flow fires several AI requests in a burst (chat turn → task rounds →
 * report → leader follow-up), so the gateway throttles us; a 429 is
 * transient and a short backoff almost always recovers the turn.
 */
const AI_429_BACKOFF_MS = [1_200, 2_800] as const;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429") || message.toLowerCase().includes("too many requests");
}

/**
 * One AI request (with 429-aware retry). Returns reply text or null on ANY
 * failure. Never throws.
 */
export async function teamText(
  messages: AiMessage[],
  label: string,
  timeoutMs: number = AI_TIMEOUT_MS,
  scope?: AiScope,
): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    // Step 58 — a team turn is a HARD surface: the whole turn must be
    // affordable before it starts. The refusal is thrown (not swallowed) so
    // the route can answer 402 / 429.
    const uid = await requireChargeUid(CHARGE_SURFACE);
    const charge = await chargeOrThrow(uid, CHARGE_SURFACE, {
      refId: label,
      note: label,
    });
    let settled = false;
    // Policy F (P5-b): one row per HTTP attempt. ZAI.create() failing below
    // is a PRE-SEND failure — no row (F3). A sent attempt with no completion
    // payload records one zero-token failed row (F1); a completion without
    // usage records nothing (F4).
    let sent = false;
    try {
      const zai = await ZAI.create();
      sent = true;
      const completion: unknown = await withTimeout(
        zai.chat.completions.create({
          // P5-g: explicit model only when the caller supplies one; the
          // request-side id is recorded on the ledger row exactly as sent.
          ...(scope?.model ? { model: scope.model } : {}),
          messages: messages.map((message) => ({
            ...message,
            // System prompts now carry persona + team/novel-tool protocol +
            // library snapshot, so they get the same budget as user turns.
            content: capOutputTokens(message.content, message.role === "system" ? 6500 : 6000),
          })),
          thinking: { type: "disabled" },
        }),
        timeoutMs,
        `[team/${label}]`,
      );
      // Persist the per-call row. Surface revived per P5-g (schema restored;
      // scope threading per plan §5): novelId = direct attribution,
      // correlationId = pre-novel session namespace, modelId = as sent.
      const usage = extractRealUsage(completion);
      recordUsageCall({
        surface: "ai-team",
        usage,
        novelId: scope?.novelId,
        correlationId: scope?.correlationId,
        modelId: scope?.model,
      });
      // D16 — the cost comes from the tokens the provider really returned;
      // a completion with no usage has no measurable cost → the hold comes
      // back in full.
      await settleSafely(() =>
        settleMeasured(
          uid,
          charge.hold,
          usage,
          scope?.model ?? GATEWAY_DEFAULT_MODEL_ID,
          { refId: label },
        ),
      );
      settled = true;
      return extractCompletionContent(completion);
    } catch (error) {
      if (error instanceof CreditError) throw error;
      if (sent) {
        recordUsageCall({
          surface: "ai-team",
          usage: null,
          status: "failed",
          errorKind: classifyAiFailure(error),
          novelId: scope?.novelId,
          correlationId: scope?.correlationId,
          modelId: scope?.model,
        });
      }
      // A failed attempt is not charged: the hold comes back in full.
      if (!settled) {
        await settleSafely(() =>
          settleCharge(uid, charge.hold, 0, {
            refId: label,
            note: "attempt failed — hold refunded",
          }),
        );
      }
      console.error(`[team/${label}] AI request failed:`, error);
      // Retry ONLY transient rate limits; timeouts and other errors fail
      // immediately so request budgets stay bounded.
      if (attempt < AI_429_BACKOFF_MS.length && isRateLimitError(error)) {
        await sleep(AI_429_BACKOFF_MS[attempt]);
        continue;
      }
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Default team seed
// ---------------------------------------------------------------------------

interface SeedAgent {
  key: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  isLeader: boolean;
  emoji: string;
  color: string;
  sortOrder: number;
}

const SEED_AGENTS: readonly SeedAgent[] = [
  {
    key: "leader",
    name: "Atlas",
    role: "Team Leader",
    description:
      "Understands your goals, breaks them into focused tasks, delegates to the right specialist and reports results back to you.",
    capabilities: ["Task decomposition", "Delegation & coordination", "Progress tracking", "Result synthesis"],
    isLeader: true,
    emoji: "🧭",
    color: "#059669",
    sortOrder: 0,
  },
  {
    key: "researcher",
    name: "Nova",
    role: "Research Analyst",
    description: "Gathers and cross-checks information, compares options and writes tight research briefs.",
    capabilities: ["Web research", "Fact-finding", "Comparison summaries", "Source synthesis"],
    isLeader: false,
    emoji: "🔍",
    color: "#7c3aed",
    sortOrder: 1,
  },
  {
    key: "writer",
    name: "Sage",
    role: "Writer",
    description: "Drafts and polishes content in Chinese or English — articles, copy, stories, scripts.",
    capabilities: ["Article & copy writing", "Story drafting", "Rewriting & polishing", "Bilingual content"],
    isLeader: false,
    emoji: "✍️",
    color: "#d97706",
    sortOrder: 2,
  },
  {
    key: "engineer",
    name: "Forge",
    role: "Engineer",
    description: "Writes and reviews code, debugs issues and proposes pragmatic technical designs.",
    capabilities: ["Code writing & review", "Debugging", "Technical design", "Scripts & snippets"],
    isLeader: false,
    emoji: "⚙️",
    color: "#e11d48",
    sortOrder: 3,
  },
  {
    key: "analyst",
    name: "Prism",
    role: "Data Analyst",
    description: "Analyzes data and metrics, weighs trade-offs and supports decisions with clear reasoning.",
    capabilities: ["Data analysis", "Metrics & KPIs", "Trade-off reasoning", "Decision support"],
    isLeader: false,
    emoji: "📊",
    color: "#0d9488",
    sortOrder: 4,
  },
] as const;

/** Create the default team on first use. Safe to call on every request. */
export async function ensureSeed(): Promise<void> {
  const count = await db.teamAgent.count();
  if (count > 0) return;
  try {
    for (const seed of SEED_AGENTS) {
      // Upsert keeps concurrent first requests (panel + popouts polling)
      // from tripping the unique key constraint.
      await db.teamAgent.upsert({
        where: { key: seed.key },
        update: {},
        create: { ...seed, capabilities: JSON.stringify(seed.capabilities) },
      });
    }
  } catch (error) {
    console.warn("[team] seed race ignored:", error);
  }
}

export async function getLeader(): Promise<AgentRow | null> {
  return db.teamAgent.findFirst({ where: { isLeader: true } });
}

// ---------------------------------------------------------------------------
// Serializers (DB rows → DTOs)
// ---------------------------------------------------------------------------

type AgentRow = Prisma.TeamAgentGetPayload<object>;
export type TaskRow = Prisma.TeamTaskGetPayload<{
  include: { assignee: true; creator: true; logs: true };
}>;

export function toAgentDto(row: AgentRow): AgentDto {
  let capabilities: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.capabilities);
    if (Array.isArray(parsed)) {
      capabilities = parsed.filter((c): c is string => typeof c === "string");
    }
  } catch {
    capabilities = [];
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    role: row.role,
    description: row.description,
    capabilities,
    isLeader: row.isLeader,
    emoji: row.emoji,
    color: row.color,
    sortOrder: row.sortOrder,
  };
}

export function toMessageDto(row: {
  id: string;
  role: string;
  content: string;
  taskIds: string | null;
  createdAt: Date;
}): MessageDto {
  let taskIds: string[] = [];
  if (row.taskIds) {
    try {
      const parsed: unknown = JSON.parse(row.taskIds);
      if (Array.isArray(parsed)) {
        taskIds = parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      taskIds = [];
    }
  }
  return {
    id: row.id,
    role: row.role as MessageRole,
    content: row.content,
    taskIds,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toTaskDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    progress: row.progress,
    result: row.result,
    error: row.error,
    assignee: toAgentDto(row.assignee),
    creator: toAgentDto(row.creator),
    creatorIsUser: row.creatorIsUser,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    logs: [...row.logs]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((log) => ({
        id: log.id,
        message: log.message,
        progress: log.progress,
        createdAt: log.createdAt.toISOString(),
      })),
  };
}

// ---------------------------------------------------------------------------
// Conversation helpers
// ---------------------------------------------------------------------------

export async function getOrCreateConversation(
  agentId: string,
  sessionKey: string,
  novelId?: string,
) {
  const existing = await db.teamConversation.findUnique({
    where: { agentId_sessionKey: { agentId, sessionKey } },
  });
  if (existing) return existing;
  // P5-g: a conversation opened inside a novel workspace pins that novelId
  // AT CREATION (plan §5.1) — later calls with a different novelId do not
  // re-pin; the first scope wins so attribution stays coherent.
  return db.teamConversation.create({
    data: { agentId, sessionKey, ...(novelId ? { novelId } : {}) },
  });
}

// ---------------------------------------------------------------------------
// Agent turn with novel-tool loop
// ---------------------------------------------------------------------------

export type AgentTurnOutcome = "answered" | "tool_exhausted" | "model_error";

export interface AgentTurnResult {
  /** Final visible reply (novel-tool blocks stripped), or null on AI failure. */
  text: string | null;
  /** Formatted tool activity (also the data payload), null when no tools used. */
  toolLog: string | null;
  /** Receipts of SUCCESSFUL novel-library writes performed during the turn. */
  writes: string[];
  /** How the turn ended — drives downstream self-healing. */
  outcome: AgentTurnOutcome;
  /** AI calls consumed by this turn (1..MAX_TOOL_ROUNDS). */
  rounds: number;
  /** Per-action results across all rounds (telemetry). */
  toolCalls: { round: number; action: string; ok: boolean; error: string | null }[];
  /** Formatted results of the FINAL tool round (feeds continuation). */
  lastResults: string | null;
  /** Conversation state after the final tool round — the continuation
   *  entry point: appending one user message resumes exactly here. */
  finalMessages: AiMessage[];
  durationMs: number;
  /** TeamTurnLog row id (callers attach corrections to it). */
  turnLogId: string | null;
  /** P5-g: ids of novels CREATED this turn via create_novel (successful
   *  writes only) — the chat/task routes fire the provenance link on these. */
  createdNovelIds: string[];
}

const MAX_TOOL_ROUNDS = 3; // 1 initial call + up to 2 tool-execution rounds

/** Plain length cap for telemetry strings (no AI budget formatting). */
function capText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Persist one telemetry row for an agent turn. Never throws. */
async function logTurn(entry: {
  agentKey: string;
  label: string;
  outcome: AgentTurnOutcome;
  rounds: number;
  toolCalls: { round: number; action: string; ok: boolean; error: string | null }[];
  durationMs: number;
}): Promise<string | null> {
  try {
    const row = await db.teamTurnLog.create({
      data: {
        agentKey: entry.agentKey,
        label: entry.label,
        outcome: entry.outcome,
        rounds: entry.rounds,
        toolCalls: entry.toolCalls.length > 0 ? JSON.stringify(entry.toolCalls.slice(0, 12)) : null,
        durationMs: Math.min(entry.durationMs, 2_000_000_000),
      },
    });
    return row.id;
  } catch (error) {
    console.error("[team] turn log failed:", error);
    return null;
  }
}

/** Attach post-turn corrections (repair/verify/continuation) to the log row. */
export async function noteTurnCorrections(
  turnLogId: string | null,
  corrections: string[],
): Promise<void> {
  if (!turnLogId || corrections.length === 0) return;
  try {
    await db.teamTurnLog.update({
      where: { id: turnLogId },
      data: { correctionsFired: JSON.stringify(corrections.slice(0, 8)) },
    });
  } catch (error) {
    console.error("[team] turn correction note failed:", error);
  }
}

/**
 * One full agent turn with a bounded tool loop (JSON ```novel-tool actions
 * + plain-text ```novel-write chapter blocks):
 *   call → blocks? → execute → call with results → … (max 3 calls)
 * Multi-round lets chained writes work (read ids → write chapters). Every
 * request's AI usage stays bounded; each round gets its own timeout so a
 * single exchange never hangs.
 */
export async function teamAgentTurn(
  messages: AiMessage[],
  label: string,
  timeoutMs: number = AI_TIMEOUT_MS,
  scope?: AiScope,
): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  let toolLog: string | null = null;
  let current: AiMessage[] = messages;
  let lastRaw = "";
  let modelDied = false;
  let lastRoundHadTools = false;
  let lastResults: string | null = null;
  let roundsUsed = 0;
  const writes: string[] = [];
  const toolCalls: AgentTurnResult["toolCalls"] = [];
  const createdNovelIds: string[] = [];

  const cleanAll = (raw: string): string => {
    // Strip JSON tool blocks first, then plain-text write blocks.
    return parseNovelWriteBlocks(parseNovelToolCalls(raw).clean).clean;
  };

  const finish = async (
    outcome: AgentTurnOutcome,
    text: string | null,
  ): Promise<AgentTurnResult> => {
    const turnLogId = await logTurn({
      agentKey: label.split("-")[0] ?? label,
      label,
      outcome,
      rounds: Math.max(roundsUsed, 1),
      toolCalls,
      durationMs: Date.now() - startedAt,
    });
    return {
      text,
      toolLog,
      writes,
      outcome,
      rounds: Math.max(roundsUsed, 1),
      toolCalls,
      lastResults,
      finalMessages: current,
      durationMs: Date.now() - startedAt,
      turnLogId,
      createdNovelIds,
    };
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const raw = await teamText(
      current,
      label,
      round === 0 ? timeoutMs : TOOL_FOLLOWUP_TIMEOUT_MS,
      scope,
    );
    roundsUsed = round + 1;
    if (raw === null) {
      modelDied = true;
      break;
    }
    lastRaw = raw;

    const toolParsed = parseNovelToolCalls(raw);
    const writeParsed = parseNovelWriteBlocks(toolParsed.clean);
    const calls = [...toolParsed.calls, ...writeParsed.writes].slice(
      0,
      MAX_TOOL_ROUNDS * 3,
    );
    lastRoundHadTools = calls.length > 0;
    if (calls.length === 0) {
      // No usable blocks — return the text with any stray fences stripped
      // so protocol fragments never leak into the visible reply.
      return finish("answered", cleanAll(raw));
    }

    const results = [
      ...(await executeNovelToolCalls(toolParsed.calls)),
      ...(await executeNovelWrites(writeParsed.writes)),
    ];
    for (const result of results) {
      toolCalls.push({
        round: round + 1,
        action: result.action,
        ok: result.ok,
        error: result.ok ? null : capText(result.summary, 200),
      });
    }
    writes.push(...collectWriteEvidence(results));
    for (const result of results) {
      if (result.ok && result.action === "create_novel" && result.novelId) {
        createdNovelIds.push(result.novelId);
      }
    }
    const roundLog = formatToolResults(results);
    lastResults = roundLog;
    toolLog = toolLog === null
      ? roundLog
      : `${toolLog}\n${roundLog.split("\n").slice(1).join("\n")}`;

    current = [
      ...current,
      { role: "assistant", content: raw },
      {
        role: "user",
        content: `${roundLog}\n\nContinue: if the goal is achieved, write your final answer to the user now WITHOUT a tool block; if you still need tools (e.g. an id returned above), emit exactly one more tool block.`,
      },
    ];
  }

  // AI died mid-loop (rate limit / timeout): never recycle the stale
  // partial text (e.g. a “我将…首先让我读取…” preamble) as the final
  // answer — report failure so tasks fail honestly and the leader
  // follow-up can recover the chain.
  if (modelDied) {
    return finish("model_error", null);
  }

  // Loop exhausted while AI was alive — strip any trailing tool blocks.
  const clean = cleanAll(lastRaw);
  // A very short leftover after writes (e.g. "现在创建第二章：") is a
  // truncated mid-sentence fragment — replace it with a proper closing.
  // The same applies when the model was STILL emitting tool blocks at the
  // round budget: its leftover text is a preamble, not a deliverable.
  // Write receipts are embedded so the reader (leader's follow-up turn)
  // can see WHAT actually landed in the database instead of re-delegating
  // blindly.
  const writeReceipts =
    writes.length > 0 ? `；已写入库：${writes.slice(0, 3).join(" | ")}` : "";
  const text =
    clean.length >= 40 && !lastRoundHadTools
      ? clean
      : toolLog
        ? `本轮工具操作已执行（见任务日志/工具记录）${writeReceipts}；回复被轮次预算截断，回复“继续”我会接着完成剩余部分。`
        : clean.length > 0
          ? clean
          : "";
  return finish("tool_exhausted", text.length > 0 ? text : null);
}

/** Recent history (oldest → newest) mapped into AI messages. */
export async function buildHistoryMessages(
  conversationId: string,
): Promise<AiMessage[]> {
  const rows = await db.teamMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_WINDOW,
  });
  return rows
    .reverse()
    .filter((row) => row.role !== "system")
    .map((row) => ({
      role: (row.role === "user" ? "user" : "assistant") as AiRole,
      content: capOutputTokens(row.content, HISTORY_MESSAGE_CAP),
    }));
}

// ---------------------------------------------------------------------------
// Delegation protocol
// ---------------------------------------------------------------------------

export interface Delegation {
  agent: string;
  title: string;
  description: string;
}

const MAX_DELEGATIONS = 3;

function harvestDelegations(body: string, delegations: Delegation[]): void {
  const parsed = extractJson<{ delegations?: unknown }>(body);
  const list = Array.isArray(parsed?.delegations) ? parsed.delegations : [];
  for (const item of list) {
    if (delegations.length >= MAX_DELEGATIONS) break;
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const agent = typeof record.agent === "string" ? record.agent.trim().toLowerCase() : "";
    const title = typeof record.title === "string" ? record.title.trim().slice(0, 120) : "";
    const description =
      typeof record.description === "string" ? record.description.trim().slice(0, 2000) : "";
    if (agent && title && description) {
      delegations.push({ agent, title, description });
    }
  }
}

/**
 * Extract ```team-delegate blocks from a reply (terminated and, as a
 * fallback for truncated output, an unterminated trailing block). Returns
 * the cleaned visible reply plus the parsed delegations.
 */
export function parseDelegations(raw: string): { clean: string; delegations: Delegation[] } {
  const delegations: Delegation[] = [];
  let clean = raw.replace(/```team-delegate\s*([\s\S]*?)```/gi, (_match, body: string) => {
    harvestDelegations(body, delegations);
    return "";
  });
  const unterminated = clean.match(/```team-delegate\s*([\s\S]*)$/i);
  if (unterminated !== null) {
    harvestDelegations(unterminated[1] ?? "", delegations);
    clean = clean.replace(/```team-delegate\s*[\s\S]*$/i, "");
  }
  return { clean: clean.trim(), delegations };
}

/**
 * Persist delegations as tasks. Unknown keys from the leader are skipped;
 * unknown keys from a member are treated as self-registration.
 */
export async function createTasksFromDelegations(
  delegations: Delegation[],
  creator: AgentRow,
  creatorIsUser: boolean,
  sessionKey: string,
  autoDepth = 0,
  /** P5-g: delegation provenance — inherited from the creating conversation. */
  novelId?: string | null,
): Promise<TaskRow[]> {
  const members = await db.teamAgent.findMany();
  const byKey = new Map(members.map((member) => [member.key.toLowerCase(), member]));
  const created: TaskRow[] = [];
  for (const delegation of delegations) {
    let assignee = byKey.get(delegation.agent) ?? null;
    if (!assignee) {
      assignee = creator.isLeader ? null : creator;
    }
    if (!assignee) continue;
    // The leader never delegates to itself.
    if (assignee.isLeader) continue;
    const task = await db.teamTask.create({
      data: {
        title: delegation.title,
        description: delegation.description,
        sessionKey,
        ...(novelId ? { novelId } : {}),
        assigneeId: assignee.id,
        creatorId: creator.id,
        creatorIsUser,
        autoDepth,
      },
      include: { assignee: true, creator: true, logs: true },
    });
    created.push(task);
  }
  return created;
}

// ---------------------------------------------------------------------------
// Budget-exhaustion self-healing (continuation tasks)
// ---------------------------------------------------------------------------

/** Marker prefix identifying auto-continuation tasks (telemetry + exemption
 *  from write-verification: they are finish-the-answer jobs, not write jobs). */
export const CONTINUATION_TITLE_PREFIX = "⟳ 自动续作：";

function isContinuationTask(title: string): boolean {
  return title.startsWith(CONTINUATION_TITLE_PREFIX);
}

/**
 * The chat turn ended mid-tooling: the round budget ran out while the model
 * was still emitting tool blocks. Instead of dead-ending with a canned
 * “回复继续” message, spawn ONE tracked continuation task assigned to the
 * SAME agent — task execution has its own full AI budget and appends its
 * result to the same conversation, so the job finishes without the user
 * nudging. Bounded by construction: only the chat route spawns these, and
 * task execution never spawns further continuations.
 */
export async function createContinuationTask(
  agent: AgentRow,
  sessionKey: string,
  turn: AgentTurnResult,
  userMessage: string,
  /** P5-g: inherited novel scope, same rule as delegated tasks. */
  novelId?: string | null,
): Promise<TaskRow | null> {
  try {
    const receipts =
      turn.writes.length > 0
        ? `\nWrites already persisted (do NOT redo): ${turn.writes.slice(0, 5).join(" | ")}`
        : "";
    const description = [
      "Your previous reply in the chat was interrupted by the tool-round budget while you were still working. Finish the job NOW and deliver the final answer to the user.",
      "",
      "The user's original message:",
      capOutputTokens(userMessage, 1200),
      "",
      "Tool results already collected (authoritative — do NOT repeat these reads):",
      turn.lastResults ? capOutputTokens(turn.lastResults, 3500) : "(no tool results recorded)",
      receipts,
      "",
      "Rules:",
      "- Complete what remains, then end with a clear final answer to the user (no tool blocks).",
      "- If one decisive tool action is still missing, emit exactly one tool block for it, then finish in the follow-up round.",
      "- Do not invent results: anything not confirmed by tool results or your own actions must be stated as unknown.",
    ].join("\n");
    const task = await db.teamTask.create({
      data: {
        title: `${CONTINUATION_TITLE_PREFIX}完成被截断的回复`,
        description,
        sessionKey,
        ...(novelId ? { novelId } : {}),
        assigneeId: agent.id,
        creatorId: agent.id,
        creatorIsUser: false,
        autoDepth: 0,
      },
      include: { assignee: true, creator: true, logs: true },
    });
    await addTaskLog(task.id, "Auto-continuation spawned — tool-round budget exhausted.", 5);
    return task;
  } catch (error) {
    console.error("[team] continuation task creation failed:", error);
    return null;
  }
}

/**
 * Meaningful visible text for a reply whose content was ONLY a delegate
 * block (clean text empty). Never returns a bare acknowledgment.
 */
export function synthesizeAssignmentReply(tasks: TaskRow[]): string {
  if (tasks.length === 0) {
    return "已记录你的消息，但这轮没有可执行的新任务。告诉我下一步方向即可。";
  }
  const lines = tasks.map((task) => `• ${task.assignee.name}：${task.title}`);
  return `已安排执行：\n${lines.join("\n")}\n\n进度可在任务列表实时查看，完成后我会汇报结果并推进下一步。`;
}

// ---------------------------------------------------------------------------
// Completion-claim ground-truth verification
// ---------------------------------------------------------------------------

/** Is this text even ABOUT novel work? */
const NOVEL_TOPIC_RE = /(章|小说|novel|大纲|伏笔|正文)/i;

/** Past-tense completion claims (已完成 / 写完 / 完结 / completed …). */
const COMPLETION_CLAIM_RE =
  /((已|已经)(全部|基本)?(完成|写完|写入|保存|创作)|写完(了)?|完本|完结(了)?|已写好|全部(完结|写完|完成)|completed|finished writing|all chapters)/i;

/** Suggestions that work remains (chain-death phrasing: "建议继续创作…"). */
const REMAINING_WORK_RE =
  /(建议继续|继续创作|还剩|尚未(创作|完成|写)|剩余章节|其余章节|待写|还没(有)?(写|完成)|接下来(还|要|应))/i;

/** Does this text CLAIM (past tense) that novel content is done? */
export function claimsNovelCompletion(text: string): boolean {
  return NOVEL_TOPIC_RE.test(text) && COMPLETION_CLAIM_RE.test(text);
}

/**
 * One bounded ground-truth round for a reply that claims novel completion
 * (or suggests remaining work) while the turn produced no successful write
 * and no delegation. The history of a long multi-chapter job fills up with
 * "chapter N completed" reports and the model pattern-matches them into
 * fabricated completions ("全部6章完成" while ch6 was never written) — the
 * live database is the only authority that can break that loop.
 *
 * Returns the (possibly corrected) reply plus any delegations the
 * corrective round emitted so the caller can create real tasks from them.
 */
export async function verifyCompletionClaims(options: {
  baseMessages: AiMessage[];
  draftReply: string;
  label: string;
  /** P5-g: attribution scope for the corrective round's ledger rows. */
  scope?: AiScope;
}): Promise<{ text: string; delegations: Delegation[] }> {
  const { baseMessages, draftReply, label } = options;
  if (draftReply.trim().length === 0) {
    return { text: draftReply, delegations: [] };
  }
  const suspicious =
    claimsNovelCompletion(draftReply) || REMAINING_WORK_RE.test(draftReply);
  if (!suspicious) return { text: draftReply, delegations: [] };
  // Everything already written → completion claims are credible; skip.
  if (!(await hasUnwrittenChapters())) return { text: draftReply, delegations: [] };

  const groundTruth = await buildCompactLibraryTruth();
  const instruction = [
    "🔍 FACT-CHECK REQUIRED — your reply above is under verification.",
    "GROUND TRUTH from the novel database RIGHT NOW (authoritative; it overrules anything in the conversation history, including 📦 task reports, whenever they disagree):",
    groundTruth,
    "",
    "Rules for your corrected reply:",
    "- Claim a chapter/novel 完成 ONLY if the ground truth above shows it written.",
    "- NEVER invent or sum word counts; NEVER summarize chapters that no real report covers.",
    "- If unwritten chapters remain and the user expects the job to continue: state the true status in one line, then delegate the NEXT single chapter with the team-delegate block now.",
    "- If your reply above was asking the user a clarifying question or making a conditional offer, do NOT delegate — restate the question and wait for the user's answer.",
    "- Plain text and/or the team-delegate block only — NO novel-tool/novel-write blocks in this reply.",
    "- If your reply above was already fully accurate, restate it (possibly trimmed).",
  ].join("\n");
  const raw = await teamText(
    [
      ...baseMessages,
      { role: "assistant", content: draftReply },
      { role: "user", content: instruction },
    ],
    label,
    25_000,
    options.scope,
  );
  if (raw === null) return { text: draftReply, delegations: [] };
  // Strip any stray novel-tool/write blocks so nothing unexecuted leaks
  // into the visible reply.
  const stripped = parseNovelWriteBlocks(parseNovelToolCalls(raw).clean).clean;
  const parsed = parseDelegations(stripped);
  const text = parsed.clean.trim();
  return {
    text: text.length > 0 ? text : draftReply,
    delegations: parsed.delegations,
  };
}

/**
 * Safety net under the verification round: when a reply still claims
 * completion while unwritten chapters exist, append the factual library
 * state so the user always sees the truth even if the model insists.
 */
export async function appendGroundTruthIfClaimed(text: string): Promise<string> {
  if (!claimsNovelCompletion(text)) return text;
  if (!(await hasUnwrittenChapters())) return text;
  const groundTruth = await buildCompactLibraryTruth();
  return `${text}\n\n📌 库内实况（系统核验，以此为准）：${groundTruth}`;
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

async function addTaskLog(taskId: string, message: string, progress: number): Promise<void> {
  try {
    await db.teamTaskLog.create({ data: { taskId, message, progress } });
  } catch (error) {
    console.error("[team] failed to append task log:", error);
  }
}

/**
 * Does this task intend to PERSIST novel-library content? (Write intent
 * verb + novel context — research/chat tasks like "查找最新小说" must not
 * match.)
 */
const NOVEL_WRITE_INTENT_RE =
  /(创作|撰写|写作|写入|保存|续写|转化|补全|完善|新建|创建|更新|write|save|persist|draft)/i;
// `章` alone is matched too: titles like “《X》第四章《Y》” carry no exact
// “章节/小说/novel” token yet are clearly novel work (this gap let a fake
// completion through once).
const NOVEL_CONTEXT_RE = /(章节?|正文|大纲|伏笔|小说|novel|chapter|outline|foreshadow)/i;

function isNovelWriteTask(task: { title: string; description: string }): boolean {
  const text = `${task.title}\n${task.description}`;
  return NOVEL_WRITE_INTENT_RE.test(text) && NOVEL_CONTEXT_RE.test(text);
}

/** Repair nudge when a write-task finished without any database write. */
const WRITE_REPAIR_INSTRUCTION = [
  "⚠️ DATABASE CHECK FAILED: your reply above claims the work is done, but this task executed ZERO successful write actions to the novel library.",
  "Text that is not persisted is FAILED work. Now do ONE of the following:",
  "1. Emit the correct novel-tool block(s)/novel-write block(s) to persist the content (use ids from the read results above), or",
  "2. If the content was never actually produced, produce it now AND persist it, or",
  "3. If persistence is genuinely not applicable to this task, reply with exactly: NO_WRITE_NEEDED",
].join("\n");

/**
 * Execute one task: atomic claim (prevents double runs from concurrent
 * pollers) → progress logs → AI deliverable → persist result → append the
 * exchange to the assignee's conversation → forward a report to the
 * creator's conversation (or the leader's when the user assigned directly).
 */
export async function runTask(taskId: string): Promise<void> {
  const claimed = await db.teamTask.updateMany({
    where: { id: taskId, status: { in: ["pending", "failed"] } },
    data: { status: "in_progress", progress: 5, error: null },
  });
  if (claimed.count === 0) return; // already running/completed elsewhere

  const task = await db.teamTask.findUnique({
    where: { id: taskId },
    include: { assignee: true, creator: true, logs: true },
  });
  if (!task) return;
  // P5-g attribution scope (plan §5): a task inherited a pinned novelId at
  // creation → direct attribution; otherwise the pre-novel session
  // namespace "ai-team:<sessionKey>" (wizard precedent — a create_novel
  // inside the task retro-adopts these rows via the provenance link).
  const scope: AiScope = task.novelId
    ? { novelId: task.novelId }
    : { correlationId: `ai-team:${task.sessionKey}` };
  const setTask = (data: Prisma.TeamTaskUpdateInput) =>
    db.teamTask.update({ where: { id: taskId }, data }).catch((error: unknown) => {
      console.error("[team] task update failed:", error);
    });

  try {
    await addTaskLog(taskId, "Task accepted — analyzing requirements…", 10);

    // The assignee's conversation for THIS task's session receives the
    // task exchange, so the direct-chat history stays complete.
    const assigneeConversation = await getOrCreateConversation(
      task.assigneeId,
      task.sessionKey,
    );
    let recentChat = "";
    if (assigneeConversation) {
      const recent = await db.teamMessage.findMany({
        where: { conversationId: assigneeConversation.id, role: { not: "system" } },
        orderBy: { createdAt: "desc" },
        take: 6,
      });
      recentChat = recent
        .reverse()
        .map((message) => {
          const who =
            message.role === "user"
              ? "User"
              : message.role === "assistant"
                ? task.assignee.name
                : "Note";
          return `${who}: ${capOutputTokens(message.content, 300)}`;
        })
        .join("\n")
        .slice(0, TASK_CONTEXT_CAP);
    }

    await setTask({ progress: 30 });
    await addTaskLog(taskId, "Working on the deliverable…", 35);

    // Task executors get the same novel-library read/write powers as chats.
    const novelToolPrompt = await buildNovelToolPrompt();
    const execMessages = buildTaskExecutionMessages(
      task.assignee,
      task.creatorIsUser ? "the user" : task.creator.name,
      task.title,
      task.description,
      recentChat,
    ).map((message) =>
      message.role === "system"
        ? { ...message, content: `${message.content}\n\n${novelToolPrompt}` }
        : message,
    );
    const turn = await teamAgentTurn(execMessages, "task", AI_TIMEOUT_MS, scope);
    // Self-healing: the execution turn burned its tool-round budget while
    // still working. ONE bounded closeout round (resuming from the exact
    // tool-state conversation) finishes the deliverable instead of failing
    // with a truncated reply. Task execution never spawns further
    // continuations — this is the last extra round by construction.
    let effectiveTurn = turn;
    if (turn.outcome === "tool_exhausted") {
      await addTaskLog(taskId, "工具轮次预算耗尽 — 自动追加一轮收尾执行…", 55);
      const closeout = await teamAgentTurn(
        [
          ...turn.finalMessages,
          {
            role: "user",
            content:
              "⏱️ Your previous reply hit the tool-round budget while you were still working. " +
              "The tool results above are collected and authoritative. Finish NOW: " +
              "if the deliverable is complete, write the final completion report (NO tool blocks); " +
              "if one decisive tool action is still missing, emit exactly ONE tool block for it.",
          },
        ],
        "task-closeout",
        TOOL_FOLLOWUP_TIMEOUT_MS,
        scope,
      );
      effectiveTurn = {
        ...closeout,
        toolLog: mergeToolLogs(turn.toolLog, closeout.toolLog),
        writes: [...turn.writes, ...closeout.writes],
        rounds: turn.rounds + closeout.rounds,
      };
    }
    // Task results must never contain delegate blocks.
    let result = effectiveTurn.text === null ? null : parseDelegations(effectiveTurn.text).clean;
    let toolLog = effectiveTurn.toolLog;
    let writes = effectiveTurn.writes;

    // Write-verification: a task whose reply CLAIMS novel work is done but
    // which performed zero database writes is the sneakiest failure mode
    // ("已完成" with nothing saved). Trigger on task intent OR on a
    // completion claim in the result itself (intent regexes can never cover
    // every phrasing — a claim-based check always catches the lie). Give
    // the assignee one repair round to actually persist; fail honestly if
    // it still writes nothing.
    if (
      result !== null &&
      result.length > 0 &&
      writes.length === 0 &&
      !isContinuationTask(task.title) &&
      (isNovelWriteTask(task) || claimsNovelCompletion(result))
    ) {
      await addTaskLog(taskId, "No database write detected — requesting persistence repair…", 60);
      const repair = await teamAgentTurn(
        [
          ...execMessages,
          { role: "assistant", content: turn.text ?? "" },
          { role: "user", content: WRITE_REPAIR_INSTRUCTION },
        ],
        "task-write-repair",
        AI_TIMEOUT_MS,
        scope,
      );
      const repairedClean =
        repair.text === null ? "" : parseDelegations(repair.text).clean;
      if (!/^NO_WRITE_NEEDED$/i.test(repairedClean.trim())) {
        if (repairedClean.length > 0) result = repairedClean;
      }
      if (repair.toolLog) {
        toolLog = toolLog
          ? `${toolLog}\n${repair.toolLog.split("\n").slice(1).join("\n")}`
          : repair.toolLog;
      }
      writes = [...writes, ...repair.writes];
      if (writes.length === 0) {
        // The model's explicit NO_WRITE_NEEDED is trustworthy for tasks that
        // never intended writes (read-and-report jobs legitimately end with
        // library status claims like “已完成12章”); write-intent tasks must
        // still produce receipts.
        if (!(/^NO_WRITE_NEEDED$/i.test(repairedClean.trim()) && !isNovelWriteTask(task))) {
          throw new Error(
            '任务答复声称完成，但小说库中没有任何成功写入 (claimed completion, but zero write actions reached the database).',
          );
        }
      }
    }

    if (result === null || result.length === 0) {
      throw new Error("AI did not return a usable result in time.");
    }

    await setTask({ progress: 90 });
    await addTaskLog(taskId, "Finalizing result…", 90);

    await setTask({ status: "completed", progress: 100, result });
    await addTaskLog(taskId, "Task completed ✓", 100);

    // P5-g provenance (plan §5.2): a pre-novel task whose execution created
    // a novel retro-adopts its ledger rows into that novel's ledger — the
    // wizard precedent. Idempotent per (correlationId, novelId).
    if (scope.correlationId && turn.createdNovelIds.length > 0) {
      for (const createdId of turn.createdNovelIds) {
        recordProvenanceLink("ai-team", scope.correlationId, createdId);
      }
    }

    // Keep the assignee's own conversation history complete (task in →
    // tool activity → result out).
    if (assigneeConversation) {
      const baseTime = new Date();
      await db.teamMessage.createMany({
        data: [
          {
            conversationId: assigneeConversation.id,
            role: "user",
            content: `🎯 Task from ${task.creatorIsUser ? "the user" : task.creator.name} — "${task.title}":\n${task.description}`,
            createdAt: baseTime,
          },
          ...(toolLog
            ? [{
                conversationId: assigneeConversation.id,
                role: "system",
                content: toolLog,
                createdAt: new Date(baseTime.getTime() + 1),
              }]
            : []),
          {
            conversationId: assigneeConversation.id,
            role: "assistant",
            content: result,
            createdAt: new Date(baseTime.getTime() + 2),
          },
        ],
      });
      await db.teamConversation.update({
        where: { id: assigneeConversation.id },
        data: { updatedAt: new Date() },
      });
    }

    // Forward the report: to the creator, or to the leader when the user
    // assigned the task directly (keeps the leader in the loop).
    // Self-continuations (creator === assignee) already append their result
    // to that same conversation — a report would be pure duplication.
    const leader = await getLeader();
    const selfContinuation = task.creatorId === task.assigneeId;
    const reportAgentId = selfContinuation
      ? null
      : task.creatorIsUser
        ? leader?.id ?? null
        : task.creatorId;
    if (reportAgentId) {
      const reportConversation = await getOrCreateConversation(reportAgentId, task.sessionKey);
      if (reportConversation) {
        const capped = result.length > 1500 ? `${result.slice(0, 1500)} …(truncated)` : result;
        const evidence =
          writes.length > 0
            ? `\n\n✍️ 写入凭证: ${writes.slice(0, 3).join(" | ")}`
            : "";
        await db.teamMessage.create({
          data: {
            conversationId: reportConversation.id,
            role: "system",
            content: `📦 Task report — ${task.assignee.name} completed "${task.title}":\n${capped}${evidence}`,
          },
        });
        await db.teamConversation.update({
          where: { id: reportConversation.id },
          data: { updatedAt: new Date() },
        });
      }

      // Auto-continue: the report wakes the leader for one bounded turn so
      // multi-step jobs keep moving without the user nudging every time.
      if (leader && reportAgentId === leader.id && task.autoDepth < MAX_AUTO_DEPTH) {
        await runLeaderFollowUp(task.sessionKey, result, task.autoDepth + 1, scope);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    await setTask({ status: "failed", error: message });
    await addTaskLog(taskId, `Task failed: ${message}`, 100);

    // A failed task must never just vanish: forward a failure report to the
    // same conversation that would have received the success report, and
    // wake the leader so it can retry / re-delegate / inform the user.
    // Self-continuations report to their own conversation instead (the user
    // was promised the follow-up there); a leader wake-up on a failed
    // self-continuation would just duplicate the answer the leader was
    // already trying to produce.
    try {
      const leader = await getLeader();
      const selfContinuation = task.creatorId === task.assigneeId;
      if (selfContinuation) {
        const ownConversation = await getOrCreateConversation(task.assigneeId, task.sessionKey);
        if (ownConversation) {
          await db.teamMessage.create({
            data: {
              conversationId: ownConversation.id,
              role: "assistant",
              content: `⚠️ 自动续作执行失败：${message}\n任务记录保留在任务列表中；直接告诉我需要什么，我会重新处理。`,
            },
          });
          await db.teamConversation.update({
            where: { id: ownConversation.id },
            data: { updatedAt: new Date() },
          });
        }
      } else {
        const reportAgentId = task.creatorIsUser ? leader?.id ?? null : task.creatorId;
        if (reportAgentId) {
          const reportConversation = await getOrCreateConversation(reportAgentId, task.sessionKey);
          if (reportConversation) {
            await db.teamMessage.create({
              data: {
                conversationId: reportConversation.id,
                role: "system",
                content: `❌ Task failed — ${task.assignee.name}: "${task.title}"\nReason: ${message}`,
              },
            });
            await db.teamConversation.update({
              where: { id: reportConversation.id },
              data: { updatedAt: new Date() },
            });
          }
          if (leader && reportAgentId === leader.id && task.autoDepth < MAX_AUTO_DEPTH) {
            await runLeaderFollowUp(
              task.sessionKey,
              `❌ Task "${task.title}" FAILED. Reason: ${message}\n` +
                "Decide NOW: retry the same task once, delegate a smaller version of it, or close with a clear status for the user plus a recommended next step.",
              task.autoDepth + 1,
              scope,
            );
          }
        }
      }
    } catch (reportError) {
      console.error("[team] failure report could not be delivered:", reportError);
    }
  }
}

/** Merge two tool-log blocks (extra's header line is dropped). */
function mergeToolLogs(base: string | null, extra: string | null): string | null {
  if (!base) return extra;
  if (!extra) return base;
  return `${base}\n${extra.split("\n").slice(1).join("\n")}`;
}

/** Run a batch of tasks sequentially (each AI call has its own budget). */
export async function runTasksSequentially(taskIds: string[]): Promise<void> {
  for (let index = 0; index < taskIds.length; index++) {
    // Small stagger between tasks: back-to-back AI bursts trip the rate
    // limiter and waste the whole chain.
    if (index > 0) await sleep(900);
    try {
      await runTask(taskIds[index]);
    } catch (error) {
      console.error("[team] background task run failed:", error);
    }
  }
}

// ---------------------------------------------------------------------------
// Leader auto-continue (task reports wake the leader)
// ---------------------------------------------------------------------------

/**
 * Max leader follow-up rounds per user-initiated job (runaway guard).
 * A 6-chapter job needs one hop per chapter (report → delegate next) plus a
 * closing turn and retry headroom — 3 starved real jobs mid-chain and the
 * leader then hallucinated progress when the user kept nudging.
 */
const MAX_AUTO_DEPTH = 8;

/**
 * After a task report lands in the LEADER's conversation, give the leader
 * one autonomous turn: it either delegates the next concrete step (the
 * chain continues, depth + 1) or closes the job with a status summary.
 * Depth is persisted on tasks (autoDepth) so chains stay bounded across
 * server restarts.
 */
export async function runLeaderFollowUp(
  sessionKey: string,
  reportContent: string,
  depth: number,
  /** P5-g: the reporting task's attribution scope, threaded to every AI
   *  call and inherited by any tasks the follow-up delegates. */
  scope?: AiScope,
): Promise<void> {
  try {
    const leader = await getLeader();
    if (!leader) return;
    const conversation = await getOrCreateConversation(leader.id, sessionKey);
    const members = await db.teamAgent.findMany({
      where: { isLeader: false },
      orderBy: { sortOrder: "asc" },
    });
    const systemPrompt = `${buildLeaderSystemPrompt(leader, members)}\n\n${await buildNovelToolPrompt({ readonly: true })}`;
    const history = await buildHistoryMessages(conversation.id);
    const cappedReport =
      reportContent.length > 4500 ? `${reportContent.slice(0, 4500)} …(truncated)` : reportContent;
    // Show what is already queued so the leader never re-delegates work
    // that is pending or in progress for this session.
    const openTasks = await db.teamTask.findMany({
      where: { sessionKey, status: { in: ["pending", "in_progress"] } },
      include: { assignee: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 6,
    });
    const openTasksNote =
      openTasks.length > 0
        ? `Already queued/in progress for this session (do NOT re-delegate these):\n${openTasks
            .map((t) => `- [${t.status}] "${t.title}" → ${t.assignee.name}`)
            .join("\n")}`
        : "No other tasks are queued for this session.";
    // Computed ground truth: which chapters STILL need writing. This is the
    // chain's targeting data — reports in history can be stale or wrong
    // (a faked "第一章已完成" once sent the chain to the wrong chapters); the
    // database cannot lie.
    const unwrittenWork = await buildUnwrittenWorkSummary();
    const instruction = [
      "⏰ AUTONOMOUS FOLLOW-UP — a task report just arrived (repeated below). The user is waiting on this job.",
      "",
      cappedReport,
      "",
      openTasksNote,
      "",
      "UNWRITTEN WORK right now (database truth — overrides ANY report or claim in history that contradicts it):",
      unwrittenWork,
      "",
      "Decide the next move NOW:",
      "- If UNWRITTEN WORK above is not empty and this job is about that novel: delegate the NEXT single unwritten chapter (split big jobs chapter-by-chapter) with the team-delegate block. Never delegate a chapter the unwritten-work list does not include.",
      "- If the overall job is DONE (nothing unwritten for this novel): write a short closing summary for the user — what was accomplished, what was persisted (chapter numbers), and 1-2 suggested next steps.",
      "- Otherwise reply with the precise status plus your recommended next step.",
      "Never reply with a bare acknowledgment like “Understood” or “好的”。",
    ].join("\n");

    const followUpMessages: AiMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: instruction },
    ];
    const turn = await teamAgentTurn(followUpMessages, "leader-followup", AI_TIMEOUT_MS, scope);
    if (turn.text === null) {
      // Never die silently: the user just saw a task report land with no
      // reaction. Leave a visible recovery hint instead.
      await db.teamMessage.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          content:
            "⚠️ 我收到任务报告后尝试自动推进下一步，但模型暂时不可用（限流/超时），这次没能生成后续计划。" +
            "任务进度已保存；回复“继续”我就会接着推进当前任务。",
        },
      });
      await db.teamConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
      return;
    }

    const firstParsed = parseDelegations(turn.text);
    let clean = firstParsed.clean;
    let delegations = firstParsed.delegations;

    // Repair pass (same as the chat route): the follow-up announced work
    // ("我会重新安排Sage…") but skipped the protocol block, so nothing
    // would be tracked. One bounded round converts the announcement into
    // real tasks.
    if (delegations.length === 0) {
      const mentioned = members.filter((member) =>
        clean.toLowerCase().includes(member.name.toLowerCase()),
      );
      if (mentioned.length > 0) {
        const repairRaw = await teamText(
          [
            ...followUpMessages,
            { role: "assistant", content: turn.text },
            ...buildDelegationRepairMessages(mentioned.map((member) => member.name)),
          ],
          "leader-followup-repair",
          25_000,
          scope,
        );
        if (repairRaw !== null && !/^NO_BLOCK$/i.test(repairRaw.trim())) {
          const repaired = parseDelegations(repairRaw);
          if (repaired.delegations.length > 0) {
            delegations = repaired.delegations;
            clean = repaired.clean.length > 0 ? repaired.clean : clean;
          }
        }
      }
    }

    // Ground-truth verification: a follow-up that claims completion or
    // merely "suggests" continuing without delegating is exactly how the
    // auto-chain used to die (and how fabricated "已完成" replies were
    // born). One corrective round — its delegations become real tasks.
    if (delegations.length === 0 && clean.length > 0) {
      const verified = await verifyCompletionClaims({
        baseMessages: followUpMessages,
        draftReply: clean,
        label: "leader-followup-verify",
        scope,
      });
      if (verified.delegations.length > 0) {
        delegations = verified.delegations;
      }
      clean = verified.text;
    }

    const tasks =
      delegations.length > 0
        ? await createTasksFromDelegations(
            delegations,
            leader,
            false,
            sessionKey,
            depth,
            scope?.novelId ?? null,
          )
        : [];

    const replyTime = new Date();
    if (turn.toolLog) {
      await db.teamMessage.create({
        data: {
          conversationId: conversation.id,
          role: "system",
          content: turn.toolLog,
          createdAt: replyTime,
        },
      });
    }
    let reply =
      clean.length > 0
        ? clean
        : tasks.length > 0
          ? synthesizeAssignmentReply(tasks)
          : turn.toolLog
            ? "我已核查库内数据（见上方工具记录），暂时没有需要补派的步骤；回复“继续”可让我复查进度并推进下一步。"
            : "任务报告已收到，但这轮我没能给出有效的下一步决策。回复“继续”让我重新评估并推进，或直接告诉我新的方向。";
    if (tasks.length === 0 && clean.length > 0) {
      reply = await appendGroundTruthIfClaimed(reply);
    }
    await db.teamMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: reply,
        taskIds: tasks.length > 0 ? JSON.stringify(tasks.map((task) => task.id)) : null,
        createdAt: new Date(replyTime.getTime() + 2),
      },
    });
    await db.teamConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    if (tasks.length > 0) {
      await runTasksSequentially(tasks.map((task) => task.id));
    }
  } catch (error) {
    console.error("[team] leader follow-up failed:", error);
  }
}

/**
 * Safety net: tasks stuck in `pending` (e.g. the server restarted right
 * after a chat message) are re-kicked. Claim-based locking keeps this safe
 * to call from every tasks poll.
 */
export function healOrphanTasks(): void {
  void (async () => {
    try {
      const cutoff = new Date(Date.now() - 20_000);
      const stuck = await db.teamTask.findMany({
        where: { status: "pending", updatedAt: { lt: cutoff } },
        select: { id: true },
        take: 5,
      });
      for (const task of stuck) {
        void runTask(task.id).catch(() => undefined);
      }
    } catch (error) {
      console.error("[team] orphan heal failed:", error);
    }
  })();
}
