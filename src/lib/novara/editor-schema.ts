/**
 * STEP 78 - the one authoring schema for Novara's rich-text editor.
 *
 * Markdown remains the source of truth. This module owns the single
 * ProseMirror schema and the markdown parser/serializer pair that convert
 * markdown <-> a ProseMirror document. The browser editor
 * (src/components/novara/editor/rich-editor.tsx) and the round-trip gate
 * (scripts/check-editor-roundtrip.ts) both import it, so the gate proves
 * the schema the app actually runs.
 *
 * Node set (v1): doc, paragraph, heading (levels 1-3), bulletList,
 * orderedList, listItem, blockquote, horizontalRule, hardBreak, text.
 * Marks: bold, italic, link. TipTap names nodes in camelCase;
 * prosemirror-markdown's token/serializer vocabulary is snake_case, so the
 * two tables below ARE that mapping. There are deliberately NO tables,
 * NO images, NO code blocks and NO inline code in v1.
 *
 * Callers never touch DOM APIs at import time: the parse/serialize pair is
 * pure and therefore usable from a Node script.
 */
import { Extension, getSchema, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  defaultMarkdownParser,
  MarkdownParser,
  MarkdownSerializer,
  type MarkdownSerializerState,
  type ParseSpec,
} from "prosemirror-markdown";

/** Ctrl/Cmd+B and Ctrl/Cmd+I are bound explicitly, not left to the browser. */
const editorShortcuts = Extension.create({
  name: "novaraEditorShortcuts",
  addKeyboardShortcuts() {
    return {
      "Mod-b": () => this.editor.chain().focus().toggleBold().run(),
      "Mod-i": () => this.editor.chain().focus().toggleItalic().run(),
    };
  },
});

/** The extensions ARE the schema definition. Both consumers use this array. */
export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    code: false,
    codeBlock: false,
    strike: false,
    underline: false,
    link: {
      autolink: false,
      openOnClick: false,
      HTMLAttributes: { rel: "noopener noreferrer" },
    },
  }),
  editorShortcuts,
];

/** The exact ProseMirror schema the editor is created with (schemaSpec). */
export const editorSchema = getSchema(editorExtensions);

/**
 * markdown-it token name -> schema node/mark name.
 * Tokens outside the v1 node set are ignored, never partially parsed.
 */
const PARSE_SPECS: Record<string, ParseSpec> = {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "listItem" },
  bullet_list: { block: "bulletList" },
  ordered_list: {
    block: "orderedList",
    getAttrs: (token) => ({ start: Number(token.attrGet("start")) || 1 }),
  },
  heading: { block: "heading", getAttrs: (token) => ({ level: Number(token.tag.slice(1)) }) },
  hr: { node: "horizontalRule" },
  hardbreak: { node: "hardBreak" },
  em: { mark: "italic" },
  strong: { mark: "bold" },
  link: {
    mark: "link",
    getAttrs: (token) => ({
      href: token.attrGet("href"),
      title: token.attrGet("title") || null,
    }),
  },
  // Deliberately outside v1: images, code, raw HTML. Ignore, do not render.
  image: { ignore: true, noCloseToken: true },
  code_inline: { ignore: true, noCloseToken: true },
  code_block: { ignore: true, noCloseToken: true },
  fence: { ignore: true, noCloseToken: true },
  html_inline: { ignore: true, noCloseToken: true },
  html_block: { ignore: true, noCloseToken: true },
};

/** CommonMark's softbreak is a real newline in the stored markdown. */
interface SoftbreakParseState {
  addText(text: string): void;
}

const markdownParser = new MarkdownParser(
  editorSchema,
  defaultMarkdownParser.tokenizer,
  PARSE_SPECS
);

// prosemirror-markdown's tokenHandlers() installs a softbreak -> " " handler
// by default. tokenHandlers is a plain instance object (the .d.ts omits it),
// so override it through a narrow cast. Without this, real chapters with a
// single newline inside a paragraph lose that byte on every round-trip.
(
  markdownParser as unknown as {
    tokenHandlers: Record<string, (state: SoftbreakParseState) => void>;
  }
).tokenHandlers.softbreak = (state) => state.addText("\n");

type NodeSpec = (
  state: MarkdownSerializerState,
  node: ProseMirrorNode,
  parent: ProseMirrorNode,
  index: number
) => void;

const NODE_SPECS: Record<string, NodeSpec> = {
  blockquote(state, node) {
    state.wrapBlock("> ", null, node, () => state.renderContent(node));
  },
  heading(state, node) {
    state.write(state.repeat("#", Number(node.attrs.level) || 1) + " ");
    state.renderInline(node, false);
    state.closeBlock(node);
  },
  horizontalRule(state, node) {
    state.write("---");
    state.closeBlock(node);
  },
  bulletList(state, node) {
    state.renderList(node, "  ", () => "* ");
  },
  orderedList(state, node) {
    const start = Number(node.attrs.start) || 1;
    const maxWidth = String(start + node.childCount - 1).length;
    state.renderList(node, state.repeat(" ", maxWidth + 2), (index) => {
      const number = String(start + index);
      return state.repeat(" ", maxWidth - number.length) + number + ". ";
    });
  },
  listItem(state, node) {
    state.renderContent(node);
  },
  paragraph(state, node) {
    state.renderInline(node);
    state.closeBlock(node);
  },
  hardBreak(state, node, parent, index) {
    for (let i = index + 1; i < parent.childCount; i += 1) {
      if (parent.child(i).type !== node.type) {
        state.write("\\\n");
        return;
      }
    }
  },
  text(state, node) {
    state.text(node.text ?? "");
  },
};

const MARK_SPECS = {
  bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
  italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
  link: {
    open: "[",
    close: (_state: MarkdownSerializerState, mark: { attrs: Record<string, unknown> }) => {
      const href = String(mark.attrs.href ?? "");
      const title = mark.attrs.title
        ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"`
        : "";
      return `](${href}${title})`;
    },
    mixable: true,
  },
};

const markdownSerializer = new MarkdownSerializer(NODE_SPECS, MARK_SPECS, {
  // The schema's hard break node is camelCase, not the default "hard_break".
  hardBreakNodeName: "hardBreak",
});

/** Parse stored markdown into a document of editorSchema. */
export function parseMarkdown(markdown: string): ProseMirrorNode {
  return markdownParser.parse(markdown);
}

/** Serialize a document of editorSchema back to stored markdown. */
export function serializeMarkdown(doc: ProseMirrorNode): string {
  // v1 writes tight lists (no blank line between items). The schema has no
  // `tight` attribute to carry the distinction, so one form is chosen and
  // the round-trip fixtures use it.
  return markdownSerializer.serialize(doc, { tightLists: true });
}

/** TipTap's setContent/insertContentAt want the JSON form of that same doc. */
export function markdownToEditorContent(markdown: string): JSONContent {
  return parseMarkdown(markdown).toJSON() as JSONContent;
}
