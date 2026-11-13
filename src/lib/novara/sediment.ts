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
// of dialogue quotes that AI copies into JSON strings unescaped; line format
// has no escaping problem at all (Phase 2 lesson, two 502s before the switch).
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { getBudgets } from "@/lib/novara/content";
import { chatCompletion } from "@/lib/ai/chat";
import { closePaidLoops, listOpenLoops } from "@/lib/novara/open-loops";
import { buildSedimentWindows, mergeSedimentRecords, NEAR_DUPLICATE_THRESHOLD, similarity } from "@/lib/novara/sediment-windows";

/**
 * The transaction client the ownership-extended db hands to $transaction.
 * Derived from the client itself (the extension changes the delegate types,
 * so a plain Prisma.TransactionClient is NOT assignable to it).
 */
export type SedimentTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

const MEMORY_CATEGORIES = [
  "world_rule",
  "character_state",
  "relationship",
  "story_fact",
  "open_loop",
  "decision",
  "style",
  "dialogue",
  "inspiration",
] as const;

const SEDIMENT_SPEC_ZH = `输出格式：纯文本行，每行一条记录，严格遵守（不要 JSON、不要 Markdown、文本内不要用竖线 | 字符，引号用单引号）
SUMMARY: 本章摘要，一段话写在一行内，150-300 字
FACT: <category> | <一条独立自足的事实>
FACT: <category> | <主题> | <一条独立自足的事实>    ← world_rule / story_fact / relationship 必须写三段，第二段是这条事实的「主题」（人名/地名/物件名）
STATE: <角色名> | <本章结束时的状态/处境/认知>
PLANT: <本章新埋的伏笔，需要日后回收>
ADVANCE: <台账中伏笔的 id>
PAID: <本章兑现了承诺的伏笔 id>
PAID_LOOP: <本章兑现的承诺或线索 id> | <本章兑现的证据>
category 只能取：world_rule / story_fact / relationship / open_loop / decision / style / dialogue / inspiration
  world_rule=世界与背景的硬规则；story_fact=剧情事实；relationship=人物关系变化；open_loop=未了结的悬念/承诺（若对应上面「未兑现承诺」里的某一条，主题写那条的 id）；decision=本章做出的影响后续走向的关键决策（选了什么、放弃什么）；style=本章确立或遵循的文风/叙事规则（节奏、视角、句式偏好）；dialogue=角色说话方式的约束（口癖、语气、称呼）；inspiration=值得日后记住的点子。
  角色状态只写 STATE 行，不要写成 FACT。
规则：facts 每条都要能独立被 AI 日后引用（含上下文，不要代词指代）；只记录本章确立或变化的事实；world_rule / story_fact / relationship 必须写「主题」，主题就是这条事实说的那个东西的名字（如「林舟」「霜脉回廊」「7号铁路枢纽」）；同一主题的新事实会取代旧事实，所以主题要一致；ADVANCE/PAID 只能引用上面台账里存在的 id；PAID_LOOP 只能引用上面「未兑现承诺」列表里存在的 id（可以带 promise/clue 前缀），且只在本章正文确实兑现了它时才写；没有就省略该行。`;
const SEDIMENT_SPEC_EN = `Output format: plain text lines, one record per line, strictly (no JSON, no markdown, never use the | pipe character inside text, use single quotes for quotations):
SUMMARY: chapter summary in one line, 100-200 words
FACT: <category> | <one standalone, self-contained fact>
FACT: <category> | <subject> | <one standalone, self-contained fact>    ← world_rule / story_fact / relationship MUST have three fields; the second is the SUBJECT (the name of the thing the fact is about)
STATE: <character name> | <their situation/knowledge at chapter end>
PLANT: <a new hook deliberately planted, needs future payoff>
ADVANCE: <id of a ledger foreshadow advanced this chapter>
PAID: <id of a ledger foreshadow whose promise was fulfilled>
PAID_LOOP: <id of an open promise or clue this chapter visibly paid> | <the evidence in this chapter>
category must be one of: world_rule / story_fact / relationship / open_loop / decision / style / dialogue / inspiration
  world_rule=hard world/background rules; story_fact=plot facts; relationship=relationship changes; open_loop=unresolved suspense/promises (if it is one of the OPEN LOOPS above, the subject is that loop's id); decision=key choices made this chapter that steer what follows (what was chosen, what was abandoned); style=narrative/style rules established or followed (pacing, POV, sentence habits); dialogue=speech constraints for characters (verbal tics, tone, forms of address); inspiration=ideas worth remembering later.
  A character's situation goes in a STATE line, never in a FACT line.
Rules: each fact must be independently quotable later (no pronoun references); record only facts established or changed here; world_rule / story_fact / relationship MUST name the SUBJECT — the thing the fact is about (e.g. 'Lin Zhou', 'the relay station', 'Sector Nine'); a newer fact about the same subject replaces the older one, so keep the subject consistent; ADVANCE/PAID must reference ids from the ledger above; PAID_LOOP must reference an id from the OPEN LOOPS list above (bare id, or with its promise/clue prefix) and only when this chapter's prose actually paid it; omit lines when there is nothing.`;

