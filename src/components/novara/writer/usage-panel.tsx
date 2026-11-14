// ---------------------------------------------------------------------------
// Novara AI — the central "Usage & balance" view (Phase 5 / P5-b, extended
// P5-c). EXTRACTED from usage-balance-badge.tsx (Step 62), restructured in
// Step 64.
//
// Step 64 changes (render-only, no server work):
//   · the orange "Balance: unavailable" box is GONE from the render — the
//     credits pane above now shows the REAL balance (BALANCE_NOTE stays on
//     disk, exported, unrendered);
//   · the "guest session" sub-label is not rendered (the prop is kept);
//   · the nested scroll regions are gone — the pane scrolls, the panel does
//     not (one scroll container per pane);
//   · the invoice reconciliation form moved OUT of this component into
//     <InvoiceReconciliation />, which the settings dialog mounts inside the
//     collapsed "Developer tools" disclosure.
//
// The sections, all from GET /api/usage/ledger (Ruling 2: the ONE source of
// truth — the in-memory process ledger was deleted outright in P5-b):
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
//   DISCONTINUITY — rendered from the persisted `since`: "Tracking began
//   <date>" plus the explicit statement that earlier calls were not
//   recorded. Nothing pretends history it does not have (Ruling 2: no
//   backfill).
//
//   RETENTION LAYERING (P5-f, R-2) — the view shows the most recent ~31
//   days as itemized per-call detail rows; older days render from the
//   persisted daily aggregates, each labeled "summary — details retained
//   90 days". Detail rows still retained beyond the itemized window (31–90
//   days) are disclosed with their count and remain in the CSV statement.
//   The statement (CSV export, in-memory, zero server-side files) carries
//   ALL retained details + all summaries — the pre-expiry escape hatch.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatDeltaUsd,
  formatEstimateUsd,
  formatEstimateUsdCompact,
  formatPastedUsd,
} from "@/lib/usage/pricing";
import { authFetch } from "@/lib/firebase/client";
import { formatTokenCount } from "@/lib/novara/models";
import type {
  AccountUsageSnapshot,
  InvoiceSnapshot,
  LedgerDailySummary,
  LedgerModelUsage,
  LedgerSurfaceUsage,
  UsageHistoryBlock,
} from "@/lib/usage/usage-shapes";
import { surfaceLabel } from "@/lib/usage/usage-shapes";
import { Spinner } from "@/components/novara/primitives";
import { UsageRow } from "@/components/novara/writer/usage-rows";
import { cn } from "@/lib/utils";
import { ROW_HEAD, TEXT_MICRO, TEXT_NOTE, TEXT_PANEL_TITLE, TEXT_SECTION } from "@/components/novara/styles";

/**
 * §5.2 verdict, verbatim from the P3 meter investigation. Step 64: the
 * balance is NOT rendered any more (the credits pane shows the real one), so
 * this copy is kept on disk for the record and is no longer shown.
 */
export const BALANCE_NOTE =
  "Unavailable — this build's gateway enforces call-count rate limits, not token or currency billing, and exposes no billing API at our boundary. Nothing is charged in this preview build.";

/** The guest sub-label: kept on disk, not rendered (Step 64). */
export const GUEST_SESSION_LABEL = "guest session";

