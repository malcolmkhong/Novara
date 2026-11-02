// ---------------------------------------------------------------------------
// Novara AI — story snapshot + task envelope builders for the agent runtime.
//
// The snapshot is the single context payload shared by Atlas (planning),
// Sage (execution) and the read_novel tool — everyone plans against the same
// measured story state, never against conversation memory.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { getBudgets } from "@/lib/novara/content";
import { retrieveMemory } from "@/lib/novara/memory";
import { computeChapterQuota, quotaPromptBlock } from "@/lib/novara/quota";

export interface StorySnapshotData {
  novel: {
    id: string;
    title: string;
    genre: string;
    synopsis: string;
    targetWords: number;
    status: string;
  };
  totalWords: number;
  chapterCount: number;
  nextChapterIndex: number;
  chapters: { index: number; title: string; wordCount: number; status: string }[];
  outline: { index: number; title: string; summary: string }[];
  cast: { name: string; role: string }[];
  world: { title: string; category: string; contentPreview: string }[];
  openForeshadows: { id: string; status: string; content: string; plantChapter: number }[];
  lastDigest: { chapterIndex: number; summary: string } | null;
  /** Phase 4: scored story memory + recent digests, rendered prompt-ready. */
  memoryBlock: string | null;
  isChinese: boolean;
  nextQuota: { chapterQuota: number; remainingWords: number; basis: string };
}

export async function loadStorySnapshot(novelId: string): Promise<StorySnapshotData> {
  const budgets = getBudgets();
  const novel = await db.novel.findUnique({
    where: { id: novelId },
    include: {
      chapters: {
        orderBy: { index: "asc" },
        select: { id: true, index: true, title: true, wordCount: true, status: true, content: true },
      },
      outlineBeats: { orderBy: { index: "asc" }, take: budgets.glm.snapshotOutlineLimit },
      characters: { orderBy: { createdAt: "asc" }, take: budgets.glm.snapshotCastLimit },
      worldEntries: { orderBy: { createdAt: "asc" }, take: budgets.glm.snapshotCastLimit },
      foreshadows: {
        where: { status: { in: ["open", "advanced"] } },
        orderBy: { createdAt: "asc" },
        take: 30,
        select: { id: true, status: true, content: true, plantChapter: true },
      },
      digests: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: { chapter: { select: { index: true } } },
      },
    },
  });
  if (!novel) throw new Error(`Novel ${novelId} not found`);

  const totalWords = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0);
  const chapterCount = novel.chapters.length;
  const nextChapterIndex = chapterCount + 1;
  const beatsAhead = novel.outlineBeats.filter((b) => b.index >= nextChapterIndex).length;
  const quota = computeChapterQuota({
    targetWords: novel.targetWords,
    totalWords,
    beatsAhead,
    chapterCount,
  });

  const isChinese = /[\u4e00-\u9fff]/.test(`${novel.title}\n${novel.synopsis}`);

  // Phase 4 memory retrieval — the agent runtime plans and writes against the
  // same scored story memory the experimental draft route uses.
  const nextBeat = novel.outlineBeats.find((b) => b.index === nextChapterIndex);
  const memory = await retrieveMemory({
    novelId,
    chapterIndex: nextChapterIndex,
    queryText: [nextBeat?.title, nextBeat?.summary].filter(Boolean).join(" "),
  });
  if (memory) {
    console.log(
      `[memory] snapshot novel=${novelId} next=ch${nextChapterIndex} considered=${memory.stats.considered} selected=${memory.stats.selected} chars=${memory.stats.chars} digests=${memory.digests.length}`
    );
  }

  return {
    novel: {
      id: novel.id,
      title: novel.title,
      genre: novel.genre,
      synopsis: novel.synopsis,
      targetWords: novel.targetWords,
      status: novel.status,
    },
    totalWords,
    chapterCount,
    nextChapterIndex,
    chapters: novel.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      wordCount: c.wordCount,
      status: c.status,
    })),
    outline: novel.outlineBeats.map((b) => ({ index: b.index, title: b.title, summary: b.summary })),
    cast: novel.characters.map((c) => ({ name: c.name, role: c.role })),
    world: novel.worldEntries.map((w) => ({
      title: w.title,
      category: w.category,
      contentPreview: w.content.slice(0, 200),
    })),
    openForeshadows: novel.foreshadows.map((f) => ({
      id: f.id,
      status: f.status,
      content: f.content,
      plantChapter: f.plantChapter,
    })),
    lastDigest: novel.digests[0]
      ? { chapterIndex: novel.digests[0].chapter.index, summary: novel.digests[0].summary }
      : null,
    memoryBlock: memory?.block ?? null,
    isChinese,
    nextQuota: {
      chapterQuota: quota.chapterQuota,
      remainingWords: quota.remainingWords,
      basis: quota.basis,
    },
  };
}

