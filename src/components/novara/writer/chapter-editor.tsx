"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { AiDraftResult, ChapterDTO, ChapterStatus } from "@/lib/novara/types";
import { countWords, formatWordCount } from "@/lib/novara/words";
import { cn } from "@/lib/utils";
import { ChapterStatusBadge, ConfirmDialog } from "./ui-bits";

interface ChapterEditorProps {
  chapters: ChapterDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => Promise<void>;
  onDelete: (chapter: ChapterDTO) => Promise<void>;
  onSave: (
    id: string,
    patch: { title?: string; content?: string; status?: ChapterStatus }
  ) => Promise<ChapterDTO | null>;
  onAiDraft: (chapter: ChapterDTO) => Promise<AiDraftResult | null>;
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [adding, setAdding] = useState(false);

  // Sync local editor state when a different chapter is selected.
  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setContent(selected.content);
      setStatus(selected.status);
      setDirty(false);
    }
  }, [selectedId]);

  const save = async (patch?: {
    title?: string;
    content?: string;
    status?: ChapterStatus;
  }) => {
    if (!selected) return null;
    const payload = patch ?? {
      title: title.trim() || selected.title,
      content,
      status,
    };
    setSaving(true);
    try {
      const next = await onSave(selected.id, payload);
      if (next) {
        setTitle(next.title);
        setContent(next.content);
        setStatus(next.status);
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

  const runAiDraft = async () => {
    if (!selected) return;
    setDrafting(true);
    try {
      const result = await onAiDraft(selected);
      if (result) {
        const nextContent =
          result.mode === "append" && content.trim()
            ? `${content.replace(/\s+$/, "")}\n\n${result.content}`
            : result.content;
        setContent(nextContent);
        setDirty(true);
        const saved = await save({ content: nextContent });
        if (saved) {
          toast({
            title: `AI draft added (+${formatWordCount(result.wordCount)} words)`,
            description:
              result.mode === "append"
                ? "Continuation appended after your existing text."
                : "Chapter draft written. Edit freely — it's yours now.",
          });
        }
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

  const addChapter = async () => {
    setAdding(true);
    try {
      await onAdd();
    } finally {
      setAdding(false);
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
            <div className="flex flex-col gap-2 border-b p-4 sm:flex-row">
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
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              <span>{formatWordCount(countWords(content))} words</span>
              {dirty && (
                <span className="flex items-center gap-1 text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                  Unsaved changes
                </span>
              )}
              <span className="ml-auto flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDraft(true)}
                  disabled={drafting || saving}
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
            </div>

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
              className="nice-scroll min-h-[320px] flex-1 resize-y rounded-none border-0 font-serif text-[15px] leading-7 shadow-none focus-visible:ring-0 lg:min-h-[480px]"
              aria-label="Chapter content"
            />
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <ChapterStatusBadge status={status} />
              <span>Autosaves when you click away · Chapter {selected.index}</span>
            </div>
          </div>
        )}
      </div>
    );
  }
}
