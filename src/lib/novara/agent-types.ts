// ---------------------------------------------------------------------------
// Novara AI — Agent runtime types (client + server shared).
//
// These shapes are the contract behind the Agent Task Board (development plan
// §4.1, decisions D1/D2). The live backend (AgentRun/AgentTask/AgentEvent
// tables + SSE) lands in Phase 3; until then the UI runs against the mock
// gateway in `agent-client.ts`. The shapes below are final — Phase 3 API
// routes must serialize exactly these.
//
// Honesty rule baked into the contract: a task's `done` flip is produced by
// the runtime AFTER a verified write, never by model self-report. The mock
// engine respects the same rule so the UI cannot grow around shortcuts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type AgentRunMode = "approval" | "full_access";

// running → awaiting_approval → (paused) → completed | failed | cancelled
export type AgentRunStatus =
  | "running"
  | "awaiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** What a run touched, used for task→artifact binding and activity display. */
export type ArtifactType =
  | "chapter"
  | "character"
  | "world_entry"
  | "outline_beat";

export interface RunFinalReport {
  summary: string;
  /**
   * Numbers the runtime CLAIMS vs numbers measured from the source of truth.
   * For the mock both match; the Phase 3 verifier keeps them honest.
   */
  reported: Record<string, number>;
  verified: Record<string, number>;
  blockingIssues: string[];
}

export interface AgentRun {
  id: string;
  novelId: string;
  goal: string;
  mode: AgentRunMode;
  status: AgentRunStatus;
  finalReport: RunFinalReport | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Tasks (the Todos board)
// ---------------------------------------------------------------------------

// pending → in_progress → needs_approval → done
//                       ↘ blocked / failed (repair rounds may return to in_progress)
export type AgentTaskStatus =
  | "pending"
  | "in_progress"
  | "needs_approval"
  | "blocked"
  | "failed"
  | "done";

export interface AgentTask {
  id: string;
  runId: string;
  /** Display key, e.g. "Task 1", "Task 3-a" (letter = parallel group member). */
  key: string;
  /** Set when this task runs in parallel with siblings, e.g. "Task 3". */
  parallelGroup: string | null;
  title: string;
  detail: string;
  status: AgentTaskStatus;
  artifactType: ArtifactType | null;
  artifactId: string | null;
  artifactLabel: string | null;
  order: number;
}

// ---------------------------------------------------------------------------
// Events (the activity stream — also the SSE payload in Phase 3)
// ---------------------------------------------------------------------------

export type AgentEventKind =
  | "task_update"
  | "tool_call"
  | "write"
  | "message"
  | "error"
  | "approval";

export interface AgentEvent {
  id: string;
  runId: string;
  taskId: string | null;
  kind: AgentEventKind;
  summary: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface AgentRunDetail {
  run: AgentRun;
  tasks: AgentTask[];
  events: AgentEvent[];
  /** Present while the run is awaiting_approval (the D2 gate payload). */
  pendingApproval: ApprovalRequest | null;
}

// ---------------------------------------------------------------------------
// Approval gate (D2 — Approval mode)
// ---------------------------------------------------------------------------

export type ApprovalKind = "chapter_settle" | "bulk_rewrite" | "delete";

export interface ApprovalRequest {
  runId: string;
  taskId: string;
  kind: ApprovalKind;
  title: string;
  /** Human-readable description of exactly what will be written. */
  summary: string;
  /** Where it lands, e.g. "Chapter 3 — The Ledger Opens at Midnight". */
  targetLabel: string;
  wordCount: number | null;
}

// ---------------------------------------------------------------------------
// Review / quality (Phase 2 — mock data today)
// ---------------------------------------------------------------------------

export type ReviewSeverity = "critical" | "major" | "minor" | "suggestion";

export interface ReviewIssue {
  id: string;
  category: string;
  severity: ReviewSeverity;
  blocking: boolean;
  /** Where in the chapter, e.g. "Paragraph 4" or "Dialogue, scene 2". */
  location: string;
  evidence: string;
  fixHint: string | null;
}

export interface ChapterReview {
  chapterId: string;
  issues: ReviewIssue[];
  reviewedAt: string;
  /** True only for the legacy deterministic mock generator. */
  mock: boolean;
}

// ---------------------------------------------------------------------------
// Memory & doctor (Phase 4 — mock data today)
// ---------------------------------------------------------------------------

export type MemoryCategory =
  | "world_rule"
  | "character_state"
  | "relationship"
  | "story_fact"
  | "open_loop";

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  content: string;
  sourceChapter: number | null;
  firstSeen: string;
  lastSeen: string;
}

export interface DoctorCheck {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}
