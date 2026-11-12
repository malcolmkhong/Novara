// ---------------------------------------------------------------------------
// STEP 76 — the document renderers.
//
// One pure function per DocKind. Every function projects data that is ALREADY
// in the novel detail (RULE 2): it never writes, never fetches and never
// invents. The pane renders the returned markdown through the existing
// MarkdownDocument component (react-markdown) or shows it verbatim in a
// <pre> — there is no second markdown parser.
//
// This module is imported by a client component, so it must stay free of
// server-only imports (no db, no fetch).
// ---------------------------------------------------------------------------

import type { DocKind, DocNode, ReviewSummary, RunSummary } from "@/lib/novara/doc-tree";
import type {
  ChapterDTO,
  NovelDetail,
  OutlineBeatDTO,
} from "@/lib/novara/types";
import { formatWordCount } from "@/lib/novara/words";

/** The memory facts the pane fetched for this novel (lazy, on first use). */
export interface MemoryFactView {
  category: string;
  content: string;
  sourceChapter: number | null;
  lastSeenChapter?: number | null;
  status?: "open" | "advanced" | "paid";
}

/** The memory digests the pane fetched for this novel. */
export interface MemoryDigestView {
  chapterIndex: number;
  title: string;
  summary: string;
}

/** The memory snapshot a memory document projects. */
export interface MemorySnapshot {
  facts: MemoryFactView[];
  digests: MemoryDigestView[];
  stats?: {
    facts: number;
    states: number;
    loopsOpen: number;
    loopsAdvanced: number;
    loopsPaid: number;
    digests: number;
    chapters: number;
  };
}

/** Everything a renderer may read. */
export interface DocRenderContext {
  /** The document node being rendered (its `ref` selects the entity). */
  node: DocNode;
  /** The novel detail — the projection's only source of truth. */
  detail: NovelDetail;
  /** The runs of this novel (the run document projects one of them). */
  runs?: RunSummary[];
  /** The latest persisted review per chapter. */
  reviews?: ReviewSummary[];
  /** The memory snapshot, when a memory document is open. */
  memory?: MemorySnapshot | null;
}

/** What a renderer returns: the markdown source and a short meta line. */
export interface DocRenderResult {
  markdown: string;
  meta: string;
}

export type DocRenderer = (ctx: DocRenderContext) => DocRenderResult;

const EMPTY = "_Nothing here yet._";

function orEmpty(text: string | null | undefined): string {
  const value = (text ?? "").trim();
  return value.length > 0 ? value : EMPTY;
}

function bullets(lines: string[]): string {
  if (lines.length === 0) return EMPTY;
  return lines.map((line) => `- ${line}`).join("\n");
}

function findChapter(detail: NovelDetail, id: string): ChapterDTO | undefined {
  return detail.chapters.find((c) => c.id === id);
}

function findBeat(detail: NovelDetail, id: string): OutlineBeatDTO | undefined {
  return detail.outlineBeats.find((b) => b.id === id);
}

function volumeLabel(detail: NovelDetail, volumeId: string | null): string {
  if (!volumeId) return "Unassigned";
  const volume = detail.volumes.find((v) => v.id === volumeId);
  if (!volume) return "Unassigned";
  return `Volume ${String(volume.index + 1).padStart(2, "0")} — ${volume.title}`;
}

function chapterLabel(detail: NovelDetail, chapterId: string): string {
  const chapter = findChapter(detail, chapterId);
  if (!chapter) return chapterId;
  return `${String(chapter.index).padStart(4, "0")} ${chapter.title}`;
}

// ---------------------------------------------------------------------------
// The renderers
// ---------------------------------------------------------------------------

const contract: DocRenderer = ({ detail }) => {
  const status = detail.contractStatus === "final" ? "Final" : "Draft";
  return {
    markdown: `# Book contract\n\n**Status:** ${status}\n\n${orEmpty(detail.contract)}`,
    meta: status,
  };
};

const concept: DocRenderer = ({ detail }) => ({
  markdown: `# Concepts\n\n${orEmpty(detail.novel.conceptSnapshot)}`,
  meta: detail.novel.conceptSnapshot ? "Written" : "Empty",
});

const skeleton: DocRenderer = ({ detail }) => {
  const beats = [...detail.outlineBeats].sort((a, b) => a.index - b.index);
  const volumes = [...detail.volumes].sort((a, b) => a.index - b.index);
  const parts: string[] = ["# Story skeleton"];
  // STEP 76 — a volume is a FOLDER in the tree, so its plan (the synopsis)
  // has no document of its own: it is projected here, next to its beats.
  if (volumes.length > 0) {
    parts.push(
      `## Volumes\n\n${bullets(
        volumes.map(
          (volume) =>
            `**${volumeLabel(detail, volume.id)}** — ${volume.synopsis || "no plan yet"}`
        )
      )}`
    );
  }
  for (const volume of volumes) {
    const rows = beats.filter((b) => b.volumeId === volume.id);
    if (rows.length === 0) continue;
    parts.push(
      `## ${volumeLabel(detail, volume.id)}\n\n${bullets(
        rows.map((b) => `${b.title} — ${b.status}`)
      )}`
    );
  }
  const loose = beats.filter((b) => !b.volumeId);
  if (loose.length > 0) {
    parts.push(
      `## Unassigned\n\n${bullets(loose.map((b) => `${b.title} — ${b.status}`))}`
    );
  }
  if (parts.length === 1) parts.push(EMPTY);
  return {
    markdown: parts.join("\n\n"),
    meta: `${beats.length} beats · ${volumes.length} volumes`,
  };
};

