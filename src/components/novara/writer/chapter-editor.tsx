"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Lock,
  PenLine,
  Plus,
  RotateCcw,
  ScrollText,
  Sparkles,
  SplitSquareHorizontal,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getChapterVersions, type ChapterVersionRow } from "@/lib/novara/api";
import type { AiDraftResult, ChapterDTO, ChapterStatus } from "@/lib/novara/types";
import { countWords, formatWordCount } from "@/lib/novara/words";
import { cn } from "@/lib/utils";
import { ChapterStatusBadge, ConfirmDialog, PinButton } from "./ui-bits";
import { MarkdownDocument } from "./markdown-document";

/** Editor surface: raw writing vs rendered document window. */
type ChapterView = "write" | "preview";

interface ChapterEditorProps {
  chapters: ChapterDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => Promise<void>;
  onDelete: (chapter: ChapterDTO) => Promise<void>;
  onSave: (
    id: string,
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string }
  ) => Promise<ChapterDTO | null>;
  onAiDraft: (
    chapter: ChapterDTO,
    opts?: { variants?: number }
  ) => Promise<AiDraftResult | null>;
  /**
   * Workbench mode: hide the built-in chapter list (the left asset tree
   * provides navigation) and render the editor full width.
   */
  hideList?: boolean;
}

