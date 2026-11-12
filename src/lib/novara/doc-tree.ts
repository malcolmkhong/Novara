// ---------------------------------------------------------------------------
// STEP 76 — the document tree model.
//
// RULE 1: every row in the left tree is a FOLDER (expands) or a DOCUMENT
// (opens). There is no third row type. A folder's expand key is its own id.
//
// RULE 2: every document is a READ-ONLY projection of data that already
// exists in the novel detail. This module therefore holds NO persistence and
// NO UI: it is a pure function from (detail, runs, reviews) to a tree.
//
// Ids are stable across renders so the expansion state and the open-document
// tabs survive a refresh:
//
//   folder  -> "f:<name>"          (f:outline, f:world.group.<groupId>, …)
//   document-> "<DocKind>:<ref>"    (chapter:<chapterId>, beat:<beatId>, …)
//
// The `zh` field on a node is the ORIGINAL Chinese label of that row. The
// rail's search line keeps both terms (STEP 65.6a): searching "Final" or
// "定稿" both work, so the alias travels with the node.
// ---------------------------------------------------------------------------

import type { NovelDetail } from "@/lib/novara/types";
import { formatWordCount } from "@/lib/novara/words";

/** Every kind of document the tree can open. */
export type DocKind =
  | "chapter"
  | "contract"
  | "concept"
  | "skeleton"
  | "beat"
  | "digests"
  | "world_group"
  | "world_entry"
  | "character"
  | "memory_index"
  | "memory_category"
  | "ledger_storylines"
  | "ledger_timeline"
  | "ledger_arcs"
  | "ledger_promises"
  | "ledger_clues"
  | "run"
  | "review"
  | "pack";

/** A folder row — it expands; it never opens a document. */
export interface FolderNode {
  id: string;
  label: string;
  kind: "folder";
  /** The children of this folder. */
  children: Node[];
  /** A count, or a short explanation (e.g. "empty"). Never blank. */
  badge?: string;
  /** The original Chinese label — the search line matches both. */
  zh?: string;
}

/** A document row — it opens a read-only projection of existing data. */
export interface DocNode {
  id: string;
  label: string;
  kind: "doc";
  doc: DocKind;
  /** The database id the renderer needs (chapter id, beat id, …). */
  ref: string;
  /** A short count or state, e.g. "Final", "3". */
  badge?: string;
  /** A short qualifier, e.g. the word count or the review state. */
  meta?: string;
  /** The original Chinese label — the search line matches both. */
  zh?: string;
}

export type Node = FolderNode | DocNode;

/** The run fields the tree needs. `AgentRun` is structurally compatible. */
export interface RunSummary {
  id: string;
  goal: string;
  status: string;
  createdAt: string;
}

/** The latest persisted review of one chapter. */
export interface ReviewSummary {
  chapterId: string;
  /** Issues that block the finalization gate (E2). */
  blockingCount: number;
  issueCount: number;
  reviewedAt: string;
}

/** The memory categories the tree links to, with their Chinese labels. */
export const MEMORY_CATEGORY_ROWS: { key: string; label: string; zh: string }[] = [
  { key: "decision", label: "Decisions", zh: "决策" },
  { key: "dialogue", label: "Dialogue", zh: "对话" },
  { key: "style", label: "Style", zh: "文风" },
  { key: "inspiration", label: "Inspiration", zh: "灵感" },
];

/**
 * Relative time for a run row ("now", "2m ago", "3h ago", "4d ago", "2w ago").
 * Moved here from the rail so the tree model and the rail share ONE
 * implementation (the rail imports it back).
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** The folder id for a name — the expand key (RULE 1). */
export function folderId(name: string): string {
  return `f:${name}`;
}

/**
 * A tree row label must stay a ROW: a run goal can be a whole QC report, so
 * it is cut at the first line break and then at the character budget.
 */
