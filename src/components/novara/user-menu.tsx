"use client";

// ---------------------------------------------------------------------------
// Novara AI — the user menu (Step 62, final shape in Step 64).
//
// A bottom-left popover: the avatar trigger, an identity header row and the
// account rows. It is mounted twice — at the bottom of the workbench's asset
// rail and at the bottom-left of the dashboard (which has no rail).
//
// The balance label comes from useCredits() (GET /api/usage/credits): "53 / 60"
// for a normal account, "Unlimited" for an admin, "—" while it loads or if it
// failed (the settings pane surfaces the real error).
//
// Step 64: the disabled "Admin console - coming soon" row is GONE — if a
// control does not work, it is not on screen.
// ---------------------------------------------------------------------------

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { HelpCircle, LogOut, Settings, Wallet } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { getFirebaseAuth, signOutUser } from "@/lib/firebase/client";
import { useCredits } from "@/hooks/use-credits";
import { useHashRoute } from "@/hooks/use-hash-route";
import { SettingsDialog, type SettingsPane } from "./settings-dialog";
import { cn } from "@/lib/utils";

interface MenuRowProps {
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

function MenuRow({ icon, label, right, disabled, onClick }: MenuRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none transition-colors",
        disabled
          ? "pointer-events-none opacity-50"
          : "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
      )}
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {right ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">{right}</span>
      ) : null}
    </button>
  );
}

/**
 * STEP 65 — the imperative handle other surfaces use to open the settings
 * dialog. The workbench rail's gear button calls this, so the gear and the
 * "Settings" menu row run the SAME action on the SAME dialog instance.
 */
export interface UserMenuHandle {
  openSettings: (pane?: SettingsPane) => void;
}

export const UserMenu = forwardRef<UserMenuHandle, { className?: string }>(
  function UserMenu({ className }, ref) {
  const { navigate } = useHashRoute();
  const { credits } = useCredits();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pane, setPane] = useState<SettingsPane>("account");
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // The author of the workbench rail (Step 62) keeps the user menu at the
  // bottom-left, upward popover. The rail's gear button (Step 65) reaches the
  // same dialog through this handle — one dialog instance, one action.
  useImperativeHandle(
    ref,
    () => ({
      openSettings: (target: SettingsPane = "account") => {
        setPane(target);
        setSettingsOpen(true);
        setOpen(false);
      },
    }),
    []
  );

  // The writer only renders after the Firebase auth resolved, so the user is
  // available synchronously here (no state, no effect).
  const user = getFirebaseAuth().currentUser;
  const identity = {
    name: user?.displayName ?? null,
    email: user?.email ?? null,
    photo: user?.photoURL ?? null,
  };

  const balanceLabel = !credits
    ? "—"
    : credits.unlimited
      ? "Unlimited"
      : `${credits.balance} / ${credits.allowance}`;

  const openSettings = (target: SettingsPane) => {
    setPane(target);
    setSettingsOpen(true);
    setOpen(false);
  };

  const handleSignOut = async () => {
    setOpen(false);
    await signOutUser();
    navigate("home");
  };

  const initial = (identity.name ?? identity.email ?? "?").trim().charAt(0).toUpperCase();
  const title = identity.name ?? identity.email ?? "Signed in";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label="Account menu"
            title="Account menu"
            className={cn(
              "inline-flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <Avatar className="size-8">
              {identity.photo ? <AvatarImage src={identity.photo} alt="" /> : null}
              <AvatarFallback className="text-xs">{initial}</AvatarFallback>
            </Avatar>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-72 max-h-[calc(100vh-6rem)] overflow-y-auto p-1"
        >
          <div className="flex items-center gap-2 px-2 py-2">
            <Avatar className="size-8">
              {identity.photo ? <AvatarImage src={identity.photo} alt="" /> : null}
              <AvatarFallback className="text-xs">{initial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{title}</p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[11px]">
              Preview
            </Badge>
          </div>
          <Separator className="my-1" />
          <MenuRow
            icon={<Settings className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Settings"
            onClick={() => openSettings("account")}
          />
          <MenuRow
            icon={<Wallet className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Credits & usage"
            right={balanceLabel}
            onClick={() => openSettings("credits")}
          />
          <MenuRow
            icon={<HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Help"
            onClick={() => {
              setOpen(false);
              navigate("about");
            }}
          />
          <Separator className="my-1" />
          <MenuRow
            icon={<LogOut className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Sign out"
            onClick={() => void handleSignOut()}
          />
        </PopoverContent>
      </Popover>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        pane={pane}
        onPaneChange={setPane}
        onClosed={() => {
          // The dialog is portaled and Radix's own focus restore points at the
          // (now unmounted) menu row — so we hand the focus back ourselves,
          // after the dialog has finished closing.
          const restore = () => triggerRef.current?.focus();
          window.setTimeout(restore, 0);
          window.requestAnimationFrame(restore);
          window.setTimeout(restore, 120);
        }}
      />
    </>
  );
  }
);