export interface ParsedSediment {
  summary: string;
  facts: { category: string; subject: string; content: string }[];
  characterStates: { name: string; state: string }[];
  plants: { content: string }[];
  advanceIds: string[];
  paidIds: string[];
  /** STEP 70 — the open promise/clue ids the chapter visibly PAID, with the
   *  evidence the model cites. Never inferred by keyword matching: the model
   *  states it. */
  paidPromises: { id: string; evidence: string }[];
  /** STEP 72 — how many near-identical records the merge collapsed. */
  nearDuplicatesMerged?: number;
  /** STEP 72 — the near-duplicate pairs the merge collapsed (for the report). */
  nearDuplicatePairs?: import("@/lib/novara/sediment-windows").NearDuplicateMerge[];
}

/**
 * STEP 72 — the categories that ROT: their truth changes when the world
 * changes, so the old row must stop being live when a newer row covers the
 * same subject.
 */
export const ROT_PRONE_CATEGORIES = ["world_rule", "story_fact", "relationship"] as const;

/**
 * STEP 72 — the categories that do NOT rot: a decision, a style rule, a
 * speech constraint and an idea stay true once written. Append-only.
 */
export const APPEND_ONLY_CATEGORIES = ["decision", "style", "dialogue", "inspiration"] as const;

export const SEDIMENT_LINE = /^(SUMMARY|FACT|STATE|PLANT|ADVANCE|PAID|PAID_LOOP)\s*[:：]\s*(.*)$/i;

export function parseSedimentLines(text: string): ParsedSediment {
  const summary: string[] = [];
  const facts: { category: string; subject: string; content: string }[] = [];
  const characterStates: { name: string; state: string }[] = [];
  const plants: { content: string }[] = [];
  const advanceIds: string[] = [];
  const paidIds: string[] = [];
  const paidPromises: { id: string; evidence: string }[] = [];

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
      const tail = rest.slice(sep).replace(/^\s*\|\s*/, "").trim();
      if (!(MEMORY_CATEGORIES as readonly string[]).includes(category) || !tail) continue;
      // STEP 72 — the SUBJECT. The model writes the thing the fact is about
      // as the second field:
      //   FACT: <category> | <subject> | <content>
      // The subject is the model's own name for the thing (a person, a place,
      // an object) — never a keyword guess. For the ROT-PRONE categories it
      // is load-bearing (it groups the live lines); for the append-only
      // ones it is only recorded.
      let subject = "";
      let content = tail;
      const secondSep = tail.search(/\s*\|\s*/);
      if (secondSep > 0) {
        subject = tail.slice(0, secondSep).trim();
        content = tail.slice(secondSep).replace(/^\s*\|\s*/, "").trim();
      }
      facts.push({ category, subject, content });
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
    } else if (type === "PAID_LOOP") {
      // STEP 70 — <id> | <evidence>. The id must be an open promise or clue
      // of this novel; the evidence is archived with the transition. The
      // model may write the bare id or the id with its kind prefix
      // ("promise cmw…" / "clue cmw…") — both are accepted.
      const sep = rest.search(/\s*\|\s*/);
      if (sep <= 0) continue;
      const id = rest
        .slice(0, sep)
        .trim()
        .replace(/^(?:promise|clue)\s+/i, "")
        .trim();
      const evidence = rest.slice(sep).replace(/^\s*\|\s*/, "").trim();
      if (id) paidPromises.push({ id, evidence });
    }
  }

  return {
    summary: summary.join(" ").slice(0, 6000),
    facts: facts.slice(0, 24),
    characterStates: characterStates.slice(0, 24),
    plants: plants.slice(0, 12),
    advanceIds: advanceIds.slice(0, 12),
    paidIds: paidIds.slice(0, 12),
    paidPromises: paidPromises.slice(0, 12),
  };
}

export interface SedimentOutcome {
  digestSummary: string;
  factsCreated: number;
  factsTouched: number;
  /** STEP 72 — live rows retired (superseded by a newer subject, or a paid loop). */
  factsRetired: number;
  /**
   * STEP 80 — the chapter's OWN facts retired at the start of the projection
   * (the replacement rule: a re-finalize replaces, it never adds).
   */
  factsRetiredBySource: number;
  /**
   * STEP 80 — retired own rows brought back to live by the extraction (the
   * same fact, re-used instead of duplicated).
   */
  factsReused: number;
  /** STEP 72 — character_state facts NOT written (the CharacterState table has them). */
  characterStateFactsSkipped: number;
  /** STEP 72 — rot-prone facts with no subject: they stay live (no guess). */
  subjectlessFacts: number;
  characterStates: number;
  plantsCreated: number;
  advanced: number;
  paid: number;
  /** STEP 70 — open promises / clues this settle closed (the model paid them). */
  loopsPaid: number;
}

