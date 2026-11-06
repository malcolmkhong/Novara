"use client";

// ---------------------------------------------------------------------------
// Novara AI — ContextUsagePanel (P2 → P4).
//
// Real-time token accounting, three layers of transparency:
//
//   1. THIS CALL — what the latest GLM call sent, section by section:
//      System Prompt · Tools · Skills · Novel Context · Conversation · MCP.
//      P4: the TOTAL is the provider's billed prompt_tokens (measured, hard
//      truth); the section split is the local estimate scaled proportionally
//      to it. Output tokens of that call are shown next to the total.
//
//   2. THIS RUN — sums across every usage event of the displayed run:
//      N calls · Σ prompt · Σ output · Σ billed. Estimated-only events (older
//      runs, stripped usage) fall back to their estimate and are counted
//      honestly as "estimated" in the label.
//
//   3. ALL AI SURFACES (this account) — GET /api/usage/ledger: every measured
//      GLM call the PERSISTED ledger holds since tracking began (Phase 5),
//      grouped by surface (agent / draft / review / sediment / studio / detect /
//      generate / wizard / ai-team). Token transparency doesn't stop at the run
//      boundary. P5-b (Ruling 2): this is the ONE source of truth — the
//      in-memory process ledger was deleted outright, and the discontinuity
//      (rows before Phase 5 do not exist) renders from the persisted `since`.
//
// Data sources, in priority order:
//   1. The displayed run's `usage` events — measured per GLM call, streamed
//      via the existing SSE detail snapshots (live during runs, correct when
//      browsing history).
//   2. GET /api/agent/context-estimate — an honest pre-run estimate assembled
//      from the same bytes the leader's first turn would send.
//
// The MCP row is kept at 0 ON PURPOSE: this system has no MCP server, and the
// panel answers that question visibly instead of hiding it.
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
import type {
  AccountUsageSnapshot,
  LedgerSurfaceUsage,
} from "@/lib/usage/usage-shapes";
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

/** Friendly labels for the app-wide ledger surfaces (P4 / T5). */
const SURFACE_LABELS: Record<string, string> = {
  agent: "Agent team runs",
  draft: "Chapter drafts",
  review: "Chapter reviews",
  sediment: "Memory sediment",
  studio: "Novel studio (init/plan/write)",
  detect: "AI detectors",
  generate: "Concept Q&A",
  wizard: "Onboarding wizard",
  "ai-team": "Onboarding team build",
  other: "Other",
};

function surfaceLabel(surface: string): string {
  return SURFACE_LABELS[surface] ?? surface;
}

function percent(tokens: number, used: number): string {
  if (used <= 0) return "0.0%";
  return `${((tokens / used) * 100).toFixed(1)}%`;
}

/** Extract the usage payload defensively (older events may lack it). */
function usageOf(event: AgentEvent): ContextUsage | null {
  const payload = event.payload as { usage?: ContextUsage } | null;
  return payload?.usage ?? null;
}

interface RunStats {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  billedTokens: number;
  measuredCalls: number;
  estimatedCalls: number;
}

/**
 * P4 / T2+T3 — run totals across every usage event of the displayed run.
 * Measured events contribute their billed prompt+completion; estimate-only
 * events (pre-P4 runs) contribute their prompt estimate and are counted in
 * `estimatedCalls` so the label never overclaims.
 */
