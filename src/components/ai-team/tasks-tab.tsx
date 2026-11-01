"use client";

import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  ListTodo,
  Loader2,
  RotateCcw,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { TaskDto } from "@/lib/ai-team/types";
import { AgentAvatar } from "./chat-panel";
import { useRetryTask } from "./use-team";

function StatusBadge({ task }: { task: TaskDto }) {
  const base = "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold";
  switch (task.status) {
    case "completed":
      return (
        <span className={cn(base, "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200")}>
          <CheckCircle2 className="size-2.5" aria-hidden="true" /> Done
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200")}>
          <XCircle className="size-2.5" aria-hidden="true" /> Failed
        </span>
      );
    case "in_progress":
      return (
        <span className={cn(base, "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200")}>
          <Loader2 className="size-2.5 animate-spin" aria-hidden="true" /> Running
        </span>
      );
    default:
      return (
        <span className={cn(base, "bg-muted text-muted-foreground")}>
          <Clock className="size-2.5" aria-hidden="true" /> Queued
        </span>
      );
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function TaskItem({ task }: { task: TaskDto }) {
  const { toast } = useToast();
  const retryMutation = useRetryTask();
  const running = task.status === "in_progress" || task.status === "pending";

  const retry = () => {
    retryMutation.mutate(task.id, {
      onSuccess: () => toast({ title: "Task re-started", description: task.title }),
      onError: (error: Error) =>
        toast({ title: "Could not retry", description: error.message, variant: "destructive" }),
    });
  };

  return (
    <Collapsible className="rounded-xl border bg-background">
      <div className="flex items-center gap-2 p-2.5">
        <AgentAvatar agent={task.assignee} size={26} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className={cn("truncate text-xs font-medium", task.status === "completed" && "text-muted-foreground")}>
              {task.title}
            </p>
            <StatusBadge task={task} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {task.assignee.name} · via {task.creatorIsUser ? "you" : task.creator.name} · {formatTime(task.createdAt)}
          </p>
        </div>
        <CollapsibleTrigger
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Toggle task details"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </CollapsibleTrigger>
      </div>

      {running && (
        <div className="px-2.5 pb-2.5">
          <Progress value={task.progress} className="h-1.5" aria-label={`Task progress ${task.progress}%`} />
        </div>
      )}

      <CollapsibleContent className="border-t px-2.5 py-2 data-[state=closed]:hidden">
        <p className="mb-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
          {task.description}
        </p>

        {task.logs.length > 0 && (
          <div className="mb-2 space-y-1">
            {task.logs.map((log) => (
              <div key={log.id} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <span className="mt-0.5 size-1 shrink-0 rounded-full bg-current" aria-hidden="true" />
                <span className="flex-1">{log.message}</span>
                <span className="shrink-0 tabular-nums opacity-70">{formatTime(log.createdAt)}</span>
              </div>
            ))}
          </div>
        )}

        {task.status === "failed" && (
          <div className="mb-2 rounded-lg border border-rose-300/60 bg-rose-50 px-2 py-1.5 text-xs text-rose-900 dark:border-rose-500/50 dark:bg-rose-950/40 dark:text-rose-100">
            <p className="font-semibold">Failed</p>
            <p className="break-words">{task.error ?? "Unknown error."}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-1.5 h-6 gap-1 border-rose-300 px-2 text-[11px] text-rose-800 hover:bg-rose-100 dark:text-rose-200"
              onClick={retry}
              disabled={retryMutation.isPending}
            >
              {retryMutation.isPending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="size-3" aria-hidden="true" />
              )}
              Retry
            </Button>
          </div>
        )}

        {task.result && (
          <div className="rounded-lg bg-muted p-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Result</p>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed [scrollbar-width:thin]">
              {task.result}
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TasksTab({ tasks, isLoading }: { tasks: TaskDto[]; isLoading: boolean }) {
  const active = tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length;
  const done = tasks.filter((task) => task.status === "completed").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <ListTodo className="size-3.5" aria-hidden="true" />
        <span>
          {active} active · {done} done · {tasks.length} total
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 [scrollbar-width:thin]">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
            <ListTodo className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">No tasks yet</p>
            <p className="max-w-[240px] text-xs text-muted-foreground">
              Ask the team leader for something substantial — delegated tasks and their progress show up here.
            </p>
          </div>
        ) : (
          tasks.map((task) => <TaskItem key={task.id} task={task} />)
        )}
      </div>
    </div>
  );
}
