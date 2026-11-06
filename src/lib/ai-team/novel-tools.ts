/**
 * Novel-creator bridge for the AI Team workspace.
 *
 * Gives every team agent (leader + specialists, in direct chats AND in
 * delegated task execution) the ability to READ and WRITE the novel
 * creator's database (Novel / Volume / Chapter / Foreshadow) through a
 * fenced ```novel-tool protocol block — mirroring the ```team-delegate
 * pattern: the block is stripped from the visible reply, the actions are
 * executed server-side, and formatted results are fed back to the model
 * so it can produce a final, data-grounded answer.
 *
 * SERVER-ONLY: imports the Prisma client directly.
 *
 * P5-g drift adaptation (agent-ctx/p5g-team1-repair-plan.md §9): the
 * restored code was written against the pre-pivot novel schema. The
 * action set and protocol are UNCHANGED; params/columns are remapped to
 * today's models — logline→synopsis, number→index, goal→brief,
 * plantedAt→plantChapter, paidAt→payByChapter, lastTouched→lastChapter,
 * title+description→content (foreshadows), bible/characters/villain/
 * masterOutline/coreConflict/timeAnchor/endHook/mustCover dropped (no
 * such columns today — those concerns live in dedicated surfaces).
 */

import { db } from "@/lib/db";
import { extractJson } from "@/lib/ai-heuristics";
import { chineseWordCount } from "@/lib/novel/server";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Max actions the model may request in one reply. */
const MAX_TOOL_CALLS = 3;
/** Per-action result budget fed back to the model (chars). */
const RESULT_CAP_READ_NOVEL = 3200;
const RESULT_CAP_READ_CHAPTER = 4000;
/** Total tool-results budget for the follow-up GLM call (user role cap is 6000). */
const TOOL_RESULTS_TOTAL_CAP = 5600;
/** Hard ceiling for chapter content written via update_chapter_content. */
const MAX_CONTENT_WRITE = 20_000;

// ---------------------------------------------------------------------------
// Protocol prompt (with live library snapshot embedded)
// ---------------------------------------------------------------------------

const ACTION_CATALOG = [
  "- list_novels {}",
  "- read_novel {novelId}",
  "- read_chapter {chapterId} or {novelId, index} or {novelTitle, index}",
  "- read_foreshadows {novelId}",
  "- create_novel {title, genre, synopsis, targetWords?}",
  "- create_chapter {novelId, index, title, brief?, content?}  // optional content creates it already written",
  "- update_novel {novelId, title?, genre?, synopsis?}",
  "- update_chapter_outline {chapterId | novelId+index, brief?}",
  "- create_foreshadow {novelId, content, plantChapter, payByChapter?}",
  "- update_foreshadow {foreshadowId, status?: open|advanced|paid, payByChapter?, lastChapter?}",
  "- update_chapter_content — DO NOT use JSON for chapter prose; use the plain-text ```novel-write block below instead",
].join("\n");

/**
 * The novel-tool protocol section appended to agent system prompts.
 * Includes a compact snapshot of the current library so the model can
 * discover ids without a round-trip for trivial questions.
 *
 * `readonly` (leaders/coordinators): read tools only — chapter prose and
 * other writes are delegated to members so every write gets a full
 * dedicated execution budget.
 */