/** Renders the snapshot as the compact text block fed to GLM. */
export function renderSnapshot(s: StorySnapshotData): string {
  const lines: string[] = [];
  lines.push(`NOVEL: ${s.novel.title}${s.novel.genre ? ` (${s.novel.genre})` : ""}`);
  if (s.novel.synopsis.trim()) lines.push(`SYNOPSIS: ${s.novel.synopsis.slice(0, 1200)}`);
  lines.push(
    `PROGRESS: ${s.chapterCount} chapters · ${s.totalWords.toLocaleString()} words written · target ${s.novel.targetWords.toLocaleString()}`
  );
  lines.push(`NEXT CHAPTER: index ${s.nextChapterIndex} · quota ≈ ${s.nextQuota.chapterQuota} words (basis: ${s.nextQuota.basis})`);

  if (s.chapters.length > 0) {
    lines.push(
      `CHAPTERS:\n${s.chapters
        .map((c) => `- ch${c.index} "${c.title}" — ${c.wordCount} words (${c.status})`)
        .join("\n")}`
    );
  } else {
    lines.push("CHAPTERS: none yet");
  }

  if (s.outline.length > 0) {
    lines.push(
      `OUTLINE:\n${s.outline.map((b) => `${b.index}. ${b.title}${b.summary ? ` — ${b.summary.slice(0, 220)}` : ""}`).join("\n")}`
    );
  }
  if (s.cast.length > 0) {
    lines.push(`CAST:\n${s.cast.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}`).join("\n")}`);
  }
  if (s.world.length > 0) {
    lines.push(
      `WORLD:\n${s.world.map((w) => `- ${w.title} (${w.category})${w.contentPreview ? ` — ${w.contentPreview}` : ""}`).join("\n")}`
    );
  }
  if (s.openForeshadows.length > 0) {
    lines.push(
      `OPEN FORESHADOW LEDGER:\n${s.openForeshadows
        .map((f) => `- [${f.id}] (${f.status}, planted ch${f.plantChapter}) ${f.content.slice(0, 200)}`)
        .join("\n")}`
    );
  }
  if (s.memoryBlock) {
    // Scored memory already carries the recent digests (STORY SO FAR);
    // printing the single last digest again would only duplicate tokens.
    lines.push(s.memoryBlock);
  } else if (s.lastDigest) {
    lines.push(`LAST CHAPTER ${s.lastDigest.chapterIndex} SUMMARY: ${s.lastDigest.summary.slice(0, 800)}`);
  }
  return lines.join("\n\n");
}

/** One-line quota plan for a SPECIFIC chapter index (write envelopes). */
export function quotaForChapter(
  s: StorySnapshotData,
  chapterIndex: number
): string {
  const beatsAhead = s.outline.filter((b) => b.index >= chapterIndex).length;
  const quota = computeChapterQuota({
    targetWords: s.novel.targetWords,
    totalWords: s.totalWords,
    beatsAhead,
    chapterCount: s.chapterCount,
  });
  return quotaPromptBlock(quota, s.novel.title);
}

export function languageDirective(s: StorySnapshotData): string {
  return s.isChinese
    ? "LANGUAGE: write all chapter prose in Chinese (中文), matching the novel."
    : "LANGUAGE: write all chapter prose in English, matching the novel.";
}
