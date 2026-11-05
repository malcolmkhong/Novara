"use client";

// ---------------------------------------------------------------------------
// Novara AI — central "Usage & balance" view (Phase 5 / P5-b, proposal §5).
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
//   ACCOUNT USAGE — Σ calls / tokens across all surfaces, the per-surface
//   split, and the per-novel split where deleted novels render as
//   "(deleted novel)" (Ruling 1: permanent account history, no cascade).
//   Failed attempts (Policy F: no completion payload, 0-token rows) are
//   disclosed separately — they inflate call counts but contribute zero
//   measured tokens.
//
//   DISCONTINUITY — rendered from the persisted `since`: "Tracking began
//   <date>" plus the explicit statement that earlier calls were not
//   recorded. Nothing pretends history it does not have (Ruling 2: no
//   backfill).
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  AccountUsageSnapshot,
  LedgerSurfaceUsage,
} from "@/lib/usage/usage-shapes";
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

  // Reset the failure flag in the EVENT handler (not the effect body — the
  // effect only touches state from async callbacks).
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setLoadFailed(false);
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
      <PopoverContent align="end" className="w-80 rounded-xl p-4">
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
