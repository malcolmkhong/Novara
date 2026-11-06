// ---------------------------------------------------------------------------
// Novara AI — agent runtime (Phase 3+5, development plan §4 / §7.1 / §8).
//
// Orchestrates one run as a TEAM: Atlas leads a bounded tool loop (read
// tools + ```team-delegate work orders), CODE executes each order against
// the assigned member (sage/nova/prism/forge) with its own tool surface,
// then feeds the member's verified outcome back to Atlas for the next
// decision. CODE owns every hard edge:
//   - tool protocol parsing (lib/agent/tool-protocol.ts)
//   - per-role tool surfaces (MEMBER_TOOLS) — a role asking for a tool it
//     does not own gets an error feed, never a silent pass
//   - anti-overwrite gate  (lib/novara/write-gate.ts) — non-empty chapter
//     replacement ALWAYS pauses for the author, even in full-access mode
//   - approval gate (D2) — in approval mode every chapter content write
//     pauses; the pending write lives in a write-event payload (durable)
//   - write verification — a SAGE chapter task without a verified DB write
//     gets repair rounds, then `failed`. Narration is never a write.
//   - honesty rule — task `done` flips happen only after verified commits;
//     finalReport compares claimed (model) vs verified (measured) numbers;
//     review-found blocking issues without a repair order are flagged.
//   - context compaction (Phase 2, lib/agent/wire.ts) — LEADER loop only,
//     fires between turns: a deterministic zero-GLM projection replaces the
//     covered span on the next wire; canonical rows are never rewritten;
//     metered as sent (agent-ctx/p2-design.md).
//
// Resumability (Phase 1): the canonical transcript lives in AgentMessage and
// the loop cursor in AgentRun.stateJson (lib/agent/messages.ts). The executor
// holds a CAS-claimed, heartbeat-renewed, epoch-fENCED lease; every transcript
// append and every checkpoint verifies the lease in the same transaction, so
// an evicted executor can neither advance the loop nor append to a
// conversation it lost. Order rule: persist transcript FIRST, bump the cursor
// SECOND. Approval gates stay stateless (the executor polls run.status inside
// its lease); approve/reject/cancel handlers flip DB state and the executor
// follows. A run orphaned by a process restart is claimed by the resume
// endpoint (epoch increment) or — only when its lease is stale AND its events
// are stale — marked failed by healStaleRuns.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { getBudgets, buildSystemPrompt, getSkillEntry } from "@/lib/novara/content";
import { glmChat } from "@/lib/novara/glm";
import {
  resolveModelSelection,
  type ModelSelection,
  type SdkModelParams,
} from "@/lib/novara/models";
import {
  createContextMeter,
  formatUsageSummary,
  reconcileUsageWithReal,
  type ContextMeter,
} from "@/lib/agent/context-meter";
import type { RealUsage } from "@/lib/usage/usage-shapes";
import { countWords } from "@/lib/novara/words";
import { assessOverwrite } from "@/lib/novara/write-gate";
import { recordChapterVersion } from "@/lib/novara/versions";
import { reviewChapter } from "@/lib/novara/review";
import { sedimentChapterCore, type SedimentOutcome } from "@/lib/novara/sediment";
import { buildMemoryView, formatMemoryLines, queryMemory } from "@/lib/novara/memory";
import {
  auditReport,
  evaluateFinalize,
  evaluateRepair,
  evaluateSettle,
} from "@/lib/novara/qc";
import type {
  AgentEvent,
  AgentEventKind,
  AgentRoleId,
  AgentRun,
  AgentRunDetail,
  AgentRunMode,
  AgentRunStatus,
  AgentTask,
  ApprovalKind,
  PinnedRef,
  RunFinalReport,
} from "@/lib/novara/agent-types";
import { parseAgentTurn, type DelegateOrder } from "./tool-protocol";
import { buildManuscriptMarkdown } from "@/lib/novara/export";
import {
  languageDirective,
  loadStorySnapshot,
  quotaForChapter,
  renderSnapshot,
  type StorySnapshotData,
} from "./snapshot";
// P4 — member snapshot slicing (see executeTask novelParts comment).
import { buildMemberSnapshotSlice } from "./snapshot-slice";
import {
  appendAgentMessages,
  claimLease,
  leaseIsAlive,
  LEADER_CONVERSATION,
  LEASE_RENEW_MS,
  LeaseLostError,
  loadConversation,
  readLoopState,
  releaseLease,
  renewLease,
  verifyLease,
  writeLoopState,
  type AppendMessageEntry,
  type ExecutorLease,
  type RunLoopState,
} from "./messages";
import {
  assembleWire,
  buildProjectionBody,
  COMPACTION_SLACK_TOKENS,
  decideCut,
  fallbackErrorSummary,
  findEnvelopeSeq,
  guardSkipSummary,
  monotoneGuardCheck,
  renderProjection,
  writeCompactionSummary,
  type AssembleWireResult,
  type WireMessage,
  type WriteSummaryResult,
} from "./wire";

// ---------------------------------------------------------------------------
// Module state — in-process executor registry (one loop per run).
// ---------------------------------------------------------------------------

const executors = new Map<string, { controller: AbortController }>();

