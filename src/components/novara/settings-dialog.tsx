"use client";

// ---------------------------------------------------------------------------
// Novara AI — the settings modal (Step 62, round 1).
//
// Four panes, four columns of truth:
//
//   Account        who is signed in (read-only) · sign out
//   General        the editor font size · the interface language
//   Credits & usage  the credit gauge + the (moved) usage panel
//   About          the build: version, deployed commit, the legal links
//
// Left nav on ≥ sm, a horizontal chip strip below it. The pane scrolls.
// Radix gives the focus trap, the Escape close, the backdrop close and the
// focus restore; the trigger (the user menu) puts the focus back when the
// dialog closes.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
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
import { UsagePanel } from "@/components/novara/writer/usage-panel";
import { cn } from "@/lib/utils";

export type SettingsPane = "account" | "general" | "credits" | "about";

const PANES: { id: SettingsPane; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "general", label: "General" },
  { id: "credits", label: "Credits & usage" },
  { id: "about", label: "About" },
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

  const email = getFirebaseAuth().currentUser?.email ?? null;

  const handleSignOut = async () => {
    await signOutUser();
    onOpenChange(false);
    onClosed?.();
    navigate("home");
  };

  const balance = credits?.balance ?? null;
  const allowance = credits?.allowance ?? 0;
  const usedToday = credits?.usedToday ?? 0;
  const resetLabel = credits?.resetAt
    ? new Date(credits.resetAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) onClosed?.();
      }}
    >
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-4 py-3 sm:px-6">
          <DialogTitle className="text-base">Settings</DialogTitle>
          <DialogDescription className="text-[11px]">
            Your account, the workspace and what this build is.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col overflow-hidden sm:flex-row">
          {/* Left nav — a column on ≥ sm, a scrolling chip strip below it. */}
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 sm:w-48 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3"
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

          {/* The pane */}
          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
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
                <Separator />
                <Row label="Delete account" hint="Not available in this build.">
                  <Button variant="outline" size="sm" disabled>
                    Delete account - coming soon
                  </Button>
                </Row>
              </>
            )}

            {pane === "general" && (
              <>
                <SectionTitle>General</SectionTitle>
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
                <Separator />
                <Row label="Interface language" hint="More languages are planned.">
                  <Button variant="outline" size="sm" disabled>
                    English
                  </Button>
                </Row>
              </>
            )}

            {pane === "credits" && (
              <>
                <SectionTitle>Credits &amp; usage</SectionTitle>
                <Separator className="mt-2" />
                <div className="py-3">
                  {error ? (
                    <p className="text-sm text-destructive">
                      The credit balance could not be loaded — nothing is shown
                      rather than a stale number.
                    </p>
                  ) : credits?.unlimited ? (
                    <p className="text-sm">
                      Unlimited - {usedToday} credits used today
                    </p>
                  ) : (
                    <>
                      <p className="text-sm">
                        {balance ?? "—"} / {allowance} credits today
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
                <Separator />
                <div className="py-3">
                  <UsagePanel />
                </div>
                <Separator />
                <p className="py-3 text-[11px] text-muted-foreground">
                  Usage details kept 90 days
                </p>
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
                <Row label="Build" hint="Preview build — features are still being built.">
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
