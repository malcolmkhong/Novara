"use client";

// ---------------------------------------------------------------------------
// Novara AI — Workbench center pane: the agent conversation.
//
// This is the primary surface of the product (plan §4.1, D1/D2):
//   - Chat view: the run's event stream rendered as a conversation — agent
//     messages as bubbles, consecutive tool calls/writes collapsed into
//     process groups, errors as alert cards, and the approval gate INLINE
//     in the flow (never hidden behind a modal).
//   - Board view: the D1 Todos board + compact activity log.
//   - Composer: goal input with the D2 mode switch; while a run is active
//     the composer becomes the run control bar.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  MessageSquare,
  PanelRight,
  PenLine,
  ShieldCheck,
  Wrench,
  X,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useCredits } from "@/hooks/use-credits";
import type { UseAgentRunResult } from "@/hooks/use-agent-run";
import { useWriterStore } from "@/hooks/use-writer-store";
import { listNovelRuns } from "@/lib/novara/api";
import { AGENT_BACKEND } from "@/lib/novara/agent-client";
import {
  type AgentEvent,
  type AgentRun,
  type AgentRunMode,
  type AgentRunStatus,
  type RunFinalReport,
} from "@/lib/novara/agent-types";
import {
  defaultSelection,
  getModelDefinition,
  type ModelSelection,
} from "@/lib/novara/models";
import type { CreditsSnapshot } from "@/lib/usage/usage-shapes";
import type { NovelMeta } from "@/lib/novara/types";
import { AGENT_BACKEND_LABEL, RUN_STATUS_META } from "@/config/writer";
import { cn } from "@/lib/utils";
import { ActivityStream } from "./activity-stream";
import { ContextUsageSegment } from "./context-usage-panel";
import { ModeSwitch } from "./mode-switch";
import { PromptBox, type PinOption } from "./prompt-box";
import { TaskBoard } from "./task-board";
import { Spinner } from "@/components/novara/primitives";
import { TEXT_META, TEXT_CAPTION } from "@/components/novara/styles";

const ACTIVE_STATUSES: readonly AgentRunStatus[] = [
  "running",
  "awaiting_approval",
];

// Phase 5: per-member avatar + name accents in the conversation stream.
const ACTOR_AVATAR: Record<string, string> = {
  atlas: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  sage: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  nova: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  prism: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  forge: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  author: "bg-primary/10 text-primary",
};
const ACTOR_NAME: Record<string, string> = {
  atlas: "text-violet-700 dark:text-violet-400",
  sage: "text-emerald-700 dark:text-emerald-400",
  nova: "text-amber-700 dark:text-amber-400",
  prism: "text-rose-700 dark:text-rose-400",
  forge: "text-teal-700 dark:text-teal-400",
};

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/**
 * STEP 67 — compact relative time ("now", "12m", "3h", "2d"). The rail's run
 * rows use the same idea with an " ago" suffix (asset-tree.tsx:106); the
 * summary line keeps the bare token.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * STEP 67 — ONE run summary line, collapsed by default:
 *
 *   Completed · 4/5 tasks · 1,842 words · 2 reviews, clean · 12m
 *
 * It replaces the "Last run" card: the answer to "what is my team doing?"
 * used to be stated three times before the reader saw anything. Clicking
 * expands the final report IN PLACE — the report is rendered nowhere else
 * in the stream, so exactly one report is on screen at a time.
 *
 * While the run is still in flight there is no report yet: the line renders
 * as plain text — no expander, no dead button.
 */
