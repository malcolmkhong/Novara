import { z } from "zod";

export const createNovelSchema = z.object({
  title: z.string().trim().min(1).max(200),
  genre: z.string().trim().max(120).optional(),
  synopsis: z.string().max(50000).optional(),
  targetWords: z.number().int().min(1000).max(5000000).optional(),
});

export const updateNovelSchema = createNovelSchema
  .partial()
  .extend({
    status: z.enum(["drafting", "completed", "archived"]).optional(),
  });

export const updateChapterSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(1000000).optional(),
  status: z.enum(["draft", "revised", "final"]).optional(),
});

export const characterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().max(200).optional(),
  description: z.string().max(10000).optional(),
});

export const characterUpdateSchema = characterSchema.partial();

export const worldEntrySchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z
    .enum(["location", "faction", "item", "system", "culture", "other"])
    .optional(),
  content: z.string().max(50000).optional(),
});

export const worldEntryUpdateSchema = worldEntrySchema.partial();

export const outlineBeatSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(10000).optional(),
});

export const outlineBeatUpdateSchema = outlineBeatSchema.partial();
