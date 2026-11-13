"use client";

import { Pin, PinOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PinnedRef } from "@/lib/novara/agent-types";
import { canonStateLabel } from "@/lib/novara/doc-tree";
import type { CanonState } from "@/lib/novara/types";
import { useWriterStore } from "@/hooks/use-writer-store";
import { cn } from "@/lib/utils";

/**
 * Pin-to-Chat toggle (Phase 8) — pins/unpins one context ref for the novel.
 * Pinned refs appear as chips in the conversation composer and are resolved
 * server-side when the run starts (client content is never trusted).
 */
export function PinButton({
  novelId,
  target,
  className,
  label = "Pin to chat",
}: {
  novelId: string;
  target: PinnedRef;
  className?: string;
  label?: string;
}) {
  // Selector stays referentially stable (raw record only); the `?? []`
  // fallback happens outside the selector — zustand v5 getSnapshot must not
  // return a fresh array on every call (React Compiler loop guard).
  const pins = useWriterStore((s) => s.pinnedByNovel[novelId]);
  const pinned = (pins ?? []).some(
    (p) => p.type === target.type && p.id === target.id
  );
  const togglePin = useWriterStore((s) => s.togglePin);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-8 gap-1.5 px-2 text-xs",
        pinned ? "text-primary" : "text-muted-foreground",
        className
      )}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin — ${target.label}` : `${label} — ${target.label}`}
      title={pinned ? "Unpin from chat" : "Pin to chatbox — attach as context for the next run"}
      onClick={() => togglePin(novelId, target)}
    >
      {pinned ? (
        <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Pin className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATE_STYLES: Record<CanonState, string> = {
  draft: "bg-muted text-muted-foreground",
  final: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

/**
 * THE state chip (STEP 79) — one look for the whole canon vocabulary.
 *
 * The vocabulary is exactly two words, Draft and Final; the labels come from
 * the tree, which is the single source of truth (`canonStateLabel`). Every
 * canon state in the tree, in the document pane and in the chapter editor
 * renders through this component, so a Draft looks the same everywhere and a
 * Final always looks the same too.
 */
export function StateChip({
  status,
  className,
}: {
  status: CanonState;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[11px]", STATE_STYLES[status], className)}
    >
      {canonStateLabel(status)}
    </Badge>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}
