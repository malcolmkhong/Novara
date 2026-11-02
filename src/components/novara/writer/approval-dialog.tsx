"use client";

import { Info, Loader2, ShieldCheck } from "lucide-react";
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
import type { ApprovalRequest } from "@/lib/novara/agent-types";

export function ApprovalDialog({
  request,
  onApprove,
  onReject,
  busy = false,
}: {
  request: ApprovalRequest | null;
  onApprove: () => void;
  onReject: () => void;
  busy?: boolean;
}) {
  return (
    // The gate must be answered, not dismissed: open is derived from the
    // request and onOpenChange is a no-op, so Escape / overlay clicks are
    // ignored. The close X is hidden for the same reason.
    <Dialog open={request !== null} onOpenChange={() => {}}>
      {request && (
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-start gap-2">
              <ShieldCheck
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <span>{request.title}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Will write to
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-medium">{request.targetLabel}</span>
              {request.wordCount != null && (
                <Badge variant="outline" className="text-[11px] font-normal">
                  ~{request.wordCount} words
                </Badge>
              )}
            </div>
          </div>

          <DialogDescription>{request.summary}</DialogDescription>

          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Rejecting pauses the run — nothing has been written either way.</span>
          </div>

          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={onReject} disabled={busy}>
              Reject
            </Button>
            <Button onClick={onApprove} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
