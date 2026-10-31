import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { glmJson } from "@/lib/novel/glm";
import {
  buildInitMessages,
  parseInitResponse,
  type InitParsed,
} from "@/lib/novel/prompts";
import { normalizeVolumes } from "@/lib/novel/server";

export const maxDuration = 120;

// ---------------------------------------------------------------------------
// GET /api/novel — bookshelf list
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const novels = await db.novel.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { foreshadows: true } },
        chapters: { select: { status: true } },
      },
    });

    const items = novels.map((novel) => {
      const writtenChapters = novel.chapters.filter(
        (ch) => ch.status === "drafted" || ch.status === "final",
      ).length;
      const outlinedChapters = novel.chapters.filter(
        (ch) => ch.status === "outlined",
      ).length;
      return {
        id: novel.id,
        title: novel.title,
        genre: novel.genre,
        logline: novel.logline,
        targetChapters: novel.targetChapters,
        writtenChapters,
        outlinedChapters,
        openForeshadows: novel._count.foreshadows,
        updatedAt: novel.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({ success: true, novels: items });
  } catch (error) {
    console.error("[novel:list] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load the bookshelf." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/novel — create a book via GLM init (设定集 + 总纲)
// ---------------------------------------------------------------------------

const createSchema = z.object({
  genre: z.string().min(1).max(24),
  idea: z.string().min(5).max(2000),
  title: z.string().max(60).optional(),
  targetChapters: z.number().int().min(8).max(300).default(24),
  volumeCount: z.number().int().min(2).max(8).default(3),
  platform: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsedBody = createSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          parsedBody.error.issues[0]?.message ??
          "Invalid input: provide genre, idea (5-2000 chars), targetChapters, volumeCount.",
      },
      { status: 400 },
    );
  }
  const input = parsedBody.data;

  try {
    // GLM init: 设定集（世界观/力量体系/金手指/角色/反派）+ 总纲（分卷）。
    const parsed = await glmJson<InitParsed>(
      buildInitMessages({
        genre: input.genre,
        idea: input.idea,
        title: input.title,
        targetChapters: input.targetChapters,
        volumeCount: input.volumeCount,
        platform: input.platform,
      }),
      { label: "init", parse: parseInitResponse },
    );

    if (parsed === null) {
      return NextResponse.json(
        {
          success: false,
          error:
            "GLM could not generate the story bible in time. Please try again — a more specific idea also helps.",
        },
        { status: 502 },
      );
    }

    // Defensive coverage: force a perfect 1..targetChapters partition.
    const volumes = normalizeVolumes(
      parsed.volumes,
      input.targetChapters,
      input.volumeCount,
    );

    const novel = await db.novel.create({
      data: {
        title: input.title && input.title.trim().length > 0 ? input.title.trim() : parsed.title,
        genre: input.genre,
        logline: parsed.logline,
        coreConflict: parsed.coreConflict,
        targetChapters: input.targetChapters,
        platform: input.platform ?? null,
        bible: JSON.stringify(parsed.bible),
        characters: JSON.stringify(parsed.characters),
        villain: parsed.villain ? JSON.stringify(parsed.villain) : null,
        masterOutline: JSON.stringify(volumes),
        volumes: {
          create: volumes.map((v) => ({
            index: v.index,
            name: v.name,
            startChapter: v.startChapter,
            endChapter: v.endChapter,
            coreConflict: v.coreConflict || null,
            climax: v.climax || null,
            hook: v.hook || null,
          })),
        },
      },
      select: { id: true },
    });

    return NextResponse.json({ success: true, id: novel.id });
  } catch (error) {
    console.error("[novel:create] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create the novel. Please try again." },
      { status: 500 },
    );
  }
}
