"use client";

// ---------------------------------------------------------------------------
// Novara AI — STEP 76: the document pane (the right pane).
//
// RULE 2: every document is a READ-ONLY PROJECTION of data that already
// exists in the novel detail. The pane has NO save button, NO new-document
// button and NO reload button.
//
// STEP 81: a chapter document uses the SAME header, toolbar and status line
// as every other document. chapter-editor.tsx is now BODY ONLY — it owns the
// writable prose, the muted Brief/Outline section and the versions dialog,
// and draws no chrome of its own. A chapter is the single special case: its
// data is authored rather than projected, so it alone autosaves and offers a
// status change. Those actions live in the pane's own header, not in a second
// card stacked inside the body.
//
// The pane's tab strip lists the OPEN DOCUMENTS (not a fixed set of tabs).
// Clicking a tree row opens its document as a tab; closing the active tab
// activates its left neighbour.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  History,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useWriterStore, type DocViewMode } from "@/hooks/use-writer-store";
import { getNovelMemory, reopenAsset } from "@/lib/novara/api";
import {
  DOC_KIND_LABELS,
  DOC_RENDERERS,
  type MemorySnapshot,
} from "@/lib/novara/doc-markdown";
import {
  canonState,
  canonStateLabel,
  DOC_LIFECYCLE_KINDS,
  walkDocTree,
  type DocNode,
  type Node,
  type RunSummary,
} from "@/lib/novara/doc-tree";
import type {
  AiDraftResult,
  CanonState,
  ChapterDTO,
  ChapterStatus,
  NovelDetail,
} from "@/lib/novara/types";
import { formatWordCount } from "@/lib/novara/words";
import { cn } from "@/lib/utils";
import { ChapterEditor, type ChapterDocumentState } from "./chapter-editor";
import { MarkdownDocument } from "./markdown-document";
import { PinButton, StateChip } from "./ui-bits";

/** Stable empty list — a fresh array on every selector call breaks zustand's
 * snapshot identity (React Compiler loop guard). */
const EMPTY_DOCS: string[] = [];

/**
 * The renderer's meta line may carry a raw status word ("draft", "final") or
 * one of the retired state words. The vocabulary has exactly two words
 * (STEP 79) — Draft and Final — and everything else is a count.
 */
function canonicalMeta(meta: string | undefined, state: CanonState | undefined): string {
  const raw = (meta ?? "").trim();
  const word = raw.toLowerCase();
  if (word === "draft" || word === "final" || word === "revised") {
    return canonStateLabel(state ?? canonState(word));
  }
  return raw;
}

/** The chapter handlers the pane needs for a chapter document. */
export interface DocPaneChapterHandlers {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => Promise<void>;
  onDelete: (chapter: ChapterDTO) => Promise<void>;
  onSave: (
    id: string,
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string },
    opts?: { overwrite?: boolean; silent?: boolean }
  ) => Promise<ChapterDTO | null>;
  onAiDraft: (
    chapter: ChapterDTO,
    opts?: { variants?: number }
  ) => Promise<AiDraftResult | null>;
}

export interface DocPaneProps {
  detail: NovelDetail;
  /** The document tree — the source of the tab labels and the document refs. */
  tree: Node[];
  /** The novel's runs (the run document projects one of them). */
  runs: RunSummary[];
  chapters: DocPaneChapterHandlers;
  /** Re-fetch the novel detail — used after a reopen flips the state chip. */
  onRefresh?: () => Promise<void>;
  className?: string;
}

