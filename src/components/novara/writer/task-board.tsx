"use client";

import {
  Ban,
  CheckCircle2,
  Circle,
  ClipboardList,
  Hand,
  Loader2,
  PauseCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TASK_STATUS_META } from "@/config/writer";
import type {
  AgentRunStatus,
  AgentTask,
  AgentTaskStatus,
} from "@/lib/novara/agent-types";
import { cn } from "@/lib/utils";

/** Status → row icon + icon color for the Todos board. */
const TASK_STATUS_ICON: Record<AgentTaskStatus, { icon: LucideIcon; iconClass: string }> = {
  pending: { icon: Circle, iconClass: "text-muted-foreground" },
  in_progress: { icon: Loader2, iconClass: "animate-spin text-primary" },
  needs_approval: { icon: PauseCircle, iconClass: "text-amber-600" },
  done: { icon: CheckCircle2, iconClass: "text-emerald-600" },
  failed: { icon: XCircle, iconClass: "text-rose-600" },
  blocked: { icon: Ban, iconClass: "text-muted-foreground" },
};

/** Left rail color for parallel-group rows, keyed by the row's own status. */
const PARALLEL_RAIL_CLASS: Record<AgentTaskStatus, string> = {
  pending: "border-l-muted-foreground/40",
  in_progress: "border-l-primary/40",
  needs_approval: "border-l-amber-400",
  blocked: "border-l-muted-foreground/40",
  failed: "border-l-rose-400",
  done: "border-l-emerald-400",
};

// Phase 5: member accent on each task row (matches the conversation bubbles).
const ASSIGNEE_BADGE: Record<string, string> = {
  sage: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  nova: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  prism: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  forge: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
};

export function TaskBoard({
  tasks,
  runStatus,
}: {
  tasks: AgentTask[];
  runStatus: AgentRunStatus;
}) {
  const ordered = [...tasks].sort((a, b) => a.order - b.order);

  // Parallel groups with at least one sibling waiting at the settle gate
  // get an amber rail so the pause is visible across the whole group.
  const groupsAwaitingApproval = new Set(
    tasks
      .filter((t) => t.status === "needs_approval" && t.parallelGroup !== null)
      .map((t) => t.parallelGroup as string),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <CardTitle className="text-base">Todos</CardTitle>
        <Badge variant="outline" className="ml-auto font-mono text-[11px]">
          {tasks.length}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {runStatus === "awaiting_approval" && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
          >
            <Hand className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Waiting for your approval — the run is paused at the settle gate.</span>
          </div>
        )}

        {ordered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No tasks yet — give the team a goal below.
          </p>
        ) : (
          <ol aria-label="Agent task list" className="space-y-2">
            {ordered.map((task) => {
              const meta = TASK_STATUS_META[task.status];
              const { icon: Icon, iconClass } = TASK_STATUS_ICON[task.status];
              const isParallel = task.parallelGroup !== null;
              const railClass =
                isParallel &&
                task.parallelGroup !== null &&
                groupsAwaitingApproval.has(task.parallelGroup)
                  ? "border-l-amber-400"
                  : PARALLEL_RAIL_CLASS[task.status];

              return (
                <li
                  key={task.id}
                  className={cn(
                    "rounded-md border px-3 py-2",
                    meta.rowClass,
                    isParallel && "ml-4 border-l-2 pl-3",
                    isParallel && railClass,
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Icon
                      className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-mono text-xs text-muted-foreground">
                          {task.key}
                        </span>
                        <span className="text-sm font-medium leading-5">{task.title}</span>
                        {task.assignee !== "atlas" && (
                          <span
                            className={cn(
                              "rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide",
                              ASSIGNEE_BADGE[task.assignee] ??
                                "bg-muted text-muted-foreground"
                            )}
                          >
                            {task.assignee}
                          </span>
                        )}
                      </div>
                      {task.detail && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {task.detail}
                        </p>
                      )}
                    </div>
                    {task.artifactLabel && (
                      <Badge
                        variant="outline"
                        className="mt-0.5 shrink-0 text-[10px] font-normal"
                      >
                        {task.artifactLabel}
                      </Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