/**
 * Phase 7 (P1) — resolve a STATE name to its canonical bible character.
 * Without this, "林晚" vs "晚姐" splits CharacterState snapshots across name
 * keys and the latest-state logic in memory.ts loses track. Exact name match
 * wins; alias match (comma-separated `Character.aliases`) resolves to the
 * canonical name. Unknown names pass through unchanged (the doctor flags them).
 */
async function normalizeCharacterNames(
  novelId: string,
  names: string[]
): Promise<Map<string, string>> {
  const characters = await db.character.findMany({
    where: { novelId },
    select: { name: true, aliases: true },
  });
  const aliasToCanonical = new Map<string, string>();
  for (const c of characters) {
    aliasToCanonical.set(c.name.trim().toLowerCase(), c.name);
    for (const alias of c.aliases.split(/[,，、;]/)) {
      const a = alias.trim().toLowerCase();
      if (a) aliasToCanonical.set(a, c.name);
    }
  }
  const resolved = new Map<string, string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    resolved.set(name, aliasToCanonical.get(key) ?? name);
  }
  return resolved;
}

/**
 * The memory records one settle produced — the INPUT of the projection write.
 *
 * Two halves on purpose (STEP 69): the model call is slow and can fail, so
 * it must never happen inside a database transaction; the row writes are
 * cheap and MUST share the caller's transaction, so a chapter can never
 * become final without its memory.
 */
export interface SedimentRecords {
  chapterId: string;
  novelId: string;
  chapterIndex: number;
  summary: string;
  /** STEP 72 — the facts carry the SUBJECT the model named ("" = none). */
  facts: { category: string; subject: string; content: string }[];
  /** Character states with CANONICAL bible names (aliases folded in). */
  characterStates: { name: string; state: string }[];
  plants: { content: string }[];
  /** Foreshadow ids this settle may advance / pay (validated against the ledger). */
  validAdvance: string[];
  validPaid: string[];
  /** STEP 70 — the open promise/clue ids the model says this chapter paid,
   *  with its evidence. Only ids that exist as open loops of this novel. */
  paidPromises: { id: string; evidence: string }[];
  /** STEP 72 — how many near-identical records the merge collapsed. */
  nearDuplicatesMerged?: number;
  /** STEP 72 — the near-duplicate pairs the merge collapsed (for the report). */
  nearDuplicatePairs?: import("@/lib/novara/sediment-windows").NearDuplicateMerge[];
}

/**
 * STEP 69 — the EXTRACTION half of a settle: read the chapter, ask the model
 * for its memory records, parse them, fold character names onto the bible and
 * validate the ledger ids.
 *
 * NO DATABASE WRITES. The caller owns the transaction — the runtime folds the
 * write into the same transaction as the chapter's finalization, so a failed
 * projection rolls the finalization back.
 */
