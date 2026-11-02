import { z } from "zod";

// Versioned backup format for novel export/import (v1).
// The importer validates strictly and refuses unknown formats/versions.

export const backupFileSchema = z.object({
  format: z.literal("novara-novel-backup"),
  version: z.literal(1),
  application: z.string().optional(),
  exportedAt: z.string().optional(),
  data: z.object({
    novel: z.object({
      title: z.string().trim().min(1).max(200),
      genre: z.string().max(120).default(""),
      synopsis: z.string().max(50000).default(""),
      targetWords: z.number().int().min(1000).max(5000000).default(100000),
      status: z.enum(["drafting", "completed", "archived"]).default("drafting"),
    }),
    chapters: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(200),
          content: z.string().max(1000000).default(""),
          status: z.enum(["draft", "revised", "final"]).default("draft"),
        })
      )
      .max(2000)
      .default([]),
    characters: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          role: z.string().max(200).default(""),
          description: z.string().max(10000).default(""),
        })
      )
      .max(1000)
      .default([]),
    worldEntries: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(200),
          category: z
            .enum(["location", "faction", "item", "system", "culture", "other"])
            .default("other"),
          content: z.string().max(50000).default(""),
        })
      )
      .max(2000)
      .default([]),
    outlineBeats: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(200),
          summary: z.string().max(10000).default(""),
        })
      )
      .max(2000)
      .default([]),
  }),
  integrity: z
    .object({
      chapterCount: z.number(),
      characterCount: z.number(),
      worldEntryCount: z.number(),
      outlineBeatCount: z.number(),
      totalWords: z.number(),
    })
    .optional(),
});

export type ParsedBackupFile = z.infer<typeof backupFileSchema>;
