"use client";

import { useEffect, useRef } from "react";
import {
  Activity,
  AlertTriangle,
  Gauge,
  ListChecks,
  MessageSquare,
  PenLine,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AgentEvent, AgentEventKind } from "@/lib/novara/agent-types";
import { cn } from "@/lib/utils";

const EVENT_ICON: Record<AgentEventKind, LucideIcon> = {
  task_update: ListChecks,
  tool_call: Wrench,
  write: PenLine,
  message: MessageSquare,
  error: AlertTriangle,
  approval: ShieldCheck,
  usage: Gauge,
};

// Phase 5: per-member color accents in the activity stream.
const ACTOR_STYLE: Record<string, string> = {
  atlas: "text-violet-700 dark:text-violet-400",
  sage: "text-emerald-700 dark:text-emerald-400",
  nova: "text-amber-700 dark:text-amber-400",
  prism: "text-rose-700 dark:text-rose-400",
  forge: "text-teal-700 dark:text-teal-400",
  author: "text-foreground",
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour12: false });
}

export function ActivityStream({
  events,
  className,
}: {
  events: AgentEvent[];
  className?: string;
}) {
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  // Oldest → newest so the feed reads top-down like a terminal tail.
  const ordered = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  // Keep the newest event in view as the team works.
  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ block: "nearest" });
  }, [events]);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center gap-2">
        <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
        <CardTitle className="text-base">Activity</CardTitle>
        <Badge variant="outline" className="ml-auto font-mono text-caption">
          {events.length}
        </Badge>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Events will appear here as the team works.
          </p>
        ) : (
          <ScrollArea className="max-h-72">
            <div
              role="log"
              aria-live="polite"
              aria-label="Agent activity log"
              className="pr-3"
            >
              {ordered.map((event) => {
                const Icon = EVENT_ICON[event.kind];
                const actorStyle = ACTOR_STYLE[event.actor] ?? "text-muted-foreground";
                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 border-b py-1.5 last:border-0"
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        event.kind === "error"
                          ? "text-danger-text"
                          : "text-muted-foreground",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 text-xs leading-5">
                      <span
                        className={cn("font-semibold uppercase", actorStyle)}
                      >
                        {event.actor}
                      </span>
                      <span className="mx-1.5 text-muted-foreground">·</span>
                      {event.summary}
                    </span>
                    <time
                      dateTime={event.createdAt}
                      className="shrink-0 font-mono text-tiny leading-5 text-muted-foreground"
                    >
                      {formatTimestamp(event.createdAt)}
                    </time>
                  </div>
                );
              })}
              <div ref={bottomAnchorRef} aria-hidden="true" />
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
