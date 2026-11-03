"use client";

// ---------------------------------------------------------------------------
// Novara AI — Workbench shell: the three-pane Agent Workbench (plan §4.1).
//
//   left   AssetTree        — novel header + asset tree + live agent badges
//   center ConversationPane — D1 task board in the chat flow + D2 gates
//   right  ArtifactPane     — draft / outline / bible / review / memory
//
// Responsive contract:
//   ≥ xl (1280px) : three panes side by side
//   lg – xl       : tree + conversation; artifacts open in an overlay sheet
//   < lg (1024px) : single pane with a bottom switcher; artifacts via sheet
//
// All domain CRUD lives here (migrated from the retired 7-tab workspace) and
// flows down to the panes; the agent run instance is owned once, here.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderTree,
  Loader2,
  MessageSquare,
  PanelRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAgentRun } from "@/hooks/use-agent-run";
import { useWriterStore } from "@/hooks/use-writer-store";
import {
  addChapter,
  addCharacter,
  addOutlineBeat,
  addWorldEntry,
  deleteChapter,
  deleteCharacter,
  deleteOutlineBeat,
  deleteWorldEntry,
  requestAiDraft,
  updateChapter,
  updateCharacter,
  updateNovel,
  updateOutlineBeat,
  updateWorldEntry,
} from "@/lib/novara/api";
import type {
  AiDraftResult,
  ChapterDTO,
  ChapterStatus,
  CharacterDTO,
  NovelDetail,
  OutlineBeatDTO,
  WorldEntryDTO,
} from "@/lib/novara/types";
import type { ArtifactTabId } from "@/config/writer";
import { cn } from "@/lib/utils";
import { ArtifactPane } from "./artifact-pane";
import { AssetTree } from "./asset-tree";
import { ConversationPane } from "./conversation-pane";
import { ExportDialog } from "./import-export";
import { ConfirmDialog } from "./ui-bits";

type MobileView = "chat" | "assets";

const XL_QUERY = "(min-width: 1280px)";

interface WorkbenchShellProps {
  detail: NovelDetail;
  onBack: () => void;
  onDelete: (id: string) => Promise<void>;
  onPatchChapter: (next: ChapterDTO) => void;
  refresh: () => Promise<void>;
}

