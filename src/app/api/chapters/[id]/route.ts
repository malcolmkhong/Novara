import { db } from "@/lib/db";
import { callerUid } from "@/lib/credits/charge";
import { updateChapterSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { finalizedRefusal, moveAsset } from "@/lib/novara/lifecycle";
import { countWords } from "@/lib/novara/words";
import { assessOverwrite } from "@/lib/novara/write-gate";
import { recordChapterVersion } from "@/lib/novara/versions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/chapters/[id] — update title/content/status/brief.
// wordCount is ALWAYS recomputed server-side from content (never trusted).
//
// Gates, in order:
//   1. FINAL LOCK (STEP 79): a final chapter is immutable canon. Any mutation
//      of it is refused with HTTP 409 and the typed body
//      { error: "asset_finalized", kind, id, reopen }. The explicit
//      `reopen: true` flag is the one way through the lock: the lifecycle
//      service archives the final state, demotes the chapter to draft and
//      writes the AssetTransition row.
//   2. Anti-overwrite gate: replacing non-empty content requires
//      `overwrite: true` — otherwise 409 with requiresOverwrite so the UI
//      can ask. Gate logic lives in lib/novara/write-gate.ts, shared with
//      the agent runtime (one rule, two callers).
//
// Every committed content change records a ChapterVersion row (draft 1..N).
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

  // ---- Gate 1: final lock — a final chapter is immutable canon ----
  // The typed refusal is the only answer to a mutation of a final asset.
  // The explicit `reopen` flag is the one way through it.
  const wantsReopen = schema.data.reopen === true;
  const wantsFinal = schema.data.status === "final";
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "chapter",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
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

  // ---- Reopen: demote to draft through the lifecycle service ----
  // The service archives the final state into AssetVersion and writes the
  // AssetTransition row; the patch then continues on a draft chapter.
  let canonMoved = false;
  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "chapter",
      assetId: existing.id,
      novelId: existing.novelId,
      move: "reopen",
      byUid: callerUid(req) ?? "",
      source: "author",
    });
    if (!reopened.ok) {
      return Response.json(reopened.body, { status: reopened.status });
    }
    canonMoved = true;
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
  // The lifecycle service owns the canon flag — it writes the status itself.
  // A reopen never re-finalizes in the same request: the chapter stays draft.
  delete data.status;

  if (contentChanged) {
    data.wordCount = countWords(schema.data.content as string);
  }

  let chapter = await db.chapter.update({ where: { id }, data });

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

  // ---- Finalize: lock the chapter through the lifecycle service ----
  // The service owns the status flip, the AssetTransition row and — for a
  // chapter — the memory projection, which reads the committed content. It
  // therefore runs after the content is saved, never before.
  if (wantsFinal && !canonMoved) {
    const finalized = await moveAsset({
      kind: "chapter",
      assetId: existing.id,
      novelId: existing.novelId,
      move: "finalize",
      byUid: callerUid(req) ?? "",
      source: "author",
    });
    if (!finalized.ok) {
      return Response.json(finalized.body, { status: finalized.status });
    }
    // The service flipped the canon flag — re-read so the response carries
    // the locked state.
    const locked = await db.chapter.findUnique({ where: { id } });
    if (locked) chapter = locked;
  }

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
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.chapter.findUnique({ where: { id } });
  if (!existing) return jsonError("Chapter not found", 404);

  // A final chapter is immutable canon: the delete is refused with the typed
  // body unless the caller reopens it first (?reopen=1), which demotes it to
  // draft through the lifecycle service (archive + AssetTransition row).
  const wantsReopen = new URL(req.url).searchParams.get("reopen") === "1";
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "chapter",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
  }

  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "chapter",
      assetId: existing.id,
      novelId: existing.novelId,
      move: "reopen",
      byUid: callerUid(req) ?? "",
      source: "author",
    });
    if (!reopened.ok) {
      return Response.json(reopened.body, { status: reopened.status });
    }
  }

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
