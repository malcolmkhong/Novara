"use client";

import * as React from "react";
import { BookOpen, Feather, Library, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { CreateDialog } from "./create-dialog";
import { Studio } from "./studio";
import { getJSON } from "./api";
import type { NovelListItem } from "@/lib/novel/types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Novel Creator root: bookshelf ⇄ studio. The pipeline mirrors
 * webnovel-writer: init (设定集+总纲) → plan (节拍表+章纲) → write (流式正文)
 * → sediment (记忆沉淀) → review, with a foreshadowing ledger keeping
 * long-range consistency.
 */
export function NovelPanel() {
  const [books, setBooks] = React.useState<NovelListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const loadShelf = React.useCallback(async () => {
    try {
      const result = await getJSON<{ novels: NovelListItem[] }>("/api/novel");
      setBooks(result.novels);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load the bookshelf.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadShelf();
  }, [loadShelf]);

  if (activeId !== null) {
    return (
      <Studio
        novelId={activeId}
        onBack={() => {
          setActiveId(null);
          void loadShelf();
        }}
        onDeleted={() => {
          setActiveId(null);
          void loadShelf();
        }}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Feather className="size-5 text-amber-500" aria-hidden="true" />
                Novel Creator
              </CardTitle>
              <CardDescription className="max-w-2xl">
                A long-form serialized-novel pipeline inspired by
                webnovel-writer: GLM designs the story bible and volume
                outline, drafts chapters live against chapter goals and open
                foreshadowing, then sediments memory (facts, character states,
                hooks) so chapter 80 still remembers chapter 3.
              </CardDescription>
            </div>
            <CreateDialog
              onCreated={(id) => {
                setActiveId(id);
              }}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading bookshelf…
            </div>
          )}

          {!loading && loadError && (
            <div className="grid gap-3">
              <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {loadError}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setLoading(true);
                  void loadShelf();
                }}
                className="w-fit"
              >
                Retry
              </Button>
            </div>
          )}

          {!loading && !loadError && books.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
              <Library className="size-8 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="font-medium">Your bookshelf is empty</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Click “New Novel”, give GLM a one-line idea, and it builds the
                  bible, volumes and chapter pipeline.
                </p>
              </div>
            </div>
          )}

          {!loading && !loadError && books.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {books.map((book) => {
                const progress =
                  book.targetChapters > 0
                    ? Math.min(
                        100,
                        Math.round((book.writtenChapters / book.targetChapters) * 100),
                      )
                    : 0;
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => setActiveId(book.id)}
                    className="group rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="flex items-center gap-2 font-semibold leading-snug">
                          <BookOpen
                            className="size-4 shrink-0 text-amber-500"
                            aria-hidden="true"
                          />
                          {book.title}
                        </h3>
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {book.genre}
                        </Badge>
                      </div>
                      <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                        {book.logline}
                      </p>
                      <div className="mt-auto grid gap-1.5 pt-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {book.writtenChapters}/{book.targetChapters} chapters
                          </span>
                          <span>{timeAgo(book.updatedAt)}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        {book.openForeshadows > 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            {book.openForeshadows} open foreshadowing loop
                            {book.openForeshadows === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
