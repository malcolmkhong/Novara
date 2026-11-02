// ---------------------------------------------------------------------------
// Novara AI — MOCK agent runtime (UI foundation, development plan §4.1).
//
// Simulates the full D1/D2 contract end to end:
//   - Leader decomposes a goal into a task list (parallel groups included)
//   - Tasks progress through the status machine with timed steps
//   - Approval mode pauses at the settle gate; full access auto-grants
//   - Final report follows the honesty rule (reported === verified)
//
// State is in-memory only and writes are simulated — nothing touches the DB.
// Phase 3 replaces this module with real API routes + SSE; `agent-client.ts`
// is the single swap point and the UI never imports this file directly.
// ---------------------------------------------------------------------------

import { MOCK_BUDGETS } from "@/config/writer";
import type {
  AgentEvent,
  AgentEventKind,
  AgentRunDetail,
  AgentRunMode,
  AgentRunStatus,
  AgentTask,
  ApprovalRequest,
  RunFinalReport,
} from "./agent-types";
import { startRunInputSchema, type MockStartOptions, type StartRunInput } from "./agent-schemas";

interface MockRun {
  detail: AgentRunDetail;
  timers: ReturnType<typeof setTimeout>[];
  listeners: Set<(detail: AgentRunDetail) => void>;
  pendingApproval: ApprovalRequest | null;
  /** Kept internally for gate labels; never serialized into the DTO. */
  novelTitle: string;
  chapterCount: number;
}

const runs = new Map<string, MockRun>();

let seq = 0;
const uid = (prefix: string) =>
  `${prefix}_mock_${Date.now().toString(36)}_${(seq++).toString(36)}`;

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Notification plumbing
// ---------------------------------------------------------------------------

function snapshotOf(run: MockRun): AgentRunDetail {
  return {
    run: { ...run.detail.run },
    tasks: run.detail.tasks.map((t) => ({ ...t })),
    events: [...run.detail.events],
    pendingApproval: run.pendingApproval ? { ...run.pendingApproval } : null,
  };
}

function notify(run: MockRun) {
  run.detail.run.updatedAt = now();
  const snapshot = snapshotOf(run);
  run.listeners.forEach((cb) => cb(snapshot));
}

function emit(
  run: MockRun,
  partial: {
    taskId?: string | null;
    kind: AgentEventKind;
    summary: string;
    payload?: Record<string, unknown>;
  }
) {
  const event: AgentEvent = {
    id: uid("evt"),
    runId: run.detail.run.id,
    taskId: partial.taskId ?? null,
    actor: "sage",
    kind: partial.kind,
    summary: partial.summary,
    payload: partial.payload ?? null,
    createdAt: now(),
  };
  run.detail.events.push(event);
}

function later(run: MockRun, ms: number, fn: () => void) {
  run.timers.push(setTimeout(fn, ms));
}

function clearTimers(run: MockRun) {
  run.timers.forEach(clearTimeout);
  run.timers = [];
}

function setStatus(run: MockRun, status: AgentRunStatus) {
  run.detail.run.status = status;
}

function setTask(run: MockRun, key: string, patch: Partial<AgentTask>) {
  const task = run.detail.tasks.find((t) => t.key === key);
  if (task) Object.assign(task, patch);
}

function taskByKey(run: MockRun, key: string): AgentTask | undefined {
  return run.detail.tasks.find((t) => t.key === key);
}

// ---------------------------------------------------------------------------
// Goal decomposition (D1 — the agent arranges its own task list)
// ---------------------------------------------------------------------------

function decompose(input: StartRunInput, chapterCount: number): AgentTask[] {
  const nextChapter = chapterCount + 1;
  const tasks: AgentTask[] = [
    {
      id: uid("task"),
      runId: "",
      assignee: "sage",
      key: "Task 1",
      parallelGroup: null,
      title: "Analyze goal & story state",
      detail: `Read the story bible and current chapters to frame “${input.goal}”.`,
      status: "pending",
      artifactType: null,
      artifactId: null,
      artifactLabel: null,
      order: 1,
    },
    {
      id: uid("task"),
      runId: "",
      assignee: "sage",
      key: "Task 2",
      parallelGroup: null,
      title: "Update story bible",
      detail: "Record new world rules and character states implied by the goal.",
      status: "pending",
      artifactType: "world_entry",
      artifactId: null,
      artifactLabel: "Story bible",
      order: 2,
    },
    {
      id: uid("task"),
      runId: "",
      assignee: "sage",
      key: "Task 3-a",
      parallelGroup: "Task 3",
      title: `Draft chapter ${nextChapter}`,
      detail: "Write the chapter draft against the outline and the bible.",
      status: "pending",
      artifactType: "chapter",
      artifactId: null,
      artifactLabel: `Chapter ${nextChapter}`,
      order: 3,
    },
    {
      id: uid("task"),
      runId: "",
      assignee: "sage",
      key: "Task 3-b",
      parallelGroup: "Task 3",
      title: "Sync outline beats",
      detail: "Mark the beats this goal advances; note any new open loops.",
      status: "pending",
      artifactType: "outline_beat",
      artifactId: null,
      artifactLabel: "Outline",
      order: 4,
    },
    {
      id: uid("task"),
      runId: "",
      assignee: "sage",
      key: "Task 4",
      parallelGroup: null,
      title: "Review & settle draft",
      detail: "Check blocking issues, then settle the draft into the novel.",
      status: "pending",
      artifactType: "chapter",
      artifactId: null,
      artifactLabel: `Chapter ${nextChapter}`,
      order: 5,
    },
  ];
  return tasks;
}