const beat: DocRenderer = ({ detail, node }) => {
  const target = findBeat(detail, node.ref);
  if (!target) return { markdown: `# ${node.label}\n\n${EMPTY}`, meta: "missing" };
  return {
    markdown: `# ${target.title}\n\n**Status:** ${target.status}\n**Volume:** ${volumeLabel(
      detail,
      target.volumeId
    )}\n\n${orEmpty(target.summary)}`,
    meta: target.status,
  };
};

const digests: DocRenderer = ({ detail }) => {
  const rows = [...detail.digests].sort((a, b) => a.chapterIndex - b.chapterIndex);
  const parts = ["# Chapter digests"];
  for (const digest of rows) {
    parts.push(
      `## ${chapterLabel(detail, digest.chapterId)}\n\n${orEmpty(digest.summary)}`
    );
  }
  if (rows.length === 0) parts.push(EMPTY);
  return { markdown: parts.join("\n\n"), meta: `${rows.length} digests` };
};

const world_entry: DocRenderer = ({ detail, node }) => {
  const target = detail.worldEntries.find((w) => w.id === node.ref);
  if (!target) return { markdown: `# ${node.label}\n\n${EMPTY}`, meta: "missing" };
  return {
    markdown: `# ${target.title}\n\n**Category:** ${target.category}\n**Status:** ${target.status}\n\n${orEmpty(
      target.content
    )}`,
    meta: target.category,
  };
};

const world_group: DocRenderer = ({ detail, node }) => {
  const group = detail.worldGroups.find((g) => g.id === node.ref);
  const entries = group
    ? detail.worldEntries.filter((w) => w.groupId === group.id)
    : detail.worldEntries.filter((w) => !w.groupId);
  const title = group ? group.name : "Ungrouped";
  return {
    markdown: `# ${title}\n\n${bullets(
      entries.map((w) => `${w.title} — ${w.category}`)
    )}`,
    meta: `${entries.length} entries`,
  };
};

const character: DocRenderer = ({ detail, node }) => {
  const target = detail.characters.find((c) => c.id === node.ref);
  if (!target) return { markdown: `# ${node.label}\n\n${EMPTY}`, meta: "missing" };
  const aliasLine =
    target.aliases.trim().length > 0 ? `\n**Also known as:** ${target.aliases}` : "";
  return {
    markdown: `# ${target.name}\n\n**Role:** ${target.role || "—"}\n**Status:** ${target.status}${aliasLine}\n\n${orEmpty(
      target.description
    )}`,
    meta: target.role || target.status,
  };
};

const chapter: DocRenderer = ({ detail, node }) => {
  const target = findChapter(detail, node.ref);
  if (!target) return { markdown: `# ${node.label}\n\n${EMPTY}`, meta: "missing" };
  return {
    markdown: `# ${String(target.index).padStart(4, "0")} ${target.title}\n\n**Status:** ${target.status}\n**Words:** ${formatWordCount(
      target.wordCount
    )}\n\n${orEmpty(target.content)}`,
    meta: `${formatWordCount(target.wordCount)} words`,
  };
};

const pack: DocRenderer = ({ detail, node }) => {
  const target = detail.packs.find((p) => p.id === node.ref);
  if (!target) return { markdown: `# ${node.label}\n\n${EMPTY}`, meta: "missing" };
  return {
    markdown: `# ${target.title}\n\n**Chapter:** ${target.chapterIndex}\n**Kind:** ${target.kind}\n\n${orEmpty(
      target.content
    )}`,
    meta: `Chapter ${target.chapterIndex}`,
  };
};

