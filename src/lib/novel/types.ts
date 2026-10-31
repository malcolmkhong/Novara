/**
 * Shared types for the Novel Creator (webnovel-writer inspired pipeline).
 * Pure types only — safe to import from both client and server code.
 *
 * Pipeline: init(设定集+总纲) → plan(卷节拍表+章纲) → write(流式正文)
 *           → sediment(记忆沉淀) → review(审查), with a foreshadowing
 *           ledger (伏笔台账) carrying long-range consistency.
 */

export interface NovelBible {
  world: string;
  power: string;
  goldenFinger: string;
  themes: string[];
}

export interface NovelCharacter {
  name: string;
  role: string;
  desire: string;
  flaw: string;
  arc: string;
}

export interface NovelVillain {
  name: string;
  scheme: string;
  mirror: string;
}

export interface MasterVolume {
  index: number;
  name: string;
  startChapter: number;
  endChapter: number;
  coreConflict: string;
  climax: string;
  hook: string;
}

export interface VolumeBeat {
  phase: string;
  title: string;
  description: string;
}

export interface ChapterOutline {
  number: number;
  title: string;
  goal: string;
  timeAnchor: string;
  mustCover: string[];
  endHook: string;
}

/** Parsed view of a NovelChapter row (JSON columns already decoded). */
export interface ChapterView {
  id: string;
  number: number;
  title: string;
  volumeId: string;
  goal: string | null;
  timeAnchor: string | null;
  mustCover: string[];
  endHook: string | null;
  content: string | null;
  wordCount: number;
  summary: string | null;
  facts: string[];
  charStates: { name: string; change: string }[];
  review: ChapterReview | null;
  status: "outlined" | "drafted" | "final";
  revision: number;
}

export interface VolumeView {
  id: string;
  index: number;
  name: string;
  startChapter: number;
  endChapter: number;
  coreConflict: string | null;
  climax: string | null;
  hook: string | null;
  beats: VolumeBeat[];
  planned: boolean;
}

export interface ForeshadowView {
  id: string;
  title: string;
  description: string;
  plantedAt: number;
  lastTouched: number | null;
  status: "open" | "advanced" | "paid";
  paidAt: number | null;
}

/** Full book payload returned by GET /api/novel/[id]. */
export interface NovelDetail {
  id: string;
  title: string;
  genre: string;
  logline: string;
  coreConflict: string | null;
  targetChapters: number;
  platform: string | null;
  bible: NovelBible | null;
  characters: NovelCharacter[];
  villain: NovelVillain | null;
  volumes: VolumeView[];
  chapters: ChapterView[];
  foreshadows: ForeshadowView[];
  createdAt: string;
  updatedAt: string;
}

/** Compact book card for the bookshelf list. */
export interface NovelListItem {
  id: string;
  title: string;
  genre: string;
  logline: string;
  targetChapters: number;
  writtenChapters: number;
  outlinedChapters: number;
  openForeshadows: number;
  updatedAt: string;
}

export interface ChapterReviewDimension {
  name: string;
  score: number;
  comment: string;
}

export interface ChapterReview {
  overallScore: number;
  dimensions: ChapterReviewDimension[];
  blocking: { issue: string; fix: string }[];
  suggestions: string[];
  consistencyFlags: string[];
}

export type ForeshadowAction = "plant" | "advance" | "pay";

export interface SedimentResult {
  summary: string;
  facts: string[];
  charStates: { name: string; change: string }[];
  foreshadows: {
    action: ForeshadowAction;
    ref: string;
    note: string;
  }[];
}

export const NOVEL_GENRES = [
  "都市",
  "玄幻",
  "仙侠",
  "奇幻",
  "科幻",
  "历史",
  "悬疑",
  "游戏",
  "古言",
  "现言",
  "幻言",
  "年代",
  "种田",
  "快穿",
  "衍生",
] as const;

export type NovelGenre = (typeof NOVEL_GENRES)[number];