export async function extractSediment(chapterId: string): Promise<SedimentRecords> {
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
  // STEP 70 — the open loops (promises + clues) go into the prompt so the
  // model can STATE which one this chapter paid (PAID_LOOP). Without the ids
  // it could not name them, and we never infer by keyword matching.
  const openLoops = await listOpenLoops(novel.id, { limit: 12 });

  const isChinese = /[一-鿿]/.test(`${novel.title}\n${novel.synopsis}`);
  const system = isChinese
    ? "你是 Novara AI 的记忆沉淀引擎。只输出纯文本记录行，严格遵守格式。"
    : "You are the Novara AI memory sediment engine. Output ONLY plain-text record lines, strictly following the format.";

  const head: string[] = [];
  head.push(`NOVEL: ${novel.title}`);
  if (novel.synopsis.trim())
    head.push(`SYNOPSIS:\n${novel.synopsis.slice(0, 1000)}`);
  if (openForeshadows.length > 0) {
    head.push(
      `OPEN FORESHADOW LEDGER (id — status — content):\n${openForeshadows
        .map((f) => `- ${f.id} — ${f.status} — ${f.content.slice(0, 200)}`)
        .join("\n")}`
    );
  }
  if (openLoops.promises.length > 0 || openLoops.clues.length > 0) {
    const loopLines = [
      ...openLoops.promises.map(
        (p) => `- promise ${p.id} — ${p.status} — ${p.title.slice(0, 200)}`
      ),
      ...openLoops.clues.map(
        (c) => `- clue ${c.id} — ${c.status} — ${c.title.slice(0, 200)}`
      ),
    ];
    head.push(
      `${isChinese ? "未兑现承诺（OPEN LOOPS）" : "OPEN LOOPS"} (id — status — content):\n${loopLines.join("\n")}`
    );
  }

  // STEP 71 — THE EXTRACTOR MUST READ THE WHOLE CHAPTER.
  //
  // The chapter is cut into OVERLAPPING, SENTENCE-ALIGNED windows and each
  // window is extracted on its own. A chapter that fits in ONE window is
  // extracted exactly as before (one call, same prompt, same result).
  //
  // The windows are extracted SEQUENTIALLY: a window that fails fails the
  // whole extraction — the caller never receives records, so nothing is ever
  // projected half.
  const windows = buildSedimentWindows(
    chapter.content,
    budgets.ai.sedimentWindowChars,
    budgets.ai.sedimentWindowOverlapChars
  );

  const perWindow: SedimentRecords[] = [];
  for (const window of windows) {
    // The gateway throttles repeated calls in a short window — without this
    // pause the third window stalled past the per-call timeout (measured,
    // three times in a row). One pause between windows, never after the last.
    if (window.index > 0 && budgets.ai.sedimentWindowPauseMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, budgets.ai.sedimentWindowPauseMs)
      );
    }
    const parts = [...head];
    if (windows.length === 1) {
      parts.push(`CHAPTER ${chapter.index} TEXT:\n${window.text}`);
    } else {
      // STEP 71 — a window is a PART of the chapter. The state lines must
      // say where the character stands at the END OF THIS PART, so the merge
      // (last window that saw the character wins) yields the chapter-end
      // state — the same thing the single-call extraction produced.
      parts.push(
        `CHAPTER ${chapter.index} TEXT (part ${window.part} of ${window.totalParts}):\n${window.text}`
      );
      parts.push(
        isChinese
          ? `这是本章的第 ${window.part}/${window.totalParts} 段。请为本段中出现的每个角色各写一行 STATE，描述他在【本段结束】时的状态；只有最后一段才到全章结尾。`
          : `This is part ${window.part} of ${window.totalParts} of the chapter. Write one STATE line for EVERY character who appears in this part, describing where they stand at the END OF THIS PART; only the last part reaches the end of the chapter.`
      );
    }
    parts.push(isChinese ? SEDIMENT_SPEC_ZH : SEDIMENT_SPEC_EN);

    // STEP 72 — A STALLED WINDOW RETRIES BEFORE IT FAILS.
    //
    // One window can stall the gateway (measured: a 3rd call in a burst
    // stalled past 120s). Before STEP 72 that killed the whole extraction,
    // the finalize was refused and the chapter silently stayed draft. Now
    // the window is retried (4s, then 10s) and only then does the
    // extraction fail — in plain words, with the window index.
    //
    // The inner chatCompletion retry is DISABLED here (maxRetries: 0): one
    // retry policy per layer, not two stacked (9 attempts per window).
    let raw = "";
    let lastError: unknown;
    for (let attempt = 0; attempt <= WINDOW_RETRY_BACKOFF_MS.length; attempt += 1) {
      try {
        const result = await chatCompletion({
          messages: [
            { role: "assistant", content: system },
            { role: "user", content: parts.join("\n\n") },
          ],
          // The window index in the tag: a slow or failing window must be
          // identifiable in the error and in the usage ledger.
          tag:
            windows.length === 1
              ? "AI sediment"
              : `AI sediment p${window.part}/${window.totalParts}`,
          surface: "sediment",
          // STEP 71 — the provider's latency varies wildly; the global 60s
          // ceiling killed whole extractions. The windows get their own.
          timeoutMs: budgets.ai.sedimentTimeoutMs,
          // STEP 72 — the window owns its retries.
          maxRetries: 0,
          // P5 — sediment spend lands on the novel in the ledger.
          ledger: { novelId: novel.id },
        });
        raw = result.text;
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        const backoff = WINDOW_RETRY_BACKOFF_MS[attempt];
        if (backoff === undefined) break;
        console.warn(
          `[sediment] window ${window.part}/${window.totalParts} failed (attempt ${attempt + 1}/${WINDOW_RETRY_BACKOFF_MS.length + 1}) — retrying in ${backoff}ms: ${error instanceof Error ? error.message : error}`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
    if (lastError !== undefined || !raw) {
      const reason =
        lastError instanceof Error ? lastError.message : "no completion returned";
      throw new Error(
        `the memory step failed after ${WINDOW_RETRY_BACKOFF_MS.length + 1} attempts (window ${window.part}/${window.totalParts} of ${windows.length}); the chapter is not finalised — ${reason}`
      );
    }

    const parsed = parseSedimentLines(raw);
    if (!parsed.summary) {
      throw new Error(
        `the memory step failed after ${WINDOW_RETRY_BACKOFF_MS.length + 1} attempts (window ${window.part}/${window.totalParts} of ${windows.length}); the chapter is not finalised — the model returned no summary line`
      );
    }

    // Phase 7 (P1) — fold STATE names into canonical bible names via aliases
    // so snapshots chain per character instead of per name spelling.
    const nameMap = await normalizeCharacterNames(
      novel.id,
      parsed.characterStates.map((cs) => cs.name)
    );
    const characterStates = parsed.characterStates.map((cs) => ({
      ...cs,
      name: nameMap.get(cs.name) ?? cs.name,
    }));

    // Ledger ids must exist, belong to this novel, and not be paid already.
    const ledgerIds = new Set(openForeshadows.map((f) => f.id));
    const validAdvance = parsed.advanceIds.filter((fid) => ledgerIds.has(fid));
    const validPaid = parsed.paidIds.filter((fid) => ledgerIds.has(fid));

    // STEP 70 — keep only the paid-loop ids that are real open loops of this
    // novel. The model STATES them; we never infer by keyword matching.
    const loopIds = new Set([
      ...openLoops.promises.map((p) => p.id),
      ...openLoops.clues.map((c) => c.id),
    ]);
    const paidPromises = parsed.paidPromises.filter((p) => loopIds.has(p.id));

    perWindow.push({
      chapterId: chapter.id,
      novelId: novel.id,
      chapterIndex: chapter.index,
      summary: parsed.summary,
      facts: parsed.facts,
      characterStates,
      plants: parsed.plants,
      validAdvance,
      validPaid,
      paidPromises,
    });
  }

  // The merge happens HERE, before the caller's transaction: the projection
  // still runs ONCE, on the merged records.
  const merged = mergeSedimentRecords(perWindow);

  // STEP 72 — ONE DIGEST, NOT A STITCH.
  //
  // The merged summary is the window summaries concatenated (3-5x longer than
  // a single-call digest), so the memory block's 500-char clip cuts it
  // earlier than before and the recap ends up SHORTER than it used to be.
  //
  // The chosen fix (a): ONE extra model call authors a whole-chapter digest
  // FROM THE MERGED FACTS. The stitch is not shipped. A chapter that fit in
  // ONE window is skipped — its single summary IS a whole-chapter digest, so
  // paying another call there would buy nothing.
  if (windows.length > 1) {
    const digest = await authorChapterDigest({
      novelId: novel.id,
      novelTitle: novel.title,
      isChinese,
      facts: merged.facts,
      states: merged.characterStates,
      stitch: merged.summary,
    });
    if (digest) merged.summary = digest;
  }

  return merged;
}

/** STEP 72 — the backoff between the window's retries: 4s, then 10s. */
const WINDOW_RETRY_BACKOFF_MS = [4_000, 10_000];

/**
 * STEP 72 — one extra model call that writes the whole-chapter digest from
 * the merged records. Returns null when the call fails (the stitched summary
 * is kept — a digest is not worth failing an extraction over).
 */
async function authorChapterDigest(input: {
  novelId: string;
  novelTitle: string;
  isChinese: boolean;
  facts: SedimentRecords["facts"];
  states: SedimentRecords["characterStates"];
  stitch: string;
}): Promise<string | null> {
  const factLines = input.facts
    .map((f) => `- [${f.category}]${f.subject ? ` (${f.subject})` : ""} ${f.content}`)
    .join("\n");
  const stateLines = input.states
    .map((s) => `- ${s.name}: ${s.state}`)
    .join("\n");
  const prompt = input.isChinese
    ? `以下是本章已抽取的记忆记录。请据此写一段【本章摘要】，一段话写在一行内，150-300 字，概括本章发生了什么（人物、行动、转折、结果）。不要罗列记录，不要加标题，不要用竖线 | 字符。\n\n记忆记录：\n${factLines}\n\n角色状态：\n${stateLines}`
    : `Below are the extracted memory records of one chapter. Write the CHAPTER SUMMARY from them: one paragraph on a single line, 100-200 words, covering what happened (who acted, what changed, how it ended). Do not list the records, do not add a heading, never use the | pipe character.\n\nRECORDS:\n${factLines}\n\nCHARACTER STATES:\n${stateLines}`;
  try {
    const { text } = await chatCompletion({
      messages: [
        {
          role: "assistant",
          content: input.isChinese
            ? "你是 Novara AI 的章节摘要引擎。只输出一行摘要文本。"
            : "You are the Novara AI chapter digest engine. Output one line of summary text only.",
        },
        { role: "user", content: prompt },
      ],
      tag: "AI sediment digest",
      surface: "sediment",
      timeoutMs: getBudgets().ai.sedimentTimeoutMs,
      maxRetries: 0,
      ledger: { novelId: input.novelId },
    });
    const digest = text.trim().split("\n")[0]?.trim();
    return digest ? digest.slice(0, 2000) : null;
  } catch (error) {
    console.warn(
      `[sediment] the chapter digest call failed — keeping the stitched summary: ${error instanceof Error ? error.message : error}`
    );
    return null;
  }
}

/**
 * The WRITE half of a settle: digest, character states, facts, plants and the
 * foreshadow state machine, on the CALLER's transaction.
 *
 * Idempotent by construction (see the module header): the digest upserts by
 * the unique chapterId, the character states of the chapter are replaced
 * atomically, facts dedupe on (novelId, category, content) and plants dedupe
 * on (content, plantChapter). The foreshadow state machine only ever moves
 * forward (open → advanced → paid).
 */
export async function writeSedimentProjection(
  tx: SedimentTx,
  records: SedimentRecords
): Promise<SedimentOutcome> {
  const {
    chapterId,
    novelId,
    chapterIndex,
    summary,
    facts,
    characterStates,
    plants,
    validAdvance,
    validPaid,
    paidPromises,
  } = records;

  // 1. Digest — upsert by unique chapterId.
  const digest = await tx.chapterDigest.upsert({
    where: { chapterId },
    create: { chapterId, novelId, summary },
    update: { summary },
  });

  // 2. Character states — replace this chapter's snapshot atomically.
  await tx.characterState.deleteMany({
    where: { novelId, chapterIndex },
  });
  if (characterStates.length > 0) {
    await tx.characterState.createMany({
      data: characterStates.map((cs) => ({
        novelId,
        name: cs.name,
        chapterIndex,
        state: cs.state,
      })),
    });
  }

  // 3. Facts — ONE LIVE LINE PER SUBJECT (STEP 72).
  //
  //   · character_state is NOT written as a fact at all: the CharacterState
  //     table already stores the latest state per character per chapter and
  //     the memory pool reads it from there. The fact copies were the
  //     biggest source of rot.
  //   · world_rule / story_fact / relationship ROT: when a new record
  //     covers the same SUBJECT, the older row is retired (retiredAt set)
  //     instead of staying live. The subject is the model's own name for
  //     the thing — never a keyword guess. A record with no subject stays
  //     live and is counted (the settle reports it).
  //   · decision / style / dialogue / inspiration do not rot: append-only.
  //   · exact-content dedupe still applies to every category.
  let factsCreated = 0;
  let factsTouched = 0;
  let factsRetired = 0;
  let characterStateFactsSkipped = 0;
  let subjectlessFacts = 0;

  // STEP 80 — REPLACEMENT, NOT ADDITION.
  //
  // Re-finalizing a chapter must not leave its old facts live next to the
  // new ones: STEP 79's own probe showed a no-op re-finalize growing the
  // pool by 24% (25 → 31 rows for one chapter with no text change).
  //
  // Every live fact whose SOURCE is this chapter is retired HERE, inside the
  // caller's transaction — the finalize path flips the status, retires and
  // writes in one atomic unit, so a crash can never leave a chapter final
  // with its old facts retired and its new facts missing. A failed model
  // call never reaches this point at all (the extraction runs before the
  // transaction), so a failed settle writes nothing.
  //
  // The retired rows are not thrown away: they are the REUSE POOL below.
  // The extraction re-uses the row that carries the same fact (exact
  // content) or the row that is a near-duplicate of it (the STEP 72
  // token-overlap rule), so an identical re-finalize leaves the live count
  // exactly where it was instead of doubling it.
  const ownFacts = await retireOwnFacts(tx, novelId, chapterIndex);
  const factsRetiredBySource = ownFacts.count;
  let factsReused = 0;
  const reusePool = new Map<string, (typeof ownFacts.rows)[number]>();
  for (const row of ownFacts.rows) {
    reusePool.set(ownFactKey(row.category, row.content), row);
  }

  for (const fact of facts) {
    if (fact.category === "character_state") {
      // The STATE lines carry this; the CharacterState table holds it.
      characterStateFactsSkipped += 1;
      continue;
    }
    const subject = fact.subject.trim();
    const rotProne = (ROT_PRONE_CATEGORIES as readonly string[]).includes(fact.category);
    if (!subject && rotProne) {
      // No subject, no supersede — and never a guess. Counted and reported.
      subjectlessFacts += 1;
    }
    const existing = await tx.storyFact.findFirst({
      where: {
        novelId,
        category: fact.category,
        content: fact.content,
        retiredAt: null,
      },
      select: { id: true, subject: true },
    });
    if (existing) {
      await tx.storyFact.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          lastSeenChapter: chapterIndex,
          // The model named the subject now — adopt it (an old row written
          // before the subject existed gets one).
          ...(subject && !existing.subject ? { subject } : {}),
        },
      });
      factsTouched += 1;
      // The row we just touched is the live line for this subject — retire
      // the OTHER live rows about the same subject.
      if (subject && rotProne) {
        factsRetired += await retireSuperseded(tx, {
          novelId,
          category: fact.category,
          subject,
          keepId: existing.id,
        });
      }
      continue;
    }

    // STEP 80 — the row THIS CHAPTER wrote last time, retired by the
    // replacement above. If the extraction says the SAME thing, the row
    // comes back to life instead of a second copy being written.
    const poolKey = ownFactKey(fact.category, fact.content);
    const pooled = reusePool.get(poolKey);
    if (pooled) {
      reusePool.delete(poolKey);
      await tx.storyFact.update({
        where: { id: pooled.id },
        data: {
          retiredAt: null,
          lastSeenAt: new Date(),
          lastSeenChapter: chapterIndex,
          // The model named the subject now — adopt it (an old row written
          // before the subject existed gets one).
          ...(subject && !pooled.subject ? { subject } : {}),
        },
      });
      factsReused += 1;
      factsTouched += 1;
      // The row we just brought back is the live line for this subject.
      if (subject && rotProne) {
        factsRetired += await retireSuperseded(tx, {
          novelId,
          category: fact.category,
          subject,
          keepId: pooled.id,
        });
      }
      continue;
    }

    // STEP 72 — the NEAR-DUPLICATE reinforcement (rot-prone categories).
    //
    // The same fact, reworded by a later extraction, must not become a
    // second live row. The subject rule alone cannot catch it: the model
    // names the same thing differently across runs (measured: "极寒气候" in
    // one run, "骤冻断崖" in the next). The same token-overlap rule the
    // merge uses (>= 0.6) catches it: the LONGER statement wins, the other
    // rows are retired, and the row keeps its place.
    //
    // The append-only categories are left alone — a decision does not rot.
    if (rotProne) {
      const candidates = await tx.storyFact.findMany({
        where: { novelId, category: fact.category, retiredAt: null },
        select: { id: true, category: true, content: true, subject: true },
      });
      // STEP 80 — the chapter's own retired rows join the candidate list: a
      // fact the model REWORDED must merge into the row this chapter already
      // owns, not become a third copy.
      const poolCandidates = [...reusePool.values()].filter(
        (r) => r.category === fact.category
      );
      const poolIds = new Set(poolCandidates.map((r) => r.id));
      const near = [...candidates, ...poolCandidates].filter(
        (c) => similarity(c.content, fact.content) >= NEAR_DUPLICATE_THRESHOLD
      );
      if (near.length > 0) {
        let best = near[0];
        for (const c of near) if (c.content.length > best.content.length) best = c;
        const keepNew = fact.content.length > best.content.length;
        const fromPool = poolIds.has(best.id);
        await tx.storyFact.update({
          where: { id: best.id },
          data: {
            ...(keepNew ? { content: fact.content } : {}),
            lastSeenAt: new Date(),
            lastSeenChapter: chapterIndex,
            // The newer extraction's name for the thing wins the grouping.
            ...(subject ? { subject } : {}),
            // STEP 80 — the row comes back to live: the replacement.
            ...(fromPool ? { retiredAt: null } : {}),
          },
        });
        if (fromPool) {
          reusePool.delete(ownFactKey(best.category, best.content));
          factsReused += 1;
        }
        for (const c of near) {
          if (c.id === best.id) continue;
          // STEP 80 — a pool row is already retired; retiring it again would
          // count it twice.
          if (poolIds.has(c.id)) continue;
          await tx.storyFact.update({
            where: { id: c.id },
            data: { retiredAt: new Date() },
          });
          factsRetired += 1;
        }
        factsTouched += 1;
        if (subject) {
          factsRetired += await retireSuperseded(tx, {
            novelId,
            category: fact.category,
            subject,
            keepId: best.id,
          });
        }
        continue;
      }
    }

    if (subject && rotProne) {
      factsRetired += await retireSuperseded(tx, {
        novelId,
        category: fact.category,
        subject,
      });
    }
    await tx.storyFact.create({
      data: {
        novelId,
        category: fact.category,
        content: fact.content,
        subject: subject || null,
        sourceChapter: chapterIndex,
        lastSeenChapter: chapterIndex,
      },
    });
    factsCreated += 1;
  }

  // 4. Foreshadow plants — dedupe on same content + plantChapter.
  let plantsCreated = 0;
  for (const plant of plants) {
    const dup = await tx.foreshadow.findFirst({
      where: {
        novelId,
        content: plant.content,
        plantChapter: chapterIndex,
      },
      select: { id: true },
    });
    if (!dup) {
      await tx.foreshadow.create({
        data: {
          novelId,
          content: plant.content,
          plantChapter: chapterIndex,
          // Line protocol doesn't carry a pay-by deadline; the ledger
          // keeps it nullable and the doctor (Phase 4) can infer one.
          payByChapter: null,
          status: "open",
          lastChapter: chapterIndex,
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
        novelId,
        status: { in: ["open", "advanced"] },
      },
      data: { status: "advanced", lastChapter: chapterIndex },
    });
    advanced = r.count;
  }
  if (validPaid.length > 0) {
    const r = await tx.foreshadow.updateMany({
      where: {
        id: { in: validPaid },
        novelId,
        status: { in: ["open", "advanced"] },
      },
      data: { status: "paid", lastChapter: chapterIndex },
    });
    paid = r.count;
  }

  // 6. STEP 70 — the open-loop ledger: the promises / clues this chapter
  // visibly PAID, as the model stated them. Same one-way machine, same
  // transaction: the chapter's memory and the loops it closes commit
  // together.
  const loops = await closePaidLoops({
    novelId,
    paid: paidPromises,
    actor: "agent",
    chapterIndex,
    tx,
  });
  const loopsPaid = loops.closed.length;

  // 7. STEP 72 — a loop that has been PAID must stop being retrievable.
  // The fact that carried it (an open_loop fact whose subject is that loop)
  // is retired HERE, in the same transaction that closed the loop. The
  // subject is the model's own name for the loop (its id from the OPEN
  // LOOPS list, or the loop's exact text) — never a keyword guess.
  for (const closed of loops.closed) {
    factsRetired += await retireSuperseded(tx, {
      novelId,
      category: "open_loop",
      subject: closed.id,
    });
    if (closed.title) {
      factsRetired += await retireSuperseded(tx, {
        novelId,
        category: "open_loop",
        subject: closed.title,
      });
    }
  }

  // 8. STEP 72 — the character_state FACT copies are retired. They are no
  // longer written (the CharacterState table holds the truth and the memory
  // pool reads it from there); the copies that older settles left behind are
  // the rot this rule removes. Retired, not deleted — the trail stays.
  factsRetired += await retireCategory(tx, novelId, "character_state");

  // STEP 80 — the net effect of the replacement: the rows that were retired
  // by source and did NOT come back. A row that came back and was retired
  // again in the same projection is counted by the counter that retired it.
  factsRetired += factsRetiredBySource - factsReused;

  return {
    digestSummary: digest.summary,
    factsCreated,
    factsTouched,
    factsRetired,
    factsRetiredBySource,
    factsReused,
    characterStateFactsSkipped,
    subjectlessFacts,
    characterStates: characterStates.length,
    plantsCreated,
    advanced,
    paid,
    loopsPaid,
  } satisfies SedimentOutcome;
}

