"use client";

// ---------------------------------------------------------------------------
// Novara AI — Workbench shell: the three-pane Agent Workbench (plan §4.1).
//
//   left   AssetTree        — novel header + the DOCUMENT TREE + live badges
//   center ConversationPane — D1 task board in the chat flow + D2 gates
//   right  DocPane          — the open documents (read-only projections)
//
// Responsive contract:
//   ≥ xl (1280px) : three panes side by side
//   lg – xl       : tree + conversation; documents open in an overlay sheet
//   < lg (1024px) : single pane with a bottom switcher; documents via sheet
//
// All domain CRUD lives here (migrated from the retired 7-tab workspace) and
// flows down to the panes; the agent run instance is owned once, here.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  deleteChapter,
  listNovelRuns,
  requestAiDraft,
  updateChapter,
  updateNovel,
} from "@/lib/novara/api";
import type {
  AiDraftResult,
  ChapterDTO,
  ChapterStatus,
  NovelDetail,
} from "@/lib/novara/types";
import type { AgentRun } from "@/lib/novara/agent-types";
import { buildDocTree, type DocNode } from "@/lib/novara/doc-tree";
import { cn } from "@/lib/utils";
import { AssetTree } from "./asset-tree";
import { DocPane } from "./doc-pane";
import { UserMenu, type UserMenuHandle } from "@/components/novara/user-menu";
import { ConversationPane } from "./conversation-pane";
import { ExportDialog } from "./import-export";
import { buildPinOptions } from "./prompt-box";
import { ConfirmDialog } from "./ui-bits";

type MobileView = "chat" | "assets";

const XL_QUERY = "(min-width: 1280px)";

/** How many runs the shell asks for. The server clamps to 1..50. */
const RUN_LIST_LIMIT = 50;

