"use client";

// ---------------------------------------------------------------------------
// Novara AI — central "Usage & balance" view (Phase 5 / P5-b, extended P5-c).
//
// Mounted at the account-like anchor: the Guest session badge in the writer
// header (P5-b browser census: the badge is the ONLY session-bearing element
// present on every spend-producing surface — writer dashboard, novel
// workspace, and the wizard entry behind it; marketing routes produce zero
// GLM spend and carry no badge).
//
// Sections, all from GET /api/usage/ledger (Ruling 2: the ONE source of
// truth — the in-memory process ledger was deleted outright in P5-b):
//
//   BALANCE — unavailable-not-fabricated (proposal §5.2): the gateway's
//   headers are call-COUNT quotas (limit-daily / user-10min windows), not
//   token or currency billing, and there is no billing API at our boundary.
//   The view says so instead of inventing a number.
//
//   ACCOUNT USAGE — Σ calls / tokens across all surfaces, the per-surface,
//   per-model (P5-c) and per-novel splits, where deleted novels render as
//   "(deleted novel)" (Ruling 1: permanent account history, no cascade).
//   Failed attempts (Policy F: no completion payload, 0-token rows) are
//   disclosed separately — they inflate call counts but contribute zero
//   measured tokens.
//
//   ESTIMATE (P5-c §6) — every money figure on this view is computed from
//   measured UsageCall tokens x the sourced price table (pricing.ts) and is
//   an UPPER BOUND: the cached-input discount is invisible to us. Model
//   groups with no sourced price row render "unpriced model", never zero.
//   This file contains NO raw currency glyphs — every money string comes
//   from the pricing formatters, which permanently carry their labels
//   (harness-pinned).
//
//   INVOICE RECONCILIATION (P5-c §6.3) — a paste-slot for the account
//   holder's provider-console figure (USER-INPUT DEPENDENCY: no code can
//   discharge it). The pasted text is stored verbatim next to our ESTIMATE
//   captured at save time; the delta shown is display math on two labeled
//   figures, NOT a defect claim (our ESTIMATE covers only persisted rows).
//
//   DISCONTINUITY — rendered from the persisted `since`: "Tracking began
//   <date>" plus the explicit statement that earlier calls were not
//   recorded. Nothing pretends history it does not have (Ruling 2: no
//   backfill).
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  AccountUsageSnapshot,
  InvoiceSnapshot,
  LedgerModelUsage,
  LedgerSurfaceUsage,
} from "@/lib/usage/usage-shapes";
import {
  formatDeltaUsd,
  formatEstimateUsd,
  formatEstimateUsdCompact,
  formatPastedUsd,
} from "@/lib/usage/pricing";
import { formatTokenCount } from "@/lib/novara/models";

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

/**
 * §5.2 verdict, verbatim from the P3 meter investigation: the gateway's
 * rate-limit headers carry CALL-COUNT quotas (limit-daily 300, user-10min 30,
 * two undocumented daily counters), there is no billing API, and balance can
 * only ever be inferred from observed consumption calls. Stated, not faked.
 */
const BALANCE_NOTE =
  "Unavailable — this build's gateway enforces call-count rate limits, not token or currency billing, and exposes no billing API at our boundary. Nothing is charged in this preview build.";

