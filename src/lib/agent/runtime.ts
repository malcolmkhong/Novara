// ---------------------------------------------------------------------------
// Novara AI — agent runtime (Phase 3, development plan §4 / §7.1).
//
// Orchestrates one run: Atlas plans a task board from the story snapshot,
// then tasks execute sequentially through a bounded GLM tool loop. CODE owns
// every hard edge:
//   - tool protocol parsing (lib/agent/tool-protocol.ts)
//   - anti-overwrite gate  (lib/novara/write-gate.ts) — non-empty chapter
//     replacement ALWAYS pauses for the author, even in full-access mode
//   - approval gate (D2) — in approval mode every chapter content write
//     pauses; the pending write lives in a write-event payload (durable)
//   - write verification — a chapter task without a verified DB write gets
//     repair rounds, then `failed`. Narration is never a write.
//   - honesty rule — task `done` flips happen only after verified commits;
//     finalReport compares claimed (model) vs verified (measured) numbers.
//
// Resumability: the executor waits at gates by polling run.status (stateless
// across hot reloads); approve/reject/cancel handlers flip DB state and the
// executor follows. A run orphaned by a process restart is marked failed by
// healStaleRuns (no event activity for sse.staleRunMs).
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";
import { z } from "zod";
import { getBudgets, buildSystemPrompt } from "@/lib/novara/content";
import { chatJson } from "@/lib/novara/ai-json";
import { withTimeout } from "@/lib/novara/api-helpers";
import { countWords } from "@/lib/novara/words";
import { assessOverwrite } from "@/lib/novara/write-gate";
import { buildMemoryView, formatMemoryLines, queryMemory } from "@/lib/novara/memory";
import type {
  AgentEvent,
  AgentEventKind,
  AgentRun,
  AgentRunDetail,
  AgentRunMode,
  AgentRunStatus,
  AgentTask,
  ApprovalKind,
  RunFinalReport,
} from "@/lib/novara/agent-types";
import { parseAgentTurn } from "./tool-protocol";
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
  kind: AgentEventKind;
  summary: string;
  payload?: Record<string, unknown>;
}) {
  await db.agentEvent.create({
    data: {
      runId: params.runId,
      taskId: params.taskId ?? null,
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
}

type AgentRunRow = {
  id: string;
  novelId: string;
  goal: string;
  mode: string;
  status: string;
  finalReport: string | null;
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
    finalReport: parseJsonSafe<RunFinalReport | null>(run.finalReport, null),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function serializeTask(t: {
  id: string;
  runId: string;
  key: string;
  parallelGroup: string | null;
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
  kind: string;
  summary: string;
  payload: string | null;
  createdAt: Date;
}): AgentEvent {
  return {
    id: e.id,
    runId: e.runId,
    taskId: e.taskId,
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
}): Promise<AgentRunDetail> {
  const novel = await db.novel.findUnique({ where: { id: params.novelId }, select: { id: true } });
  if (!novel) throw new NotFoundError("Novel not found");

  const active = await db.agentRun.findFirst({
    where: { novelId: params.novelId, status: { in: ACTIVE_STATUSES } },
    select: { id: true },
  });
  if (active) {
    throw new ConflictError("This novel already has an active run. Cancel or finish it first.");
  }

  const run = await db.agentRun.create({
    data: { novelId: params.novelId, goal: params.goal, mode: params.mode, status: "running" },
  });
  await emitEvent({
    runId: run.id,
    kind: "message",
    summary: `Leader received the goal: “${truncate(params.goal, 200)}”`,
  });
  const detail = await getRunDetail(run.id);
  if (!detail) throw new Error("Run vanished right after creation");
  return detail;
}

// ---------------------------------------------------------------------------
// Custom errors → HTTP mapping
// ---------------------------------------------------------------------------

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export function errorStatus(error: unknown): { message: string; status: number } {
  if (error instanceof NotFoundError) return { message: error.message, status: 404 };
  if (error instanceof ConflictError) return { message: error.message, status: 409 };
  const message = error instanceof Error ? error.message : "Unknown error";
  return { message, status: 500 };
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
      const chapter = await db.chapter.create({
        data: {
          novelId: payload.novelId,
          index,
          title: payload.title,
          content: payload.content,
          wordCount: countWords(payload.content),
          status: "draft",
        },
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
      const chapter = await db.chapter.update({
        where: { id: payload.chapterId },
        data: { content: payload.content, wordCount: countWords(payload.content) },
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
}

const ZERO_MEASURED: Measured = { chaptersWritten: 0, chaptersUpdated: 0, outlineBeatsUpdated: 0, words: 0 };

const REPORT_KEYS = Object.keys(ZERO_MEASURED);

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
    await executePlanned(runId, run.goal, freshController.signal);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------------------
// Planning (Atlas)
// ---------------------------------------------------------------------------

const planTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(6000).default(""),
  artifactType: z
    .enum(["chapter", "outline_beat", "world_entry", "character"])
    .nullish()
    .transform((v) => v ?? null),
  artifactLabel: z.string().trim().max(120).nullish().transform((v) => v ?? null),
});

const planSchema = z.object({
  tasks: z.array(planTaskSchema).max(24),
  notes: z.string().max(1200).default(""),
});

async function planTasks(
  runId: string,
  goal: string,
  snapshot: StorySnapshotData
): Promise<{ title: string; detail: string; artifactType: string | null; artifactLabel: string | null }[]> {
  const budgets = getBudgets();
  const system = buildSystemPrompt("atlas");
  const user = [
    `AUTHOR GOAL: ${goal}`,
    "",
    "STORY SNAPSHOT:",
    renderSnapshot(snapshot),
    "",
    "Plan the task board now. Output the JSON object only.",
  ].join("\n");

  const plan = await chatJson({
    system,
    user,
    tag: "Agent planning",
    parse: (json) => planSchema.parse(json),
  });

  return plan.tasks.slice(0, budgets.glm.planMaxTasks).map((t) => ({
    title: t.title,
    detail: t.detail,
    artifactType: t.artifactType,
    artifactLabel: t.artifactLabel,
  }));
}

// ---------------------------------------------------------------------------
// Planned execution: planning → task loop → final report
// ---------------------------------------------------------------------------

async function executePlanned(runId: string, goal: string, signal: AbortSignal): Promise<void> {
  const budgets = getBudgets();
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const novelId = run.novelId;

  const snapshot = await loadStorySnapshot(novelId);
  await emitEvent({ runId, kind: "message", summary: "Atlas is reading the story state and planning the task board…" });

  let plan;
  try {
    plan = await planTasks(runId, goal, snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "planning failed";
    await db.agentRun.update({ where: { id: runId }, data: { status: "failed", error: `Planning failed: ${message}` } });
    await emitEvent({ runId, kind: "error", summary: `Planning failed: ${truncate(message, 300)}` });
    return;
  }
  if (signal.aborted) return;

  if (plan.length === 0) {
    const report: RunFinalReport = {
      summary: "Atlas planned zero tasks — the goal is already satisfied by the current story state.",
      reported: { ...ZERO_MEASURED },
      verified: { ...ZERO_MEASURED },
      blockingIssues: [],
    };
    await db.agentRun.update({
      where: { id: runId },
      data: { status: "completed", finalReport: JSON.stringify(report) },
    });
    await emitEvent({ runId, kind: "message", summary: "Nothing to do — run completed without tasks." });
    return;
  }

  const taskRows: {
    id: string;
    key: string;
    title: string;
    detail: string;
    artifactType: string | null;
    artifactLabel: string | null;
  }[] = [];
  for (let i = 0; i < plan.length; i++) {
    const t = plan[i];
    const row = await db.agentTask.create({
      data: {
        runId,
        key: `Task ${i + 1}`,
        parallelGroup: null,
        title: t.title,
        detail: t.detail,
        status: "pending",
        artifactType: t.artifactType,
        artifactId: null,
        artifactLabel: t.artifactLabel,
        order: i + 1,
      },
    });
    taskRows.push(row);
  }
  await emitEvent({ runId, kind: "message", summary: `Plan ready — ${taskRows.length} task${taskRows.length > 1 ? "s" : ""}. Executing in order.` });

  // Sequential execution (parallel groups arrive with Phase 5 delegate).
  const verified: Measured = { ...ZERO_MEASURED };
  const claimed: Record<string, number> = {};
  const issues: string[] = [];
  const outcomes: string[] = [];
  let doneCount = 0;

  for (const task of taskRows) {
    if (signal.aborted) break;
    const outcome = await executeTask({
      runId,
      novelId,
      task,
      snapshot,
      signal,
      measured: verified,
      claimed,
      issues,
    });
    // "skipped" = the run left the executor's hands (reject→paused gate stop
    // or cancel abort). The decision handler owns run/task status now —
    // finalizing here would overwrite `paused` with `failed`.
    if (outcome === "skipped") return;
    if (outcome === "done") doneCount += 1;
    outcomes.push(`${task.key}: ${outcome}`);
  }
  void outcomes;

  // A cancelled run is owned by the cancel handler — never write a terminal
  // report over its status.
  if (signal.aborted) return;

  // Honesty pass — claimed (model) vs verified (measured).
  for (const key of REPORT_KEYS) {
    if (key in claimed && claimed[key] !== verified[key]) {
      issues.push(`claimed ${key}=${claimed[key]} but measured ${key}=${verified[key]}`);
    }
  }

  const writeTasks = taskRows.filter((t) => t.artifactType === "chapter");
  const status: AgentRunStatus =
    doneCount > 0 || writeTasks.length === 0 ? "completed" : "failed";

  const summaryBits: string[] = [`${doneCount}/${taskRows.length} tasks done.`];
  if (verified.chaptersWritten > 0 || verified.chaptersUpdated > 0) {
    summaryBits.push(
      `Chapters: ${verified.chaptersWritten} created, ${verified.chaptersUpdated} updated · ${verified.words.toLocaleString()} words written (measured).`
    );
  }
  const report: RunFinalReport = {
    summary: summaryBits.join(" "),
    reported: Object.keys(claimed).length > 0 ? { ...claimed } : { ...verified },
    verified: { ...verified },
    blockingIssues: issues.slice(0, 12),
  };

  await db.agentRun.update({
    where: { id: runId },
    data: { status, finalReport: JSON.stringify(report) },
  });
  await emitEvent({
    runId,
    kind: "message",
    summary:
      status === "completed"
        ? `Run complete — ${report.summary}${issues.length > 0 ? ` (${issues.length} verification note${issues.length > 1 ? "s" : ""})` : ""}`
        : `Run failed — ${report.summary}`,
  });
}

// ---------------------------------------------------------------------------
// Task execution (Sage tool loop)
// ---------------------------------------------------------------------------

type TaskOutcome = "done" | "blocked" | "failed" | "skipped";

interface ToolResult {
  ok: boolean;
  feed: string;
}

async function executeTask(params: {
  runId: string;
  novelId: string;
  task: { id: string; key: string; title: string; detail: string; artifactType: string | null; artifactLabel: string | null };
  snapshot: StorySnapshotData;
  signal: AbortSignal;
  measured: Measured;
  claimed: Record<string, number>;
  issues: string[];
}): Promise<TaskOutcome> {
  const budgets = getBudgets();
  const { runId, novelId, task, snapshot, signal, measured } = params;
  const taskRef = { runId, taskId: task.id };

  await db.agentTask.update({ where: { id: task.id }, data: { status: "in_progress" } });
  await emitEvent({ ...taskRef, kind: "task_update", summary: `${task.key} started — ${task.title}` });

  const system = buildSystemPrompt("sage");
  const quotaHint =
    task.artifactLabel?.match(/chapter\s*(\d+)/i) ?? task.title.match(/chapter\s*(\d+)/i);
  const targetChapterIndex = quotaHint ? Number(quotaHint[1]) : null;

  const envelopeParts: string[] = [
    `TASK ENVELOPE — execute exactly this task, then stop.`,
    `${task.key} — ${task.title}`,
    truncate(task.detail || "(no additional detail)", budgets.prompt.taskBriefCapChars),
    "",
    "MISSION LOCK: actions beyond this brief are failures. If it is impossible, make your final line start with BLOCKED: plus the reason.",
    "",
    "STORY SNAPSHOT (measured at run start; use read tools for fresher data):",
    renderSnapshot(snapshot),
  ];
  if (targetChapterIndex) {
    envelopeParts.push("", quotaForChapter(snapshot, targetChapterIndex));
  } else {
    envelopeParts.push("", quotaForChapter(snapshot, snapshot.nextChapterIndex));
  }
  envelopeParts.push("", languageDirective(snapshot));

  type ChatMessage = { role: "assistant" | "user"; content: string };
  const messages: ChatMessage[] = [
    { role: "assistant", content: system },
    { role: "user", content: envelopeParts.join("\n") },
  ];

  const measuredForTask: Measured = { ...ZERO_MEASURED };
  let blockedReason: string | null = null;
  let repairRound = 0;
  let stoppedByGate = false;

  const glmCall = async (tag: string): Promise<string> => {
    if (signal.aborted) throw new Error("Run aborted");
    const zai = await ZAI.create();
    const completion = await withTimeout(
      zai.chat.completions.create({ messages, thinking: { type: "disabled" } }),
      budgets.glm.timeoutMs,
      tag
    );
    return completion.choices[0]?.message?.content?.trim() ?? "";
  };

  const runTurns = async (turnBudget: number): Promise<void> => {
    for (let turn = 1; turn <= turnBudget; turn++) {
      if (signal.aborted) throw new Error("Run aborted");
      const reply = await glmCall(`${task.key} turn ${turn}`);
      const parsed = parseAgentTurn(reply);

      if (parsed.narration) {
        await emitEvent({
          ...taskRef,
          kind: "message",
          summary: truncate(parsed.narration.replace(/BLOCKED[:：][\s\S]*/g, "").trim() || parsed.narration, 280),
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
          prose: parsed.novelWrite,
          runId,
          novelId,
          taskId: task.id,
          taskKey: task.key,
          measured: measuredForTask,
          signal,
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

      if (parsed.endsLoop) return;

      messages.push({ role: "assistant", content: reply });
      messages.push({
        role: "user",
        content: `TOOL RESULTS:\n${feeds.join("\n") || "(no actions parsed — use ```novel-tool blocks)"}`,
      });
    }
  };

  try {
    await runTurns(budgets.glm.maxTurns);

    // A gate stop means the author decided (reject→paused / cancel) or the
    // wait ended — the handler owns task & run status; never touch them here.
    if (stoppedByGate) return "skipped";

    // Write verification for chapter tasks — repair rounds before failure.
    const requiresWrite = task.artifactType === "chapter";
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
        kind: "error",
        summary: `Write verification failed — no verified DB write. Repair round ${repairRound}/${budgets.glm.repairRounds}.`,
      });
      messages.push({
        role: "user",
        content:
          "VERIFY FAILED: this task required a chapter write but nothing was committed. " +
          "Reply with create_chapter/update_chapter plus a ```novel-write block NOW, " +
          "or make your final line BLOCKED: with the reason. Narration alone will fail again.",
      });
      await runTurns(2);
    }

    // Fold this task's measured numbers into the run totals.
    measured.chaptersWritten += measuredForTask.chaptersWritten;
    measured.chaptersUpdated += measuredForTask.chaptersUpdated;
    measured.outlineBeatsUpdated += measuredForTask.outlineBeatsUpdated;
    measured.words += measuredForTask.words;

    let outcome: TaskOutcome;
    if (blockedReason) {
      await db.agentTask.update({ where: { id: task.id }, data: { status: "blocked" } });
      await emitEvent({ ...taskRef, kind: "task_update", summary: `${task.key} blocked: ${truncate(blockedReason, 200)}` });
      params.issues.push(`${task.key} blocked: ${blockedReason}`);
      outcome = "blocked";
    } else if (requiresWrite && measuredForTask.chaptersWritten + measuredForTask.chaptersUpdated === 0) {
      await db.agentTask.update({ where: { id: task.id }, data: { status: "failed" } });
      await emitEvent({ ...taskRef, kind: "task_update", summary: `${task.key} failed — write verification never passed.` });
      params.issues.push(`${task.key} failed: no verified write after ${budgets.glm.repairRounds} repair round(s)`);
      outcome = "failed";
    } else {
      await db.agentTask.update({ where: { id: task.id }, data: { status: "done" } });
      await emitEvent({ ...taskRef, kind: "task_update", summary: `${task.key} done (write verified in DB).` });
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
    await emitEvent({ ...taskRef, kind: "error", summary: `${task.key} failed: ${truncate(message, 250)}` });
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
  taskId: string;
  taskKey: string;
  measured: Measured;
  signal: AbortSignal;
}

async function executeTool(params: ExecuteToolParams): Promise<ToolResult & { stopped?: boolean }> {
  const { action, prose } = params;
  const budgets = getBudgets();

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
      return {
        ok: true,
        feed: `read_chapter(${action.index}) → ok ("${chapter.title}", ${chapter.wordCount} words)\n${chapter.content.slice(0, budgets.glm.chapterContextChars) || "(empty)"}`,
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

      if (run?.mode === "approval") {
        return await pauseForApproval({
          ...params,
          payload: {
            pending: true,
            action: "create_chapter",
            kind: "chapter_settle",
            taskId: params.taskId,
            taskKey: params.taskKey,
            novelId: params.novelId,
            index,
            chapterId: null,
            title: action.title,
            targetLabel: `Chapter ${index} — chapter ${index} of the novel`,
            wordCount: words,
            existingWords: 0,
            content: prose,
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
        },
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
          payload: {
            pending: true,
            action: "update_chapter",
            kind: verdict.blocked ? "bulk_rewrite" : "chapter_settle",
            taskId: params.taskId,
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
          pendingSummary: `Rewrite of Chapter ${chapter.index} ready (~${words.toLocaleString()} words) — awaiting approval.`,
        });
      }

      await db.chapter.update({
        where: { id: chapter.id },
        data: { content: prose, wordCount: words },
      });
      await db.novel.update({ where: { id: params.novelId }, data: { updatedAt: new Date() } });
      params.measured.chaptersUpdated += 1;
      params.measured.words += Math.max(0, words - verdict.existingWords);
      await emitEvent({
        runId: params.runId,
        taskId: params.taskId,
        kind: "write",
        summary: `Updated Chapter ${chapter.index} "${truncate(chapter.title, 80)}" — now ${words.toLocaleString()} words (verified in DB).`,
        payload: { artifact: "chapter", chapterId: chapter.id, index: chapter.index, words },
      });
      return { ok: true, feed: `update_chapter(${chapter.index}) → ok: content replaced, ${words} words (verified).` };
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
  const deadline = Date.now() + 30 * 60 * 1000;
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
