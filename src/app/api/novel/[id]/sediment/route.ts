import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { glmJson } from "@/lib/novel/glm";
import {
  buildSedimentMessages,
  parseSedimentResponse,
} from "@/lib/novel/prompts";
import type { SedimentResult } from "@/lib/novel/types";
import {
  chapterToView,
  foreshadowToRef,
  foreshadowToView,
  loadNovelDetail,
} from "@/lib/novel/server";

export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

const sedimentSchema = z.object({
  chapterNumber: z.number().int().min(1).max(9999),
});

/** Exact-then-fuzzy title match against the given foreshadow rows. */
function matchForeshadow(
  rows: { id: string; title: string }[],
  ref: string,
): { id: string; title: string } | null {
  const exact = rows.find((f) => f.title === ref);
  if (exact) return exact;
  const lower = ref.toLowerCase();
  const fuzzy = rows.find(
    (f) =>
      f.title.toLowerCase().includes(lower) ||
      lower.includes(f.title.toLowerCase()),
  );
  return fuzzy ?? null;
}

// ---------------------------------------------------------------------------
// POST /api/novel/[id]/sediment — extract summary/facts/foreshadows from a
// drafted chapter (webnovel-writer "learn/state" analog) and mark it final.
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
  const parsedBody = sedimentSchema.safeParse(body);
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
          error: `Chapter ${chapterNumber} has no prose to sediment yet. Write it first.`,
        },
        { status: 400 },
      );
    }

    const openRows = await db.foreshadow.findMany({
      where: { novelId: id, status: { not: "paid" } },
      orderBy: { plantedAt: "asc" },
    });

    const result = await glmJson<SedimentResult>(
      buildSedimentMessages(
        chapterNumber,
        chapter.content,
        openRows.map(foreshadowToRef),
      ),
      { label: "sediment", parse: parseSedimentResponse },
    );
    if (result === null) {
      return NextResponse.json(
        {
          success: false,
          error:
            "GLM could not extract the chapter memory in time. Please try again.",
        },
        { status: 502 },
      );
    }

    // Persist chapter memory.
    const updatedChapter = await db.novelChapter.update({
      where: { id: chapter.id },
      data: {
        summary: result.summary,
        facts: JSON.stringify(result.facts),
        charStates: JSON.stringify(result.charStates),
        status: "final",
      },
    });

    // Apply foreshadow ledger actions (plant / advance / pay).
    const ledgerNotes: string[] = [];
    for (const action of result.foreshadows) {
      if (action.action === "plant") {
        const existing = await db.foreshadow.findFirst({
          where: { novelId: id, title: action.ref },
        });
        if (existing) {
          // Duplicate plant — treat as an advance on the existing entry.
          await db.foreshadow.update({
            where: { id: existing.id },
            data: {
              lastTouched: chapterNumber,
              status: existing.status === "open" ? "advanced" : existing.status,
              description: action.note || existing.description,
            },
          });
          ledgerNotes.push(`推进既有伏笔《${action.ref}》`);
        } else {
          await db.foreshadow.create({
            data: {
              novelId: id,
              title: action.ref,
              description: action.note || "（见正文）",
              plantedAt: chapterNumber,
              status: "open",
            },
          });
          ledgerNotes.push(`埋设伏笔《${action.ref}》`);
        }
      } else {
        const current = await db.foreshadow.findMany({
          where: { novelId: id, status: { not: "paid" } },
        });
        const target = matchForeshadow(current, action.ref);
        if (!target) {
          ledgerNotes.push(`未找到可${action.action === "pay" ? "回收" : "推进"}的伏笔《${action.ref}》`);
          continue;
        }
        await db.foreshadow.update({
          where: { id: target.id },
          data:
            action.action === "pay"
              ? { status: "paid", paidAt: chapterNumber, lastTouched: chapterNumber }
              : { status: "advanced", lastTouched: chapterNumber },
        });
        ledgerNotes.push(
          action.action === "pay"
            ? `回收伏笔《${target.title}》`
            : `推进伏笔《${target.title}》`,
        );
      }
    }

    const freshForeshadows = await db.foreshadow.findMany({
      where: { novelId: id },
      orderBy: [{ plantedAt: "asc" }, { id: "asc" }],
    });

    return NextResponse.json({
      success: true,
      chapter: chapterToView(updatedChapter),
      foreshadows: freshForeshadows.map(foreshadowToView),
      ledgerNotes,
    });
  } catch (error) {
    console.error("[novel:sediment] failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to sediment the chapter memory. Please try again.",
      },
      { status: 500 },
    );
  }
}
