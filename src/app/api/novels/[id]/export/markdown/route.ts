import { jsonError, slugifyFilename } from "@/lib/novara/api-helpers";
import { buildManuscriptMarkdown } from "@/lib/novara/export";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/novels/[id]/export/markdown — download the whole novel as a
// single Markdown manuscript. Thin shell over the shared export core
// (lib/novara/export.ts); the same core powers the Forge agent tool (P5).
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  let body: string;
  let title: string;
  try {
    const manuscript = await buildManuscriptMarkdown(id);
    body = manuscript.body;
    // Filename needs the novel title — re-read cheaply (cached DB, one row).
    const novel = await import("@/lib/db").then(({ db }) =>
      db.novel.findUnique({ where: { id }, select: { title: true } })
    );
    title = novel?.title ?? "novel";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonError(message, message === "Novel not found" ? 404 : 500);
  }
  const filename = `${slugifyFilename(title) || "novel"}.md`;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