const ACTIVE_STATUSES: AgentRunStatus[] = ["running", "awaiting_approval", "paused"];
const TERMINAL_STATUSES: AgentRunStatus[] = ["completed", "failed", "cancelled"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ---------------------------------------------------------------------------
// Executor lease guard (Phase 1) — one guard per executeRun. Every transcript
// append and every cursor checkpoint goes through it; a rejected fenced write
// (count === 0), a rejected heartbeat renewal, or a failed ownership check
// marks the lease lost and the executor aborts with ZERO further DB writes —
// the current lease owner owns the run from that moment.
// ---------------------------------------------------------------------------

class LeaseGuard {
  lost = false;

  constructor(
    readonly runId: string,
    readonly lease: ExecutorLease
  ) {}

  /** Ownership self-check (used after long awaits / at turn boundaries). */
  async assertHeld(): Promise<void> {
    if (this.lost) throw new LeaseLostError();
    if (!(await verifyLease(this.runId, this.lease))) throw new LeaseLostError();
  }

  /**
   * Fenced cursor checkpoint — false ⇒ evicted ⇒ abort. This is the
   * append-then-bump ordering's second half: the transcript rows are already
   * committed when this runs, so losing HERE leaves the conversation ahead of
   * the cursor, never behind (resume re-derives from the transcript).
   */
  async checkpoint(state: RunLoopState): Promise<void> {
    if (this.lost) throw new LeaseLostError();
    const ok = await writeLoopState(this.runId, this.lease, state);
    if (!ok) throw new LeaseLostError();
  }

  /** Lease-verified transcript append(s) — one atomic transaction. */
  append(...entries: AppendMessageEntry[]): Promise<void> {
    return appendAgentMessages(this.lease, entries);
  }
}

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

async function emitEvent(params: {
  runId: string;
  taskId?: string | null;
  actor?: AgentRoleId | "author";
  kind: AgentEventKind;
  summary: string;
  payload?: Record<string, unknown>;
}) {
  await db.agentEvent.create({
    data: {
      runId: params.runId,
      taskId: params.taskId ?? null,
      actor: params.actor ?? "atlas",
      kind: params.kind,
      summary: params.summary,
      payload: params.payload ? JSON.stringify(params.payload) : null,
    },
  });
}

// ---------------------------------------------------------------------------
// Serialization: DB rows → frozen DTO shapes (agent-types.ts)
// ---------------------------------------------------------------------------

function parseJsonSafe<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface PendingWritePayload {
  pending: true;
  action: "create_chapter" | "update_chapter";
  kind: ApprovalKind;
  taskId: string;
  taskKey: string;
  novelId: string;
  index: number;
  chapterId: string | null;
  title: string;
  targetLabel: string;
  wordCount: number;
  existingWords: number;
  content: string;
  /** Chapter brief (细纲) carried through the approval gate (create path). */
  brief?: string;
}

type AgentRunRow = {
  id: string;
  novelId: string;
  goal: string;
  mode: string;
  status: string;
  modelId: string;
  thinkingLevel: string;
  finalReport: string | null;
  pinnedJson: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function serializeRun(run: AgentRunRow): AgentRun {
  return {
    id: run.id,
    novelId: run.novelId,
    goal: run.goal,
    mode: run.mode as AgentRunMode,
    status: run.status as AgentRunStatus,
    modelId: run.modelId ?? "glm-4.6",
    thinkingLevel: run.thinkingLevel ?? "off",
    finalReport: parseJsonSafe<RunFinalReport | null>(run.finalReport, null),
    pinned: parseJsonSafe<PinnedRef[]>(run.pinnedJson, []),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function serializeTask(t: {
  id: string;
  runId: string;
  key: string;
  parallelGroup: string | null;
  assignee: string;
  title: string;
  detail: string;
  status: string;
  artifactType: string | null;
  artifactId: string | null;
  artifactLabel: string | null;
  order: number;
}): AgentTask {
  return {
    id: t.id,
    runId: t.runId,
    key: t.key,
    parallelGroup: t.parallelGroup,
    assignee: t.assignee as AgentTask["assignee"],
    title: t.title,
    detail: t.detail,
    status: t.status as AgentTask["status"],
    artifactType: (t.artifactType as AgentTask["artifactType"]) ?? null,
    artifactId: t.artifactId,
    artifactLabel: t.artifactLabel,
    order: t.order,
  };
}

function serializeEvent(e: {
  id: string;
  runId: string;
  taskId: string | null;
  actor: string;
  kind: string;
  summary: string;
  payload: string | null;
  createdAt: Date;
}): AgentEvent {
  return {
    id: e.id,
    runId: e.runId,
    taskId: e.taskId,
    actor: e.actor as AgentEvent["actor"],
    kind: e.kind as AgentEventKind,
    summary: e.summary,
    payload: parseJsonSafe<Record<string, unknown> | null>(e.payload, null),
    createdAt: e.createdAt.toISOString(),
  };
}

/** Loads a run and serializes the full detail (events capped to last 300). */
export async function getRunDetail(runId: string): Promise<AgentRunDetail | null> {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    include: {
      tasks: { orderBy: { order: "asc" } },
      events: { orderBy: { createdAt: "desc" }, take: 300 },
    },
  });
  if (!run) return null;

  let pendingApproval: AgentRunDetail["pendingApproval"] = null;
  if (run.status === "awaiting_approval") {
    const pendingEvent = await db.agentEvent.findFirst({
      where: { runId: run.id, kind: "write" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    const payload = parseJsonSafe<PendingWritePayload | null>(pendingEvent?.payload ?? null, null);
    if (payload?.pending) {
      pendingApproval = {
        runId: run.id,
        taskId: payload.taskId,
        kind: payload.kind,
        title: payload.action === "create_chapter" ? "Settle new chapter draft" : "Confirm chapter rewrite",
        summary:
          payload.action === "create_chapter"
            ? `The team drafted a new chapter (~${payload.wordCount.toLocaleString()} words). Approving settles it into the novel as Chapter ${payload.index}; rejecting pauses the run and writes nothing.`
            : `The team rewrote Chapter ${payload.index} (~${payload.wordCount.toLocaleString()} words incoming vs ${payload.existingWords.toLocaleString()} existing). This replaces existing text — approving is permanent.`,
        targetLabel: payload.targetLabel,
        wordCount: payload.wordCount,
      };
    }
  }

  return {
    run: serializeRun(run),
    tasks: run.tasks.map(serializeTask),
    events: run.events.reverse().map(serializeEvent),
    pendingApproval,
  };
}

// ---------------------------------------------------------------------------
// Run lifecycle queries
// ---------------------------------------------------------------------------

export async function activeRunFor(novelId: string): Promise<AgentRunDetail | null> {
  const run = await db.agentRun.findFirst({
    where: { novelId, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  return run ? getRunDetail(run.id) : null;
}

/**
 * Latest run of ANY status for the novel — the conversation pane's history
 * fallback so finished transcripts survive a reload (plan §4.1: the pane is
 * the author's window into the team; history lives in AgentEvent, the pane
 * just never loaded it before Phase 6).
 */
export async function latestRunFor(novelId: string): Promise<AgentRunDetail | null> {
  const run = await db.agentRun.findFirst({
    where: { novelId },
    orderBy: { createdAt: "desc" },
  });
  return run ? getRunDetail(run.id) : null;
}

export async function listRuns(novelId: string, take = 20): Promise<AgentRun[]> {
  const runs = await db.agentRun.findMany({
    where: { novelId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return runs.map(serializeRun);
}

export async function createRun(params: {
  novelId: string;
  goal: string;
  mode: AgentRunMode;
  pinned?: PinnedRef[];
  /** P2 — client-supplied model registry selection (validated below). */
  modelId?: string;
  thinkingLevel?: string;
}): Promise<AgentRunDetail> {
  const novel = await db.novel.findUnique({ where: { id: params.novelId }, select: { id: true } });
  if (!novel) throw new NotFoundError("Novel not found");

  // P2 — validate the model selection against the registry BEFORE anything
  // is persisted; bad combos are a 400, not a half-created run.
  let model: RunModel;
  try {
    model = resolveModelSelection(params.modelId, params.thinkingLevel);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid model selection");
  }

  const active = await db.agentRun.findFirst({
    where: { novelId: params.novelId, status: { in: ACTIVE_STATUSES } },
    select: { id: true },
  });
  if (active) {
    throw new ConflictError("This novel already has an active run. Cancel or finish it first.");
  }

  const pinned = (params.pinned ?? []).slice(0, 12);
  const run = await db.agentRun.create({
    data: {
      novelId: params.novelId,
      goal: params.goal,
      mode: params.mode,
      status: "running",
      modelId: model.selection.modelId,
      thinkingLevel: model.selection.thinkingLevel,
      pinnedJson: pinned.length > 0 ? JSON.stringify(pinned) : null,
    },
  });
  await emitEvent({
    runId: run.id,
    kind: "message",
    summary: `Leader received the goal: “${truncate(params.goal, 200)}”${
      pinned.length > 0 ? ` — ${pinned.length} pinned context ref(s) attached` : ""
    }`,
  });
  const detail = await getRunDetail(run.id);
  if (!detail) throw new Error("Run vanished right after creation");
  return detail;
}

// ---------------------------------------------------------------------------
// Pinned context (Phase 8 — Pin-to-Chat). The runtime RESOLVES each pinned
// ref against the DB — client labels are display-only, client content is
// never trusted. Missing/deleted refs are skipped with a note.
// ---------------------------------------------------------------------------

const PINNED_CHAR_CAP = 6000;

async function buildPinnedContext(
  novelId: string,
  refs: PinnedRef[]
): Promise<string | null> {
  if (refs.length === 0) return null;
  const blocks: string[] = [];
  const skipped: string[] = [];

  for (const ref of refs) {
    const cap = (text: string) => truncate(text, PINNED_CHAR_CAP);
    try {
      if (ref.type === "chapter") {
        const ch = await db.chapter.findFirst({ where: { id: ref.id, novelId } });
        if (ch) {
          blocks.push(
            `[PINNED CHAPTER] 第${ch.index}章 ${ch.title} (status: ${ch.status}, ${ch.wordCount} words)\n${cap(ch.content)}`
          );
        } else skipped.push(ref.label);
      } else if (ref.type === "character") {
        const c = await db.character.findFirst({ where: { id: ref.id, novelId } });
        if (c) {
          blocks.push(
            `[PINNED CHARACTER] ${c.name} (${c.role || "role unspecified"})\n${cap(c.description)}`
          );
        } else skipped.push(ref.label);
      } else if (ref.type === "world_entry") {
        const w = await db.worldEntry.findFirst({ where: { id: ref.id, novelId } });
        if (w) {
          blocks.push(`[PINNED WORLD RULE] ${w.title} (${w.category})\n${cap(w.content)}`);
        } else skipped.push(ref.label);
      } else if (ref.type === "outline_beat") {
        const b = await db.outlineBeat.findFirst({ where: { id: ref.id, novelId } });
        if (b) {
          blocks.push(`[PINNED OUTLINE BEAT] #${b.index} ${b.title}\n${cap(b.summary)}`);
        } else skipped.push(ref.label);
      } else if (ref.type === "volume") {
        const v = await db.volume.findFirst({ where: { id: ref.id, novelId } });
        if (v) {
          blocks.push(`[PINNED VOLUME PLAN] 卷${String(v.index).padStart(2, "0")} ${v.title}\n${cap(v.synopsis)}`);
        } else skipped.push(ref.label);
      } else if (ref.type === "pack") {
        const p = await db.chapterPack.findFirst({ where: { id: ref.id, novelId } });
        if (p) {
          blocks.push(
            `[PINNED ${p.kind === "prep" ? "PREP PACK" : "MATERIAL PACK"}] 第${p.chapterIndex}章 ${p.title}\n${cap(p.content)}`
          );
        } else skipped.push(ref.label);
      } else if (ref.type === "contract") {
        const c = await db.novelContract.findUnique({ where: { novelId } });
        if (c?.content) {
          blocks.push(`[PINNED STORY CONTRACT 作品契约]\n${cap(c.content)}`);
        } else skipped.push(ref.label);
      } else if (ref.type === "concept") {
        const n = await db.novel.findUnique({ where: { id: novelId }, select: { conceptSnapshot: true } });
        if (n?.conceptSnapshot) {
          blocks.push(`[PINNED CONCEPT SNAPSHOT 构想快照]\n${cap(n.conceptSnapshot)}`);
        } else skipped.push(ref.label);
      } else if (ref.type === "digest") {
        const d = await db.chapterDigest.findFirst({ where: { chapterId: ref.id, novelId } });
        if (d) {
          blocks.push(`[PINNED CHAPTER DIGEST 章摘要]\n${cap(d.summary)}`);
        } else skipped.push(ref.label);
      } else {
        skipped.push(ref.label);
      }
    } catch {
      skipped.push(ref.label);
    }
  }

  if (blocks.length === 0) return null;
  const lines = [
    "PINNED CONTEXT (the author explicitly attached these — treat them as authoritative material for this run):",
    ...blocks.map((b) => `---\n${b}`),
  ];
  if (skipped.length > 0) {
    lines.push(`(unresolved pins skipped: ${skipped.join(", ")})`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Custom errors → HTTP mapping
// ---------------------------------------------------------------------------

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class ValidationError extends Error {}

export function errorStatus(error: unknown): { message: string; status: number } {
  if (error instanceof NotFoundError) return { message: error.message, status: 404 };
  if (error instanceof ConflictError) return { message: error.message, status: 409 };
  if (error instanceof ValidationError) return { message: error.message, status: 400 };
  const message = error instanceof Error ? error.message : "Unknown error";
  return { message, status: 500 };
}

// ---------------------------------------------------------------------------
// P2 — resolved run model + Context Usage meter plumbing.
// Every GLM call of a run goes through a conversation-scoped meter; each call
// snapshots it (what THAT call sent) and emits a `usage` event. The SSE
// stream carries events to the composer's Context Usage panel in real time.
// ---------------------------------------------------------------------------

type RunModel = ReturnType<typeof resolveModelSelection>;

/**
 * Run-row → resolved model. Defensive: a stored run whose model the registry
 * no longer offers falls back to the registry default instead of failing a
 * resumed run (creation-time validation already guarantees fresh runs are
 * valid).
 */
function resolveRunModel(modelId: string | null, thinkingLevel: string | null): RunModel {
  try {
    return resolveModelSelection(modelId, thinkingLevel);
  } catch {
    return resolveModelSelection(null, null);
  }
}

/** Fire-and-forget — a telemetry failure must never break the run. */
function emitUsageEvent(
  runId: string,
  meter: ContextMeter,
  actor: string,
  real: RealUsage | null,
): void {
  // P4 — the provider's billed prompt_tokens anchors the total (T4); the
  // section split stays the meter's estimate scaled to it. `real` also
  // carries THIS call's completion tokens (T3) so the panel's run total
  // covers output side too — the last reply never falls out of the books.
  const usage = reconcileUsageWithReal(meter.snapshot(actor), real);
  void emitEvent({
    runId,
    kind: "usage",
    summary: `Context usage (${actor}): ${formatUsageSummary(usage)}`,
    payload: { usage },
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Mutations used by the API routes
// ---------------------------------------------------------------------------

export async function decideApproval(
  runId: string,
  taskId: string,
  decision: "approve" | "reject"
): Promise<AgentRunDetail> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError("Run not found");
  if (run.status !== "awaiting_approval") {
    throw new ConflictError("This run is not waiting for approval");
  }

  const pendingEvent = await db.agentEvent.findFirst({
    where: { runId, kind: "write" },
    orderBy: { createdAt: "desc" },
  });
  const payload = parseJsonSafe<PendingWritePayload | null>(pendingEvent?.payload ?? null, null);
  if (!payload?.pending || payload.taskId !== taskId) {
    throw new ConflictError("No pending write matches this approval request");
  }

  if (decision === "approve") {
    // The gate is the last defense — re-run the overwrite verdict at commit
    // time (state may have changed while the gate was open).
    if (payload.action === "create_chapter") {
      const last = await db.chapter.findFirst({
        where: { novelId: payload.novelId },
        orderBy: { index: "desc" },
        select: { index: true },
      });
      const index = (last?.index ?? 0) + 1;
      // Phase 7 — persist the delegating task's brief as the chapter brief.
      const taskRow = await db.agentTask.findUnique({
        where: { id: taskId },
        select: { detail: true },
      });
      const brief = (taskRow?.detail ?? "").trim().slice(0, 8000);
      const chapter = await db.chapter.create({
        data: {
          novelId: payload.novelId,
          index,
          title: payload.title,
          content: payload.content,
          wordCount: countWords(payload.content),
          status: "draft",
          brief,
        },
      });
      await recordChapterVersion({
        chapterId: chapter.id,
        novelId: payload.novelId,
        content: payload.content,
        createdBy: "agent",
      });
      await db.novel.update({ where: { id: payload.novelId }, data: { updatedAt: new Date() } });
      await emitEvent({
        runId,
        taskId,
        kind: "approval",
        summary: `Approved by author — settled as Chapter ${index} (${countWords(payload.content).toLocaleString()} words, verified).`,
        payload: { committed: true, chapterId: chapter.id, index, words: chapter.wordCount, op: "create_chapter", title: payload.title },
      });
    } else if (payload.chapterId) {
      const existing = await db.chapter.findUnique({
        where: { id: payload.chapterId },
        select: { status: true, index: true },
      });
      // Final lock edge case — the chapter was finalized between gate open
      // and approval. Refuse the commit honestly instead of overwriting 定稿.
      if (existing?.status === "final") {
        await emitEvent({
          runId,
          taskId,
          kind: "error",
          summary: `Commit refused — Chapter ${existing.index} became final while this write was pending. Reopen it in the workbench, then re-run the task.`,
        });
        await db.agentTask.update({ where: { id: taskId }, data: { status: "blocked" } });
        await db.agentRun.update({ where: { id: runId }, data: { status: "paused" } });
        const blocked = await getRunDetail(runId);
        if (!blocked) throw new NotFoundError("Run not found");
        return blocked;
      }
      const chapter = await db.chapter.update({
        where: { id: payload.chapterId },
        data: { content: payload.content, wordCount: countWords(payload.content) },
      });
      await recordChapterVersion({
        chapterId: chapter.id,
        novelId: chapter.novelId,
        content: payload.content,
        createdBy: "agent",
      });
      await db.novel.update({ where: { id: payload.novelId }, data: { updatedAt: new Date() } });
      await emitEvent({
        runId,
        taskId,
        kind: "approval",
        summary: `Approved by author — Chapter ${chapter.index} replaced (${chapter.wordCount.toLocaleString()} words, verified).`,
        payload: { committed: true, chapterId: chapter.id, index: chapter.index, words: chapter.wordCount, op: "update_chapter", existingWords: payload.existingWords },
      });
    }
    await db.agentTask.update({ where: { id: taskId }, data: { status: "done" } });
    await db.agentRun.update({ where: { id: runId }, data: { status: "running", error: null } });
  } else {
    await db.agentTask.update({ where: { id: taskId }, data: { status: "blocked" } });
    await db.agentRun.update({ where: { id: runId }, data: { status: "paused" } });
    await emitEvent({
      runId,
      taskId,
      kind: "message",
      summary: "Paused by author — nothing was written. You can cancel the run or start a new one.",
    });
  }

  const detail = await getRunDetail(runId);
  if (!detail) throw new NotFoundError("Run not found");
  return detail;
}

export async function cancelRun(runId: string): Promise<AgentRunDetail> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError("Run not found");
  if (!ACTIVE_STATUSES.includes(run.status as AgentRunStatus)) {
    throw new ConflictError("This run is already finished");
  }

  const localExecutor = executors.get(runId);
  localExecutor?.controller.abort();
  await db.agentTask.updateMany({
    where: { runId, status: { in: ["in_progress", "needs_approval"] } },
    data: { status: "blocked" },
  });
  await db.agentRun.update({ where: { id: runId }, data: { status: "cancelled" } });
  // Dangling-lease cleanup (Stage C): with no in-process executor there is no
  // finally-block to run releaseLease — a crashed executor's lease would
  // linger alive-looking on this now-terminal run indefinitely (healStaleRuns
  // only scans active runs; resume 409s on terminal status before the lease
  // check). Cancel owns the terminal flip, so it also owns clearing the
  // orphaned lease columns. When a live executor DOES exist, its own finally
  // releases promptly (run #2: 439ms after the cancel event) — touching the
  // lease here would only race its in-flight fenced appends.
  if (!localExecutor) {
    await db.agentRun.updateMany({ where: { id: runId }, data: { leaseOwner: null } });
  }
  await emitEvent({ runId, kind: "message", summary: "Run cancelled by author. Unsettled drafts were discarded." });

  const detail = await getRunDetail(runId);
  if (!detail) throw new NotFoundError("Run not found");
  return detail;
}

export async function setRunMode(runId: string, mode: AgentRunMode): Promise<AgentRunDetail> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError("Run not found");
  if (!ACTIVE_STATUSES.includes(run.status as AgentRunStatus)) {
    throw new ConflictError("This run is already finished");
  }
  await db.agentRun.update({ where: { id: runId }, data: { mode } });
  await emitEvent({
    runId,
    kind: "message",
    summary:
      mode === "full_access"
        ? "Switched to full access — remaining gates will auto-approve (irreversible overwrites still pause)."
        : "Switched to approval mode — remaining gates will wait for you.",
  });
  const detail = await getRunDetail(runId);
  if (!detail) throw new NotFoundError("Run not found");
  return detail;
}

/** Marks abandoned active runs as failed (process restart / stall). */
export async function healStaleRuns(): Promise<void> {
  const budgets = getBudgets();
  const staleBefore = new Date(Date.now() - budgets.sse.staleRunMs);
  const active = await db.agentRun.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    select: { id: true },
  });
  for (const run of active) {
    // Phase 1 — DUAL CONDITION. A run with a LIVE lease is alive by
    // definition: the executor heartbeats through quiet gate waits and
    // provider retries, so event-age alone must never heal it (the old
    // event-age-only check failed runs that were simply waiting at a gate).
    if (await leaseIsAlive(run.id)) continue;
    const last = await db.agentEvent.findFirst({
      where: { runId: run.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const reference = last?.createdAt;
    if (!reference || reference < staleBefore) {
      await db.agentTask.updateMany({
        where: { runId: run.id, status: { in: ["in_progress", "needs_approval"] } },
        data: { status: "failed" },
      });
      await db.agentRun.update({
        where: { id: run.id },
        data: { status: "failed", error: "Runtime restarted or the run stalled — healed to failed." },
      });
      await emitEvent({
        runId: run.id,
        kind: "error",
        summary: "Run marked failed by heal check: no activity within the stale window.",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

interface Measured {
  chaptersWritten: number;
  chaptersUpdated: number;
  outlineBeatsUpdated: number;
  words: number;
  // Phase 5 audited counters (Prism / Forge work).
  reviewsRun: number;
  blockingFound: number;
  exportsRun: number;
  // Phase 6 audited counters (E2 gate outcomes).
  chaptersFinalized: number;
  settlesRun: number;
}

const ZERO_MEASURED: Measured = {
  chaptersWritten: 0,
  chaptersUpdated: 0,
  outlineBeatsUpdated: 0,
  words: 0,
  reviewsRun: 0,
  blockingFound: 0,
  exportsRun: 0,
  chaptersFinalized: 0,
  settlesRun: 0,
};

// ---------------------------------------------------------------------------
// Phase 1 — DB-derived state. In-memory counters die with the executor; the
// persisted event stream (with its Phase 1 payload additions) is what makes
// resume and the deterministic wrap-up reconciliation possible.
// ---------------------------------------------------------------------------

/**
 * Rebuild the audited counters from the PERSISTED event stream. Used by the
 * resume path (in-memory `measured` died with the crash) and by the
 * deterministic wrap-up reconciliation. Requires the Phase 1 payload
 * additions (op on write/approval events, issues/blocking on review events);
 * legacy events without `op` contribute nothing — they predate resume.
 * Every increment site in the runtime emits its event AFTER the DB commit,
 * so each matching event is evidence of exactly one verified effect.
 */
export async function deriveMeasuredFromEvents(runId: string): Promise<Measured> {
  const events = await db.agentEvent.findMany({
    where: { runId },
    orderBy: { createdAt: "asc" },
    select: { kind: true, payload: true },
  });
  const measured: Measured = { ...ZERO_MEASURED };
  const finalized = new Set<string>();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  for (const event of events) {
    const payload = parseJsonSafe<Record<string, unknown> | null>(event.payload, null);
    if (!payload) continue;
    if (event.kind === "write" && payload.pending !== true) {
      switch (payload.op) {
        case "create_chapter":
          measured.chaptersWritten += 1;
          measured.words += num(payload.words);
          break;
        case "update_chapter":
          measured.chaptersUpdated += 1;
          measured.words += Math.max(0, num(payload.words) - num(payload.existingWords));
          break;
        case "finalize_chapter":
          if (typeof payload.chapterId === "string" && !finalized.has(payload.chapterId)) {
            finalized.add(payload.chapterId);
            measured.chaptersFinalized += 1;
          }
          break;
        case "settle_chapter":
          measured.settlesRun += 1;
          break;
        case "update_outline_beat":
          measured.outlineBeatsUpdated += 1;
          break;
      }
    } else if (event.kind === "approval" && payload.committed === true) {
      // Gate-approved commits (decideApproval) — the poll-side measured
      // increments died with the executor; the approval event is the record.
      if (payload.op === "create_chapter") {
        measured.chaptersWritten += 1;
        measured.words += num(payload.words);
      } else if (payload.op === "update_chapter") {
        measured.chaptersUpdated += 1;
        measured.words += Math.max(0, num(payload.words) - num(payload.existingWords));
      }
    } else if (event.kind === "message" && payload.op === "review_chapter") {
      measured.reviewsRun += 1;
      measured.blockingFound += num(payload.blocking);
    }
  }
  return measured;
}

/**
 * Rebuild the QC ledger on resume: the review half from the latest persisted
 * ChapterReview per chapter (the same data the E2 gates read), the repair
 * half from the last fenced checkpoint.
 */
async function deriveQcLedger(novelId: string, repairs: Record<string, number>): Promise<QcLedger> {
  const qc = newQcLedger();
  const chapters = await db.chapter.findMany({
    where: { novelId },
    select: { id: true, index: true },
  });
  for (const chapter of chapters) {
    const latest = await db.chapterReview.findFirst({
      where: { chapterId: chapter.id },
      orderBy: { createdAt: "desc" },
      select: { blockingCount: true },
    });
    if (latest) qc.lastBlocking.set(chapter.index, latest.blockingCount);
  }
  for (const [key, value] of Object.entries(repairs)) {
    qc.repairs.set(Number(key), value);
  }
  return qc;
}

/**
 * Phase 1 create-probe — the interruption shapes that would otherwise
 * duplicate a chapter row on re-dispatch:
 *   1. commit landed, feedback lost: a chapter with the SAME title AND
 *      content already exists (the natural key the approval-commit path uses
 *      at the gate);
 *   2. the leader re-delegated an interrupted task and the member regenerated
 *      different prose for the same intended chapter: this run's event stream
 *      already recorded a create_chapter commit for the same title.
 *   3. commit landed inside the commit→event window (Stage C E2E live proof:
 *      a SIGKILL landed 5ms after db.chapter.create and BEFORE emitEvent —
 *      the row exists, the event stream has no create_chapter record): a
 *      chapter with the intended title created AFTER this run started. The
 *      row itself is the commit evidence. Callers must emit the missing
 *      reconciliation event (reconcileEvent: true) so event-derived counters
 *      keep DB parity; shapes 1-2 adopt silently (their event already
 *      exists, or shape 1 matched identical content).
 * Returns the chapter to adopt (plus whether the event stream needs
 * reconciliation), or null when the write is genuinely new.
 */
async function findAdoptableChapter(
  runId: string,
  novelId: string,
  title: string,
  prose: string
): Promise<{ id: string; index: number; wordCount: number; reconcileEvent: boolean } | null> {
  const exact = await db.chapter.findFirst({
    where: { novelId, title, content: prose },
    select: { id: true, index: true, wordCount: true },
  });
  if (exact) return { ...exact, reconcileEvent: false };
  const events = await db.agentEvent.findMany({
    where: { runId, kind: { in: ["write", "approval"] } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { payload: true },
  });
  for (const event of events) {
    const payload = parseJsonSafe<Record<string, unknown> | null>(event.payload, null);
    if (!payload || payload.pending === true) continue;
    if (payload.op !== "create_chapter") continue;
    if (payload.title === title && typeof payload.chapterId === "string") {
      const chapter = await db.chapter.findUnique({
        where: { id: payload.chapterId },
        select: { id: true, index: true, wordCount: true },
      });
      if (chapter) return { ...chapter, reconcileEvent: false };
    }
  }
  const runStart = await db.agentRun.findUnique({
    where: { id: runId },
    select: { createdAt: true },
  });
  if (runStart) {
    const sameTitleThisRun = await db.chapter.findFirst({
      where: { novelId, title, createdAt: { gte: runStart.createdAt } },
      orderBy: { createdAt: "desc" },
      select: { id: true, index: true, wordCount: true },
    });
    if (sameTitleThisRun) return { ...sameTitleThisRun, reconcileEvent: true };
  }
  return null;
}

/**
 * Stage C — resume-path event reconciliation (ZERO-GLM, deterministic).
 * A crash inside the commit→event window (db.chapter.create landed,
 * emitEvent never ran — Stage C E2E run cmw37k70w…: SIGKILL landed 5ms
 * after the commit) leaves a committed chapter with NO create_chapter
 * event, so event-derived counters undercount it forever — even when the
 * resume-side probe or the leader's own DB-aware re-planning avoids the
 * duplicate row. On resume, BEFORE measured is derived, re-emit the
 * missing create event for any chapter this run committed. All three
 * discriminators are required:
 *   - created after the run started (createdAt >= run.createdAt);
 *   - carries an agent-authored ChapterVersion (author-UI creates record
 *     none, so author writes mid-run are never misattributed);
 *   - no non-pending create_chapter event for its id in this run's stream.
 * Idempotent: once emitted, later resumes skip it (event check) and the
 * member-side create-probe shape 2 then adopts silently — never double-counts.
 * Scope note: the update_chapter commit→event window is the same class of
 * hole but requires version-row↔event diffing (multiple updates per
 * chapter); it stays in the risk register, not here.
 */
async function reconcileMissingCreateEvents(runId: string, novelId: string): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId }, select: { createdAt: true } });
  if (!run) return;
  const events = await db.agentEvent.findMany({
    where: { runId, kind: { in: ["write", "approval"] } },
    select: { payload: true },
  });
  const eventedChapterIds = new Set<string>();
  for (const e of events) {
    const payload = parseJsonSafe<Record<string, unknown> | null>(e.payload, null);
    if (!payload || payload.pending === true) continue;
    if (payload.op === "create_chapter" && typeof payload.chapterId === "string") {
      eventedChapterIds.add(payload.chapterId);
    }
  }
  const candidates = await db.chapter.findMany({
    where: { novelId, createdAt: { gte: run.createdAt } },
    select: { id: true, index: true, title: true, wordCount: true },
  });
  for (const ch of candidates) {
    if (eventedChapterIds.has(ch.id)) continue;
    const agentVersion = await db.chapterVersion.findFirst({
      where: { chapterId: ch.id, createdBy: "agent" },
      select: { id: true },
    });
    if (!agentVersion) continue;
    await emitEvent({
      runId,
      kind: "write",
      summary: `Created Chapter ${ch.index} "${truncate(ch.title, 80)}" — ${ch.wordCount.toLocaleString()} words (verified in DB; reconciled on resume — the commit landed but its create event was lost in the crash window).`,
      payload: { artifact: "chapter", chapterId: ch.id, index: ch.index, words: ch.wordCount, op: "create_chapter", title: ch.title, reconciled: true },
    });
  }
}

/**
 * Phase 1 — deterministic, ZERO-GLM end-of-run reconciliation for a run whose
 * single budgeted wrap-up turn was already granted and then interrupted
 * (turnsUsed >= leaderMaxTurns && wrapUpGranted). Builds the final report
 * from persisted state ONLY — AgentTask statuses + event-derived measured
 * counters + the latest ChapterReview per chapter — closes the run (completed,
 * or failed when tasks were still in_progress), and emits the closing event.
 * Caller must hold the executor lease (claimed by the resume route).
 */
export async function reconcileWrapUpFromDb(runId: string): Promise<{
  status: AgentRunStatus;
  report: RunFinalReport;
}> {
  const measured = await deriveMeasuredFromEvents(runId);
  const tasks = await db.agentTask.findMany({ where: { runId }, orderBy: { order: "asc" } });
  const run = await db.agentRun.findUniqueOrThrow({
    where: { id: runId },
    select: { novelId: true },
  });

  const stillRunning = tasks.filter((t) => t.status === "in_progress");
  if (stillRunning.length > 0) {
    await db.agentTask.updateMany({
      where: { id: { in: stillRunning.map((t) => t.id) } },
      data: { status: "failed" },
    });
    await emitEvent({
      runId,
      kind: "error",
      summary: `Wrap-up reconciliation: ${stillRunning.map((t) => t.key).join(", ")} were still in_progress when the executor was lost — marked failed.`,
    });
  }

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const issues: string[] = [];
  if (stillRunning.length > 0) {
    issues.push(
      `${stillRunning.length} task(s) were still in_progress when the executor was lost and are marked failed: ${stillRunning.map((t) => t.key).join(", ")}`
    );
  }
  const blockedCount = tasks.filter((t) => t.status === "blocked").length;
  if (blockedCount > 0) issues.push(`${blockedCount} task(s) ended blocked.`);

  // Latest ChapterReview per chapter — unresolved blocking findings surface in
  // the report even though the in-memory QC ledger died with the crash.
  const chapters = await db.chapter.findMany({
    where: { novelId: run.novelId },
    select: { id: true, index: true, title: true },
  });
  for (const chapter of chapters) {
    const latest = await db.chapterReview.findFirst({
      where: { chapterId: chapter.id },
      orderBy: { createdAt: "desc" },
      select: { blockingCount: true },
    });
    if (latest && latest.blockingCount > 0) {
      issues.push(
        `Chapter ${chapter.index} ("${truncate(chapter.title, 40)}") latest review has ${latest.blockingCount} blocking issue(s) unresolved.`
      );
    }
  }

  const summaryBits: string[] = [`${doneCount}/${tasks.length} tasks done across the team.`];
  if (measured.chaptersWritten > 0 || measured.chaptersUpdated > 0) {
    summaryBits.push(
      `Chapters: ${measured.chaptersWritten} created, ${measured.chaptersUpdated} updated · ${measured.words.toLocaleString()} words written (measured).`
    );
  }
  if (measured.reviewsRun > 0) {
    summaryBits.push(`Reviews: ${measured.reviewsRun} run, ${measured.blockingFound} blocking found.`);
  }
  if (measured.chaptersFinalized > 0 || measured.settlesRun > 0) {
    summaryBits.push(
      `E2 gates: ${measured.chaptersFinalized} finalized, ${measured.settlesRun} settled (code-verified).`
    );
  }
  summaryBits.push(
    "Run closed by deterministic wrap-up reconciliation after the executor was lost post-wrap-up (no further model turns were available; nothing was re-run and nothing was auto-committed)."
  );

  const report: RunFinalReport = {
    summary: summaryBits.join(" "),
    reported: { ...snapshotOf(measured) },
    verified: snapshotOf(measured),
    blockingIssues: issues.slice(0, 12),
  };
  const status: AgentRunStatus = stillRunning.length > 0 ? "failed" : "completed";
  await db.agentRun.update({
    where: { id: runId },
    data: { status, finalReport: JSON.stringify(report), error: null },
  });
  await emitEvent({
    runId,
    kind: "message",
    actor: "atlas",
    summary: `Run ${status} — closed by deterministic wrap-up reconciliation: ${report.summary}`,
  });
  return { status, report };
}

/**
 * OPS-4 (P5-e.1) — guarded exit flip for a dying executor's REAL error.
 *
 * The finally-block in executeRun ALWAYS releases the executor's own lease
 * before the catch runs, so a pure owner/epoch-fenced flip matched zero rows
 * on every real error (root cause of the stuck-at-running shape) and the
 * message was swallowed to console only. This seam preserves the fencing
 * contract in both directions:
 *   (1) still-owner flip — if releaseLease itself failed, the executor still
 *       holds the lease; the owner/epoch CAS is the strongest claim and may
 *       write directly.
 *   (2) released flip — if nobody holds the lease (leaseIsAlive false), a
 *       second CAS on (running|awaiting_approval + leaseOwner: null) writes
 *       the failure. A LIVE lease ⇒ stay silent: the holder owns the row.
 *   An evicted executor can therefore NEVER write terminal state over a live
 *   lease; a claimant that raced in between the aliveness check and the write
 *   loses the CAS and the dying executor stays silent. Author-owned rows
 *   (paused) and terminal rows are never clobbered. Fail-closed: an
 *   unverifiable aliveness check (DB hiccup) stays silent.
 *
 * Returns true only when THIS call wrote the flip (and emitted the event —
 * the executor's real cause lands in the event stream, never console-only).
 * Exported for the P5-e.1 harness: the harness drives this exact production
 * path, not a copy.
 */
export async function guardedFailureFlip(
  runId: string,
  lease: ExecutorLease | null,
  message: string
): Promise<boolean> {
  const run = await db.agentRun
    .findUnique({ where: { id: runId }, select: { status: true } })
    .catch(() => null);
  if (!run || TERMINAL_STATUSES.includes(run.status as AgentRunStatus)) return false;
  const fenced = lease
    ? await db.agentRun
        .updateMany({
          where: { id: runId, leaseOwner: lease.owner, leaseEpoch: lease.epoch },
          data: { status: "failed", error: message },
        })
        .catch(() => ({ count: 0 }))
    : { count: 0 };
  let flipped = fenced.count === 1;
  if (!flipped) {
    const alive = await leaseIsAlive(runId).catch(() => true);
    if (!alive) {
      const guarded = await db.agentRun
        .updateMany({
          where: {
            id: runId,
            status: { in: ["running", "awaiting_approval"] as AgentRunStatus[] },
            leaseOwner: null,
          },
          data: { status: "failed", error: message },
        })
        .catch(() => ({ count: 0 }));
      flipped = guarded.count === 1;
    }
  }
  if (flipped) {
    await emitEvent({ runId, kind: "error", summary: `Run failed: ${truncate(message, 300)}` });
    return true;
  }
  console.error(
    `[agent-runtime] run ${runId}: failure flip skipped — a live executor holds the run or the row moved on; the holder owns the row`
  );
  return false;
}

/**
 * Entry point — called from the route handlers. Idempotent per process.
 *
 * Phase 1 lease lifecycle: claim (CAS on unowned/stale + epoch increment) →
 * heartbeat interval → run loop under the guard → release. A resume can pass
 * a pre-claimed lease (the resume route claims synchronously so a live lease
 * 409s before anything else happens).
 */
export async function executeRun(
  runId: string,
  opts?: { resume?: boolean; lease?: ExecutorLease }
): Promise<void> {
  if (executors.has(runId)) {
    // Duplicate kick — a caller-supplied lease must not leak un-released.
    if (opts?.lease) await releaseLease(runId, opts.lease);
    return;
  }
  const controller = new AbortController();
  executors.set(runId, { controller });
  let lease: ExecutorLease | null = opts?.lease ?? null;
  try {
    if (!lease) {
      lease = await claimLease(runId);
      if (!lease) {
        throw new ConflictError("This run's executor lease is held by a live executor.");
      }
    }
    const held = lease;
    const guard = new LeaseGuard(runId, held);
    // Heartbeat — renewed every LEASE_RENEW_MS so gate waits and provider
    // retries never look dead. A rejected renewal (count === 0) means the
    // epoch moved: flip the guard, the next fenced touch aborts the loop.
    const heartbeat = setInterval(() => {
      void renewLease(runId, held).then(
        (ok) => {
          if (!ok) {
            guard.lost = true;
            console.error(
              `[agent-runtime] run ${runId}: lease renewal rejected (count=0) — fencing detected`
            );
          }
        },
        () => {
          guard.lost = true;
        }
      );
    }, LEASE_RENEW_MS);
    try {
      await runLoop(runId, controller.signal, guard, opts?.resume === true);
    } finally {
      clearInterval(heartbeat);
      await releaseLease(runId, held);
    }
  } catch (error) {
    if (error instanceof LeaseLostError) {
      // Fencing in action — a rejected fenced write (count === 0) or a failed
      // ownership check means another executor owns this run now. Abort with
      // ZERO further DB writes; never mark somebody else's run failed.
      console.error(
        `[agent-runtime] run ${runId}: lease lost — fenced write returned count=0, executor aborting without further DB writes`
      );
      return;
    }
    // OPS-4 (P5-e.1): the dying executor's REAL error goes through the guarded
    // exit flip — terminal state is written only when the fencing contract
    // allows it, and the cause lands in the AgentEvent stream, never
    // console-only. See guardedFailureFlip for the contract.
    const message = error instanceof Error ? error.message : "Unknown runtime error";
    await guardedFailureFlip(runId, lease, message);
  } finally {
    executors.delete(runId);
  }
}

async function runLoop(
  runId: string,
  signal: AbortSignal,
  guard: LeaseGuard,
  isResume: boolean
): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) return;
  // Cancel-vs-resume race guard: the resume route checks run status BEFORE
  // claiming the lease; a cancel landing between that check and the claim
  // must not start an executor on a terminal run. (executeRun's finally
  // releases the just-claimed lease on this early return.)
  if (TERMINAL_STATUSES.includes(run.status as AgentRunStatus)) return;

  // Abort from a previous process instance (e.g. after hot reload) is not our
  // signal; only honor fresh cancels from here on.
  const freshController = new AbortController();
  const onAbort = () => freshController.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    await leaderLoop(runId, run.goal, freshController.signal, guard, isResume);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------------------
// Per-role tool surfaces (Phase 5 §8 / Phase 6 §QC) — a role asking for a
// tool it does not own gets an error feed. Writes are sage-only; prism owns
// the E2 gate pair (finalize/settle — CODE-gated on the persisted review);
// atlas/nova/forge are readers with role-specific extras. `finish` is always
// allowed.
// ---------------------------------------------------------------------------

const READ_ACTIONS = new Set([
  "read_novel",
  "read_chapter",
  "read_outline",
  "read_foreshadows",
  "memory_query",
]);

const MEMBER_TOOLS: Record<AgentRoleId, string[]> = {
  atlas: [...READ_ACTIONS, "doctor_scan"],
  sage: [...READ_ACTIONS, "doctor_scan", "create_chapter", "update_chapter", "update_outline_beat", "finish"],
  nova: [...READ_ACTIONS],
  prism: [...READ_ACTIONS, "doctor_scan", "review_chapter", "finalize_chapter", "settle_chapter", "finish"],
  forge: [...READ_ACTIONS, "doctor_scan", "export_markdown", "finish"],
};

function toolAllowedFor(actor: AgentRoleId, action: string): boolean {
  return MEMBER_TOOLS[actor]?.includes(action) ?? false;
}

// ---------------------------------------------------------------------------
// QC ledger (Phase 6) — run-scoped, per-chapter revision state. Feeds the
// E2 gates: latest blocking count drives finalize/settle/repair decisions;
// repairRounds enforces the ≤2 revision cycles per chapter (budgets.qc).
// ---------------------------------------------------------------------------

interface QcLedger {
  /** chapter index → blocking count of the latest persisted review (run view). */
  lastBlocking: Map<number, number>;
  /** chapter index → repair writes committed while blocking was open. */
  repairs: Map<number, number>;
}

function newQcLedger(): QcLedger {
  return { lastBlocking: new Map(), repairs: new Map() };
}

// ---------------------------------------------------------------------------
// Leader loop (Atlas, Phase 5): snapshot → bounded turn loop of reads +
// ```team-delegate work orders → CODE executes each order with its member →
// verified outcomes fed back → final report.
// ---------------------------------------------------------------------------

async function leaderLoop(
  runId: string,
  goal: string,
  signal: AbortSignal,
  guard: LeaseGuard,
  isResume: boolean
): Promise<void> {
  const budgets = getBudgets();
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const novelId = run.novelId;
  // P2 — resolve the run's registry selection once; every GLM call of the
  // run (leader + members) goes out with these exact params.
  const modelCtx = resolveRunModel(run.modelId, run.thinkingLevel);

  const snapshot = await loadStorySnapshot(novelId);
  if (!isResume) {
    await emitEvent({ runId, kind: "message", summary: "Atlas is reading the story state and assembling the team…" });
  }

  // Phase 8 — resolve the author's pinned refs against the DB. When a
  // chapter is pinned, run a deterministic read-only impact assessment
  // BEFORE the leader loop so the plan is grounded in an impact report
  // (user flow step 5: check what the change would affect).
  const pinnedRefs = parseJsonSafe<PinnedRef[]>(run.pinnedJson, []);
  const pinnedContext = await buildPinnedContext(novelId, pinnedRefs);

  // ---- Phase 1 restore: checkpoint + canonical transcript -----------------
  // Scalar state comes from the last fenced checkpoint; every counter that
  // the DB can derive is DB-derived instead (a cursor may legitimately lag
  // the transcript — append-then-bump means ahead, never behind).
  const savedState = isResume ? await readLoopState(runId) : null;
  let impactReport: string | null = savedState?.impactReport ?? null;
  let wrapUpGranted = savedState?.wrapUpGranted ?? false;
  const claimed: Record<string, number> = savedState?.claimed ?? {};
  const issues: string[] = savedState?.issues ?? [];

  // Orphaned in_progress tasks: their executor is gone. Mark them failed —
  // the leader's re-dispatch adopts any already-committed writes through the
  // tool-level idempotency probes (never duplicates). The keys are collected
  // so the freshly appended leader resume_note (below, after wire init) can
  // TELL the leader what was interrupted — live run #2 proved the leader
  // otherwise re-plans blind and re-dispatches identical work uninformed.
  const orphanKeys: string[] = [];
  if (isResume) {
    const orphans = await db.agentTask.findMany({
      where: { runId, status: "in_progress" },
      select: { id: true, key: true },
    });
    for (const orphan of orphans) {
      await db.agentTask.update({ where: { id: orphan.id }, data: { status: "failed" } });
      orphanKeys.push(orphan.key);
      await emitEvent({
        runId,
        kind: "error",
        summary: `${orphan.key} was in_progress when the executor was lost — marked failed. Re-dispatched work adopts committed writes instead of duplicating them.`,
      });
      issues.push(`${orphan.key} was interrupted mid-execution and marked failed (committed writes are adopted, never duplicated).`);
    }
  }

  const atlasPrompt = buildSystemPrompt("atlas");
  const atlasSystem = atlasPrompt.prompt;

  type ChatMessage = { role: "assistant" | "user"; content: string };
  let restoredMessages: ChatMessage[] | null = null;
  let restoredMeter: ContextMeter | null = null;
  let restoredTurnsUsed = 0;
  let fromTranscript = false;
  if (isResume) {
    // Rebuild the conversation from the CANONICAL transcript only — never
    // from AgentEvent (the truncated UI stream). P2-c: the rebuild goes
    // through the ONE assembler (lib/agent/wire.ts) — compaction disabled (or
    // no active summary) ⇒ byte-identical legacy replay; one contiguous
    // active summary ⇒ [system_note][envelope][projection][verbatim tail].
    // HISTORICAL gate_stop / resume_note rows are audit markers — excluded
    // from transcript rendering; the CURRENT resume's resume_note is appended
    // fresh below (after wire init) and rides the live wire as a per-assembly
    // injection (design §2.0.1 — the M1 carve-out), so compaction can never
    // filter the anti-blind-re-dispatch signal.
    const rows = await loadConversation(runId, LEADER_CONVERSATION);
    if (rows.length > 0) {
      const activeSummaries = await db.contextSummary.findMany({
        where: { runId, conversationId: LEADER_CONVERSATION, supersededAt: null },
      });
      const assembled = assembleWire({ rows, activeSummaries });
      if (assembled.fallbackWarnings.length > 0) {
        // Corrupt chain state (head gap / double head / overshoot): the
        // assembler already fell back to the FULL raw replay — fail LOUD
        // (design §2.2) and continue on the safe replay.
        await emitEvent({
          runId,
          kind: "error",
          summary: fallbackErrorSummary(assembled.fallbackWarnings),
        });
      }
      restoredMessages = assembled.messages;
      // The transcript IS the loop cursor: one reply row per completed model
      // turn (appended atomically with its tool_results batch). Compaction
      // never changes cursor arithmetic — it is derived from canonical rows,
      // never from the projected wire.
      restoredTurnsUsed = rows.filter((r) => r.kind === "reply").length;
      fromTranscript = true;
      const envelopeRow = rows.find((r) => r.kind === "envelope");
      // Meter attribution mirrors the replayed wire: the envelope anchor
      // rides `novel`, everything after messages[0..1] is conversation —
      // INCLUDING the projection block when present (metered as sent,
      // design §1 — never the raw transcript size).
      restoredMeter = createContextMeter({
        modelId: modelCtx.selection.modelId,
        contextWindow: modelCtx.contextWindow,
        system: [atlasPrompt.parts.system],
        tools: atlasPrompt.parts.tools,
        skills: atlasPrompt.parts.skills.map((s) => s.body),
        novel: envelopeRow ? [envelopeRow.content] : [],
        // P2-d (design §7): tagged pieces — the projection (if any) is
        // `compacted`, everything replayed after it is the verbatim `tail`;
        // the resume_note injection (added below) lands in `shared`.
        conversationSub: assembled.projected
          ? {
              compacted: [assembled.projected.text],
              tail: assembled.messages.slice(3).map((m) => m.content),
              shared: [],
            }
          : {
              compacted: [],
              tail: assembled.messages.slice(2).map((m) => m.content),
              shared: [],
            },
      });
      if (assembled.projected) {
        // Persisted proof of the restored wire shape (P1×P2 seam evidence):
        // projection + verbatim tail; the resume_note injection (if any)
        // lands after this and is logged by its own path below.
        const tailRows = assembled.messages.length - 3;
        await emitEvent({
          runId,
          kind: "message",
          summary:
            `Resume replayed the compaction projection (seq ${assembled.projected.fromSeq}..${assembled.projected.toSeq}) ` +
            `+ ${tailRows} verbatim tail rows — originals remain in canonical history.`,
          payload: {
            projected: true,
            fromSeq: assembled.projected.fromSeq,
            toSeq: assembled.projected.toSeq,
            tailRows,
            wireMessages: assembled.messages.length,
          },
        });
      }
    }
  }

  // Task 0 — the auto impact assessment is created EXACTLY once per run
  // (Phase 1 guard). Fresh: create when a chapter is pinned. Resume: reuse
  // the existing row — done ⇒ recover the report text; interrupted ⇒ re-run
  // it in place (read-only, idempotent).
  const existingTask0 = isResume
    ? await db.agentTask.findFirst({ where: { runId, key: "Task 0" } })
    : null;
  const checkpointAfterTask0 = async (): Promise<void> => {
    // Phase 1 — checkpoint IMMEDIATELY after Task 0 so a crash between the
    // assessment and the first leader turn can neither re-run nor duplicate it.
    await guard.checkpoint({
      phase: "post-impact",
      turnsUsed: restoredTurnsUsed,
      taskCounter: 0,
      delegateCount: 0,
      claimed,
      issues,
      qcRepairs: {},
      impactReport,
      wrapUpGranted,
    });
  };
  if (!existingTask0 && pinnedRefs.some((r) => r.type === "chapter")) {
    const impactTask = await db.agentTask.create({
      data: {
        runId,
        key: "Task 0",
        parallelGroup: null,
        assignee: "sage",
        title: "Impact assessment (auto — chapter pinned)",
        detail:
          "The author pinned chapter material for this run. Produce a concise IMPACT ASSESSMENT before any edits happen: " +
          "(1) summarize what the pinned chapter(s) establish; (2) list which chapters, characters, timeline events, " +
          "promises and clues could be affected by the author's goal; (3) flag continuity risks; (4) recommend an " +
          "execution order. READ-ONLY: do not write or finalize anything.",
        status: "pending",
        artifactType: "chapter",
        artifactId: null,
        artifactLabel: pinnedRefs.find((r) => r.type === "chapter")?.label ?? null,
        order: 0,
      },
    });
    await emitEvent({
      runId,
      taskId: impactTask.id,
      actor: "atlas",
      kind: "task_update",
      summary: "Task 0 — impact assessment dispatched (read-only, before any edits)",
    });
    await executeTask({
      runId,
      novelId,
      task: impactTask,
      snapshot,
      signal,
      measured: { ...ZERO_MEASURED },
      claimed: {},
      issues: [],
      qc: newQcLedger(),
      extraSkills: [],
      pinnedContext,
      model: modelCtx,
      guard,
      onNarration: (text) => {
        if (!impactReport) impactReport = text;
      },
    });
    if (signal.aborted) return;
    await checkpointAfterTask0();
  } else if (existingTask0 && existingTask0.status !== "done") {
    // Interrupted mid-assessment — re-run in place (read-only, idempotent).
    await guard.append({
      runId,
      conversationId: existingTask0.id,
      taskId: existingTask0.id,
      agent: "sage",
      role: "user",
      kind: "resume_note",
      content: "[resume] the executor was interrupted during this read-only assessment — re-dispatching it.",
    });
    await executeTask({
      runId,
      novelId,
      task: existingTask0,
      snapshot,
      signal,
      measured: { ...ZERO_MEASURED },
      claimed,
      issues,
      qc: newQcLedger(),
      extraSkills: [],
      pinnedContext,
      model: modelCtx,
      guard,
      onNarration: (text) => {
        if (!impactReport) impactReport = text;
      },
    });
    if (signal.aborted) return;
    await checkpointAfterTask0();
  } else if (existingTask0 && !impactReport) {
    // Done but the checkpoint lagged (crash inside the post-Task-0 window) —
    // recover the assessment text from the Task-0 conversation transcript.
    const task0Rows = await loadConversation(runId, existingTask0.id);
    impactReport = task0Rows.find((m) => m.role === "assistant" && m.kind === "reply")?.content ?? null;
  }

  if (!restoredMessages || !restoredMeter) {
    // P2 — the leader envelope is split by where its content COMES FROM, so
    // the meter can attribute tokens honestly: the author's goal and the loop
    // instructions are conversation; the impact report, pinned refs and story
    // snapshot are novel context.
    const leaderConvParts: string[] = [`AUTHOR GOAL: ${goal}`, ""];
    const leaderNovelParts: string[] = [];
    if (impactReport) {
      leaderNovelParts.push(
        "IMPACT ASSESSMENT (Task 0, verified read-only — plan around this):",
        truncate(impactReport, 2400),
        ""
      );
    }
    if (pinnedContext) {
      leaderNovelParts.push(pinnedContext, "");
    }
    leaderNovelParts.push("STORY SNAPSHOT (measured now):", renderSnapshot(snapshot), "");
    leaderConvParts.push(
      "LEAD THE TEAM: read what you need, then dispatch work with ```team-delegate",
      "blocks (JSON array of orders). Each executed order's VERIFIED outcome comes",
      "back to you as a tool result — decide the next step from those, never from",
      "the member's narration alone. Finish with a tool-free reply."
    );
    const envelope = [...leaderConvParts, ...leaderNovelParts].join("\n");

    restoredMessages = [
      { role: "assistant", content: atlasSystem },
      { role: "user", content: envelope },
    ];
    restoredMeter = createContextMeter({
      modelId: modelCtx.selection.modelId,
      contextWindow: modelCtx.contextWindow,
      system: [atlasPrompt.parts.system],
      tools: atlasPrompt.parts.tools,
      skills: atlasPrompt.parts.skills.map((s) => s.body),
      novel: leaderNovelParts,
      conversation: leaderConvParts,
    });
    // Phase 1 — the conversation opener is now canonical: append it (fenced),
    // then let the per-turn checkpoints take over. A crash after the append
    // leaves the transcript ahead of the cursor — resume replays it as-is.
    await guard.append(
      { runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "assistant", kind: "system_note", content: atlasSystem },
      { runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "user", kind: "envelope", content: envelope }
    );
  }
  if (!restoredMessages || !restoredMeter) throw new Error("leader loop: conversation init failed");
  let messages: ChatMessage[] = restoredMessages;
  let meter: ContextMeter = restoredMeter;

  // P2-c (M1 carve-out, design §2.0.1) — DYNAMIC PER-ASSEMBLY INJECTIONS:
  // the current resume's note (and any future resume-time board state) rides
  // EVERY wire this session assembles. Transcript rendering never sees them;
  // every wire rebuild (compaction rewire, fallback rewire) re-applies them,
  // so compaction/cut position can never filter the anti-blind-re-dispatch
  // signal. They die with the executor session — a NEW resume injects a NEW
  // note (historical ones stay unrendered markers).
  const liveInjections: string[] = [];

  /**
   * Rewire the live wire + meter onto an assembled replay (P2-c). Single
   * owner of the wire/meter rebuild used by the between-turns compaction
   * rewire and the fallback rewire — the meter conversation section is
   * rebuilt from EXACTLY the pieces the next call sends (projection + tail
   * + live injections), so usage is metered AS SENT, never retro-inflated
   * to the uncompacted size (design §1, evidence #5). messages[0]/[1] are
   * the system_note + envelope anchors (fixed meter sections); everything
   * after them is conversation.
   */
  const applyAssembly = (assembled: AssembleWireResult, novelParts: string[]): void => {
    messages = [
      ...assembled.messages,
      ...liveInjections.map((content) => ({ role: "user" as const, content })),
    ];
    meter = createContextMeter({
      modelId: modelCtx.selection.modelId,
      contextWindow: modelCtx.contextWindow,
      system: [atlasPrompt.parts.system],
      tools: atlasPrompt.parts.tools,
      skills: atlasPrompt.parts.skills.map((s) => s.body),
      novel: novelParts,
      // P2-d (design §7): tagged pieces metered AS SENT — the projection
      // block is `compacted`, the verbatim rows after it are `tail`, and the
      // live per-assembly injections are `shared` (they ride every wire this
      // session assembles, §2.0.1). On the fallback replay everything after
      // the anchors is tail (compacted stays 0).
      conversationSub: assembled.projected
        ? {
            compacted: [assembled.projected.text],
            tail: assembled.messages.slice(3).map((m) => m.content),
            shared: liveInjections,
          }
        : {
            compacted: [],
            tail: assembled.messages.slice(2).map((m) => m.content),
            shared: liveInjections,
          },
    });
  };

  // Phase 1/C — the leader is TOLD about the interruption. The replay filter
  // above excludes only HISTORICAL marker rows; the CURRENT resume's
  // resume_note is appended fresh (fenced) and pushed onto the live wire, so
  // the first resumed model call sees it as a user message. Without this the
  // leader resumes with no signal that Task N was marked failed — live run #2
  // (05:55:15 resume) showed it re-dispatching identical work uninformed:
  // safe through the probes, but wasteful and invisible on the wire.
  if (isResume && orphanKeys.length > 0) {
    const resumeNote =
      "[resume] The executor was interrupted and has recovered from the canonical transcript. " +
      `Interrupted task(s) marked failed: ${orphanKeys.join(", ")}. Any writes they already committed ` +
      "are adopted by the idempotency probes — never duplicated. Do not assume those tasks succeeded; " +
      "continue from your last completed turn and re-dispatch only what remains unfinished.";
    await guard.append({
      runId,
      conversationId: LEADER_CONVERSATION,
      taskId: null,
      agent: "atlas",
      role: "user",
      kind: "resume_note",
      content: resumeNote,
    });
    // M1 carve-out (design §2.0.1): per-assembly injection — appears on this
    // wire AND on every rewire this session performs, regardless of any
    // compaction projection or cut position. Metered as sent (§7 `shared`).
    liveInjections.push(resumeNote);
    messages.push({ role: "user", content: resumeNote });
    meter.addConversation(resumeNote, "shared");
  }

  // Phase 1 — loop state: in-memory on a fresh start, DB-derived on resume
  // (task rows + the event stream are the source of truth; the checkpoint
  // only carries what the DB cannot derive — claimed/issues/qcRepairs).
  if (fromTranscript) {
    // Stage C — re-emit create events lost to a commit→event-window crash
    // BEFORE deriving counters, so the resumed loop and the final report
    // measure the DB as it IS (see reconcileMissingCreateEvents).
    await reconcileMissingCreateEvents(runId, novelId);
  }
  const measured: Measured = fromTranscript ? await deriveMeasuredFromEvents(runId) : { ...ZERO_MEASURED };
  const qc: QcLedger = fromTranscript
    ? await deriveQcLedger(novelId, savedState?.qcRepairs ?? {})
    : newQcLedger();
  let taskCounter = 0;
  let delegateCount = 0;
  if (fromTranscript) {
    const taskRows = await db.agentTask.findMany({ where: { runId }, select: { key: true, order: true } });
    taskCounter = taskRows.reduce((max, t) => Math.max(max, t.order), 0);
    delegateCount = taskRows.filter((t) => t.key !== "Task 0").length;
  }
  let turnsUsed = restoredTurnsUsed;
  let leaderBlocked: string | null = null;

  // Last call's PROVIDER-RECONCILED prompt tokens (billed truth for the wire
  // just sent) — the compaction trigger's primary measure; the meter's raw
  // estimate is the fallback (see maybeCompact below).
  let lastCallRealTokens: number | null = null;

  const glmCall = async (tag: string, turn: number): Promise<string> => {
    if (signal.aborted) throw new Error("Run aborted");
    const { text: reply, usage } = await glmChat({
      messages,
      tag,
      signal,
      sdkParams: modelCtx.sdk,
      surface: "agent",
      // P5 — the leader call's ledger scope (run + novel, leader conversation).
      ledger: { runId, novelId, conversationId: "leader" },
    });
    lastCallRealTokens = usage?.promptTokens ?? lastCallRealTokens;
    emitUsageEvent(runId, meter, `atlas · turn ${turn}`, usage);
    return reply;
  };

  // P2-c — compaction fires BETWEEN turns (design §2.3): after the turn's
  // transcript batch is appended and the cursor checkpointed, before the
  // next model call. LEADER-ONLY wiring (members stay deliberately inert —
  // see executeTask): eligibility keys off budgets.contextCompaction ONLY,
  // never off contextSpec (design §1). Zero GLM, deterministic, fenced.
  // Trigger measure: the last call's PROVIDER-RECONCILED prompt tokens (the
  // billed truth for the wire just sent) when available, else the meter's
  // raw estimate. Measured live in the P2-c probe: the raw estimate
  // undercounts this CJK-heavy corpus ~1.4× vs the provider's billing —
  // the reconciliation exists precisely because the estimate alone cannot
  // be trusted for a threshold decision.
  const maybeCompact = async (turn: number): Promise<void> => {
    const cc = budgets.contextCompaction;
    if (!cc.enabled) return; // shipped inert — the flip lives in budgets.yaml only
    const beforeTokens = lastCallRealTokens ?? meter.snapshot("compaction-check").used;
    if (beforeTokens < cc.triggerTokens) return;
    const rows = await loadConversation(runId, LEADER_CONVERSATION);
    const decision = decideCut(rows, cc.tailTurns, cc.minCompactableRows);
    if (!decision) return; // too few coverable rows — absorption cannot pay for itself

    // P2-d — MONOTONE COST GUARD (design §2.3.1): an enabled compaction must
    // never make the NEXT call more expensive than not compacting. Zero-GLM:
    // assemble BOTH candidate next-call wires from the same canonical rows —
    //   baseline  = the current live wire (what the next call sends if this
    //               cycle SKIPS; on the FIRST cycle this IS the legacy full
    //               replay, so the comparison is "legacy vs projected"
    //               exactly);
    //   candidate = the new projection + its verbatim tail + live injections
    //               (what the next call sends if this cycle ADOPTS).
    // Adopt only if candidate < baseline − COMPACTION_SLACK_TOKENS; otherwise
    // skip this cycle LOUDLY — telemetry event, NO summary row written, the
    // live wire stays untouched. The live-fire lesson (P2-c turn 6: the
    // turn-counted tail can transiently outweigh the covered span) is exactly
    // what this guard makes impossible to ship.
    const envelopeSeq = findEnvelopeSeq(rows);
    let skipReason: string | null = null;
    let guardVerdict: ReturnType<typeof monotoneGuardCheck> | null = null;
    if (envelopeSeq === null) {
      skipReason = "no envelope row in conversation — nothing to anchor the projection to";
    } else {
      const candidateText = renderProjection(
        envelopeSeq + 1,
        decision.cut,
        buildProjectionBody(rows, envelopeSeq + 1, decision.cut)
      );
      const candidate = assembleWire({
        rows,
        activeSummaries: [
          { fromSeq: envelopeSeq + 1, toSeq: decision.cut, summary: candidateText },
        ],
      });
      if (candidate.fallbackWarnings.length > 0) {
        skipReason = `candidate assembly fell back — ${candidate.fallbackWarnings.join(" | ")}`;
      } else {
        guardVerdict = monotoneGuardCheck({
          baselineMessages: messages,
          candidateMessages: [
            ...candidate.messages,
            ...liveInjections.map((content) => ({ role: "user" as const, content })),
          ],
        });
        if (!guardVerdict.proceed) skipReason = guardSkipSummary(turn, guardVerdict);
      }
    }
    if (skipReason !== null) {
      console.warn(`[compaction] leader turn ${turn}: skip — ${skipReason}`);
      await emitEvent({
        runId,
        kind: "message",
        summary: truncate(skipReason, 400),
        payload: {
          guard: "monotone-cost",
          skipped: true,
          baselineTokens: guardVerdict?.baselineTokens ?? null,
          projectedTokens: guardVerdict?.projectedTokens ?? null,
          slackTokens: guardVerdict?.slackTokens ?? COMPACTION_SLACK_TOKENS,
        },
      });
      return;
    }

    let written: WriteSummaryResult;
    try {
      written = await writeCompactionSummary({
        runId,
        conversationId: LEADER_CONVERSATION,
        taskId: null,
        agent: "atlas",
        rows,
        newCut: decision.cut,
        lease: guard.lease,
      });
    } catch (error) {
      if (error instanceof LeaseLostError) throw error; // evicted — abort like any fenced write
      // Compaction must never kill a run: fail loud, continue on the raw wire.
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[compaction] leader turn ${turn}: summary write threw — ${reason}`);
      await emitEvent({
        runId,
        kind: "error",
        summary: `Context compaction failed between turns — continuing on the full transcript (${truncate(reason, 200)})`,
      });
      return;
    }
    if (!written.ok) {
      // Includes M3: P2002 against a SUPERSEDED row at this cut is NOT
      // "done" — recompute/skip LOUDLY, never adopt the dead row (§2.3).
      console.error(`[compaction] leader turn ${turn}: summary write refused (${written.reason})`);
      await emitEvent({
        runId,
        kind: "error",
        summary: `Context compaction skipped loudly (reason: ${written.reason ?? "unknown"}) — continuing on the full transcript.`,
      });
      return;
    }
    const [freshRows, activeSummaries] = await Promise.all([
      loadConversation(runId, LEADER_CONVERSATION),
      db.contextSummary.findMany({
        where: { runId, conversationId: LEADER_CONVERSATION, supersededAt: null },
      }),
    ]);
    const assembled = assembleWire({ rows: freshRows, activeSummaries });
    const envelopeRow = freshRows.find((r) => r.kind === "envelope");
    if (assembled.fallbackWarnings.length > 0) {
      // Unreachable for a row this process just wrote — but corrupt state is
      // NEVER silent: the assembler already fell back to the raw replay.
      console.error(
        `[compaction] leader turn ${turn}: post-write assembly fell back`,
        assembled.fallbackWarnings
      );
      await emitEvent({
        runId,
        kind: "error",
        summary: fallbackErrorSummary(assembled.fallbackWarnings),
      });
    }
    applyAssembly(assembled, envelopeRow ? [envelopeRow.content] : []);
    const afterTokens = meter.snapshot("compaction-check").used;
    await emitEvent({
      runId,
      kind: "message",
      summary:
        `Context compacted after leader turn ${turn}: rows seq ${written.row?.fromSeq}..${written.row?.toSeq} → ` +
        `deterministic projection (active context ≈ ${beforeTokens} → ${afterTokens} est. tokens). ` +
        "Originals remain in canonical history; read tools retrieve exact detail.",
      payload: {
        projected: true,
        fromSeq: written.row?.fromSeq ?? null,
        toSeq: written.row?.toSeq ?? null,
        coverableRows: decision.coverableRows,
        beforeTokens,
        afterTokens,
        wireMessages: messages.length,
      },
    });
  };

  // loopExhausted — the loop can exit early via break (blocked / finish: both
  // closed properly) or run to exhaustion; only exhaustion earns the one-shot
  // budget wrap-up turn below.
  let loopExhausted = true;
  for (let turn = turnsUsed + 1; turn <= budgets.glm.leaderMaxTurns; turn++) {
    if (signal.aborted) return;
    await guard.assertHeld();
    const reply = await glmCall(`leader turn ${turn}`, turn);
    const parsed = parseAgentTurn(reply);

    if (parsed.narration) {
      await emitEvent({
        runId,
        kind: "message",
        actor: "atlas",
        summary: truncate(parsed.narration.replace(/BLOCKED[:：][\s\S]*/g, "").trim() || parsed.narration, 280),
      });
    }
    if (parsed.blockedReason) {
      leaderBlocked = parsed.blockedReason;
      loopExhausted = false;
      // Phase 1 compliance (risk #7 CLOSED) — the closing reply IS canonical
      // history: append it before leaving. Append-ownership rule: THIS exit
      // owns the turn's append; the per-turn batch at the loop body's end is
      // unreachable once an exit fires. No tool_results row: the blocked
      // check fires before any action runs, so nothing was executed this
      // turn. No checkpoint bump and kind "final" (not "reply"): closing
      // turns are terminal — completed/failed runs never resume — and stay
      // excluded from the turn cursor, keeping cursor == checkpoint timing.
      // Meter/usage untouched: the closing call's usage event was already
      // emitted by glmCall above, and the reply is generated-never-sent
      // (no further model call exists on a terminal path).
      await guard.append({
        runId,
        conversationId: LEADER_CONVERSATION,
        taskId: null,
        agent: "atlas",
        role: "assistant",
        kind: "final",
        content: reply,
      });
      break;
    }
    if (parsed.runReport) {
      for (const [key, value] of Object.entries(parsed.runReport)) {
        claimed[key] = (claimed[key] ?? 0) + value;
      }
    }

    const feeds: string[] = [];

    // 1) Atlas's own read tools.
    for (let i = 0; i < parsed.toolCalls.length; i++) {
      const call = parsed.toolCalls[i];
      if (i >= budgets.glm.maxActionsPerTurn) {
        feeds.push(`${i + 1}. [rejected] action budget exceeded (${budgets.glm.maxActionsPerTurn} per turn)`);
        continue;
      }
      if (call.error || !call.action) {
        feeds.push(`${i + 1}. [error] ${call.error}`);
        continue;
      }
      const result = await executeTool({
        action: call.action,
        prose: null,
        runId,
        novelId,
        taskId: null,
        taskKey: "leader",
        taskBrief: "",
        measured,
        qc,
        signal,
        actor: "atlas",
      });
      feeds.push(`${i + 1}. ${result.feed}`);
    }

    // 2) Work orders → CODE creates the task, member executes, verified
    //    outcome feeds back. Sequential by design (parallelGroup stays null
    //    in v1 — plan §4.1).
    let gateStopTaskKey: string | null = null;
    for (const d of parsed.delegates) {
      if (d.error || !d.order) {
        feeds.push(`delegate: [error] ${d.error}`);
        continue;
      }
      if (delegateCount >= budgets.glm.planMaxTasks) {
        feeds.push(`delegate "${truncate(d.order.title, 60)}": [rejected] delegate budget exceeded (${budgets.glm.planMaxTasks} per run)`);
        continue;
      }
      delegateCount += 1;
      taskCounter += 1;
      const row = await db.agentTask.create({
        data: {
          runId,
          key: `Task ${taskCounter}`,
          parallelGroup: null,
          assignee: d.order.assignee,
          title: d.order.title,
          detail: d.order.detail,
          status: "pending",
          artifactType: d.order.artifactType,
          artifactId: null,
          artifactLabel: d.order.artifactLabel,
          order: taskCounter,
        },
      });
      await emitEvent({
        runId,
        taskId: row.id,
        actor: "atlas",
        kind: "task_update",
        summary: `Task ${taskCounter} delegated to ${d.order.assignee} — ${truncate(d.order.title, 100)}`,
      });

      const outcome = await executeTask({
        runId,
        novelId,
        task: row,
        snapshot,
        signal,
        measured,
        claimed,
        issues,
        qc,
        extraSkills: d.order.skills ?? [],
        pinnedContext,
        model: modelCtx,
        guard,
      });
      if (outcome === "skipped") {
        // Gate stop — handlers own status. Persist the interrupted turn first
        // (below) so the canonical transcript stays complete.
        gateStopTaskKey = row.key;
        break;
      }
      feeds.push(
        `${row.key} (${d.order.assignee}) → ${outcome}${outcome === "done" ? " (verified)" : ""}`
      );
    }

    if (gateStopTaskKey) {
      // Phase 1 gate-stop path — append the reply, the partial feeds, and a
      // gate_stop audit marker before dropping out. The transcript then ends
      // coherently (reply + tool results) even though the executor exits.
      await guard.append(
        { runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "assistant", kind: "reply", content: reply },
        { runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "user", kind: "tool_results", content: `TOOL RESULTS:\n${feeds.join("\n") || "(none)"}\n(gate stop: ${gateStopTaskKey} left the loop at the approval gate — the approval handlers own run status.)` },
        { runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "user", kind: "gate_stop", content: `GATE STOP — ${gateStopTaskKey} paused at the approval gate.` }
      );
      return; // gate stop — handlers own status
    }

    // finish (or a tool-free reply) ends the loop — but only after this
    // turn's delegates have run.
    if (parsed.endsLoop && parsed.delegates.length === 0) {
      loopExhausted = false;
      // Phase 1 compliance (risk #7 CLOSED) — persist the closing turn with
      // the SAME batch the per-turn path would write (tool results included
      // when this turn executed reads), with the reply marked kind "final"
      // so the turn cursor ("reply"-row count) and the checkpoints remain
      // consistent. Append-ownership rule: THIS exit owns the turn's append;
      // the per-turn batch below is unreachable once it fires. No checkpoint
      // bump (terminal turn); meter/usage untouched (usage was emitted by
      // glmCall above; the reply is generated-never-sent).
      const closingResults =
        feeds.length > 0 ? `TOOL RESULTS:\n${feeds.join("\n")}` : null;
      await guard.append(
        { runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "assistant", kind: "final", content: reply },
        ...(closingResults
          ? [{ runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "user", kind: "tool_results", content: closingResults }]
          : [])
      );
      break;
    }

    const toolResults = `TOOL RESULTS:\n${feeds.join("\n") || "(no actions parsed — use read tools or ```team-delegate blocks)"}`;
    meter.addConversation(reply);
    meter.addConversation(toolResults);
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "user", content: toolResults });
    // Phase 1 — mirror the turn into the canonical transcript FIRST (one
    // atomic batch: reply + tool_results), THEN bump the cursor checkpoint
    // (append-then-bump ordering).
    // Append-ownership rule (risk #7): every leader model turn is appended
    // EXACTLY ONCE by exactly one of — (a) this per-turn batch (normal
    // turns), (b) the gate-stop batch (reply + tool_results + gate_stop
    // marker), (c) the blocked exit ("final"), (d) the finish/tool-free
    // exit ("final" [+ tool_results]). Each exit returns/breaks immediately
    // after its append and this batch is the loop body's last statement, so
    // reaching it proves no terminal exit fired for this turn — a double
    // append is structurally impossible.
    await guard.append(
      { runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "assistant", kind: "reply", content: reply },
      { runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "user", kind: "tool_results", content: toolResults }
    );
    turnsUsed = turn;
    await guard.checkpoint({
      phase: "leading",
      turnsUsed,
      taskCounter,
      delegateCount,
      claimed,
      issues,
      qcRepairs: Object.fromEntries(qc.repairs),
      impactReport,
      wrapUpGranted,
    });
    // P2-c — the between-turns compaction window (append → bump → compact):
    // the next iteration's model call sees the projected wire when a
    // compaction fired; disabled ⇒ this returns immediately (inert).
    await maybeCompact(turn);
  }

  if (signal.aborted) return;

  // ---- One-shot budget wrap-up turn (Phase 1, lifetime cap) ----------------
  // The loop reached exhaustion without a proper close. The leader gets ONE
  // wrap-up turn per run LIFETIME: wrapUpGranted is checkpointed BEFORE the
  // model call, so crash→resume cycles can never mint a second one — a resume
  // that finds the flag already set (turnsUsed >= max) takes the deterministic
  // zero-GLM reconciliation path (resume route → reconcileWrapUpFromDb).
  if (loopExhausted && !wrapUpGranted) {
    wrapUpGranted = true;
    await guard.checkpoint({
      phase: "wrap-up",
      turnsUsed,
      taskCounter,
      delegateCount,
      claimed,
      issues,
      qcRepairs: Object.fromEntries(qc.repairs),
      impactReport,
      wrapUpGranted,
    });
    const wrapUpDirective =
      "BUDGET REACHED: the turn budget is exhausted. Reply NOW with your final run report " +
      "(a run-report block) and a short closing summary — no tool calls and no new work orders. " +
      "Name anything left unfinished in the report.";
    meter.addConversation(wrapUpDirective);
    messages.push({ role: "user", content: wrapUpDirective });
    await guard.append({ runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "user", kind: "wrap_up", content: wrapUpDirective });
    const wrapReply = await glmCall(`leader wrap-up (turn ${turnsUsed + 1})`, turnsUsed + 1);
    const wrapParsed = parseAgentTurn(wrapReply);
    if (wrapParsed.narration) {
      await emitEvent({
        runId,
        kind: "message",
        actor: "atlas",
        summary: truncate(wrapParsed.narration.replace(/BLOCKED[:：][\s\S]*/g, "").trim() || wrapParsed.narration, 280),
      });
    }
    if (wrapParsed.runReport) {
      for (const [key, value] of Object.entries(wrapParsed.runReport)) {
        claimed[key] = (claimed[key] ?? 0) + value;
      }
    }
    if (wrapParsed.delegates.length > 0 || wrapParsed.toolCalls.length > 0) {
      issues.push(
        `wrap-up turn requested ${wrapParsed.delegates.length} work order(s) / ${wrapParsed.toolCalls.length} tool call(s) after the budget — not executed`
      );
    }
    meter.addConversation(wrapReply);
    messages.push({ role: "assistant", content: wrapReply });
    await guard.append({ runId, conversationId: LEADER_CONVERSATION, taskId: null, agent: "atlas", role: "assistant", kind: "reply", content: wrapReply });
    turnsUsed += 1;
    await guard.checkpoint({
      phase: "wrap-up",
      turnsUsed,
      taskCounter,
      delegateCount,
      claimed,
      issues,
      qcRepairs: Object.fromEntries(qc.repairs),
      impactReport,
      wrapUpGranted,
    });
  }

  // ---- Final report (leader verification closure, plan §4 capability 5) ----
  if (leaderBlocked) {
    issues.push(`leader blocked: ${leaderBlocked}`);
  }

  // Honesty pass — claimed (model) vs verified (measured), all audited keys.
  issues.push(...auditReport(claimed, snapshotOf(measured)));

  // Review→repair closure: blocking findings must be answered by a repair
  // write or an explicit leader decision, never silently dropped.
  if (measured.blockingFound > 0 && measured.chaptersUpdated === 0) {
    issues.push(
      `review found ${measured.blockingFound} blocking issue(s) but no repair write followed — verify the leader's decision to defer`
    );
  }

  const tasks = await db.agentTask.findMany({ where: { runId }, select: { status: true } });
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const status: AgentRunStatus =
    leaderBlocked && doneCount === 0 ? "failed" : "completed";

  const summaryBits: string[] = [
    `${doneCount}/${tasks.length} tasks done across the team.`,
  ];
  if (measured.chaptersWritten > 0 || measured.chaptersUpdated > 0) {
    summaryBits.push(
      `Chapters: ${measured.chaptersWritten} created, ${measured.chaptersUpdated} updated · ${measured.words.toLocaleString()} words written (measured).`
    );
  }
  if (measured.reviewsRun > 0) {
    summaryBits.push(`Reviews: ${measured.reviewsRun} run, ${measured.blockingFound} blocking found.`);
  }
  if (measured.chaptersFinalized > 0 || measured.settlesRun > 0) {
    summaryBits.push(
      `E2 gates: ${measured.chaptersFinalized} finalized, ${measured.settlesRun} settled (code-verified).`
    );
  }
  if (measured.exportsRun > 0) {
    summaryBits.push(`Exports: ${measured.exportsRun} manuscript build(s).`);
  }
  if (leaderBlocked) {
    summaryBits.push(`Leader stopped early: ${truncate(leaderBlocked, 200)}`);
  }

  const report: RunFinalReport = {
    summary: summaryBits.join(" "),
    reported: Object.keys(claimed).length > 0 ? { ...claimed } : { ...snapshotOf(measured) },
    verified: snapshotOf(measured),
    blockingIssues: issues.slice(0, 12),
  };

  // Phase 1 — the completion flip is lease-fenced: an evicted executor never
  // closes somebody else's run. count === 0 ⇒ the new owner will finish it.
  const closed = await db.agentRun.updateMany({
    where: { id: runId, leaseOwner: guard.lease.owner, leaseEpoch: guard.lease.epoch },
    data: { status, finalReport: JSON.stringify(report) },
  });
  if (closed.count === 0) throw new LeaseLostError();
  await emitEvent({
    runId,
    kind: "message",
    actor: "atlas",
    summary:
      status === "completed"
        ? `Run complete — ${report.summary}${issues.length > 0 ? ` (${issues.length} verification note${issues.length > 1 ? "s" : ""})` : ""}`
        : `Run failed — ${report.summary}`,
  });
}

/** The audited counters as a plain record for the final report. */
function snapshotOf(m: Measured): Record<string, number> {
  return {
    chaptersWritten: m.chaptersWritten,
    chaptersUpdated: m.chaptersUpdated,
    outlineBeatsUpdated: m.outlineBeatsUpdated,
    words: m.words,
    reviewsRun: m.reviewsRun,
    blockingFound: m.blockingFound,
    exportsRun: m.exportsRun,
    chaptersFinalized: m.chaptersFinalized,
    settlesRun: m.settlesRun,
  };
}

// ---------------------------------------------------------------------------
// Task execution (member tool loop — sage/nova/prism/forge)
// ---------------------------------------------------------------------------

type TaskOutcome = "done" | "blocked" | "failed" | "skipped";

interface ToolResult {
  ok: boolean;
  feed: string;
  /** Phase 1 — set when an idempotency probe adopted an already-committed effect. */
  adopted?: "write" | "finalize";
}

async function executeTask(params: {
  runId: string;
  novelId: string;
  task: { id: string; key: string; title: string; detail: string; assignee: string; artifactType: string | null; artifactLabel: string | null };
  snapshot: StorySnapshotData;
  signal: AbortSignal;
  measured: Measured;
  claimed: Record<string, number>;
  issues: string[];
  /** Run-scoped QC state (Phase 6 E2 gates). */
  qc: QcLedger;
  /** delegate-supplied skill ids appended after the role's defaults (P5). */
  extraSkills: string[];
  /** Author-pinned context (Phase 8) appended after the story snapshot. */
  pinnedContext?: string | null;
  /** P2 — the run's resolved registry selection, applied to every call. */
  model: RunModel;
  /** Phase 1 — the executor's lease guard; every transcript append is fenced. */
  guard: LeaseGuard;
  onNarration?: (text: string) => void;
}): Promise<TaskOutcome> {
  const budgets = getBudgets();
  const { runId, novelId, task, snapshot, signal, measured } = params;
  const assignee = (
    ["sage", "nova", "prism", "forge"].includes(task.assignee) ? task.assignee : "sage"
  ) as AgentRoleId;
  const taskRef = { runId, taskId: task.id };

  await db.agentTask.update({ where: { id: task.id }, data: { status: "in_progress" } });
  await emitEvent({ ...taskRef, actor: assignee, kind: "task_update", summary: `${task.key} started (${assignee}) — ${task.title}` });

  // Skills: role defaults + delegate-supplied extras → telemetry rows record
  // what was actually injected (plan §7.2 SkillInvocation). Unknown ids from
  // the delegate block are recorded with injected:false — never silent.
  const { prompt: system, injectedSkillIds, parts: systemParts } = buildSystemPrompt(
    assignee,
    params.extraSkills
  );
  const unknownSkills = params.extraSkills.filter((id) => !getSkillEntry(id));
  await db.skillInvocation.createMany({
    data: [
      ...injectedSkillIds.map((skillId) => ({ taskId: task.id, skillId, injected: true })),
      ...unknownSkills.map((skillId) => ({ taskId: task.id, skillId, injected: false })),
    ],
  }).catch(() => undefined); // telemetry must never break execution
  if (unknownSkills.length > 0) {
    await emitEvent({
      ...taskRef,
      actor: "atlas",
      kind: "message",
      summary: `Skill note: unknown skill id(s) dropped for ${task.key} — ${unknownSkills.join(", ")}`,
    });
  }

  const quotaHint =
    task.artifactLabel?.match(/chapter\s*(\d+)/i) ?? task.title.match(/chapter\s*(\d+)/i);
  const targetChapterIndex = quotaHint ? Number(quotaHint[1]) : null;

  // P2 — the member envelope splits by ORIGIN for the meter: brief + mission
  // lock are conversation; snapshot, pinned refs, certify protocol, word
  // quota and language directive are novel-derived context.
  const convParts: string[] = [
    `TASK ENVELOPE — execute exactly this task, then stop.`,
    `${task.key} — ${task.title}`,
    truncate(task.detail || "(no additional detail)", budgets.prompt.taskBriefCapChars),
    "",
    "MISSION LOCK: you are the assigned member for this brief; actions beyond it are failures. If it is impossible, make your final line start with BLOCKED: plus the reason.",
  ];
  const novelParts: string[] = [
    "",
    "STORY SNAPSHOT (measured at run start; use read tools for fresher data):",
    // P4 (O1, A2/A4) — task-specific member snapshot slice via the declared
    // map (lib/agent/snapshot-slice.ts): gated on budgets.contextSlicing
    // (shipped false ⇒ FULL bytes, pre-P4-identical), fail-open on unknown
    // shapes, A2 guard force-includes brief-referenced sections whole. The
    // pinned block below stays outside the slice entirely (A3 — always whole).
    buildMemberSnapshotSlice(snapshot, task, { enabled: budgets.contextSlicing.enabled }),
  ];
  if (params.pinnedContext) {
    novelParts.push("", params.pinnedContext);
  }
  if (assignee === "prism" && /certif|finaliz/i.test(`${task.title} ${task.detail ?? ""}`)) {
    // Phase 6.1 — certify tasks must END in a verified finalize, and the
    // protocol wording here overrides any inverted phrasing that slips into
    // a leader-generated brief (e.g. "if blocking issues exist, finalize").
    novelParts.push(
      "",
      "CERTIFY PROTOCOL (hard rule — overrides any contrary wording in the brief): " +
        "review first; if the review finds 0 blocking issues you MUST call finalize_chapter(index) then settle_chapter(index) within this same task — " +
        "ending with the chapter still draft FAILS verification. " +
        "If blocking issues exist, do NOT finalize: report them so the leader can dispatch repairs.",
    );
  }
  if (assignee === "sage") {
    // Word quota is a writer concern — researchers/analysts don't need it.
    if (targetChapterIndex) {
      novelParts.push("", quotaForChapter(snapshot, targetChapterIndex));
    } else {
      novelParts.push("", quotaForChapter(snapshot, snapshot.nextChapterIndex));
    }
  }
  novelParts.push("", languageDirective(snapshot));

  type ChatMessage = { role: "assistant" | "user"; content: string };
  const messages: ChatMessage[] = [
    { role: "assistant", content: system },
    { role: "user", content: [...convParts, ...novelParts].join("\n") },
  ];
  // Phase 1 — the member conversation opens canonically (fenced appends:
  // role card + task envelope, mirroring the wire exactly).
  await params.guard.append(
    { runId, conversationId: task.id, taskId: task.id, agent: assignee, role: "assistant", kind: "system_note", content: system },
    { runId, conversationId: task.id, taskId: task.id, agent: assignee, role: "user", kind: "envelope", content: [...convParts, ...novelParts].join("\n") }
  );

  // P2 — conversation-scoped meter; snapshot per call = what that call sent.
  // P2-c compaction wiring scope (declared, evidence #4): the LEADER loop is
  // the ONLY compaction consumer in this phase. Member conversations are
  // per-task, never replayed on resume (an interrupted member task is marked
  // failed and re-dispatched on a FRESH wire), and measured member wires max
  // out ~1.5K tokens — far below triggerTokens — so wiring compaction here
  // would be dead speculative code. Deliberately inert; revisit only if
  // member conversations ever grow a replay path.
  const meter = createContextMeter({
    modelId: params.model.selection.modelId,
    contextWindow: params.model.contextWindow,
    system: [systemParts.system],
    tools: systemParts.tools,
    skills: systemParts.skills.map((s) => s.body),
    novel: novelParts,
    conversation: convParts,
  });

  const measuredForTask: Measured = { ...ZERO_MEASURED };
  let blockedReason: string | null = null;
  let repairRound = 0;
  let stoppedByGate = false;
  // Phase 1 — adopted (already-committed) effects found by the idempotency
  // probes. They satisfy write/finalize verification WITHOUT counting twice
  // (the original event already carries them into the run-level totals).
  let adoptedWrites = 0;
  let adoptedFinalizes = 0;

  let callCounter = 0; // repair rounds reuse runTurns — keep labels monotonic
  const glmCall = async (tag: string): Promise<string> => {
    if (signal.aborted) throw new Error("Run aborted");
    const { text: reply, usage } = await glmChat({
      messages,
      tag,
      signal,
      sdkParams: params.model.sdk,
      surface: "agent",
      // P5 — the member call's ledger scope (per-run + per-member-task).
      ledger: { runId, novelId, taskId: task.id, conversationId: task.id },
    });
    callCounter += 1;
    emitUsageEvent(runId, meter, `${task.key} · ${assignee} · turn ${callCounter}`, usage);
    return reply;
  };

  const runTurns = async (turnBudget: number): Promise<void> => {
    for (let turn = 1; turn <= turnBudget; turn++) {
      if (signal.aborted) throw new Error("Run aborted");
      await params.guard.assertHeld();
      const reply = await glmCall(`${task.key} turn ${turn}`);
      const parsed = parseAgentTurn(reply);

      if (parsed.narration) {
        const clean = parsed.narration.replace(/BLOCKED[:：][\s\S]*/g, "").trim() || parsed.narration;
        params.onNarration?.(clean);
        await emitEvent({
          ...taskRef,
          actor: assignee,
          kind: "message",
          summary: truncate(clean, 280),
        });
      }
      if (parsed.blockedReason) {
        blockedReason = parsed.blockedReason;
        return;
      }
      if (parsed.runReport) {
        for (const [key, value] of Object.entries(parsed.runReport)) {
          params.claimed[key] = (params.claimed[key] ?? 0) + value;
        }
      }

      const feeds: string[] = [];

      // Members cannot delegate — a team-delegate block here is a protocol
      // violation, reported back instead of executed.
      if (parsed.delegates.length > 0) {
        feeds.push(`note: ${parsed.delegates.length} team-delegate block(s) ignored — only the leader dispatches work.`);
      }

      for (let i = 0; i < parsed.toolCalls.length; i++) {
        const call = parsed.toolCalls[i];
        if (i >= budgets.glm.maxActionsPerTurn) {
          feeds.push(`${i + 1}. [rejected] action budget exceeded (${budgets.glm.maxActionsPerTurn} per turn)`);
          continue;
        }
        if (call.error || !call.action) {
          feeds.push(`${i + 1}. [error] ${call.error}`);
          continue;
        }
        if (!toolAllowedFor(assignee, call.action.action)) {
          feeds.push(`${i + 1}. [error] ${call.action.action} is not available to your role (${assignee}). Use one of: ${MEMBER_TOOLS[assignee].join(", ")}.`);
          continue;
        }
        const result = await executeTool({
          action: call.action,
          prose: parsed.novelWrite,
          runId,
          novelId,
          taskId: task.id,
          taskKey: task.key,
          taskBrief: task.detail ?? "",
          measured: measuredForTask,
          qc: params.qc,
          signal,
          actor: assignee,
        });
        feeds.push(`${i + 1}. ${result.feed}`);
        if (result.adopted === "write") adoptedWrites += 1;
        if (result.adopted === "finalize") adoptedFinalizes += 1;
        if (result.stopped) {
          stoppedByGate = true;
          // Phase 1 — persist the interrupted turn before dropping out: the
          // reply, the partial feeds, and a gate_stop audit marker.
          await params.guard.append(
            { runId, conversationId: task.id, taskId: task.id, agent: assignee, role: "assistant", kind: "reply", content: reply },
            { runId, conversationId: task.id, taskId: task.id, agent: assignee, role: "user", kind: "tool_results", content: `TOOL RESULTS:\n${feeds.join("\n") || "(none)"}\n(gate stop: the approval gate ended this turn — the approval handlers own run status.)` },
            { runId, conversationId: task.id, taskId: task.id, agent: assignee, role: "user", kind: "gate_stop", content: `GATE STOP — ${task.key}: ${truncate(result.feed, 200)}` }
          );
          return;
        }
      }
      if (parsed.extraWriteBlocks > 0) {
        feeds.push(`note: ${parsed.extraWriteBlocks} extra novel-write block(s) dropped — one write per turn.`);
      }
      // Prose arrived but no write action consumed it — the most common
      // verification failure. Say so BEFORE the loop ends so the model can
      // pair the ```novel-write block with create_chapter/update_chapter.
      if (
        parsed.novelWrite &&
        !parsed.toolCalls.some((t) => t.action?.action === "create_chapter" || t.action?.action === "update_chapter") &&
        !parsed.endsLoop
      ) {
        feeds.push(
          "note: your ```novel-write block was received but NO write action consumed it — prose without create_chapter/update_chapter in the SAME turn is discarded. Re-send BOTH in one turn."
        );
      }

      if (parsed.endsLoop) return;

      const toolResults = `TOOL RESULTS:\n${feeds.join("\n") || "(no actions parsed — use ```novel-tool blocks)"}`;
      meter.addConversation(reply);
      meter.addConversation(toolResults);
      messages.push({ role: "assistant", content: reply });
      messages.push({ role: "user", content: toolResults });
      // Phase 1 — mirror the turn into the canonical transcript (one atomic
      // batch so a crash can never leave a dangling reply).
      await params.guard.append(
        { runId, conversationId: task.id, taskId: task.id, agent: assignee, role: "assistant", kind: "reply", content: reply },
        { runId, conversationId: task.id, taskId: task.id, agent: assignee, role: "user", kind: "tool_results", content: toolResults }
      );
    }
  };

  try {
    await runTurns(budgets.glm.maxTurns);

    // A gate stop means the author decided (reject→paused / cancel) or the
    // wait ended — the handler owns task & run status; never touch them here.
    if (stoppedByGate) return "skipped";

    // Write verification for SAGE chapter tasks — repair rounds before failure.
    const requiresWrite = task.artifactType === "chapter" && assignee === "sage";
    while (
      requiresWrite &&
      measuredForTask.chaptersWritten + measuredForTask.chaptersUpdated + adoptedWrites === 0 &&
      !blockedReason &&
      repairRound < budgets.glm.repairRounds &&
      !signal.aborted
    ) {
      repairRound += 1;
      await emitEvent({
        ...taskRef,
        actor: assignee,
        kind: "error",
        summary: `Write verification failed — no verified DB write. Repair round ${repairRound}/${budgets.glm.repairRounds}.`,
      });
      const verifyFailed =
        "VERIFY FAILED: this task required a chapter write but nothing was committed. " +
        "Reply with create_chapter/update_chapter plus a ```novel-write block NOW, " +
        "or make your final line BLOCKED: with the reason. Narration alone will fail again.";
      meter.addConversation(verifyFailed);
      messages.push({ role: "user", content: verifyFailed });
      await params.guard.append({ runId, conversationId: task.id, taskId: task.id, agent: assignee, role: "user", kind: "repair", content: verifyFailed });
      await runTurns(2);
    }

    // Phase 6.1 — finalize verification for PRISM certify tasks. The sage
    // write gate above only covers sage; a certify task ("Review and
    // Certify/Finalize Chapter N") that ends without a verified
    // finalize_chapter leaves the chapter in draft (no green status) while
    // the board reports success. Detect that here and run the SAME repair
    // rounds before marking done.
    const requiresFinalize =
      assignee === "prism" &&
      task.artifactType === "chapter" &&
      /certif|finaliz/i.test(`${task.title ?? ""}`);
    while (
      requiresFinalize &&
      measuredForTask.chaptersFinalized + adoptedFinalizes === 0 &&
      !blockedReason &&
      repairRound < budgets.glm.repairRounds &&
      !signal.aborted
    ) {
      repairRound += 1;
      await emitEvent({
        ...taskRef,
        actor: assignee,
        kind: "error",
        summary: `Finalize verification failed — chapter is still draft, no verified finalize_chapter. Repair round ${repairRound}/${budgets.glm.repairRounds}.`,
      });
      const finalizeFailed =
        "VERIFY FAILED: this task was expected to certify the chapter but no finalize_chapter was verified — the chapter is still DRAFT. " +
        "Call finalize_chapter(index) NOW (the E2 gate reads the latest persisted review — 0 blocking passes), then settle_chapter(index) for memory. " +
        "Skip optional scans; or reply BLOCKED: with the reason. Narration alone will fail again.";
      meter.addConversation(finalizeFailed);
      messages.push({ role: "user", content: finalizeFailed });
      await params.guard.append({ runId, conversationId: task.id, taskId: task.id, agent: assignee, role: "user", kind: "repair", content: finalizeFailed });
      await runTurns(2);
    }

    // Fold this task's measured numbers into the run totals.
    measured.chaptersWritten += measuredForTask.chaptersWritten;
    measured.chaptersUpdated += measuredForTask.chaptersUpdated;
    measured.outlineBeatsUpdated += measuredForTask.outlineBeatsUpdated;
    measured.words += measuredForTask.words;
    measured.reviewsRun += measuredForTask.reviewsRun;
    measured.blockingFound += measuredForTask.blockingFound;
    measured.exportsRun += measuredForTask.exportsRun;
    measured.chaptersFinalized += measuredForTask.chaptersFinalized;
    measured.settlesRun += measuredForTask.settlesRun;

    let outcome: TaskOutcome;
    if (blockedReason) {
      await db.agentTask.update({ where: { id: task.id }, data: { status: "blocked" } });
      await emitEvent({ ...taskRef, actor: assignee, kind: "task_update", summary: `${task.key} blocked: ${truncate(blockedReason, 200)}` });
      params.issues.push(`${task.key} (${assignee}) blocked: ${blockedReason}`);
      outcome = "blocked";
    } else if (requiresWrite && measuredForTask.chaptersWritten + measuredForTask.chaptersUpdated + adoptedWrites === 0) {
      await db.agentTask.update({ where: { id: task.id }, data: { status: "failed" } });
      await emitEvent({ ...taskRef, actor: assignee, kind: "task_update", summary: `${task.key} failed — write verification never passed.` });
      params.issues.push(`${task.key} failed: no verified write after ${budgets.glm.repairRounds} repair round(s)`);
      outcome = "failed";
    } else if (requiresFinalize && measuredForTask.chaptersFinalized + adoptedFinalizes === 0) {
      await db.agentTask.update({ where: { id: task.id }, data: { status: "failed" } });
      await emitEvent({ ...taskRef, actor: assignee, kind: "task_update", summary: `${task.key} failed — finalize verification never passed (chapter still draft).` });
      params.issues.push(`${task.key} failed: no verified finalize_chapter after ${budgets.glm.repairRounds} repair round(s) — chapter left in draft`);
      outcome = "failed";
    } else {
      await db.agentTask.update({ where: { id: task.id }, data: { status: "done" } });
      const verified =
        measuredForTask.chaptersFinalized > 0
          ? ` (finalize verified in DB${measuredForTask.settlesRun > 0 ? ` + ${measuredForTask.settlesRun} memory settle(s)` : ""})`
          : measuredForTask.chaptersWritten + measuredForTask.chaptersUpdated > 0
            ? " (write verified in DB)"
            : adoptedWrites + adoptedFinalizes > 0
              ? ` (work adopted from an earlier verified commit — idempotent re-dispatch)`
              : ` (${assignee} work verified)`;
      await emitEvent({ ...taskRef, actor: assignee, kind: "task_update", summary: `${task.key} done${verified}.` });
      outcome = "done";
    }
    return outcome;
  } catch (error) {
    if (error instanceof LeaseLostError) {
      // Phase 1 — an evicted executor must NOT flip task status (that write
      // belongs to the current lease owner; a marked-failed task would be a
      // post-eviction write). Propagate so executeRun aborts without further
      // DB writes; the resume path re-dispatches the task and any committed
      // work is adopted by the probes.
      throw error;
    }
    if (signal.aborted) {
      // Cancel handler owns the status flip; just stop quietly.
      return "skipped";
    }
    const message = error instanceof Error ? error.message : "unknown task error";
    await db.agentTask.update({ where: { id: task.id }, data: { status: "failed" } }).catch(() => undefined);
    await emitEvent({ ...taskRef, actor: assignee, kind: "error", summary: `${task.key} failed: ${truncate(message, 250)}` });
    params.issues.push(`${task.key} failed: ${truncate(message, 200)}`);
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

interface ExecuteToolParams {
  action: import("./tool-protocol").ToolAction;
  prose: string | null;
  runId: string;
  novelId: string;
  taskId: string | null;
  taskKey: string;
  /** The executing task's brief (detail) — persisted as the chapter brief. */
  taskBrief: string;
  measured: Measured;
  /** Run-scoped QC state (Phase 6 E2 gates). */
  qc: QcLedger;
  signal: AbortSignal;
  /** Which member is calling — gates the per-role tool surface. */
  actor: AgentRoleId;
}

export async function executeTool(params: ExecuteToolParams): Promise<ToolResult & { stopped?: boolean }> {
  const { action, prose, actor } = params;
  const budgets = getBudgets();

  // Per-role tool surface (§8) — hard code-level gate, before any effect.
  if (!toolAllowedFor(actor, action.action)) {
    return {
      ok: false,
      feed: `${action.action} → error: not available to role "${actor}" (allowed: ${MEMBER_TOOLS[actor].join(", ")}).`,
    };
  }

  switch (action.action) {
    // ---------------- reads ----------------
    case "read_novel": {
      const fresh = await loadStorySnapshot(params.novelId);
      return { ok: true, feed: `read_novel → ok\n${renderSnapshot(fresh)}` };
    }
    case "read_chapter": {
      const chapter = await db.chapter.findFirst({
        where: { novelId: params.novelId, index: action.index },
      });
      if (!chapter) return { ok: false, feed: `read_chapter(${action.index}) → error: no such chapter` };
      const briefPart = chapter.brief.trim()
        ? `\nCHAPTER BRIEF (细纲): ${chapter.brief.slice(0, 2000)}`
        : "";
      return {
        ok: true,
        feed: `read_chapter(${action.index}) → ok ("${chapter.title}", ${chapter.wordCount} words, ${chapter.status})${briefPart}\n${chapter.content.slice(0, budgets.glm.chapterContextChars) || "(empty)"}`,
      };
    }
    case "read_outline": {
      const beats = await db.outlineBeat.findMany({
        where: { novelId: params.novelId },
        orderBy: { index: "asc" },
      });
      return {
        ok: true,
        feed: `read_outline → ok (${beats.length} beats)\n${beats.map((b) => `${b.index}. ${b.title}${b.summary ? ` — ${b.summary}` : ""}`).join("\n") || "(none)"}`,
      };
    }
    case "read_foreshadows": {
      const ledger = await db.foreshadow.findMany({
        where: { novelId: params.novelId },
        orderBy: [{ status: "asc" }, { plantChapter: "asc" }],
        take: 40,
      });
      return {
        ok: true,
        feed: `read_foreshadows → ok (${ledger.length} entries)\n${ledger.map((f) => `- [${f.id}] ${f.status}, planted ch${f.plantChapter}: ${f.content}`).join("\n") || "(empty)"}`,
      };
    }
    case "memory_query": {
      // Phase 4: scored lookup over the story bible (deterministic, no AI cost).
      const items = await queryMemory({
        novelId: params.novelId,
        query: action.query,
        category: action.category,
      });
      if (items.length === 0) {
        return {
          ok: true,
          feed: `memory_query("${truncate(action.query, 60)}") → 0 hits — nothing in the settled story bible matches. Do NOT invent canon to fill the gap.`,
        };
      }
      return {
        ok: true,
        feed: `memory_query("${truncate(action.query, 60)}") → ok (${items.length} items)\n${formatMemoryLines(items).join("\n")}`,
      };
    }
    case "doctor_scan": {
      // Deterministic consistency checks (bible/ledger/coverage/cast).
      const view = await buildMemoryView(params.novelId);
      const lines = view.doctor.map(
        (d) => `- [${d.status.toUpperCase()}] ${d.name}: ${d.detail}`
      );
      return {
        ok: true,
        feed: `doctor_scan → ok (${view.doctor.filter((d) => d.status !== "pass").length} finding(s))\n${lines.join("\n")}`,
      };
    }
    case "review_chapter": {
      // Prism's structured review (Phase 5, persisted in Phase 6) — same
      // core as the Review tab; critical issues are forced blocking
      // SERVER-SIDE. The verdict lands in ChapterReview (the E2 gate's data
      // source) and in the run's QC ledger for repair budgeting.
      const chapter = await db.chapter.findFirst({
        where: { novelId: params.novelId, index: action.index },
      });
      if (!chapter) return { ok: false, feed: `review_chapter(${action.index}) → error: no such chapter` };
      try {
        const result = await reviewChapter(chapter.id, { source: "agent" });
        const blocking = result.issues.filter((i) => i.blocking).length;
        params.measured.reviewsRun += 1;
        params.measured.blockingFound += blocking;
        params.qc.lastBlocking.set(chapter.index, blocking);
        const lines = result.issues.map(
          (i) => `- [${i.severity}${i.blocking ? "/BLOCKING" : ""}] (${i.category}, ${i.location}) ${truncate(i.evidence, 200)}${i.fixHint ? ` → fix: ${truncate(i.fixHint, 160)}` : ""}`
        );
        await emitEvent({
          runId: params.runId,
          taskId: params.taskId,
          actor,
          kind: "message",
          summary: `Reviewed Chapter ${chapter.index} "${truncate(chapter.title, 60)}" — ${result.issues.length} issue(s), ${blocking} blocking.`,
          // Phase 1 — structured review payload so the blocking findings are
          // re-derivable from the event stream after a crash (review payload
          // addition: op / issues / blocking).
          payload: { op: "review_chapter", chapterIndex: chapter.index, issues: result.issues.length, blocking },
        });
        return {
          ok: true,
          feed: `review_chapter(${action.index}) → ok: ${result.issues.length} issue(s), ${blocking} blocking (verdict persisted)${blocking > 0 ? " — report these to the leader in your run-report; the leader must dispatch a sage repair, then re-review" : " — you may now call finalize_chapter and settle_chapter for it"}\n${lines.join("\n") || "(no issues found)"}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "review failed";
        return { ok: false, feed: `review_chapter(${action.index}) → error: ${truncate(message, 200)}` };
      }
    }
    case "finalize_chapter": {
      // Phase 6 E2 gate — CODE decides from the LATEST persisted review,
      // never from the model's claim. Prism-only by MEMBER_TOOLS.
      const chapter = await db.chapter.findFirst({
        where: { novelId: params.novelId, index: action.index },
      });
      if (!chapter) return { ok: false, feed: `finalize_chapter(${action.index}) → error: no such chapter` };
      // Phase 1 idempotency probe (finalize): already final ⇒ the commit
      // landed before the interruption. Adopt, don't re-commit (no duplicate
      // counted, no duplicate event — the original event still stands).
      if (chapter.status === "final") {
        return {
          ok: true,
          adopted: "finalize",
          feed: `finalize_chapter(${action.index}) → ok: chapter is already FINAL — adopted (idempotent re-dispatch, no re-commit).`,
        };
      }
      const latest = await db.chapterReview.findFirst({
        where: { chapterId: chapter.id },
        orderBy: { createdAt: "desc" },
      });
      const verdict = evaluateFinalize({
        latestBlockingCount: latest ? latest.blockingCount : null,
        wordCount: chapter.wordCount,
      });
      if (!verdict.allowed) {
        return { ok: false, feed: `finalize_chapter(${action.index}) → ${verdict.reason}` };
      }
      await db.chapter.update({
        where: { id: chapter.id },
        data: { status: "final" },
      });
      params.measured.chaptersFinalized += 1;
      await emitEvent({
        runId: params.runId,
        taskId: params.taskId,
        actor,
        kind: "write",
        summary: `Chapter ${chapter.index} "${truncate(chapter.title, 60)}" marked FINAL — E2 gate passed (latest review: ${latest?.blockingCount ?? 0} blocking, verified in DB).`,
        payload: { artifact: "chapter", chapterId: chapter.id, index: chapter.index, status: "final", op: "finalize_chapter" },
      });
      return {
        ok: true,
        feed: `finalize_chapter(${action.index}) → ok: chapter status = final (E2 gate passed on the persisted review).`,
      };
    }
    case "settle_chapter": {
      // Phase 6 — memory sedimentation through the SAME core as the Review
      // tab, gated on a clean review. Single-writer rule preserved.
      const chapter = await db.chapter.findFirst({
        where: { novelId: params.novelId, index: action.index },
      });
      if (!chapter) return { ok: false, feed: `settle_chapter(${action.index}) → error: no such chapter` };
      // Phase 1 idempotency probe (settle, STATE-based): a ChapterDigest that
      // is newer than the chapter's last edit means memory already settled
      // for exactly this content — adopt and skip the sediment GLM pass.
      // sedimentChapterCore is itself row-idempotent (digest upsert, fact
      // dedupe, plant dedupe, one-way ledger); the probe only avoids the
      // redundant provider call on re-dispatch.
      const digest = await db.chapterDigest.findUnique({
        where: { chapterId: chapter.id },
        select: { updatedAt: true },
      });
      if (digest && digest.updatedAt.getTime() >= chapter.updatedAt.getTime()) {
        return {
          ok: true,
          feed: `settle_chapter(${action.index}) → ok: memory already settled for the current chapter content (digest current — adopted, no re-sedimentation).`,
        };
      }
      const latest = await db.chapterReview.findFirst({
        where: { chapterId: chapter.id },
        orderBy: { createdAt: "desc" },
      });
      const verdict = evaluateSettle({
        latestBlockingCount: latest ? latest.blockingCount : null,
        wordCount: chapter.wordCount,
      });
      if (!verdict.allowed) {
        return { ok: false, feed: `settle_chapter(${action.index}) → ${verdict.reason}` };
      }
      try {
        const outcome: SedimentOutcome = (await sedimentChapterCore(chapter.id)).result;
        params.measured.settlesRun += 1;
        await emitEvent({
          runId: params.runId,
          taskId: params.taskId,
          actor,
          kind: "write",
          summary: `Chapter ${chapter.index} memory settled — ${outcome.factsCreated} facts, ${outcome.characterStates} states, ${outcome.plantsCreated} plants (verified in DB).`,
          payload: { artifact: "chapter", chapterId: chapter.id, index: chapter.index, settles: outcome, op: "settle_chapter" },
        });
        return {
          ok: true,
          feed: `settle_chapter(${action.index}) → ok: digest + ${outcome.factsCreated} facts (+${outcome.factsTouched} reinforced), ${outcome.characterStates} states, ${outcome.plantsCreated} plants, ${outcome.advanced} advanced, ${outcome.paid} paid (verified).`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "settle failed";
        return { ok: false, feed: `settle_chapter(${action.index}) → error: ${truncate(message, 200)}` };
      }
    }
    case "export_markdown": {
      // Forge's manuscript build (Phase 5) — real generation over the live
      // DB; the artifact is reported in the feed (file download stays an
      // author-facing UI action).
      try {
        const manuscript = await buildManuscriptMarkdown(params.novelId);
        params.measured.exportsRun += 1;
        const preview = truncate(manuscript.body.replace(/\s+/g, " ").trim(), 600);
        return {
          ok: true,
          feed: `export_markdown → ok: manuscript built (${manuscript.chapterCount} chapters, ${manuscript.totalWords.toLocaleString()} words, ${manuscript.body.length.toLocaleString()} chars). Preview: ${preview}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "export failed";
        return { ok: false, feed: `export_markdown → error: ${truncate(message, 200)}` };
      }
    }

    // ---------------- writes ----------------
    case "create_chapter": {
      if (!prose) {
        return { ok: false, feed: "create_chapter → error: provide the chapter prose in a ```novel-write block in the SAME turn." };
      }
      // Phase 1 idempotency probe (create): all interruption shapes that
      // would duplicate a chapter row on re-dispatch (exact title+content
      // match; this run's create event for the same title; or the commit→
      // event window kill — row exists, event lost). See findAdoptableChapter.
      const adoptable = await findAdoptableChapter(params.runId, params.novelId, action.title, prose);
      if (adoptable) {
        if (adoptable.reconcileEvent) {
          // Shape 3 — the commit landed but its event never did (executor died
          // inside the commit→event window). Emit the missing create event so
          // event-derived counters keep DB parity; without this the final
          // report would undercount a chapter that IS in the DB.
          params.measured.chaptersWritten += 1;
          params.measured.words += adoptable.wordCount;
          await emitEvent({
            runId: params.runId,
            taskId: params.taskId,
            kind: "write",
            summary: `Created Chapter ${adoptable.index} "${truncate(action.title, 80)}" — ${adoptable.wordCount.toLocaleString()} words (verified in DB; reconciled from an interrupted commit — adopted on re-dispatch, no duplicate row).`,
            payload: { artifact: "chapter", chapterId: adoptable.id, index: adoptable.index, words: adoptable.wordCount, op: "create_chapter", title: action.title, reconciled: true },
          });
        }
        return {
          ok: true,
          adopted: "write",
          feed: `create_chapter → ok: adopted existing Chapter ${adoptable.index} "${action.title}" (${adoptable.wordCount} words) — this work was already committed earlier in the run (idempotent re-dispatch, no duplicate row created). Task complete; end your reply without tool calls.`,
        };
      }
      const last = await db.chapter.findFirst({
        where: { novelId: params.novelId },
        orderBy: { index: "desc" },
        select: { index: true },
      });
      const index = (last?.index ?? 0) + 1;
      const run = await db.agentRun.findUnique({ where: { id: params.runId }, select: { mode: true } });
      const words = countWords(prose);
      // Phase 7 — the delegated brief persists as the chapter brief (细纲).
      const brief = params.taskBrief.trim().slice(0, 8000);

      if (run?.mode === "approval") {
        return await pauseForApproval({
          ...params,
          taskId: params.taskId ?? "", // writes only originate from member tasks
          payload: {
            pending: true,
            action: "create_chapter",
            kind: "chapter_settle",
            taskId: params.taskId ?? "",
            taskKey: params.taskKey,
            novelId: params.novelId,
            index,
            chapterId: null,
            title: action.title,
            targetLabel: `Chapter ${index} — chapter ${index} of the novel`,
            wordCount: words,
            existingWords: 0,
            content: prose,
            brief,
          },
          pendingSummary: `Draft ready (~${words.toLocaleString()} words) — awaiting approval to settle as Chapter ${index}.`,
        });
      }

      const chapter = await db.chapter.create({
        data: {
          novelId: params.novelId,
          index,
          title: action.title,
          content: prose,
          wordCount: words,
          status: "draft",
          brief,
        },
      });
      await recordChapterVersion({
        chapterId: chapter.id,
        novelId: params.novelId,
        content: prose,
        createdBy: "agent",
      });
      await db.novel.update({ where: { id: params.novelId }, data: { updatedAt: new Date() } });
      params.measured.chaptersWritten += 1;
      params.measured.words += words;
      await emitEvent({
        runId: params.runId,
        taskId: params.taskId,
        kind: "write",
        summary: `Created Chapter ${index} "${truncate(action.title, 80)}" — ${words.toLocaleString()} words (verified in DB).`,
        payload: { artifact: "chapter", chapterId: chapter.id, index, words, op: "create_chapter", title: action.title },
      });
      return { ok: true, feed: `create_chapter → ok: Chapter ${index} "${action.title}" created with ${words} words (verified).` };
    }

    case "update_chapter": {
      if (!prose) {
        return { ok: false, feed: "update_chapter → error: provide the full replacement prose in a ```novel-write block in the SAME turn." };
      }
      const chapter = await db.chapter.findFirst({
        where: { novelId: params.novelId, index: action.index },
      });
      if (!chapter) return { ok: false, feed: `update_chapter(${action.index}) → error: no such chapter` };

      // Phase 1 idempotency probe (update): the exact replacement content is
      // ALREADY live ⇒ the commit landed but the outcome was lost to an
      // interruption. Adopt without re-writing (no duplicate version row, no
      // double-counted repair round, no duplicate event).
      if (chapter.content === prose) {
        return {
          ok: true,
          adopted: "write",
          feed: `update_chapter(${chapter.index}) → ok: adopted — the chapter already carries exactly this content (idempotent re-dispatch, nothing re-written). Task complete; end your reply without tool calls.`,
        };
      }

      // Phase 7 final lock — 定稿 is immutable to agents. Repairs on a final
      // chapter require the author to reopen it in the workbench first.
      if (chapter.status === "final") {
        return {
          ok: false,
          feed: `update_chapter(${action.index}) → error: chapter is FINAL (locked). Final chapters are immutable — ask the author to reopen it in the workbench first.`,
        };
      }

      // Phase 6 revision budget: a replacement of a chapter whose latest
      // review found blocking issues counts as a REPAIR round — bounded by
      // budgets.qc.revisionRounds so a blocking→fix loop cannot spin forever.
      const latestBlocking = params.qc.lastBlocking.get(chapter.index) ?? null;
      const repairVerdict = evaluateRepair({
        latestBlockingCount: latestBlocking,
        repairRoundsUsed: params.qc.repairs.get(chapter.index) ?? 0,
        maxRevisionRounds: budgets.qc.revisionRounds,
      });
      if (!repairVerdict.allowed) {
        return { ok: false, feed: `update_chapter(${action.index}) → ${repairVerdict.reason}` };
      }
      const isRepair = repairVerdict.code === "ok" && latestBlocking !== null && latestBlocking > 0;

      const verdict = assessOverwrite({
        existingContent: chapter.content,
        incomingContent: prose,
        overwrite: false, // the runtime never self-confirms — the author does
      });
      const words = countWords(prose);
      const run = await db.agentRun.findUnique({ where: { id: params.runId }, select: { mode: true } });

      const needsGate = verdict.blocked || run?.mode === "approval";
      if (needsGate) {
        return await pauseForApproval({
          ...params,
          taskId: params.taskId ?? "", // writes only originate from member tasks
          payload: {
            pending: true,
            action: "update_chapter",
            kind: verdict.blocked ? "bulk_rewrite" : "chapter_settle",
            taskId: params.taskId ?? "",
            taskKey: params.taskKey,
            novelId: params.novelId,
            index: chapter.index,
            chapterId: chapter.id,
            title: chapter.title,
            targetLabel: `Chapter ${chapter.index} — ${chapter.title}`,
            wordCount: words,
            existingWords: verdict.existingWords,
            content: prose,
          },
          pendingSummary: `Rewrite of Chapter ${chapter.index} ready (~${words.toLocaleString()} words)${isRepair ? " — counts as a QC repair round" : ""} — awaiting approval.`,
          repairTracking: isRepair ? { qc: params.qc, chapterIndex: chapter.index } : undefined,
        });
      }

      await db.chapter.update({
        where: { id: chapter.id },
        data: {
          content: prose,
          wordCount: words,
          // Backfill the brief when the chapter predates brief persistence.
          ...(chapter.brief.trim() ? {} : { brief: params.taskBrief.trim().slice(0, 8000) }),
        },
      });
      await recordChapterVersion({
        chapterId: chapter.id,
        novelId: params.novelId,
        content: prose,
        createdBy: "agent",
      });
      await db.novel.update({ where: { id: params.novelId }, data: { updatedAt: new Date() } });
      params.measured.chaptersUpdated += 1;
      params.measured.words += Math.max(0, words - verdict.existingWords);
      if (isRepair) {
        params.qc.repairs.set(
          chapter.index,
          (params.qc.repairs.get(chapter.index) ?? 0) + 1
        );
      }
      await emitEvent({
        runId: params.runId,
        taskId: params.taskId,
        kind: "write",
        summary: `Updated Chapter ${chapter.index} "${truncate(chapter.title, 80)}" — now ${words.toLocaleString()} words${isRepair ? ` (repair round ${params.qc.repairs.get(chapter.index)}/${budgets.qc.revisionRounds})` : ""} (verified in DB).`,
        payload: { artifact: "chapter", chapterId: chapter.id, index: chapter.index, words, op: "update_chapter", title: chapter.title, existingWords: verdict.existingWords, isRepair },
      });
      return { ok: true, feed: `update_chapter(${chapter.index}) → ok: content replaced, ${words} words (verified).${isRepair ? " Re-review this chapter to re-check the blocking findings." : ""}` };
    }

    case "update_outline_beat": {
      const beat = await db.outlineBeat.findFirst({
        where: { novelId: params.novelId, index: action.index },
      });
      if (!beat) return { ok: false, feed: `update_outline_beat(${action.index}) → error: no such beat` };
      // Phase 1 idempotency probe (beat): identical summary ⇒ already applied
      // before the interruption — adopt, no change, no duplicate event.
      if (beat.summary === action.summary) {
        return {
          ok: true,
          feed: `update_outline_beat(${beat.index}) → ok: beat already carries this summary (adopted — no change needed).`,
        };
      }
      await db.outlineBeat.update({ where: { id: beat.id }, data: { summary: action.summary } });
      params.measured.outlineBeatsUpdated += 1;
      await emitEvent({
        runId: params.runId,
        taskId: params.taskId,
        kind: "write",
        summary: `Updated outline beat ${beat.index} "${truncate(beat.title, 80)}" (verified in DB).`,
        payload: { artifact: "outline_beat", beatId: beat.id, index: beat.index, op: "update_outline_beat" },
      });
      return { ok: true, feed: `update_outline_beat(${beat.index}) → ok: summary updated (verified).` };
    }

    case "finish":
      return { ok: true, feed: "finish → acknowledged. End your reply without further tool calls." };

    default: {
      const exhaustive: never = action;
      void exhaustive;
      return { ok: false, feed: "unknown action" };
    }
  }
}

// ---------------------------------------------------------------------------
// Approval gate (D2) — pause the loop until the author decides
// ---------------------------------------------------------------------------

async function pauseForApproval(params: {
  payload: PendingWritePayload;
  pendingSummary: string;
  runId: string;
  taskId: string;
  measured: Measured;
  signal: AbortSignal;
  /** Phase 6: when set, a verified commit counts as a QC repair round. */
  repairTracking?: { qc: QcLedger; chapterIndex: number };
}): Promise<ToolResult & { stopped?: boolean }> {
  const { payload, runId, taskId, signal } = params;

  await emitEvent({
    runId,
    taskId,
    kind: "write",
    summary: params.pendingSummary,
    payload: payload as unknown as Record<string, unknown>,
  });
  await db.agentTask.update({ where: { id: taskId }, data: { status: "needs_approval" } });
  await db.agentRun.update({ where: { id: runId }, data: { status: "awaiting_approval" } });
  await emitEvent({
    runId,
    taskId,
    kind: "approval",
    summary:
      payload.action === "create_chapter"
        ? `Waiting for your approval to settle the draft into Chapter ${payload.index}.`
        : `Waiting for your approval to replace Chapter ${payload.index} (irreversible).`,
    payload: { kind: payload.kind },
  });

  // Stateless wait — poll run.status; approve/reject/cancel handlers flip it.
  const budgets = getBudgets();
  const deadline = Date.now() + budgets.qc.approvalWaitMs;
  while (Date.now() < deadline) {
    if (signal.aborted) return { ok: false, feed: "gate aborted", stopped: true };
    await sleep(1000);
    const run = await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!run) return { ok: false, feed: "run vanished", stopped: true };
    if (run.status === "running") {
      // Approved & committed by the handler — verify from the DB (never trust).
      if (payload.action === "create_chapter") {
        const created = await db.chapter.findFirst({
          where: { novelId: payload.novelId, title: payload.title, content: payload.content },
          select: { index: true, wordCount: true },
        });
        if (created) {
          params.measured.chaptersWritten += 1;
          params.measured.words += created.wordCount;
          return {
            ok: true,
            feed: `gate approved → Chapter ${created.index} settled with ${created.wordCount} words (verified). Task complete; end your reply without tool calls.`,
          };
        }
        return { ok: true, feed: "gate approved → commit verified in DB. Task complete." };
      }
      const updated = payload.chapterId
        ? await db.chapter.findUnique({ where: { id: payload.chapterId }, select: { index: true, wordCount: true } })
        : null;
      if (updated) {
        params.measured.chaptersUpdated += 1;
        params.measured.words += Math.max(0, updated.wordCount - payload.existingWords);
        if (params.repairTracking) {
          const { qc, chapterIndex } = params.repairTracking;
          qc.repairs.set(chapterIndex, (qc.repairs.get(chapterIndex) ?? 0) + 1);
        }
        return {
          ok: true,
          feed: `gate approved → Chapter ${updated.index} now has ${updated.wordCount} words (verified). Task complete; end your reply without tool calls.`,
        };
      }
      return { ok: true, feed: "gate approved → commit verified in DB. Task complete." };
    }
    if (run.status === "paused" || run.status === "cancelled") {
      // Feed must state the ACTUAL terminal status — run #2's transcript said
      // "run paused" for a cancelled run (the audit rows misreported it).
      return {
        ok: false,
        feed:
          run.status === "cancelled"
            ? "gate aborted by the author — run cancelled."
            : "gate rejected by the author — run paused.",
        stopped: true,
      };
    }
  }
  return { ok: false, feed: "gate timed out", stopped: true };
}