export async function buildNovelToolPrompt(options?: {
  readonly?: boolean;
}): Promise<string> {
  const snapshot = await buildNovelLibraryContext();
  if (options?.readonly === true) {
    return [
      "NOVEL LIBRARY ACCESS (READ-ONLY) — you are connected to the novel creator's database and can READ it to check status, ids and content.",
      "Current library snapshot:",
      snapshot,
      "",
      "To read, append this block at the VERY END of your reply (it is removed from the visible text):",
      "```novel-tool",
      '{"actions":[{"action":"read_novel","params":{"novelId":"<id>"}}]}',
      "```",
      "Available actions: list_novels, read_novel {novelId}, read_chapter {chapterId | novelId+index | novelTitle+index}, read_foreshadows {novelId}.",
      "You have NO write access: DELEGATE all writes (chapter prose, outlines, foreshadows) to members via the team-delegate block, and remind them in the description to persist the work with their novel tools.",
      "After your block you will receive the tool results — then answer the user directly WITHOUT another tool block.",
    ].join("\n");
  }
  return [
    "NOVEL LIBRARY ACCESS — you are connected to the novel creator's database and can READ and WRITE it.",
    "Current library snapshot:",
    snapshot,
    "",
    "To use tools, append this block at the VERY END of your reply (it is removed from the visible text):",
    "```novel-tool",
    '{"actions":[{"action":"list_novels"},{"action":"read_chapter","params":{"chapterId":"<id>"}}]}',
    "```",
    "Available actions:",
    ACTION_CATALOG,
    "",
    "WRITING CHAPTER PROSE — use this plain-text block (NO JSON, NO escaping — the raw chapter text goes below the --- line):",
    "```novel-write",
    "chapterId: <id>",
    "---",
    "<full chapter text, plain prose>",
    "```",
    "(`novelId: <id>` + `index: <n>` may replace chapterId; `number:` is accepted as an alias. This REPLACES the whole chapter content. Max 3 blocks per reply; combine with JSON actions in the same reply when useful.)",
    "",
    "Rules: max 3 actions per reply; all writes are REAL and permanent — for large rewrites confirm scope with the user first; never invent ids, take them from the snapshot or from read results; do not use tools for pure conversation.",
    "After your block(s) you will receive the tool results — then answer the user directly WITHOUT another tool block.",
  ].join("\n");
}

/** Compact one-page summary of every novel (ids included). */
export async function buildNovelLibraryContext(): Promise<string> {
  const novels = await db.novel.findMany({
    orderBy: { updatedAt: "desc" },
    take: 12,
    include: {
      chapters: { select: { index: true, status: true, content: true } },
      _count: { select: { foreshadows: true } },
    },
  });
  if (novels.length === 0) {
    return "(empty — no novels yet; create one with create_novel)";
  }
  const lines = novels.map((novel) => {
    const written = novel.chapters.filter((ch) => ch.content.length > 0).length;
    // Per-chapter status map: defeats stale/fake "已完成" claims in chat
    // history by keeping the WHICH-chapter ground truth in every prompt.
    // Long novels fall back to counts only (prompt budget).
    let chapterMap = "";
    if (novel.chapters.length > 0 && novel.chapters.length <= 16) {
      chapterMap = ` (${novel.chapters
        .map(
          (ch) =>
            `#${ch.index}:${ch.content.length > 0 ? "written" : "unwritten"}`,
        )
        .join(",")})`;
    }
    return `• [${novel.id}] 《${novel.title}》 ${novel.genre} · ${cap(novel.synopsis, 70)} · chapters: ${written} written/${novel.chapters.length} total${chapterMap} · foreshadows: ${novel._count.foreshadows}`;
  });
  return cap(lines.join("\n"), 1800);
}

/** True when ANY novel still has a chapter without persisted prose. */
export async function hasUnwrittenChapters(): Promise<boolean> {
  const count = await db.chapter.count({
    where: { content: "" },
  });
  return count > 0;
}

/**
 * Explicit "work that still needs writing" lines (or "(none)"). Used in the
 * leader follow-up instruction so the chain targets the ACTUAL unwritten
 * chapters instead of stale/incorrect beliefs from chat history.
 */
export async function buildUnwrittenWorkSummary(): Promise<string> {
  const chapters = await db.chapter.findMany({
    where: { content: "" },
    include: { novel: { select: { title: true } } },
    orderBy: [{ novelId: "asc" }, { index: "asc" }],
    take: 12,
  });
  if (chapters.length === 0) return "(none — every chapter in the library is written)";
  return chapters
    .map(
      (ch) =>
        `《${ch.novel.title}》[novel ${ch.novelId}] 第${ch.index}章《${ch.title}》(chapter id: ${ch.id}) — brief: ${cap(ch.brief || "(no brief)", 50)}`,
    )
    .join("\n");
}

/**
 * Ultra-compact per-novel truth lines (used by completion-claim fact-checks
 * and system correction notes). Ground truth is the database itself — not
 * model memory, not task reports.
 */
export async function buildCompactLibraryTruth(): Promise<string> {
  const novels = await db.novel.findMany({
    orderBy: { updatedAt: "desc" },
    take: 8,
    include: {
      chapters: { select: { index: true, title: true, content: true } },
    },
  });
  if (novels.length === 0) return "(novel library is empty)";
  const lines = novels.map((novel) => {
    const unwritten = novel.chapters.filter((ch) => ch.content.length === 0);
    const written = novel.chapters.length - unwritten.length;
    const unwrittenLabel = unwritten
      .slice(0, 6)
      .map((ch) => `第${ch.index}章《${ch.title}》未写`)
      .join("、");
    return `《${novel.title}》已写入 ${written}/${novel.chapters.length} 章${
      unwrittenLabel ? `（${unwrittenLabel}）` : "（全部已写入）"
    }`;
  });
  return cap(lines.join("；"), 700);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface NovelToolCall {
  action: string;
  params: Record<string, unknown>;
}

/**
 * Extract ```novel-tool blocks from a reply (terminated, plus an
 * unterminated trailing block as a truncation fallback). Returns the
 * cleaned visible reply and the parsed action calls.
 */
export function parseNovelToolCalls(raw: string): {
  clean: string;
  calls: NovelToolCall[];
} {
  const calls: NovelToolCall[] = [];
  let clean = raw.replace(
    /```novel-tool\s*([\s\S]*?)```/gi,
    (_match, body: string) => {
      harvestCalls(body, calls);
      return "";
    },
  );
  const unterminated = clean.match(/```novel-tool\s*([\s\S]*)$/i);
  if (unterminated !== null) {
    harvestCalls(unterminated[1] ?? "", calls);
    clean = clean.replace(/```novel-tool\s*[\s\S]*$/i, "");
  }
  return { clean: clean.trim(), calls };
}

