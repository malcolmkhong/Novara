import { z } from "zod";

// Base resource schemas (defined first so createNovelSchema can nest them).

export const characterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().max(200).optional(),
  description: z.string().max(10000).optional(),
  // Phase 7 (P1) — comma-separated alternate names; sediment normalizes
  // STATE names through this map so aliases don't split state snapshots.
  aliases: z.string().max(400).optional(),
});

export const characterUpdateSchema = characterSchema.partial().extend({
  // Canon status layer (Phase 9): set "final" to lock; requires reopen to
  // edit a locked asset (the route archives the final state to AssetVersion).
  status: z.enum(["draft", "final"]).optional(),
  reopen: z.boolean().optional(),
});

export const worldEntrySchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z
    .enum(["location", "faction", "item", "system", "culture", "other"])
    .optional(),
  content: z.string().max(50000).optional(),
});

export const worldEntryUpdateSchema = worldEntrySchema.partial().extend({
  // 世界书 second-level grouping (Phase 9) — null ungroups the entry.
  groupId: z.string().cuid().nullable().optional(),
  // Canon status layer (Phase 9) — same gate law as characters.
  status: z.enum(["draft", "final"]).optional(),
  reopen: z.boolean().optional(),
});

// ---- Phase 9: 世界书 groups (二级分组) -------------------------------------

export const createWorldGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const updateWorldGroupSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  // Reorder support — explicit index move validated server-side.
  moveTo: z.number().int().min(1).max(99).optional(),
});

export const outlineBeatSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(10000).optional(),
  // Phase 7 (P1) — optional volume grouping (DSH 卷规划 analog).
  volumeId: z.string().cuid().nullable().optional(),
});

export const outlineBeatUpdateSchema = outlineBeatSchema.partial().extend({
  // Canon status layer (Phase 9) — same gate law as characters.
  status: z.enum(["draft", "final"]).optional(),
  reopen: z.boolean().optional(),
});

// ---- Phase 7 (P1): volumes (卷) ------------------------------------------

export const createVolumeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  synopsis: z.string().max(50000).optional(),
});

export const updateVolumeSchema = createVolumeSchema.partial().extend({
  // Reorder support — explicit index move validated server-side.
  moveTo: z.number().int().min(1).max(99).optional(),
  // Canon status layer (Phase 9) — same gate law as characters.
  status: z.enum(["draft", "final"]).optional(),
  reopen: z.boolean().optional(),
});

// ---- Phase 7 (P1): ledger (账本三表) --------------------------------------

export const storylineSchema = z.object({
  name: z.string().trim().min(1).max(200),
  summary: z.string().max(10000).optional(),
  status: z.enum(["active", "dormant", "resolved"]).optional(),
});

export const timelineEntrySchema = z.object({
  label: z.string().trim().min(1).max(200),
  detail: z.string().max(10000).optional(),
  chapterIndex: z.number().int().min(1).nullable().optional(),
});

export const characterArcSchema = z.object({
  characterName: z.string().trim().min(1).max(120),
  note: z.string().trim().min(1).max(10000),
  chapterIndex: z.number().int().min(1).nullable().optional(),
});

// ---- Phase 8: ledger completion (承诺 / 线索) -----------------------------

export const promiseSchema = z.object({
  content: z.string().trim().min(1).max(10000),
  status: z.enum(["open", "fulfilled", "broken"]).optional(),
  madeChapter: z.number().int().min(1).nullable().optional(),
  dueChapter: z.number().int().min(1).nullable().optional(),
});

export const clueSchema = z.object({
  content: z.string().trim().min(1).max(10000),
  status: z.enum(["planted", "surfaced", "revealed"]).optional(),
  plantChapter: z.number().int().min(1).nullable().optional(),
  revealChapter: z.number().int().min(1).nullable().optional(),
});

