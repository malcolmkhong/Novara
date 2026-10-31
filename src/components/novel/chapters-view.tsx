"use client";

import * as React from "react";
import {
  AlertTriangle,
  BookText,
  Brain,
  Loader2,
  PenLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { postJSON, streamChapterWrite } from "./api";
import type {
  ChapterReview,
  ChapterView,
  NovelDetail,
  VolumeView,
} from "@/lib/novel/types";

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function statusBadge(status: ChapterView["status"]) {
  if (status === "final") {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        Final
      </Badge>
    );
  }
  if (status === "drafted") {
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
        Drafted
      </Badge>
    );
  }
  return <Badge variant="secondary">Outlined</Badge>;
}

function scoreBadgeClass(score: number): string {
  if (score >= 80)
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  if (score >= 60)
    return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
}

function reviewScoreClass(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function ReviewCard({ review }: { review: ChapterReview }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
          Review
          <Badge className={scoreBadgeClass(review.overallScore)}>
            {review.overallScore}/100
          </Badge>
        </CardTitle>
        <CardDescription>
          Structured review — blocking issues must be fixed before publishing.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {review.dimensions.length > 0 && (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {review.dimensions.map((d) => (
              <div key={d.name}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{d.name}</span>
                  <span className={cn("text-xs font-semibold", reviewScoreClass(d.score))}>
                    {d.score}
                  </span>
                </div>
                <Progress
                  value={d.score}
                  className="h-1.5"
                  aria-label={`${d.name} score ${d.score} of 100`}
                />
                {d.comment && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {d.comment}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {review.blocking.length > 0 && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>
              {review.blocking.length} blocking issue
              {review.blocking.length > 1 ? "s" : ""}
            </AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {review.blocking.map((b, i) => (
                  <li key={i}>
                    {b.issue}
                    {b.fix && (
                      <span className="text-muted-foreground"> → {b.fix}</span>
                    )}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {review.consistencyFlags.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              Consistency flags
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
              {review.consistencyFlags.map((flag, i) => (
                <li key={i}>{flag}</li>
              ))}
            </ul>
          </div>
        )}

        {review.suggestions.length > 0 && (
          <div>
            <p className="font-medium">Suggestions</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
              {review.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Chapters view                                                       */
/* ------------------------------------------------------------------ */

interface ChaptersViewProps {
  novel: NovelDetail;
  onDataChanged: () => void;
}

export function ChaptersView({ novel, onDataChanged }: ChaptersViewProps) {
  const { toast } = useToast();

  const [volumeId, setVolumeId] = React.useState<string | null>(null);
  const [chapterNumber, setChapterNumber] = React.useState<number | null>(null);
  const [streamText, setStreamText] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"write" | "sediment" | "review" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ledgerNotes, setLedgerNotes] = React.useState<string[]>([]);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  // Effective selection (falls back when the current one disappears).
  const volume: VolumeView | null =
    novel.volumes.find((v) => v.id === volumeId) ?? novel.volumes[0] ?? null;
  const volumeChapters = React.useMemo(
    () => novel.chapters.filter((ch) => volume && ch.volumeId === volume.id),
    [novel.chapters, volume],
  );
  const chapter: ChapterView | null =
    volumeChapters.find((ch) => ch.number === chapterNumber) ??
    volumeChapters.find((ch) => ch.status !== "final") ??
    volumeChapters[0] ??
    null;

  const isStreaming = busy === "write";
  const displayedContent = streamText ?? chapter?.content ?? null;

  // Keep the streaming pane pinned to the bottom.
  React.useEffect(() => {
    if (isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [streamText, isStreaming]);

  const writeChapter = async () => {
    if (!chapter) return;
    setBusy("write");
    setError(null);
    setStreamText("");
    try {
      const result = await streamChapterWrite(
        `/api/novel/${novel.id}/write`,
        { chapterNumber: chapter.number },
        (text) => setStreamText((prev) => (prev ?? "") + text),
      );
      if (result.ok) {
        toast({
          title: `Chapter ${chapter.number} drafted`,
          description: `${result.wordCount} chars saved (revision ${result.revision}). Now sediment the memory.`,
        });
      } else if (result.saved) {
        toast({
          title: "Partial draft saved",
          description: result.message,
          variant: "destructive",
        });
      } else {
        setError(result.message ?? "Generation failed.");
      }
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setStreamText(null);
      setBusy(null);
    }
  };

  const sedimentChapter = async () => {
    if (!chapter) return;
    setBusy("sediment");
    setError(null);
    try {
      const result = await postJSON<{
        success: boolean;
        ledgerNotes: string[];
      }>(`/api/novel/${novel.id}/sediment`, {
        chapterNumber: chapter.number,
      });
      setLedgerNotes(result.ledgerNotes);
      toast({
        title: `Memory sedimented for chapter ${chapter.number}`,
        description:
          result.ledgerNotes.length > 0
            ? result.ledgerNotes.join(" · ")
            : "Summary, facts and character states stored.",
      });
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sediment failed.");
    } finally {
      setBusy(null);
    }
  };

  const reviewChapter = async () => {
    if (!chapter) return;
    setBusy("review");
    setError(null);
    try {
      await postJSON(`/api/novel/${novel.id}/review`, {
        chapterNumber: chapter.number,
      });
      toast({ title: `Review complete for chapter ${chapter.number}` });
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed.");
    } finally {
      setBusy(null);
    }
  };

  if (novel.volumes.length === 0) {
    return (
      <p className="rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">
        This book has no volumes yet — recreate it from the bookshelf.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <Tabs
        value={volume?.id ?? undefined}
        onValueChange={(next) => {
          setVolumeId(next);
          setChapterNumber(null);
          setLedgerNotes([]);
          setError(null);
        }}
      >
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-fit">
          {novel.volumes.map((v) => (
            <TabsTrigger key={v.id} value={v.id} className="gap-1.5 px-3">
              卷{v.index}
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Ch {v.startChapter}–{v.endChapter}
              </span>
              {!v.planned && <span className="size-1.5 rounded-full bg-amber-500" aria-label="not planned" />}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex min-w-0 flex-col gap-4 lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Chapter list */}
        <Card className="min-w-0 self-start">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Chapters{volume ? ` · ${volume.name}` : ""}
            </CardTitle>
            {volume && !volume.planned && (
              <CardDescription>
                Not planned yet — outline it in the Master Outline tab.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {volumeChapters.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => {
                    setChapterNumber(ch.number);
                    setError(null);
                    setLedgerNotes([]);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    chapter?.number === ch.number
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                      : "hover:bg-muted",
                  )}
                  aria-current={chapter?.number === ch.number ? "true" : undefined}
                >
                  <span className="w-8 shrink-0 text-xs text-muted-foreground">
                    {String(ch.number).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{ch.title}</span>
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      ch.status === "final" && "bg-emerald-500",
                      ch.status === "drafted" && "bg-amber-500",
                      ch.status === "outlined" && "bg-zinc-300 dark:bg-zinc-600",
                    )}
                    aria-hidden="true"
                  />
                </button>
              ))}
              {volumeChapters.length === 0 && (
                <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                  No chapter outlines in this volume yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Editor */}
        <div className="flex min-w-0 flex-col gap-4">
          {chapter ? (
            <>
              {/* Outline */}
              <Card className="min-w-0">
                <CardHeader className="min-w-0 pb-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
                      <BookText className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
                      <span className="break-words">
                        第{chapter.number}章 · {chapter.title}
                      </span>
                      {statusBadge(chapter.status)}
                      {chapter.revision > 0 && (
                        <Badge variant="outline" className="text-xs">
                          rev {chapter.revision}
                        </Badge>
                      )}
                    </CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={writeChapter}
                        disabled={busy !== null}
                        className="gap-1.5"
                      >
                        {isStreaming ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <PenLine className="size-3.5" aria-hidden="true" />
                        )}
                        {isStreaming
                          ? "Writing…"
                          : chapter.content
                            ? "Rewrite chapter"
                            : "Write chapter"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={sedimentChapter}
                        disabled={busy !== null || !chapter.content}
                        className="gap-1.5"
                      >
                        {busy === "sediment" ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Brain className="size-3.5" aria-hidden="true" />
                        )}
                        Sediment memory
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={reviewChapter}
                        disabled={busy !== null || !chapter.content}
                        className="gap-1.5"
                      >
                        {busy === "review" ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <ShieldCheck className="size-3.5" aria-hidden="true" />
                        )}
                        Review
                      </Button>
                    </div>
                  </div>
                  <CardDescription>
                    {chapter.wordCount > 0 && <>{chapter.wordCount} chars · </>}
                    {chapter.timeAnchor && <>time anchor: {chapter.timeAnchor}</>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  {chapter.goal && (
                    <p className="leading-relaxed">
                      <span className="font-medium">本章目标: </span>
                      {chapter.goal}
                    </p>
                  )}
                  {chapter.mustCover.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {chapter.mustCover.map((node, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className="max-w-full whitespace-normal text-left text-xs"
                        >
                          {node}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {chapter.endHook && (
                    <p className="leading-relaxed">
                      <span className="font-medium">章末钩子: </span>
                      {chapter.endHook}
                    </p>
                  )}
                </CardContent>
              </Card>

              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>Chapter action failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Prose */}
              <Card>
                <CardHeader className="min-w-0 pb-2">
                  <CardTitle className="flex min-w-0 items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      正文 · Prose
                      {isStreaming && (
                        <span className="flex shrink-0 items-center gap-1.5 text-xs font-normal text-amber-600">
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                          streaming live…
                        </span>
                      )}
                    </span>
                    {displayedContent && (
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">
                        {displayedContent.replace(/\s/g, "").length} chars
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    ref={contentRef}
                    className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/20 p-4 text-sm leading-7 [scrollbar-width:thin]"
                    aria-live="polite"
                    aria-busy={isStreaming}
                  >
                    {displayedContent ?? (
                      <span className="text-muted-foreground">
                        No prose yet. Hit “Write chapter” — GLM drafts it live
                        from the outline, previous summaries and open
                        foreshadowing.
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Memory */}
              {(chapter.summary || chapter.facts.length > 0 || chapter.charStates.length > 0) && (
                <Card>
                  <CardHeader className="min-w-0 pb-3">
                    <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
                      <Brain className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      沉淀记忆 · Sedimented memory
                    </CardTitle>
                    <CardDescription>
                      What the pipeline will remember when writing chapter{" "}
                      {chapter.number + 1}.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    {chapter.summary && (
                      <p className="leading-relaxed">{chapter.summary}</p>
                    )}
                    {chapter.facts.length > 0 && (
                      <div>
                        <p className="font-medium">Facts</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                          {chapter.facts.map((fact, i) => (
                            <li key={i}>{fact}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {chapter.charStates.length > 0 && (
                      <div>
                        <p className="font-medium">Character states</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                          {chapter.charStates.map((c, i) => (
                            <li key={i}>
                              {c.name}: {c.change}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {ledgerNotes.length > 0 && (
                      <>
                        <Separator />
                        <p className="text-xs text-muted-foreground">
                          Ledger: {ledgerNotes.join(" · ")}
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Review */}
              {chapter.review && <ReviewCard review={chapter.review} />}
            </>
          ) : (
            <Card>
              <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                <Sparkles className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
                Plan this volume in the Master Outline tab to generate chapter
                outlines, then write chapters here.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
