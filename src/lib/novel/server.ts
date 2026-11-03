/**
 * Server-side helpers shared by the novel API routes: DB-row → view
 * mappers (defensive JSON decoding), volume-coverage normalization, and
 * memory-context collectors for the write/sediment/review briefs.
 */
import { db } from "@/lib/db";
import type { ForeshadowRef } from "./prompts";
import type {
  ChapterReview,
  ChapterView,
  ForeshadowView,
  MasterVolume,
  NovelCharacter,
  NovelDetail,
  NovelVillain,
  VolumeBeat,
  VolumeView,
} from "./types";

// ---------------------------------------------------------------------------
// Defensive JSON column decoding
// ---------------------------------------------------------------------------

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  return parseJsonSafe<string[]>(raw, []).filter(
    (item): item is string => typeof item === "string",
  );
}

function parseCharStates(
  raw: string | null | undefined,
): { name: string; change: string }[] {
  const list = parseJsonSafe<{ name?: unknown; change?: unknown }[]>(raw, []);
  return list
    .filter(
      (item): item is { name: string; change: string } =>
        typeof item?.name === "string" &&
        item.name.trim().length > 0 &&
        typeof item?.change === "string",
    )
    .map((item) => ({ name: item.name, change: item.change }));
}

function parseBeats(raw: string | null | undefined): VolumeBeat[] {
  const list = parseJsonSafe<Partial<VolumeBeat>[]>(raw, []);
  return list
    .filter(
      (item): item is VolumeBeat =>
        typeof item?.title === "string" && item.title.trim().length > 0,
    )
    .map((item) => ({
      phase: typeof item.phase === "string" ? item.phase : "节拍",
      title: item.title,
      description: typeof item.description === "string" ? item.description : "",
    }));
}

function parseReview(raw: string | null | undefined): ChapterReview | null {
  const parsed = parseJsonSafe<Partial<ChapterReview> | null>(raw, null);
  if (!parsed || typeof parsed.overallScore !== "number") return null;
  return {
    overallScore: parsed.overallScore,
    dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions : [],
    blocking: Array.isArray(parsed.blocking) ? parsed.blocking : [],
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === "string")
      : [],
    consistencyFlags: Array.isArray(parsed.consistencyFlags)
      ? parsed.consistencyFlags.filter((s): s is string => typeof s === "string")
      : [],
  };
}

function parseBible(raw: string | null | undefined) {
  const parsed = parseJsonSafe<Partial<NovelDetail["bible"]> | null>(raw, null);
  if (!parsed) return null;
  return {
    world: typeof parsed.world === "string" ? parsed.world : "",
    power: typeof parsed.power === "string" ? parsed.power : "",
    goldenFinger:
      typeof parsed.goldenFinger === "string" ? parsed.goldenFinger : "",
    themes: Array.isArray(parsed.themes)
      ? parsed.themes.filter((t): t is string => typeof t === "string")
      : [],
  };
}

function parseCharacters(raw: string | null | undefined): NovelCharacter[] {
  const list = parseJsonSafe<Partial<NovelCharacter>[]>(raw, []);
  return list
    .filter(
      (item): item is NovelCharacter =>
        typeof item?.name === "string" && item.name.trim().length > 0,
    )
    .map((item) => ({
      name: item.name,
      role: typeof item.role === "string" ? item.role : "配角",
      desire: typeof item.desire === "string" ? item.desire : "",
      flaw: typeof item.flaw === "string" ? item.flaw : "",
      arc: typeof item.arc === "string" ? item.arc : "",
    }));
}

function parseVillain(raw: string | null | undefined): NovelVillain | null {
  const parsed = parseJsonSafe<Partial<NovelVillain> | null>(raw, null);
  if (!parsed || typeof parsed.name !== "string") return null;
  return {
    name: parsed.name,
    scheme: typeof parsed.scheme === "string" ? parsed.scheme : "",
    mirror: typeof parsed.mirror === "string" ? parsed.mirror : "",
  };
}

// ---------------------------------------------------------------------------
// Row → view mappers
// ---------------------------------------------------------------------------

type ChapterRow = {
  id: string;
  number: number;
  title: string;
  volumeId: string;
  goal: string | null;
  timeAnchor: string | null;
  mustCover: string | null;
  endHook: string | null;
  content: string | null;
  wordCount: number;
  summary: string | null;
  facts: string | null;
  charStates: string | null;
  review: string | null;
  status: string;
  revision: number;
};

export function chapterToView(row: ChapterRow): ChapterView {
  const status =
    row.status === "final" ? "final" : row.status === "drafted" ? "drafted" : "outlined";
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    volumeId: row.volumeId,
    goal: row.goal,
    timeAnchor: row.timeAnchor,
    mustCover: parseStringArray(row.mustCover),
    endHook: row.endHook,
    content: row.content,
    wordCount: row.wordCount,
    summary: row.summary,
    facts: parseStringArray(row.facts),
    charStates: parseCharStates(row.charStates),
    review: parseReview(row.review),
    status,
    revision: row.revision,
  };
}

type VolumeRow = {
  id: string;
  index: number;
  name: string;
  startChapter: number;
  endChapter: number;
  coreConflict: string | null;
  climax: string | null;
  hook: string | null;
  beats: string | null;
  planned: boolean;
};

export function volumeToView(row: VolumeRow): VolumeView {
  return {
    id: row.id,
    index: row.index,
    name: row.name,
    startChapter: row.startChapter,
    endChapter: row.endChapter,
    coreConflict: row.coreConflict,
    climax: row.climax,
    hook: row.hook,
    beats: parseBeats(row.beats),
    planned: row.planned,
  };
}

