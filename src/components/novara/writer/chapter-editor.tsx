"use client";

// ---------------------------------------------------------------------------
// Novara AI — STEP 81: the chapter document BODY.
//
// The pane (doc-pane.tsx) owns the header, toolbar and status line for EVERY
// document. This component owns only the writable prose surface, the muted
// Brief/Outline section BELOW the prose, and the dialogs (versions, AI draft).
// A chapter is the one document whose data is authored rather than projected,
// so it alone owns a debounced autosave and a status-change action; that is
// the only special case.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  RotateCcw,
  ScrollText,
  Sparkles,
  SplitSquareHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getChapterVersions, type ChapterVersionRow } from "@/lib/novara/api";
import type { AiDraftResult, ChapterDTO, ChapterStatus } from "@/lib/novara/types";
import { countWords, formatWordCount } from "@/lib/novara/words";
import { cn } from "@/lib/utils";
import { RichEditor } from "@/components/novara/editor/rich-editor";
import { ConfirmDialog } from "./ui-bits";
import { MarkdownDocument } from "./markdown-document";
import { Spinner } from "@/components/novara/primitives";
import { TEXT_META, TEXT_LABEL } from "@/components/novara/styles";

export interface ChapterDocumentState {
  words: number;
  dirty: boolean;
  saving: boolean;
  content: string;
}

export interface ChapterEditorProps {
  chapters: ChapterDTO[];
  selectedId: string | null;
  onSave: (
    id: string,
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string },
    opts?: { overwrite?: boolean; silent?: boolean }
  ) => Promise<ChapterDTO | null>;
  onAiDraft: (
    chapter: ChapterDTO,
    opts?: { variants?: number }
  ) => Promise<AiDraftResult | null>;
  /** The pane's own Document | Markdown toggle (STEP 81). */
  view: "document" | "markdown";
  /** The pane's History icon button opens this versions table. */
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  /** Live words / clean-buffer flag / markdown source for the pane's status
   *  line and copy button. */
  onStateChange?: (state: ChapterDocumentState) => void;
}

const AUTOSAVE_MS = 900;

