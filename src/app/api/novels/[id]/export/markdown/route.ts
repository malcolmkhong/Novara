import { db } from "@/lib/db";
import { jsonError, slugifyFilename } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const CATEGORY_LABELS: Record<string, string> = {
  location: "Location",
  faction: "Faction",
  item: "Item",
  system: "System",
  culture: "Culture",
  other: "Other",
};

// GET /api/novels/[id]/export/markdown — download the whole novel as a
// single Markdown manuscript (meta + bible + all chapters). Companion to
// the versioned JSON backup: JSON is for re-import, MD is for reading.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const novel = await db.novel.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { index: "asc" } },
      characters: { orderBy: { createdAt: "asc" } },
      worldEntries: { orderBy: { createdAt: "asc" } },
      outlineBeats: { orderBy: { index: "asc" } },
    },
  });
  if (!novel) return jsonError("Novel not found", 404);

  const totalWords = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0);

  const md: string[] = [];
  md.push(`# ${novel.title}`, "");
  if (novel.genre) md.push(`**Genre:** ${novel.genre}`, "");
  if (novel.synopsis.trim()) {
    md.push("## Synopsis", "", novel.synopsis.trim(), "");
  }
  md.push(
    `*${totalWords.toLocaleString()} words written · target ${novel.targetWords.toLocaleString()} · status: ${novel.status}*`,
    "",
    "---",
    ""
  );

  if (novel.characters.length > 0) {
    md.push("## Cast", "");
    for (const c of novel.characters) {
      md.push(
        `### ${c.name}${c.role ? ` — ${c.role}` : ""}`,
        "",
        c.description || "",
        ""
      );
    }
  }

  if (novel.worldEntries.length > 0) {
    md.push("## World", "");
    for (const w of novel.worldEntries) {
      md.push(
        `### ${w.title}${w.category ? ` (${CATEGORY_LABELS[w.category] ?? w.category})` : ""}`,
        "",
        w.content || "",
        ""
      );
    }
  }

  if (novel.outlineBeats.length > 0) {
    md.push("## Outline", "");
    for (const b of novel.outlineBeats) {
      md.push(`${b.index}. **${b.title}**${b.summary ? ` — ${b.summary}` : ""}`);
    }
    md.push("", "---", "");
  }

  if (novel.chapters.length > 0) {
    md.push("# Chapters", "");
    for (const c of novel.chapters) {
      md.push(
        `## ${c.index}. ${c.title}`,
        "",
        `*${c.wordCount.toLocaleString()} words · ${c.status}*`,
        "",
        c.content.trim() || "_(empty)_",
        ""
      );
    }
  } else {
    md.push("_No chapters yet._", "");
  }

  const body = md.join("\n");
  const filename = `${slugifyFilename(novel.title) || "novel"}.md`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
