"use client";

// ---------------------------------------------------------------------------
// Novara AI — Agent Console (workspace "AI Team" tab runtime view).
// The author gives the team a goal, watches it work on the task board, and
// answers the approval gate (plan §4.1, decisions D1/D2). Talks only to
// `useAgentRun`; the mock/live gateway swap happens below the hook.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  PauseCircle,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAgentRun } from "@/hooks/use-agent-run";
import { useWriterStore } from "@/hooks/use-writer-store";
import { AGENT_BACKEND } from "@/lib/novara/agent-client";
import type {
  AgentRunMode,
  AgentRunStatus,
  RunFinalReport,
} from "@/lib/novara/agent-types";
import type { NovelMeta } from "@/lib/novara/types";
import { AGENT_BACKEND_LABEL, RUN_STATUS_META } from "@/config/writer";
import { ActivityStream } from "./activity-stream";
import { ApprovalDialog } from "./approval-dialog";
import { ModeSwitch } from "./mode-switch";
import { TaskBoard } from "./task-board";

const ACTIVE_STATUSES: readonly AgentRunStatus[] = [
  "running",
  "awaiting_approval",
];
const FINISHED_STATUSES: readonly AgentRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "paused",
];

// ---------------------------------------------------------------------------
// Small internal pieces
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
          Mock report — the real runtime verifies against the database.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AgentConsole
// ---------------------------------------------------------------------------

export function AgentConsole({
  novel,
  chapterCount = 0,
}: {
  novel: NovelMeta;
  /** Real chapter count, so mock gate labels name the next chapter. */
  chapterCount?: number;
}) {
  const { toast } = useToast();
  const run = useAgentRun(novel.id);
  const lastMode = useWriterStore((s) => s.lastMode);
  const setLastMode = useWriterStore((s) => s.setLastMode);

  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<AgentRunMode>(lastMode);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);

  const detail = run.detail;
  const runStatus = detail?.run.status ?? null;
  const isActive =
    runStatus != null && ACTIVE_STATUSES.includes(runStatus);
  const isFinished =
    runStatus != null && FINISHED_STATUSES.includes(runStatus);

  // ---- handlers ----

  const handleStart = async () => {
    if (submitting || goal.trim().length < 3) return;
    setSubmitting(true);
    try {
      await run.start({
        novelId: novel.id,
        novelTitle: novel.title,
        chapterCount: chapterCount ?? 0,
        goal: goal.trim(),
        mode,
      });
      setGoal("");
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
    setLastMode(next);
  };

  const handleRunModeChange = (next: AgentRunMode) => {
    setLastMode(next);
    run.setMode(next).catch((e: unknown) => {
      toast({
        title: "Could not change mode",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    });
  };

  const handleApprove = async () => {
    const request = run.approval;
    if (!request) return;
    setApproving(true);
    try {
      await run.approve(request.taskId);
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
    const request = run.approval;
    if (!request) return;
    setApproving(true);
    try {
      await run.reject(request.taskId);
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

  // ---- render ----

  return (
    <div className="space-y-4" aria-label="AI team console">
      {/* Mock backend honesty banner */}
      {AGENT_BACKEND === "mock" && (
        <div
          role="note"
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {AGENT_BACKEND_LABEL} — tasks, events and writes below are
            simulated; nothing touches your novel.
          </span>
        </div>
      )}

      {run.loading && !detail && (
        <p className="text-sm text-muted-foreground">Restoring run state...</p>
      )}

      {/* Last run summary (finished run kept visible above the composer) */}
      {isFinished && detail && (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Last run</CardTitle>
            <CardDescription>
              {detail.run.status === "paused"
                ? "Paused after you rejected the settle gate — nothing was written. Discard it to free the team for a new goal."
                : "Finished run for this novel — give the team a new goal below."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 px-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.run.status} />
              {detail.run.status === "paused" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelRun}
                  aria-label="Discard paused run"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Discard paused run
                </Button>
              )}
            </div>
            <p className="border-l-2 pl-3 text-sm leading-snug">
              “{detail.run.goal}”
            </p>
          </CardContent>
        </Card>
      )}

      {/* Final report (only exists on finished runs) */}
      {detail?.run.finalReport != null && (
        <FinalReportCard report={detail.run.finalReport} />
      )}

      {/* Active run header */}
      {isActive && detail && (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.run.status} />
              <ModeChip mode={detail.run.mode} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            <p className="border-l-2 border-primary/40 pl-3 text-sm font-medium leading-snug">
              “{detail.run.goal}”
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ModeSwitch
                mode={detail.run.mode}
                disabled={detail.run.status === "awaiting_approval"}
                onChange={handleRunModeChange}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelRun}
                aria-label="Cancel run"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel run
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Composer (no active run) */}
      {!isActive && (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">New run</CardTitle>
            <CardDescription>
              Describe what the team should do. They plan, work the board and
              ask before writing to your novel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            <div className="space-y-1.5">
              <Label htmlFor="agent-goal">Goal</Label>
              <Textarea
                id="agent-goal"
                rows={3}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Give the team a goal — e.g. Draft the next chapter from the outline, keeping Mara's arc on track."
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ModeSwitch
                mode={mode}
                onChange={handleComposerModeChange}
              />
              <Button
                onClick={handleStart}
                disabled={submitting || goal.trim().length < 3}
              >
                {submitting ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                )}
                Run team
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approval gate — visible inline even if the dialog was missed */}
      {run.approval != null && (
        <Card
          role="alert"
          className="flex-row items-start gap-2 border-amber-200 bg-amber-50 py-3 text-amber-800"
        >
          <PauseCircle className="ml-4 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="pr-4 text-xs font-medium">
            The team is waiting for your approval.
          </p>
        </Card>
      )}

      {/* Main runtime grid */}
      {detail && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <TaskBoard tasks={detail.tasks} runStatus={detail.run.status} />
          <ActivityStream events={detail.events} />
        </div>
      )}

      {/* Approval dialog */}
      {run.approval != null && (
        <ApprovalDialog
          request={run.approval}
          onApprove={handleApprove}
          onReject={handleReject}
          busy={approving}
        />
      )}
    </div>
  );
}
