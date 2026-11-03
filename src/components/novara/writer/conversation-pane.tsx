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
  Loader2,
  MessageSquare,
  PanelRight,
  PauseCircle,
  PenLine,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
  Zap,
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
import type { UseAgentRunResult } from "@/hooks/use-agent-run";
import { useWriterStore } from "@/hooks/use-writer-store";
import { AGENT_BACKEND } from "@/lib/novara/agent-client";
import {
  type AgentEvent,
  type AgentRun,
  type AgentRunMode,
  type AgentRunStatus,
  type RunFinalReport,
} from "@/lib/novara/agent-types";
import { defaultSelection, getModelDefinition, type ModelSelection } from "@/lib/novara/models";
import type { NovelMeta } from "@/lib/novara/types";
import type { CenterView } from "@/config/writer";
import { AGENT_BACKEND_LABEL, RUN_STATUS_META } from "@/config/writer";
import { cn } from "@/lib/utils";
import { ActivityStream } from "./activity-stream";
import { ContextUsageButton } from "./context-usage-panel";
import { ModeSwitch } from "./mode-switch";
import { PromptBox, type PinOption } from "./prompt-box";
import { TaskBoard } from "./task-board";

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
const FINISHED_STATUSES: readonly AgentRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "paused",
];

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: AgentRunStatus }) {
  const meta = RUN_STATUS_META[status];
  return (
    <Badge variant="outline" className={meta.badgeClass}>
      {meta.label}
    </Badge>
  );
}

function ModeChip({ mode }: { mode: AgentRunMode }) {
  const Icon = mode === "approval" ? ShieldCheck : Zap;
  return (
    <Badge variant="outline" className="gap-1">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {mode === "approval" ? "Approval" : "Full access"}
    </Badge>
  );
}

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
              <span className="text-xs text-muted-foreground">{k}</span>
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
                className="flex items-start gap-1.5 text-xs text-rose-700"
              >
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        )}

        {allMatch && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            All reported numbers match DB-verified values.
          </p>
        )}

        <p className="text-[11px] text-muted-foreground">
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
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex-1 text-xs font-medium text-muted-foreground">
          {label}
          <span className="ml-1.5 font-mono">({events.length})</span>
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
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
                  "mt-0.5 h-3 w-3 shrink-0",
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
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase",
                  ACTOR_AVATAR[actor] ?? "bg-primary/10 text-primary"
                )}
                aria-hidden="true"
              >
                {actor.charAt(0)}
              </span>
              <div className="max-w-[85%] rounded-lg rounded-tl-sm border bg-card px-3 py-2 text-sm leading-6">
                <span
                  className={cn(
                    "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide",
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
              className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
          <div key={event.id} className="flex items-center gap-2 pl-8 text-xs text-muted-foreground">
            <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
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
}: {
  request: NonNullable<UseAgentRunResult["approval"]>;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 p-3"
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">{request.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-amber-900">
              Will write to {request.targetLabel}
            </span>
            {request.wordCount != null && (
              <Badge variant="outline" className="text-[10px] font-normal">
                ~{request.wordCount} words
              </Badge>
            )}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-amber-800">{request.summary}</p>
      <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-700">
        <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
        Rejecting pauses the run — nothing has been written either way.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onReject} disabled={busy}>
          Reject
        </Button>
        <Button size="sm" onClick={onApprove} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Approve
        </Button>
      </div>
    </div>
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
  /** Recent run summaries for the history switcher (latest first). */
  const [history, setHistory] = useState<AgentRun[]>([]);

  const detail = run.detail;
  const runStatus = detail?.run.status ?? null;
  const isActive = runStatus != null && ACTIVE_STATUSES.includes(runStatus);
  const isFinished = runStatus != null && FINISHED_STATUSES.includes(runStatus);

  const bottomAnchorRef = useRef<HTMLDivElement>(null);

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
  useEffect(() => {
    let alive = true;
    fetch(`/api/agent/runs?novelId=${encodeURIComponent(novel.id)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
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

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col" aria-label="Agent conversation pane">
      {/* Pane header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {detail ? (
          <>
            <StatusBadge status={detail.run.status} />
            <ModeChip mode={detail.run.mode} />
            {/* P2 — the model the DISPLAYED run executes with. */}
            <Badge variant="outline" className="gap-1 text-[11px] text-muted-foreground">
              {getModelDefinition(detail.run.modelId).label}
              {detail.run.thinkingLevel !== "off" && ` · thinking`}
            </Badge>
          </>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Idle
          </Badge>
        )}
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
              <PanelRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          <div
            role="group"
            aria-label="Center view"
            className="inline-flex rounded-md border p-0.5"
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
                className="h-7 gap-1 px-2.5 text-xs"
                aria-pressed={view === id}
                onClick={() => setView(novel.id, id)}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
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
          className="flex items-start gap-2 border-b bg-amber-50 px-3 py-1.5 text-[11px] leading-4 text-amber-800"
        >
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{AGENT_BACKEND_LABEL} — simulated, nothing touches your novel.</span>
        </div>
      )}

      {run.loading && !detail && (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          Restoring run state...
        </p>
      )}

      {/* Body */}
      <div className="nice-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {isFinished && detail && (
          <Card className="mb-3 gap-2 py-3">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <StatusBadge status={detail.run.status} />
                Last run
              </CardTitle>
              <CardDescription>
                {detail.run.status === "paused"
                  ? "Paused after rejection — nothing was written. Discard it to free the team."
                  : "Finished run — give the team a new goal below."}
              </CardDescription>
            </CardHeader>
            {detail.run.status === "paused" && (
              <CardContent className="px-4">
                <Button variant="outline" size="sm" onClick={handleCancelRun}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Discard paused run
                </Button>
              </CardContent>
            )}
          </Card>
        )}

        {detail?.run.finalReport != null && (
          <div className="mb-3">
            <FinalReportCard report={detail.run.finalReport} />
          </div>
        )}

        {view === "chat" ? (
          <>
            {events.length === 0 && !detail ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
                <Sparkles className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium">Give the team a goal</p>
                <p className="max-w-xs text-xs leading-5 text-muted-foreground">
                  They plan the work on their own board, keep you posted here,
                  and ask before writing anything into your novel.
                </p>
              </div>
            ) : (
              <>
                <ConversationStream events={events} />
                {detail?.run.status === "running" && (
                  <div className="flex items-center gap-2 pl-8 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Working…
                  </div>
                )}
                {approval && (
                  <ApprovalCard
                    request={approval}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    busy={approving}
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

      {/* Composer / run control bar */}
      {isActive && detail ? (
        <div className="flex flex-wrap items-center gap-2 border-t bg-card/60 px-3 py-2">
          <ModeSwitch
            mode={detail.run.mode}
            disabled={detail.run.status === "awaiting_approval"}
            onChange={handleRunModeChange}
            showHint={false}
          />
          {/* Live per-call context usage stays visible while the run produces it. */}
          <ContextUsageButton
            novelId={novel.id}
            modelId={detail.run.modelId}
            events={detail.events}
          />
          <p className="min-w-0 flex-1 truncate border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">
            “{detail.run.goal}”
          </p>
          <Button variant="outline" size="sm" onClick={handleCancelRun} aria-label="Cancel run">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Cancel
          </Button>
        </div>
      ) : (
        <div className="border-t bg-card/60 p-3">
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
            novelId={novel.id}
            usageEvents={detail?.events ?? []}
          />
        </div>
      )}
    </div>
  );
}
