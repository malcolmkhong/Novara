/**
 * Server-side orchestration for the AI Team workspace.
 *
 * Responsibilities:
 *  - seed the default team (leader + 4 specialists)
 *  - GLM plumbing for agent replies (system role verified working)
 *  - parse/strip the ```team-delegate protocol from replies
 *  - task lifecycle: claim → progress logs → GLM execution → reports
 *
 * Every GLM call is bounded by withTimeout (see ai-heuristics) so a single
 * exchange always finishes well inside the gateway budget. Task execution
 * runs in the background via next/server `after()` — routes respond fast and
 * the UI polls task state.
 */
import ZAI from "z-ai-web-dev-sdk";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { capForGlm, extractJson, withTimeout } from "@/lib/ai-heuristics";
import {
  buildLeaderSystemPrompt,
  buildMemberChatPrompt,
  buildTaskExecutionMessages,
} from "@/lib/ai-team/prompts";
import { buildNovelToolPrompt } from "@/lib/ai-team/novel-tools";
import {
  executeNovelToolCalls,
  executeNovelWrites,
  formatToolResults,
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
// GLM plumbing
// ---------------------------------------------------------------------------

const GLM_TIMEOUT_MS = 55_000;
/** Budget for the post-tool follow-up call of an agent turn. */
const TOOL_FOLLOWUP_TIMEOUT_MS = 35_000;
/** Per-message cap when replaying conversation history to GLM. */
const HISTORY_MESSAGE_CAP = 1200;
/** How much of the conversation history (messages) is replayed. */
const HISTORY_WINDOW = 12;
/** Max chars of recent user/agent chat injected into a task execution. */
const TASK_CONTEXT_CAP = 1800;

type GlmRole = "system" | "user" | "assistant";
interface GlmMessage {
  role: GlmRole;
  content: string;
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

/** One GLM request. Returns reply text or null on ANY failure. Never throws. */
export async function glmText(
  messages: GlmMessage[],
  label: string,
  timeoutMs: number = GLM_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const zai = await ZAI.create();
    const completion: unknown = await withTimeout(
      zai.chat.completions.create({
        messages: messages.map((message) => ({
          ...message,
          // System prompts now carry persona + team/novel-tool protocol +
          // library snapshot, so they get the same budget as user turns.
          content: capForGlm(message.content, message.role === "system" ? 6500 : 6000),
        })),
        thinking: { type: "disabled" },
      }),
      timeoutMs,
      `[team/${label}]`,
    );
    return extractCompletionContent(completion);
  } catch (error) {
    console.error(`[team/${label}] GLM request failed:`, error);
    return null;
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

export async function getOrCreateConversation(agentId: string, sessionKey: string) {
  const existing = await db.teamConversation.findUnique({
    where: { agentId_sessionKey: { agentId, sessionKey } },
  });
  if (existing) return existing;
  return db.teamConversation.create({
    data: { agentId, sessionKey },
  });
}

// ---------------------------------------------------------------------------
// Agent turn with novel-tool loop
// ---------------------------------------------------------------------------

export interface AgentTurnResult {
  /** Final visible reply (novel-tool blocks stripped), or null on GLM failure. */
  text: string | null;
  /** Formatted tool activity (also the data payload), null when no tools used. */
  toolLog: string | null;
}

const MAX_TOOL_ROUNDS = 3; // 1 initial call + up to 2 tool-execution rounds

/**
 * One full agent turn with a bounded tool loop (JSON ```novel-tool actions
 * + plain-text ```novel-write chapter blocks):
 *   call → blocks? → execute → call with results → … (max 3 calls)
 * Multi-round lets chained writes work (read ids → write chapters). Every
 * request's GLM usage stays bounded; each round gets its own timeout so a
 * single exchange never hangs.
 */
export async function glmAgentTurn(
  messages: GlmMessage[],
  label: string,
  timeoutMs: number = GLM_TIMEOUT_MS,
): Promise<AgentTurnResult> {
  let toolLog: string | null = null;
  let current: GlmMessage[] = messages;
  let lastRaw = "";

  const cleanAll = (raw: string): string => {
    // Strip JSON tool blocks first, then plain-text write blocks.
    return parseNovelWriteBlocks(parseNovelToolCalls(raw).clean).clean;
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const raw = await glmText(
      current,
      label,
      round === 0 ? timeoutMs : TOOL_FOLLOWUP_TIMEOUT_MS,
    );
    if (raw === null) break;
    lastRaw = raw;

    const toolParsed = parseNovelToolCalls(raw);
    const writeParsed = parseNovelWriteBlocks(toolParsed.clean);
    const calls = [...toolParsed.calls, ...writeParsed.writes].slice(
      0,
      MAX_TOOL_ROUNDS * 3,
    );
    if (calls.length === 0) {
      // No usable blocks — return the text with any stray fences stripped
      // so protocol fragments never leak into the visible reply.
      return { text: cleanAll(raw), toolLog };
    }

    const results = [
      ...(await executeNovelToolCalls(toolParsed.calls)),
      ...(await executeNovelWrites(writeParsed.writes)),
    ];
    const roundLog = formatToolResults(results);
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

  // Loop exhausted (or GLM died mid-loop) — strip any trailing tool blocks.
  const clean = cleanAll(lastRaw);
  // A very short leftover after writes (e.g. "现在创建第二章：") is a
  // truncated mid-sentence fragment — replace it with a proper closing.
  const text =
    clean.length >= 40
      ? clean
      : toolLog
        ? "Done — see the tool results above."
        : clean.length > 0
          ? clean
          : "";
  return { text: text.length > 0 ? text : null, toolLog };
}

/** Recent history (oldest → newest) mapped into GLM messages. */
export async function buildHistoryMessages(
  conversationId: string,
): Promise<GlmMessage[]> {
  const rows = await db.teamMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_WINDOW,
  });
  return rows
    .reverse()
    .filter((row) => row.role !== "system")
    .map((row) => ({
      role: (row.role === "user" ? "user" : "assistant") as GlmRole,
      content: capForGlm(row.content, HISTORY_MESSAGE_CAP),
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

/**
 * Meaningful visible text for a reply whose content was ONLY a delegate
 * block (clean text empty). Replaces the useless "Understood — noted.".
 */
export function synthesizeAssignmentReply(tasks: TaskRow[]): string {
  if (tasks.length === 0) return "Understood — noted.";
  const lines = tasks.map((task) => `• ${task.assignee.name}：${task.title}`);
  return `已安排执行：\n${lines.join("\n")}\n\n进度可在任务列表实时查看，完成后我会汇报结果并推进下一步。`;
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
 * Execute one task: atomic claim (prevents double runs from concurrent
 * pollers) → progress logs → GLM deliverable → persist result → append the
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
          return `${who}: ${capForGlm(message.content, 300)}`;
        })
        .join("\n")
        .slice(0, TASK_CONTEXT_CAP);
    }

    await setTask({ progress: 30 });
    await addTaskLog(taskId, "Working on the deliverable…", 35);

    // Task executors get the same novel-library read/write powers as chats.
    const novelToolPrompt = await buildNovelToolPrompt();
    const turn = await glmAgentTurn(
      buildTaskExecutionMessages(
        task.assignee,
        task.creatorIsUser ? "the user" : task.creator.name,
        task.title,
        task.description,
        recentChat,
      ).map((message) =>
        message.role === "system"
          ? { ...message, content: `${message.content}\n\n${novelToolPrompt}` }
          : message,
      ),
      "task",
    );
    // Task results must never contain delegate blocks.
    const result = turn.text === null ? null : parseDelegations(turn.text).clean;
    if (result === null || result.length === 0) {
      throw new Error("GLM did not return a usable result in time.");
    }
    const toolLog = turn.toolLog;

    await setTask({ progress: 90 });
    await addTaskLog(taskId, "Finalizing result…", 90);

    await setTask({ status: "completed", progress: 100, result });
    await addTaskLog(taskId, "Task completed ✓", 100);

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
    const leader = await getLeader();
    const reportAgentId = task.creatorIsUser ? leader?.id ?? null : task.creatorId;
    if (reportAgentId) {
      const reportConversation = await getOrCreateConversation(reportAgentId, task.sessionKey);
      if (reportConversation) {
        const capped = result.length > 1500 ? `${result.slice(0, 1500)} …(truncated)` : result;
        await db.teamMessage.create({
          data: {
            conversationId: reportConversation.id,
            role: "system",
            content: `📦 Task report — ${task.assignee.name} completed "${task.title}":\n${capped}`,
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
        await runLeaderFollowUp(task.sessionKey, result, task.autoDepth + 1);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    await setTask({ status: "failed", error: message });
    await addTaskLog(taskId, `Task failed: ${message}`, 100);
  }
}

/** Run a batch of tasks sequentially (each GLM call has its own budget). */
export async function runTasksSequentially(taskIds: string[]): Promise<void> {
  for (const taskId of taskIds) {
    try {
      await runTask(taskId);
    } catch (error) {
      console.error("[team] background task run failed:", error);
    }
  }
}

// ---------------------------------------------------------------------------
// Leader auto-continue (task reports wake the leader)
// ---------------------------------------------------------------------------

/** Max leader follow-up rounds per user-initiated job (runaway guard). */
const MAX_AUTO_DEPTH = 3;

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
    const instruction = [
      "⏰ AUTONOMOUS FOLLOW-UP — a task report just arrived (repeated below). The user is waiting on this job.",
      "",
      cappedReport,
      "",
      openTasksNote,
      "",
      "Decide the next move NOW:",
      "- If the overall job is DONE: write a short closing summary for the user — what was accomplished, what was persisted (chapters/word counts), and 1-2 suggested next steps.",
      "- If it is NOT done: delegate the next concrete step with the team-delegate block (split big jobs chapter-by-chapter), or reply with the precise status plus your recommended next step.",
      "Never reply with a bare acknowledgment like “Understood” or “好的”。",
    ].join("\n");

    const turn = await glmAgentTurn(
      [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: instruction },
      ],
      "leader-followup",
    );
    if (turn.text === null) return;

    const { clean, delegations } = parseDelegations(turn.text);
    const tasks =
      delegations.length > 0
        ? await createTasksFromDelegations(delegations, leader, false, sessionKey, depth)
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
    const reply =
      clean.length > 0
        ? clean
        : tasks.length > 0
          ? synthesizeAssignmentReply(tasks)
          : null;
    if (reply !== null) {
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
    }

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