/**
 * STEP 72 — retire every live row of one category for a novel. Used for the
 * character_state fact copies, which are no longer written at all.
 */
async function retireCategory(
  tx: SedimentTx,
  novelId: string,
  category: string
): Promise<number> {
  const rows = await tx.storyFact.findMany({
    where: { novelId, category, retiredAt: null },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  await tx.storyFact.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { retiredAt: new Date() },
  });
  return rows.length;
}

/**
 * STEP 72 — retire the live rows of one subject: set retiredAt, keep the row
 * (the trail), stop it being retrievable. Returns how many rows were retired.
 */
export async function retireSuperseded(
  tx: SedimentTx,
  input: { novelId: string; category: string; subject: string; keepId?: string }
): Promise<number> {
  if (!input.subject) return 0;
  const rows = await tx.storyFact.findMany({
    where: {
      novelId: input.novelId,
      category: input.category,
      subject: input.subject,
      retiredAt: null,
      ...(input.keepId ? { NOT: { id: input.keepId } } : {}),
    },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  await tx.storyFact.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { retiredAt: new Date() },
  });
  return rows.length;
}

/**
 * STEP 80 — the replacement rule: retire every LIVE fact whose SOURCE is
 * this chapter, and hand the retired rows back so the projection can re-use
 * them instead of writing a second copy.
 *
 * The source column is the chapter INDEX (StoryFact.sourceChapter). Only
 * facts this chapter wrote are touched — a fact sourced from another chapter
 * is never retired here, so the STEP 72 supersede (by category + subject)
 * keeps working across chapters.
 *
 * Called INSIDE the caller's transaction: with the finalize path it is the
 * same transaction that flips the status, so the chapter can never become
 * final with its old facts retired and its new facts missing.
 */
