import { db } from "@/lib/db";
import { packCreateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import type { ChapterPackDTO } from "@/lib/novara/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function toDTO(p: {
  id: string;
  novelId: string;
  kind: string;
  chapterIndex: number;
  title: string;
  content: string;
  updatedAt: Date;
}): ChapterPackDTO {
  return {
    id: p.id,
    novelId: p.novelId,
    kind: p.kind as ChapterPackDTO["kind"],
    chapterIndex: p.chapterIndex,
    title: p.title,
    content: p.content,
    updatedAt: p.updatedAt.toISOString(),
  };
}

// GET /api/novels/[id]/packs — the 草稿区 workspace documents:
// 材料包 (kind=material) and 定稿准备包 (kind=prep), newest activity first.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const novel = await db.novel.findUnique({ where: { id }, select: { id: true } });
  if (!novel) return jsonError("Novel not found", 404);

  const packs = await db.chapterPack.findMany({
    where: { novelId: id },
    orderBy: [{ chapterIndex: "asc" }, { kind: "asc" }],
  });

  return Response.json({ packs: packs.map(toDTO) });
}

// POST /api/novels/[id]/packs — create (or replace the content of) one pack.
// One pack per (novel, kind, chapterIndex): re-POSTing an existing key
// updates it instead of failing — the workspace idempotently re-preps.
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = packCreateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const novel = await db.novel.findUnique({ where: { id }, select: { id: true } });
  if (!novel) return jsonError("Novel not found", 404);

  const { kind, chapterIndex, title, content } = schema.data;
  const pack = await db.chapterPack.upsert({
    where: { novelId_kind_chapterIndex: { novelId: id, kind, chapterIndex } },
    create: {
      novelId: id,
      kind,
      chapterIndex,
      title: title ?? `Chapter ${chapterIndex}`,
      content: content ?? "",
    },
    update: {
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content } : {}),
    },
  });

  return Response.json({ pack: toDTO(pack) }, { status: 201 });
}
