import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { glmJson } from "@/lib/novel/glm";
import {
  buildPlanMessages,
  parsePlanResponse,
  type PlanContext,
  type PlanParsed,
} from "@/lib/novel/prompts";
import {
  chapterToView,
  collectRecentFacts,
  foreshadowToRef,
  loadNovelDetail,
  volumeToView,
} from "@/lib/novel/server";

export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

const planSchema = z.object({
  volumeIndex: z.number().int().min(1).max(99),
});

// ---------------------------------------------------------------------------
// POST /api/novel/[id]/plan — generate 卷节拍表 + 章纲 for one volume
// ---------------------------------------------------------------------------

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  const parsedBody = planSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { success: false, error: "Provide `volumeIndex` (integer)." },
      { status: 400 },
    );
  }
  const volumeIndex = parsedBody.data.volumeIndex;

  try {
    const detail = await loadNovelDetail(id);
    if (!detail) {
      return NextResponse.json(
        { success: false, error: "Novel not found." },
        { status: 404 },
      );
    }

    const volume = detail.volumes.find((v) => v.index === volumeIndex);
    if (!volume) {
      return NextResponse.json(
        { success: false, error: `Volume ${volumeIndex} does not exist.` },
        { status: 404 },
      );
    }

    // Guard: never replan a volume that already has prose — outlines would
    // drift away from the written chapters.
    const written = detail.chapters.filter(
      (ch) =>
        ch.volumeId === volume.id &&
        (ch.status === "drafted" || ch.status === "final"),
    );
    if (written.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Volume ${volumeIndex} already has ${written.length} written chapter(s). Replanning would break continuity — plan the next volume instead.`,
        },
        { status: 409 },
      );
    }

    const openForeshadows = detail.foreshadows
      .filter((f) => f.status !== "paid")
      .slice(0, 10)
      .map(foreshadowToRef);

    const planContext: PlanContext = {
      pack: {
        title: detail.title,
        genre: detail.genre,
        logline: detail.logline,
        coreConflict: detail.coreConflict,
        platform: detail.platform,
        bible: detail.bible,
        characters: detail.characters,
        villain: detail.villain,
      },
      volume: {
        index: volume.index,
        name: volume.name,
        startChapter: volume.startChapter,
        endChapter: volume.endChapter,
        coreConflict: volume.coreConflict,
        climax: volume.climax,
        hook: volume.hook,
      },
      recentFacts: collectRecentFacts(detail.chapters, 8),
      openForeshadows,
    };

    const parsed = await glmJson<PlanParsed>(buildPlanMessages(planContext), {
      label: "plan",
      parse: parsePlanResponse,
    });
    if (parsed === null) {
      return NextResponse.json(
        {
          success: false,
          error:
            "GLM could not generate the volume plan in time. Please try again.",
        },
        { status: 502 },
      );
    }

    // Normalize chapter outlines: guarantee every number in the volume range
    // exists exactly once, using GLM output where valid.
    const byNumber = new Map<number, PlanParsed["chapters"][number]>();
    for (const outline of parsed.chapters) {
      if (
        outline.number >= volume.startChapter &&
        outline.number <= volume.endChapter &&
        !byNumber.has(outline.number)
      ) {
        byNumber.set(outline.number, outline);
      }
    }

    const beats = parsed.beats.slice(0, 10);

    // Persist: volume beats + planned flag, then chapter rows.
    await db.volume.update({
      where: { id: volume.id },
      data: { beats: JSON.stringify(beats), planned: true },
    });

    const existing = await db.novelChapter.findMany({
      where: { novelId: id, volumeId: volume.id },
      select: { id: true, number: true },
    });
    const existingByNumber = new Map(existing.map((c) => [c.number, c.id]));

    for (let n = volume.startChapter; n <= volume.endChapter; n++) {
      const outline = byNumber.get(n);
      const data = {
        title: outline?.title ?? `第${n}章`,
        goal: outline?.goal ?? "",
        timeAnchor: outline?.timeAnchor ?? "紧接上文",
        mustCover: JSON.stringify(outline?.mustCover ?? []),
        endHook: outline?.endHook ?? "",
      };
      const existingId = existingByNumber.get(n);
      if (existingId) {
        await db.novelChapter.update({ where: { id: existingId }, data });
      } else {
        await db.novelChapter.create({
          data: { novelId: id, volumeId: volume.id, number: n, ...data },
        });
      }
    }

    // Return the refreshed slices so the UI can update in place.
    const fresh = await db.volume.findUnique({
      where: { id: volume.id },
      include: { chapters: { orderBy: { number: "asc" } } },
    });
    if (!fresh) {
      return NextResponse.json(
        { success: false, error: "Volume disappeared during planning." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      volume: volumeToView(fresh),
      chapters: fresh.chapters.map(chapterToView),
    });
  } catch (error) {
    console.error("[novel:plan] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to plan the volume. Please try again." },
      { status: 500 },
    );
  }
}
