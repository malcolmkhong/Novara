"use client";

// ---------------------------------------------------------------------------
// Novara AI — the settings modal (Step 62; geometry + panes fixed in Step 64).
//
// FIXED GEOMETRY (Step 64): the dialog is always
//   width  min(720px, 92vw)   height min(640px, 85vh)
// — switching panes NEVER resizes it. The left nav is a fixed 180px column;
// the right pane is the only scroll container.
//
// Four panes:
//   Account        who is signed in (read-only) · sign out
//   Appearance     the editor font size
//   Credits & usage  the credit gauge, today's usage, the moved usage panel
//                    (behind "More details") and the developer tools (behind
//                    "Developer tools")
//   About          the build: version, deployed commit, the legal links
//
// Radix gives the focus trap, the Escape close, the backdrop close and the
// focus restore; the trigger (the user menu) puts the focus back when the
// dialog closes.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { authFetch, getFirebaseAuth, signOutUser } from "@/lib/firebase/client";
import { useCredits } from "@/hooks/use-credits";
import { useHashRoute } from "@/hooks/use-hash-route";
import {
  FONT_SCALE_OPTIONS,
  readFontScale,
  writeFontScale,
  type FontScaleId,
} from "@/lib/novara/settings";
import { APP_VERSION } from "@/config/novara";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { InvoiceReconciliation, UsagePanel } from "@/components/novara/writer/usage-panel";
import type { AccountUsageSnapshot } from "@/lib/usage/usage-shapes";
import { cn } from "@/lib/utils";

export type SettingsPane = "account" | "appearance" | "credits" | "about";

const PANES: { id: SettingsPane; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "appearance", label: "Appearance" },
  { id: "credits", label: "Credits & usage" },
  { id: "about", label: "About" },
];

/**
 * Today's usage, grouped into plain words. The numbers are CALLS (what the
 * persisted ledger counts exactly) — no money is shown here; the money lives
 * in the "More details" disclosure, where it is labeled as an estimate.
 */
const TODAY_GROUPS: { label: string; surfaces: string[] }[] = [
  { label: "Writing chapters", surfaces: ["draft", "studio"] },
  { label: "Running the team", surfaces: ["agent", "ai-team"] },
  { label: "Reviews and checks", surfaces: ["review", "sediment", "qc"] },
  { label: "Detectors and questions", surfaces: ["detect", "generate", "wizard"] },
];

/** One "label left · control right" row. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 sm:w-48 sm:shrink-0">
        <p className="text-sm">{label}</p>
        {hint ? (
          <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:justify-end">
        {children}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/** A collapsed disclosure row (the content is NOT mounted until opened). */
