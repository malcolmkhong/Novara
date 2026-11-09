import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { streamProse } from "@/lib/ai/writing";
import { buildWriteMessages, type WriteBrief } from "@/lib/novel/prompts";
import {
  chineseWordCount,
  collectCharStates,
  collectRecentFacts,
  foreshadowToRef,
  loadNovelDetail,
  stripProseArtifacts,
} from "@/lib/novel/server";

export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

const writeSchema = z.object({
  chapterNumber: z.number().int().min(1).max(9999),
});

// ---------------------------------------------------------------------------
// POST /api/novel/[id]/write — stream chapter prose as SSE events
//
// Events (data: JSON\n\n):
//   {"type":"delta","text":"..."}   — prose chunk
//   {"type":"done","wordCount":n,"revision":n}
//   {"type":"error","message":"...","saved":boolean}
// ---------------------------------------------------------------------------

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  const parsedBody = writeSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { success: false, error: "Provide `chapterNumber` (integer)." },
      { status: 400 },
    );
  }
  const chapterNumber = parsedBody.data.chapterNumber;

  const detail = await loadNovelDetail(id);
  if (!detail) {
    return NextResponse.json(
      { success: false, error: "Novel not found." },
      { status: 404 },
    );
  }

  const chapter = detail.chapters.find((ch) => ch.number === chapterNumber);
  if (!chapter) {
    return NextResponse.json(
      {
        success: false,
        error: `Chapter ${chapterNumber} has no outline yet. Plan its volume first.`,
      },
      { status: 400 },
    );
  }
  const volume = detail.volumes.find((v) => v.id === chapter.volumeId);
  if (!volume) {
    return NextResponse.json(
      { success: false, error: "Chapter volume is missing." },
      { status: 500 },
    );
  }

  // Assemble the five-part writing brief (webnovel-writer task ordering).
  const prevSummaries = detail.chapters
    .filter((ch) => ch.number < chapterNumber && ch.summary)
    .sort((a, b) => b.number - a.number)
    .slice(0, 2)
    .reverse()
    .map((ch) => ({ number: ch.number, summary: ch.summary as string }));

  const brief: WriteBrief = {
    pack: {
      title: detail.title,
      genre: detail.genre,
      logline: detail.logline,
      coreConflict: detail.coreConflict,
      platform: detail.platform,
      bible: detail.bible,
      characters: detail.characters,
      villain: detail.villain,
    },
    chapter: {
      number: chapter.number,
      title: chapter.title,
      goal: chapter.goal,
      timeAnchor: chapter.timeAnchor,
      mustCover: chapter.mustCover,
      endHook: chapter.endHook,
    },
    volumeName: `第${volume.index}卷《${volume.name}》`,
    prevSummaries,
    recentFacts: collectRecentFacts(
      detail.chapters.filter((ch) => ch.number < chapterNumber),
      8,
    ),
    openForeshadows: detail.foreshadows
      .filter((f) => f.status !== "paid")
      .slice(0, 8)
      .map(foreshadowToRef),
    charStates: collectCharStates(
      detail.chapters.filter((ch) => ch.number < chapterNumber),
    ),
  };

  const messages = buildWriteMessages(brief);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          // Client disconnected — keep generating so the draft still saves.
          closed = true;
        }
      };

      let accumulated = "";
      const outcome = await streamProse(
        messages,
        {
          onDelta: (text) => {
            accumulated += text;
            send({ type: "delta", text });
          },
        },
        // P5 — prose-stream spend lands on the novel in the ledger.
        { novelId: id },
      );

      const prose = stripProseArtifacts(accumulated);
      const wordCount = chineseWordCount(prose);

      if (outcome.completed && wordCount >= 200) {
        const updated = await db.novelChapter.update({
          where: { id: chapter.id },
          data: {
            content: prose,
            wordCount,
            status: "drafted",
            revision: { increment: 1 },
          },
          select: { revision: true },
        });
        send({ type: "done", wordCount, revision: updated.revision });
      } else if (!outcome.completed && wordCount >= 500) {
        // Watchdog cut a long generation short — keep the partial draft so
        // the user loses nothing, but flag the error.
        await db.novelChapter.update({
          where: { id: chapter.id },
          data: {
            content: prose,
            wordCount,
            status: "drafted",
            revision: { increment: 1 },
          },
        });
        send({
          type: "error",
          message: `${outcome.error ?? "Generation stopped early."} A partial draft (${wordCount} chars) was saved.`,
          saved: true,
        });
      } else if (!outcome.completed) {
        send({
          type: "error",
          message:
            outcome.error ??
            "Generation stopped early. Please try writing this chapter again.",
          saved: false,
        });
      } else {
        // "Completed" but suspiciously short — treat as a failure without saving.
        send({
          type: "error",
          message:
            "The model returned too little prose. Please try writing this chapter again.",
          saved: false,
        });
      }

      try {
        controller.close();
      } catch {
        // Already closed by the client.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
