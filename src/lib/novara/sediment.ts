// ---------------------------------------------------------------------------
// Novara AI — memory sediment core (Phase 2, extracted in Phase 6).
//
// Single implementation with TWO callers:
//   1. POST /api/chapters/[id]/sediment  (author-facing Review tab)
//   2. the settle_chapter agent tool     (Prism in the Phase 6 tool loop)
//
// Single writer for ChapterDigest / StoryFact / CharacterState / Foreshadow
// (single source of truth). Idempotent by design: re-running the same chapter
// replaces its digest and character states, dedupes facts by
// (category, content) and only ever advances the foreshadow state machine.
//
// Output protocol is LINE format, deliberately NOT JSON: chapter text is full
// of dialogue quotes that GLM copies into JSON strings unescaped; line format
// has no escaping problem at all (Phase 2 lesson, two 502s before the switch).
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { getBudgets } from "@/lib/novara/content";
import { glmChat } from "@/lib/novara/glm";

const MEMORY_CATEGORIES = [
  "world_rule",
  "character_state",
  "relationship",
  "story_fact",
  "open_loop",
] as const;

const SEDIMENT_SPEC_ZH = `输出格式：纯文本行，每行一条记录，严格遵守（不要 JSON、不要 Markdown、文本内不要用竖线 | 字符，引号用单引号）
SUMMARY: 本章摘要，一段话写在一行内，150-300 字
FACT: <category> | <一条独立自足的事实>
STATE: <角色名> | <本章结束时的状态/处境/认知>
PLANT: <本章新埋的伏笔，需要日后回收>
ADVANCE: <台账中伏笔的 id>
PAID: <本章兑现了承诺的伏笔 id>
category 只能取：world_rule / character_state / relationship / story_fact / open_loop
规则：facts 每条都要能独立被 AI 日后引用（含上下文，不要代词指代）；只记录本章确立或变化的事实；ADVANCE/PAID 只能引用上面台账里存在的 id；没有就省略该行。`;
const SEDIMENT_SPEC_EN = `Output format: plain text lines, one record per line, strictly (no JSON, no markdown, never use the | pipe character inside text, use single quotes for quotations):
SUMMARY: chapter summary in one line, 100-200 words
FACT: <category> | <one standalone, self-contained fact>
STATE: <character name> | <their situation/knowledge at chapter end>
PLANT: <a new hook deliberately planted, needs future payoff>
ADVANCE: <id of a ledger foreshadow advanced this chapter>
PAID: <id of a ledger foreshadow whose promise was fulfilled>
category must be one of: world_rule / character_state / relationship / story_fact / open_loop
Rules: each fact must be independently quotable later (no pronoun references); record only facts established or changed here; ADVANCE/PAID must reference ids from the ledger above; omit lines when there is nothing.`;

export interface ParsedSediment {
  summary: string;
  facts: { category: string; content: string }[];
  characterStates: { name: string; state: string }[];
  plants: { content: string }[];
  advanceIds: string[];
  paidIds: string[];
}

export const SEDIMENT_LINE = /^(SUMMARY|FACT|STATE|PLANT|ADVANCE|PAID)\s*[:：]\s*(.*)$/i;

export function parseSedimentLines(text: string): ParsedSediment {
  const summary: string[] = [];
  const facts: { category: string; content: string }[] = [];
  const characterStates: { name: string; state: string }[] = [];
  const plants: { content: string }[] = [];
  const advanceIds: string[] = [];
  const paidIds: string[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[-*•\d.)\s]+/, "");
    if (!line) continue;
    const match = line.match(SEDIMENT_LINE);
    if (!match) continue;
    const type = match[1].toUpperCase();
    const rest = match[2].trim();
    if (!rest) continue;

    if (type === "SUMMARY") {
      summary.push(rest);
    } else if (type === "FACT") {
      const sep = rest.search(/\s*\|\s*/);
      if (sep <= 0) continue;
      const category = rest.slice(0, sep).trim().toLowerCase();
      const content = rest.slice(sep).replace(/^\s*\|\s*/, "").trim();
      if (
        (MEMORY_CATEGORIES as readonly string[]).includes(category) &&
        content
      ) {
        facts.push({ category, content });
      }
    } else if (type === "STATE") {
      const sep = rest.search(/\s*\|\s*/);
      if (sep <= 0) continue;
      const name = rest.slice(0, sep).trim();
      const state = rest.slice(sep).replace(/^\s*\|\s*/, "").trim();
      if (name && state) characterStates.push({ name, state });
    } else if (type === "PLANT") {
      plants.push({ content: rest });
    } else if (type === "ADVANCE") {
      advanceIds.push(rest);
    } else if (type === "PAID") {
      paidIds.push(rest);
    }
  }

  return {
    summary: summary.join(" ").slice(0, 6000),
    facts: facts.slice(0, 24),
    characterStates: characterStates.slice(0, 24),
    plants: plants.slice(0, 12),
    advanceIds: advanceIds.slice(0, 12),
    paidIds: paidIds.slice(0, 12),
  };
}

export interface SedimentOutcome {
  digestSummary: string;
  factsCreated: number;
  factsTouched: number;
  characterStates: number;
  plantsCreated: number;
  advanced: number;
  paid: number;
}

/**
 * Settles one chapter into the memory layer. Throws on missing/empty chapter
 * or AI failure — callers map errors to their own transport (404/422/502 vs
 * an error feed).
 */
