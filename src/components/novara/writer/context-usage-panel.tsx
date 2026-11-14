"use client";

// ---------------------------------------------------------------------------
// Novara AI — ContextUsagePanel (P2 → P4).
//
// Real-time token accounting, three layers of transparency:
//
//   1. THIS CALL — what the latest AI call sent, section by section:
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
//      AI call the PERSISTED ledger holds since tracking began (Phase 5),
//      grouped by surface (agent / draft / review / sediment / studio / detect /
//      generate / wizard / ai-team). Token transparency doesn't stop at the run
//      boundary. P5-b (Ruling 2): this is the ONE source of truth — the
//      in-memory process ledger was deleted outright, and the discontinuity
//      (rows before Phase 5 do not exist) renders from the persisted `since`.
//
// Data sources, in priority order:
//   1. The displayed run's `usage` events — measured per AI call, streamed
//      via the existing SSE detail snapshots (live during runs, correct when
//      browsing history).
//   2. GET /api/agent/context-estimate — an honest pre-run estimate assembled
//      from the same bytes the leader's first turn would send.
//
// The MCP row is kept at 0 ON PURPOSE: this system has no MCP server, and the
// panel answers that question visibly instead of hiding it.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AgentEvent, ContextUsage } from "@/lib/novara/agent-types";
import { latestContextUsage } from "@/lib/novara/agent-types";
import { authFetch } from "@/lib/firebase/client";
import { getModelDefinition, formatTokenCount } from "@/lib/novara/models";
import type {
  AccountUsageSnapshot,
  LedgerSurfaceUsage,
} from "@/lib/usage/usage-shapes";
import { surfaceLabel } from "@/lib/usage/usage-shapes";
import { cn } from "@/lib/utils";
import { UsageRow } from "@/components/novara/writer/usage-rows";
import { ROW_HEAD, TEXT_CAPTION, TEXT_META, TEXT_MICRO, TEXT_NOTE, TEXT_PANEL_TITLE } from "@/components/novara/styles";

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

/**
 * STEP 66.1 — the context segment of the composer's status line.
 *
 * The NUMBER moved from the old gauge button into the status line, but the
 * PANEL it opened did not die: this component renders the segment itself as
 * the popover trigger, so one click on "Context 5.3K" opens the same panel
 * (per-call section split · run totals · account ledger) the gauge used to
 * open — now anchored ABOVE the line.
 *
 * The pre-run estimate rides the same code path it always did: it is
 * fetched when the panel OPENS (never on render, never polled) and only
 * while no live usage exists.
 */