export function truncateLabel(text: string, max: number): string {
  const firstLine = text.split(/\r?\n/)[0].trim();
  const flat = firstLine.length > 0 ? firstLine : text.trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The document id for a kind and its reference. */
export function docId(doc: DocKind, ref: string): string {
  return `${doc}:${ref}`;
}

/** Parse a document id back into its kind and reference. */
export function parseDocId(
  id: string
): { doc: DocKind; ref: string } | null {
  const at = id.indexOf(":");
  if (at < 0) return null;
  const kind = id.slice(0, at) as DocKind;
  const ref = id.slice(at + 1);
  if (!ref) return null;
  return { doc: kind, ref };
}

function folder(
  name: string,
  label: string,
  children: Node[],
  opts: { zh?: string; badge?: string } = {}
): FolderNode {
  return {
    id: folderId(name),
    label,
    kind: "folder",
    zh: opts.zh,
    // A folder never renders as a silent hole: it carries its child count, or
    // "empty" when it has none.
    badge: opts.badge ?? (children.length > 0 ? String(children.length) : "empty"),
    children,
  };
}

function doc(
  kind: DocKind,
  ref: string,
  label: string,
  opts: { zh?: string; badge?: string; meta?: string } = {}
): DocNode {
  return {
    id: docId(kind, ref),
    label,
    kind: "doc",
    doc: kind,
    ref,
    zh: opts.zh,
    badge: opts.badge,
    meta: opts.meta,
  };
}

/** "final" -> "Final", "revised" -> "Revised", "draft" -> "Draft". */
export function chapterStatusLabel(status: string): string {
  if (status === "final") return "Final";
  if (status === "revised") return "Revised";
  return "Draft";
}

/**
 * Build the document tree of one novel.
 *
 * The order of the top-level rows is fixed (the tree reads top-down like an
 * index): Book contract · Outline · World book · Characters · Chapters ·
 * Materials · Memory · Concepts · Ledger · Runs · Review.
 */
export function buildDocTree(
  detail: NovelDetail,
  runs: RunSummary[] = [],
  reviews: ReviewSummary[] = []
): Node[] {
  const { novel } = detail;
  const chapters = [...detail.chapters].sort((a, b) => a.index - b.index);
  const reviewsByChapter = new Map(reviews.map((r) => [r.chapterId, r]));
  const nodes: Node[] = [];

  // 1. Book contract — the novel's spine.
  nodes.push(
    doc("contract", novel.id, "Book contract", {
      zh: "作品契约",
      badge: detail.contractStatus === "final" ? "Final" : "Draft",
      meta: detail.contract ? `${detail.contract.length} chars` : "Empty",
    })
  );

  // 2. Outline — the story skeleton, the volume plans and the chapter digests.
  const outlineChildren: Node[] = [];
  outlineChildren.push(
    doc("skeleton", novel.id, "Story skeleton", {
      zh: "故事骨架",
      badge: String(detail.outlineBeats.length),
    })
  );
  const volumes = [...detail.volumes].sort((a, b) => a.index - b.index);
  for (const volume of volumes) {
    const beats = detail.outlineBeats
      .filter((b) => b.volumeId === volume.id)
      .sort((a, b) => a.index - b.index);
    outlineChildren.push(
      folder(
        `volume.${volume.id}`,
        `Volume ${String(volume.index + 1).padStart(2, "0")} — ${volume.title}`,
        beats.map((beat) =>
          doc("beat", beat.id, beat.title, {
            zh: "情节点",
            badge: beat.status === "final" ? "Final" : undefined,
            meta: beat.status,
          })
        ),
        { zh: "卷规划" }
      )
    );
  }
  outlineChildren.push(
    doc("digests", novel.id, "Chapter digests", {
      zh: "章摘要",
      badge: String(detail.digests.length),
    })
  );
  nodes.push(folder("outline", "Outline", outlineChildren, { zh: "大纲" }));

  // 3. World book — one folder per group, plus the ungrouped bucket.
  const worldChildren: Node[] = [];
  const groups = [...detail.worldGroups].sort((a, b) => a.order - b.order);
  const entryDoc = (entry: NovelDetail["worldEntries"][number]): DocNode =>
    doc("world_entry", entry.id, entry.title, {
      zh: "世界书",
      badge: entry.status === "final" ? "Final" : undefined,
      meta: entry.category,
    });
  for (const group of groups) {
    const entries = detail.worldEntries.filter((e) => e.groupId === group.id);
    worldChildren.push(
      folder(
        `world.group.${group.id}`,
        group.name,
        entries.map(entryDoc),
        { zh: "世界书" }
      )
    );
  }
  const ungrouped = detail.worldEntries.filter((e) => e.groupId === null);
  worldChildren.push(
    folder("world.ungrouped", "Ungrouped", ungrouped.map(entryDoc), {
      zh: "未分组",
    })
  );
  nodes.push(folder("world", "World book", worldChildren, { zh: "世界书" }));

  // 4. Characters.
  nodes.push(
    folder(
      "characters",
      "Characters",
      detail.characters.map((c) =>
        doc("character", c.id, c.name, {
          zh: "人物档案",
          badge: c.status === "final" ? "Final" : undefined,
          meta: c.role || undefined,
        })
      ),
      { zh: "人物档案" }
    )
  );

  // 5. Chapters. The rows carry their own state (Final / Revised / Draft);
  // the FOLDER badge is the number of FINAL chapters — the "final only"
  // count the order asks for.
  const finalCount = chapters.filter((c) => c.status === "final").length;
  nodes.push(
    folder(
      "chapters",
      "Chapters",
      chapters.map((ch) =>
        doc("chapter", ch.id, `${String(ch.index).padStart(4, "0")} ${ch.title}`, {
          zh: "草稿区",
          badge: chapterStatusLabel(ch.status),
          meta: `${formatWordCount(ch.wordCount)} words`,
        })
      ),
      { zh: "草稿区", badge: `${finalCount} final` }
    )
  );

  // 6. Materials — the chapter packs (material + final prep).
  nodes.push(
    folder(
      "materials",
      "Materials",
      detail.packs.map((p) =>
        doc("pack", p.id, p.title, {
          zh: "材料包",
          meta: `Chapter ${p.chapterIndex} · ${p.kind}`,
        })
      ),
      { zh: "材料包" }
    )
  );

  // 7. Memory — the index plus one document per memory category.
  const memoryChildren: Node[] = [
    doc("memory_index", novel.id, "Index", { zh: "索引" }),
  ];
  for (const row of MEMORY_CATEGORY_ROWS) {
    memoryChildren.push(
      doc("memory_category", row.key, row.label, { zh: row.zh })
    );
  }
  nodes.push(folder("memory", "Memory", memoryChildren, { zh: "本书记忆" }));

  // 8. Concepts — the creation snapshot.
  nodes.push(
    doc("concept", novel.id, "Concepts", {
      zh: "构想",
      badge: novel.conceptSnapshot ? "Written" : "Empty",
    })
  );

  // 9. Ledger — the five ledgers, each with its live row count.
  nodes.push(
    folder(
      "ledger",
      "Ledger",
      [
        doc("ledger_storylines", novel.id, "Storylines", {
          zh: "故事线",
          badge: String(detail.ledger.storylines.length),
        }),
        doc("ledger_timeline", novel.id, "Timeline", {
          zh: "时间线",
          badge: String(detail.ledger.timeline.length),
        }),
        doc("ledger_arcs", novel.id, "Character arcs", {
          zh: "人物弧线",
          badge: String(detail.ledger.arcs.length),
        }),
        doc("ledger_promises", novel.id, "Promises", {
          zh: "承诺",
          badge: String(detail.ledger.promises.length),
        }),
        doc("ledger_clues", novel.id, "Clues", {
          zh: "线索",
          badge: String(detail.ledger.clues.length),
        }),
      ],
      { zh: "账本" }
    )
  );

  // 10. Runs — collapsed by default (the panel's default state).
  nodes.push(
    folder(
      "runs",
      "Runs",
      runs.map((run) =>
        doc("run", run.id, `${truncateLabel(run.goal, 60)} · ${relativeTime(run.createdAt)}`, {
          zh: "运行记录",
          meta: run.status,
        })
      ),
      { zh: "运行记录" }
    )
  );

  // 11. Review — the latest persisted review of every chapter.
  nodes.push(
    folder(
      "review",
      "Review",
      chapters.map((ch) => {
        const review = reviewsByChapter.get(ch.id);
        return doc("review", ch.id, ch.title, {
          zh: "审核",
          badge: review ? String(review.issueCount) : undefined,
          meta: review
            ? review.blockingCount > 0
              ? "blocked"
              : "clean"
            : "unreviewed",
        });
      }),
      { zh: "审核" }
    )
  );

  return nodes;
}

/** Depth-first walk over the tree — used by the search filter and the test. */
export function walkDocTree(
  nodes: Node[],
  visit: (node: Node, depth: number) => void,
  depth = 0
): void {
  for (const node of nodes) {
    visit(node, depth);
    if (node.kind === "folder") walkDocTree(node.children, visit, depth + 1);
  }
}