// ---------------------------------------------------------------------------
// Scripted execution
// ---------------------------------------------------------------------------

function scriptRun(run: MockRun) {
  const mode = run.detail.run.mode;
  const step = MOCK_BUDGETS.stepDelayMs;
  const draftWords = MOCK_BUDGETS.draftWordsPerChapter;
  const nextChapter = run.chapterCount + 1;

  // Task 1 — analyze
  later(run, 400, () => {
    setTask(run, "Task 1", { status: "in_progress" });
    emit(run, { kind: "message", summary: "Goal received — planning the work." });
    notify(run);
  });
  later(run, 400 + step, () => {
    emit(run, {
      taskId: taskByKey(run, "Task 1")?.id ?? null,
      kind: "tool_call",
      summary: "read story bible, characters, outline (mock)",
    });
    notify(run);
  });
  later(run, 400 + step * 2, () => {
    setTask(run, "Task 1", { status: "done" });
    emit(run, { taskId: taskByKey(run, "Task 1")?.id ?? null, kind: "task_update", summary: "Task 1 done — story state framed." });
    // Task 2 — bible
    setTask(run, "Task 2", { status: "in_progress" });
    notify(run);
  });
  later(run, 400 + step * 3, () => {
    emit(run, {
      taskId: taskByKey(run, "Task 2")?.id ?? null,
      kind: "write",
      summary: "story bible notes updated (simulated — nothing saved)",
      payload: { artifact: "world_entry", simulated: true },
    });
    setTask(run, "Task 2", { status: "done" });
    emit(run, { taskId: taskByKey(run, "Task 2")?.id ?? null, kind: "task_update", summary: "Task 2 done." });
    // Parallel group Task 3
    setTask(run, "Task 3-a", { status: "in_progress" });
    setTask(run, "Task 3-b", { status: "in_progress" });
    emit(run, { kind: "message", summary: "Dispatching parallel work: drafting + outline sync." });
    notify(run);
  });
  later(run, 400 + step * 4, () => {
    emit(run, {
      taskId: taskByKey(run, "Task 3-a")?.id ?? null,
      kind: "tool_call",
      summary: "read previous chapter tail for continuity (mock)",
    });
    emit(run, {
      taskId: taskByKey(run, "Task 3-b")?.id ?? null,
      kind: "tool_call",
      summary: "read outline beats (mock)",
    });
    notify(run);
  });
  later(run, 400 + step * 5, () => {
    emit(run, {
      taskId: taskByKey(run, "Task 3-a")?.id ?? null,
      kind: "write",
      summary: `drafted ~${draftWords} words for chapter ${nextChapter} (simulated — not saved)`,
      payload: { artifact: "chapter", simulated: true, words: draftWords },
    });
    setTask(run, "Task 3-a", { status: "done" });
    setTask(run, "Task 3-b", { status: "done" });
    emit(run, { taskId: taskByKey(run, "Task 3-b")?.id ?? null, kind: "task_update", summary: "Outline synced; 1 beat advanced." });
    // Task 4 — review + gate
    setTask(run, "Task 4", { status: "in_progress" });
    notify(run);
  });
  later(run, 400 + step * 6, () => {
    emit(run, {
      taskId: taskByKey(run, "Task 4")?.id ?? null,
      kind: "tool_call",
      summary: "review draft: 0 blocking issues (mock)",
    });
    if (mode === "full_access") {
      emit(run, { kind: "approval", summary: "Settle gate auto-approved (full access mode)." });
      settleRun(run);
    } else {
      const request: ApprovalRequest = {
        runId: run.detail.run.id,
        taskId: taskByKey(run, "Task 4")!.id,
        kind: "chapter_settle",
        title: "Settle chapter draft",
        summary: `The team drafted chapter ${nextChapter} (~${draftWords} words, simulated). Approving will settle it into the novel in the real runtime; nothing is written until you approve.`,
        targetLabel: `Chapter ${nextChapter} — ${run.novelTitle}`,
        wordCount: draftWords,
      };
      run.pendingApproval = request;
      setTask(run, "Task 4", { status: "needs_approval" });
      setStatus(run, "awaiting_approval");
      emit(run, {
        taskId: taskByKey(run, "Task 4")?.id ?? null,
        kind: "approval",
        summary: "Waiting for your approval to settle the draft.",
        payload: { kind: request.kind },
      });
    }
    notify(run);
  });
}

