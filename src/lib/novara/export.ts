// ---------------------------------------------------------------------------
// Novara AI — manuscript markdown export core.
//
// Single implementation with TWO callers:
//   1. GET /api/novels/[id]/export/markdown  (author-facing download)
//   2. the export_markdown agent tool        (Forge in the Phase 5 tool loop)
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";

const CATEGORY_LABELS: Record<string, string> = {
  location: "Location",
  faction: "Faction",
  item: "Item",
  system: "System",
  culture: "Culture",
  other: "Other",
};

export interface ManuscriptMarkdown {
  body: string;
  chapterCount: number;
  totalWords: number;
}

/** Builds the whole-novel markdown manuscript (meta + bible + chapters). */
export async function buildManuscriptMarkdown(novelId: string): Promise<ManuscriptMarkdown> {
  const novel = await db.novel.findUnique({
    where: { id: novelId },
    include: {
      chapters: { orderBy: { index: "asc" } },
      characters: { orderBy: { createdAt: "asc" } },
      worldEntries: { orderBy: { createdAt: "asc" } },
      outlineBeats: { orderBy: { index: "asc" } },
    },
  });
  if (!novel) throw new Error("Novel not found");

  const totalWords = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0);
  const finalizedCount = novel.chapters.filter((c) => c.status === "final").length;

  const md: string[] = [];
  md.push(`# ${novel.title}`, "");
  if (novel.genre) md.push(`**Genre:** ${novel.genre}`, "");
  if (novel.synopsis.trim()) {
    md.push("## Synopsis", "", novel.synopsis.trim(), "");
  }
  md.push(
    `*${totalWords.toLocaleString()} words written · target ${novel.targetWords.toLocaleString()} · ${novel.chapters.length} chapter(s), ${finalizedCount} finalized · status: ${novel.status}*`,
    "",
    "---",
    ""
  );

  // Table of contents (Phase 6 export polish) — plain list, no fragile
  // anchors; each entry carries the live word count and final marker.
  if (novel.chapters.length > 0) {
    md.push("## Table of Contents", "");
    for (const c of novel.chapters) {
      md.push(
        `- ${c.index}. ${c.title} — ${c.wordCount.toLocaleString()} words${c.status === "final" ? " ✓" : ""}`
      );
    }
    md.push("", "---", "");
  }

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
        `## Chapter ${c.index} — ${c.title}`,
        "",
        `*${c.wordCount.toLocaleString()} words · ${c.status}*`,
        "",
        c.content.trim() || "_(empty)_",
        "",
        "---",
        ""
      );
    }
    md.push(
      `*End of manuscript — ${novel.chapters.length} chapter(s), ${totalWords.toLocaleString()} words, ${finalizedCount} finalized.*`,
      ""
    );
  } else {
    md.push("_No chapters yet._", "");
  }

  return {
    body: md.join("\n"),
    chapterCount: novel.chapters.length,
    totalWords,
  };
}
