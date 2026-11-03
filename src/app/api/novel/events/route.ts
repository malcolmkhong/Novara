import { subscribeNovelChanges } from "@/lib/novel/events";

export const dynamic = "force-dynamic";

/**
 * GET /api/novel/events — SSE stream of novel-library changes.
 *
 * Every successful library mutation (AI-team tools, studio endpoints)
 * emits through the in-process event bus; this endpoint streams those
 * events to browsers so the bookshelf / studio / side-panel can refetch
 * without a manual refresh. Heartbeat comments keep intermediaries from
 * buffering; EventSource reconnects automatically if the stream drops.
 */
export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Initial comment flushes proxy buffers and confirms the connection.
      send(`: connected\n\n`);

      const unsubscribe = subscribeNovelChanges((event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => {
        send(`: ping\n\n`);
      }, 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };
      req.signal.addEventListener("abort", cleanup);
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
