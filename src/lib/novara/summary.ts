import type { NovelStatus, NovelSummary } from "./types";

// Minimal structural type so route handlers can pass Prisma results in.
interface NovelRecord {
  id: string;
  title: string;
  genre: string;
  synopsis: string;
  targetWords: number;
  status: string;
  updatedAt: Date;
  chapters: { wordCount: number }[];
}

export function toSummary(novel: NovelRecord): NovelSummary {
  return {
    id: novel.id,
    title: novel.title,
    genre: novel.genre,
    synopsis: novel.synopsis,
    targetWords: novel.targetWords,
    status: novel.status as NovelStatus,
    chapterCount: novel.chapters.length,
    totalWords: novel.chapters.reduce((sum, c) => sum + c.wordCount, 0),
    updatedAt: novel.updatedAt.toISOString(),
  };
}
