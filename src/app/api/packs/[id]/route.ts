import { db } from "@/lib/db";
import { callerUid } from "@/lib/credits/charge";
import { packUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { finalizedRefusal, moveAsset } from "@/lib/novara/lifecycle";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/packs/[id] — update one chapter pack (title/content).
// Final lock (STEP 79): a final pack is immutable canon — the patch is
// refused with HTTP 409 and the typed body
// { error: "asset_finalized", kind, id, reopen }. The pack schema carries no
// reopen flag: a final pack is reopened through the lifecycle move route
// (POST /api/novels/[novelId]/pack/[assetId]/reopen), which demotes it to
// draft through the same service.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = packUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.chapterPack.findUnique({ where: { id } });
  if (!existing) return jsonError("Pack not found", 404);

  const refusal = finalizedRefusal({
    kind: "pack",
    id: existing.id,
    novelId: existing.novelId,
    status: existing.status,
  });
  if (refusal) return Response.json(refusal, { status: 409 });

  const pack = await db.chapterPack.update({
    where: { id },
    data: {
      ...(schema.data.title !== undefined ? { title: schema.data.title } : {}),
      ...(schema.data.content !== undefined ? { content: schema.data.content } : {}),
    },
  });

  return Response.json({
    pack: {
      id: pack.id,
      novelId: pack.novelId,
      kind: pack.kind,
      chapterIndex: pack.chapterIndex,
      title: pack.title,
      content: pack.content,
      updatedAt: pack.updatedAt.toISOString(),
    },
  });
}

// DELETE /api/packs/[id] — remove one chapter pack. A final pack is
// immutable canon: the delete is refused with the typed body unless
// ?reopen=1 is explicit; even then the final state is archived and demoted
// first.
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.chapterPack.findUnique({ where: { id } });
  if (!existing) return jsonError("Pack not found", 404);

  const wantsReopen = new URL(req.url).searchParams.get("reopen") === "1";
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "pack",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
  }

  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "pack",
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

  await db.chapterPack.delete({ where: { id } });
  return Response.json({ ok: true });
}
