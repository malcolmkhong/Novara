import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { glmJson } from "@/lib/novel/glm";
import {
  buildReviewMessages,
  parseReviewResponse,
  type ReviewBrief,
} from "@/lib/novel/prompts";
import {
  chapterToView,
  foreshadowToRef,
  loadNovelDetail,
} from "@/lib/novel/server";

export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

const reviewSchema = z.object({
  chapterNumber: z.number().int().min(1).max(9999),
});

// ---------------------------------------------------------------------------
// POST /api/novel/[id]/review — structured chapter review (blocking issues,
// dimension scores, consistency flags) persisted on the chapter row.
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
  const parsedBody = reviewSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { success: false, error: "Provide `chapterNumber` (integer)." },
      { status: 400 },
    );
  }
  const chapterNumber = parsedBody.data.chapterNumber;

  try {
    const detail = await loadNovelDetail(id);
    if (!detail) {
      return NextResponse.json(
        { success: false, error: "Novel not found." },
        { status: 404 },
      );
    }

    const chapter = detail.chapters.find((ch) => ch.number === chapterNumber);
    if (!chapter || !chapter.content) {
      return NextResponse.json(
        {
          success: false,
          error: `Chapter ${chapterNumber} has no prose to review yet. Write it first.`,
        },
        { status: 400 },
      );
    }

    const prev = detail.chapters
      .filter((ch) => ch.number < chapterNumber && ch.summary)
      .sort((a, b) => b.number - a.number)[0];

    const brief: ReviewBrief = {
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
      chapter: {
        number: chapter.number,
        title: chapter.title,
        goal: chapter.goal,
        mustCover: chapter.mustCover,
        endHook: chapter.endHook,
      },
      prevSummary: prev?.summary ?? null,
      openForeshadows: detail.foreshadows
        .filter((f) => f.status !== "paid")
        .slice(0, 8)
        .map(foreshadowToRef),
      content: chapter.content,
    };

    const review = await glmJson(buildReviewMessages(brief), {
      label: "review",
      parse: parseReviewResponse,
    });
    if (review === null) {
      return NextResponse.json(
        {
          success: false,
          error:
            "GLM could not complete the review in time. Please try again.",
        },
        { status: 502 },
      );
    }

    const updated = await db.novelChapter.update({
      where: { id: chapter.id },
      data: { review: JSON.stringify(review) },
    });

    return NextResponse.json({
      success: true,
      chapter: chapterToView(updated),
    });
  } catch (error) {
    console.error("[novel:review] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to review the chapter. Please try again." },
      { status: 500 },
    );
  }
}
