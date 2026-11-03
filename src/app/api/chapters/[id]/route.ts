import { db } from "@/lib/db";
import { updateChapterSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { countWords } from "@/lib/novara/words";
import { assessOverwrite } from "@/lib/novara/write-gate";
import { recordChapterVersion } from "@/lib/novara/versions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/chapters/[id] — update title/content/status/brief.
// wordCount is ALWAYS recomputed server-side from content (never trusted).
//
// Gates, in order:
//   1. FINAL LOCK (Phase 7): a status='final' (定稿) chapter refuses content
//      changes unless `reopen: true` — reopening demotes the chapter to
//      'revised' and applies the rest of the patch atomically. Demoting via
//      an explicit status-only change stays allowed (that IS the unlock).
//   2. Anti-overwrite gate: replacing non-empty content requires
//      `overwrite: true` — otherwise 409 with requiresOverwrite so the UI
//      can ask. Gate logic lives in lib/novara/write-gate.ts, shared with
//      the agent runtime (one rule, two callers).
//
// Every committed content change records a ChapterVersion row (稿1~稿N).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = updateChapterSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.chapter.findUnique({ where: { id } });
  if (!existing) return jsonError("Chapter not found", 404);

  const contentChanged =
    schema.data.content !== undefined && schema.data.content !== existing.content;

  // ---- Gate 1: final lock (定稿不可直接改) ----
  const isFinal = existing.status === "final";
  const wantsReopen = schema.data.reopen === true;
  if (isFinal && contentChanged && !wantsReopen) {
    return Response.json(
      {
        error:
          "This chapter is final (locked). Reopen it to continue editing — the status will demote to revised.",
        requiresReopen: true,
      },
      { status: 409 }
    );
  }

  // ---- Gate 2: anti-overwrite ----
  if (contentChanged) {
    const verdict = assessOverwrite({
      existingContent: existing.content,
      incomingContent: schema.data.content as string,
      overwrite: schema.data.overwrite,
    });
    if (verdict.blocked) {
      return Response.json(
        {
          error:
            "This chapter already has content — confirm the overwrite to replace it.",
          requiresOverwrite: true,
          existingWords: verdict.existingWords,
          incomingWords: verdict.incomingWords,
        },
        { status: 409 }
      );
    }
  }

  const data: {
    title?: string;
    content?: string;
    status?: string;
    brief?: string;
    wordCount?: number;
  } = { ...schema.data };
  delete (data as { overwrite?: boolean }).overwrite;
  delete (data as { reopen?: boolean }).reopen;

  // Reopen semantics: demote to the requested status, or 'revised' when the
  // patch didn't carry one. Never re-finalize through reopen.
  if (isFinal && wantsReopen) {
    data.status =
      schema.data.status && schema.data.status !== "final"
        ? schema.data.status
        : "revised";
  }

  if (contentChanged) {
    data.wordCount = countWords(schema.data.content as string);
  }

  const chapter = await db.chapter.update({ where: { id }, data });

  // Version history — snapshot the committed state (best-effort: a failed
  // history row must never fail the save itself).
  if (contentChanged) {
    await recordChapterVersion({
      chapterId: chapter.id,
      novelId: chapter.novelId,
      content: chapter.content,
      createdBy: "author",
    });
  }

  await db.novel.update({
    where: { id: existing.novelId },
    data: { updatedAt: new Date() },
  });

  return Response.json({
    chapter: {
      id: chapter.id,
      novelId: chapter.novelId,
      index: chapter.index,
      title: chapter.title,
      content: chapter.content,
      wordCount: chapter.wordCount,
      status: chapter.status,
      brief: chapter.brief,
      updatedAt: chapter.updatedAt.toISOString(),
    },
  });
}

// DELETE /api/chapters/[id] — delete and close the index gap
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.chapter.findUnique({ where: { id } });
  if (!existing) return jsonError("Chapter not found", 404);

  await db.$transaction([
    db.chapter.delete({ where: { id } }),
    db.chapter.updateMany({
      where: { novelId: existing.novelId, index: { gt: existing.index } },
      data: { index: { decrement: 1 } },
    }),
    db.novel.update({
      where: { id: existing.novelId },
      data: { updatedAt: new Date() },
    }),
  ]);

  return Response.json({ ok: true });
}