function settleRun(run: MockRun) {
  setTask(run, "Task 4", { status: "done" });
  const report: RunFinalReport = {
    summary: `Simulated run completed: story state analyzed, bible updated, chapter ${run.chapterCount + 1} drafted and settled. All numbers below are measured, not claimed.`,
    reported: { chaptersDrafted: 1, bibleEntriesTouched: 1, wordsSimulated: MOCK_BUDGETS.draftWordsPerChapter },
    verified: { chaptersDrafted: 1, bibleEntriesTouched: 1, wordsSimulated: MOCK_BUDGETS.draftWordsPerChapter },
    blockingIssues: [],
  };
  run.detail.run.finalReport = report;
  setStatus(run, "completed");
  emit(run, { kind: "message", summary: "Run complete — final report attached (mock)." });
  run.pendingApproval = null;
  notify(run);
}

// ---------------------------------------------------------------------------
// Gateway implementation
// ---------------------------------------------------------------------------

function attach(run: MockRun) {
  runs.set(run.detail.run.id, run);
  run.detail.tasks.forEach((t) => (t.runId = run.detail.run.id));
}

export const mockAgentRuntime = {
  start(options: MockStartOptions): AgentRunDetail {
    const parsed = startRunInputSchema.parse(options);
    const existing = mockAgentRuntime.activeRunFor(parsed.novelId);
    if (existing) {
      throw new Error("This novel already has an active run. Cancel or finish it first.");
    }
    const run: MockRun = {
      detail: {
        run: {
          id: uid("run"),
          novelId: parsed.novelId,
          goal: parsed.goal,
          mode: parsed.mode,
          status: "running",
          finalReport: null,
          createdAt: now(),
          updatedAt: now(),
        },
        tasks: [],
        events: [],
        pendingApproval: null,
      },
      timers: [],
      listeners: new Set(),
      pendingApproval: null,
      novelTitle: options.novelTitle,
      chapterCount: options.chapterCount,
    };
    run.detail.tasks = decompose(parsed, options.chapterCount);
    attach(run);
    emit(run, { kind: "message", summary: `Leader received the goal: “${parsed.goal}”` });
    notify(run);
    scriptRun(run);
    return snapshotOf(run);
  },

  activeRunFor(novelId: string): AgentRunDetail | null {
    for (const run of runs.values()) {
      if (
        run.detail.run.novelId === novelId &&
        ["running", "awaiting_approval", "paused"].includes(run.detail.run.status)
      ) {
        return snapshotOf(run);
      }
    }
    return null;
  },

  get(runId: string): AgentRunDetail | null {
    const run = runs.get(runId);
    return run ? snapshotOf(run) : null;
  },

  subscribe(runId: string, cb: (detail: AgentRunDetail) => void): () => void {
    const run = runs.get(runId);
    if (!run) return () => undefined;
    run.listeners.add(cb);
    return () => run.listeners.delete(cb);
  },

  approve(runId: string, _taskId: string): AgentRunDetail {
    const run = runs.get(runId);
    if (!run) throw new Error("Run not found");
    if (run.detail.run.status !== "awaiting_approval") {
      throw new Error("This run is not waiting for approval");
    }
    emit(run, { kind: "approval", summary: "Approved by author — settling the draft." });
    settleRun(run);
    return snapshotOf(run);
  },

  reject(runId: string, _taskId: string): AgentRunDetail {
    const run = runs.get(runId);
    if (!run) throw new Error("Run not found");
    if (run.detail.run.status !== "awaiting_approval") {
      throw new Error("This run is not waiting for approval");
    }
    run.pendingApproval = null;
    setTask(run, "Task 4", { status: "blocked" });
    setStatus(run, "paused");
    emit(run, {
      kind: "message",
      summary: "Paused by author — nothing was written. You can cancel the run or start a new one.",
    });
    notify(run);
    return snapshotOf(run);
  },

  cancel(runId: string): AgentRunDetail {
    const run = runs.get(runId);
    if (!run) throw new Error("Run not found");
    clearTimers(run);
    run.pendingApproval = null;
    for (const task of run.detail.tasks) {
      if (task.status === "in_progress" || task.status === "needs_approval") {
        task.status = "blocked";
      }
    }
    setStatus(run, "cancelled");
    emit(run, { kind: "message", summary: "Run cancelled by author. Simulated writes were discarded." });
    notify(run);
    return snapshotOf(run);
  },

  setMode(runId: string, mode: AgentRunMode): AgentRunDetail {
    const run = runs.get(runId);
    if (!run) throw new Error("Run not found");
    run.detail.run.mode = mode;
    emit(run, {
      kind: "message",
      summary:
        mode === "full_access"
          ? "Switched to full access — remaining gates will auto-approve."
          : "Switched to approval mode — remaining gates will wait for you.",
    });
    notify(run);
    return snapshotOf(run);
  },
};
