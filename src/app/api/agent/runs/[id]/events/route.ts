// ---------------------------------------------------------------------------
// GET /api/agent/runs/[id]/events — SSE stream of the run's full detail.
//
// Push policy: FULL SNAPSHOT every sse.snapshotIntervalMs (small payload:
// ≤300 events + all tasks) — reconnects therefore re-sync automatically
// ("断线重连全量对账"). Terminal statuses close the stream after one final
// snapshot. Heartbeat comments keep proxies alive between snapshots.
// The client's EventSource handles retries; the gateway falls back to
// polling if the stream errors (降级轮询).
// ---------------------------------------------------------------------------

import { getRunDetail, healStaleRuns } from "@/lib/agent/runtime";
import { getBudgets } from "@/lib/novara/content";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const TERMINAL = ["completed", "failed", "cancelled"];

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  await healStaleRuns();

  const budgets = getBudgets();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let snapshotTimer: ReturnType<typeof setInterval> | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (snapshotTimer) clearInterval(snapshotTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // already closed by the platform
        }
      };

      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      let lastSignature = "";

      const pushSnapshot = async (): Promise<"ok" | "missing" | "terminal"> => {
        const detail = await getRunDetail(id).catch(() => null);
        if (!detail) {
          send({ error: "Run not found" });
          return "missing";
        }
        // Only push when something a client renders actually changed —
        // keeps EventSource frames meaningful and React re-renders rare.
        const lastEvent = detail.events[detail.events.length - 1];
        const signature = JSON.stringify([
          detail.run.status,
          detail.run.mode,
          detail.run.finalReport !== null,
          detail.tasks.map((t) => [t.id, t.status, t.artifactId]),
          detail.events.length,
          lastEvent?.id ?? null,
          detail.pendingApproval !== null,
        ]);
        if (signature !== lastSignature) {
          lastSignature = signature;
          send(detail);
        }
        if (TERMINAL.includes(detail.run.status)) return "terminal";
        return "ok";
      };

      // Initial snapshot, then periodic full re-syncs.
      const first = await pushSnapshot();
      if (first !== "ok") {
        cleanup();
        return;
      }

      snapshotTimer = setInterval(async () => {
        if (closed) return;
        const result = await pushSnapshot();
        if (result !== "ok") cleanup();
      }, budgets.sse.snapshotIntervalMs);

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, budgets.sse.heartbeatMs);

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