type ForeshadowRow = {
  id: string;
  title: string;
  description: string;
  plantedAt: number;
  lastTouched: number | null;
  status: string;
  paidAt: number | null;
};

export function foreshadowToView(row: ForeshadowRow): ForeshadowView {
  const status =
    row.status === "paid" ? "paid" : row.status === "advanced" ? "advanced" : "open";
  return { ...row, status };
}

type ForeshadowModelRow = {
  id: string;
  novelId?: string;
  title: string;
  description: string;
  plantedAt: number;
  lastTouched: number | null;
  status: string;
  paidAt: number | null;
};

export function foreshadowToRef(row: ForeshadowModelRow): ForeshadowRef {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    plantedAt: row.plantedAt,
  };
}

type NovelRow = {
  id: string;
  title: string;
  genre: string;
  logline: string;
  coreConflict: string | null;
  targetChapters: number;
  platform: string | null;
  bible: string | null;
  characters: string | null;
  villain: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Load the full book aggregate for the studio UI. Returns null when the
 * book does not exist.
 */
export async function loadNovelDetail(id: string): Promise<NovelDetail | null> {
  const novel = await db.novel.findUnique({
    where: { id },
    include: {
      volumes: { orderBy: { index: "asc" } },
      chapters: { orderBy: { number: "asc" } },
      foreshadows: { orderBy: { plantedAt: "asc" } },
    },
  });
  if (!novel) return null;

  const row = novel as NovelRow & {
    volumes: VolumeRow[];
    chapters: ChapterRow[];
    foreshadows: ForeshadowModelRow[];
  };

  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    logline: row.logline,
    coreConflict: row.coreConflict,
    targetChapters: row.targetChapters,
    platform: row.platform,
    bible: parseBible(row.bible),
    characters: parseCharacters(row.characters),
    villain: parseVillain(row.villain),
    volumes: row.volumes.map(volumeToView),
    chapters: row.chapters.map(chapterToView),
    foreshadows: row.foreshadows.map(foreshadowToView),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Master-outline normalization (defensive against GLM range mistakes)
// ---------------------------------------------------------------------------

/**
 * Ensure the volume list is a perfect partition of chapters 1..target.
 * If GLM's ranges already form one, keep them; otherwise re-partition
 * evenly (last volume takes the remainder) while preserving names/conflicts.
 */
export function normalizeVolumes(
  parsed: MasterVolume[],
  targetChapters: number,
  volumeCount: number,
): MasterVolume[] {
  // Perfect-partition check.
  if (parsed.length === volumeCount) {
    const sorted = [...parsed].sort((a, b) => a.index - b.index);
    let cursor = 1;
    let ok = true;
    for (const v of sorted) {
      if (v.startChapter !== cursor || v.endChapter < v.startChapter) {
        ok = false;
        break;
      }
      cursor = v.endChapter + 1;
    }
    if (ok && cursor === targetChapters + 1) {
      return sorted.map((v, i) => ({ ...v, index: i + 1 }));
    }
  }

  // Even re-partition, preserving narrative fields by volume order.
  const sorted = [...parsed].sort((a, b) => a.startChapter - b.startChapter);
  const base = Math.floor(targetChapters / volumeCount);
  const remainder = targetChapters % volumeCount;
  const out: MasterVolume[] = [];
  let start = 1;
  for (let i = 0; i < volumeCount; i++) {
    const extra = i < remainder ? 1 : 0;
    const end = start + base + extra - 1;
    const source = sorted[i];
    out.push({
      index: i + 1,
      name: source?.name ?? `第${i + 1}卷`,
      startChapter: start,
      endChapter: end,
      coreConflict: source?.coreConflict ?? "",
      climax: source?.climax ?? "",
      hook: source?.hook ?? "",
    });
    start = end + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Memory-context collectors
// ---------------------------------------------------------------------------

/**
 * Flatten facts from the most recent sedimented chapters (newest first,
 * capped) so planning/writing stays grounded in what already happened.
 */
export function collectRecentFacts(
  chapters: ChapterView[],
  maxFacts = 8,
): string[] {
  const facts: string[] = [];
  const ordered = [...chapters].sort((a, b) => b.number - a.number);
  for (const ch of ordered) {
    for (const fact of ch.facts) {
      facts.push(`第${ch.number}章·${fact}`);
      if (facts.length >= maxFacts) return facts;
    }
  }
  return facts;
}

/**
 * Character-state snapshot: latest non-empty charStates wins per character.
 */
export function collectCharStates(
  chapters: ChapterView[],
): { name: string; change: string }[] {
  const byName = new Map<string, string>();
  const ordered = [...chapters].sort((a, b) => b.number - a.number);
  for (const ch of ordered) {
    for (const state of ch.charStates) {
      if (!byName.has(state.name)) byName.set(state.name, state.change);
    }
  }
  return [...byName.entries()]
    .slice(0, 6)
    .map(([name, change]) => ({ name, change }));
}

/** Word count for Chinese prose: strip whitespace, count the rest. */
export function chineseWordCount(text: string): number {
  return text.replace(/\s/g, "").length;
}

/**
 * Strip markdown headings / chapter-title lines GLM sometimes prepends
 * despite instructions, e.g. "# 第12章 xxx" or "**第12章 xxx**".
 */
export function stripProseArtifacts(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^\*\*.*\*\*$/.test(trimmed) && trimmed.length < 40) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}
