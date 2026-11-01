import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { loadNovelDetail } from "@/lib/novel/server";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET /api/novel/[id] — full studio payload (volumes, chapters, foreshadows)
// ---------------------------------------------------------------------------

export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  try {
    const detail = await loadNovelDetail(id);
    if (!detail) {
      return NextResponse.json(
        { success: false, error: "Novel not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, novel: detail });
  } catch (error) {
    console.error("[novel:detail] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load the novel." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/novel/[id] — remove book and everything under it (cascade)
// ---------------------------------------------------------------------------

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  try {
    const existing = await db.novel.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Novel not found." },
        { status: 404 },
      );
    }
    await db.novel.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[novel:delete] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete the novel." },
      { status: 500 },
    );
  }
}
