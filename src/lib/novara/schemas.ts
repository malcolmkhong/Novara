import { z } from "zod";

// Base resource schemas (defined first so createNovelSchema can nest them).

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

export const createNovelSchema = z.object({
  title: z.string().trim().min(1).max(200),
  genre: z.string().trim().max(120).optional(),
  synopsis: z.string().max(50000).optional(),
  targetWords: z.number().int().min(1000).max(5000000).optional(),
  // Optional nested foundation (used by the "New with the AI team" wizard).
  // Created atomically with the novel in one Prisma nested create.
  characters: z.array(characterSchema).max(24).optional(),
  worldEntries: z.array(worldEntrySchema).max(24).optional(),
  outlineBeats: z.array(outlineBeatSchema).max(64).optional(),
});

export const updateNovelSchema = createNovelSchema
  .pick({ title: true, genre: true, synopsis: true, targetWords: true })
  .partial()
  .extend({
    status: z.enum(["drafting", "completed", "archived"]).optional(),
  });

export const updateChapterSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(1000000).optional(),
  status: z.enum(["draft", "revised", "final"]).optional(),
  // Anti-overwrite gate: saving over non-empty content requires an explicit
  // client-side confirmation; the server enforces it with a 409 otherwise.
  overwrite: z.boolean().optional(),
});
