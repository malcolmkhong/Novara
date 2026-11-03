import { z } from "zod";

// Versioned backup format for novel export/import.
//   v1 — original five collections (novel/chapters/characters/world/outline).
//   v2 (Phase 7) — adds chapter briefs + the memory layer (sediment truth):
//   storyFacts, characterStates, foreshadows, digests, chapter versions.
// The importer validates strictly and refuses unknown formats/versions.
// v1 files stay importable — they simply restore an empty memory layer.

const MEMORY_CATEGORY_VALUES = [
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

export const backupFileSchema = z.object({
  format: z.literal("novara-novel-backup"),
  version: z.union([z.literal(1), z.literal(2)]),
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
          brief: z.string().max(20000).default(""),
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
    // ---- v2 memory layer (optional so v1 files validate unchanged) ----
    memory: z
      .object({
        storyFacts: z
          .array(
            z.object({
              category: z.enum(MEMORY_CATEGORY_VALUES),
              content: z.string().min(1).max(20000),
              sourceChapter: z.number().int().min(1).nullable().default(null),
            })
          )
          .max(20000)
          .default([]),
        characterStates: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(120),
              chapterIndex: z.number().int().min(1),
              state: z.string().min(1).max(20000),
            })
          )
          .max(20000)
          .default([]),
        foreshadows: z
          .array(
            z.object({
              content: z.string().min(1).max(20000),
              plantChapter: z.number().int().min(1),
              payByChapter: z.number().int().min(1).nullable().default(null),
              status: z.enum(["open", "advanced", "paid"]).default("open"),
              lastChapter: z.number().int().min(1).nullable().default(null),
            })
          )
          .max(10000)
          .default([]),
        digests: z
          .array(
            z.object({
              chapterIndex: z.number().int().min(1),
              summary: z.string().min(1).max(10000),
            })
          )
          .max(2000)
          .default([]),
        versions: z
          .array(
            z.object({
              chapterIndex: z.number().int().min(1),
              draftNo: z.number().int().min(1),
              content: z.string().max(1000000),
              wordCount: z.number().int().min(0),
              createdBy: z.enum(["author", "agent", "restore"]).default("author"),
            })
          )
          .max(60000)
          .default([]),
      })
      .optional(),
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