export async function sedimentChapterCore(chapterId: string): Promise<{
  chapterId: string;
  novelId: string;
  chapterIndex: number;
  sedimentedAt: string;
  result: SedimentOutcome;
}> {
  const budgets = getBudgets();
  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    include: { novel: { select: { id: true, title: true, synopsis: true } } },
  });
  if (!chapter) throw new Error("Chapter not found");
  if (!chapter.content.trim()) throw new Error("Chapter has no content to settle");

  const novel = chapter.novel;
  const openForeshadows = await db.foreshadow.findMany({
    where: { novelId: novel.id, status: { in: ["open", "advanced"] } },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { id: true, content: true, status: true, plantChapter: true },
  });

  const isChinese = /[\u4e00-\u9fff]/.test(`${novel.title}\n${novel.synopsis}`);
  const system = isChinese
    ? "你是 Novara AI 的记忆沉淀引擎。只输出纯文本记录行，严格遵守格式。"
    : "You are the Novara AI memory sediment engine. Output ONLY plain-text record lines, strictly following the format.";

  const parts: string[] = [];
  parts.push(`NOVEL: ${novel.title}`);
  if (novel.synopsis.trim())
    parts.push(`SYNOPSIS:\n${novel.synopsis.slice(0, 1000)}`);
  if (openForeshadows.length > 0) {
    parts.push(
      `OPEN FORESHADOW LEDGER (id — status — content):\n${openForeshadows
        .map((f) => `- ${f.id} — ${f.status} — ${f.content.slice(0, 200)}`)
        .join("\n")}`
    );
  }
  parts.push(`CHAPTER ${chapter.index} TEXT:\n${chapter.content.slice(0, budgets.glm.chapterContextChars)}`);
  parts.push(isChinese ? SEDIMENT_SPEC_ZH : SEDIMENT_SPEC_EN);

  const raw = await glmChat({
    messages: [
      { role: "assistant", content: system },
      { role: "user", content: parts.join("\n\n") },
    ],
    tag: "AI sediment",
  });
  const parsed = parseSedimentLines(raw);
  if (!parsed.summary) {
    throw new Error("The AI sediment output had no summary line. Try again.");
  }

  // Ledger ids must exist, belong to this novel, and not be paid already.
  const ledgerIds = new Set(openForeshadows.map((f) => f.id));
  const validAdvance = parsed.advanceIds.filter((fid) => ledgerIds.has(fid));
  const validPaid = parsed.paidIds.filter((fid) => ledgerIds.has(fid));

  const result = await db.$transaction(async (tx) => {
    // 1. Digest — upsert by unique chapterId.
    const digest = await tx.chapterDigest.upsert({
      where: { chapterId: chapter.id },
      create: {
        chapterId: chapter.id,
        novelId: novel.id,
        summary: parsed.summary,
      },
      update: { summary: parsed.summary },
    });

    // 2. Character states — replace this chapter's snapshot atomically.
    await tx.characterState.deleteMany({
      where: { novelId: novel.id, chapterIndex: chapter.index },
    });
    if (parsed.characterStates.length > 0) {
      await tx.characterState.createMany({
        data: parsed.characterStates.map((cs) => ({
          novelId: novel.id,
          name: cs.name,
          chapterIndex: chapter.index,
          state: cs.state,
        })),
      });
    }

    // 3. Facts — dedupe on (novelId, category, content): existing rows get
    // lastSeenAt touched, new rows carry sourceChapter + firstSeenAt.
    let factsCreated = 0;
    let factsTouched = 0;
    for (const fact of parsed.facts) {
      const existing = await tx.storyFact.findFirst({
        where: { novelId: novel.id, category: fact.category, content: fact.content },
        select: { id: true },
      });
      if (existing) {
        await tx.storyFact.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date(), lastSeenChapter: chapter.index },
        });
        factsTouched += 1;
      } else {
        await tx.storyFact.create({
          data: {
            novelId: novel.id,
            category: fact.category,
            content: fact.content,
            sourceChapter: chapter.index,
            lastSeenChapter: chapter.index,
          },
        });
        factsCreated += 1;
      }
    }

    // 4. Foreshadow plants — dedupe on same content + plantChapter.
    let plantsCreated = 0;
    for (const plant of parsed.plants) {
      const dup = await tx.foreshadow.findFirst({
        where: {
          novelId: novel.id,
          content: plant.content,
          plantChapter: chapter.index,
        },
        select: { id: true },
      });
      if (!dup) {
        await tx.foreshadow.create({
          data: {
            novelId: novel.id,
            content: plant.content,
            plantChapter: chapter.index,
            // Line protocol doesn't carry a pay-by deadline; the ledger
            // keeps it nullable and the doctor (Phase 4) can infer one.
            payByChapter: null,
            status: "open",
            lastChapter: chapter.index,
          },
        });
        plantsCreated += 1;
      }
    }

    // 5. Ledger state machine: open -> advanced -> paid, never backwards.
    let advanced = 0;
    let paid = 0;
    if (validAdvance.length > 0) {
      const r = await tx.foreshadow.updateMany({
        where: {
          id: { in: validAdvance },
          novelId: novel.id,
          status: { in: ["open", "advanced"] },
        },
        data: { status: "advanced", lastChapter: chapter.index },
      });
      advanced = r.count;
    }
    if (validPaid.length > 0) {
      const r = await tx.foreshadow.updateMany({
        where: {
          id: { in: validPaid },
          novelId: novel.id,
          status: { in: ["open", "advanced"] },
        },
        data: { status: "paid", lastChapter: chapter.index },
      });
      paid = r.count;
    }

    return {
      digestSummary: digest.summary,
      factsCreated,
      factsTouched,
      characterStates: parsed.characterStates.length,
      plantsCreated,
      advanced,
      paid,
    } satisfies SedimentOutcome;
  });

  return {
    chapterId: chapter.id,
    novelId: novel.id,
    chapterIndex: chapter.index,
    sedimentedAt: new Date().toISOString(),
    result,
  };
}
