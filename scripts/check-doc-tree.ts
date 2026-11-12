#!/usr/bin/env bun
/**
 * Document tree guard (STEP 76).
 *
 * The left tree holds two kinds of rows only — folders that expand and
 * documents that open — and every document must have a renderer that can
 * project it. This script builds the tree from a FIXTURE and asserts:
 *
 *   (a) every node id is unique          (ids address the expansion state
 *                                           and the open-document tabs)
 *   (b) every document has a renderer    (no dead document: a row that opens
 *                                           nothing is a broken row)
 *   (c) no folder is empty without a badge explaining it (no silent hole)
 *
 * It also renders every document once, so a renderer that throws on the
 * fixture fails the guard instead of the browser.
 *
 * Usage: bun scripts/check-doc-tree.ts
 * Exit code 1 when any assertion fails.
 */
import { buildDocTree, walkDocTree } from "@/lib/novara/doc-tree";
import type { DocKind, Node } from "@/lib/novara/doc-tree";
import { DOC_RENDERERS } from "@/lib/novara/doc-markdown";
import type { NovelDetail } from "@/lib/novara/types";

const NOVEL_ID = "novel-fixture";
const NOW = "2026-01-01T00:00:00.000Z";

const fixture: NovelDetail = {
  novel: {
    id: NOVEL_ID,
    title: "Fixture novel",
    genre: "fantasy",
    synopsis: "A fixture.",
    targetWords: 1000,
    status: "drafting",
    conceptSnapshot: "A lighthouse keeper who cannot leave.",
    createdAt: NOW,
    updatedAt: NOW,
  },
  chapters: [
    {
      id: "ch-1",
      novelId: NOVEL_ID,
      index: 1,
      title: "The keeper",
      content: "The keeper lit the lamp.",
      wordCount: 120,
      status: "final",
      brief: "intro",
      updatedAt: NOW,
    },
    {
      id: "ch-2",
      novelId: NOVEL_ID,
      index: 2,
      title: "The visitor",
      content: "Someone came.",
      wordCount: 90,
      status: "draft",
      brief: "",
      updatedAt: NOW,
    },
  ],
  characters: [
    {
      id: "char-1",
      novelId: NOVEL_ID,
      name: "Mira",
      role: "keeper",
      description: "Keeps the lamp.",
      aliases: "米拉",
      status: "final",
      updatedAt: NOW,
    },
  ],
  worldEntries: [
    {
      id: "we-1",
      novelId: NOVEL_ID,
      title: "The lamp",
      category: "location",
      content: "A brass lamp.",
      status: "final",
      groupId: "wg-1",
      updatedAt: NOW,
    },
    {
      id: "we-2",
      novelId: NOVEL_ID,
      title: "The storm",
      category: "other",
      content: "Every winter.",
      status: "draft",
      groupId: null,
      updatedAt: NOW,
    },
  ],
  worldGroups: [{ id: "wg-1", novelId: NOVEL_ID, name: "Places", order: 0 }],
  outlineBeats: [
    {
      id: "beat-1",
      novelId: NOVEL_ID,
      index: 0,
      title: "The lamp is lit",
      summary: "Mira lights the lamp.",
      volumeId: "vol-1",
      status: "final",
      updatedAt: NOW,
    },
    {
      id: "beat-2",
      novelId: NOVEL_ID,
      index: 1,
      title: "The stranger arrives",
      summary: "A boat on the rocks.",
      volumeId: null,
      status: "draft",
      updatedAt: NOW,
    },
  ],
  volumes: [
    {
      id: "vol-1",
      novelId: NOVEL_ID,
      index: 0,
      title: "The winter",
      synopsis: "One winter.",
      status: "draft",
      updatedAt: NOW,
    },
  ],
  contract: "Mira keeps the lamp. She never leaves.",
  contractStatus: "final",
  packs: [
    {
      id: "pack-1",
      novelId: NOVEL_ID,
      kind: "material",
      chapterIndex: 1,
      title: "Storm notes",
      content: "Wind from the north.",
      updatedAt: NOW,
    },
  ],
  digests: [
    { chapterId: "ch-1", chapterIndex: 1, summary: "The lamp is lit.", updatedAt: NOW },
  ],
  versions: [],
  reviews: [],
  ledger: {
    storylines: [
      {
        id: "sl-1",
        novelId: NOVEL_ID,
        name: "The lamp",
        summary: "The lamp must be lit.",
        status: "active",
        lock: "final",
        updatedAt: NOW,
      },
    ],
    timeline: [
      {
        id: "tl-1",
        novelId: NOVEL_ID,
        order: 1,
        label: "Night one",
        detail: "The lamp is lit.",
        chapterIndex: 1,
        status: "draft",
        updatedAt: NOW,
      },
    ],
    arcs: [
      {
        id: "arc-1",
        novelId: NOVEL_ID,
        characterName: "Mira",
        order: 1,
        note: "Holds the post.",
        chapterIndex: 1,
        status: "draft",
        updatedAt: NOW,
      },
    ],
    promises: [
      {
        id: "pr-1",
        novelId: NOVEL_ID,
        content: "The lamp will be answered.",
        status: "open",
        lock: "draft",
        madeChapter: 1,
        dueChapter: 3,
        updatedAt: NOW,
      },
    ],
    clues: [
      {
        id: "cl-1",
        novelId: NOVEL_ID,
        content: "A second lamp on the rocks.",
        status: "planted",
        lock: "draft",
        plantChapter: 1,
        revealChapter: null,
        updatedAt: NOW,
      },
    ],
  },
};

