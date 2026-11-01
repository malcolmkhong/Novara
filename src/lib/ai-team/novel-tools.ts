/**
 * Novel-creator bridge for the AI Team workspace.
 *
 * Gives every team agent (leader + specialists, in direct chats AND in
 * delegated task execution) the ability to READ and WRITE the novel
 * creator's database (Novel / Volume / NovelChapter / Foreshadow) through
 * a fenced ```novel-tool protocol block — mirroring the ```team-delegate
 * pattern: the block is stripped from the visible reply, the actions are
 * executed server-side, and formatted results are fed back to the model
 * so it can produce a final, data-grounded answer.
 *
 * SERVER-ONLY: imports the Prisma client directly.
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
const RESULT_CAP_DEFAULT = 800;
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
  "- read_chapter {chapterId} or {novelId, number}",
  "- read_foreshadows {novelId}",
  "- create_novel {title, genre, logline, targetChapters?}",
  "- create_chapter {novelId, number, title, goal?, timeAnchor?, endHook?, content?}  // optional content creates it already drafted",
  "- update_novel {novelId, title?, genre?, logline?, coreConflict?, bible?, characters?, villain?, masterOutline?}  // bible/characters/villain/masterOutline must be JSON objects",
  "- update_chapter_content {chapterId | novelId+number, content}  // FULL replacement text of the chapter prose",
  "- update_chapter_outline {chapterId | novelId+number, goal?, timeAnchor?, mustCover?[], endHook?}",
  "- create_foreshadow {novelId, title, description, plantedAt}",
  "- update_foreshadow {foreshadowId, status?: open|advanced|paid, paidAt?, lastTouched?}",
].join("\n");

/**
 * The novel-tool protocol section appended to agent system prompts.
 * Includes a compact snapshot of the current library so the model can
 * discover ids without a round-trip for trivial questions.
 */
export async function buildNovelToolPrompt(): Promise<string> {
  const snapshot = await buildNovelLibraryContext();
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
    "Rules: max 3 actions per reply; all writes are REAL and permanent — for large rewrites confirm scope with the user first; never invent ids, take them from the snapshot or from read results; do not use tools for pure conversation.",
    "After your block you will receive the tool results — then answer the user directly WITHOUT another tool block.",
  ].join("\n");
}

