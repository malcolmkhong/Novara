"use client";

// ---------------------------------------------------------------------------
// Novara AI — ContextUsagePanel (P2).
//
// Real-time token accounting for the agent team, section by section:
//   System Prompt · Tools · Skills · Novel Context · Conversation · MCP.
//
// Data sources, in priority order:
//   1. The displayed run's latest `usage` event — REAL measured numbers,
//      updated per GLM call and streamed here via the existing SSE detail
//      snapshots (live during runs, and correct when browsing history).
//   2. GET /api/agent/context-estimate — an honest pre-run estimate assembled
//      from the same bytes the leader's first turn would send.
//
// The MCP row is kept at 0 ON PURPOSE: this system has no MCP server, and the
// panel answers that question visibly instead of hiding it. Novel Context is
// this system's equivalent of external knowledge (story snapshot + pinned
// refs). Token counts are estimates (cl100k for latin, 0.7 tok/char for CJK)
// and the footer says so.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AgentEvent, ContextUsage } from "@/lib/novara/agent-types";
import { latestContextUsage } from "@/lib/novara/agent-types";
import { getModelDefinition, formatTokenCount } from "@/lib/novara/models";
import { cn } from "@/lib/utils";

const SECTION_META: {
  key: keyof ContextUsage["sections"];
  label: string;
  dot: string;
  bar: string;
}[] = [
  { key: "system", label: "System Prompt", dot: "bg-violet-500", bar: "bg-violet-500" },
  { key: "tools", label: "Tools", dot: "bg-amber-500", bar: "bg-amber-500" },
  { key: "skills", label: "Skills", dot: "bg-teal-500", bar: "bg-teal-500" },
  { key: "novel", label: "Novel Context", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  { key: "conversation", label: "Conversation", dot: "bg-rose-500", bar: "bg-rose-500" },
  { key: "mcp", label: "MCP", dot: "bg-zinc-400", bar: "bg-zinc-400" },
];

function percent(tokens: number, used: number): string {
  if (used <= 0) return "0.0%";
  return `${((tokens / used) * 100).toFixed(1)}%`;
}

export function ContextUsageButton({
  novelId,
  modelId,
  events,
}: {
  novelId: string;
  /** The composer's selected model — drives the pre-run estimate window. */
  modelId: string;
  /** The displayed run's events (latest `usage` wins). */
  events: AgentEvent[];
}) {
  const [open, setOpen] = useState(false);
  // Estimate cache keyed by novel+model — a key mismatch means the rendered
  // selection changed and the cached body no longer applies. State is only
  // written from async callbacks (never synchronously inside the effect).
  const [estimateState, setEstimateState] = useState<{ key: string; usage: ContextUsage | null }>({
    key: "",
    usage: null,
  });

  const live = useMemo(() => latestContextUsage(events), [events]);
  const estimateKey = `${novelId}:${modelId}`;
  const estimate = estimateState.key === estimateKey ? estimateState.usage : null;

  // Pre-run estimate — fetched only while the panel has no measured data.
  useEffect(() => {
    if (live || !open || estimateState.key === estimateKey) return;
    let alive = true;
    fetch(
      `/api/agent/context-estimate?novelId=${encodeURIComponent(novelId)}&modelId=${encodeURIComponent(modelId)}`,
      { cache: "no-store" }
    )
      .then((res) => res.json())
      .then((body: { estimate?: ContextUsage }) => {
        if (alive) setEstimateState({ key: estimateKey, usage: body.estimate ?? null });
      })
      .catch(() => {
        // estimate is best-effort — cache the miss so we don't retry-loop
        if (alive) setEstimateState({ key: estimateKey, usage: null });
      });
    return () => {
      alive = false;
    };
  }, [live, open, estimateKey, estimateState.key, novelId, modelId]);

  const usage = live ?? estimate;
  const model = getModelDefinition(usage?.modelId ?? modelId);
  const used = usage?.used ?? 0;
  const window_ = usage?.contextWindow ?? model.contextWindow;
  const usedPct = window_ > 0 ? Math.min((used / window_) * 100, 100) : 0;
  const isLive = live != null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 rounded-full px-2.5 text-[11px] font-medium"
          aria-label="Context usage"
          title="Context usage — what each team call sends to the model"
        >
          <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-mono">
            {used > 0 ? `${formatTokenCount(used)} / ${formatTokenCount(window_)}` : "Context"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-xl p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold">Context Usage</p>
          <p className="text-[10px] text-muted-foreground">{model.label}</p>
        </div>
        <p className="mt-1 font-mono text-sm">
          {formatTokenCount(used)}
          <span className="text-muted-foreground"> / {formatTokenCount(window_)}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {usedPct.toFixed(1)}%
          </span>
        </p>

        {/* Stacked fill bar — sections in registry order */}
        <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-muted">
          {usage &&
            SECTION_META.map(({ key, bar }) => {
              const tokens = usage.sections[key];
              if (!tokens) return null;
              return (
                <div
                  key={key}
                  className={cn(bar, "h-full")}
                  style={{ width: `${(tokens / Math.max(usage.used, 1)) * 100}%` }}
                />
              );
            })}
        </div>

        <ul className="mt-3 space-y-1.5">
          {SECTION_META.map(({ key, label, dot }) => {
            const tokens = usage?.sections[key] ?? 0;
            const isMcp = key === "mcp";
            return (
              <li key={key} className="flex items-center gap-2 text-xs">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden="true" />
                <span className={cn("flex-1", isMcp && "text-muted-foreground/70")}>
                  {label}
                  {isMcp && tokens === 0 && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground/70">
                      not used — no MCP server in this system
                    </span>
                  )}
                </span>
                <span className={cn("font-mono text-[11px]", isMcp && tokens === 0 ? "text-muted-foreground/70" : "")}>
                  {formatTokenCount(tokens)}
                </span>
                <span className="w-10 text-right font-mono text-[11px] text-muted-foreground">
                  {percent(tokens, usage?.used ?? 0)}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 border-t pt-2 text-[10px] leading-4 text-muted-foreground">
          {usage
            ? isLive
              ? `Live — ${usage.actor}`
              : "Estimated from the current novel state (first leader turn)"
            : "No data yet — starts counting at the first team call"}
          {usage && " · cl100k + CJK≈0.7 tok/char estimate"}
        </p>
      </PopoverContent>
    </Popover>
  );
}