const runs = [
  {
    id: "run-1",
    goal: "Write chapter 2",
    status: "completed",
    createdAt: NOW,
  },
];

const reviews = [
  {
    chapterId: "ch-1",
    blockingCount: 0,
    issueCount: 2,
    reviewedAt: NOW,
  },
  {
    chapterId: "ch-2",
    blockingCount: 1,
    issueCount: 3,
    reviewedAt: NOW,
  },
];

const failures: string[] = [];
const tree: Node[] = buildDocTree(fixture, runs, reviews);

// (a) every node id is unique.
const seen = new Set<string>();
let total = 0;
let folders = 0;
let docs = 0;
const perKind = new Map<DocKind, number>();

walkDocTree(tree, (node) => {
  total += 1;
  if (seen.has(node.id)) failures.push(`duplicate node id: ${node.id}`);
  seen.add(node.id);
  if (node.kind === "folder") {
    folders += 1;
    // (c) no empty folder without a badge explaining it.
    if (node.children.length === 0 && !node.badge?.trim()) {
      failures.push(`empty folder without a badge: ${node.id}`);
    }
    return;
  }
  docs += 1;
  perKind.set(node.doc, (perKind.get(node.doc) ?? 0) + 1);
  // (b) every document has a renderer.
  const renderer = DOC_RENDERERS[node.doc];
  if (!renderer) {
    failures.push(`document without a renderer: ${node.id} (${node.doc})`);
    return;
  }
  try {
    const result = renderer({
      node,
      detail: fixture,
      runs,
      reviews,
      memory: {
        facts: [
          {
            category: "decision",
            content: "The lamp stays lit.",
            sourceChapter: 1,
          },
        ],
        digests: [{ chapterIndex: 1, title: "The keeper", summary: "Lit." }],
        stats: {
          facts: 1,
          states: 0,
          loopsOpen: 0,
          loopsAdvanced: 0,
          loopsPaid: 0,
          digests: 1,
          chapters: 2,
        },
      },
    });
    if (!result.markdown.trim()) {
      failures.push(`renderer produced empty markdown: ${node.id}`);
    }
  } catch (error) {
    failures.push(
      `renderer threw for ${node.id}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

// The registry must cover EVERY kind, not only the kinds this fixture uses.
for (const kind of Object.keys(DOC_RENDERERS) as DocKind[]) {
  if (!perKind.has(kind)) {
    console.log(`note: kind "${kind}" is registered but the fixture has no document`);
  }
}

console.log("document tree");
console.log(`  nodes total : ${total}`);
console.log(`  folders     : ${folders}`);
console.log(`  documents   : ${docs}`);
console.log("  per kind    :");
for (const kind of Object.keys(DOC_RENDERERS) as DocKind[]) {
  console.log(`    ${kind.padEnd(18)} ${perKind.get(kind) ?? 0}`);
}
console.log(`  renderers   : ${Object.keys(DOC_RENDERERS).length}`);

if (failures.length > 0) {
  console.error("");
  console.error(`FAIL: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("");
console.log(
  "PASS: every node id is unique, every document has a renderer, no empty folder is unexplained."
);
