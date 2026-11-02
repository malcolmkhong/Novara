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
  updatedAt: string;
}

export interface CharacterDTO {
  id: string;
  novelId: string;
  name: string;
  role: string;
  description: string;
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
  updatedAt: string;
}

export interface NovelDetail {
  novel: NovelMeta;
  chapters: ChapterDTO[];
  characters: CharacterDTO[];
  worldEntries: WorldEntryDTO[];
  outlineBeats: OutlineBeatDTO[];
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
}

export interface BackupCharacter {
  name: string;
  role: string;
  description: string;
}

export interface BackupWorldEntry {
  title: string;
  category: WorldCategory;
  content: string;
}

export interface BackupOutlineBeat {
  title: string;
  summary: string;
}

export interface BackupIntegrity {
  chapterCount: number;
  characterCount: number;
  worldEntryCount: number;
  outlineBeatCount: number;
  totalWords: number;
}

export interface NovelBackupFile {
  format: "novara-novel-backup";
  version: 1;
  application: "Novara AI";
  exportedAt: string;
  data: {
    novel: BackupNovel;
    chapters: BackupChapter[];
    characters: BackupCharacter[];
    worldEntries: BackupWorldEntry[];
    outlineBeats: BackupOutlineBeat[];
  };
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
}
