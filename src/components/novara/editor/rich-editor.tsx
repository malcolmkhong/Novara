"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  editorExtensions,
  editorSchema,
  markdownToEditorContent,
  serializeMarkdown,
} from "@/lib/novara/editor-schema";
import { EditorToolbar, type EditorActiveState } from "./editor-toolbar";

interface RichEditorProps {
  markdown: string;
  onChange(md: string): void;
  editable: boolean;
  placeholder?: string;
  minHeight?: number;
}

/**
 * Word / Google Docs paste -> paragraphs, strong, em, links, blockquote ONLY.
 * Everything else (tables as structure, images, scripts, styles, spans with
 * style-based formatting beyond bold/italic, arbitrary attributes) is
 * stripped. The HTML string is rebuilt from scratch: no pasted markup ever
 * reaches the page and no dangerouslySetInnerHTML is used.
 */
const DROPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IMG",
  "SVG",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "VIDEO",
  "AUDIO",
  "CANVAS",
  "INPUT",
  "BUTTON",
  "SELECT",
  "TEXTAREA",
  "META",
  "LINK",
  "HEAD",
  "FORM",
  "NOSCRIPT",
]);

const BLOCK_CONTAINERS = new Set([
  "DIV",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "BODY",
  "UL",
  "OL",
  "TABLE",
  "TBODY",
  "THEAD",
  "TFOOT",
  "TR",
  "BLOCKQUOTE",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "CENTER",
]);

const PARAGRAPH_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "TD",
  "TH",
  "PRE",
  "FIGCAPTION",
  "DL",
  "DT",
  "DD",
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isBold(element: Element): boolean {
  const weight = (element.getAttribute("style") ?? "").match(/font-weight\s*:\s*(\d+|bold)/i)?.[1];
  return weight === "bold" || (weight !== undefined && Number(weight) >= 600);
}

function isItalic(element: Element): boolean {
  return /font-style\s*:\s*(italic|oblique)/i.test(element.getAttribute("style") ?? "");
}

/** Inline content of ONE paragraph. Unknown tags lose their markup, not their text. */
function inlineHtml(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  const tag = element.tagName.toUpperCase();
  if (DROPPED_TAGS.has(tag)) return "";
  if (tag === "BR") return "<br>";
  const inner = Array.from(element.childNodes).map(inlineHtml).join("");
  if (tag === "STRONG" || tag === "B" || isBold(element)) {
    return `<strong>${inner}</strong>`;
  }
  if (tag === "EM" || tag === "I" || isItalic(element)) {
    return `<em>${inner}</em>`;
  }
  if (tag === "A") {
    const href = element.getAttribute("href") ?? "";
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(href)) return inner;
    return `<a href="${escapeHtml(href)}">${inner}</a>`;
  }
  return inner;
}

function pushBlock(out: string[], inner: string, quoted: boolean): void {
  if (!inner.trim()) return;
  const paragraph = `<p>${inner}</p>`;
  out.push(quoted ? `<blockquote>${paragraph}</blockquote>` : paragraph);
}

function collectBlocks(node: Node, out: string[], quoted: boolean): void {
  if (node.nodeType === Node.TEXT_NODE) {
    pushBlock(out, inlineHtml(node), quoted);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  const tag = element.tagName.toUpperCase();
  if (DROPPED_TAGS.has(tag)) return;

  const nextQuoted = quoted || tag === "BLOCKQUOTE";
  const children = Array.from(element.childNodes);
  const hasBlockChild = Array.from(element.children).some((child) => {
    const childTag = child.tagName.toUpperCase();
    return BLOCK_CONTAINERS.has(childTag) || PARAGRAPH_TAGS.has(childTag) || childTag === "BLOCKQUOTE";
  });

  if (BLOCK_CONTAINERS.has(tag) || tag === "BLOCKQUOTE" || hasBlockChild) {
    children.forEach((child) => collectBlocks(child, out, nextQuoted));
    return;
  }
  pushBlock(out, children.map(inlineHtml).join(""), nextQuoted);
}

export function sanitizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: string[] = [];
  Array.from(doc.body.childNodes).forEach((child) => collectBlocks(child, blocks, false));
  return blocks.join("");
}

const EMPTY_ACTIVE: EditorActiveState = {
  bold: false,
  italic: false,
  blockquote: false,
};

export function RichEditor({
  markdown,
  onChange,
  editable,
  placeholder,
  minHeight = 320,
}: RichEditorProps) {
  const onChangeRef = useRef(onChange);
  // Refs are written in an effect, never during render (react-hooks/refs).
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const externalMarkdown = useRef(markdown);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState<EditorActiveState>(EMPTY_ACTIVE);
  const [hasSelection, setHasSelection] = useState(false);

  const emit = (instance: Editor) => {
    const next = serializeMarkdown(instance.state.doc);
    // Keep the prop-sync effect from resetting the editor on our own echo.
    externalMarkdown.current = next;
    onChangeRef.current(next);
  };

  const syncActive = (instance: Editor) => {
    const next: EditorActiveState = {
      bold: instance.isActive("bold"),
      italic: instance.isActive("italic"),
      blockquote: instance.isActive("blockquote"),
    };
    setActive((prev) =>
      prev.bold === next.bold &&
      prev.italic === next.italic &&
      prev.blockquote === next.blockquote
        ? prev
        : next
    );
    setHasSelection(!instance.state.selection.empty);
  };

  const editor = useEditor({
    // Next.js renders client components on the server; TipTap must not create
    // a DOM editor until the browser has mounted.
    immediatelyRender: false,
    extensions: editorExtensions,
    schemaSpec: editorSchema.spec,
    editable,
    content: markdownToEditorContent(markdown),
    editorProps: {
      transformPastedHTML: (html) => sanitizePastedHtml(html),
      attributes: {
        class: "novara-editor-content min-h-full outline-none",
        "aria-label": "Chapter content",
      },
    },
    onCreate: ({ editor: instance }) => syncActive(instance),
    onUpdate: ({ editor: instance }) => {
      syncActive(instance);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        emit(instance);
      }, 150);
    },
    onSelectionUpdate: ({ editor: instance }) => syncActive(instance),
    onBlur: ({ editor: instance }) => {
      // Flush the pending debounce so Save never reads a stale document.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        emit(instance);
      }
    },
  });

  // An external markdown change (switching chapters, a save response, a
  // restored version) replaces the document without emitting an edit.
  useEffect(() => {
    if (!editor || markdown === externalMarkdown.current) return;
    externalMarkdown.current = markdown;
    editor.commands.setContent(markdownToEditorContent(markdown), {
      emitUpdate: false,
    });
  }, [editor, markdown]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return (
    // min-h-9 (36px) is the floor: the toolbar is h-8 (32px) and shrink-0, so
    // the editor box can never be smaller than its own toolbar. Without that
    // floor a squeezed editor would let the toolbar paint over whatever sits
    // below it (the expanded Brief section).
    <div className="flex min-h-9 flex-1 flex-col">
      {editable && (
        <EditorToolbar
          editor={editor}
          active={active}
          hasSelection={hasSelection}
          editable={editable}
        />
      )}
      <div className="relative nice-scroll min-h-0 flex-1 overflow-y-auto">
        {editor?.isEmpty && placeholder && (
          <p className="pointer-events-none absolute left-4 top-3 z-10 text-sm text-muted-foreground">
            {placeholder}
          </p>
        )}
        <div style={{ minHeight }}>
          <EditorContent
            editor={editor}
            className="novara-prose novara-prose-editor min-h-full px-4 py-3"
          />
        </div>
      </div>
    </div>
  );
}