export const ledgerCreateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("storyline"), data: storylineSchema }),
  z.object({ kind: z.literal("timeline"), data: timelineEntrySchema }),
  z.object({ kind: z.literal("arc"), data: characterArcSchema }),
  z.object({ kind: z.literal("promise"), data: promiseSchema }),
  z.object({ kind: z.literal("clue"), data: clueSchema }),
]);

export const ledgerUpdateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("storyline"),
    data: storylineSchema.partial().extend({
      // Canon status layer (Phase 9) — storyline's lifecycle `status` is
      // active/dormant/resolved, so the canon lock rides the `lock` field.
      lock: z.enum(["draft", "final"]).optional(),
      reopen: z.boolean().optional(),
    }),
  }),
  z.object({
    kind: z.literal("timeline"),
    data: timelineEntrySchema
      .partial()
      .extend({ moveTo: z.number().int().min(1).max(999).optional() })
      .extend({
        status: z.enum(["draft", "final"]).optional(),
        reopen: z.boolean().optional(),
      }),
  }),
  z.object({
    kind: z.literal("arc"),
    data: characterArcSchema
      .partial()
      .extend({ moveTo: z.number().int().min(1).max(999).optional() })
      .extend({
        status: z.enum(["draft", "final"]).optional(),
        reopen: z.boolean().optional(),
      }),
  }),
  z.object({
    kind: z.literal("promise"),
    data: promiseSchema.partial().extend({
      // Canon lock (Phase 9) — lifecycle `status` is open/fulfilled/broken.
      lock: z.enum(["draft", "final"]).optional(),
      reopen: z.boolean().optional(),
    }),
  }),
  z.object({
    kind: z.literal("clue"),
    data: clueSchema.partial().extend({
      // Canon lock (Phase 9) — lifecycle `status` is planted/surfaced/revealed.
      lock: z.enum(["draft", "final"]).optional(),
      reopen: z.boolean().optional(),
    }),
  }),
]);

// ---- Phase 8: chapter packs (材料包 / 定稿准备包) -------------------------

export const packCreateSchema = z.object({
  kind: z.enum(["material", "prep"]),
  chapterIndex: z.number().int().min(1).max(9999),
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(200000).optional(),
});

export const packUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(200000).optional(),
});

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
  // Phase 9 — 构想快照 written at creation time by the "New with the AI
  // team" wizard: the logline/premise/cast/outline the author confirmed,
  // kept verbatim as the audit baseline (构想/构想快照.md analog).
  conceptSnapshot: z.string().max(100000).optional(),
});

export const updateNovelSchema = createNovelSchema
  .pick({ title: true, genre: true, synopsis: true, targetWords: true })
  .partial()
  .extend({
    status: z.enum(["drafting", "completed", "archived"]).optional(),
    // Phase 7 (P1) — the story contract (作品契约): promise document the
    // writing context always reads. Upserted 1:1 by the novel PATCH.
    contract: z.string().max(50000).optional(),
    // Phase 9 — contract canon lock: set "final" to lock the contract;
    // editing a locked contract requires reopen (archives to AssetVersion).
    contractStatus: z.enum(["draft", "final"]).optional(),
    contractReopen: z.boolean().optional(),
    // Phase 8 — 构想快照: the initial creative vision snapshot.
    conceptSnapshot: z.string().max(100000).optional(),
  });

export const updateChapterSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(1000000).optional(),
  status: z.enum(["draft", "revised", "final"]).optional(),
  // Chapter brief (细纲) — author-editable writing brief (Phase 7).
  brief: z.string().max(20000).optional(),
  // Anti-overwrite gate: saving over non-empty content requires an explicit
  // client-side confirmation; the server enforces it with a 409 otherwise.
  overwrite: z.boolean().optional(),
  // Final lock (Phase 7): a status='final' (定稿) chapter refuses content
  // changes unless the author explicitly reopens it — reopen demotes the
  // chapter to 'revised' and applies the rest of the patch in one request.
  reopen: z.boolean().optional(),
});