export function UsagePanel({
  guestAt = null,
  snapshot: provided,
}: {
  guestAt?: string | null;
  /** A snapshot the caller already fetched (the credits pane does). */
  snapshot?: AccountUsageSnapshot | null;
}) {
  const [own, setOwn] = useState<AccountUsageSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Fetched when the panel mounts — unless the caller already has it.
  useEffect(() => {
    if (provided !== undefined) return;
    let alive = true;
    authFetch("/api/usage/ledger", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<AccountUsageSnapshot>;
      })
      .then((body) => {
        if (alive) setOwn(body);
      })
      .catch(() => {
        if (alive) {
          setOwn(null);
          setLoadFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [provided]);

  const snapshot = provided !== undefined ? provided : own;
  const failed = provided !== undefined ? !provided : loadFailed;

  const began = snapshot?.since
    ? new Date(snapshot.since).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const modelLabel = (m: LedgerModelUsage): string =>
    m.modelId === "gateway-default" ? "gateway default (no model field)" : m.modelId;

  /** One line of the itemized history (detail rows, newest first). */
  const historyLine = (row: UsageHistoryBlock["rows"][number]): string => {
    const at = new Date(row.at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${at} · ${surfaceLabel(row.surface)} · ${row.modelId}${
      row.status === "failed" ? " · FAILED (0 tok)" : ""
    }`;
  };

  const summaryLine = (s: LedgerDailySummary): string =>
    `${s.day} · ${surfaceLabel(s.surface)} · ${s.modelId} · ×${s.calls}${
      s.failedCalls > 0 ? ` (${s.failedCalls} failed)` : ""
    } · ${s.totalTokens.toLocaleString()} tok`;

  return (
    <div>
      <div className={ROW_HEAD}>
        <p className={TEXT_PANEL_TITLE}>Usage &amp; balance</p>
        {guestAt ? (
          <p className={TEXT_MICRO}>
            {`guest since ${new Date(guestAt).toLocaleDateString()}`}
          </p>
        ) : null}
      </div>

      {/* Account usage — the persisted ledger, every surface (Ruling 2) */}
      <div className="mt-3">
        <div className={ROW_HEAD}>
          <p className={TEXT_PANEL_TITLE}>Account usage</p>
          <p className="max-w-[10rem] text-right text-tiny leading-3 text-muted-foreground">
            persisted ledger · all surfaces
          </p>
        </div>
        {failed ? (
          <p className="mt-1 text-tiny leading-4 text-destructive">
            Usage ledger could not be loaded — nothing is shown rather than
            showing stale numbers.
          </p>
        ) : !snapshot ? (
          <p className={TEXT_NOTE}>
            Loading account usage…
          </p>
        ) : snapshot.totalCalls === 0 ? (
          <p className={TEXT_NOTE}>
            No usage rows yet — persisted tracking began with Phase 5; calls
            before it were never recorded (no backfill).
          </p>
        ) : (
          <>
            <p className="mt-1.5 flex items-center justify-between font-mono text-caption">
              <span>
                {snapshot.totalCalls} calls
                {snapshot.failedCalls > 0 && (
                  <span className={cn("ml-1 font-sans", TEXT_MICRO)}>
                    (incl. {snapshot.failedCalls} failed · 0 tokens)
                  </span>
                )}
              </span>
              <span>Σ {formatTokenCount(snapshot.totalTokens)} tok</span>
            </p>
            <p className={cn("mt-0.5 flex items-center justify-between font-mono", TEXT_MICRO)}>
              <span>
                in {formatTokenCount(snapshot.totalPromptTokens)} · out{" "}
                {formatTokenCount(snapshot.totalCompletionTokens)}
              </span>
            </p>

            {/* P5-c account ESTIMATE — upper bound over PRICED groups only */}
            <p className="mt-1 flex items-center justify-between font-mono text-tiny">
              <span>{formatEstimateUsd(snapshot.estimate.usd)}</span>
              <span className="font-sans text-micro text-muted-foreground">
                {snapshot.estimate.unpricedGroups > 0
                  ? `${snapshot.estimate.unpricedGroups} model group${
                      snapshot.estimate.unpricedGroups === 1 ? "" : "s"
                    } unpriced (excluded)`
                  : "all model groups priced"}
              </span>
            </p>

            <div className="mt-2 pr-1">
              <p className={TEXT_SECTION}>
                By surface
              </p>
              <ul className="mt-1 space-y-1">
                {snapshot.surfaces.map((surface: LedgerSurfaceUsage) => (
                  <UsageRow
                    key={surface.surface}
                    label={surfaceLabel(surface.surface)}
                    calls={surface.calls}
                    tokens={formatTokenCount(surface.totalTokens)}
                  />
                ))}
              </ul>

              {snapshot.models.length > 0 && (
                <>
                  <p className={cn("mt-2", TEXT_SECTION)}>
                    By model · ESTIMATE (upper bound)
                  </p>
                  <ul className="mt-1 space-y-1">
                    {snapshot.models.map((model) => (
                      <UsageRow
                        key={model.modelId}
                        label={modelLabel(model)}
                        calls={model.calls}
                        tokens={formatTokenCount(model.totalTokens)}
                        callsSuffix={
                          model.failedCalls > 0 ? (
                            <span className="font-sans">
                              {" "}
                              ({model.failedCalls} failed · 0 tok)
                            </span>
                          ) : null
                        }
                        trailing={
                          <span className="w-20 shrink-0 text-right font-mono text-tiny">
                            {model.priced && model.estimatedUsd !== null
                              ? formatEstimateUsdCompact(model.estimatedUsd)
                              : "unpriced model"}
                          </span>
                        }
                      />
                    ))}
                  </ul>
                  <p className="mt-1 text-micro leading-3 text-muted-foreground/80">
                    Measured tokens × sourced price table ({snapshot.estimate.pricingVersion});
                    the cached-input discount is invisible to us, so every
                    figure is an upper bound. Unpriced rows have NO sourced
                    price — shown, never guessed.
                  </p>
                </>
              )}

              {snapshot.novels.length > 0 && (
                <>
                  <p className={cn("mt-2", TEXT_SECTION)}>
                    By novel
                  </p>
                  <ul className="mt-1 space-y-1">
                    {snapshot.novels.map((novel) => (
                      <UsageRow
                        key={novel.novelId}
                        label={novel.deleted ? "(deleted novel)" : novel.title}
                        calls={novel.calls}
                        tokens={formatTokenCount(novel.totalTokens)}
                      />
                    ))}
                  </ul>
                </>
              )}

              {/* P5-f (R-2) — retention layering: itemized detail rows for
                  the last ~31 days; older days render from the persisted
                  daily aggregates, labeled "summary — details retained 90
                  days". The 31–90 day window is retained (and exported)
                  but not itemized here — disclosed with its count. */}
              {(snapshot.history.rows.length > 0 ||
                snapshot.history.summaries.length > 0 ||
                snapshot.history.retainedNotItemized > 0) && (
                <>
                  <p className={cn("mt-2", TEXT_SECTION)}>
                    Transaction history · last {snapshot.history.windowDays} days
                  </p>
                  {snapshot.history.rows.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {snapshot.history.rows.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-center justify-between gap-2 text-tiny"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                            {historyLine(row)}
                          </span>
                          <span className="shrink-0 font-mono text-tiny">
                            {row.status === "failed" ? "—" : formatTokenCount(row.totalTokens)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {snapshot.history.omitted > 0 && (
                    <p className="mt-0.5 text-micro text-muted-foreground/80">
                      +{snapshot.history.omitted} more call
                      {snapshot.history.omitted === 1 ? "" : "s"} inside the window — the
                      CSV statement lists every retained line.
                    </p>
                  )}
                  {snapshot.history.retainedNotItemized > 0 && (
                    <p className="mt-0.5 text-micro leading-3 text-muted-foreground/80">
                      {snapshot.history.retainedNotItemized} retained call
                      {snapshot.history.retainedNotItemized === 1 ? "" : "s"} older than{" "}
                      {snapshot.history.windowDays} days (details kept 90 days) — not
                      itemized here; included in the CSV statement.
                    </p>
                  )}
                  {snapshot.history.summaries.length > 0 && (
                    <>
                      <p className={cn("mt-2", TEXT_SECTION)}>
                        Older days · {snapshot.history.summaryNote}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {snapshot.history.summaries.map((s) => (
                          <li
                            key={`${s.day}|${s.surface}|${s.novelKey}|${s.modelId}`}
                            className="flex items-center justify-between gap-2 text-tiny"
                          >
                            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                              {summaryLine(s)}
                            </span>
                            <span className="w-16 shrink-0 text-right font-mono text-micro text-muted-foreground/80">
                              {s.estimatedUsd !== null
                                ? formatEstimateUsdCompact(s.estimatedUsd)
                                : "unpriced"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Discontinuity + retention + statement export — from the persisted
          snapshot, verbatim (P5-f: the CSV statement is the pre-expiry
          escape hatch — all retained details + all daily summaries,
          generated in memory, nothing persisted server-side). */}
      {snapshot && (
        <div className="mt-3 border-t pt-2">
          <p className="text-tiny leading-4 text-muted-foreground">
            {snapshot.totalCalls > 0 && began
              ? `Tracking began ${began} — calls before that date were not recorded. `
              : "Persisted tracking began with Phase 5 — calls before it were not recorded. "}
            {snapshot.retention}
          </p>
          <a
            href="/api/usage/statement"
            download
            className="mt-1.5 inline-flex h-7 items-center justify-center rounded-md border px-2.5 text-caption font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Download the full usage statement as CSV"
          >
            Export statement (CSV)
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * P5-c §6.3 — the invoice reconciliation paste-slot (a user-input
 * dependency: the actual number can only come from the account holder's
 * provider console; no billing API exists here).
 *
 * Step 64: moved out of <UsagePanel /> into the settings dialog's collapsed
 * "Developer tools" disclosure — the form itself is unchanged.
 */
export function InvoiceReconciliation() {
  const [invoices, setInvoices] = useState<InvoiceSnapshot | null>(null);
  const [invoiceFailed, setInvoiceFailed] = useState(false);
  const [periodLabel, setPeriodLabel] = useState("");
  const [actualInput, setActualInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    authFetch("/api/usage/invoice", { cache: "no-store" })
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
  }, []);

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
      const res = await authFetch("/api/usage/invoice", {
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
      const refreshed = await authFetch("/api/usage/invoice", { cache: "no-store" });
      if (refreshed.ok) setInvoices((await refreshed.json()) as InvoiceSnapshot);
    } catch {
      setFormError("Recording failed — the figure was NOT stored. Nothing is shown rather than a stale number.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className={TEXT_PANEL_TITLE}>Invoice reconciliation</p>
      <p className="mt-0.5 text-tiny leading-4 text-muted-foreground">
        Paste the provider console&apos;s spend figure for a period — it is
        stored verbatim against our ESTIMATE for the same tracked rows. The
        delta is display math on two labeled figures, not a defect claim: our
        ESTIMATE covers only persisted rows since tracking began and is an
        upper bound.
      </p>
      {invoiceFailed ? (
        <p className="mt-1 text-tiny leading-4 text-destructive">
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
              className="h-7 text-caption"
              maxLength={64}
            />
            <Input
              value={actualInput}
              onChange={(event) => setActualInput(event.target.value)}
              placeholder="console spend figure, e.g. 12.34"
              aria-label="Actual spend figure from the provider console"
              inputMode="decimal"
              className="h-7 text-caption"
              maxLength={16}
            />
            <Button
              type="button"
              size="sm"
              className="h-7 text-caption"
              disabled={saving}
              onClick={saveFigure}
            >
              {saving && (
                <Spinner size="sm" className="mr-1" />
              )}
              Record figure
            </Button>
          </div>
          {formError && (
            <p className="mt-1 text-tiny leading-4 text-destructive">{formError}</p>
          )}
          {lastSaved && !formError && (
            <p className="mt-1 text-tiny leading-4 text-success-text-strong">
              {lastSaved}
            </p>
          )}

          {invoices && invoices.entries.length > 0 && (
            <div className="mt-2 pr-1">
              <p className={TEXT_SECTION}>
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
                      className="rounded-md border px-2 py-1.5 text-tiny leading-4"
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
                      <p className="mt-0.5 text-micro text-muted-foreground/80">
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
  );
}
