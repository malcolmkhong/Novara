// ---------------------------------------------------------------------------
// Novara AI — Phase 4 memory retrieval engine.
//
// Reads the sediment layer back (ChapterDigest / StoryFact / CharacterState /
// Foreshadow — the single source of truth written by the sediment pipeline)
// and turns it into prompt-ready context.
//
// Retrieval model (v1): deterministic scoring, no vectors, no FTS.
//   score = categoryWeight × relevance × recency
//   - relevance: keyword overlap between the query (chapter title + beat
//     summary) and the item text. Latin words ≥3 chars + CJK bigrams, so it
//     works for both languages without a segmenter. The SDK exposes no
//     embedding API (verified against index.d.ts); when one appears, only
//     this scoring function needs to change.
//   - recency: anchored on lastSeenChapter ?? sourceChapter — a fact re-used
//     in ch. 12 stays hot even if planted in ch. 1.
//   - categoryWeight: plot-critical kinds float (open loops > states >
//     world rules > plain facts).
//
// Consumers:
//   - POST /api/ai/draft          → retrieveMemory().block injected into the
//                                   writing prompt (the loop that was missing:
//                                   the story bible was write-only before P4).
//   - loadStorySnapshot (P3)      → same block for the agent runtime.
//   - GET /api/novels/[id]/memory → buildMemoryView() for the Memory tab.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { getBudgets } from "@/lib/novara/content";
import type { MemoryCategory, MemoryItem } from "@/lib/novara/agent-types";

// Category weights — plot-critical memory floats to the top.
const CATEGORY_WEIGHT: Record<MemoryCategory, number> = {
  open_loop: 3.0,
  character_state: 2.5,
  relationship: 2.2,
  decision: 2.4, // Phase 7 — canon choices steer everything after them
  world_rule: 2.0,
  style: 2.0, // Phase 7 — voice/POV rules matter at draft time
  dialogue: 1.8, // Phase 7 — speech constraints keep characters in character
  story_fact: 1.5,
  inspiration: 1.2, // Phase 7 — nice to resurface, never blocking
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "onto",
  "her", "his", "their", "its", "was", "were", "has", "had", "have",
  "not", "but", "all", "who", "whom", "which", "what", "when", "where",
  "she", "him", "they", "them", "are", "will", "would", "could", "chapter",
]);

interface RawItem {
  id: string;
  category: MemoryCategory;
  content: string;
  sourceChapter: number | null;
  /** Chapter that last resurfaced the item (recency anchor). */
  anchorChapter: number | null;
  firstSeen: Date;
  lastSeen: Date;
  /** Foreshadow state machine position — open_loop items only. */
  status?: "open" | "advanced" | "paid";
}

export interface ScoredMemoryItem extends MemoryItem {
  score: number;
  lastSeenChapter: number | null;
}

export interface MemoryDigestRow {
  chapterIndex: number;
  title: string;
  summary: string;
}

export interface MemoryStats {
  considered: number;
  selected: number;
  chars: number;
}

export interface RetrievedMemory {
  /** Prompt block (bilingual header matched to the novel language). */
  block: string;
  items: ScoredMemoryItem[];
  digests: MemoryDigestRow[];
  stats: MemoryStats;
  isChinese: boolean;
}

// ---------------------------------------------------------------------------
// Keyword extraction — latin words + CJK bigrams (no segmenter needed).
// ---------------------------------------------------------------------------