export function ChapterEditor({
  chapters,
  selectedId,
  onSave,
  onAiDraft,
  view,
  historyOpen,
  onHistoryOpenChange,
  onStateChange,
}: ChapterEditorProps) {
  const { toast } = useToast();
  const selected = chapters.find((c) => c.id === selectedId) ?? null;
  /** The selected chapter's id, or null when no chapter is selected. */
  const selectedChapterId = selected?.id ?? null;
  const isFinal = selected?.status === "final";

  const [content, setContent] = useState("");
  const [brief, setBrief] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [drafting, setDrafting] = useState(false);
  const [abDrafting, setAbDrafting] = useState(false);
  const [abResult, setAbResult] = useState<AiDraftResult | null>(null);
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [confirmAbDraft, setConfirmAbDraft] = useState(false);

  const [versions, setVersions] = useState<ChapterVersionRow[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState<ChapterVersionRow | null>(null);
  const [restoring, setRestoring] = useState(false);

  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  const onAiDraftRef = useRef(onAiDraft);
  useEffect(() => {
    onAiDraftRef.current = onAiDraft;
  }, [onAiDraft]);
  const stateRef = useRef(onStateChange);
  useEffect(() => {
    stateRef.current = onStateChange;
  }, [onStateChange]);

  const pending = useRef<{ id: string; content: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Switching chapters replaces the local buffer. The pane's tab owns which
  // chapter is open, so an old tab can never show another chapter's prose.
  //
  // The buffer resets when the open chapter changes, not whenever that
  // chapter's stored prose changes: an external update (a save from the
  // agent, a restored version) must not clobber keystrokes the user is
  // still typing. `loadedChapterRef` carries that intent explicitly, so the
  // effect can list its real dependencies without re-running on every
  // content change.
  const loadedChapterRef = useRef<{ id: string | null } | null>(null);
  useEffect(() => {
    if (loadedChapterRef.current?.id === selectedId) return;
    loadedChapterRef.current = { id: selectedId };
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    setContent(selected?.content ?? "");
    setBrief(selected?.brief ?? "");
    setDirty(false);
    setActiveVersion(null);
  }, [selectedId, selected?.brief, selected?.content]);

  useEffect(() => {
    stateRef.current?.({ words: countWords(content), dirty, saving, content });
  }, [content, dirty, saving]);

  // Best-effort flush on unmount: never lose the last keystrokes.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const p = pending.current;
      if (p) {
        pending.current = null;
        void onSaveRef
          .current(p.id, { content: p.content }, { overwrite: true, silent: true })
          .catch(() => undefined);
      }
    },
    []
  );

  const persist = async (patch: { content?: string; brief?: string }) => {
    if (!selected) return null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    setSaving(true);
    try {
      const next = await onSaveRef.current(selected.id, patch, {
        overwrite: true,
        silent: true,
      });
      if (next) {
        setDirty(false);
        if (patch.brief !== undefined) setBrief(next.brief);
      }
      return next;
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (md: string) => {
    if (!selected || isFinal) return;
    setContent(md);
    setDirty(true);
    pending.current = { id: selected.id, content: md };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const p = pending.current;
      if (p) void persist({ content: p.content });
    }, AUTOSAVE_MS);
  };

  const applyDraftContent = async (
    draftText: string,
    wordCount: number,
    mode: "fill" | "append"
  ) => {
    const nextContent =
      mode === "append" && content.trim()
        ? `${content.replace(/\s+$/, "")}\n\n${draftText}`
        : draftText;
    setContent(nextContent);
    setDirty(true);
    const saved = await persist({ content: nextContent });
    if (saved) {
      toast({
        title: `AI draft added (+${formatWordCount(wordCount)} words)`,
        description:
          mode === "append"
            ? "Continuation appended after your existing text."
            : "Chapter draft written. Edit freely — it's yours now.",
      });
    }
  };

  const runAiDraft = async () => {
    if (!selected) return;
    setDrafting(true);
    try {
      const result = await onAiDraftRef.current(selected);
      if (result) await applyDraftContent(result.content, result.wordCount, result.mode);
    } catch (e) {
      toast({
        title: "AI draft failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDrafting(false);
      setConfirmDraft(false);
    }
  };

  const runAbDraft = async () => {
    if (!selected) return;
    setAbDrafting(true);
    try {
      const result = await onAiDraftRef.current(selected, { variants: 2 });
      if (result) {
        if (result.variants && result.variants.length >= 2) {
          setAbResult(result);
          setConfirmAbDraft(false);
        } else {
          await applyDraftContent(result.content, result.wordCount, result.mode);
          setConfirmAbDraft(false);
        }
      }
    } catch (e) {
      toast({
        title: "A/B draft failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAbDrafting(false);
    }
  };

  const pickVariant = async (index: 0 | 1) => {
    const result = abResult;
    setAbResult(null);
    if (!result?.variants?.[index]) return;
    const variant = result.variants[index];
    await applyDraftContent(variant.content, variant.wordCount, result.mode);
  };

  useEffect(() => {
    if (!historyOpen || !selectedChapterId) return;
    let cancelled = false;
    setVersionsLoading(true);
    setVersionsError(null);
    setVersions(null);
    setActiveVersion(null);
    void getChapterVersions(selectedChapterId)
      .then((r) => {
        if (!cancelled) setVersions(r.versions);
      })
      .catch((e) => {
        if (!cancelled) setVersionsError(e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [historyOpen, selectedChapterId]);

  const restoreVersion = async (version: ChapterVersionRow) => {
    if (!selected) return;
    setRestoring(true);
    try {
      const next = await onSaveRef.current(
        selected.id,
        { content: version.content },
        { overwrite: true, silent: true }
      );
      if (next) {
        setContent(next.content);
        setDirty(false);
        onHistoryOpenChange(false);
      }
    } catch (e) {
      toast({
        title: "Restore failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRestoring(false);
    }
  };

  if (!selected) {
    return (
      <p className={TEXT_META}>
        Select a chapter — or add a new one — to start writing.
      </p>
    );
  }

  return (
    <>
      {view === "document" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <RichEditor
            markdown={content}
            onChange={handleChange}
            editable={!isFinal}
            placeholder="Write your chapter here — or click AI Draft to get a grounded first draft."
            minHeight={320}
          />

          {/* Muted section BELOW the prose. The Brief is collapsed by default,
              so it can never sit between the toolbar and the text. The section
              never shrinks and the expanded body scrolls inside itself: the
              brief must be able to grow, but it must never grow INTO the
              editor and push its toolbar around. */}
          <div className="flex shrink-0 flex-col border-t bg-muted/20">
            <div className="flex items-center gap-1 px-4 py-1">
              <button
                type="button"
                onClick={() => setBriefOpen((v) => !v)}
                aria-expanded={briefOpen}
                className="flex items-center gap-1.5 py-0.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ScrollText className="size-3.5" aria-hidden="true" />
                Brief / Outline
                {briefOpen ? (
                  <ChevronUp className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                )}
              </button>
              <span className="flex-1" />
              {!isFinal && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-1.5 text-caption"
                    onClick={() => setConfirmAbDraft(true)}
                    disabled={drafting || abDrafting || saving}
                    aria-label="Generate two AI draft alternatives"
                  >
                    {abDrafting ? (
                      <Spinner size="md" />
                    ) : (
                      <SplitSquareHorizontal className="size-3.5" aria-hidden="true" />
                    )}
                    A/B Draft
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-1.5 text-caption"
                    onClick={() => setConfirmDraft(true)}
                    disabled={drafting || abDrafting || saving}
                  >
                    {drafting ? (
                      <Spinner size="md" />
                    ) : (
                      <Sparkles className="size-3.5" aria-hidden="true" />
                    )}
                    AI Draft
                  </Button>
                </>
              )}
            </div>
            {briefOpen && (
              /* The expanded Brief is a bounded drawer: it scrolls inside itself
                 and can never grow into the editor above it. */
              <div className="max-h-[40vh] overflow-y-auto border-t px-4 py-3">
                <Textarea
                  value={brief}
                  rows={3}
                  readOnly={isFinal}
                  onChange={(e) => {
                    setBrief(e.target.value);
                    setDirty(true);
                  }}
                  onBlur={() => {
                    if (!isFinal && brief !== selected.brief) void persist({ brief });
                  }}
                  placeholder="Outline beats, goals, must-hit moments for this chapter…"
                  className="max-h-[24vh] resize-y bg-background text-sm text-muted-foreground placeholder:text-muted-foreground/70"
                  aria-label="Chapter brief"
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className="nice-scroll min-h-[320px] flex-1 overflow-y-auto px-4 py-3"
          aria-label="Chapter markdown source"
        >
          <pre className="mx-auto max-w-prose whitespace-pre-wrap break-words font-mono text-small leading-[1.85]">
            {content || "Nothing here yet — switch to Document to start this chapter."}
          </pre>
        </div>
      )}

      <ConfirmDialog
        open={confirmDraft}
        onOpenChange={setConfirmDraft}
        title="Generate an AI draft?"
        description={
          selected.content.trim()
            ? `The Novel Writer agent will continue "${selected.title}" from where your text ends. Your existing words stay untouched — the draft is appended below them.`
            : `The Novel Writer agent will write an opening draft for "${selected.title}", grounded in your synopsis, characters, world and outline.`
        }
        confirmLabel="Write draft"
        busy={drafting}
        onConfirm={runAiDraft}
      />
      <ConfirmDialog
        open={confirmAbDraft}
        onOpenChange={setConfirmAbDraft}
        title="Generate two A/B drafts?"
        description={
          selected.content.trim()
            ? `The Novel Writer agent will write two alternative continuations of "${selected.title}". Your text stays untouched — you pick one.`
            : `The Novel Writer agent will write two alternative opening drafts for "${selected.title}" — you pick the one to insert.`
        }
        confirmLabel="Write A/B drafts"
        busy={abDrafting}
        onConfirm={runAbDraft}
      />
      <Dialog
        open={abResult !== null}
        onOpenChange={(v) => {
          if (!v) setAbResult(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pick a draft</DialogTitle>
            <DialogDescription>
              Two grounded alternatives for &quot;{selected.title}&quot;. The one you
              pick is inserted into the editor; the other is discarded.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {abResult?.variants?.slice(0, 2).map((variant, i) => (
              <div key={i} className="flex min-h-0 flex-col rounded-lg border bg-muted/20">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <span className={TEXT_LABEL}>Draft {String.fromCharCode(65 + i)}</span>
                  <span className={TEXT_META}>
                    {formatWordCount(variant.wordCount)} words
                  </span>
                </div>
                <p className="nice-scroll max-h-56 overflow-y-auto whitespace-pre-wrap px-3 py-2 novara-prose-preview font-serif text-foreground/85">
                  {variant.content}
                </p>
                <div className="border-t px-3 py-2">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => void pickVariant(i as 0 | 1)}
                  >
                    Use Draft {String.fromCharCode(65 + i)}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setAbResult(null)}>
            Discard both
          </Button>
        </DialogContent>
      </Dialog>

      {/* Versions table — opened by the pane's one History icon button. */}
      <Dialog open={historyOpen} onOpenChange={onHistoryOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Version history — {selected.title}</DialogTitle>
            <DialogDescription>
              Every save records a draft. Select one to preview it, then
              restore if it is the text you want back.
            </DialogDescription>
          </DialogHeader>
          {versionsLoading ? (
            <div
              className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner size="lg" />
              Loading versions…
            </div>
          ) : versionsError ? (
            <p className="py-4 text-sm text-destructive" role="alert">
              Failed to load versions: {versionsError}
            </p>
          ) : !versions || versions.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No versions yet — every save records one.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="nice-scroll max-h-64 overflow-y-auto rounded-md border">
                {versions.map((version) => {
                  const active = activeVersion?.id === version.id;
                  return (
                    <li
                      key={version.id}
                      className={cn(
                        "flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0",
                        active && "bg-accent/40"
                      )}
                    >
                      <span className="font-mono text-xs">Draft {version.draftNo}</span>
                      <span className={cn("shrink-0", TEXT_META)}>
                        {formatWordCount(version.wordCount)} words
                      </span>
                      <Badge
                        variant={
                          version.createdBy === "author"
                            ? "outline"
                            : version.createdBy === "agent"
                              ? "default"
                              : "secondary"
                        }
                        className="text-caption"
                      >
                        {version.createdBy}
                      </Badge>
                      <span className={cn("ml-auto truncate", TEXT_META)}>
                        {new Date(version.createdAt).toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setActiveVersion(active ? null : version)}
                        aria-pressed={active}
                      >
                        View
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {activeVersion && (
                <div className="rounded-md border">
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Draft {activeVersion.draftNo} preview
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void restoreVersion(activeVersion)}
                      disabled={restoring || isFinal}
                      title={isFinal ? "Reopen to edit before restoring" : undefined}
                    >
                      {restoring ? (
                        <Spinner size="lg" />
                      ) : (
                        <RotateCcw className="size-4" aria-hidden="true" />
                      )}
                      Restore this draft
                    </Button>
                  </div>
                  <div className="nice-scroll max-h-64 overflow-y-auto px-3 py-2">
                    <MarkdownDocument content={activeVersion.content} className="text-sm" />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