export async function retireOwnFacts(
  tx: SedimentTx,
  novelId: string,
  chapterIndex: number
): Promise<{
  rows: { id: string; category: string; content: string; subject: string | null }[];
  count: number;
}> {
  const rows = await tx.storyFact.findMany({
    where: { novelId, sourceChapter: chapterIndex, retiredAt: null },
    select: { id: true, category: true, content: true, subject: true },
  });
  if (rows.length === 0) return { rows: [], count: 0 };
  await tx.storyFact.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { retiredAt: new Date() },
  });
  return { rows, count: rows.length };
}

/** STEP 80 — the reuse-pool key: one fact is (category, content). */
function ownFactKey(category: string, content: string): string {
  return `${category}\u0000${content}`;
}

/**
 * STEP 69 — is this chapter's memory already projected for its CURRENT
 * content? A digest newer than the chapter's last write means yes.
 *
 * This is the idempotency probe: it lets the runtime skip the model call
 * when the projection is already in place.
 */
export async function isProjectionCurrent(chapterId: string): Promise<boolean> {
  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    select: { updatedAt: true },
  });
  if (!chapter) return false;
  const digest = await db.chapterDigest.findUnique({
    where: { chapterId },
    select: { updatedAt: true },
  });
  return !!digest && digest.updatedAt.getTime() >= chapter.updatedAt.getTime();
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
  const records = await extractSediment(chapterId);
  const result = await db.$transaction((tx) => writeSedimentProjection(tx, records));
  return {
    chapterId: records.chapterId,
    novelId: records.novelId,
    chapterIndex: records.chapterIndex,
    sedimentedAt: new Date().toISOString(),
    result,
  };
}