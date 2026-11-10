"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  createNovel,
  deleteNovel,
  getNovel,
  listNovels,
} from "@/lib/novara/api";
import type { CreateNovelInput } from "@/lib/novara/api";
import type { ChapterDTO, NovelDetail, NovelSummary } from "@/lib/novara/types";
import { NovelDashboard } from "./novel-dashboard";
import { WorkbenchShell } from "./workbench-shell";
import { UsageBalanceBadge } from "./usage-balance-badge";

export function WriterApp({ onExit }: { onExit: () => void }) {
  const { toast } = useToast();
  const [novels, setNovels] = useState<NovelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    // P1 — restore persisted writer UI prefs (per-novel composer run mode)
    // after mount. The store uses skipHydration, so this is the single
    // hydration-safe point where localStorage state re-enters the app.
    void useWriterStore.persist.rehydrate();
  }, []);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listNovels();
      setNovels(res.novels);
    } catch (e) {
      toast({
        title: "Could not load novels",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const openNovel = useCallback(
    async (id: string) => {
      setOpening(true);
      try {
        setDetail(await getNovel(id));
      } catch (e) {
        toast({
          title: "Could not open novel",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setOpening(false);
      }
    },
    [toast]
  );

  const closeNovel = useCallback(() => {
    setDetail(null);
    void refreshList();
  }, [refreshList]);

  const handleCreate = useCallback(
    async (input: CreateNovelInput) => {
      try {
        const { novel } = await createNovel(input);
        toast({ title: `“${novel.title}” created` });
        void openNovel(novel.id);
        return true;
      } catch (e) {
        toast({
          title: "Could not create novel",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
        return false;
      }
    },
    [openNovel, toast]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteNovel(id);
        setDetail(null);
        await refreshList();
      } catch (e) {
        toast({
          title: "Delete failed",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      }
    },
    [refreshList, toast]
  );

  const patchChapter = useCallback((next: ChapterDTO) => {
    setDetail((d) =>
      d
        ? {
            ...d,
            chapters: d.chapters.map((c) => (c.id === next.id ? next : c)),
          }
        : d
    );
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!detail) return;
    try {
      setDetail(await getNovel(detail.novel.id));
    } catch {
      // detail refresh is best-effort; list refresh covers recovery
    }
  }, [detail]);

  return (
    <div
      className={
        detail
          ? "flex h-[100dvh] flex-col overflow-hidden bg-background"
          : "flex min-h-screen flex-col bg-background"
      }
    >
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Button variant="ghost" size="sm" onClick={detail ? closeNovel : onExit}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {detail ? "All novels" : "Website"}
          </Button>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="font-display font-bold">AI Writer</span>
          </div>
          <span className="ml-auto">
            {/* P5-b — the central "Usage & balance" view lives AT the
                account-like anchor (Guest session badge; proposal §5). The
                badge visual is unchanged; it now opens the account view. */}
            <UsageBalanceBadge />
          </span>
        </div>
      </header>

      <main
        className={
          detail
            ? "flex w-full flex-1 overflow-hidden"
            : "mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
        }
      >
        {opening ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
            <span
              className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent"
              aria-hidden="true"
            />
            Opening novel…
          </div>
        ) : detail ? (
          <WorkbenchShell
            detail={detail}
            onBack={closeNovel}
            onDelete={handleDelete}
            onPatchChapter={patchChapter}
            refresh={refreshDetail}
          />
        ) : (
          <NovelDashboard
            novels={novels}
            loading={loading}
            onOpen={openNovel}
            onCreate={handleCreate}
            onImported={openNovel}
            onDelete={handleDelete}
          />
        )}
      </main>

      {!detail && (
        <footer className="mt-auto border-t bg-secondary/40 py-3 text-center text-xs text-muted-foreground">
          Novara AI Writer — preview build · Full authentication and payments
          arrive later · Export backups regularly
        </footer>
      )}
    </div>
  );
}
