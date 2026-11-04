import { db } from "@/lib/db";
import { getBudgets } from "@/lib/novara/content";
import { retrieveMemory } from "@/lib/novara/memory";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { glmChat } from "@/lib/novara/glm";
import { countWords } from "@/lib/novara/words";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const draftSchema = z.object({
  chapterId: z.string().min(1),
  // Phase 6 A/B drafts: 1 (default) or 2 alternatives in one request.
  variants: z.number().int().min(1).max(2).optional(),
});

// POST /api/ai/draft — experimental one-chapter AI drafting.
// Grounded in the novel's synopsis, characters, world entries, outline and
// the tail of the previous chapter. Length pacing: targetWords is turned
// into an AI-visible word budget (remaining words spread over the outline
// beats still ahead, or matched to the established chapter rhythm) so the
// model knows the scale of the book it is writing. Returns prose; the
// client decides how to place it (fill an empty chapter or append).
// Nothing is auto-saved without the user's editor round-trip.
export async function POST(req: Request) {
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = draftSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const chapter = await db.chapter.findUnique({
    where: { id: schema.data.chapterId },
    include: {
      novel: {
        include: {
          chapters: {
            orderBy: { index: "asc" },
            select: {
              index: true,
              title: true,
              content: true,
              wordCount: true,
            },
          },
          characters: {
            orderBy: { createdAt: "asc" },
            take: 12,
            select: { name: true, role: true, description: true },
          },
          worldEntries: {
            orderBy: { createdAt: "asc" },
            take: 10,
            select: { title: true, category: true, content: true },
          },
          outlineBeats: {
            orderBy: { index: "asc" },
            take: 20,
            select: { index: true, title: true, summary: true },
          },
        },
      },
    },
  });
  if (!chapter) return jsonError("Chapter not found", 404);

  const novel = chapter.novel;
  const budgets = getBudgets();
  const prevChapter = novel.chapters.find((c) => c.index === chapter.index - 1);
  const hasContent = chapter.content.trim().length > 0;
  const mode: "fill" | "append" = hasContent ? "append" : "fill";

  const contextLanguage = `${novel.title}\n${novel.synopsis}`;
  const isChinese = /[\u4e00-\u9fff]/.test(contextLanguage);

  // -------------------------------------------------------------------------
  // Length pacing — targetWords becomes an AI-visible word budget.
  // remaining = target − written; the budget for one chapter is roughly the
  // remaining words spread over the outline beats still ahead, or (without
  // beats) the average length of the chapters already written. Capped so a
  // single GLM call stays realistic.
  // -------------------------------------------------------------------------
  const totalWords = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0);
  const remainingWords = Math.max(0, novel.targetWords - totalWords);
  const writtenChapters = novel.chapters.length;
  const avgChapterWords =
    writtenChapters > 0 ? Math.round(totalWords / writtenChapters) : 0;
  // Beats are narrative-ordered and the naive model fills chapters in order,
  // so beats with index >= current chapter index approximate the scope that
  // still lies ahead.
  const beatsAhead = novel.outlineBeats.filter(
    (b) => b.index >= chapter.index,
  ).length;

  const QUOTA_MIN = budgets.draft.quotaMinWords;
  const QUOTA_MAX = budgets.draft.quotaMaxWords;
  const clampQuota = (n: number) =>
    Math.min(QUOTA_MAX, Math.max(QUOTA_MIN, Math.round(n)));

  // Suggested length for the WHOLE chapter, when we have a signal for it.
  let chapterQuota: number | null = null;
  if (remainingWords > 0) {
    if (beatsAhead > 0) {
      chapterQuota = clampQuota(remainingWords / beatsAhead);
    } else if (avgChapterWords >= budgets.draft.avgChapterWordsSignal) {
      // Match the rhythm the manuscript has already established.
      chapterQuota = clampQuota(avgChapterWords);
    }
  }
  // Budget for THIS generation pass (append continues inside a chapter).
  const passQuota =
    chapterQuota === null
      ? null
      : mode === "append"
        ? Math.max(budgets.draft.appendFloorWords, chapterQuota - chapter.wordCount)
        : chapterQuota;

  const lengthRule = passQuota
    ? isChinese
      ? `本章篇幅约 ${passQuota} 字。`
      : `Length: roughly ${passQuota} words.`
    : isChinese
      ? `篇幅约 ${Math.round(budgets.draft.fallbackChapterWords[0] * 1.5)}–${Math.round(
          budgets.draft.fallbackChapterWords[1] * 1.5
        )} 个汉字。`
      : `Length: roughly ${budgets.draft.fallbackChapterWords[0]}-${budgets.draft.fallbackChapterWords[1]} words.`;

  const system = isChinese
    ? `你是 Novara AI 的小说写作代理。任务：为长篇小说写出沉浸式的章节正文。只输出正文本身——不要标题、不要解释、不要 Markdown 格式。沿用已有上下文的视角、时态与文风。${lengthRule}`
    : `You are the Novel Writer agent of Novara AI. Task: write immersive chapter prose for a long-form novel. Output ONLY the prose itself — no headings, no commentary, no markdown. Match the POV, tense and voice of the provided context. ${lengthRule}`;

  const parts: string[] = [];
  parts.push(`NOVEL: ${novel.title}`);
  if (novel.genre) parts.push(`GENRE: ${novel.genre}`);
  if (novel.synopsis.trim()) parts.push(`SYNOPSIS:\n${clip(novel.synopsis, 1500)}`);

  if (novel.characters.length > 0) {
    parts.push(
      `CHARACTERS:\n${novel.characters
        .map((c) => `- ${c.name}${c.role ? ` (${clip(c.role, 60)})` : ""}: ${clip(c.description, 200)}`)
        .join("\n")}`
    );
  }
  if (novel.worldEntries.length > 0) {
    parts.push(
      `WORLD:\n${novel.worldEntries
        .map((w) => `- [${w.category}] ${w.title}: ${clip(w.content, 300)}`)
        .join("\n")}`
    );
  }
  if (novel.outlineBeats.length > 0) {
    parts.push(
      `OUTLINE:\n${novel.outlineBeats
        .map((b) => `${b.index}. ${b.title}${b.summary ? ` — ${clip(b.summary, 150)}` : ""}`)
        .join("\n")}`
    );
  }

  // Phase 4 memory retrieval — the story bible read back into generation.
  // Everything the sediment pipeline has learned (facts, character states,
  // open loops, recent digests) is scored against THIS chapter and injected,
  // so the AI can no longer contradict established canon.
  const memory = await retrieveMemory({
    novelId: novel.id,
    chapterIndex: chapter.index,
    queryText: [
      chapter.title,
      novel.outlineBeats.find((b) => b.index === chapter.index)?.summary ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  console.log(
    `[memory] draft novel=${novel.id} ch=${chapter.index} considered=${memory?.stats.considered ?? 0} selected=${memory?.stats.selected ?? 0} chars=${memory?.stats.chars ?? 0} digests=${memory?.digests.length ?? 0}`
  );
  if (memory?.block) {
    parts.push(memory.block);
  }
  if (novel.targetWords > 0) {
    parts.push(
      isChinese
        ? `字数规划：全书目标约 ${novel.targetWords} 字；已写约 ${totalWords} 字（${writtenChapters} 章）；剩余约 ${remainingWords} 字。`
        : `LENGTH PLAN: target ~${novel.targetWords} words total; ~${totalWords} words written across ${writtenChapters} chapters; ~${remainingWords} words remaining.`
    );
    if (passQuota !== null) {
      const basis =
        beatsAhead > 0
          ? isChinese
            ? `（全书剩余约 ${remainingWords} 字，按剩余约 ${beatsAhead} 个情节节拍均摊）`
            : ` (≈ ${remainingWords} remaining words spread over ~${beatsAhead} outline beats)`
          : isChinese
            ? "（与已成稿章节的平均篇幅一致）"
            : " (matching the average length of the chapters written so far)";
      parts.push(
        mode === "append"
          ? isChinese
            ? `本章已约 ${chapter.wordCount} 字，本次续写建议新增约 ${passQuota} 字，使本章接近约 ${chapterQuota} 字${basis}。`
            : `This chapter is already ~${chapter.wordCount} words; the continuation should add about ${passQuota} words so the chapter lands near ~${chapterQuota} words total${basis}.`
          : isChinese
            ? `本章篇幅建议约 ${passQuota} 字${basis}。`
            : `Suggested length for this chapter: about ${passQuota} words${basis}.`
      );
    } else if (remainingWords <= 0) {
      parts.push(
        isChinese
          ? "全书字数已达到或超过目标；保持本章简洁，除非上下文明显需要展开。"
          : "The manuscript has reached its target length; keep this chapter concise unless the context clearly calls for expansion."
      );
    }
  }

  if (prevChapter && prevChapter.content.trim()) {
    parts.push(`END OF PREVIOUS CHAPTER:\n…${clip(prevChapter.content, 500)}`);
  }

  parts.push(`CHAPTER ${chapter.index}: "${chapter.title}"`);
  if (hasContent) {
    parts.push(
      `CURRENT CHAPTER TEXT (continue seamlessly from where it ends):\n…${clip(chapter.content, 600)}`
    );
    parts.push(
      isChinese
        ? "指示：接着现有正文继续写本章，不要重复已有内容。"
        : "Instruction: continue the chapter from where the existing text ends. Do not repeat it."
    );
  } else {
    parts.push(
      isChinese
        ? "指示：为本章从头写出正文。"
        : "Instruction: write this chapter from its beginning."
    );
  }

  try {
    // Phase 6: A/B drafts — the SAME grounded context, two independent
    // generations (sequential; the global GLM semaphore paces them).
    const variantCount = schema.data.variants ?? 1;
    const variants: { content: string; wordCount: number }[] = [];
    for (let i = 0; i < variantCount; i++) {
      const { text: content } = await glmChat({
        messages: [
          { role: "assistant", content: system },
          { role: "user", content: parts.join("\n\n") },
        ],
        tag: variantCount > 1 ? `AI draft ${String.fromCharCode(65 + i)}` : "AI draft",
        surface: "draft",
      });
      variants.push({ content, wordCount: countWords(content) });
    }

    return Response.json({
      content: variants[0].content,
      mode,
      wordCount: variants[0].wordCount,
      ...(variantCount > 1 ? { variants } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown AI service error";
    return jsonError(`AI draft failed: ${message}`, 502);
  }
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(-max);
}