export function UsageBalanceBadge({ guestAt }: { guestAt: string | null }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AccountUsageSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // P5-c invoice reconciliation state (paste-slot + recorded entries).
  const [invoices, setInvoices] = useState<InvoiceSnapshot | null>(null);
  const [invoiceFailed, setInvoiceFailed] = useState(false);
  const [periodLabel, setPeriodLabel] = useState("");
  const [actualInput, setActualInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Reset the failure flags in the EVENT handler (not the effect body — the
  // effect only touches state from async callbacks).
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setLoadFailed(false);
      setInvoiceFailed(false);
      setFormError(null);
    }
  };

  // Fetched when the popover opens — the ledger moves while the app runs.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/usage/ledger", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<AccountUsageSnapshot>;
      })
      .then((body) => {
        if (alive) setSnapshot(body);
      })
      .catch(() => {
        if (alive) {
          setSnapshot(null);
          setLoadFailed(true);
        }
      });
    fetch("/api/usage/invoice", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<InvoiceSnapshot>;
      })
      .then((body) => {
        if (alive) setInvoices(body);
      })
      .catch(() => {
        if (alive) {
          setInvoices(null);
          setInvoiceFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const began = snapshot?.since
    ? new Date(snapshot.since).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const saveFigure = async () => {
    setFormError(null);
    setLastSaved(null);
    const period = periodLabel.trim();
    const amount = actualInput.trim();
    if (!period) {
      setFormError("Name the period the figure covers (e.g. the console's billing month).");
      return;
    }
    if (!amount) {
      setFormError("Paste the console figure for that period.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/usage/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualUsd: amount, periodLabel: period }),
      });
      const body = (await res.json()) as { error?: string; deltaUsd?: number };
      if (!res.ok) {
        setFormError(body.error ?? `Recording failed (HTTP ${res.status}).`);
        return;
      }
      // Optimistic prepend from the POST response, then refresh in full —
      // the ESTIMATE side moves while the app runs, so the stored entry is
      // re-fetched for truth.
      setLastSaved(
        `Recorded for ${period}: ${formatPastedUsd(amount)} · ${
          typeof body.deltaUsd === "number" ? formatDeltaUsd(body.deltaUsd) : ""
        }`
      );
      setPeriodLabel("");
      setActualInput("");
      const refreshed = await fetch("/api/usage/invoice", { cache: "no-store" });
      if (refreshed.ok) setInvoices((await refreshed.json()) as InvoiceSnapshot);
    } catch {
      setFormError("Recording failed — the figure was NOT stored. Nothing is shown rather than a stale number.");
    } finally {
      setSaving(false);
    }
  };

  const modelLabel = (m: LedgerModelUsage): string =>
    m.modelId === "gateway-default" ? "gateway default (no model field)" : m.modelId;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Guest session — usage and balance"
          title={
            (guestAt
              ? `Guest session started ${new Date(guestAt).toLocaleString()} — accounts and authentication arrive later. `
              : "Guest session — accounts and authentication arrive later. ") +
            "Click for usage and balance."
          }
          className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge
            variant="outline"
            className="gap-1 text-[11px] text-muted-foreground"
          >
            <Wallet className="h-3 w-3" aria-hidden="true" />
            Guest session
          </Badge>
        </button>
      </PopoverTrigger>
      {/* The P5-c additions made the view taller than small viewports — cap
          and scroll the body so EVERY control (e.g. the paste-slot) is
          reachable; inner lists keep their own max-heights. */}
      <PopoverContent
        align="end"
        className="max-h-[calc(100vh-4rem)] w-80 overflow-y-auto rounded-xl p-4 nice-scroll"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold">Usage &amp; balance</p>
          <p className="text-[10px] text-muted-foreground">
            {guestAt
              ? `guest since ${new Date(guestAt).toLocaleDateString()}`
              : "guest session"}
          </p>
        </div>

        {/* Balance — unavailable-not-fabricated (§5.2) */}
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
            Balance: unavailable
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-amber-700/80 dark:text-amber-400/80">
            {BALANCE_NOTE}
          </p>
        </div>

        {/* Account usage — the persisted ledger, every surface (Ruling 2) */}
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold">Account usage</p>
            <p className="max-w-[10rem] text-right text-[10px] leading-3 text-muted-foreground">
              persisted ledger · all surfaces
            </p>
          </div>
          {loadFailed ? (
            <p className="mt-1 text-[10px] leading-4 text-destructive">
              Usage ledger could not be loaded — nothing is shown rather than
              showing stale numbers.
            </p>
          ) : !snapshot ? (
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              Loading account usage…
            </p>
          ) : snapshot.totalCalls === 0 ? (
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              No usage rows yet — persisted tracking began with Phase 5; calls
              before it were never recorded (no backfill).
            </p>
          ) : (
            <>
              <p className="mt-1.5 flex items-center justify-between font-mono text-[11px]">
                <span>
                  {snapshot.totalCalls} calls
                  {snapshot.failedCalls > 0 && (
                    <span className="ml-1 font-sans text-[10px] text-muted-foreground">
                      (incl. {snapshot.failedCalls} failed · 0 tokens)
                    </span>
                  )}
                </span>
                <span>Σ {formatTokenCount(snapshot.totalTokens)} tok</span>
              </p>
              <p className="mt-0.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                <span>
                  in {formatTokenCount(snapshot.totalPromptTokens)} · out{" "}
                  {formatTokenCount(snapshot.totalCompletionTokens)}
                </span>
              </p>

              {/* P5-c account ESTIMATE — upper bound over PRICED groups only */}
              <p className="mt-1 flex items-center justify-between font-mono text-[10px]">
                <span>{formatEstimateUsd(snapshot.estimate.usd)}</span>
                <span className="font-sans text-[9px] text-muted-foreground">
                  {snapshot.estimate.unpricedGroups > 0
                    ? `${snapshot.estimate.unpricedGroups} model group${
                        snapshot.estimate.unpricedGroups === 1 ? "" : "s"
                      } unpriced (excluded)`
                    : "all model groups priced"}
                </span>
              </p>

              <div className="mt-2 max-h-40 overflow-y-auto pr-1 nice-scroll">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  By surface
                </p>
                <ul className="mt-1 space-y-1">
                  {snapshot.surfaces.map((surface: LedgerSurfaceUsage) => (
                    <li
                      key={surface.surface}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {surfaceLabel(surface.surface)}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                        ×{surface.calls}
                      </span>
                      <span className="w-14 text-right font-mono">
                        {formatTokenCount(surface.totalTokens)}
                      </span>
                    </li>
                  ))}
                </ul>

                {snapshot.models.length > 0 && (
                  <>
                    <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      By model · ESTIMATE (upper bound)
                    </p>
                    <ul className="mt-1 space-y-1">
                      {snapshot.models.map((model) => (
                        <li
                          key={model.modelId}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {modelLabel(model)}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                            ×{model.calls}
                            {model.failedCalls > 0 && (
                              <span className="font-sans">
                                {" "}
                                ({model.failedCalls} failed · 0 tok)
                              </span>
                            )}
                          </span>
                          <span className="w-14 text-right font-mono">
                            {formatTokenCount(model.totalTokens)}
                          </span>
                          <span className="w-20 shrink-0 text-right font-mono text-[10px]">
                            {model.priced && model.estimatedUsd !== null
                              ? formatEstimateUsdCompact(model.estimatedUsd)
                              : "unpriced model"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[9px] leading-3 text-muted-foreground/80">
                      Measured tokens × sourced price table ({snapshot.estimate.pricingVersion});
                      the cached-input discount is invisible to us, so every
                      figure is an upper bound. Unpriced rows have NO sourced
                      price — shown, never guessed.
                    </p>
                  </>
                )}

                {snapshot.novels.length > 0 && (
                  <>
                    <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      By novel
                    </p>
                    <ul className="mt-1 space-y-1">
                      {snapshot.novels.map((novel) => (
                        <li
                          key={novel.novelId}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {novel.deleted ? "(deleted novel)" : novel.title}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                            ×{novel.calls}
                          </span>
                          <span className="w-14 text-right font-mono">
                            {formatTokenCount(novel.totalTokens)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* P5-c §6.3 — invoice reconciliation paste-slot (user-input
            dependency: the actual number can only come from the account
            holder's provider console; no billing API exists here). */}
        <div className="mt-3 border-t pt-2">
          <p className="text-xs font-semibold">Invoice reconciliation</p>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            Paste the provider console&apos;s spend figure for a period — it is
            stored verbatim against our ESTIMATE for the same tracked rows.
            The delta is display math on two labeled figures, not a defect
            claim: our ESTIMATE covers only persisted rows since tracking
            began and is an upper bound.
          </p>
          {invoiceFailed ? (
            <p className="mt-1 text-[10px] leading-4 text-destructive">
              Reconciliation history could not be loaded — nothing is shown
              rather than stale figures.
            </p>
          ) : (
            <>
              <div className="mt-1.5 flex flex-col gap-1.5">
                <Input
                  value={periodLabel}
                  onChange={(event) => setPeriodLabel(event.target.value)}
                  placeholder="period, e.g. 2026-11 (console's billing month)"
                  aria-label="Period the pasted figure covers"
                  className="h-7 text-[11px]"
                  maxLength={64}
                />
                <Input
                  value={actualInput}
                  onChange={(event) => setActualInput(event.target.value)}
                  placeholder="console spend figure, e.g. 12.34"
                  aria-label="Actual spend figure from the provider console"
                  inputMode="decimal"
                  className="h-7 text-[11px]"
                  maxLength={16}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={saving}
                  onClick={saveFigure}
                >
                  {saving && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  )}
                  Record figure
                </Button>
              </div>
              {formError && (
                <p className="mt-1 text-[10px] leading-4 text-destructive">{formError}</p>
              )}
              {lastSaved && !formError && (
                <p className="mt-1 text-[10px] leading-4 text-emerald-700 dark:text-emerald-400">
                  {lastSaved}
                </p>
              )}

              {invoices && invoices.entries.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto pr-1 nice-scroll">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Recorded comparisons ({invoices.totalEntries})
                  </p>
                  <ul className="mt-1 space-y-1.5">
                    {invoices.entries.map((entry) => {
                      const actual = Number(entry.actualUsd);
                      const estimate = Number(entry.estimatedUsd);
                      const delta =
                        Number.isFinite(actual) && Number.isFinite(estimate)
                          ? actual - estimate
                          : null;
                      return (
                        <li
                          key={entry.id}
                          className="rounded-md border px-2 py-1.5 text-[10px] leading-4"
                        >
                          <p className="font-medium">{entry.periodLabel}</p>
                          <p className="mt-0.5 font-mono">
                            {formatPastedUsd(entry.actualUsd)}
                          </p>
                          <p className="font-mono text-muted-foreground">
                            our side:{" "}
                            {formatEstimateUsd(
                              Number.isFinite(estimate) ? estimate : 0
                            )}
                          </p>
                          {delta !== null && (
                            <p className="font-mono text-muted-foreground">
                              {formatDeltaUsd(delta)}
                            </p>
                          )}
                          <p className="mt-0.5 text-[9px] text-muted-foreground/80">
                            at save: {entry.trackedRows} tracked rows · prices{" "}
                            {entry.pricingVersion}
                            {entry.note ? ` · ${entry.note}` : ""}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Discontinuity + retention — from the persisted snapshot, verbatim */}
        {snapshot && (
          <div className="mt-3 border-t pt-2">
            <p className="text-[10px] leading-4 text-muted-foreground">
              {snapshot.totalCalls > 0 && began
                ? `Tracking began ${began} — calls before that date were not recorded. `
                : "Persisted tracking began with Phase 5 — calls before it were not recorded. "}
              {snapshot.retention}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