/** Compact one-page summary of every novel (ids included). */
export async function buildNovelLibraryContext(): Promise<string> {
  const novels = await db.novel.findMany({
    orderBy: { updatedAt: "desc" },
    take: 12,
    include: {
      chapters: { select: { status: true } },
      _count: { select: { foreshadows: true } },
    },
  });
  if (novels.length === 0) {
    return "(empty — no novels yet; create one with create_novel)";
  }
  const lines = novels.map((novel) => {
    const written = novel.chapters.filter(
      (ch) => ch.status === "drafted" || ch.status === "final",
    ).length;
    const outlined = novel.chapters.filter((ch) => ch.status === "outlined").length;
    return `• [${novel.id}] 《${novel.title}》 ${novel.genre} · ${cap(novel.logline, 70)} · chapters: ${written} written/${outlined} outlined/${novel.chapters.length} total · foreshadows: ${novel._count.foreshadows}`;
  });
  return cap(lines.join("\n"), 1800);
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
  const list = Array.isArray(parsed?.actions)
    ? parsed.actions
    : Array.isArray(parsed)
      ? (parsed as unknown)
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
    const flat = { ...record };
    delete flat.action;
    delete flat.params;
    out.push({ action: action.toLowerCase(), params: { ...flat, ...nested } });
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface NovelToolResult {
  action: string;
  ok: boolean;
  /** Readable summary — for reads this CARRIES THE DATA the model needs. */
  summary: string;
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
      const novel = await db.novel.findUnique({
        where: { id: str(p.novelId) },
        include: {
          volumes: { orderBy: { index: "asc" } },
          chapters: { orderBy: { number: "asc" } },
          foreshadows: { orderBy: { plantedAt: "asc" } },
        },
      });
      if (!novel) return fail(call.action, "Novel not found.");
      const parts: string[] = [
        `《${novel.title}》 [${novel.id}] · ${novel.genre} · target ${novel.targetChapters} chapters`,
        `Logline: ${novel.logline}`,
        novel.coreConflict ? `Core conflict: ${novel.coreConflict}` : "",
        novel.bible ? `Bible JSON: ${cap(novel.bible, 700)}` : "",
        novel.characters ? `Characters JSON: ${cap(novel.characters, 700)}` : "",
        novel.villain ? `Villain JSON: ${cap(novel.villain, 400)}` : "",
        novel.masterOutline ? `Master outline JSON: ${cap(novel.masterOutline, 900)}` : "",
        "Volumes: " + novel.volumes.map((v) => `#${v.index} ${v.name}(ch${v.startChapter}-${v.endChapter})`).join(", "),
        "Chapters:",
        ...novel.chapters.map(
          (ch) =>
            `  #${ch.number} 《${ch.title}》 [${ch.id}] [${ch.status}] wc:${ch.wordCount}${ch.goal ? ` goal:${cap(ch.goal, 40)}` : ""}`,
        ),
        "Foreshadows:",
        ...novel.foreshadows.map(
          (f) => `  [${f.id}] ${f.title} (planted ch.${f.plantedAt}, ${f.status})`,
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
      if (!chapter) return fail(call.action, "Chapter not found (need chapterId, or novelId+number).");
      const parts = [
        `《${chapter.novel.title}》 chapter ${chapter.number}: ${chapter.title} [${chapter.id}]`,
        `Status: ${chapter.status} · wordCount: ${chapter.wordCount} · revision: ${chapter.revision}`,
        chapter.goal ? `Goal: ${chapter.goal}` : "",
        chapter.timeAnchor ? `Time anchor: ${chapter.timeAnchor}` : "",
        chapter.mustCover ? `Must cover JSON: ${chapter.mustCover}` : "",
        chapter.endHook ? `End hook: ${chapter.endHook}` : "",
        chapter.summary ? `Memory summary: ${cap(chapter.summary, 400)}` : "",
        "--- CONTENT ---",
        chapter.content ? cap(chapter.content, RESULT_CAP_READ_CHAPTER) : "(empty — outline only)",
      ].filter(Boolean);
      return { action: call.action, ok: true, summary: parts.join("\n") };
    }

    case "read_foreshadows": {
      const novel = await db.novel.findUnique({
        where: { id: str(p.novelId) },
        include: { foreshadows: { orderBy: { plantedAt: "asc" } } },
      });
      if (!novel) return fail(call.action, "Novel not found.");
      if (novel.foreshadows.length === 0) {
        return { action: call.action, ok: true, summary: "No foreshadows recorded." };
      }
      const lines = novel.foreshadows.map(
        (f) =>
          `• [${f.id}] ${f.title} — planted ch.${f.plantedAt}, status ${f.status}${f.lastTouched ? `, last touched ch.${f.lastTouched}` : ""}${f.paidAt ? `, paid ch.${f.paidAt}` : ""} · ${cap(f.description, 80)}`,
      );
      return { action: call.action, ok: true, summary: cap(lines.join("\n"), 1800) };
    }

    case "create_novel": {
      const title = str(p.title);
      const genre = str(p.genre);
      const logline = str(p.logline);
      if (!title || !genre || !logline) {
        return fail(call.action, "title, genre and logline are required.");
      }
      const targetChapters = clampInt(p.targetChapters, 8, 300, 24);
      const novel = await db.novel.create({
        data: {
          title: title.slice(0, 60),
          genre: genre.slice(0, 24),
          logline: logline.slice(0, 300),
          targetChapters,
        },
      });
      return {
        action: call.action,
        ok: true,
        summary: `Created novel 《${novel.title}》 [${novel.id}] (target ${novel.targetChapters} chapters, no volumes/chapters yet).`,
      };
    }

    case "create_chapter": {
      const novel = await db.novel.findUnique({
        where: { id: str(p.novelId) },
        include: { volumes: { orderBy: { index: "asc" } } },
      });
      if (!novel) return fail(call.action, "Novel not found.");
      const number = int(p.number);
      if (number < 1 || number > 9999) return fail(call.action, "number must be 1-9999.");
      const title = str(p.title);
      if (!title) return fail(call.action, "title is required.");
      const existing = await db.novelChapter.findUnique({
        where: { novelId_number: { novelId: novel.id, number } },
        select: { id: true },
      });
      if (existing) return fail(call.action, `Chapter ${number} already exists.`);

      // Find the volume covering this number; create volume 1 when the
      // novel has none (agents may create bare novels via create_novel).
      let volume =
        novel.volumes.find((v) => number >= v.startChapter && number <= v.endChapter) ??
        novel.volumes[0] ??
        null;
      if (!volume) {
        volume = await db.volume.create({
          data: {
            novelId: novel.id,
            index: 1,
            name: "第一卷",
            startChapter: 1,
            endChapter: Math.max(number, novel.targetChapters),
          },
        });
      }
      // Optional initial prose — lets an agent create AND fill a chapter
      // in one action instead of needing an extra tool round.
      const content = typeof p.content === "string" ? p.content.trim() : "";
      if (content.length > MAX_CONTENT_WRITE) {
        return fail(call.action, `content too long (${content.length} > ${MAX_CONTENT_WRITE}).`);
      }
      const chapter = await db.novelChapter.create({
        data: {
          novelId: novel.id,
          volumeId: volume.id,
          number,
          title: title.slice(0, 80),
          goal: optStr(p.goal, 300),
          timeAnchor: optStr(p.timeAnchor, 120),
          endHook: optStr(p.endHook, 300),
          content: content || null,
          wordCount: content ? chineseWordCount(content) : 0,
          status: content ? "drafted" : "outlined",
        },
      });
      return {
        action: call.action,
        ok: true,
        summary: `Created chapter ${chapter.number} 《${chapter.title}》 [${chapter.id}] in 《${novel.title}》${content ? ` with ${chineseWordCount(content)} chars of prose (status drafted)` : " (outlined, empty content)"}.`,
      };
    }

    case "update_novel": {
      const novel = await db.novel.findUnique({ where: { id: str(p.novelId) } });
      if (!novel) return fail(call.action, "Novel not found.");
      const data: Record<string, string> = {};
      const simple: [string, unknown][] = [
        ["title", p.title],
        ["genre", p.genre],
        ["logline", p.logline],
        ["coreConflict", p.coreConflict],
      ];
      for (const [field, value] of simple) {
        const v = typeof value === "string" ? value.trim() : "";
        if (v) data[field] = v.slice(0, field === "logline" ? 300 : 80);
      }
      // Structured fields must stay valid JSON — the creator UI parses them.
      for (const field of ["bible", "characters", "villain", "masterOutline"] as const) {
        const value = p[field];
        if (value === undefined || value === null) continue;
        const jsonString =
          typeof value === "string" ? value : JSON.stringify(value);
        try {
          JSON.parse(jsonString);
        } catch {
          return fail(call.action, `${field} must be a valid JSON object/string.`);
        }
        data[field] = jsonString;
      }
      if (Object.keys(data).length === 0) {
        return fail(call.action, "No updatable fields provided.");
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
      if (!chapter) return fail(call.action, "Chapter not found (need chapterId, or novelId+number).");
      const content = typeof p.content === "string" ? p.content.trim() : "";
      if (!content) return fail(call.action, "content is required.");
      if (content.length > MAX_CONTENT_WRITE) {
        return fail(call.action, `content too long (${content.length} > ${MAX_CONTENT_WRITE}).`);
      }
      await db.novelChapter.update({
        where: { id: chapter.id },
        data: {
          content,
          wordCount: chineseWordCount(content),
          status: chapter.status === "outlined" ? "drafted" : chapter.status,
        },
      });
      return {
        action: call.action,
        ok: true,
        summary: `Wrote ${chineseWordCount(content)} chars into chapter ${chapter.number} 《${chapter.title}》 of novel ${chapter.novelId} [${chapter.id}].`,
      };
    }

    case "update_chapter_outline": {
      const chapter = await resolveChapter(p);
      if (!chapter) return fail(call.action, "Chapter not found (need chapterId, or novelId+number).");
      const data: Record<string, string | undefined> = {};
      if (typeof p.goal === "string" && p.goal.trim()) data.goal = p.goal.trim().slice(0, 300);
      if (typeof p.timeAnchor === "string" && p.timeAnchor.trim()) data.timeAnchor = p.timeAnchor.trim().slice(0, 120);
      if (typeof p.endHook === "string" && p.endHook.trim()) data.endHook = p.endHook.trim().slice(0, 300);
      if (p.mustCover !== undefined && p.mustCover !== null) {
        const jsonString =
          typeof p.mustCover === "string" ? p.mustCover : JSON.stringify(p.mustCover);
        try {
          const parsed: unknown = JSON.parse(jsonString);
          if (!Array.isArray(parsed)) throw new Error("not an array");
        } catch {
          return fail(call.action, "mustCover must be a JSON string array.");
        }
        data.mustCover = jsonString;
      }
      if (Object.keys(data).length === 0) {
        return fail(call.action, "No outline fields provided.");
      }
      await db.novelChapter.update({ where: { id: chapter.id }, data });
      return {
        action: call.action,
        ok: true,
        summary: `Updated outline of chapter ${chapter.number} 《${chapter.title}》: ${Object.keys(data).join(", ")}.`,
      };
    }

    case "create_foreshadow": {
      const novel = await db.novel.findUnique({ where: { id: str(p.novelId) } });
      if (!novel) return fail(call.action, "Novel not found.");
      const title = str(p.title);
      const description = str(p.description);
      const plantedAt = int(p.plantedAt);
      if (!title || !description || plantedAt < 1) {
        return fail(call.action, "title, description and plantedAt (>=1) are required.");
      }
      const foreshadow = await db.foreshadow.create({
        data: {
          novelId: novel.id,
          title: title.slice(0, 80),
          description: description.slice(0, 500),
          plantedAt: Math.min(plantedAt, 9999),
        },
      });
      return {
        action: call.action,
        ok: true,
        summary: `Created foreshadow [${foreshadow.id}] "${foreshadow.title}" planted at ch.${foreshadow.plantedAt} in 《${novel.title}》.`,
      };
    }

    case "update_foreshadow": {
      const foreshadow = await db.foreshadow.findUnique({ where: { id: str(p.foreshadowId) } });
      if (!foreshadow) return fail(call.action, "Foreshadow not found.");
      const data: Record<string, number | string> = {};
      if (typeof p.status === "string") {
        if (!["open", "advanced", "paid"].includes(p.status)) {
          return fail(call.action, "status must be open|advanced|paid.");
        }
        data.status = p.status;
      }
      const paidAt = optInt(p.paidAt);
      if (paidAt !== null) data.paidAt = paidAt;
      const lastTouched = optInt(p.lastTouched);
      if (lastTouched !== null) data.lastTouched = lastTouched;
      if (Object.keys(data).length === 0) {
        return fail(call.action, "No updatable fields provided.");
      }
      await db.foreshadow.update({ where: { id: foreshadow.id }, data });
      return {
        action: call.action,
        ok: true,
        summary: `Updated foreshadow "${foreshadow.title}" [${foreshadow.id}]: ${Object.keys(data).join(", ")}.`,
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
// Param helpers
// ---------------------------------------------------------------------------

function fail(action: string, summary: string): NovelToolResult {
  return { action, ok: false, summary };
}

/**
 * Resolve a chapter by explicit id OR by novelId+number (models naturally
 * refer to chapters as "第3章", so number-based access avoids id guessing).
 */
async function resolveChapter(p: Record<string, unknown>) {
  const chapterId = str(p.chapterId);
  if (chapterId) {
    return db.novelChapter.findUnique({
      where: { id: chapterId },
      include: { novel: { select: { title: true } } },
    });
  }
  const novelId = str(p.novelId);
  const number = int(p.number);
  if (!novelId || number < 1) return null;
  return db.novelChapter.findUnique({
    where: { novelId_number: { novelId, number } },
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

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = int(value);
  if (n < min) return fallback;
  return Math.min(n, max);
}
