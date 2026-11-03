"use client";

// ---------------------------------------------------------------------------
// Novara AI — Canon tab (Phase 8 定稿区).
//
// Read-only view of finalized chapters. Once a chapter is final it is locked:
// edits require reopening, which demotes the chapter back to revised. The
// "Open in editor" action routes to the Draft tab where the reopen gate runs.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { BookOpenText, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ChapterDTO } from "@/lib/novara/types";
import { ChapterStatusBadge, PinButton } from "./ui-bits";
import { cn } from "@/lib/utils";

/** `0001-The Notice` style chapter label used across the canon view. */
function zeroPad4(index: number): string {
  return String(index).padStart(4, "0");
}

export function CanonPanel({
  chapters,
  selectedChapterId,
  onSelectChapter,
  onOpenChapterInEditor,
}: {
  chapters: ChapterDTO[];
  selectedChapterId: string | null;
  onSelectChapter: (id: string) => void;
  onOpenChapterInEditor: (id: string) => void;
}) {
  const finals = useMemo(
    () =>
      chapters
        .filter((c) => c.status === "final")
        .sort((a, b) => a.index - b.index),
    [chapters]
  );

  // The shared chapter selection drives which canon document is shown; when
  // the selection is not a final chapter, fall back to the first one.
  const active =
    finals.find((c) => c.id === selectedChapterId) ?? finals[0] ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="font-display text-sm font-semibold">Canon · 定稿区</h3>
        <Badge variant="outline" className="text-[11px] text-muted-foreground">
          {finals.length} finalized
        </Badge>
      </div>

      {finals.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm font-medium">定稿区</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No finalized chapters yet. Review a chapter to 0 blocking issues,
            then finalize it.
          </p>
        </div>
      ) : (
        <>
          {/* Chapter chips — wrap to fit the ~400px pane */}
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Finalized chapters"
          >
            {finals.map((c) => {
              const isActive = active?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectChapter(c.id)}
                  aria-pressed={isActive}
                  title={c.title}
                  className={cn(
                    "min-h-[36px] max-w-full truncate rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {zeroPad4(c.index)}-{c.title}
                </button>
              );
            })}
          </div>

          {active && (
            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="min-w-0 font-display text-base">
                    {zeroPad4(active.index)}-{active.title}
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className="shrink-0 gap-1 text-[11px] text-muted-foreground"
                  >
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    Locked
                  </Badge>
                  <ChapterStatusBadge status={active.status} />
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[11px] text-muted-foreground"
                  >
                    {active.wordCount.toLocaleString()} words
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="py-4">
                <div
                  className="nice-scroll max-h-[480px] overflow-y-auto whitespace-pre-wrap font-mono text-[13px] leading-6"
                  aria-label={`Final text of chapter ${active.index}`}
                >
                  {active.content}
                </div>
              </CardContent>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
                <p className="text-[11px] text-muted-foreground">
                  Canon is locked — edits require reopening (demotes to revised).
                </p>
                <div className="flex items-center gap-1">
                  <PinButton
                    novelId={active.novelId}
                    target={{
                      type: "chapter",
                      id: active.id,
                      label: `第${active.index}章 ${active.title}`,
                    }}
                    label="Pin to chat"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => onOpenChapterInEditor(active.id)}
                  >
                    <BookOpenText className="h-4 w-4" aria-hidden="true" />
                    Open in editor
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
