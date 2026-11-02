"use client";

import { useEffect, useRef } from "react";
import {
  Activity,
  AlertTriangle,
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
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <CardTitle className="text-base">Activity</CardTitle>
        <Badge variant="outline" className="ml-auto font-mono text-[11px]">
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
                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-2 border-b py-1.5 last:border-0"
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        event.kind === "error"
                          ? "text-rose-600"
                          : "text-muted-foreground",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 text-xs leading-5">
                      {event.summary}
                    </span>
                    <time
                      dateTime={event.createdAt}
                      className="shrink-0 font-mono text-[10px] leading-5 text-muted-foreground"
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