export function extractQueryKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();

  for (const w of lower.match(/[a-z][a-z'-]{2,}/g) ?? []) {
    if (!STOPWORDS.has(w)) out.add(w);
  }
  // CJK has no spaces: consecutive character bigrams approximate tokens.
  for (const run of lower.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i < run.length - 1; i += 1) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

function keywordHits(keywords: string[], haystack: string): number {
  if (keywords.length === 0) return 0;
  const lower = haystack.toLowerCase();
  let hits = 0;
  for (const kw of keywords) if (lower.includes(kw)) hits += 1;
  return hits;
}

// ---------------------------------------------------------------------------
// Collection — read the sediment layer back.
// ---------------------------------------------------------------------------

async function collectSedimentItems(novelId: string): Promise<RawItem[]> {
  const [facts, states, foreshadows] = await Promise.all([
    db.storyFact.findMany({
      where: { novelId },
      select: {
        id: true, category: true, content: true,
        sourceChapter: true, lastSeenChapter: true,
        firstSeenAt: true, lastSeenAt: true,
      },
    }),
    // Latest snapshot per character: rows are unique per (novel, name,
    // chapterIndex) — take the highest chapterIndex per name.
    db.characterState.findMany({
      where: { novelId },
      orderBy: { chapterIndex: "desc" },
      select: { id: true, name: true, state: true, chapterIndex: true, createdAt: true, updatedAt: true },
    }),
    db.foreshadow.findMany({
      where: { novelId },
      select: {
        id: true, content: true, plantChapter: true,
        status: true, lastChapter: true, createdAt: true, updatedAt: true,
      },
    }),
  ]);

  const items: RawItem[] = [];

  for (const f of facts) {
    const category = f.category as MemoryCategory;
    if (!(category in CATEGORY_WEIGHT)) continue;
    items.push({
      id: f.id,
      category,
      content: f.content,
      sourceChapter: f.sourceChapter,
      anchorChapter: f.lastSeenChapter ?? f.sourceChapter,
      firstSeen: f.firstSeenAt,
      lastSeen: f.lastSeenAt,
    });
  }

  const seenNames = new Set<string>();
  for (const s of states) {
    if (seenNames.has(s.name)) continue; // rows come chapterIndex-desc → first is latest
    seenNames.add(s.name);
    items.push({
      id: s.id,
      category: "character_state",
      content: `${s.name} — ${s.state}`,
      sourceChapter: s.chapterIndex,
      anchorChapter: s.chapterIndex,
      firstSeen: s.createdAt,
      lastSeen: s.updatedAt,
    });
  }

  for (const f of foreshadows) {
    const status =
      f.status === "paid" ? "paid" : f.status === "advanced" ? "advanced" : "open";
    items.push({
      id: f.id,
      category: "open_loop",
      content: f.content,
      sourceChapter: f.plantChapter,
      anchorChapter: f.lastChapter ?? f.plantChapter,
      firstSeen: f.createdAt,
      lastSeen: f.updatedAt,
      status,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Scoring + selection
// ---------------------------------------------------------------------------

function scoreItems(
  items: RawItem[],
  chapterIndex: number,
  queryText: string
): { scored: ScoredMemoryItem[]; considered: number } {
  const budgets = getBudgets().memory;
  const halfLife = budgets.recencyHalfLifeChapters;
  const keywords = extractQueryKeywords(queryText);

  const scored = items.map((item) => {
    const hits = keywordHits(keywords, item.content);
    const ratio = keywords.length > 0 ? hits / keywords.length : 0;
    const relevance = 1 + 1.5 * Math.min(1, ratio);

    const dist = Math.max(0, chapterIndex - (item.anchorChapter ?? 1));
    const recency = 0.5 + 0.5 * (halfLife / (halfLife + dist));

    const score = CATEGORY_WEIGHT[item.category] * relevance * recency;

    return {
      id: item.id,
      category: item.category,
      content: item.content,
      sourceChapter: item.sourceChapter,
      lastSeenChapter: item.anchorChapter,
      firstSeen: item.firstSeen.toISOString(),
      lastSeen: item.lastSeen.toISOString(),
      ...(item.status ? { status: item.status } : {}),
      score,
    } satisfies ScoredMemoryItem;
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.lastSeenChapter ?? 0) - (a.lastSeenChapter ?? 0) ||
      a.id.localeCompare(b.id)
  );

  return { scored, considered: scored.length };
}

function renderLine(item: ScoredMemoryItem, itemChars: number): string {
  const anchor = item.lastSeenChapter ?? item.sourceChapter;
  const chapter = anchor != null ? `ch${anchor}` : null;
  const tagBits: string[] = [];
  if (item.category === "open_loop" && item.status) tagBits.push(item.status);
  if (chapter) tagBits.push(chapter);
  const tag = tagBits.length > 0 ? ` (${tagBits.join(", ")})` : "";
  return `- [${item.category}]${tag} ${clipItem(item.content, itemChars)}`;
}

function clipItem(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// Public retrieval API
// ---------------------------------------------------------------------------

export interface RetrieveMemoryInput {
  novelId: string;
  /** Chapter being drafted / written next — recency anchor. */
  chapterIndex: number;
  /** Relevance query: chapter title + its outline beat summary. */
  queryText?: string;
}

/**
 * Score the sediment layer for one drafting moment and render the prompt
 * block. Returns null when the novel has no sedimented memory at all, so
 * callers can skip the section cleanly.
 */
export async function retrieveMemory(
  input: RetrieveMemoryInput
): Promise<RetrievedMemory | null> {
  const budgets = getBudgets().memory;

  const [rawItems, digests, novel] = await Promise.all([
    collectSedimentItems(input.novelId),
    db.chapterDigest.findMany({
      where: {
        novelId: input.novelId,
        chapter: { index: { lt: input.chapterIndex } },
      },
      orderBy: { chapter: { index: "desc" } },
      take: budgets.digestWindow,
      select: {
        summary: true,
        chapter: { select: { index: true, title: true } },
      },
    }),
    db.novel.findUnique({
      where: { id: input.novelId },
      select: { title: true, synopsis: true },
    }),
  ]);
  if (!novel) throw new Error(`Novel ${input.novelId} not found`);
  if (rawItems.length === 0 && digests.length === 0) return null;

  const isChinese = /[\u4e00-\u9fff]/.test(`${novel.title}\n${novel.synopsis}`);

  const { scored, considered } = scoreItems(
    rawItems,
    input.chapterIndex,
    input.queryText ?? ""
  );

  // Fill up to topK items under the character budget.
  const selected: ScoredMemoryItem[] = [];
  let chars = 0;
  for (const item of scored) {
    if (selected.length >= budgets.topK) break;
    const line = renderLine(item, budgets.itemContentChars);
    if (selected.length > 0 && chars + line.length > budgets.contextBudgetChars) {
      continue; // try smaller later items rather than stopping dead
    }
    selected.push(item);
    chars += line.length;
  }

  const digestRows: MemoryDigestRow[] = digests
    .map((d) => ({
      chapterIndex: d.chapter.index,
      title: d.chapter.title,
      summary: clipItem(d.summary, budgets.digestSummaryChars),
    }))
    .reverse(); // narrative order (oldest → newest)

  const parts: string[] = [];
  if (selected.length > 0) {
    parts.push(
      isChinese
        ? `故事记忆（已确立的事实——必须遵守，不得与之矛盾）：\n${selected
            .map((i) => renderLine(i, budgets.itemContentChars))
            .join("\n")}`
        : `STORY MEMORY (established canon — obey these facts, never contradict them):\n${selected
            .map((i) => renderLine(i, budgets.itemContentChars))
            .join("\n")}`
    );
  }
  if (digestRows.length > 0) {
    parts.push(
      isChinese
        ? `前情提要（最近章节摘要）：\n${digestRows
            .map((d) => `- 第${d.chapterIndex}章「${d.title}」：${d.summary}`)
            .join("\n")}`
        : `STORY SO FAR (recent chapter summaries):\n${digestRows
            .map((d) => `- Ch${d.chapterIndex} "${d.title}": ${d.summary}`)
            .join("\n")}`
    );
  }

  return {
    block: parts.join("\n\n"),
    items: selected,
    digests: digestRows,
    stats: { considered, selected: selected.length, chars },
    isChinese,
  };
}

// ---------------------------------------------------------------------------
// Free-form agent query (Phase 4: the memory_query tool inside the agent
// tool loop — plan §7.1). Unlike retrieveMemory (which scores for ONE
// drafting moment), queryMemory scores an arbitrary question the agent asks
// mid-run, anchored on the novel's latest chapter (the agent lives in the
// narrative present).
// ---------------------------------------------------------------------------

export interface QueryMemoryInput {
  novelId: string;
  query: string;
  /** Optional category filter — e.g. only open_loop when checking promises. */
  category?: MemoryCategory;
}

/**
 * Score the sediment layer against a free-form query. Returns items sorted
 * by score (no prompt block — the caller renders via formatMemoryLines).
 */
export async function queryMemory(
  input: QueryMemoryInput
): Promise<ScoredMemoryItem[]> {
  const budgets = getBudgets().memory;

  const [rawItems, maxAgg] = await Promise.all([
    collectSedimentItems(input.novelId),
    db.chapter.aggregate({
      where: { novelId: input.novelId },
      _max: { index: true },
    }),
  ]);

  const nowIndex = maxAgg._max.index ?? 1;
  const filtered = input.category
    ? rawItems.filter((i) => i.category === input.category)
    : rawItems;

  // scoreItems needs a chapterIndex anchor — the story's present tense.
  const { scored } = scoreItems(filtered, nowIndex, input.query);
  return scored.slice(0, budgets.topK);
}

/** Render items as deterministic feed lines (shared with the prompt block). */
export function formatMemoryLines(items: ScoredMemoryItem[]): string[] {
  const budgets = getBudgets().memory;
  return items.map((i) => renderLine(i, budgets.itemContentChars));
}

// ---------------------------------------------------------------------------
// Memory view (Memory tab + deterministic doctor)
// ---------------------------------------------------------------------------

export interface DoctorFinding {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface NovelMemoryView {
  novelId: string;
  items: MemoryItem[];
  digests: MemoryDigestRow[];
  doctor: DoctorFinding[];
  stats: {
    facts: number;
    states: number;
    loopsOpen: number;
    loopsAdvanced: number;
    loopsPaid: number;
    digests: number;
    chapters: number;
  };
  generatedAt: string;
}

export async function buildMemoryView(novelId: string): Promise<NovelMemoryView> {
  const budgets = getBudgets().memory;

  const novel = await db.novel.findUnique({
    where: { id: novelId },
    select: {
      id: true,
      chapters: { select: { index: true, title: true, content: true } },
      characters: { select: { name: true } },
      _count: { select: { chapters: true } },
    },
  });
  if (!novel) throw new Error(`Novel ${novelId} not found`);

  const chapterCount = novel.chapters.length;
  const maxChapterIndex =
    chapterCount > 0 ? Math.max(...novel.chapters.map((c) => c.index)) : 0;

  const [rawItems, digests] = await Promise.all([
    collectSedimentItems(novelId),
    db.chapterDigest.findMany({
      where: { novelId },
      orderBy: { chapter: { index: "asc" } },
      select: {
        summary: true,
        chapter: { select: { index: true, title: true } },
      },
    }),
  ]);

  // Un-scored, un-capped view: everything the pipeline knows, contract-shaped.
  const items: MemoryItem[] = rawItems
    .map((item) => ({
      id: item.id,
      category: item.category,
      content: item.content,
      sourceChapter: item.sourceChapter,
      firstSeen: item.firstSeen.toISOString(),
      lastSeen: item.lastSeen.toISOString(),
      lastSeenChapter: item.anchorChapter,
      ...(item.status ? { status: item.status } : {}),
    }))
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        (a.sourceChapter ?? 0) - (b.sourceChapter ?? 0)
    );

  const stats = {
    facts: rawItems.filter(
      (i) => i.category !== "open_loop" && i.category !== "character_state"
    ).length,
    // Open-loop-category lines that arrived via FACT (no ledger status) —
    // counted so the totals stay honest against the item list.
    loopFacts: rawItems.filter(
      (i) => i.category === "open_loop" && !i.status
    ).length,
    states: rawItems.filter((i) => i.category === "character_state").length,
    loopsOpen: rawItems.filter((i) => i.category === "open_loop" && i.status === "open").length,
    loopsAdvanced: rawItems.filter((i) => i.category === "open_loop" && i.status === "advanced").length,
    loopsPaid: rawItems.filter((i) => i.category === "open_loop" && i.status === "paid").length,
    digests: digests.length,
    chapters: chapterCount,
  };

  // ---- Doctor: deterministic checks over the real tables -------------------
  const doctor: DoctorFinding[] = [];

  // 1. Bible integrity — no memory may reference chapters that don't exist.
  const ghostFacts = rawItems.filter(
    (i) => (i.sourceChapter ?? 0) > maxChapterIndex
  ).length;
  const orphanFacts = rawItems.filter((i) => i.sourceChapter === null).length;
  doctor.push({
    id: "bible-integrity",
    name: "Bible integrity",
    status: ghostFacts > 0 ? "fail" : "pass",
    detail:
      ghostFacts > 0
        ? `${ghostFacts} memory items reference chapters beyond ch.${maxChapterIndex} — settle again or check chapter deletion.`
        : `${items.length} memory items${orphanFacts > 0 ? ` · ${orphanFacts} without a source chapter (legacy)` : " · all anchored to real chapters"}`,
  });

  // 2. Foreshadow ledger — open loops that were planted long ago and never
  //    advanced risk being forgotten promises.
  const staleLoops = rawItems.filter(
    (i) =>
      i.category === "open_loop" &&
      i.status !== "paid" &&
      i.anchorChapter === i.sourceChapter &&
      maxChapterIndex - (i.sourceChapter ?? 0) >= budgets.staleLoopChapters
  ).length;
  doctor.push({
    id: "foreshadow-ledger",
    name: "Foreshadow ledger",
    status: staleLoops > 0 ? "warn" : "pass",
    detail:
      stats.loopsOpen + stats.loopsAdvanced + stats.loopsPaid === 0
        ? "No foreshadowing planted yet."
        : `${stats.loopsOpen} open · ${stats.loopsAdvanced} advanced · ${stats.loopsPaid} paid${
            staleLoops > 0 ? ` · ${staleLoops} untouched for ≥${budgets.staleLoopChapters} chapters` : ""
          }`,
  });

  // 3. Memory coverage — written chapters should have digests to chain from.
  const writtenChapters = novel.chapters.filter((c) => c.content.trim().length > 0);
  const digested = new Set(digests.map((d) => d.chapter.index));
  const undigested = writtenChapters.filter((c) => !digested.has(c.index)).length;
  doctor.push({
    id: "memory-coverage",
    name: "Memory coverage",
    status:
      stats.facts + stats.states === 0
        ? "fail"
        : undigested > 0
          ? "warn"
          : "pass",
    detail:
      stats.facts + stats.states === 0
        ? "Memory is empty — run Review → Settle on a chapter to feed the story bible."
        : `${digests.length}/${writtenChapters.length} written chapters settled${undigested > 0 ? ` · ${undigested} missing digests` : ""}`,
  });

  // 4. Cast recognition — state memory should track known characters.
  const bibleNames = new Set(
    novel.characters.map((c) => c.name.trim().toLowerCase())
  );
  const unknownNames = new Set(
    rawItems
      .filter((i) => i.category === "character_state")
      .map((i) => i.content.split(" — ")[0]?.trim().toLowerCase() ?? "")
      .filter((n) => n.length > 0 && !bibleNames.has(n))
  );
  doctor.push({
    id: "cast-recognition",
    name: "Cast recognition",
    status: unknownNames.size > 0 ? "warn" : "pass",
    detail:
      unknownNames.size > 0
        ? `${unknownNames.size} character(s) in state memory not found in the bible cast — align names so states chain correctly.`
        : stats.states === 0
          ? "No character states settled yet."
          : `All ${stats.states} state entries map to bible characters.`,
  });

  return {
    novelId,
    items,
    digests: digests.map((d) => ({
      chapterIndex: d.chapter.index,
      title: d.chapter.title,
      summary: clipItem(d.summary, 400),
    })),
    doctor,
    stats,
    generatedAt: new Date().toISOString(),
  };
}