export function DocPane({
  detail,
  tree,
  runs,
  chapters,
  onRefresh,
  className,
}: DocPaneProps) {
  const { toast } = useToast();
  const novelId = detail.novel.id;
  const openDocs = useWriterStore((s) => s.openDocsByNovel[novelId] ?? EMPTY_DOCS);
  const activeDocId = useWriterStore((s) => s.activeDocByNovel[novelId] ?? null);
  const viewMode = useWriterStore(
    (s) => (activeDocId ? s.docViewByNovel[novelId]?.[activeDocId] ?? "document" : "document")
  ) as DocViewMode;
  const railCollapsed = useWriterStore((s) => s.railCollapsedByNovel[novelId] ?? false);
  // STEP 76 — the deep-link focus the tree writes when a memory or a ledger
  // document is opened. It is shown in the status line, so the focus handler
  // keeps a visible effect after the artifact tabs were replaced.
  const memoryFocus = useWriterStore((s) => s.memoryFocusByNovel[novelId] ?? null);
  const ledgerFocus = useWriterStore((s) => s.ledgerKindByNovel[novelId] ?? null);
  const openDoc = useWriterStore((s) => s.openDoc);
  const closeDoc = useWriterStore((s) => s.closeDoc);
  const activateDoc = useWriterStore((s) => s.activateDoc);
  const setDocView = useWriterStore((s) => s.setDocView);
  const setRailCollapsed = useWriterStore((s) => s.setRailCollapsed);

  const [copied, setCopied] = useState(false);
  const [full, setFull] = useState(false);
  const [memory, setMemory] = useState<MemorySnapshot | null>(null);
  const [reopening, setReopening] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  // History is keyed by the OPEN DOCUMENT, so switching tabs closes it without
  // a state-syncing effect.
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);
  const historyOpen = historyDocId !== null && historyDocId === activeDocId;
  const [chapterState, setChapterState] = useState<ChapterDocumentState>({
    words: 0,
    dirty: false,
    saving: false,
    content: "",
  });

  // Every document node of the tree, keyed by its id (the tab labels).
  const docNodes = useMemo(() => {
    const map = new Map<string, DocNode>();
    walkDocTree(tree, (node) => {
      if (node.kind === "doc") map.set(node.id, node);
    });
    return map;
  }, [tree]);

  const activeNode = activeDocId ? (docNodes.get(activeDocId) ?? null) : null;
  const isChapter = activeNode?.doc === "chapter";
  // STEP 79 — a document is editable if and only if its subject is a Draft.
  const activeState = activeNode?.state ?? null;
  const isFinalDocument = activeState === "final";
  // The lifecycle kind of the open document — the API's snake_case vocabulary.
  const reopenKind = activeNode ? (DOC_LIFECYCLE_KINDS[activeNode.doc] ?? null) : null;
  const pinTarget =
    activeNode && isChapter
      ? { type: "chapter" as const, id: activeNode.ref, label: activeNode.label }
      : null;

  // The memory documents project the memory pool — fetched once, lazily.
  const needsMemory =
    activeNode?.doc === "memory_index" || activeNode?.doc === "memory_category";
  useEffect(() => {
    if (!needsMemory) return;
    let cancelled = false;
    void getNovelMemory(novelId)
      .then((view) => {
        if (cancelled) return;
        setMemory({
          facts: view.items ?? [],
          digests: view.digests ?? [],
          stats: view.stats,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsMemory, novelId]);

  const rendered = useMemo(() => {
    if (!activeNode) return null;
    try {
      return DOC_RENDERERS[activeNode.doc]({
        node: activeNode,
        detail,
        runs,
        reviews: detail.reviews ?? [],
        memory,
      });
    } catch {
      return null;
    }
  }, [activeNode, detail, runs, memory]);

  // Esc leaves the fullscreen pane.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  // The chapter's prose is the buffer, not the renderer's projection: copy
  // exactly what the author sees in the Markdown view.
  const copyMarkdown = async () => {
    const markdown = isChapter ? chapterState.content : (rendered?.markdown ?? "");
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    } catch {
      setCopied(false);
    }
  };

  const kindLabel = activeNode ? DOC_KIND_LABELS[activeNode.doc] : "Document";
  const path = `A:\\Novel\\${detail.novel.title}`;
  // The status line never shows a retired state word: a raw "draft"/"final"
  // becomes Draft/Final, and the concept document shows its field COUNT.
  const statusMeta =
    activeNode?.doc === "concept"
      ? `${activeNode.badge ?? "0"} fields`
      : canonicalMeta(rendered?.meta, activeNode?.state);
  const focusNote =
    activeNode?.doc === "memory_index" || activeNode?.doc === "memory_category"
      ? memoryFocus
        ? ` · focus: ${memoryFocus}`
        : ""
      : activeNode?.doc.startsWith("ledger_")
        ? ledgerFocus
          ? ` · focus: ${ledgerFocus}`
          : ""
        : "";

  /** Reopen the open document's asset so it becomes editable again (STEP 79). */
  const reopen = async () => {
    if (!activeNode || !reopenKind) return;
    setReopening(true);
    try {
      await reopenAsset(novelId, reopenKind, activeNode.ref);
      toast({
        title: "Reopened for editing",
        description: `${kindLabel} is a draft again.`,
      });
      // Re-fetch the detail so the state chip flips to Draft.
      await onRefresh?.();
    } catch (e) {
      // A typed refusal carries the server's own message — show it verbatim.
      const err = e as Error & {
        status?: number;
        body?: { error?: string; kind?: string; reopen?: string };
      };
      const description =
        err.body?.error === "asset_finalized"
          ? `The ${err.body.kind ?? "asset"} is finalized (locked). Reopen it to edit: ${
              err.body.reopen ?? ""
            }`.trim()
          : e instanceof Error
            ? e.message
            : "Unknown error";
      toast({
        title: "Could not reopen",
        description,
        variant: "destructive",
      });
    } finally {
      setReopening(false);
    }
  };

  /** Status change — Draft -> Final goes through the same save path as the
   * rest of the app: the server owns the E2 gate and the memory projection. */
  const markFinal = async () => {
    if (!activeNode) return;
    setFinalizing(true);
    try {
      const next = await chapters.onSave(
        activeNode.ref,
        { status: "final" },
        { silent: true }
      );
      if (next) {
        toast({
          title: "Chapter finalized",
          description: `${activeNode.label} is locked and its memory was projected.`,
        });
        await onRefresh?.();
      }
    } catch (e) {
      toast({
        title: "Could not finalize",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        full && "fixed inset-0 z-50 bg-background",
        className
      )}
      aria-label="Document pane"
    >
      {/* TOP BAND — the tab strip and the path row share the shared workbench
          band height (--workbench-head-h), so the path row's bottom border
          lands on the same horizontal line as the rail's tree header and the
          chat header. */}
      <div className="flex h-[var(--workbench-head-h,112px)] shrink-0 flex-col">
      {/* Tab strip — the open documents. */}
      <div className="flex items-center gap-1 border-b px-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 px-0"
          aria-label={railCollapsed ? "Expand the rail" : "Collapse the rail"}
          title={railCollapsed ? "Expand the rail" : "Collapse the rail"}
          onClick={() => setRailCollapsed(novelId, !railCollapsed)}
        >
          {railCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
        <div className="nice-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {openDocs.length === 0 && (
            <span className="px-2 py-1.5 text-[11px] text-muted-foreground">
              No open document
            </span>
          )}
          {openDocs.map((id) => {
            const node = docNodes.get(id);
            const active = id === activeDocId;
            return (
              <span
                key={id}
                className={cn(
                  "flex h-7 shrink-0 items-center gap-1 border-b-2 px-2 text-[11px]",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground"
                )}
              >
                <button
                  type="button"
                  onClick={() => activateDoc(novelId, id)}
                  aria-current={active ? "true" : undefined}
                  className="max-w-[150px] truncate"
                >
                  {node?.label ?? id}
                </button>
                <button
                  type="button"
                  onClick={() => closeDoc(novelId, id)}
                  aria-label={`Close ${node?.label ?? id}`}
                  className="rounded p-0.5 hover:bg-muted"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* Header — path, state chip, lifecycle actions, Document|Markdown,
          History (chapters only), copy and fullscreen. ONE chrome for EVERY
          document kind, chapters included. */}
      <div className="flex flex-1 flex-wrap content-start items-start gap-1.5 border-b px-2 py-1.5">
        <span className="max-w-[150px] truncate font-mono text-[11px] text-muted-foreground">
          {path}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {kindLabel}
        </span>
        {activeState && <StateChip status={activeState} />}
        {isFinalDocument && reopenKind && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => void reopen()}
            disabled={reopening}
            aria-label="Reopen to edit"
            title="Reopen to edit"
          >
            {reopening ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Reopen to edit
          </Button>
        )}
        {isChapter && !isFinalDocument && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => void markFinal()}
            disabled={finalizing}
            aria-label="Mark as final"
            title="Mark as final — locks the chapter and projects its memory"
          >
            {finalizing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Mark final
          </Button>
        )}
        {pinTarget && (
          <PinButton
            novelId={novelId}
            target={pinTarget}
            label="Pin"
            className="h-7 gap-1 px-1.5 text-[11px]"
          />
        )}
        <span className="flex-1" />
        <span className="flex items-center rounded border text-[11px]">
          <button
            type="button"
            onClick={() => activeDocId && setDocView(novelId, activeDocId, "document")}
            aria-pressed={viewMode === "document"}
            className={cn(
              "px-1.5 py-0.5",
              viewMode === "document" && "bg-muted text-foreground"
            )}
          >
            Document
          </button>
          <button
            type="button"
            onClick={() => activeDocId && setDocView(novelId, activeDocId, "markdown")}
            aria-pressed={viewMode === "markdown"}
            className={cn(
              "px-1.5 py-0.5",
              viewMode === "markdown" && "bg-muted text-foreground"
            )}
          >
            Markdown
          </button>
        </span>
        {isChapter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            aria-label="Version history"
            title="Version history"
            onClick={() => setHistoryDocId(activeDocId)}
          >
            <History className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 px-0"
          aria-label="Copy the markdown source"
          title="Copy the markdown source"
          onClick={() => void copyMarkdown()}
        >
          {copied ? (
            <Check className="h-4 w-4 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 px-0"
          aria-label={full ? "Exit the fullscreen pane" : "Fullscreen the pane"}
          title={full ? "Exit the fullscreen pane" : "Fullscreen the pane"}
          onClick={() => setFull((f) => !f)}
        >
          {full ? (
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </div>
      </div>

      {/* Body — the document. A chapter is the only BODY-ONLY document, so it
          gets a flex column; every other kind keeps the scrolling projection. */}
      <div
        className={cn(
          "nice-scroll min-h-0 flex-1",
          isChapter ? "flex flex-col overflow-hidden" : "overflow-y-auto p-3"
        )}
      >
        {!activeNode ? (
          <p className="text-xs text-muted-foreground">
            Open a document from the tree on the left.
          </p>
        ) : isChapter ? (
          <ChapterEditor
            chapters={detail.chapters}
            // The chapter DOCUMENT is the chapter: the tab's own ref wins over
            // the store's selection, so an old tab can never show another
            // chapter's prose.
            selectedId={activeNode.ref}
            onSave={chapters.onSave}
            onAiDraft={chapters.onAiDraft}
            view={viewMode}
            historyOpen={historyOpen}
            onHistoryOpenChange={(open) => setHistoryDocId(open ? activeDocId : null)}
            onStateChange={setChapterState}
          />
        ) : viewMode === "markdown" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.85]">
            {rendered?.markdown ?? ""}
          </pre>
        ) : (
          <MarkdownDocument content={rendered?.markdown ?? ""} />
        )}
      </div>

      {/* Status line — what this document is. ONE component for every kind. */}
      <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        {isChapter
          ? isFinalDocument
            ? `locked · the author's prose · ${formatWordCount(chapterState.words)} words`
            : `editable · your prose · ${formatWordCount(chapterState.words)} words · ${
                chapterState.saving
                  ? "saving"
                  : chapterState.dirty
                    ? "unsaved"
                    : "saved"
              }`
          : `read-only · generated from ${kindLabel} · ${statusMeta}${focusNote}`}
      </div>
    </div>
  );
}