function RunSummaryLine({
  status,
  tasksDone,
  tasksTotal,
  words,
  reviewsRun,
  blockingFound,
  updatedAt,
  expanded,
  hasReport,
  onToggle,
}: {
  status: AgentRunStatus;
  tasksDone: number;
  tasksTotal: number;
  words: number;
  reviewsRun: number;
  blockingFound: number;
  updatedAt: string;
  expanded: boolean;
  hasReport: boolean;
  onToggle: () => void;
}) {
  const parts: string[] = [RUN_STATUS_META[status].label];
  if (tasksTotal > 0) parts.push(`${tasksDone}/${tasksTotal} tasks`);
  if (words > 0) parts.push(`${words.toLocaleString("en-US")} words`);
  if (reviewsRun > 0) {
    parts.push(
      `${reviewsRun} review${reviewsRun === 1 ? "" : "s"}${
        blockingFound > 0 ? `, ${blockingFound} blocking` : ", clean"
      }`
    );
  }
  const when = relativeTime(updatedAt);
  if (when) parts.push(when);

  const content = (
    <>
      <span className="truncate">{parts.join(" · ")}</span>
      {hasReport && (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          Report
          <ChevronRight
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
            aria-hidden="true"
          />
        </span>
      )}
    </>
  );

  if (!hasReport) {
    return (
      <div className="flex w-full items-center gap-2 rounded-lg border bg-card/40 px-3 py-2 text-left text-[12px] text-muted-foreground">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-center gap-2 rounded-lg border bg-card/40 px-3 py-2 text-left text-[12px] text-muted-foreground hover:bg-accent/40"
    >
      {content}
    </button>
  );
}

/** STEP 67 — the empty state's three starters. Each one fills the composer
 *  (it never submits) so the author edits before sending. */
const STARTER_PROMPTS = [
  "Draft chapter 1 from the outline",
  "Review the last chapter for continuity",
  "Plan the next three scenes",
] as const;

function FinalReportCard({ report }: { report: RunFinalReport }) {
  const keys = Array.from(
    new Set([...Object.keys(report.reported), ...Object.keys(report.verified)])
  ).sort();
  const allMatch =
    keys.length > 0 &&
    keys.every((k) => report.reported[k] === report.verified[k]);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Final report</CardTitle>
        <CardDescription>{report.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {keys.map((k) => (
            <div
              key={k}
              className="flex items-baseline justify-between gap-2 border-b border-dashed pb-1"
            >
              <span className={TEXT_META}>{k}</span>
              <span className="font-mono text-xs">
                {report.reported[k] ?? "—"} → {report.verified[k] ?? "—"}
              </span>
            </div>
          ))}
        </div>

        {report.blockingIssues.length > 0 && (
          <ul className="space-y-1">
            {report.blockingIssues.map((issue) => (
              <li
                key={issue}
                className="flex items-start gap-1.5 text-xs text-danger-text-strong"
              >
                <AlertTriangle
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        )}

        {allMatch && (
          <p className="flex items-center gap-1.5 text-xs text-success-text-strong">
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
            All reported numbers match DB-verified values.
          </p>
        )}

        <p className={TEXT_CAPTION}>
          Verified against the database — reported (model) vs measured (DB) per line.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Conversation stream (Chat view)
// ---------------------------------------------------------------------------

type StreamBlock =
  | { kind: "agent"; event: AgentEvent }
  | { kind: "system"; event: AgentEvent }
  | { kind: "error"; event: AgentEvent }
  | { kind: "process"; events: AgentEvent[] };

/** Collapse consecutive tool_call/write events into one process block.
 *  `usage` telemetry rows are panel data, not chat — skipped entirely. */
function buildBlocks(events: AgentEvent[]): StreamBlock[] {
  const ordered = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const blocks: StreamBlock[] = [];
  let buffer: AgentEvent[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      blocks.push({ kind: "process", events: buffer });
      buffer = [];
    }
  };
  for (const event of ordered) {
    if (event.kind === "usage") continue;
    if (event.kind === "tool_call" || event.kind === "write") {
      buffer.push(event);
    } else {
      flush();
      if (event.kind === "message") blocks.push({ kind: "agent", event });
      else if (event.kind === "error") blocks.push({ kind: "error", event });
      else blocks.push({ kind: "system", event });
    }
  }
  flush();
  return blocks;
}

function ProcessBlock({ events }: { events: AgentEvent[] }) {
  const [open, setOpen] = useState(false);
  const hasWrite = events.some((e) => e.kind === "write");
  const Icon: LucideIcon = hasWrite ? PenLine : Wrench;
  const label = hasWrite ? "Writes" : "Tools & file reads";

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1 text-xs font-medium text-muted-foreground">
          {label}
          <span className="ml-1.5 font-mono">({events.length})</span>
        </span>
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {open && (
        <ul className="border-t px-3 py-1.5">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-start gap-2 border-b py-1.5 last:border-0"
            >
              <Icon
                className={cn(
                  "mt-0.5 size-3 shrink-0",
                  event.kind === "write" ? "text-primary" : "text-muted-foreground"
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
                {event.summary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConversationStream({ events }: { events: AgentEvent[] }) {
  const blocks = buildBlocks(events);

  return (
    <div role="log" aria-live="polite" aria-label="Agent conversation" className="space-y-3">
      {blocks.map((block, i) => {
        if (block.kind === "process") {
          return <ProcessBlock key={`p-${block.events[0]?.id ?? i}`} events={block.events} />;
        }
        const { event } = block;
        if (block.kind === "agent") {
          // Phase 5: the bubble belongs to a specific member of the team.
          const actor = event.actor;
          return (
            <div key={event.id} className="flex items-start gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-tiny font-bold uppercase",
                  ACTOR_AVATAR[actor] ?? "bg-primary/10 text-primary"
                )}
                aria-hidden="true"
              >
                {actor.charAt(0)}
              </span>
              <div className="max-w-[85%] rounded-lg rounded-tl-sm border bg-card px-3 py-2 text-[15px] leading-[1.7]">
                <span
                  className={cn(
                    "mb-0.5 block text-tiny font-semibold uppercase tracking-wide",
                    ACTOR_NAME[actor] ?? "text-muted-foreground"
                  )}
                >
                  {actor}
                </span>
                {event.summary}
              </div>
            </div>
          );
        }
        if (block.kind === "error") {
          return (
            <div
              key={event.id}
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-surface px-3 py-2 text-xs leading-5 text-danger-text-heading"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="font-medium">{event.summary}</span>
            </div>
          );
        }
        // system rows: task_update + historical approval events
        const Icon: LucideIcon =
          event.kind === "approval"
            ? ShieldCheck
            : event.kind === "task_update"
              ? CheckCircle2
              : Info;
        return (
          <div key={event.id} className={cn("flex items-center gap-2 pl-8", TEXT_META)}>
            <Icon className="size-3 shrink-0" aria-hidden="true" />
            <span>{event.summary}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline approval gate (D2 — lives in the conversation flow)
// ---------------------------------------------------------------------------

function ApprovalCard({
  request,
  onApprove,
  onReject,
  busy,
  cardRef,
  approveRef,
}: {
  request: NonNullable<UseAgentRunResult["approval"]>;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
  /** STEP 67 — the "Review" button scrolls to this card. */
  cardRef?: React.RefObject<HTMLDivElement | null>;
  /** STEP 67 — the action the "Review" button hands the focus to. */
  approveRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div
      ref={cardRef}
      role="alert"
      className="rounded-lg border border-warning-border-strong bg-warning-surface p-3"
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-warning-text-deep">{request.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-warning-text-deep">
              Will write to {request.targetLabel}
            </span>
            {request.wordCount != null && (
              <Badge variant="outline" className="text-tiny font-normal">
                ~{request.wordCount} words
              </Badge>
            )}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-warning-text-heading">{request.summary}</p>
      <p className="mt-1.5 flex items-center gap-1 text-caption text-warning-text-strong">
        <Info className="size-3 shrink-0" aria-hidden="true" />
        Rejecting pauses the run — nothing has been written either way.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onReject} disabled={busy}>
          Reject
        </Button>
        <Button ref={approveRef} size="sm" onClick={onApprove} disabled={busy}>
          {busy && <Spinner size="md" />}
          Approve
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The bottom of the pane (STEP 66) — one card, one status line
// ---------------------------------------------------------------------------

/**
 * The live run's card — the same grammar as the composer card. Row 1 carries
 * the run's goal, row 2 the run-mode switch: the children of the old run
 * control bar moved here, nothing was dropped.
 */
function RunCard({
  goal,
  mode,
  disabled,
  onModeChange,
  onCancel,
}: {
  goal: string;
  mode: AgentRunMode;
  disabled: boolean;
  onModeChange: (next: AgentRunMode) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[680px] rounded-2xl border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2 px-1">
        <p className={cn("min-w-0 flex-1 truncate border-l-2 border-primary/40 pl-2", TEXT_META)}>
          “{goal}”
        </p>
        <Button variant="outline" size="sm" onClick={onCancel} aria-label="Cancel run">
          <X className="size-3.5" aria-hidden="true" />
          Cancel
        </Button>
      </div>
      <div className="mt-1 flex items-center gap-1.5 px-1">
        <ModeSwitch mode={mode} disabled={disabled} onChange={onModeChange} showHint={false} />
      </div>
    </div>
  );
}

/**
 * The quiet status line under the card:
 *
 *   Context 5.3K · 53 credits left · resets 8:00 AM
 *
 * The context segment is a BUTTON (STEP 66.1): it is the trigger of the
 * context panel — per-call section split · run totals · account ledger —
 * which used to hang off the gauge button in the composer's control row.
 * The panel is anchored above the line; the segment renders the figure in
 * exactly one place. The credits come from useCredits(), which the pane
 * calls ONCE and hands down — this component never fetches.
 */
function ComposerStatusLine({
  novelId,
  modelId,
  thinkingLevel,
  events,
  credits,
  loading,
  error,
}: {
  novelId: string;
  modelId: string;
  thinkingLevel: string;
  events: AgentEvent[];
  credits: CreditsSnapshot | null;
  loading: boolean;
  error: string | null;
}) {
  // The credit slot: "—" while the first fetch is in flight (the line keeps
  // its height), "Unlimited" for an admin, and NOTHING at all when the fetch
  // failed — a broken request must not leave a hole in the sentence.
  const creditsLabel = error
    ? null
    : credits
      ? credits.unlimited && credits.balance === null
        ? "Unlimited"
        : `${credits.balance} credits left`
      : loading
        ? "—"
        : null;

  const resetLabel = credits?.resetAt
    ? `resets ${new Date(credits.resetAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}`
    : null;

  return (
    <p className={cn("mx-auto mt-1.5 w-full max-w-[680px] truncate text-center", TEXT_CAPTION)}>
      <ContextUsageSegment
        novelId={novelId}
        modelId={modelId}
        thinkingLevel={thinkingLevel}
        events={events}
      />
      {creditsLabel ? ` · ${creditsLabel}` : ""}
      {resetLabel ? ` · ${resetLabel}` : ""}
    </p>
  );
}

// ---------------------------------------------------------------------------
// ConversationPane
// ---------------------------------------------------------------------------

export function ConversationPane({
  novel,
  chapterCount,
  run,
  pinOptions,
  onOpenPreview,
}: {
  novel: NovelMeta;
  /** Real chapter count, so mock gate labels name the next chapter. */
  chapterCount: number;
  /** Single useAgentRun instance owned by the shell, shared with the tree. */
  run: UseAgentRunResult;
  /** Flat, grouped pin-menu source built from the loaded NovelDetail. */
  pinOptions: PinOption[];
  /** Open the artifact pane as an overlay (screens narrower than xl). */
  onOpenPreview?: () => void;
}) {
  const { toast } = useToast();
  const view = useWriterStore((s) => s.centerViewByNovel[novel.id] ?? "chat");
  const setView = useWriterStore((s) => s.setCenterView);
  // P1 — run-mode preference is persisted per novel; the local composer state
  // adopts the stored value once it rehydrates (after mount) and whenever the
  // novel switches (falling back to the D2 default: approval).
  const storedMode = useWriterStore((s) => s.lastModeByNovel[novel.id]);
  const setLastMode = useWriterStore((s) => s.setLastMode);
  // P2 — model registry selection is persisted per novel; the composer
  // adopts the stored value once it rehydrates and on novel switches.
  const storedModel = useWriterStore((s) => s.lastModelByNovel[novel.id]);
  const setLastModel = useWriterStore((s) => s.setLastModel);
  // Phase 8 — Pin-to-Chat: refs pinned from the artifact panes ride the next
  // run start and are resolved server-side (client content never trusted).
  // Selector stays referentially stable (raw record only) — the derived
  // array is built in useMemo (zustand v5: unstable getSnapshot = loop).
  const pinnedRecord = useWriterStore((s) => s.pinnedByNovel[novel.id]);
  const pinnedRefs = useMemo(() => pinnedRecord ?? [], [pinnedRecord]);
  const togglePin = useWriterStore((s) => s.togglePin);
  const clearPins = useWriterStore((s) => s.clearPins);

  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<AgentRunMode>("approval");
  useEffect(() => {
    setMode(storedMode ?? "approval");
  }, [storedMode, novel.id]);
  const [modelSelection, setModelSelection] = useState<ModelSelection>(defaultSelection);
  useEffect(() => {
    // Stored selections are client-authored, not runtime-validated — if the
    // registry no longer knows the model, fall back to the default.
    const stored = storedModel;
    setModelSelection(stored && getModelDefinition(stored.modelId).id === stored.modelId ? stored : defaultSelection());
  }, [storedModel, novel.id]);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  /** STEP 67 — the final report lives inside the summary line, collapsed. */
  const [reportExpanded, setReportExpanded] = useState(false);
  /** Recent run summaries for the history switcher (latest first). */
  const [history, setHistory] = useState<AgentRun[]>([]);
  // STEP 66 — ONE credit fetch for the whole composer area. The status line
  // receives the snapshot as props; it never fetches on its own.
  const { credits, loading: creditsLoading, error: creditsError } = useCredits();

  const detail = run.detail;
  const runStatus = detail?.run.status ?? null;
  const isActive = runStatus != null && ACTIVE_STATUSES.includes(runStatus);

  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  // STEP 67 — the "Review" button scrolls to the inline approval card and
  // hands the focus to its action.
  const approvalCardRef = useRef<HTMLDivElement>(null);
  const approveButtonRef = useRef<HTMLButtonElement>(null);

  // Bring the chat view forward when the gate needs the author (once per gate).
  const approval = run.approval;
  const lastGateTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (approval && approval.taskId !== lastGateTaskRef.current) {
      lastGateTaskRef.current = approval.taskId;
      setView(novel.id, "chat");
    }
    if (!approval) lastGateTaskRef.current = null;
  }, [approval, novel.id, setView]);

  // Keep the newest turn in view as the team works.
  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ block: "nearest" });
  }, [detail?.events.length, approval]);

  // Refresh the history list when the displayed run changes (covers new runs
  // started from the composer and manual switches via the switcher itself).
  const displayedRunId = detail?.run.id ?? null;
  // STEP 67 — a different run means a different report: collapse it again.
  useEffect(() => {
    setReportExpanded(false);
  }, [displayedRunId]);
  useEffect(() => {
    let alive = true;
    // listNovelRuns attaches the Firebase ID token — a raw fetch here would
    // be rejected by the middleware with 401 and the history would stay empty.
    // STEP 65: the shared api.ts function is the single source for this list
    // (the rail's Write mode reads the same endpoint through it).
    listNovelRuns(novel.id)
      .then((body: { runs?: AgentRun[] }) => {
        if (alive && Array.isArray(body.runs)) setHistory(body.runs);
      })
      .catch(() => {
        // history switcher is best-effort — the pane works without it
      });
    return () => {
      alive = false;
    };
  }, [novel.id, displayedRunId]);

  // ---- handlers ----

  const handleStart = async () => {
    if (submitting || goal.trim().length < 3) return;
    setSubmitting(true);
    try {
      await run.start({
        novelId: novel.id,
        novelTitle: novel.title,
        chapterCount,
        goal: goal.trim(),
        mode,
        modelId: modelSelection.modelId,
        thinkingLevel: modelSelection.thinkingLevel,
        pinned: pinnedRefs.length > 0 ? pinnedRefs : undefined,
      });
      setGoal("");
      // Pins were "context for the next run" — the run consumed them. Pinned
      // chapters additionally trigger the runtime's auto impact assessment.
      if (pinnedRefs.length > 0) clearPins(novel.id);
    } catch (e) {
      toast({
        title: "Could not start run",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRun = async () => {
    try {
      await run.cancel();
    } catch (e) {
      toast({
        title: "Could not cancel run",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleComposerModeChange = (next: AgentRunMode) => {
    setMode(next);
    setLastMode(novel.id, next);
  };

  const handleModelChange = (next: ModelSelection) => {
    setModelSelection(next);
    setLastModel(novel.id, next);
  };

  const handleRunModeChange = (next: AgentRunMode) => {
    setLastMode(novel.id, next);
    run.setMode(next).catch((e: unknown) => {
      toast({
        title: "Could not change mode",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    });
  };

  const handleApprove = async () => {
    if (!approval) return;
    setApproving(true);
    try {
      await run.approve(approval.taskId);
    } catch (e) {
      toast({
        title: "Approval failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!approval) return;
    setApproving(true);
    try {
      await run.reject(approval.taskId);
    } catch (e) {
      toast({
        title: "Could not record rejection",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setApproving(false);
    }
  };

  const events = detail?.events ?? [];

  // STEP 67 — the numbers the summary line states. The words and the review
  // counts come from the run's MEASURED report (reported vs verified), not
  // from anything the model claims; a segment whose value is zero is
  // omitted rather than printed as "0".
  const runReport = detail?.run.finalReport ?? null;
  const doneTaskCount = detail
    ? detail.tasks.filter((task) => task.status === "done").length
    : 0;
  const runWords = runReport?.verified.words ?? 0;
  const runReviews = runReport?.verified.reviewsRun ?? 0;
  const runBlocking = runReport?.verified.blockingFound ?? 0;
  /** The runtime opens ONE gate at a time, so the pending count is 0 or 1. */
  const pendingApprovalCount = approval ? 1 : 0;

  /** STEP 67 — bring the reader to the inline approval and focus its action.
   *  The approval never becomes a modal. */
  const handleReviewApproval = () => {
    approvalCardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    approveButtonRef.current?.focus({ preventScroll: true });
  };

  /** STEP 67 — a starter prompt fills the composer (it never submits) and
   *  hands the caret back so the author edits before sending. */
  const handleStarterPrompt = (text: string) => {
    setGoal(text);
    window.requestAnimationFrame(() => {
      document.getElementById("agent-goal")?.focus();
    });
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col" aria-label="Agent conversation pane">
      {/* Pane header — navigation only (STEP 67). The run status moved into
          the run summary line and the approval-mode chip is already a control
          in the composer; saying either here said it twice.
          The header is exactly the shared workbench band height, so its bottom
          border lands on the same horizontal line as the rail's tree header
          and the document pane header. */}
      <div className="flex h-[var(--workbench-head-h,112px)] items-start gap-2 border-b px-3 py-2">
        <div className="ml-auto flex items-center gap-1">
          {history.length > 0 && (
            <select
              aria-label="Run history"
              title="Browse past run transcripts"
              className="hidden h-7 max-w-44 cursor-pointer truncate rounded-md border bg-background px-1.5 text-xs text-foreground md:block"
              value={detail?.run.id ?? ""}
              onChange={(e) => {
                if (e.target.value) void run.viewRun(e.target.value);
              }}
            >
              {history.map((r) => {
                const when = new Date(r.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <option key={r.id} value={r.id}>
                    {RUN_STATUS_META[r.status]?.label ?? r.status} · {when} · {r.goal.slice(0, 48)}
                  </option>
                );
              })}
            </select>
          )}
          {onOpenPreview && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 xl:hidden"
              onClick={onOpenPreview}
              aria-label="Open artifact panel"
            >
              <PanelRight className="size-4" aria-hidden="true" />
            </Button>
          )}
          {/* Chat / Board — one 32px segmented control. The track is a plain
              bordered box and the selected segment is a solid muted block that
              fills the control's full height (not an inset pill). */}
          <div
            role="group"
            aria-label="Center view"
            className="inline-flex h-8 items-stretch overflow-hidden rounded-md border bg-background p-0"
          >
            {(
              [
                { id: "chat", label: "Chat", icon: MessageSquare },
                { id: "board", label: "Board", icon: ListChecks },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  "h-full gap-1 rounded-none px-2.5 text-small leading-none",
                  view === id
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                aria-pressed={view === id}
                onClick={() => setView(novel.id, id)}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Mock backend honesty banner */}
      {AGENT_BACKEND === "mock" && (
        <div
          role="note"
          className="flex items-start gap-2 border-b bg-warning-surface px-3 py-1.5 text-caption leading-4 text-warning-text-heading"
        >
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{AGENT_BACKEND_LABEL} — simulated, nothing touches your novel.</span>
        </div>
      )}

      {run.loading && !detail && (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          Restoring run state...
        </p>
      )}

      {/* Body — the reading column (STEP 66). The scroll container stays full
          width (the scrollbar must not move); the measure — 680px, ~65–70
          characters — lives on the inner wrapper, so everything the stream
          renders is measured and the chrome stays full-bleed. */}
      <div className="nice-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[680px] px-6 py-6">
          {/* STEP 67 — the run is described ONCE. The approval action sits
              directly above the summary line; the final report expands INSIDE
              the summary line and is rendered nowhere else in the stream. */}
          {pendingApprovalCount > 0 && (
            <button
              type="button"
              onClick={handleReviewApproval}
              className="mb-2 flex w-full items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-left text-small font-medium text-primary hover:bg-primary/10"
            >
              {pendingApprovalCount} approval{pendingApprovalCount === 1 ? "" : "s"} waiting — Review
            </button>
          )}

          {detail && (
            <>
              <RunSummaryLine
                status={detail.run.status}
                tasksDone={doneTaskCount}
                tasksTotal={detail.tasks.length}
                words={runWords}
                reviewsRun={runReviews}
                blockingFound={runBlocking}
                updatedAt={detail.run.updatedAt}
                expanded={reportExpanded}
                hasReport={detail.run.finalReport != null}
                onToggle={() => setReportExpanded((v) => !v)}
              />
              {reportExpanded && detail.run.finalReport != null && (
                <div className="mt-2">
                  <FinalReportCard report={detail.run.finalReport} />
                </div>
              )}
              {/* A paused run still needs its way out — the "Last run" card
                  that used to carry this button is gone. */}
              {detail.run.status === "paused" && (
                <Button variant="outline" size="sm" className="mt-2" onClick={handleCancelRun}>
                  <X className="size-3.5" aria-hidden="true" />
                  Discard paused run
                </Button>
              )}
            </>
          )}

          {view === "chat" ? (
            <>
              {!detail ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
                  <h2 className="text-[17px] font-medium">Give the team a goal</h2>
                  <p className="mt-1.5 max-w-[420px] text-small text-muted-foreground">
                    Describe what you want written, or point at a chapter or outline beat.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {STARTER_PROMPTS.map((text) => (
                      <Button
                        key={text}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleStarterPrompt(text)}
                      >
                        {text}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <ConversationStream events={events} />
                  {detail?.run.status === "running" && (
                    <div className={cn("flex items-center gap-2 pl-8", TEXT_META)}>
                      <Spinner size="sm" />
                      Working…
                    </div>
                  )}
                  {approval && (
                    <ApprovalCard
                      request={approval}
                      onApprove={handleApprove}
                      onReject={handleReject}
                      busy={approving}
                      cardRef={approvalCardRef}
                      approveRef={approveButtonRef}
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <div className="space-y-4">
              {detail ? (
                <>
                  <TaskBoard tasks={detail.tasks} runStatus={detail.run.status} />
                  <ActivityStream events={detail.events} />
                </>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No active run — start one from the chat composer.
                </p>
              )}
            </div>
          )}
          <div ref={bottomAnchorRef} aria-hidden="true" />
        </div>
      </div>

      {/* Bottom — ONE card and ONE quiet status line (STEP 66). The two
          bordered strips are gone: the live run's controls and the composer
          share the same card grammar, and the status line below carries the
          context figure, the credit balance and the reset hour. */}
      <div className="mt-auto border-t bg-card/60 px-3 py-2">
        {isActive && detail ? (
          <RunCard
            goal={detail.run.goal}
            mode={detail.run.mode}
            disabled={detail.run.status === "awaiting_approval"}
            onModeChange={handleRunModeChange}
            onCancel={handleCancelRun}
          />
        ) : (
          <PromptBox
            value={goal}
            onChange={setGoal}
            onStart={() => void handleStart()}
            submitting={submitting}
            mode={mode}
            onModeChange={handleComposerModeChange}
            modelSelection={modelSelection}
            onModelChange={handleModelChange}
            pinnedRefs={pinnedRefs}
            onTogglePin={(ref) => togglePin(novel.id, ref)}
            onClearPins={() => clearPins(novel.id)}
            pinOptions={pinOptions}
          />
        )}
        <ComposerStatusLine
          novelId={novel.id}
          modelId={detail?.run.modelId ?? modelSelection.modelId}
          thinkingLevel={detail?.run.thinkingLevel ?? modelSelection.thinkingLevel}
          events={events}
          credits={credits}
          loading={creditsLoading}
          error={creditsError}
        />
      </div>
    </div>
  );
}