const memory_index: DocRenderer = ({ memory }) => {
  const facts = memory?.facts ?? [];
  const byCategory = new Map<string, MemoryFactView[]>();
  for (const fact of facts) {
    const list = byCategory.get(fact.category) ?? [];
    list.push(fact);
    byCategory.set(fact.category, list);
  }
  const stats = memory?.stats;
  const parts = ["# Memory index"];
  if (stats) {
    parts.push(
      `**Facts:** ${stats.facts} · **States:** ${stats.states} · **Chapters:** ${stats.chapters} · **Open loops:** ${stats.loopsOpen}`
    );
  }
  if (byCategory.size === 0) {
    parts.push(EMPTY);
  } else {
    for (const [category, rows] of [...byCategory.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      parts.push(
        `## ${category} (${rows.length})\n\n${bullets(
          rows.map((f) =>
            f.sourceChapter != null ? `${f.content} — chapter ${f.sourceChapter}` : f.content
          )
        )}`
      );
    }
  }
  // The pool holds facts AND character states AND open loops — so the index
  // counts ENTRIES, while the stats line above keeps the server's own
  // breakdown (facts / states / chapters / open loops).
  return { markdown: parts.join("\n\n"), meta: `${facts.length} entries` };
};

const memory_category: DocRenderer = ({ node, memory }) => {
  const category = node.ref;
  const facts = (memory?.facts ?? []).filter((f) => f.category === category);
  const digests = memory?.digests ?? [];
  const parts = [`# ${node.label}`];
  if (facts.length === 0) {
    parts.push(EMPTY);
  } else {
    parts.push(
      bullets(
        facts.map((f) =>
          f.sourceChapter != null ? `${f.content} — chapter ${f.sourceChapter}` : f.content
        )
      )
    );
  }
  if (digests.length > 0) {
    parts.push(
      `## Recent digests\n\n${bullets(
        digests.map((d) => `${d.title} — ${d.summary}`)
      )}`
    );
  }
  return { markdown: parts.join("\n\n"), meta: `${facts.length} facts` };
};

const ledger_storylines: DocRenderer = ({ detail }) => ({
  markdown: `# Storylines\n\n${bullets(
    detail.ledger.storylines.map((s) => `${s.name} — ${s.summary}`)
  )}`,
  meta: `${detail.ledger.storylines.length} rows`,
});

const ledger_timeline: DocRenderer = ({ detail }) => ({
  markdown: `# Timeline\n\n${bullets(
    detail.ledger.timeline.map((t) => `${t.order}. ${t.label} — ${t.detail}`)
  )}`,
  meta: `${detail.ledger.timeline.length} rows`,
});

const ledger_arcs: DocRenderer = ({ detail }) => ({
  markdown: `# Character arcs\n\n${bullets(
    detail.ledger.arcs.map((a) => `${a.characterName} — ${a.note}`)
  )}`,
  meta: `${detail.ledger.arcs.length} rows`,
});

const ledger_promises: DocRenderer = ({ detail }) => ({
  markdown: `# Promises\n\n${bullets(
    detail.ledger.promises.map(
      (p) => `${p.content} — ${p.status} (made ${p.madeChapter ?? "?"}, due ${p.dueChapter ?? "?"})`
    )
  )}`,
  meta: `${detail.ledger.promises.length} rows`,
});

const ledger_clues: DocRenderer = ({ detail }) => ({
  markdown: `# Clues\n\n${bullets(
    detail.ledger.clues.map(
      (c) =>
        `${c.content} — ${c.status} (planted ${c.plantChapter ?? "?"}, revealed ${c.revealChapter ?? "?"})`
    )
  )}`,
  meta: `${detail.ledger.clues.length} rows`,
});

const run: DocRenderer = ({ node, runs }) => {
  const target = (runs ?? []).find((r) => r.id === node.ref);
  if (!target) return { markdown: `# ${node.label}\n\n${EMPTY}`, meta: "missing" };
  return {
    markdown: `# ${target.goal}\n\n**Status:** ${target.status}\n**Started:** ${target.createdAt}\n\n_This run's report is shown in the conversation._`,
    meta: target.status,
  };
};

const review: DocRenderer = ({ detail, node, reviews }) => {
  const target = (reviews ?? []).find((r) => r.chapterId === node.ref);
  const chapter = findChapter(detail, node.ref);
  const title = chapter ? chapter.title : node.label;
  if (!target) {
    return {
      markdown: `# Review — ${title}\n\n**State:** unreviewed\n\n${EMPTY}`,
      meta: "unreviewed",
    };
  }
  const state = target.blockingCount > 0 ? "blocked" : "clean";
  const parts = [
    `# Review — ${title}`,
    `**State:** ${state}\n**Issues:** ${target.issueCount} (${target.blockingCount} blocking)\n**Reviewed at:** ${target.reviewedAt}`,
  ];
  return { markdown: parts.join("\n\n"), meta: state };
};

/**
 * The renderer registry — one entry per DocKind. A document in the tree whose
 * kind has no renderer is a DEAD document; `scripts/check-doc-tree.ts`
 * asserts that cannot happen.
 */
export const DOC_RENDERERS: Record<DocKind, DocRenderer> = {
  chapter,
  contract,
  concept,
  skeleton,
  beat,
  digests,
  world_group,
  world_entry,
  character,
  memory_index,
  memory_category,
  ledger_storylines,
  ledger_timeline,
  ledger_arcs,
  ledger_promises,
  ledger_clues,
  run,
  review,
  pack,
};

/** The human label of a document kind (the pane's kind chip). */
export const DOC_KIND_LABELS: Record<DocKind, string> = {
  chapter: "Chapter",
  contract: "Contract",
  concept: "Concept",
  skeleton: "Skeleton",
  beat: "Beat",
  digests: "Digests",
  world_group: "World group",
  world_entry: "World entry",
  character: "Character",
  memory_index: "Memory index",
  memory_category: "Memory",
  ledger_storylines: "Storylines",
  ledger_timeline: "Timeline",
  ledger_arcs: "Character arcs",
  ledger_promises: "Promises",
  ledger_clues: "Clues",
  run: "Run",
  review: "Review",
  pack: "Material pack",
};
