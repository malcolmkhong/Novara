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
  /** P2 — model registry id + thinking level this run executes with. */
  modelId: string;
  thinkingLevel: string;
  finalReport: RunFinalReport | null;
  /** Pinned context refs the author attached in the chat composer (Phase 8). */
  pinned: PinnedRef[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Context usage (P2 — what one GLM call actually sends, per section)
// ---------------------------------------------------------------------------

/**
 * Measured (or estimated) token breakdown of one agent conversation.
 * `system`/`tools`/`skills` are fixed per conversation; `novel` is the
 * story snapshot + pinned refs; `conversation` grows per turn; `mcp` is a
 * reserved 0 row — this system has no MCP server.
 */
export interface ContextUsage {
  modelId: string;
  contextWindow: number;
  used: number;
  /** Which call produced it, e.g. "atlas · turn 2" or "estimate". */
  actor: string;
  sections: {
    system: number;
    tools: number;
    skills: number;
    novel: number;
    conversation: number;
    mcp: number;
  };
  updatedAt: string;
  /**
   * P4 — REAL usage the provider billed for this call. `used` equals
   * real.promptTokens and the sections are the local estimate scaled
   * proportionally to that measured total (split stays an estimate, total
   * does not). null = provider usage unavailable, everything is a local
   * estimate.
   */
  real?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Pinned context (Phase 8 — Pin-to-Chat)
// ---------------------------------------------------------------------------

/**
 * A reference the author pinned into the chat composer before starting a
 * run. The runtime RESOLVES each ref against the DB (never trusts client
 * content) and injects the material into the leader + member envelopes.
 */
export type PinnedRefType =
  | "chapter"
  | "character"
  | "world_entry"
  | "outline_beat"
  | "volume"
  | "pack"
  | "contract"
  | "concept"
  | "digest";

export interface PinnedRef {
  type: PinnedRefType;
  /** DB id of the target (empty for novel-level docs like contract). */
  id: string;
  /** Display label for the chip tray (e.g. "第8章 · The Inspection"). */
  label: string;
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

/** Member roles (Phase 5) — registry in agent/config/team.yaml. */
export type AgentRoleId = "atlas" | "sage" | "nova" | "prism" | "forge";

export interface AgentTask {
  id: string;
  runId: string;
  /** Display key, e.g. "Task 1", "Task 3-a" (letter = parallel group member). */
  key: string;
  /** Set when this task runs in parallel with siblings, e.g. "Task 3". */
  parallelGroup: string | null;
  /** Member role executing this task (Phase 5 delegate). */
  assignee: AgentRoleId;
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
  | "approval"
  /** P2 — per-GLM-call Context Usage snapshot (payload: ContextUsage). */
  | "usage";

export interface AgentEvent {
  id: string;
  runId: string;
  taskId: string | null;
  /** Member that produced the event (Phase 5 role attribution). */
  actor: AgentRoleId | "author";
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

/** Latest ContextUsage among a detail's events (null before the first call). */
export function latestContextUsage(events: AgentEvent[]): ContextUsage | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind !== "usage") continue;
    const payload = event.payload as { usage?: ContextUsage } | null;
    if (payload?.usage?.sections && typeof payload.usage.used === "number") {
      return payload.usage;
    }
  }
  return null;
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
// Memory & doctor (Phase 4 — live since the sediment pipeline + retrieval
// engine: GET /api/novels/[id]/memory, lib/novara/memory.ts)
// ---------------------------------------------------------------------------

export type MemoryCategory =
  | "world_rule"
  | "character_state"
  | "relationship"
  | "story_fact"
  | "open_loop"
  // Phase 7 — webnovel-writer 本书记忆 analogs (决策/文风/对话/灵感).
  | "decision"
  | "style"
  | "dialogue"
  | "inspiration";

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  content: string;
  sourceChapter: number | null;
  firstSeen: string;
  lastSeen: string;
  /** Chapter that last resurfaced the item (sediment touch). */
  lastSeenChapter?: number | null;
  /** open_loop items only: foreshadow state machine position. */
  status?: "open" | "advanced" | "paid";
}

export interface MemoryDigestRow {
  chapterIndex: number;
  title: string;
  summary: string;
}

export interface NovelMemoryView {
  novelId: string;
  items: MemoryItem[];
  digests: MemoryDigestRow[];
  doctor: DoctorCheck[];
  stats: {
    facts: number;
    /** open_loop-category items that arrived via FACT lines (no ledger row). */
    loopFacts: number;
    states: number;
    loopsOpen: number;
    loopsAdvanced: number;
    loopsPaid: number;
    digests: number;
    chapters: number;
  };
  generatedAt: string;
}

export interface DoctorCheck {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}
