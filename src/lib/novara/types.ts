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
  /** 构想快照 (Phase 8) — initial creative vision markdown; empty when absent. */
  conceptSnapshot: string;
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
  /** Canon status layer (Phase 9) — draft = editable, final = locked canon. */
  status: "draft" | "final";
  updatedAt: string;
}

export interface WorldEntryDTO {
  id: string;
  novelId: string;
  title: string;
  category: WorldCategory;
  content: string;
  /** Canon status layer (Phase 9) — draft = editable, final = locked canon. */
  status: "draft" | "final";
  /** Owning 世界书 group (Phase 9) — null = ungrouped (renders top-level). */
  groupId: string | null;
  updatedAt: string;
}

export interface WorldGroupDTO {
  id: string;
  novelId: string;
  name: string;
  order: number;
}

export interface OutlineBeatDTO {
  id: string;
  novelId: string;
  index: number;
  title: string;
  summary: string;
  /** Owning volume (Phase 7 P1) — null = unsorted. */
  volumeId: string | null;
  /** Canon status layer (Phase 9) — draft = editable, final = locked canon. */
  status: "draft" | "final";
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
  /** Canon status layer (Phase 9) — draft = editable, final = locked canon. */
  status: "draft" | "final";
  updatedAt: string;
}

export type StorylineStatus = "active" | "dormant" | "resolved";

// ---- Phase 8: ledger completion (承诺 / 线索) ------------------------------

export type PromiseStatus = "open" | "advanced" | "fulfilled" | "broken";

export interface StoryPromiseDTO {
  id: string;
  novelId: string;
  content: string;
  status: PromiseStatus;
  /** Canon status layer (Phase 9) — lock, not promise lifecycle. */
  lock: "draft" | "final";
  madeChapter: number | null;
  dueChapter: number | null;
  updatedAt: string;
}

export type ClueStatus = "planted" | "surfaced" | "revealed";

export interface StoryClueDTO {
  id: string;
  novelId: string;
  content: string;
  status: ClueStatus;
  /** Canon status layer (Phase 9) — lock, not clue lifecycle. */
  lock: "draft" | "final";
  plantChapter: number | null;
  revealChapter: number | null;
  updatedAt: string;
}

// ---- Phase 8: 草稿区 workspace (材料包 / 定稿准备包 / 章摘要) --------------

export type ChapterPackKind = "material" | "prep";

export interface ChapterPackDTO {
  id: string;
  novelId: string;
  kind: ChapterPackKind;
  chapterIndex: number;
  title: string;
  content: string;
  updatedAt: string;
}

export interface DigestDTO {
  chapterId: string;
  chapterIndex: number;
  summary: string;
  updatedAt: string;
}

/** Version summary (稿N) for the tree's per-chapter draft list (Phase 9). */
export interface ChapterVersionSummaryDTO {
  id: string;
  chapterId: string;
  draftNo: number;
  wordCount: number;
  createdBy: string;
  createdAt: string;
}

export interface StorylineDTO {
  id: string;
  novelId: string;
  name: string;
  summary: string;
  status: StorylineStatus;
  /** Canon status layer (Phase 9) — lock, not thread lifecycle. */
  lock: "draft" | "final";
  updatedAt: string;
}

export interface TimelineEntryDTO {
  id: string;
  novelId: string;
  order: number;
  label: string;
  detail: string;
  chapterIndex: number | null;
  /** Canon status layer (Phase 9) — draft = editable, final = locked canon. */
  status: "draft" | "final";
  updatedAt: string;
}

export interface CharacterArcDTO {
  id: string;
  novelId: string;
  characterName: string;
  order: number;
  note: string;
  chapterIndex: number | null;
  /** Canon status layer (Phase 9) — draft = editable, final = locked canon. */
  status: "draft" | "final";
  updatedAt: string;
}

export interface LedgerView {
  storylines: StorylineDTO[];
  timeline: TimelineEntryDTO[];
  arcs: CharacterArcDTO[];
  promises: StoryPromiseDTO[];
  clues: StoryClueDTO[];
}

export interface NovelDetail {
  novel: NovelMeta;
  chapters: ChapterDTO[];
  characters: CharacterDTO[];
  worldEntries: WorldEntryDTO[];
  /** 世界书 second-level groups (Phase 9) — entries nest under them. */
  worldGroups: WorldGroupDTO[];
  outlineBeats: OutlineBeatDTO[];
  volumes: VolumeDTO[];
  /** Story contract (作品契约) markdown — null when never written. */
  contract: string | null;
  /** Contract canon status (Phase 9) — final contract is locked canon. */
  contractStatus: "draft" | "final";
  /** 草稿区 workspace documents (材料包 + 定稿准备包) — Phase 8. */
  packs: ChapterPackDTO[];
  /** 章摘要 (chapter digests) — tree-visible under 卷规划. */
  digests: DigestDTO[];
  /** 稿N version summaries — tree-visible under each draft chapter. */
  versions: ChapterVersionSummaryDTO[];
  /** 账本 five ledgers — tree-visible sub-rows (Phase 9). */
  ledger: LedgerView;
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
