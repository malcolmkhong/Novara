// ---------------------------------------------------------------------------
// Novara AI — chapter review core (development plan §2.7 / §9).
//
// Single implementation with TWO callers:
//   1. POST /api/chapters/[id]/review  (author-facing Review tab)
//   2. the review_chapter agent tool   (Prism in the Phase 5 tool loop)
//
// Produces the issue list (severity/category/location/evidence/fix_hint);
// critical issues are FORCED to blocking server-side — the model does not
// get to decide what blocks. Every verdict is persisted as a ChapterReview
// row (Phase 6) — the E2 gate's data source.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { chatJson } from "@/lib/novara/ai-json";
import { getBudgets } from "@/lib/novara/content";
import type { ReviewIssue, ReviewSeverity } from "@/lib/novara/agent-types";
import { z } from "zod";

const PREV_DIGEST_CLIP = 800;

const issueSchema = z.object({
  severity: z.enum(["critical", "major", "minor", "suggestion"]),
  category: z.string().trim().max(60),
  location: z.string().trim().max(200),
  evidence: z.string().trim().max(2000),
  fixHint: z.string().trim().max(1000).nullable().optional(),
});

const reviewPayloadSchema = z.object({ issues: z.array(issueSchema).max(30) });

export interface ChapterReviewResult {
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  issues: ReviewIssue[];
  reviewedAt: string;
}

/**
 * GLM structured review of one chapter, PERSISTED as a ChapterReview row
 * (Phase 6 — the E2 gate reads the latest row per chapter to decide whether
 * the chapter may be finalized). Throws on missing/empty chapter or AI
 * failure — callers map errors to their own transport (404/502 vs feed).
 */
export async function reviewChapter(
  chapterId: string,
  opts: { source?: "tab" | "agent" } = {}
): Promise<ChapterReviewResult> {
  const budgets = getBudgets();
  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    include: {
      novel: {
        include: {
          characters: { orderBy: { createdAt: "asc" }, take: budgets.glm.snapshotCastLimit },
          outlineBeats: { orderBy: { index: "asc" }, take: 30 },
          digests: {
            include: { chapter: { select: { index: true } } },
            orderBy: { updatedAt: "desc" },
            take: 3,
          },
        },
      },
    },
  });
  if (!chapter) throw new Error("Chapter not found");
  if (!chapter.content.trim()) throw new Error("Chapter has no content to review");

  const novel = chapter.novel;
  const isChinese = /[\u4e00-\u9fff]/.test(`${novel.title}\n${novel.synopsis}`);

  const prevDigests = novel.digests
    .filter((d) => d.chapter.index < chapter.index)
    .slice(0, 2);

  const system = isChinese
    ? "你是 Novara AI 的审稿编辑（Prism）。只输出一个 JSON 对象，不要任何解释或 Markdown 代码块之外的文字。"
    : "You are the Novara AI review editor (Prism). Output ONLY one JSON object — no commentary, nothing outside the JSON.";

  const parts: string[] = [];
  parts.push(`NOVEL: ${novel.title}${novel.genre ? ` (${novel.genre})` : ""}`);
  if (novel.synopsis.trim())
    parts.push(`SYNOPSIS:\n${novel.synopsis.slice(0, 1500)}`);
  if (novel.characters.length > 0) {
    parts.push(
      `CAST:\n${novel.characters
        .map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}`)
        .join("\n")}`
    );
  }
  if (novel.outlineBeats.length > 0) {
    parts.push(
      `OUTLINE:\n${novel.outlineBeats
        .map((b) => `${b.index}. ${b.title}`)
        .join("\n")}`
    );
  }
  for (const d of prevDigests) {
    parts.push(
      `PREVIOUS CHAPTER ${d.chapter.index} SUMMARY:\n${d.summary.slice(0, PREV_DIGEST_CLIP)}`
    );
  }
  parts.push(`CHAPTER ${chapter.index} TEXT:\n${chapter.content.slice(0, budgets.glm.chapterContextChars)}`);

  const issuesSpec = isChinese
    ? `任务：审读这一章，输出 JSON：{"issues":[...]}。每个 issue：
- severity: "critical"（事实矛盾/剧情硬伤/角色崩坏）| "major"（明显逻辑/节奏问题）| "minor"（小瑕疵）| "suggestion"（可选改进）
- category: continuity | logic | character | pacing | dialogue | world_logic | style
- location: 问题位置，如"第4段"或"对话场景"
- evidence: 原文引文或具体描述
- fixHint: 修复建议（可为 null）
规则：忠实于文本，有问题才列（0 个也合法：{"issues":[]}），不要编造；critical 必须是真正的硬伤。`
    : `Task: review this chapter and output JSON: {"issues":[...]}. Each issue:
- severity: "critical" (contradiction / plot-breaking / character-breaking) | "major" (clear logic or pacing problem) | "minor" (small flaw) | "suggestion" (optional improvement)
- category: continuity | logic | character | pacing | dialogue | world_logic | style
- location: where, e.g. "Paragraph 4" or "Dialogue, scene 2"
- evidence: quote or concrete description
- fixHint: suggestion (nullable)
Rules: be faithful to the text, list only real issues (zero issues is valid: {"issues":[]}), never invent; reserve critical for genuine breakage.`;
  parts.push(issuesSpec);

  const payload = await chatJson({
    system,
    user: parts.join("\n\n"),
    tag: "AI review",
    parse: (json) => reviewPayloadSchema.parse(json),
    // P5 — review spend lands on the chapter's novel in the ledger.
    ledger: { novelId: chapter.novelId },
  });

  const issues: ReviewIssue[] = payload.issues.map((issue, i) => {
    const severity: ReviewSeverity = issue.severity;
    return {
      id: `rev-${chapter.id}-${i}`,
      category: issue.category,
      severity,
      // Server-side rule: critical always blocks, nothing else does.
      blocking: severity === "critical",
      location: issue.location,
      evidence: issue.evidence,
      fixHint: issue.fixHint ?? null,
    };
  });

  // Persist the verdict (single write path — Review tab and Prism tool both
  // land here). Telemetry failure must not lose the review result.
  const blockingCount = issues.filter((i) => i.blocking).length;
  await db.chapterReview
    .create({
      data: {
        novelId: novel.id,
        chapterId: chapter.id,
        issueCount: issues.length,
        blockingCount,
        issuesJson: JSON.stringify(issues),
        source: opts.source ?? "tab",
      },
    })
    .catch((error) =>
      console.warn("[review] failed to persist ChapterReview row:", error)
    );

  return {
    chapterId: chapter.id,
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    issues,
    reviewedAt: new Date().toISOString(),
  };
}
