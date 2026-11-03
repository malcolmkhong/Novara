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
import type { ChapterStatus } from "@/lib/novara/types";
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
  // Selector must return a stable reference (stored array or undefined) —
  // allocating a fresh [] inside the selector trips React's snapshot cache
  // check (zustand v5).
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

const STATUS_STYLES: Record<ChapterStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  revised: "bg-amber-100 text-amber-800 border-amber-200",
  final: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const STATUS_LABELS: Record<ChapterStatus, string> = {
  draft: "Draft",
  revised: "Revised",
  final: "Final",
};

export function ChapterStatusBadge({ status }: { status: ChapterStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[11px]", STATUS_STYLES[status])}
    >
      {STATUS_LABELS[status]}
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
