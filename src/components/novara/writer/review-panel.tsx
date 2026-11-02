"use client";

// ---------------------------------------------------------------------------
// Review tab (Phase 2 preview) — quality-control contract, honest placeholder.
//
// Nothing here is persisted: "Run review" builds a ChapterReview from a
// deterministic pseudo-random generator seeded by the chapter id, so the SAME
// chapter always yields the SAME issues (no Math.random). The blocking gate
// strip mirrors the planned settle gate: any critical issue blocks settling.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Play,
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
import type {
  ChapterReview,
  ReviewIssue,
  ReviewSeverity,
} from "@/lib/novara/agent-types";
import type { ChapterDTO } from "@/lib/novara/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Deterministic mock engine
// ---------------------------------------------------------------------------

const CATEGORIES: readonly string[] = [
  "continuity",
  "pacing",
  "dialogue",
  "voice",
  "world_logic",
];

const SEVERITIES: readonly ReviewSeverity[] = [
  "critical",
  "major",
  "minor",
  "suggestion",
];

const LOCATIONS: readonly string[] = [
  "Opening paragraph",
  "Midpoint scene",
  "Dialogue block",
  "Chapter ending",
  "Transition",
];

const EVIDENCE: readonly string[] = [
  "the chime rang twice before anyone entered",
  "she counted the years out loud, twice",
  "the register accepted the payment without a sound",
  "no one mentioned the missing night",
  "the favor was promised, then never called in",
];

const FIX_HINTS: readonly string[] = [
  "Restate the rule once, in the character's own words.",
  "Add a one-line beat showing what the trade costs.",
  "Anchor the scene to a clock, a chime or a shift change.",
  "Give the speaker a distinct rhythm or verbal tic.",
];

/** Simple stable hash: sum of char codes (per spec — deterministic per id). */
function seedFromId(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return sum;
}

function buildMockReview(chapter: ChapterDTO): ChapterReview {
  const seed = seedFromId(chapter.id);
  const count = 2 + (seed % 3); // 2-4 issues, stable per chapter
  const issues: ReviewIssue[] = Array.from({ length: count }, (_, index) => {
    const severity = SEVERITIES[(seed + index) % SEVERITIES.length];
    return {
      id: `mock-${chapter.id}-${index}`,
      category: CATEGORIES[(seed + index) % CATEGORIES.length],
      severity,
      blocking: severity === "critical",
      location: LOCATIONS[index % LOCATIONS.length],
      evidence: EVIDENCE[(seed + index) % EVIDENCE.length],
      fixHint: index % 3 === 2 ? null : FIX_HINTS[(seed + index) % FIX_HINTS.length],
    };
  });
  return {
    chapterId: chapter.id,
    issues,
    reviewedAt: new Date().toISOString(),
    mock: true,
  };
}

function chapterLabel(chapter: ChapterDTO): string {
  return `${String(chapter.index).padStart(2, "0")} — ${chapter.title}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReviewPanel({ chapters }: { chapters: ChapterDTO[] }) {
  const [chapterId, setChapterId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [review, setReview] = useState<ChapterReview | null>(null);
  const timerRef = useRef<number | null>(null);

  // Clear any in-flight mock run on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const selectedChapter = chapters.find((c) => c.id === chapterId) ?? null;
  const reviewedChapter = review
    ? chapters.find((c) => c.id === review.chapterId) ?? null
    : null;
  const blockingCount = review
    ? review.issues.filter((issue) => issue.blocking).length
    : 0;

  const handleChapterChange = (nextId: string) => {
    // A stale run must never attach to a different chapter.
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setRunning(false);
    setReview(null);
    setChapterId(nextId);
  };

  const handleRunReview = () => {
    if (!selectedChapter || running) return;
    const chapter = selectedChapter;
    setRunning(true);
    timerRef.current = window.setTimeout(() => {
      setReview(buildMockReview(chapter));
      setRunning(false);
      timerRef.current = null;
    }, 1100);
  };

  return (
    <div className="space-y-4">
      {/* Phase honesty banner */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Review is a Phase 2 feature. The issue schema below is the designed
          contract — the Run review button produces deterministic mock issues so
          you can exercise the blocking gate. Nothing is saved.
        </p>
      </div>

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
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleRunReview} disabled={running || !selectedChapter}>
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4" aria-hidden="true" />
              )}
              {running ? "Reviewing…" : "Run review"}
            </Button>
          </div>

          {/* Results */}
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
                  · mock run, nothing saved
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2">
                  {review.issues.map((issue) => {
                    const meta = REVIEW_SEVERITY_META[issue.severity];
                    return (
                      <li
                        key={issue.id}
                        className={cn(
                          "border-l-2 py-1 pl-3",
                          issue.blocking ? "border-rose-500" : "border-transparent"
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={meta.badgeClass}>
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

                {/* Blocking-driven settle gate */}
                {blockingCount === 0 ? (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>blocking: 0 — chapter can be settled</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      blocking: {blockingCount} — settle is blocked until
                      resolved
                    </span>
                  </div>
                )}

                <p className="text-[11px] text-muted-foreground">
                  Reviewed (mock) at{" "}
                  {new Date(review.reviewedAt).toTimeString().slice(0, 8)}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
