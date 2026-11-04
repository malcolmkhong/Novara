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
//
// Resumability: the executor waits at gates by polling run.status (stateless
// across hot reloads); approve/reject/cancel handlers flip DB state and the
// executor follows. A run orphaned by a process restart is marked failed by
// healStaleRuns (no event activity for sse.staleRunMs).
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
import type { RealUsage } from "@/lib/usage/ledger";
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
        payload: { committed: true, chapterId: chapter.id, index, words: chapter.wordCount },
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
        payload: { committed: true, chapterId: chapter.id, index: chapter.index, words: chapter.wordCount },
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

  executors.get(runId)?.controller.abort();
  await db.agentTask.updateMany({
    where: { runId, status: { in: ["in_progress", "needs_approval"] } },
    data: { status: "blocked" },
  });
  await db.agentRun.update({ where: { id: runId }, data: { status: "cancelled" } });
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

/** Entry point — called from the route handler via after(). Idempotent. */
export async function executeRun(runId: string): Promise<void> {
  if (executors.has(runId)) return;
  const controller = new AbortController();
  executors.set(runId, { controller });
  try {
    await runLoop(runId, controller.signal);
  } catch (error) {
    const run = await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } }).catch(() => null);
    if (run && !TERMINAL_STATUSES.includes(run.status as AgentRunStatus)) {
      const message = error instanceof Error ? error.message : "Unknown runtime error";
      await db.agentRun.update({ where: { id: runId }, data: { status: "failed", error: message } });
      await emitEvent({ runId, kind: "error", summary: `Run failed: ${truncate(message, 300)}` });
    }
  } finally {
    executors.delete(runId);
  }
}

async function runLoop(runId: string, signal: AbortSignal): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) return;

  // Abort from a previous process instance (e.g. after hot reload) is not our
  // signal; only honor fresh cancels from here on.
  const freshController = new AbortController();
  const onAbort = () => freshController.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    await leaderLoop(runId, run.goal, freshController.signal);
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

