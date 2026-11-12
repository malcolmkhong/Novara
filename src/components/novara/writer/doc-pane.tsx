"use client";

// ---------------------------------------------------------------------------
// Novara AI — STEP 76: the document pane (the right pane).
//
// RULE 2: every document is a READ-ONLY PROJECTION of data that already
// exists in the novel detail. The pane has NO save button, NO new-document
// button and NO reload button. The ONE exception is the chapter document:
// the author's prose is not a projection, so it keeps the existing
// ChapterEditor unchanged (it stays editable).
//
// The pane's tab strip lists the OPEN DOCUMENTS (not a fixed set of tabs).
// Clicking a tree row opens its document as a tab; closing the active tab
// activates its left neighbour.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWriterStore, type DocViewMode } from "@/hooks/use-writer-store";
import { getNovelMemory } from "@/lib/novara/api";
import {
  DOC_KIND_LABELS,
  DOC_RENDERERS,
  type MemorySnapshot,
} from "@/lib/novara/doc-markdown";
import { walkDocTree, type DocNode, type Node, type RunSummary } from "@/lib/novara/doc-tree";
import type { AiDraftResult, ChapterDTO, ChapterStatus, NovelDetail } from "@/lib/novara/types";
import { cn } from "@/lib/utils";
import { ChapterEditor } from "./chapter-editor";
import { MarkdownDocument } from "./markdown-document";

/** Stable empty list — a fresh array on every selector call breaks zustand's
 * snapshot identity (React Compiler loop guard). */
const EMPTY_DOCS: string[] = [];

/** The chapter handlers the chapter document needs (the editor stays alive). */
export interface DocPaneChapterHandlers {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => Promise<void>;
  onDelete: (chapter: ChapterDTO) => Promise<void>;
  onSave: (
    id: string,
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string }
  ) => Promise<ChapterDTO | null>;
  onAiDraft: (chapter: ChapterDTO) => Promise<AiDraftResult | null>;
}

export interface DocPaneProps {
  detail: NovelDetail;
  /** The document tree — the source of the tab labels and the document refs. */
  tree: Node[];
  /** The novel's runs (the run document projects one of them). */
  runs: RunSummary[];
  chapters: DocPaneChapterHandlers;
  className?: string;
}

export function DocPane({ detail, tree, runs, chapters, className }: DocPaneProps) {
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

  const copyMarkdown = async () => {
    const markdown = rendered?.markdown ?? "";
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

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        full && "fixed inset-0 z-50 bg-background",
        className
      )}
      aria-label="Document pane"
    >
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

      {/* Header — path, kind, view toggle, copy, fullscreen. */}
      <div className="flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <span className="max-w-[150px] truncate font-mono text-[11px] text-muted-foreground">
          {path}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {kindLabel}
        </span>
        <span className="flex-1" />
        {!isChapter && (
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

      {/* Body — the document. */}
      <div className="nice-scroll min-h-0 flex-1 overflow-y-auto p-3">
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
            onSelect={chapters.onSelect}
            onAdd={chapters.onAdd}
            onDelete={chapters.onDelete}
            onSave={chapters.onSave}
            onAiDraft={chapters.onAiDraft}
            hideList
          />
        ) : viewMode === "markdown" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.85]">
            {rendered?.markdown ?? ""}
          </pre>
        ) : (
          <MarkdownDocument content={rendered?.markdown ?? ""} />
        )}
      </div>

      {/* Status line — what this document is. */}
      <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        {isChapter
          ? `editable · the author's prose · ${rendered?.meta ?? ""}`
          : `read-only · generated from ${kindLabel} · ${rendered?.meta ?? ""}${focusNote}`}
      </div>
    </div>
  );
}
