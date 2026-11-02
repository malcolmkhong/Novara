import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { jsonError, parseBody, validationError, withTimeout } from "@/lib/novara/api-helpers";
import { countWords } from "@/lib/novara/words";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const draftSchema = z.object({ chapterId: z.string().min(1) });

const GLM_TIMEOUT_MS = 60_000;

// POST /api/ai/draft — experimental one-chapter AI drafting.
// Grounded in the novel's synopsis, characters, world entries, outline and
// the tail of the previous chapter. Returns prose; the client decides how
// to place it (fill an empty chapter or append). Nothing is auto-saved
// without the user's editor round-trip.
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
            select: { index: true, title: true, content: true },
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
  const prevChapter = novel.chapters.find((c) => c.index === chapter.index - 1);
  const hasContent = chapter.content.trim().length > 0;
  const mode: "fill" | "append" = hasContent ? "append" : "fill";

  const contextLanguage = `${novel.title}\n${novel.synopsis}`;
  const isChinese = /[\u4e00-\u9fff]/.test(contextLanguage);

  const system = isChinese
    ? "你是 Novara AI 的小说写作代理。任务：为长篇小说写出沉浸式的章节正文。只输出正文本身——不要标题、不要解释、不要 Markdown 格式。沿用已有上下文的视角、时态与文风。篇幅约 800–1200 个汉字。"
    : "You are the Novel Writer agent of Novara AI. Task: write immersive chapter prose for a long-form novel. Output ONLY the prose itself — no headings, no commentary, no markdown. Match the POV, tense and voice of the provided context. Length: roughly 500-800 words.";

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
    const zai = await ZAI.create();
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: system },
          { role: "user", content: parts.join("\n\n") },
        ],
        thinking: { type: "disabled" },
      }),
      GLM_TIMEOUT_MS,
      "AI draft"
    );

    const content = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!content) return jsonError("The AI returned an empty draft. Try again.", 502);

    return Response.json({
      content,
      mode,
      wordCount: countWords(content),
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
