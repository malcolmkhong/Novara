"use client";

// ---------------------------------------------------------------------------
// Review tab (Phase 2, live) — AI structured review + sediment pipeline.
//
//   Run review      → POST /api/chapters/[id]/review (issue list, critical
//                     is blocking, server-forced)
//   Settle chapter  → POST /api/chapters/[id]/sediment — only offered when
//                     blocking = 0. Writes digest / story facts / character
//                     states / foreshadow ledger (single-writer memory layer).
//
// The review result is not persisted; the settle gate is UI-enforced here
// and becomes a code-enforced step of the agent loop in Phase 3.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  CircleDashed,
  CircleDotDashed,
  Loader2,
  Play,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REVIEW_SEVERITY_META } from "@/config/writer";
import {
  reviewChapter,
  sedimentChapter,
  type ForeshadowRow,
  type SedimentResponse,
} from "@/lib/novara/api";
import type { ChapterReview } from "@/lib/novara/agent-types";
import type { ChapterDTO } from "@/lib/novara/types";
import { cn } from "@/lib/utils";

function chapterLabel(chapter: ChapterDTO): string {
  return `${String(chapter.index).padStart(2, "0")} — ${chapter.title}`;
}

const FORESHADOW_META: Record<
  string,
  { icon: typeof CircleDashed; className: string; label: string }
> = {
  open: {
    icon: CircleDashed,
    className: "text-sky-700 bg-sky-50 border-sky-200",
    label: "open",
  },
  advanced: {
    icon: CircleDotDashed,
    className: "text-amber-700 bg-amber-50 border-amber-200",
    label: "advanced",
  },
  paid: {
    icon: CheckCircle2,
    className: "text-emerald-700 bg-emerald-50 border-emerald-200",
    label: "paid",
  },
};

