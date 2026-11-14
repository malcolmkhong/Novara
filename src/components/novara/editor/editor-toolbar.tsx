"use client";

import { useState } from "react";
import { Bold, Italic, TextQuote, WandSparkles } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { applyMagic, type MagicAction } from "@/lib/novara/editor-magic";
import { markdownToEditorContent } from "@/lib/novara/editor-schema";
import { cn } from "@/lib/utils";
import { TEXT_MICRO } from "@/components/novara/styles";

export interface EditorActiveState {
  bold: boolean;
  italic: boolean;
  blockquote: boolean;
}

interface EditorToolbarProps {
  editor: Editor | null;
  active: EditorActiveState;
  hasSelection: boolean;
  editable: boolean;
}

const MAGIC_ITEMS: { action: MagicAction; label: string; hint: string }[] = [
  {
    action: "quotes",
    label: "Fix quotes and dashes",
    hint: "straight quotes -> curly, -- -> em dash, ... -> ellipsis",
  },
  {
    action: "spacing",
    label: "Clean spacing",
    hint: "double spaces, space before punctuation",
  },
  {
    action: "paragraphs",
    label: "Split into paragraphs",
    hint: "wall of text -> paragraphs at sentence bounds",
  },
  {
    action: "dialogue",
    label: "Wrap as dialogue",
    hint: "selection -> quoted line with an em dash",
  },
];

/**
 * Bold / Italic / Blockquote / Magic. The Magic actions are selection-only
 * and each is ONE transaction (hence one undo step); with an empty selection
 * they are disabled rather than silently rewriting the whole chapter.
 */
export function EditorToolbar({
  editor,
  active,
  hasSelection,
  editable,
}: EditorToolbarProps) {
  const [magicOpen, setMagicOpen] = useState(false);
  const disabled = !editor || !editable;

  const runMagic = (action: MagicAction) => {
    if (disabled || !editor || editor.state.selection.empty) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, "\n", "\n\n");
    if (!selected.trim()) return;
    const replaced = applyMagic(action, selected);
    if (!replaced) return;
    const content = markdownToEditorContent(replaced).content ?? [];
    // One chain -> one ProseMirror transaction -> one undo step.
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to }, content, { updateSelection: true })
      .run();
    setMagicOpen(false);
  };

  const tool = (
    key: keyof EditorActiveState,
    label: string,
    Icon: typeof Bold,
    run: () => void
  ) => (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn(
        "h-6 w-6 rounded-sm p-0 text-caption",
        active[key] && "bg-muted text-foreground"
      )}
      aria-label={label}
      aria-pressed={active[key]}
      title={label}
      disabled={disabled}
      onClick={run}
    >
      <Icon className="size-3" aria-hidden="true" />
    </Button>
  );

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted/20 px-3 text-caption"
      role="toolbar"
      aria-label="Chapter formatting"
    >
      {tool("bold", "Bold", Bold, () =>
        editor?.chain().focus().toggleBold().run()
      )}
      {tool("italic", "Italic", Italic, () =>
        editor?.chain().focus().toggleItalic().run()
      )}
      {tool("blockquote", "Blockquote", TextQuote, () =>
        editor?.chain().focus().toggleBlockquote().run()
      )}
      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
      <Popover open={magicOpen} onOpenChange={setMagicOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 rounded-sm px-2 text-caption"
            disabled={disabled}
            aria-label="Magic transforms"
          >
            <WandSparkles className="size-3" aria-hidden="true" />
            Magic
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="w-64 p-1.5">
          <p className="px-2 py-1 text-caption font-medium text-muted-foreground">
            Selection only · one undo step
          </p>
          {MAGIC_ITEMS.map((item) => (
            <button
              key={item.action}
              type="button"
              disabled={!hasSelection}
              onClick={() => runMagic(item.action)}
              className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-caption transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="font-medium">{item.label}</span>
              <span className={TEXT_MICRO}>{item.hint}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {!hasSelection && (
        <span className={TEXT_MICRO}>
          Select text to use Magic
        </span>
      )}
    </div>
  );
}
