// ---------------------------------------------------------------------------
// Novara AI — shared DTO types between client and server.
// NOTE: pure data shapes (no Prisma types leak to the client).
// ---------------------------------------------------------------------------

export type NovelStatus = "drafting" | "completed" | "archived";
export type ChapterStatus = "draft" | "revised" | "final";
export type WorldCategory =
  | "location"
  | "faction"
  | "item"
  | "system"
  | "culture"
  | "other";

export interface NovelSummary {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  targetWords: number;
  status: NovelStatus;
  chapterCount: number;
  totalWords: number;
  updatedAt: string;
}

export interface NovelMeta {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  targetWords: number;
  status: NovelStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterDTO {
  id: string;
  novelId: string;
  index: number;
  title: string;
  content: string;
  wordCount: number;
  status: ChapterStatus;
  /** Chapter brief (细纲) — writing brief persisted per chapter (Phase 7). */
  brief: string;
  updatedAt: string;
}

export interface CharacterDTO {
  id: string;
  novelId: string;
  name: string;
  role: string;
  description: string;
  /** Comma-separated alternate names (Phase 7 P1). */
  aliases: string;
  updatedAt: string;
}

export interface WorldEntryDTO {
  id: string;
  novelId: string;
  title: string;
  category: WorldCategory;
  content: string;
  updatedAt: string;
}

export interface OutlineBeatDTO {
  id: string;
  novelId: string;
  index: number;
  title: string;
  summary: string;
  /** Owning volume (Phase 7 P1) — null = unsorted. */
  volumeId: string | null;
  updatedAt: string;
}

// ---- Phase 7 (P1): volumes + ledger + contract ----------------------------

export interface VolumeDTO {
  id: string;
  novelId: string;
  index: number;
  title: string;
  /** Volume plan (卷规划) — markdown. */
  synopsis: string;
  updatedAt: string;
}

export type StorylineStatus = "active" | "dormant" | "resolved";

export interface StorylineDTO {
  id: string;
  novelId: string;
  name: string;
  summary: string;
  status: StorylineStatus;
  updatedAt: string;
}

export interface TimelineEntryDTO {
  id: string;
  novelId: string;
  order: number;
  label: string;
  detail: string;
  chapterIndex: number | null;
  updatedAt: string;
}

export interface CharacterArcDTO {
  id: string;
  novelId: string;
  characterName: string;
  order: number;
  note: string;
  chapterIndex: number | null;
  updatedAt: string;
}

export interface LedgerView {
  storylines: StorylineDTO[];
  timeline: TimelineEntryDTO[];
  arcs: CharacterArcDTO[];
}

export interface NovelDetail {
  novel: NovelMeta;
  chapters: ChapterDTO[];
  characters: CharacterDTO[];
  worldEntries: WorldEntryDTO[];
  outlineBeats: OutlineBeatDTO[];
  volumes: VolumeDTO[];
  /** Story contract (作品契约) markdown — null when never written. */
  contract: string | null;
}

// ---------------------------------------------------------------------------
// Import / Export backup format (versioned)
// ---------------------------------------------------------------------------

export interface BackupNovel {
  title: string;
  genre: string;
  synopsis: string;
  targetWords: number;
  status: NovelStatus;
}

export interface BackupChapter {
  title: string;
  content: string;
  status: ChapterStatus;
  /** Chapter brief (细纲) — present in v2 backups. */
  brief?: string;
}

export interface BackupCharacter {
  name: string;
  role: string;
  description: string;
  aliases?: string;
}

export interface BackupWorldEntry {
  title: string;
  category: WorldCategory;
  content: string;
}

export interface BackupOutlineBeat {
  title: string;
  summary: string;
  /** 1-based volume index within data.volumes (P1) — null = unsorted. */
  volumeIndex?: number | null;
}

export interface BackupVolume {
  index: number;
  title: string;
  synopsis: string;
}

export interface BackupLedger {
  storylines?: { name: string; summary: string; status: string }[];
  timeline?: {
    order: number;
    label: string;
    detail: string;
    chapterIndex: number | null;
  }[];
  arcs?: {
    characterName: string;
    order: number;
    note: string;
    chapterIndex: number | null;
  }[];
}

export interface BackupIntegrity {
  chapterCount: number;
  characterCount: number;
  worldEntryCount: number;
  outlineBeatCount: number;
  totalWords: number;
}

// ---- v2 memory-layer collections (Phase 7 — export keeps the truth) ----

export interface BackupStoryFact {
  category: string;
  content: string;
  sourceChapter?: number | null;
}

export interface BackupCharacterState {
  name: string;
  chapterIndex: number;
  state: string;
}

export interface BackupForeshadow {
  content: string;
  plantChapter: number;
  payByChapter?: number | null;
  status: string;
  lastChapter?: number | null;
}

export interface BackupDigest {
  chapterIndex: number;
  summary: string;
}

export interface BackupVersion {
  chapterIndex: number;
  draftNo: number;
  content: string;
  wordCount: number;
  createdBy?: string;
}

export interface BackupMemory {
  storyFacts?: BackupStoryFact[];
  characterStates?: BackupCharacterState[];
  foreshadows?: BackupForeshadow[];
  digests?: BackupDigest[];
  versions?: BackupVersion[];
}

export interface BackupData {
  novel: BackupNovel;
  chapters: BackupChapter[];
  characters: BackupCharacter[];
  worldEntries: BackupWorldEntry[];
  outlineBeats: BackupOutlineBeat[];
  /** P1 additions — optional so earlier v2 files keep validating. */
  volumes?: BackupVolume[];
  contract?: string;
  ledger?: BackupLedger;
  memory?: BackupMemory;
}

export interface NovelBackupFile {
  format: "novara-novel-backup";
  /** v1 = original five collections; v2 adds briefs + memory layer. */
  version: 1 | 2;
  application: "Novara AI";
  exportedAt: string;
  data: BackupData;
  integrity: BackupIntegrity;
}

export interface ImportReport {
  novelId: string;
  title: string;
  counts: {
    chapters: number;
    characters: number;
    worldEntries: number;
    outlineBeats: number;
  };
  totalWords: number;
  integrityOk: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// AI draft (experimental)
// ---------------------------------------------------------------------------

export interface AiDraftResult {
  content: string;
  mode: "fill" | "append";
  wordCount: number;
  /** A/B drafts (Phase 6) — present when variants > 1 was requested. */
  variants?: { content: string; wordCount: number }[];
}