function summarizeRun(events: AgentEvent[]): RunStats {
  const stats: RunStats = {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    billedTokens: 0,
    measuredCalls: 0,
    estimatedCalls: 0,
  };
  for (const event of events) {
    if (event.kind !== "usage") continue;
    const usage = usageOf(event);
    if (!usage) continue;
    stats.calls += 1;
    if (usage.real) {
      stats.measuredCalls += 1;
      stats.promptTokens += usage.real.promptTokens;
      stats.completionTokens += usage.real.completionTokens;
      stats.billedTokens += usage.real.totalTokens;
    } else {
      stats.estimatedCalls += 1;
      stats.promptTokens += usage.used;
      stats.billedTokens += usage.used;
    }
  }
  return stats;
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
  // App-wide persisted ledger (Ruling 2) — refetched on every open (it moves
  // while the app runs). since/retention render the Phase-5 discontinuity.
  const [globalState, setGlobalState] = useState<AccountUsageSnapshot | null>(null);

  const live = useMemo(() => latestContextUsage(events), [events]);
  const runStats = useMemo(() => summarizeRun(events), [events]);
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

  // App-wide persisted ledger (P5-b swap) — fetched when the panel opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/usage/ledger", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: AccountUsageSnapshot) => {
        if (alive) setGlobalState(body);
      })
      .catch(() => {
        if (alive) setGlobalState(null);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const usage = live ?? estimate;
  const model = getModelDefinition(usage?.modelId ?? modelId);
  const used = usage?.used ?? 0;
  const window_ = usage?.contextWindow ?? model.contextWindow;
  const usedPct = window_ > 0 ? Math.min((used / window_) * 100, 100) : 0;
  const isLive = live != null;
  const real = usage?.real ?? null;
  const isMeasured = isLive && real != null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-full px-2.5 text-[11px] font-medium"
          aria-label="Context usage"
          title="Context usage — what each team call sends to the model"
        >
          <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-mono">
            {used > 0
              ? `${isLive ? "" : "~"}${formatTokenCount(used)} / ${formatTokenCount(window_)}`
              : "Context"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 rounded-xl p-4">
        {/* Layer 1 — THIS CALL (or, before any call: the pre-run estimate) */}
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold">
            Context Usage
            {!isLive && usage && (
              <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 align-middle text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                estimate
              </span>
            )}
          </p>
          <p className="text-[10px] text-muted-foreground">{model.label}</p>
        </div>
        {/* Honest zero state: no usage events = no call has ever billed a token.
            The number below is what the FIRST call will send, not what was spent. */}
        {!isLive && usage && (
          <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
              Nothing consumed yet — 0 API calls
            </p>
            <p className="mt-0.5 text-[10px] leading-4 text-amber-700/80 dark:text-amber-400/80">
              This estimates what your first message will send. Fixed overhead — role
              card + tools + skills ≈{" "}
              {formatTokenCount(
                usage.sections.system + usage.sections.tools + usage.sections.skills
              )}{" "}
              — rides along on every call, so it is never zero.
            </p>
          </div>
        )}
        <p className="mt-1 font-mono text-sm">
          {!isLive && usage ? "~" : ""}
          {formatTokenCount(used)}
          <span className="text-muted-foreground"> / {formatTokenCount(window_)}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {usedPct.toFixed(1)}%
          </span>
        </p>
        {real && (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            measured · output {formatTokenCount(real.completionTokens)} · billed{" "}
            {formatTokenCount(real.totalTokens)}
          </p>
        )}

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

        {/* Layer 2 — THIS RUN (T2 + T3) */}
        {runStats.calls > 0 && (
          <div className="mt-3 border-t pt-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold">
                Run total
                <span className="ml-1.5 font-normal text-[10px] text-muted-foreground">
                  {runStats.calls} {runStats.calls === 1 ? "call" : "calls"}
                </span>
              </p>
              <p className="font-mono text-xs">{formatTokenCount(runStats.billedTokens)}</p>
            </div>
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
              <span>prompt {formatTokenCount(runStats.promptTokens)}</span>
              <span>output {formatTokenCount(runStats.completionTokens)}</span>
            </div>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {runStats.estimatedCalls === 0
                ? "All calls measured from provider usage."
                : `${runStats.measuredCalls} measured · ${runStats.estimatedCalls} estimated (pre-P4 event without provider usage).`}
            </p>
          </div>
        )}

        {/* Layer 3 — ALL AI SURFACES on this account (persisted ledger, P5-b) */}
        <div className="mt-3 border-t pt-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold">All AI surfaces</p>
            <p className="max-w-[9rem] text-right text-[10px] leading-3 text-muted-foreground">
              this account · persisted ledger · not tied to this novel
            </p>
          </div>
          {globalState && globalState.surfaces.length > 0 ? (
            <>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Tracking began{" "}
                {globalState.since
                  ? new Date(globalState.since).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })
                  : "—"}
                {" "}· earlier calls were not recorded · history is permanent
              </p>
              <ul className="mt-1.5 space-y-1">
                {globalState.surfaces.map((surface: LedgerSurfaceUsage) => (
                  <li key={surface.surface} className="flex items-center gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {surfaceLabel(surface.surface)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                      ×{surface.calls}
                    </span>
                    <span className="w-12 text-right font-mono">
                      {formatTokenCount(surface.totalTokens)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                <span>
                  {globalState.totalCalls} calls · in {formatTokenCount(globalState.totalPromptTokens)} · out{" "}
                  {formatTokenCount(globalState.totalCompletionTokens)}
                </span>
                <span>Σ {formatTokenCount(globalState.totalTokens)}</span>
              </p>
            </>
          ) : (
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {globalState
                ? "No usage rows yet — persisted tracking began with Phase 5; calls before it were never recorded. Streaming surfaces record only when the provider returns usage."
                : "Loading account usage…"}
            </p>
          )}
          {globalState && (
            <p
              className="mt-1 cursor-help text-[10px] leading-4 text-muted-foreground/70"
              title={globalState.retention}
            >
              Details retained 90 days · totals survive permanently as daily summaries
            </p>
          )}
        </div>

        <p className="mt-3 border-t pt-2 text-[10px] leading-4 text-muted-foreground">
          {usage
            ? isLive
              ? isMeasured
                ? `Live — ${usage.actor} · total measured from provider usage, section split estimated`
                : `Live — ${usage.actor}`
              : "Pre-run estimate — 0 calls made, nothing consumed yet · first leader turn preview"
            : "No data yet — starts counting at the first team call"}
          {(!usage || !isMeasured) && " · cl100k + CJK≈0.7 tok/char estimate"}
        </p>
      </PopoverContent>
    </Popover>
  );
}