function harvestCalls(body: string, out: NovelToolCall[]): void {
  const parsed = extractJson<{ actions?: unknown }>(body);
  const list: unknown[] = Array.isArray(parsed?.actions)
    ? parsed.actions
    : Array.isArray(parsed)
      ? parsed
      : [];
  for (const item of list) {
    if (out.length >= MAX_TOOL_CALLS) break;
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const action = typeof record.action === "string" ? record.action.trim() : "";
    if (!action) continue;
    // Accept params nested under "params" OR flat at the action level —
    // models use both shapes; flat keys must not include "action" itself.
    const nested =
      typeof record.params === "object" && record.params !== null
        ? (record.params as Record<string, unknown>)
        : {};
    const flat: Record<string, unknown> = { ...record };
    delete flat.action;
    delete flat.params;
    out.push({ action: action.toLowerCase(), params: { ...flat, ...nested } });
  }
}

// ---------------------------------------------------------------------------
// Plain-text chapter-write protocol (```novel-write)
// ---------------------------------------------------------------------------

export interface NovelWriteCall {
  chapterId: string;
  novelId: string;
  /** Chapter index; accepted from `number:`/`index:` headers. */
  index: number;
  content: string;
}

/**
 * Extract ```novel-write blocks — the plain-text protocol for chapter
 * prose. Prose contains quotes and newlines that break JSON escaping, so
 * writes of full chapters use this zero-escaping format instead:
 *
 *   ```novel-write
 *   chapterId: <id>          (or novelId: <id> + index: <n>)
 *   ---
 *   <raw chapter text>
 *   ```
 */
export function parseNovelWriteBlocks(raw: string): {
  clean: string;
  writes: NovelWriteCall[];
} {
  const writes: NovelWriteCall[] = [];
  let clean = raw.replace(
    /```novel-write\s*([\s\S]*?)```/gi,
    (_match, body: string) => {
      harvestWriteBlock(body, writes);
      return "";
    },
  );
  const unterminated = clean.match(/```novel-write\s*([\s\S]*)$/i);
  if (unterminated !== null) {
    harvestWriteBlock(unterminated[1] ?? "", writes);
    clean = clean.replace(/```novel-write\s*[\s\S]*$/i, "");
  }
  return { clean: clean.trim(), writes };
}