async function leaderLoop(runId: string, goal: string, signal: AbortSignal): Promise<void> {
  const budgets = getBudgets();
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const novelId = run.novelId;
  // P2 — resolve the run's registry selection once; every GLM call of the
  // run (leader + members) goes out with these exact params.
  const modelCtx = resolveRunModel(run.modelId, run.thinkingLevel);

  const snapshot = await loadStorySnapshot(novelId);
  await emitEvent({ runId, kind: "message", summary: "Atlas is reading the story state and assembling the team…" });

  // Phase 8 — resolve the author's pinned refs against the DB. When a
  // chapter is pinned, run a deterministic read-only impact assessment
  // BEFORE the leader loop so the plan is grounded in an impact report
  // (user flow step 5: check what the change would affect).
  const pinnedRefs = parseJsonSafe<PinnedRef[]>(run.pinnedJson, []);
  const pinnedContext = await buildPinnedContext(novelId, pinnedRefs);
  let impactReport: string | null = null;
  if (pinnedRefs.some((r) => r.type === "chapter")) {
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
      onNarration: (text) => {
        if (!impactReport) impactReport = text;
      },
    });
    if (signal.aborted) return;
  }

  const atlasPrompt = buildSystemPrompt("atlas");
  const atlasSystem = atlasPrompt.prompt;

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

  type ChatMessage = { role: "assistant" | "user"; content: string };
  const messages: ChatMessage[] = [
    { role: "assistant", content: atlasSystem },
    { role: "user", content: envelope },
  ];

  // P2 — one meter per conversation; snapshot before each call reflects
  // exactly what THAT call sends.
  const meter = createContextMeter({
    modelId: modelCtx.selection.modelId,
    contextWindow: modelCtx.contextWindow,
    system: [atlasPrompt.parts.system],
    tools: atlasPrompt.parts.tools,
    skills: atlasPrompt.parts.skills.map((s) => s.body),
    novel: leaderNovelParts,
    conversation: leaderConvParts,
  });

  const measured: Measured = { ...ZERO_MEASURED };
  const qc = newQcLedger();
  const claimed: Record<string, number> = {};
  const issues: string[] = [];
  let taskCounter = 0;
  let delegateCount = 0;
  let leaderBlocked: string | null = null;

  const glmCall = async (tag: string, turn: number): Promise<string> => {
    if (signal.aborted) throw new Error("Run aborted");
    const { text: reply, usage } = await glmChat({
      messages,
      tag,
      signal,
      sdkParams: modelCtx.sdk,
      surface: "agent",
    });
    emitUsageEvent(runId, meter, `atlas · turn ${turn}`, usage);
    return reply;
  };

  for (let turn = 1; turn <= budgets.glm.leaderMaxTurns; turn++) {
    if (signal.aborted) return;
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
      });
      if (outcome === "skipped") return; // gate stop — handlers own status
      feeds.push(
        `${row.key} (${d.order.assignee}) → ${outcome}${outcome === "done" ? " (verified)" : ""}`
      );
    }

    // finish (or a tool-free reply) ends the loop — but only after this
    // turn's delegates have run.
    if (parsed.endsLoop && parsed.delegates.length === 0) break;

    const toolResults = `TOOL RESULTS:\n${feeds.join("\n") || "(no actions parsed — use read tools or ```team-delegate blocks)"}`;
    meter.addConversation(reply);
    meter.addConversation(toolResults);
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "user", content: toolResults });
  }

  if (signal.aborted) return;

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

  await db.agentRun.update({
    where: { id: runId },
    data: { status, finalReport: JSON.stringify(report) },
  });
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
  /** Narration tap — lets the leader capture a member's report text. */
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
    renderSnapshot(snapshot),
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

  // P2 — conversation-scoped meter; snapshot per call = what that call sent.
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

  let callCounter = 0; // repair rounds reuse runTurns — keep labels monotonic
  const glmCall = async (tag: string): Promise<string> => {
    if (signal.aborted) throw new Error("Run aborted");
    const { text: reply, usage } = await glmChat({
      messages,
      tag,
      signal,
      sdkParams: params.model.sdk,
      surface: "agent",
    });
    callCounter += 1;
    emitUsageEvent(runId, meter, `${task.key} · ${assignee} · turn ${callCounter}`, usage);
    return reply;
  };

  const runTurns = async (turnBudget: number): Promise<void> => {
    for (let turn = 1; turn <= turnBudget; turn++) {
      if (signal.aborted) throw new Error("Run aborted");
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
        if (result.stopped) {
          stoppedByGate = true;
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
      measuredForTask.chaptersWritten + measuredForTask.chaptersUpdated === 0 &&
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
      measuredForTask.chaptersFinalized === 0 &&
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
    } else if (requiresWrite && measuredForTask.chaptersWritten + measuredForTask.chaptersUpdated === 0) {
      await db.agentTask.update({ where: { id: task.id }, data: { status: "failed" } });
      await emitEvent({ ...taskRef, actor: assignee, kind: "task_update", summary: `${task.key} failed — write verification never passed.` });
      params.issues.push(`${task.key} failed: no verified write after ${budgets.glm.repairRounds} repair round(s)`);
      outcome = "failed";
    } else if (requiresFinalize && measuredForTask.chaptersFinalized === 0) {
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
            : ` (${assignee} work verified)`;
      await emitEvent({ ...taskRef, actor: assignee, kind: "task_update", summary: `${task.key} done${verified}.` });
      outcome = "done";
    }
    return outcome;
  } catch (error) {
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

async function executeTool(params: ExecuteToolParams): Promise<ToolResult & { stopped?: boolean }> {
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
        payload: { artifact: "chapter", chapterId: chapter.id, index: chapter.index, status: "final" },
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
          payload: { artifact: "chapter", chapterId: chapter.id, index: chapter.index, settles: outcome },
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
        payload: { artifact: "chapter", chapterId: chapter.id, index, words },
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
        payload: { artifact: "chapter", chapterId: chapter.id, index: chapter.index, words },
      });
      return { ok: true, feed: `update_chapter(${chapter.index}) → ok: content replaced, ${words} words (verified).${isRepair ? " Re-review this chapter to re-check the blocking findings." : ""}` };
    }

    case "update_outline_beat": {
      const beat = await db.outlineBeat.findFirst({
        where: { novelId: params.novelId, index: action.index },
      });
      if (!beat) return { ok: false, feed: `update_outline_beat(${action.index}) → error: no such beat` };
      await db.outlineBeat.update({ where: { id: beat.id }, data: { summary: action.summary } });
      params.measured.outlineBeatsUpdated += 1;
      await emitEvent({
        runId: params.runId,
        taskId: params.taskId,
        kind: "write",
        summary: `Updated outline beat ${beat.index} "${truncate(beat.title, 80)}" (verified in DB).`,
        payload: { artifact: "outline_beat", beatId: beat.id, index: beat.index },
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
      return { ok: false, feed: "gate rejected by the author — run paused.", stopped: true };
    }
  }
  return { ok: false, feed: "gate timed out", stopped: true };
}
