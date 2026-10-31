"use client";

import * as React from "react";
import {
  ArrowLeft,
  Bookmark,
  BookText,
  ListTree,
  Loader2,
  ScrollText,
  Trash2,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

import { deleteJSON, getJSON } from "./api";
import { BibleView } from "./bible-view";
import { ChaptersView } from "./chapters-view";
import { ForeshadowViewPanel } from "./foreshadow-view";
import { OutlineView } from "./outline-view";
import type { NovelDetail } from "@/lib/novel/types";

interface StudioProps {
  novelId: string;
  onBack: () => void;
  onDeleted: () => void;
}

/**
 * Book studio: header with progress + delete, and the four pipeline tabs —
 * 设定集 (bible) · 总纲 (outline) · 章节 (chapters) · 伏笔 (ledger).
 */
export function Studio({ novelId, onBack, onDeleted }: StudioProps) {
  const { toast } = useToast();
  const [novel, setNovel] = React.useState<NovelDetail | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const result = await getJSON<{ novel: NovelDetail }>(
        `/api/novel/${novelId}`,
      );
      setNovel(result.novel);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load the novel.",
      );
    }
  }, [novelId]);

  React.useEffect(() => {
    setNovel(null);
    void refresh();
  }, [refresh]);

  const deleteBook = async () => {
    setDeleting(true);
    try {
      await deleteJSON(`/api/novel/${novelId}`);
      toast({ title: "Novel deleted" });
      onDeleted();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setDeleting(false);
    }
  };

  if (loadError) {
    return (
      <div className="grid gap-3">
        <Button variant="outline" onClick={onBack} className="w-fit gap-2">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to bookshelf
        </Button>
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {loadError}
        </p>
      </div>
    );
  }

  if (!novel) {
    return (
      <div className="flex items-center justify-center gap-3 rounded-lg border bg-muted/30 p-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading studio…
      </div>
    );
  }

  const written = novel.chapters.filter(
    (ch) => ch.status === "drafted" || ch.status === "final",
  ).length;
  const outlined = novel.chapters.filter((ch) => ch.status === "outlined").length;
  const openLoops = novel.foreshadows.filter((f) => f.status !== "paid").length;
  const progress = Math.min(100, Math.round((written / novel.targetChapters) * 100));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Header */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={onBack}
              aria-label="Back to bookshelf"
              className="mt-0.5 shrink-0"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Button>
            <div className="min-w-0">
              <h2 className="break-words text-xl font-bold tracking-tight sm:text-2xl">
                {novel.title}
              </h2>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline" className="shrink-0 text-xs">
                  {novel.genre}
                </Badge>
                <span className="break-words">{novel.logline}</span>
              </div>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{novel.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the story bible, outlines,
                  {novel.chapters.length} chapter record(s), all prose and the
                  foreshadowing ledger. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void deleteBook();
                  }}
                  disabled={deleting}
                  className="bg-red-600 text-white hover:bg-red-700"
                >
                  {deleting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    "Delete novel"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Progress strip */}
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/30 p-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {written}/{novel.targetChapters} chapters written
              {outlined > 0 && ` · ${outlined} outlined, unwritten`}
            </span>
            <span>
              {openLoops} open foreshadowing loop{openLoops === 1 ? "" : "s"}
            </span>
          </div>
          <Progress value={progress} className="h-2" aria-label="Writing progress" />
        </div>
      </div>

      {/* Pipeline tabs */}
      <Tabs defaultValue="chapters">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-fit">
          <TabsTrigger value="chapters" className="h-11 gap-2 px-3 sm:h-9">
            <BookText aria-hidden="true" />
            Chapters
          </TabsTrigger>
          <TabsTrigger value="bible" className="h-11 gap-2 px-3 sm:h-9">
            <ScrollText aria-hidden="true" />
            Story Bible
          </TabsTrigger>
          <TabsTrigger value="outline" className="h-11 gap-2 px-3 sm:h-9">
            <ListTree aria-hidden="true" />
            Outline
          </TabsTrigger>
          <TabsTrigger value="foreshadow" className="h-11 gap-2 px-3 sm:h-9">
            <Bookmark aria-hidden="true" />
            Foreshadowing
            {openLoops > 0 && (
              <Badge variant="outline" className="px-1.5 text-[10px]">
                {openLoops}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chapters" className="mt-4">
          <ChaptersView novel={novel} onDataChanged={refresh} />
        </TabsContent>
        <TabsContent value="bible" className="mt-4">
          <BibleView novel={novel} />
        </TabsContent>
        <TabsContent value="outline" className="mt-4">
          <OutlineView novel={novel} onDataChanged={refresh} />
        </TabsContent>
        <TabsContent value="foreshadow" className="mt-4">
          <ForeshadowViewPanel novel={novel} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