function harvestWriteBlock(body: string, out: NovelWriteCall[]): void {
  if (out.length >= MAX_TOOL_CALLS) return;
  // Split the machine header from the prose body on the first --- line.
  const separator = body.match(/^---\s*$/m);
  if (!separator || separator.index === undefined) return;
  const header = body.slice(0, separator.index);
  const content = body.slice(separator.index + separator[0].length).trim();
  if (!content) return;

  let chapterId = "";
  let novelId = "";
  let index = -1;
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const key = match[1]?.toLowerCase() ?? "";
    const value = match[2]?.trim() ?? "";
    if (key === "chapterid") chapterId = value;
    else if (key === "novelid") novelId = value;
    // `index` is today's column; `number` kept as a model-friendly alias.
    else if (key === "index" || key === "number") index = Number.parseInt(value, 10);
  }
  if (out.length < MAX_TOOL_CALLS) {
    out.push({ chapterId, novelId, index: Number.isFinite(index) ? index : -1, content });
  }
}

/** Execute parsed novel-write blocks against the database. */
export async function executeNovelWrites(
  writes: NovelWriteCall[],
): Promise<NovelToolResult[]> {
  const results: NovelToolResult[] = [];
  for (const write of writes) {
    try {
      results.push(await executeOneWrite(write));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      results.push({ action: "novel-write", ok: false, summary: message });
    }
  }
  return results;
}

