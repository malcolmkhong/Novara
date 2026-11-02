// ---------------------------------------------------------------------------
// Novara AI — AI Writer UI configuration.
// Single source of truth for status metadata, tab layout and mock budgets.
// Components read from here; never hard-code status colors/labels inline.
// ---------------------------------------------------------------------------

import type {
  AgentEventKind,
  AgentRunStatus,
  AgentTaskStatus,
  ReviewSeverity,
} from "@/lib/novara/agent-types";

// ---------------------------------------------------------------------------
// Task status metadata (Todos board rows) — development plan §4.1
// ---------------------------------------------------------------------------

export const TASK_STATUS_META: Record<
  AgentTaskStatus,
  { label: string; /** tailwind classes for the row highlight */ rowClass: string; badgeClass: string }
> = {
  pending: {
    label: "Pending",
    rowClass: "",
    badgeClass: "text-muted-foreground",
  },
  in_progress: {
    label: "In progress",
    rowClass: "bg-primary/5",
    badgeClass: "text-primary",
  },
  needs_approval: {
    label: "Needs approval",
    rowClass: "bg-amber-50 border-amber-200",
    badgeClass: "text-amber-700",
  },
  blocked: {
    label: "Blocked",
    rowClass: "bg-muted/60",
    badgeClass: "text-muted-foreground",
  },
  failed: {
    label: "Failed",
    rowClass: "bg-rose-50",
    badgeClass: "text-rose-700",
  },
  done: {
    label: "Done",
    rowClass: "",
    badgeClass: "text-emerald-700",
  },
};

// ---------------------------------------------------------------------------
// Run status metadata
// ---------------------------------------------------------------------------

export const RUN_STATUS_META: Record<
  AgentRunStatus,
  { label: string; badgeClass: string }
> = {
  running: { label: "Running", badgeClass: "bg-primary/10 text-primary border-primary/30" },
  awaiting_approval: {
    label: "Awaiting approval",
    badgeClass: "bg-amber-100 text-amber-800 border-amber-300",
  },
  paused: { label: "Paused", badgeClass: "bg-muted text-muted-foreground" },
  completed: {
    label: "Completed",
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
  },
  failed: { label: "Failed", badgeClass: "bg-rose-100 text-rose-800 border-rose-300" },
  cancelled: { label: "Cancelled", badgeClass: "bg-muted text-muted-foreground" },
};

// ---------------------------------------------------------------------------
// Event kind metadata (activity stream)
// ---------------------------------------------------------------------------

export const EVENT_KIND_META: Record<AgentEventKind, { label: string }> = {
  task_update: { label: "Task" },
  tool_call: { label: "Tool" },
  write: { label: "Write" },
  message: { label: "Agent" },
  error: { label: "Error" },
  approval: { label: "Approval" },
};

// ---------------------------------------------------------------------------
// Review severity metadata (Phase 2 preview)
// ---------------------------------------------------------------------------

export const REVIEW_SEVERITY_META: Record<
  ReviewSeverity,
  { label: string; badgeClass: string }
> = {
  critical: { label: "Critical", badgeClass: "bg-rose-100 text-rose-800 border-rose-300" },
  major: { label: "Major", badgeClass: "bg-amber-100 text-amber-800 border-amber-300" },
  minor: { label: "Minor", badgeClass: "bg-muted text-muted-foreground" },
  suggestion: { label: "Suggestion", badgeClass: "bg-muted text-muted-foreground" },
};

// ---------------------------------------------------------------------------
// Workspace tab layout
// ---------------------------------------------------------------------------

export type WriterTabId =
  | "chapters"
  | "characters"
  | "world"
  | "outline"
  | "team"
  | "review"
  | "memory";

export interface WriterTabDef {
  id: WriterTabId;
  label: string;
  /** Badge shown next to the label, e.g. roadmap phase marker. */
  phaseTag?: string;
}

export const WRITER_TABS: WriterTabDef[] = [
  { id: "chapters", label: "Chapters" },
  { id: "characters", label: "Characters" },
  { id: "world", label: "World" },
  { id: "outline", label: "Outline" },
  { id: "team", label: "AI Team" },
  { id: "review", label: "Review", phaseTag: "Phase 2" },
  { id: "memory", label: "Memory", phaseTag: "Phase 4" },
];

// ---------------------------------------------------------------------------
// Mock budgets (placeholder for agent/config/budgets.yaml, plan §2.10)
// ---------------------------------------------------------------------------

export const MOCK_BUDGETS = {
  /** Simulated drafting time per step, ms. */
  stepDelayMs: 1400,
  /** Simulated draft length per chapter task. */
  draftWordsPerChapter: 1850,
  /** Max tool rounds per agent turn (mirrors the planned hard cap). */
  maxToolRounds: 3,
  /** Approval auto-grant delay in full-access mode, ms. */
  fullAccessAutoApproveMs: 1500,
} as const;

/** honesty: the mock final report always matches verified numbers. */
export const AGENT_BACKEND_LABEL = "Mock runtime — real agent backend arrives in Phase 3";