/** Stable empty list — keeps the run rows' referential identity stable. */
const EMPTY_RUNS: AgentRun[] = [];

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

  // Pin-to-Chat menu source — rebuilt when the novel detail refreshes.
  const pinOptions = useMemo(() => buildPinOptions(detail), [detail]);
  const selectChapter = useWriterStore((s) => s.selectChapter);
  const openDoc = useWriterStore((s) => s.openDoc);
  const setMemoryFocus = useWriterStore((s) => s.setMemoryFocus);
  const setLedgerKind = useWriterStore((s) => s.setLedgerKind);
  const railCollapsed = useWriterStore((s) => s.railCollapsedByNovel[novel.id] ?? false);

  // STEP 76 — the document tree carries the novel's runs (the Runs folder),
  // so the run list lives here and is handed to BOTH the rail (Write mode)
  // and the document pane (the run document). A run that settles re-fetches
  // the list, so a finished run shows up without a manual reload.
  const [runsState, setRunsState] = useState<{
    novelId: string;
    runs: AgentRun[];
  } | null>(null);
  const runs = runsState?.novelId === novel.id ? runsState.runs : EMPTY_RUNS;
  const runsLoading = runsState?.novelId !== novel.id;

  useEffect(() => {
    let alive = true;
    listNovelRuns(novel.id, RUN_LIST_LIMIT)
      .then((body) => {
        if (alive) {
          setRunsState({
            novelId: novel.id,
            runs: Array.isArray(body.runs) ? body.runs : [],
          });
        }
      })
      .catch(() => {
        if (alive) setRunsState({ novelId: novel.id, runs: [] });
      });
    return () => {
      alive = false;
    };
  }, [novel.id, runStatus]);

  // The document tree — ONE source for the rail's rows and the pane's tabs.
  const tree = useMemo(
    () => buildDocTree(detail, runs, detail.reviews ?? []),
    [detail, runs]
  );

  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [previewOpen, setPreviewOpen] = useState(false);

  // STEP 65 — the rail's gear button opens the SAME settings dialog the
  // user-menu row opens, through the user menu's imperative handle. One
  // dialog instance, one action.
  const userMenuRef = useRef<UserMenuHandle | null>(null);

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
  // Story contract (作品契约, Phase 7 P1) — the promise document.
  const [formContract, setFormContract] = useState(detail.contract ?? "");

  // ---- cross-pane navigation ----

  /** On < xl the artifact pane is an overlay — surface it when an asset is opened. */
  const revealArtifacts = useCallback(() => {
    if (typeof window !== "undefined" && !window.matchMedia(XL_QUERY).matches) {
      setPreviewOpen(true);
    }
  }, []);

  /** Shared CRUD wrapper: run, refetch, toast. Used by every handler below. */
  const wrap = useCallback(
    async (fn: () => Promise<unknown>, successTitle?: string): Promise<boolean> => {
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
    },
    [refresh, toast]
  );

  // ---- document handlers ----
  //
  // STEP 76 — a tree row opens a DOCUMENT. Every handler opens the document
  // in the pane and surfaces the pane below xl. The document ids are the
  // tree's own ids ("<DocKind>:<ref>").

  const handleOpenChapter = useCallback(
    (chapterId: string) => {
      selectChapter(novel.id, chapterId);
      openDoc(novel.id, `chapter:${chapterId}`);
      revealArtifacts();
    },
    [novel.id, openDoc, revealArtifacts, selectChapter]
  );

  /** Tree beat row → the beat's document. */
  const handleOpenBeat = useCallback(
    (beatId: string) => {
      openDoc(novel.id, `beat:${beatId}`);
      revealArtifacts();
    },
    [novel.id, openDoc, revealArtifacts]
  );

  /** Tree character row → the character's document. */
  const handleOpenCharacter = useCallback(
    (characterId: string) => {
      openDoc(novel.id, `character:${characterId}`);
      revealArtifacts();
    },
    [novel.id, openDoc, revealArtifacts]
  );

  /** Tree world entry row → the entry's document. */
  const handleOpenWorld = useCallback(
    (worldId: string) => {
      openDoc(novel.id, `world_entry:${worldId}`);
      revealArtifacts();
    },
    [novel.id, openDoc, revealArtifacts]
  );

  /** Tree pack row → the pack's document. */
  const handleOpenPack = useCallback(
    (packId: string) => {
      openDoc(novel.id, `pack:${packId}`);
      revealArtifacts();
    },
    [novel.id, openDoc, revealArtifacts]
  );

  /** Every document row of the tree → the pane. */
  const handleOpenDoc = useCallback(
    (node: DocNode) => {
      switch (node.doc) {
        case "chapter":
          handleOpenChapter(node.ref);
          return;
        case "beat":
          handleOpenBeat(node.ref);
          return;
        case "character":
          handleOpenCharacter(node.ref);
          return;
        case "world_entry":
          handleOpenWorld(node.ref);
          return;
        case "pack":
          handleOpenPack(node.ref);
          return;
        case "memory_index":
          setMemoryFocus(novel.id, "all");
          break;
        case "memory_category":
          setMemoryFocus(novel.id, node.ref);
          break;
        case "ledger_storylines":
          setLedgerKind(novel.id, "storyline");
          break;
        case "ledger_timeline":
          setLedgerKind(novel.id, "timeline");
          break;
        case "ledger_arcs":
          setLedgerKind(novel.id, "arc");
          break;
        case "ledger_promises":
          setLedgerKind(novel.id, "promise");
          break;
        case "ledger_clues":
          setLedgerKind(novel.id, "clue");
          break;
        case "run":
          void run.viewRun(node.ref);
          break;
        default:
          break;
      }
      openDoc(novel.id, node.id);
      revealArtifacts();
    },
    [
      handleOpenBeat,
      handleOpenChapter,
      handleOpenCharacter,
      handleOpenPack,
      handleOpenWorld,
      novel.id,
      openDoc,
      revealArtifacts,
      run,
      setLedgerKind,
      setMemoryFocus,
    ]
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
  // the author explicitly reopens it (demotes to draft).
  const [pendingReopen, setPendingReopen] = useState<{
    id: string;
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string };
  } | null>(null);

  const handleSaveChapter = async (
    id: string,
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string },
    opts?: { overwrite?: boolean; reopen?: boolean; silent?: boolean }
  ): Promise<ChapterDTO | null> => {
    try {
      const { chapter } = await updateChapter(id, {
        ...patch,
        ...(opts?.overwrite ? { overwrite: true } : {}),
        ...(opts?.reopen ? { reopen: true } : {}),
      });
      onPatchChapter(chapter);
      // STEP 81 — the chapter document autosaves; a silent save must not raise
      // a toast on every keystroke pause.
      if (!opts?.silent) toast({ title: "Chapter saved" });
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
          /** STEP 79 — the typed refusal of a finalized asset. */
          error?: string;
          kind?: string;
          id?: string;
          reopen?: string;
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
      // STEP 79 — the server refuses to mutate a FINAL asset with a typed
      // body. Show ITS message (kind + finalized + the reopen URL), never the
      // generic "Save failed".
      if (err.status === 409 && err.body?.error === "asset_finalized") {
        const kind = err.body.kind ?? "asset";
        toast({
          title: "This asset is finalized",
          description: `The ${kind} is finalized (locked) and cannot be changed. Reopen it to edit: ${
            err.body.reopen ?? "/api/novels/…/reopen"
          }`,
          variant: "destructive",
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
          contract: formContract,
        }),
      "Novel details saved"
    );
  };

  const tasks = run.detail?.tasks ?? [];

  return (
    <div className="flex h-full min-h-0 w-full border-t pb-[3.25rem] lg:pb-0 [--workbench-head-h:112px]">
      {/* The three columns share ONE top band: the rail's tree header, the
          chat header and the document pane's header all end on the same
          horizontal line. `--workbench-head-h` is that band's height. */}
      {/* Left rail — the document tree */}
      <aside
        aria-label="Asset tree"
        className={cn(
          "min-h-0 shrink-0 flex-col border-r bg-card/40 lg:flex lg:w-[256px]",
          // STEP 76 — the pane's ▤ button collapses the rail (the pane's
          // fullscreen button is the one that takes over the screen).
          railCollapsed && "lg:hidden",
          mobileView === "assets" ? "flex w-full" : "hidden"
        )}
      >
        <AssetTree
          detail={detail}
          tasks={tasks}
          runs={runs}
          runsLoading={runsLoading}
          tree={tree}
          onOpenDoc={handleOpenDoc}
          onAddChapter={handleAddChapter}
          onEditDetails={() => setEditOpen(true)}
          onExport={() => setExportOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          addingChapter={addingChapter}
          // STEP 65 — the rail's Write mode loads a run through the SAME
          // viewRun path the centre column's history switcher uses.
          onOpenRun={(runId) => void run.viewRun(runId)}
          currentRunId={runId}
          onOpenSettings={() => userMenuRef.current?.openSettings("account")}
        />
        {/* Step 62 — the user menu is pinned to the BOTTOM of the rail
            (a sticky footer above the mobile switcher). */}
        <div className="mt-auto shrink-0 border-t p-2">
          <UserMenu ref={userMenuRef} />
        </div>
      </aside>

      {/* Center — agent conversation */}
      <section aria-label="Agent conversation" className={cn("min-h-0 min-w-0 flex-1 lg:flex", mobileView === "chat" ? "flex" : "hidden")}>
        <ConversationPane
          novel={novel}
          chapterCount={detail.chapters.length}
          run={run}
          pinOptions={pinOptions}
          onOpenPreview={() => setPreviewOpen(true)}
        />
      </section>

      {/* Right — the documents (docked at ≥ xl) */}
      <aside
        aria-label="Document pane"
        className="hidden min-h-0 w-[400px] shrink-0 flex-col border-l xl:flex"
      >
        <DocPane
          detail={detail}
          tree={tree}
          runs={runs}
          onRefresh={refresh}
          chapters={{
            selectedId: selectedChapterId,
            onSelect: (id: string) => selectChapter(novel.id, id),
            onAdd: handleAddChapter,
            onDelete: handleDeleteChapter,
            onSave: handleSaveChapter,
            onAiDraft: handleAiDraft,
          }}
        />
      </aside>

      {/* Right — the documents (overlay below xl) */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-lg lg:max-w-xl"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Documents</SheetTitle>
            <SheetDescription>
              The open documents — read-only projections of the novel.
            </SheetDescription>
          </SheetHeader>
          <DocPane
            detail={detail}
            tree={tree}
            runs={runs}
            onRefresh={refresh}
            chapters={{
              selectedId: selectedChapterId,
              onSelect: (id: string) => selectChapter(novel.id, id),
              onAdd: handleAddChapter,
              onDelete: handleDeleteChapter,
              onSave: handleSaveChapter,
              onAiDraft: handleAiDraft,
            }}
          />
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
          Documents
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
            <div className="space-y-1.5">
              <Label htmlFor="meta-contract">Story contract</Label>
              <Textarea
                id="meta-contract"
                value={formContract}
                onChange={(e) => setFormContract(e.target.value)}
                rows={4}
                placeholder="The promise this book makes: genre expectations, audience, style commitments, hard taboos… Read into every AI writing context."
                aria-label="Story contract"
              />
              <p className="text-[11px] text-muted-foreground">
                The writing team reads this before every chapter — keep promises
                explicit (POV, tone, content lines it must never cross).
              </p>
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
        description="This chapter is finalized (locked). Reopening demotes it to draft and applies your changes — the final mark will be removed until it is re-finalized."
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