export function ChapterEditor({
  chapters,
  selectedId,
  onSelect,
  onAdd,
  onDelete,
  onSave,
  onAiDraft,
  hideList = false,
}: ChapterEditorProps) {
  const { toast } = useToast();
  const selected = chapters.find((c) => c.id === selectedId) ?? null;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<ChapterStatus>("draft");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [abDrafting, setAbDrafting] = useState(false);
  const [abResult, setAbResult] = useState<AiDraftResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [confirmAbDraft, setConfirmAbDraft] = useState(false);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<ChapterView>("preview");
  const [brief, setBrief] = useState("");
  const [briefOpen, setBriefOpen] = useState(true);
  const [reopening, setReopening] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<ChapterVersionRow[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState<ChapterVersionRow | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Sync local editor state when a different chapter is selected.
  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setContent(selected.content);
      setStatus(selected.status);
      setBrief(selected.brief);
      setDirty(false);
      // Opening a file reads like opening a document — chapters with content
      // land in the rendered preview; empty ones go straight to writing.
      setView(selected.content.trim() ? "preview" : "write");
    }
  }, [selectedId]);

  const isFinal = selected?.status === "final";

  const save = async (patch?: {
    title?: string;
    content?: string;
    status?: ChapterStatus;
    brief?: string;
  }) => {
    if (!selected) return null;
    const payload = patch ?? {
      title: title.trim() || selected.title,
      content,
      status,
      brief,
    };
    setSaving(true);
    try {
      const next = await onSave(selected.id, payload);
      if (next) {
        setTitle(next.title);
        setContent(next.content);
        setStatus(next.status);
        setBrief(next.brief);
        setDirty(false);
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

  /** Applies a draft (single or A/B-picked) into the editor and saves it. */
  const applyDraftContent = async (draftText: string, wordCount: number, mode: "fill" | "append") => {
    const nextContent =
      mode === "append" && content.trim()
        ? `${content.replace(/\s+$/, "")}\n\n${draftText}`
        : draftText;
    setContent(nextContent);
    setDirty(true);
    const saved = await save({ content: nextContent });
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
      const result = await onAiDraft(selected);
      if (result) {
        await applyDraftContent(result.content, result.wordCount, result.mode);
      }
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
      const result = await onAiDraft(selected, { variants: 2 });
      if (result) {
        if (result.variants && result.variants.length >= 2) {
          setAbResult(result);
          setConfirmAbDraft(false);
        } else {
          // Backend returned a single draft — fall through with it.
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
    try {
      await applyDraftContent(variant.content, variant.wordCount, result.mode);
    } catch (e) {
      toast({
        title: "AI draft failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const addChapter = async () => {
    setAdding(true);
    try {
      await onAdd();
    } finally {
      setAdding(false);
    }
  };

  /** Switching to the document view autosaves, like clicking away does. */
  const switchView = (next: ChapterView) => {
    if (next === view) return;
    if (next === "preview" && dirty && !saving) void save();
    setView(next);
  };

  /** Status-only demotion — the server allows this without confirmation. */
  const reopenChapter = async () => {
    setReopening(true);
    try {
      await save({ status: "revised" });
    } finally {
      setReopening(false);
    }
  };

  const openHistory = async () => {
    if (!selected) return;
    setHistoryOpen(true);
    setVersionsLoading(true);
    setVersionsError(null);
    setVersions(null);
    setActiveVersion(null);
    try {
      const result = await getChapterVersions(selected.id);
      setVersions(result.versions);
    } catch (e) {
      setVersionsError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setVersionsLoading(false);
    }
  };

  /** Restores a historical draft through the normal save flow (parent gates 409s). */
  const restoreVersion = async (version: ChapterVersionRow) => {
    if (!selected) return;
    setRestoring(true);
    try {
      const next = await onSave(selected.id, { content: version.content });
      if (next) {
        setTitle(next.title);
        setContent(next.content);
        setStatus(next.status);
        setBrief(next.brief);
        setDirty(false);
        setHistoryOpen(false);
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

  if (hideList) {
    // Workbench artifact view — editor only, full width.
    return (
      <>
        {renderEditor()}
        {confirmDelete && (
          <ConfirmDialog
            open
            onOpenChange={setConfirmDelete}
            title="Delete this chapter?"
            description={
              selected
                ? `“${selected.title}” and its ${formatWordCount(selected.wordCount)} words will be permanently deleted. Later chapters keep their order.`
                : ""
            }
            busy={false}
            onConfirm={async () => {
              setConfirmDelete(false);
              if (selected) await onDelete(selected);
            }}
          />
        )}
        <ConfirmDialog
          open={confirmDraft}
          onOpenChange={setConfirmDraft}
          title="Generate an AI draft?"
          description={
            selected && selected.content.trim()
              ? `The Novel Writer agent will continue “${selected.title}” from where your text ends. Your existing words stay untouched — the draft is appended below them.`
              : `The Novel Writer agent will write an opening draft for “${selected?.title ?? ""}”, grounded in your synopsis, characters, world and outline.`
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
            selected && selected.content.trim()
              ? `The Novel Writer agent will write two alternative continuations of “${selected.title}”. Your text stays untouched — you pick one.`
              : `The Novel Writer agent will write two alternative opening drafts for “${selected?.title ?? ""}” — you pick the one to insert.`
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
                Two grounded alternatives for “{selected?.title ?? ""}”. The one
                you pick is inserted into the editor; the other is discarded.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              {abResult?.variants?.slice(0, 2).map((variant, i) => (
                <div
                  key={i}
                  className="flex min-h-0 flex-col rounded-lg border bg-muted/20"
                >
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-sm font-medium">Draft {String.fromCharCode(65 + i)}</span>
                    <span className="text-xs text-muted-foreground">
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
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAbResult(null)}>
                Discard both
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      {/* Chapter list */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">
            Chapters
            <span className="ml-1.5 text-muted-foreground">
              ({chapters.length})
            </span>
          </h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={addChapter}
            disabled={adding}
            aria-label="Add chapter"
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>
        <div className="nice-scroll max-h-64 overflow-y-auto p-2 lg:max-h-[560px]">
          {chapters.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No chapters yet. Add the first one.
            </p>
          ) : (
            <ul className="space-y-1">
              {chapters.map((ch) => (
                <li key={ch.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (dirty && selected && ch.id !== selected.id) {
                        // Fire-and-forget autosave when switching away dirty
                        void save();
                      }
                      onSelect(ch.id);
                    }}
                    className={cn(
                      "w-full rounded-md px-3 py-2.5 pr-9 text-left transition-colors",
                      ch.id === selectedId
                        ? "bg-accent"
                        : "hover:bg-accent/60"
                    )}
                    aria-current={ch.id === selectedId ? "true" : undefined}
                  >
                    <span className="block text-sm font-medium">
                      <span className="mr-2 text-xs text-muted-foreground">
                        {String(ch.index).padStart(2, "0")}
                      </span>
                      {ch.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      {formatWordCount(ch.wordCount)} words
                      {ch.status !== "draft" && (
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            ch.status === "final"
                              ? "bg-emerald-600"
                              : "bg-amber-500"
                          )}
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${ch.title}`}
                    onClick={() => setConfirmDelete(true)}
                    className="absolute right-2 top-2.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Editor */}
      {renderEditor()}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this chapter?"
        description={
          selected
            ? `“${selected.title}” and its ${formatWordCount(selected.wordCount)} words will be permanently deleted. Later chapters keep their order.`
            : ""
        }
        busy={false}
        onConfirm={async () => {
          setConfirmDelete(false);
          if (selected) await onDelete(selected);
        }}
      />

      <ConfirmDialog
        open={confirmDraft}
        onOpenChange={setConfirmDraft}
        title="Generate an AI draft?"
        description={
          selected && selected.content.trim()
            ? `The Novel Writer agent will continue “${selected.title}” from where your text ends. Your existing words stay untouched — the draft is appended below them.`
            : `The Novel Writer agent will write an opening draft for “${selected?.title ?? ""}”, grounded in your synopsis, characters, world and outline.`
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
          selected && selected.content.trim()
            ? `The Novel Writer agent will write two alternative continuations of “${selected.title}”. Your text stays untouched — you pick one.`
            : `The Novel Writer agent will write two alternative opening drafts for “${selected?.title ?? ""}” — you pick the one to insert.`
        }
        confirmLabel="Write A/B drafts"
        busy={abDrafting}
        onConfirm={runAbDraft}
      />

      {/* A/B pick dialog — nothing touches the chapter until you choose */}
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
              Two grounded alternatives for “{selected?.title ?? ""}”. The one
              you pick is inserted into the editor; the other is discarded.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {abResult?.variants?.slice(0, 2).map((variant, i) => (
              <div
                key={i}
                className="flex min-h-0 flex-col rounded-lg border bg-muted/20"
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <span className="text-sm font-medium">Draft {String.fromCharCode(65 + i)}</span>
                  <span className="text-xs text-muted-foreground">
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
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAbResult(null)}>
              Discard both
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function renderEditor() {
    return (
      <div className="rounded-lg border bg-card">
        {!selected ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Select a chapter — or add a new one — to start writing.
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Header — inputs while writing, document title while reading */}
            <div className="flex flex-col gap-2 border-b p-4 sm:flex-row">
              {view === "write" ? (
                <>
                  <Input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setDirty(true);
                    }}
                    className="flex-1 font-medium"
                    aria-label="Chapter title"
                  />
                  <Select
                    value={status}
                    disabled={isFinal}
                    onValueChange={(v) => {
                      setStatus(v as ChapterStatus);
                      setDirty(true);
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-32" aria-label="Chapter status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="revised">Revised</SelectItem>
                      <SelectItem value="final">Final</SelectItem>
                    </SelectContent>
                  </Select>
                  {isFinal && (
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        Final — locked
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void reopenChapter()}
                        disabled={reopening}
                        aria-label="Reopen chapter for editing"
                      >
                        {reopening ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        )}
                        Reopen
                      </Button>
                    </span>
                  )}
                </>
              ) : (
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <h2 className="min-w-0 truncate font-display text-lg font-bold leading-tight">
                    {title || selected.title}
                  </h2>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Chapter {selected.index}
                  </span>
                </div>
              )}
            </div>

            {/* Toolbar — view toggle always; writing tools in write mode */}
            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              <span
                className="flex overflow-hidden rounded-md border bg-background"
                role="group"
                aria-label="Editor view"
              >
                <button
                  type="button"
                  onClick={() => switchView("write")}
                  aria-pressed={view === "write"}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1 transition-colors",
                    view === "write"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                  Write
                </button>
                <button
                  type="button"
                  onClick={() => switchView("preview")}
                  aria-pressed={view === "preview"}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1 transition-colors",
                    view === "preview"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  Preview
                </button>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void openHistory()}
                disabled={drafting || abDrafting || saving}
              >
                <History className="h-4 w-4" aria-hidden="true" />
                History
              </Button>
              <PinButton
                novelId={selected.novelId}
                target={{
                  type: "chapter",
                  id: selected.id,
                  label: `第${selected.index}章 ${selected.title}`,
                }}
                label="Pin to chat"
              />
              <span>{formatWordCount(countWords(content))} words</span>
              {dirty && view === "write" && (
                <span className="flex items-center gap-1 text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                  Unsaved changes
                </span>
              )}
              {view === "write" && (
                <span className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmAbDraft(true)}
                    disabled={drafting || abDrafting || saving}
                    aria-label="Generate two AI draft alternatives"
                  >
                    {abDrafting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <SplitSquareHorizontal className="h-4 w-4" aria-hidden="true" />
                    )}
                    A/B Draft
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmDraft(true)}
                    disabled={drafting || abDrafting || saving}
                  >
                    {drafting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                    )}
                    AI Draft
                    <span className="sr-only">(experimental)</span>
                  </Button>
                  <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>
                    {saving && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    Save
                  </Button>
                </span>
              )}
            </div>

            {/* Body — textarea while writing, document window while reading */}
            {view === "write" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <button
                  type="button"
                  onClick={() => setBriefOpen((v) => !v)}
                  aria-expanded={briefOpen}
                  className="flex w-full items-center gap-1.5 border-b bg-muted/20 px-4 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                  Brief / 细纲
                  {briefOpen ? (
                    <ChevronUp className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
                {briefOpen && (
                  <div className="border-b px-4 py-3">
                    <Textarea
                      value={brief}
                      rows={3}
                      onChange={(e) => {
                        setBrief(e.target.value);
                        setDirty(true);
                      }}
                      onBlur={() => {
                        if (dirty && !saving) void save();
                      }}
                      placeholder="Outline beats, goals, must-hit moments for this chapter…"
                      className="resize-y bg-muted/40 text-sm text-muted-foreground placeholder:text-muted-foreground/70"
                      aria-label="Chapter brief"
                    />
                  </div>
                )}
                <Textarea
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setDirty(true);
                  }}
                  onBlur={() => {
                    if (dirty && !saving) void save();
                  }}
                  placeholder="Write your chapter here — or click AI Draft to get a grounded first draft."
                  className="nice-scroll min-h-[320px] flex-1 resize-y rounded-none border-0 novara-prose-editor font-serif shadow-none focus-visible:ring-0 lg:min-h-[480px]"
                  aria-label="Chapter content"
                />
              </div>
            ) : (
              <div
                className="nice-scroll max-h-[68vh] min-h-[320px] flex-1 overflow-y-auto px-6 py-5 lg:max-h-none lg:min-h-[480px]"
                aria-label="Chapter document preview"
              >
                {brief.trim() ? (
                  <div className="mx-auto mb-6 max-w-prose rounded-md border bg-muted/30 px-4 py-3">
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
                      Brief / 细纲
                    </p>
                    <MarkdownDocument
                      content={brief}
                      className="text-sm text-muted-foreground"
                    />
                  </div>
                ) : null}
                {content.trim() ? (
                  <MarkdownDocument
                    content={content}
                    className="mx-auto max-w-prose font-display"
                  />
                ) : (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    Nothing to preview yet — switch to Write to start this chapter.
                  </p>
                )}
              </div>
            )}
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <ChapterStatusBadge status={status} />
              <span>
                {view === "write"
                  ? "Autosaves when you click away"
                  : "Open in Write to edit"}{" "}
                · Chapter {selected.index}
              </span>
            </div>
          </div>
        )}
        {renderHistoryDialog()}
      </div>
    );
  }

  function renderHistoryDialog() {
    return (
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Version history — {selected?.title ?? ""}</DialogTitle>
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
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
                      <span className="font-mono text-xs">
                        稿{version.draftNo}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
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
                        className="text-[11px]"
                      >
                        {version.createdBy}
                      </Badge>
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {new Date(version.createdAt).toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setActiveVersion(active ? null : version)
                        }
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
                      稿{activeVersion.draftNo} preview
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void restoreVersion(activeVersion)}
                      disabled={restoring}
                    >
                      {restoring ? (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      )}
                      Restore this draft
                    </Button>
                  </div>
                  <div className="nice-scroll max-h-64 overflow-y-auto px-3 py-2">
                    <MarkdownDocument
                      content={activeVersion.content}
                      className="text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }
}