export function WorkbenchShell({
  detail,
  onBack,
  onDelete,
  onPatchChapter,
  refresh,
}: WorkbenchShellProps) {
  const { toast } = useToast();
  const { novel } = detail;
  const run = useAgentRun(novel.id);

  // A run settles domain data behind our backs (chapters created/updated in
  // the DB by the executor or the approval commit). When the run reaches a
  // resting state, refetch the novel so asset counts and drafts stay honest.
  const runStatus = run.detail?.run.status;
  const runId = run.detail?.run.id ?? null;
  const settledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!runStatus || !runId) return;
    if (!["completed", "failed", "paused", "cancelled"].includes(runStatus)) return;
    const marker = `${runId}:${runStatus}`;
    if (settledRef.current === marker) return;
    settledRef.current = marker;
    void refresh();
  }, [runStatus, runId, refresh]);

  const selectedChapterId = useWriterStore(
    (s) => s.selectedChapterByNovel[novel.id] ?? detail.chapters[0]?.id ?? null
  );
  const selectedBeatId = useWriterStore((s) => s.selectedBeatByNovel[novel.id] ?? null);
  const selectedCharacterId = useWriterStore((s) => s.selectedCharacterByNovel[novel.id] ?? null);
  const selectedWorldId = useWriterStore((s) => s.selectedWorldByNovel[novel.id] ?? null);
  const selectChapter = useWriterStore((s) => s.selectChapter);
  const selectBeat = useWriterStore((s) => s.selectBeat);
  const selectCharacter = useWriterStore((s) => s.selectCharacter);
  const selectWorld = useWriterStore((s) => s.selectWorld);
  const setArtifactTab = useWriterStore((s) => s.setArtifactTab);

  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [previewOpen, setPreviewOpen] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addingChapter, setAddingChapter] = useState(false);

  // edit-details form state
  const [formTitle, setFormTitle] = useState(novel.title);
  const [formGenre, setFormGenre] = useState(novel.genre);
  const [formSynopsis, setFormSynopsis] = useState(novel.synopsis);
  const [formTarget, setFormTarget] = useState(String(novel.targetWords));

  // ---- cross-pane navigation ----

  /** On < xl the artifact pane is an overlay — surface it when an asset is opened. */
  const revealArtifacts = useCallback(() => {
    if (typeof window !== "undefined" && !window.matchMedia(XL_QUERY).matches) {
      setPreviewOpen(true);
    }
  }, []);

  const handleOpenChapter = useCallback(
    (chapterId: string) => {
      selectChapter(novel.id, chapterId);
      setArtifactTab(novel.id, "draft");
      revealArtifacts();
    },
    [novel.id, revealArtifacts, selectChapter, setArtifactTab]
  );

  const handleOpenArtifactTab = useCallback(
    (tab: ArtifactTabId) => {
      setArtifactTab(novel.id, tab);
      revealArtifacts();
    },
    [novel.id, revealArtifacts, setArtifactTab]
  );

  /** Tree file → open the owning tab with that asset focused. */
  const handleOpenBeat = useCallback(
    (beatId: string) => {
      selectBeat(novel.id, beatId);
      setArtifactTab(novel.id, "outline");
      revealArtifacts();
    },
    [novel.id, revealArtifacts, selectBeat, setArtifactTab]
  );

  const handleOpenCharacter = useCallback(
    (characterId: string) => {
      selectCharacter(novel.id, characterId);
      setArtifactTab(novel.id, "bible");
      revealArtifacts();
    },
    [novel.id, revealArtifacts, selectCharacter, setArtifactTab]
  );

  const handleOpenWorld = useCallback(
    (worldId: string) => {
      selectWorld(novel.id, worldId);
      setArtifactTab(novel.id, "bible");
      revealArtifacts();
    },
    [novel.id, revealArtifacts, selectWorld, setArtifactTab]
  );

  // ---- chapter handlers ----

  const handleAddChapter = async () => {
    setAddingChapter(true);
    try {
      const { chapter } = await addChapter(novel.id);
      await refresh();
      selectChapter(novel.id, chapter.id);
      toast({ title: `“${chapter.title}” added` });
    } catch (e) {
      toast({
        title: "Could not add chapter",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAddingChapter(false);
    }
  };

  const handleDeleteChapter = async (chapter: ChapterDTO) => {
    try {
      await deleteChapter(chapter.id);
      if (selectedChapterId === chapter.id) selectChapter(novel.id, null);
      await refresh();
      toast({ title: `“${chapter.title}” deleted` });
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const [pendingOverwrite, setPendingOverwrite] = useState<{
    id: string;
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string };
    existingWords: number;
    incomingWords: number;
  } | null>(null);

  // Final-lock gate (Phase 7): a final chapter refuses content changes until
  // the author explicitly reopens it (demotes to revised).
  const [pendingReopen, setPendingReopen] = useState<{
    id: string;
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string };
  } | null>(null);

  const handleSaveChapter = async (
    id: string,
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string },
    opts?: { overwrite?: boolean; reopen?: boolean }
  ): Promise<ChapterDTO | null> => {
    try {
      const { chapter } = await updateChapter(id, {
        ...patch,
        ...(opts?.overwrite ? { overwrite: true } : {}),
        ...(opts?.reopen ? { reopen: true } : {}),
      });
      onPatchChapter(chapter);
      toast({ title: "Chapter saved" });
      return chapter;
    } catch (e) {
      // Anti-overwrite gate: the server refuses to replace non-empty content
      // without an explicit confirmation — surface it as a confirm dialog.
      const err = e as Error & {
        status?: number;
        body?: {
          requiresOverwrite?: boolean;
          requiresReopen?: boolean;
          existingWords?: number;
          incomingWords?: number;
        };
      };
      if (err.status === 409 && err.body?.requiresReopen) {
        setPendingReopen({ id, patch });
        return null;
      }
      if (err.status === 409 && err.body?.requiresOverwrite) {
        setPendingOverwrite({
          id,
          patch,
          existingWords: err.body.existingWords ?? 0,
          incomingWords: err.body.incomingWords ?? 0,
        });
        return null;
      }
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      return null;
    }
  };

  const handleAiDraft = async (
    chapter: ChapterDTO,
    opts?: { variants?: number }
  ): Promise<AiDraftResult | null> => {
    try {
      return await requestAiDraft(chapter.id, opts);
    } catch (e) {
      toast({
        title: opts?.variants && opts.variants > 1 ? "A/B draft failed" : "AI draft failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      return null;
    }
  };

  // ---- bible handlers (all end with a full refresh) ----

  const wrap = async (fn: () => Promise<unknown>, successTitle?: string): Promise<boolean> => {
    try {
      await fn();
      await refresh();
      if (successTitle) toast({ title: successTitle });
      return true;
    } catch (e) {
      toast({
        title: "Operation failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      return false;
    }
  };

  // ---- novel meta ----

  const saveMeta = async (): Promise<boolean> => {
    if (!formTitle.trim()) return false;
    const parsedTarget = Number.parseInt(formTarget, 10);
    return wrap(
      () =>
        updateNovel(novel.id, {
          title: formTitle.trim(),
          genre: formGenre.trim(),
          synopsis: formSynopsis,
          targetWords: Number.isFinite(parsedTarget)
            ? Math.min(Math.max(parsedTarget, 1000), 5000000)
            : undefined,
        }),
      "Novel details saved"
    );
  };

  // ---- shared handler bundle for artifact panes ----

  const artifactHandlers = {
    selectedChapterId,
    onSelectChapter: (id: string) => selectChapter(novel.id, id),
    focusBeatId: selectedBeatId,
    focusCharacterId: selectedCharacterId,
    focusWorldId: selectedWorldId,
    onClearCharacter: () => selectCharacter(novel.id, null),
    onClearWorld: () => selectWorld(novel.id, null),
    onClearBeat: () => selectBeat(novel.id, null),
    onAddChapter: handleAddChapter,
    onDeleteChapter: handleDeleteChapter,
    onSaveChapter: handleSaveChapter,
    onAiDraft: handleAiDraft,
    onAddCharacter: (input: { name: string; role?: string; description?: string }) =>
      wrap(() => addCharacter(novel.id, input), "Character added"),
    onUpdateCharacter: (id: string, patch: Partial<{ name: string; role?: string; description?: string }>) =>
      wrap(() => updateCharacter(id, patch), "Character saved"),
    onDeleteCharacter: (c: CharacterDTO) =>
      wrap(() => deleteCharacter(c.id)).then(() => undefined),
    onAddWorldEntry: (input: { title: string; category?: WorldEntryDTO["category"]; content?: string }) =>
      wrap(() => addWorldEntry(novel.id, input), "World entry added"),
    onUpdateWorldEntry: (id: string, patch: Partial<{ title: string; category?: WorldEntryDTO["category"]; content?: string }>) =>
      wrap(() => updateWorldEntry(id, patch), "World entry saved"),
    onDeleteWorldEntry: (w: WorldEntryDTO) =>
      wrap(() => deleteWorldEntry(w.id)).then(() => undefined),
    onAddBeat: (input: { title: string; summary?: string }) =>
      wrap(() => addOutlineBeat(novel.id, input), "Beat added"),
    onUpdateBeat: (id: string, patch: Partial<{ title: string; summary?: string }>) =>
      wrap(() => updateOutlineBeat(id, patch), "Beat saved"),
    onDeleteBeat: (b: OutlineBeatDTO) =>
      wrap(() => deleteOutlineBeat(b.id)).then(() => undefined),
  };

  const events = run.detail?.events ?? [];
  const tasks = run.detail?.tasks ?? [];

  return (
    <div className="flex h-full min-h-0 w-full border-t pb-[3.25rem] lg:pb-0">
      {/* Left rail — asset tree */}
      <aside
        aria-label="Asset tree"
        className={cn(
          "min-h-0 shrink-0 flex-col border-r bg-card/40 lg:flex lg:w-[300px]",
          mobileView === "assets" ? "flex w-full" : "hidden"
        )}
      >
        <AssetTree
          detail={detail}
          tasks={tasks}
          selectedChapterId={selectedChapterId}
          selectedBeatId={selectedBeatId}
          selectedCharacterId={selectedCharacterId}
          selectedWorldId={selectedWorldId}
          onOpenChapter={handleOpenChapter}
          onOpenBeat={handleOpenBeat}
          onOpenCharacter={handleOpenCharacter}
          onOpenWorld={handleOpenWorld}
          onOpenArtifactTab={handleOpenArtifactTab}
          onAddChapter={handleAddChapter}
          onEditDetails={() => setEditOpen(true)}
          onExport={() => setExportOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          addingChapter={addingChapter}
        />
      </aside>

      {/* Center — agent conversation */}
      <section aria-label="Agent conversation" className={cn("min-h-0 min-w-0 flex-1 lg:flex", mobileView === "chat" ? "flex" : "hidden")}>
        <ConversationPane
          novel={novel}
          chapterCount={detail.chapters.length}
          run={run}
          onOpenPreview={() => setPreviewOpen(true)}
        />
      </section>

      {/* Right — artifacts (docked at ≥ xl) */}
      <aside
        aria-label="Artifact pane"
        className="hidden min-h-0 w-[400px] shrink-0 flex-col border-l xl:flex"
      >
        <ArtifactPane detail={detail} events={events} tasks={tasks} handlers={artifactHandlers} />
      </aside>

      {/* Right — artifacts (overlay below xl) */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-lg lg:max-w-xl"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Artifacts</SheetTitle>
            <SheetDescription>
              Draft, outline, story bible, review and memory views.
            </SheetDescription>
          </SheetHeader>
          <ArtifactPane detail={detail} events={events} tasks={tasks} handlers={artifactHandlers} />
        </SheetContent>
      </Sheet>

      {/* Mobile bottom switcher */}
      <nav
        aria-label="Workbench views"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {(
          [
            { id: "chat", label: "Conversation", icon: MessageSquare },
            { id: "assets", label: "Assets", icon: FolderTree },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobileView(id)}
            aria-pressed={mobileView === id}
            className={cn(
              "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] transition-colors",
              mobileView === id ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] text-muted-foreground transition-colors"
        >
          <PanelRight className="h-4 w-4" aria-hidden="true" />
          Artifacts
        </button>
      </nav>

      {/* Export */}
      {exportOpen && (
        <ExportDialog novel={novel} onClose={() => setExportOpen(false)} />
      )}

      {/* Edit details */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novel details</DialogTitle>
            <DialogDescription>
              Title, genre, synopsis and target length.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="meta-title">Title</Label>
              <Input id="meta-title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="meta-genre">Genre</Label>
                <Input id="meta-genre" value={formGenre} onChange={(e) => setFormGenre(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="meta-target">Target words</Label>
                <Input
                  id="meta-target"
                  type="number"
                  min={1000}
                  max={5000000}
                  value={formTarget}
                  onChange={(e) => setFormTarget(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meta-synopsis">Synopsis</Label>
              <Textarea
                id="meta-synopsis"
                value={formSynopsis}
                onChange={(e) => setFormSynopsis(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                setBusy(true);
                const ok = await saveMeta();
                setBusy(false);
                if (ok) setEditOpen(false);
              }}
              disabled={busy || !formTitle.trim()}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete novel */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this novel?"
        description={`“${novel.title}” and all of its content will be permanently deleted. Export a backup first if you might want it back.`}
        onConfirm={async () => {
          setDeleteOpen(false);
          await onDelete(novel.id);
        }}
      />

      {/* Final-lock gate: explicit confirmation to reopen a final chapter */}
      <ConfirmDialog
        open={pendingReopen !== null}
        onOpenChange={(v) => {
          if (!v) setPendingReopen(null);
        }}
        title="Reopen this final chapter?"
        description="This chapter is finalized (locked). Reopening demotes it to revised and applies your changes — the final mark will be removed until it is re-finalized."
        confirmLabel="Reopen & save"
        onConfirm={async () => {
          const pending = pendingReopen;
          setPendingReopen(null);
          if (!pending) return;
          await handleSaveChapter(pending.id, pending.patch, {
            reopen: true,
            overwrite: true,
          });
        }}
      />

      {/* Anti-overwrite gate: explicit confirmation to replace content */}
      <ConfirmDialog
        open={pendingOverwrite !== null}
        onOpenChange={(v) => {
          if (!v) setPendingOverwrite(null);
        }}
        title="Overwrite chapter content?"
        description={`This chapter already has ${pendingOverwrite?.existingWords ?? 0} words. Saving will replace the existing text with the ${pendingOverwrite?.incomingWords ?? 0} new words — the old text cannot be recovered.`}
        confirmLabel="Overwrite"
        onConfirm={async () => {
          const pending = pendingOverwrite;
          setPendingOverwrite(null);
          if (!pending) return;
          await handleSaveChapter(
            pending.id,
            pending.patch,
            { overwrite: true }
          );
        }}
      />
    </div>
  );
}