async function executeOneWrite(write: NovelWriteCall): Promise<NovelToolResult> {
  const action = "novel-write";
  const chapter = await resolveChapter(write as unknown as Record<string, unknown>);
  if (!chapter) {
    return fail(action, "Chapter not found (need chapterId, or novelId+index).");
  }
  const content = write.content.trim();
  if (!content) return fail(action, "content is empty.");
  if (content.length > MAX_CONTENT_WRITE) {
    return fail(action, `content too long (${content.length} > ${MAX_CONTENT_WRITE}).`);
  }
  await db.chapter.update({
    where: { id: chapter.id },
    data: {
      content,
      wordCount: chineseWordCount(content),
    },
  });
  return {
    action,
    ok: true,
    summary: `Wrote ${chineseWordCount(content)} chars into chapter ${chapter.index} 《${chapter.title}》 of 《${chapter.novel.title}》 [${chapter.id}].`,
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface NovelToolResult {
  action: string;
  ok: boolean;
  /** Readable summary — for reads this CARRIES THE DATA the model needs. */
  summary: string;
  /** P5-g: the created novel's id when action === "create_novel" succeeded —
   *  the structural side-channel the provenance hook keys on (the summary
   *  text alone is not parse-safe). Undefined for every other action. */
  novelId?: string;
}

/** Execute parsed tool calls sequentially against the database. */
export async function executeNovelToolCalls(
  calls: NovelToolCall[],
): Promise<NovelToolResult[]> {
  const results: NovelToolResult[] = [];
  for (const call of calls) {
    try {
      results.push(await executeOne(call));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      results.push({ action: call.action, ok: false, summary: message });
    }
  }
  return results;
}

async function executeOne(call: NovelToolCall): Promise<NovelToolResult> {
  const p = call.params;
  switch (call.action) {
    case "list_novels":
      return { action: call.action, ok: true, summary: await buildNovelLibraryContext() };

    case "read_novel": {
      const found = await resolveNovel(p);
      if (!found) {
        return fail(call.action, "Novel not found.", p, '{"action":"read_novel","params":{"novelId":"<id from snapshot>"}} or {"novelTitle":"<title>"}');
      }
      const novel = await db.novel.findUnique({
        where: { id: found.id },
        include: {
          volumes: { orderBy: { index: "asc" } },
          chapters: { orderBy: { index: "asc" } },
          foreshadows: { orderBy: { plantChapter: "asc" } },
        },
      });
      if (!novel) return fail(call.action, "Novel not found.", p);
      const parts: string[] = [
        `《${novel.title}》 [${novel.id}] · ${novel.genre} · targetWords ${novel.targetWords} · status ${novel.status}`,
        `Synopsis: ${novel.synopsis}`,
        novel.conceptSnapshot ? `Concept snapshot: ${cap(novel.conceptSnapshot, 700)}` : "",
        "Volumes: " + (novel.volumes.map((v) => `#${v.index} ${v.title}`).join(", ") || "(none)"),
        "Chapters:",
        ...novel.chapters.map(
          (ch) =>
            `  #${ch.index} 《${ch.title}》 [${ch.id}] [${ch.status}] wc:${ch.wordCount}${ch.brief ? ` brief:${cap(ch.brief, 40)}` : ""}`,
        ),
        "Foreshadows:",
        ...novel.foreshadows.map(
          (f) => `  [${f.id}] ${cap(f.content, 60)} (planted ch.${f.plantChapter}, ${f.status})`,
        ),
      ].filter(Boolean);
      return {
        action: call.action,
        ok: true,
        summary: cap(parts.join("\n"), RESULT_CAP_READ_NOVEL),
      };
    }

    case "read_chapter": {
      const chapter = await resolveChapter(p);
      if (!chapter) {
        return fail(
          call.action,
          "Chapter not found.",
          p,
          '{"chapterId":"<id>"} | {"novelId":"<id>","index":<n>} | {"novelTitle":"<title>","index":<n>} (ids are in the library snapshot above)',
        );
      }
      const parts = [
        `《${chapter.novel.title}》 chapter ${chapter.index}: ${chapter.title} [${chapter.id}]`,
        `Status: ${chapter.status} · wordCount: ${chapter.wordCount}`,
        chapter.brief ? `Brief: ${chapter.brief}` : "",
        "--- CONTENT ---",
        chapter.content ? cap(chapter.content, RESULT_CAP_READ_CHAPTER) : "(empty — outline only)",
      ].filter(Boolean);
      return { action: call.action, ok: true, summary: parts.join("\n") };
    }

    case "read_foreshadows": {
      const found = await resolveNovel(p);
      if (!found) {
        return fail(call.action, "Novel not found.", p, '{"novelId":"<id>"} or {"novelTitle":"<title>"}');
      }
      const novel = await db.novel.findUnique({
        where: { id: found.id },
        include: { foreshadows: { orderBy: { plantChapter: "asc" } } },
      });
      if (!novel) return fail(call.action, "Novel not found.", p);
      if (novel.foreshadows.length === 0) {
        return { action: call.action, ok: true, summary: "No foreshadows recorded." };
      }
      const lines = novel.foreshadows.map(
        (f) =>
          `• [${f.id}] ${cap(f.content, 80)} — planted ch.${f.plantChapter}, status ${f.status}${f.payByChapter ? `, pay by ch.${f.payByChapter}` : ""}${f.lastChapter ? `, last touched ch.${f.lastChapter}` : ""}`,
      );
      return { action: call.action, ok: true, summary: cap(lines.join("\n"), 1800) };
    }

    case "create_novel": {
      const title = str(p.title);
      const genre = str(p.genre);
      const synopsis = str(p.synopsis) || str(p.logline);
      if (!title || !genre || !synopsis) {
        return fail(call.action, "title, genre and synopsis are required.", p, '{"action":"create_novel","params":{"title":"<t>","genre":"<g>","synopsis":"<s>","targetWords":<n?>}}');
      }
      const targetWords = int(p.targetWords);
      const novel = await db.novel.create({
        data: {
          title: title.slice(0, 60),
          genre: genre.slice(0, 24),
          synopsis: synopsis.slice(0, 300),
          ...(targetWords > 0 ? { targetWords: Math.min(targetWords, 5_000_000) } : {}),
        },
      });
      return {
        action: call.action,
        ok: true,
        novelId: novel.id,
        summary: `Created novel 《${novel.title}》 [${novel.id}] (target ${novel.targetWords} words, no chapters yet).`,
      };
    }

    case "create_chapter": {
      const novel = await resolveNovel(p, true);
      if (!novel) {
        return fail(call.action, "Novel not found.", p, '{"novelId":"<id>","index":<n>,"title":"<t>","brief"?:<b>,"content"?:<c>} (novelTitle also accepted)');
      }
      const index = int(p.index ?? p.number ?? p.chapterNumber ?? p.num ?? p.no);
      if (index < 1 || index > 9999) return fail(call.action, "index must be 1-9999.");
      const title = str(p.title);
      if (!title) return fail(call.action, "title is required.");
      const existing = await db.chapter.findUnique({
        where: { novelId_index: { novelId: novel.id, index } },
        select: { id: true },
      });
      if (existing) return fail(call.action, `Chapter ${index} already exists.`);

      // Chapters are flat (novelId+index unique) — no volume juggling in
      // today's schema; a bare novel needs no volume to hold chapters.
      // Optional initial prose — lets an agent create AND fill a chapter
      // in one action instead of needing an extra tool round.
      const content = typeof p.content === "string" ? p.content.trim() : "";
      if (content.length > MAX_CONTENT_WRITE) {
        return fail(call.action, `content too long (${content.length} > ${MAX_CONTENT_WRITE}).`);
      }
      const brief = optStr(p.brief ?? p.goal, 300);
      const chapter = await db.chapter.create({
        data: {
          novelId: novel.id,
          index,
          title: title.slice(0, 80),
          brief: brief ?? "",
          content,
          wordCount: content ? chineseWordCount(content) : 0,
          status: "draft",
        },
      });
      return {
        action: call.action,
        ok: true,
        summary: `Created chapter ${chapter.index} 《${chapter.title}》 [${chapter.id}] in 《${novel.title}》${content ? ` with ${chineseWordCount(content)} chars of prose` : " (empty content)"}.`,
      };
    }

    case "update_novel": {
      const found = await resolveNovel(p);
      if (!found) {
        return fail(call.action, "Novel not found.", p, '{"novelId":"<id>","title"?:<t>,"genre"?:<g>,"synopsis"?:<s>} (novelTitle also accepted)');
      }
      const novel = await db.novel.findUnique({ where: { id: found.id } });
      if (!novel) return fail(call.action, "Novel not found.", p);
      const data: Record<string, string> = {};
      const simple: [string, unknown, number][] = [
        ["title", p.title, 60],
        ["genre", p.genre, 24],
        ["synopsis", p.synopsis ?? p.logline, 300],
      ];
      for (const [field, value, capLen] of simple) {
        const v = typeof value === "string" ? value.trim() : "";
        if (v) data[field] = v.slice(0, capLen);
      }
      if (Object.keys(data).length === 0) {
        return fail(call.action, "No updatable fields provided (title | genre | synopsis).");
      }
      await db.novel.update({ where: { id: novel.id }, data });
      return {
        action: call.action,
        ok: true,
        summary: `Updated 《${novel.title}》: ${Object.keys(data).join(", ")}.`,
      };
    }

    case "update_chapter_content": {
      const chapter = await resolveChapter(p);
      if (!chapter) {
        return fail(call.action, "Chapter not found.", p, '{"chapterId":"<id>","content":"<prose>"} | {"novelId":"<id>","index":<n>,"content":"<prose>"}');
      }
      const content = typeof p.content === "string" ? p.content.trim() : "";
      if (!content) return fail(call.action, "content is required.");
      if (content.length > MAX_CONTENT_WRITE) {
        return fail(call.action, `content too long (${content.length} > ${MAX_CONTENT_WRITE}).`);
      }
      await db.chapter.update({
        where: { id: chapter.id },
        data: {
          content,
          wordCount: chineseWordCount(content),
        },
      });
      return {
        action: call.action,
        ok: true,
        summary: `Wrote ${chineseWordCount(content)} chars into chapter ${chapter.index} 《${chapter.title}》 of novel ${chapter.novelId} [${chapter.id}].`,
      };
    }

    case "update_chapter_outline": {
      const chapter = await resolveChapter(p);
      if (!chapter) {
        return fail(call.action, "Chapter not found.", p, '{"chapterId":"<id>","brief":"<writing brief>"} | {"novelId":"<id>","index":<n>,"brief":"<writing brief>"}');
      }
      const brief = optStr(p.brief ?? p.goal, 2000);
      if (!brief) {
        return fail(call.action, "No outline fields provided (brief).");
      }
      await db.chapter.update({ where: { id: chapter.id }, data: { brief } });
      return {
        action: call.action,
        ok: true,
        summary: `Updated outline (brief) of chapter ${chapter.index} 《${chapter.title}》.`,
      };
    }

    case "create_foreshadow": {
      const found = await resolveNovel(p);
      if (!found) {
        return fail(call.action, "Novel not found.", p, '{"novelId":"<id>","content":"<the foreshadow>","plantChapter":<n>,"payByChapter"?:<n>} (novelTitle also accepted)');
      }
      const novel = await db.novel.findUnique({ where: { id: found.id } });
      if (!novel) return fail(call.action, "Novel not found.", p);
      const content = str(p.content) || [str(p.title), str(p.description)].filter(Boolean).join("：");
      const plantChapter = int(p.plantChapter ?? p.plantedAt);
      if (!content || plantChapter < 1) {
        return fail(call.action, "content and plantChapter (>=1) are required.");
      }
      const payByChapter = optInt(p.payByChapter ?? p.paidAt);
      const foreshadow = await db.foreshadow.create({
        data: {
          novelId: novel.id,
          content: content.slice(0, 500),
          plantChapter: Math.min(plantChapter, 9999),
          ...(payByChapter !== null ? { payByChapter: Math.min(payByChapter, 9999) } : {}),
        },
      });
      return {
        action: call.action,
        ok: true,
        summary: `Created foreshadow [${foreshadow.id}] "${cap(foreshadow.content, 50)}" planted at ch.${foreshadow.plantChapter} in 《${novel.title}》.`,
      };
    }

    case "update_foreshadow": {
      const foreshadow = await db.foreshadow.findUnique({
        where: { id: str(p.foreshadowId) || str(p.id) },
      });
      if (!foreshadow) {
        return fail(call.action, "Foreshadow not found.", p, '{"foreshadowId":"<id from read_foreshadows>","status":"open|advanced|paid"}');
      }
      const data: Record<string, number | string> = {};
      if (typeof p.status === "string") {
        if (!["open", "advanced", "paid"].includes(p.status)) {
          return fail(call.action, "status must be open|advanced|paid.");
        }
        data.status = p.status;
      }
      const payByChapter = optInt(p.payByChapter ?? p.paidAt);
      if (payByChapter !== null) data.payByChapter = payByChapter;
      const lastChapter = optInt(p.lastChapter ?? p.lastTouched);
      if (lastChapter !== null) data.lastChapter = lastChapter;
      if (Object.keys(data).length === 0) {
        return fail(call.action, "No updatable fields provided.");
      }
      await db.foreshadow.update({ where: { id: foreshadow.id }, data });
      return {
        action: call.action,
        ok: true,
        summary: `Updated foreshadow [${foreshadow.id}]: ${Object.keys(data).join(", ")}.`,
      };
    }

    default:
      return fail(call.action, `Unknown action "${call.action}".`);
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format tool results into one block that doubles as (a) the data payload
 * fed back to the model for its final answer and (b) the transparency log
 * persisted into the conversation.
 */
export function formatToolResults(results: NovelToolResult[]): string {
  const lines = results.map(
    (result) => `• ${result.action} → ${result.ok ? result.summary : `ERROR: ${result.summary}`}`,
  );
  return cap(`🔧 Novel tools used:\n${lines.join("\n")}`, TOOL_RESULTS_TOTAL_CAP);
}

// ---------------------------------------------------------------------------
// Write evidence
// ---------------------------------------------------------------------------

/** Tool actions that mutate the novel library (persistence receipts). */
const WRITE_TOOL_ACTIONS: ReadonlySet<string> = new Set([
  "novel-write",
  "create_novel",
  "create_chapter",
  "update_novel",
  "update_chapter_content",
  "update_chapter_outline",
  "create_foreshadow",
  "update_foreshadow",
]);

export function isWriteAction(action: string): boolean {
  return WRITE_TOOL_ACTIONS.has(action);
}

/**
 * Human-readable receipts of SUCCESSFUL database writes — the ground truth
 * behind any "已完成" claim (chapter ids, char counts, targets).
 */
export function collectWriteEvidence(results: NovelToolResult[]): string[] {
  return results
    .filter((result) => result.ok && isWriteAction(result.action))
    .map((result) => `${result.action} → ${result.summary}`);
}

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

function fail(
  action: string,
  summary: string,
  params?: Record<string, unknown>,
  usage?: string,
): NovelToolResult {
  // Self-correction contract: every failure echoes WHAT it received and HOW
  // to call the action correctly, so the model's next round can fix itself
  // without guessing.
  const received =
    params && Object.keys(params).length > 0
      ? ` Received: ${JSON.stringify(params).slice(0, 200)}.`
      : "";
  const hint = usage ? ` Usage: ${usage}` : "";
  return { action, ok: false, summary: `${summary}${received}${hint}` };
}

/**
 * Resolve a novel by explicit id (with common key aliases) or by title
 * (exact match first, then a unique contains-match).
 */
async function resolveNovel(p: Record<string, unknown>, withVolumes = false) {
  const include = withVolumes
    ? ({ volumes: { orderBy: { index: "asc" } } } as const)
    : undefined;
  const novelId = str(p.novelId) || str(p.novel) || str(p.bookId);
  if (novelId) {
    return db.novel.findUnique({ where: { id: novelId }, include });
  }
  const novelTitle = str(p.novelTitle) || str(p.title) || str(p.bookTitle);
  if (!novelTitle) return null;
  const candidates = await db.novel.findMany({
    where: { OR: [{ title: novelTitle }, { title: { contains: novelTitle } }] },
    include,
    take: 5,
  });
  return (
    candidates.find((candidate) => candidate.title === novelTitle) ??
    (candidates.length === 1 ? candidates[0] : null)
  );
}

/**
 * Resolve a chapter by explicit id OR by novelId+index (models naturally
 * refer to chapters as "第3章", so index-based access avoids id guessing).
 * Accepts `index` and the legacy alias `number`/`num`/`no`.
 */
async function resolveChapter(p: Record<string, unknown>) {
  const chapterId = str(p.chapterId) || str(p.id);
  if (chapterId) {
    return db.chapter.findUnique({
      where: { id: chapterId },
      include: { novel: { select: { title: true } } },
    });
  }
  const index = int(p.index ?? p.number ?? p.chapterNumber ?? p.num ?? p.no);
  if (index < 1) return null;
  const novelId = str(p.novelId) || str(p.novel) || str(p.bookId);
  if (novelId) {
    return db.chapter.findUnique({
      where: { novelId_index: { novelId, index } },
      include: { novel: { select: { title: true } } },
    });
  }
  // Fallback: resolve the novel by title (exact first, then unique contains).
  const novelTitle = str(p.novelTitle) || str(p.title) || str(p.bookTitle);
  if (!novelTitle) return null;
  const candidates = await db.novel.findMany({
    where: { OR: [{ title: novelTitle }, { title: { contains: novelTitle } }] },
    select: { id: true, title: true },
    take: 5,
  });
  const novel =
    candidates.find((c) => c.title === novelTitle) ??
    (candidates.length === 1 ? candidates[0] : null);
  if (!novel) return null;
  return db.chapter.findUnique({
    where: { novelId_index: { novelId: novel.id, index } },
    include: { novel: { select: { title: true } } },
  });
}

function cap(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)} …(truncated)`;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optStr(value: unknown, max: number): string | undefined {
  const v = str(value);
  return v ? v.slice(0, max) : undefined;
}

function int(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.trunc(n) : -1;
}

function optInt(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = int(value);
  return n >= 0 ? n : null;
}