export function ReviewPanel({ chapters }: { chapters: ChapterDTO[] }) {
  const [chapterId, setChapterId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [settling, setSettling] = useState(false);
  const [review, setReview] = useState<ChapterReview | null>(null);
  const [settle, setSettle] = useState<SedimentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedChapter = chapters.find((c) => c.id === chapterId) ?? null;
  const reviewedChapter = review
    ? chapters.find((c) => c.id === review.chapterId) ?? null
    : null;
  const blockingCount = review
    ? review.issues.filter((issue) => issue.blocking).length
    : 0;
  // The settle gate: blocking = 0 AND the chapter actually has text.
  const canSettle =
    review !== null && blockingCount === 0 && (reviewedChapter?.wordCount ?? 0) > 0;
  const settleBelongsToSelection = settle?.chapterId === chapterId;

  const handleChapterChange = (nextId: string) => {
    setRunning(false);
    setSettling(false);
    setReview(null);
    setSettle(null);
    setError(null);
    setChapterId(nextId);
  };

  const handleRunReview = async () => {
    if (!selectedChapter || running || settling) return;
    setRunning(true);
    setError(null);
    setReview(null);
    setSettle(null);
    try {
      const result = await reviewChapter(selectedChapter.id);
      setReview(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  const handleSettle = async () => {
    if (!selectedChapter || settling || !canSettle) return;
    setSettling(true);
    setError(null);
    try {
      const result = await sedimentChapter(selectedChapter.id);
      setSettle(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSettling(false);
    }
  };

  return (
    <div className="space-y-4">
      {chapters.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Add a chapter first — review runs on a chapter’s draft.
        </div>
      ) : (
        <>
          {/* Controls */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={chapterId} onValueChange={handleChapterChange}>
              <SelectTrigger
                aria-label="Choose a chapter to review"
                className="w-full sm:w-[280px]"
              >
                <SelectValue placeholder="Choose a chapter" />
              </SelectTrigger>
              <SelectContent>
                {chapters.map((chapter) => (
                  <SelectItem key={chapter.id} value={chapter.id}>
                    {chapterLabel(chapter)}
                    {chapter.wordCount === 0 ? " (empty)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleRunReview}
              disabled={running || settling || !selectedChapter}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ScanSearch className="h-4 w-4" aria-hidden="true" />
              )}
              {running ? "Reviewing…" : "Run AI review"}
            </Button>
          </div>

          {selectedChapter && selectedChapter.wordCount === 0 && (
            <p className="text-xs text-muted-foreground">
              Chapter “{selectedChapter.title}” is empty — draft or write
              something first.
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {error}
            </div>
          )}

          {/* Review results */}
          {review && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-base">
                  Review issues
                </CardTitle>
                <CardDescription>
                  {reviewedChapter
                    ? chapterLabel(reviewedChapter)
                    : review.chapterId}{" "}
                  · AI review ·{" "}
                  {review.issues.length === 0
                    ? "no issues found"
                    : `${review.issues.length} issue${review.issues.length === 1 ? "" : "s"}`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {review.issues.length > 0 && (
                  <ul className="space-y-2">
                    {review.issues.map((issue) => {
                      const meta = REVIEW_SEVERITY_META[issue.severity];
                      return (
                        <li
                          key={issue.id}
                          className={cn(
                            "border-l-2 py-1 pl-3",
                            issue.blocking
                              ? "border-rose-500"
                              : "border-transparent"
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={meta.badgeClass}
                            >
                              {meta.label}
                            </Badge>
                            {issue.blocking && (
                              <Badge
                                variant="outline"
                                className="border-rose-300 bg-rose-100 text-rose-800"
                              >
                                Blocking
                              </Badge>
                            )}
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">
                              {issue.category}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              · {issue.location}
                            </span>
                          </div>
                          <p className="mt-1.5 text-sm italic text-foreground/80">
                            “{issue.evidence}”
                          </p>
                          {issue.fixHint && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Fix hint: {issue.fixHint}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Blocking-driven settle gate */}
                {blockingCount === 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      <CheckCircle2
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>blocking: 0 — this chapter can be settled</span>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleSettle}
                      disabled={settling || !canSettle}
                    >
                      {settling ? (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                      )}
                      {settling ? "Settling…" : "Settle into memory"}
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                      Settling extracts the chapter summary, story facts,
                      character states and foreshadow ledger updates — the AI
                      team’s memory of what happened in this chapter.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    <AlertTriangle
                      className="h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      blocking: {blockingCount} — settle is blocked until the
                      critical issues are resolved
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Sediment result + foreshadow ledger */}
          {settle && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-base">
                  <BookOpenCheck
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  Memory settled
                </CardTitle>
                <CardDescription>
                  {reviewedChapter
                    ? chapterLabel(reviewedChapter)
                    : settle.chapterId}{" "}
                  · {new Date(settle.sedimentedAt).toTimeString().slice(0, 8)}
                  {settleBelongsToSelection
                    ? ""
                    : " · from an earlier selection"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {settle.result.factsCreated} facts recorded
                  </Badge>
                  {settle.result.factsTouched > 0 && (
                    <Badge variant="outline">
                      {settle.result.factsTouched} facts reinforced
                    </Badge>
                  )}
                  <Badge variant="outline">
                    {settle.result.characterStates} character states
                  </Badge>
                  <Badge variant="outline">
                    {settle.result.plantsCreated} foreshadows planted
                  </Badge>
                  {settle.result.advanced > 0 && (
                    <Badge variant="outline">
                      {settle.result.advanced} advanced
                    </Badge>
                  )}
                  {settle.result.paid > 0 && (
                    <Badge variant="outline">{settle.result.paid} paid off</Badge>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Chapter digest
                  </p>
                  <p className="mt-1 text-sm">{settle.result.digestSummary}</p>
                </div>

                {settle.ledger.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Foreshadow ledger
                    </p>
                    <ul className="mt-1 space-y-1.5">
                      {settle.ledger.map((f: ForeshadowRow) => {
                        const meta =
                          FORESHADOW_META[f.status] ?? FORESHADOW_META.open;
                        const Icon = meta.icon;
                        return (
                          <li
                            key={f.id}
                            className="flex items-start gap-2 text-sm"
                          >
                            <Badge
                              variant="outline"
                              className={cn("mt-0.5 shrink-0", meta.className)}
                            >
                              <Icon
                                className="mr-1 h-3 w-3"
                                aria-hidden="true"
                              />
                              {meta.label}
                            </Badge>
                            <span className="min-w-0">
                              {f.content}
                              <span className="ml-1 text-xs text-muted-foreground">
                                (planted ch. {f.plantChapter}
                                {f.payByChapter ? `, pay by ch. ${f.payByChapter}` : ""}
                                {f.lastChapter ? `, last ch. ${f.lastChapter}` : ""})
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