function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-2 text-left text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
        {label}
      </button>
      {open ? <div className="pb-3">{children}</div> : null}
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  pane,
  onPaneChange,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The active pane — controlled by the caller (the user menu). */
  pane: SettingsPane;
  /** The caller switches panes. */
  onPaneChange: (pane: SettingsPane) => void;
  /** Called after the dialog closed — the menu uses it to restore the focus. */
  onClosed?: () => void;
}) {
  const { navigate } = useHashRoute();
  const { credits, error } = useCredits();
  const [fontScale, setFontScale] = useState<FontScaleId>(() => readFontScale());
  const [commit, setCommit] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<AccountUsageSnapshot | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);

  // The deployed commit comes from the public health route.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/health", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!alive || !body) return;
        const released = (body as { release?: { commit?: string | null } }).release
          ?.commit;
        setCommit(released ? released.slice(0, 7) : null);
      })
      .catch(() => {
        if (alive) setCommit(null);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // The credits pane needs the ledger for today's rows (the usage panel gets
  // the same snapshot when "More details" is opened).
  useEffect(() => {
    if (!open || pane !== "credits") return;
    let alive = true;
    authFetch("/api/usage/ledger", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (alive) setSnapshot(body as AccountUsageSnapshot | null);
      })
      .catch(() => {
        if (alive) setSnapshot(null);
      });
    return () => {
      alive = false;
    };
  }, [open, pane]);

  const handleSignOut = async () => {
    await signOutUser();
    onOpenChange(false);
    onClosed?.();
    navigate("home");
  };

  const email = getFirebaseAuth().currentUser?.email ?? null;

  const balance = credits?.balance ?? null;
  const allowance = credits?.allowance ?? 0;
  const usedToday = credits?.usedToday ?? 0;
  const resetLabel = credits?.resetAt
    ? new Date(credits.resetAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const todayRows = TODAY_GROUPS.map((group) => {
    const calls = group.surfaces.reduce((sum, surface) => {
      const row = snapshot?.surfaces.find((s) => s.surface === surface);
      return sum + (row?.calls ?? 0);
    }, 0);
    return { label: group.label, calls };
  }).filter((row) => row.calls > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) onClosed?.();
      }}
    >
      {/* FIXED GEOMETRY: the frame never resizes with the pane.
          w = min(720px, 92vw), h = min(640px, 85vh) at every width. */}
      <DialogContent
        className="flex flex-col w-[min(720px,92vw)] h-[min(640px,85vh)] max-w-none sm:max-w-none gap-0 overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          // Radix would restore the focus to the element that was focused
          // before the dialog opened — the menu row that opened it, which is
          // unmounted by now, so the focus would fall to the body. Hand it
          // back to the trigger instead.
          event.preventDefault();
          onClosed?.();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
          <DialogTitle className="text-base">Settings</DialogTitle>
          <DialogDescription className="text-[11px]">
            Your account, your credits and your preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Left nav — a fixed 180px column on ≥ sm, a scrolling chip strip
              below it. It never takes its width from the content. */}
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-[180px] sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3"
          >
            {PANES.map((entry) => {
              const active = pane === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onPaneChange(entry.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-muted text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {entry.label}
                </button>
              );
            })}
          </nav>

          {/* The pane — the ONLY scroll container. */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            {pane === "account" && (
              <>
                <SectionTitle>Account</SectionTitle>
                <Separator className="mt-2" />
                <Row label="Email">
                  <span className="min-w-0 break-all text-sm text-muted-foreground">
                    {email ?? "—"}
                  </span>
                </Row>
                <Separator />
                <Row label="Sign-in method">
                  <Badge variant="outline" className="text-[11px]">
                    Signed in with Google
                  </Badge>
                </Row>
                <Separator />
                <Row label="Session">
                  <Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
                    Sign out
                  </Button>
                </Row>
              </>
            )}

            {pane === "appearance" && (
              <>
                <SectionTitle>Appearance</SectionTitle>
                <Separator className="mt-2" />
                <Row label="Editor font size">
                  <div
                    role="group"
                    aria-label="Editor font size"
                    className="inline-flex overflow-hidden rounded-md border"
                  >
                    {FONT_SCALE_OPTIONS.map((option) => {
                      const active = fontScale === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setFontScale(option.id);
                            writeFontScale(option.id);
                          }}
                          className={cn(
                            "px-2 py-1 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                            active
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </Row>
              </>
            )}

            {pane === "credits" && (
              <>
                {/* HERO */}
                <SectionTitle>Credits &amp; usage</SectionTitle>
                <Separator className="mt-2" />
                <div className="py-3">
                  {error ? (
                    <p className="text-sm text-destructive">
                      The credit balance could not be loaded — nothing is shown
                      rather than a stale number.
                    </p>
                  ) : credits?.unlimited ? (
                    <>
                      <p className="text-sm">Unlimited</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {usedToday} credits used today
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">
                        {balance ?? "—"} / {allowance} credits left today
                      </p>
                      <Progress
                        className="mt-2 h-1.5"
                        value={
                          allowance > 0
                            ? Math.min(100, Math.round(((balance ?? 0) / allowance) * 100))
                            : 0
                        }
                        aria-label={`${balance ?? 0} of ${allowance} credits left today`}
                      />
                      {resetLabel ? (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          resets {resetLabel}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                {/* TODAY — plain words, no money */}
                <Separator />
                <div className="py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold">Today</p>
                    <p className="text-[10px] text-muted-foreground">calls</p>
                  </div>
                  {todayRows.length === 0 ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      No AI calls recorded today.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {todayRows.map((row) => (
                        <li
                          key={row.label}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="min-w-0 truncate text-muted-foreground">
                            {row.label}
                          </span>
                          <span className="font-mono text-xs">{row.calls}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* MORE DETAILS — the usage sections */}
                <Separator />
                <Disclosure
                  label="More details"
                  open={detailsOpen}
                  onToggle={() => setDetailsOpen((v) => !v)}
                >
                  <UsagePanel snapshot={snapshot} />
                </Disclosure>
                <Separator />
                <p className="py-3 text-[11px] text-muted-foreground">
                  Usage details are kept for 90 days.
                </p>

                {/* DEVELOPER TOOLS — the invoice form, unchanged, collapsed */}
                <Separator />
                <Disclosure
                  label="Developer tools"
                  open={devOpen}
                  onToggle={() => setDevOpen((v) => !v)}
                >
                  <InvoiceReconciliation />
                </Disclosure>
              </>
            )}

            {pane === "about" && (
              <>
                <SectionTitle>About</SectionTitle>
                <Separator className="mt-2" />
                <Row label="Version">
                  <span className="font-mono text-sm text-muted-foreground">
                    {APP_VERSION}
                  </span>
                </Row>
                <Separator />
                <Row label="Deployed commit">
                  <span className="font-mono text-sm text-muted-foreground">
                    {commit ?? "—"}
                  </span>
                </Row>
                <Separator />
                <Row label="Legal">
                  <div className="flex items-center gap-3">
                    <a
                      href="#/terms"
                      className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Terms
                    </a>
                    <a
                      href="#/privacy"
                      className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Privacy
                    </a>
                  </div>
                </Row>
                <Separator />
                <Row label="Build">
                  <Badge variant="outline" className="text-[11px]">
                    Preview build
                  </Badge>
                </Row>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