export function ContextUsageSegment({
  novelId,
  modelId,
  thinkingLevel = "low",
  events,
}: {
  novelId: string;
  /** The model's registry id — drives the pre-run estimate window. */
  modelId: string;
  /** The thinking level — forwarded to the estimate route. */
  thinkingLevel?: string;
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
  const estimateKey = `${novelId}:${modelId}:${thinkingLevel}`;
  const estimate = estimateState.key === estimateKey ? estimateState.usage : null;

  // Pre-run estimate — fetched only while the panel has no measured data.
  useEffect(() => {
    if (live || !open || estimateState.key === estimateKey) return;
    let alive = true;
    authFetch(
      `/api/agent/context-estimate?novelId=${encodeURIComponent(novelId)}&modelId=${encodeURIComponent(modelId)}&thinkingLevel=${encodeURIComponent(thinkingLevel)}`,
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
  }, [live, open, estimateKey, estimateState.key, novelId, modelId, thinkingLevel]);

  // App-wide persisted ledger (P5-b swap) — fetched when the panel opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    authFetch("/api/usage/ledger", { cache: "no-store" })
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

  // The segment itself: the ONE place the figure is rendered. "~" marks the
  // pre-run estimate (no call has billed a token yet) exactly as the old
  // gauge did.
  const segmentLabel =
    used > 0 ? `Context ${isLive ? "" : "~"}${formatTokenCount(used)}` : "Context —";
  const segmentTitle =
    used > 0
      ? `${formatTokenCount(used)} of ${formatTokenCount(window_)} tokens`
      : "No tokens used yet";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline cursor-pointer border-0 bg-transparent p-0 align-baseline text-caption font-normal leading-4 text-muted-foreground hover:underline focus-visible:underline"
          aria-label="Context usage — what each team call sends to the model"
          title={segmentTitle}
        >
          {segmentLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-80 rounded-xl p-4">
        {/* Layer 1 — THIS CALL (or, before any call: the pre-run estimate) */}
        <div className={ROW_HEAD}>
          <p className={TEXT_PANEL_TITLE}>
            Context Usage
            {!isLive && usage && (
              <span className="ml-1.5 rounded-full bg-warning-dot/15 px-1.5 py-0.5 align-middle text-micro font-medium uppercase tracking-wide text-warning-text-strong">
                estimate
              </span>
            )}
          </p>
          <p className={TEXT_MICRO}>{model.label}</p>
        </div>
        {/* Honest zero state: no usage events = no call has ever billed a token.
            The number below is what the FIRST call will send, not what was spent. */}
        {!isLive && usage && (
          <div className="mt-2 rounded-lg border border-warning-dot/30 bg-warning-dot/10 px-2.5 py-2">
            <p className="text-caption font-medium text-warning-text-strong">
              Nothing consumed yet — 0 API calls
            </p>
            <p className="mt-0.5 text-tiny leading-4 text-warning-text-strong/80">
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
          <span className={cn("ml-2", TEXT_META)}>
            {usedPct.toFixed(1)}%
          </span>
        </p>
        {real && (
          <p className={cn("mt-0.5 font-mono", TEXT_MICRO)}>
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
                <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden="true" />
                <span className={cn("flex-1", isMcp && "text-muted-foreground/70")}>
                  {label}
                  {isMcp && tokens === 0 && (
                    <span className="ml-1.5 text-tiny text-muted-foreground/70">
                      not used — no MCP server in this system
                    </span>
                  )}
                </span>
                <span className={cn("font-mono text-caption", isMcp && tokens === 0 ? "text-muted-foreground/70" : "")}>
                  {formatTokenCount(tokens)}
                </span>
                <span className={cn("w-10 text-right font-mono", TEXT_CAPTION)}>
                  {percent(tokens, usage?.used ?? 0)}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Layer 2 — THIS RUN (T2 + T3) */}
        {runStats.calls > 0 && (
          <div className="mt-3 border-t pt-2">
            <div className={ROW_HEAD}>
              <p className={TEXT_PANEL_TITLE}>
                Run total
                <span className={cn("ml-1.5 font-normal", TEXT_MICRO)}>
                  {runStats.calls} {runStats.calls === 1 ? "call" : "calls"}
                </span>
              </p>
              <p className="font-mono text-xs">{formatTokenCount(runStats.billedTokens)}</p>
            </div>
            <div className={cn("mt-1 flex items-center justify-between font-mono", TEXT_MICRO)}>
              <span>prompt {formatTokenCount(runStats.promptTokens)}</span>
              <span>output {formatTokenCount(runStats.completionTokens)}</span>
            </div>
            <p className={TEXT_NOTE}>
              {runStats.estimatedCalls === 0
                ? "All calls measured from provider usage."
                : `${runStats.measuredCalls} measured · ${runStats.estimatedCalls} estimated (pre-P4 event without provider usage).`}
            </p>
          </div>
        )}

        {/* Layer 3 — ALL AI SURFACES on this account (persisted ledger, P5-b) */}
        <div className="mt-3 border-t pt-2">
          <div className={ROW_HEAD}>
            <p className={TEXT_PANEL_TITLE}>All AI surfaces</p>
            <p className="max-w-[9rem] text-right text-tiny leading-3 text-muted-foreground">
              this account · persisted ledger · not tied to this novel
            </p>
          </div>
          {globalState && globalState.surfaces.length > 0 ? (
            <>
              <p className={TEXT_NOTE}>
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
                  <UsageRow
                    key={surface.surface}
                    label={surfaceLabel(surface.surface)}
                    calls={surface.calls}
                    tokens={formatTokenCount(surface.totalTokens)}
                    tokenWidth="w-12"
                  />
                ))}
              </ul>
              <p className={cn("mt-1.5 flex items-center justify-between font-mono", TEXT_MICRO)}>
                <span>
                  {globalState.totalCalls} calls · in {formatTokenCount(globalState.totalPromptTokens)} · out{" "}
                  {formatTokenCount(globalState.totalCompletionTokens)}
                </span>
                <span>Σ {formatTokenCount(globalState.totalTokens)}</span>
              </p>
            </>
          ) : (
            <p className={TEXT_NOTE}>
              {globalState
                ? "No usage rows yet — persisted tracking began with Phase 5; calls before it were never recorded. Streaming surfaces record only when the provider returns usage."
                : "Loading account usage…"}
            </p>
          )}
          {globalState && (
            <p
              className="mt-1 cursor-help text-tiny leading-4 text-muted-foreground/70"
              title={globalState.retention}
            >
              Details retained 90 days · totals survive permanently as daily summaries
            </p>
          )}
        </div>

        <p className="mt-3 border-t pt-2 text-tiny leading-4 text-muted-foreground">
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
