// ---------------------------------------------------------------------------
// POST /api/agent/runs/[id]/resume — Phase 1 crash recovery.
//
// Resumes a "running" run whose executor died (server restart / crash). The
// executor lease is claimed synchronously (CAS on unowned/stale + epoch
// increment) so a live executor or a fresh lease 409s BEFORE anything else:
//
//   - awaiting_approval → 409 (decide the gate first — approve/reject; after
//     an approval the run is running again and can be resumed)
//   - paused / terminal → 409
//   - stranded needs_approval task(s) (crash inside the gate-open window)
//     → 409 unless body { resolvePending: "discard" }. Nothing is ever
//     auto-committed — discard only abandons the uncommitted draft(s).
//   - wrap-up already granted AND the turn budget spent → deterministic
//     ZERO-GLM reconciliation: the final report is built from persisted
//     state only (AgentTask statuses + event-derived counters + latest
//     ChapterReviews), the run is closed, and the report is returned in THIS
//     response (no executor is started — no further model turns exist).
//   - otherwise → claim + 202; executeRun continues in the background from
//     the canonical AgentMessage transcript + the last fenced checkpoint.
// ---------------------------------------------------------------------------

import { after } from "next/server";
import { db } from "@/lib/db";
import { getBudgets } from "@/lib/novara/content";
import { claimLease, leaseIsAlive, readLoopState, releaseLease } from "@/lib/agent/messages";
import {
  executeRun,
  errorStatus,
  NotFoundError,
  reconcileWrapUpFromDb,
} from "@/lib/agent/runtime";
import type { AgentRunStatus } from "@/lib/novara/agent-types";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Params = { params: Promise<{ id: string }> };

const TERMINAL: AgentRunStatus[] = ["completed", "failed", "cancelled"];

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const run = await db.agentRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundError("Run not found");
    if (TERMINAL.includes(run.status as AgentRunStatus)) {
      return Response.json({ error: "This run is already finished" }, { status: 409 });
    }
    if (run.status === "awaiting_approval") {
      return Response.json(
        {
          error:
            "This run is waiting on your approval decision — approve or reject the pending write first. After an approval it returns to running and can be resumed.",
        },
        { status: 409 }
      );
    }
    if (run.status === "paused") {
      return Response.json(
        { error: "This run was paused by the author — cancel it or start a new run." },
        { status: 409 }
      );
    }

    // Stranded gate(s): a crash between the task flip and the run flip can
    // leave needs_approval tasks under a "running" run. The pending write was
    // NEVER committed — discarding only abandons the draft.
    const stranded = await db.agentTask.findMany({
      where: { runId: id, status: "needs_approval" },
      select: { id: true, key: true },
    });
    const body = (await req.json().catch(() => ({}))) as { resolvePending?: unknown };
    if (stranded.length > 0 && body.resolvePending !== "discard") {
      return Response.json(
        {
          error: `Stranded pending write(s) from an interrupted gate: ${stranded
            .map((t) => t.key)
            .join(", ")}. Nothing was committed. Re-send with { "resolvePending": "discard" } to abandon the draft(s) and resume.`,
        },
        { status: 409 }
      );
    }

    // Deterministic wrap-up reconciliation (ZERO-GLM): the one-shot budget
    // wrap-up turn was already granted and the executor died before closing
    // the run. No further model turn may be minted (wrapUpGranted is a
    // lifetime property) — the report is built from the DB instead.
    const state = await readLoopState(id);
    const maxTurns = getBudgets().glm.leaderMaxTurns;
    if (state?.wrapUpGranted && state.turnsUsed >= maxTurns) {
      const lease = await claimLease(id);
      if (!lease) {
        return Response.json({ error: "A live executor holds this run's lease." }, { status: 409 });
      }
      try {
        if (stranded.length > 0) {
          await db.agentTask.updateMany({
            where: { id: { in: stranded.map((t) => t.id) } },
            data: { status: "failed" },
          });
        }
        const { status, report } = await reconcileWrapUpFromDb(id);
        return Response.json({ status, reconciled: true, report });
      } finally {
        await releaseLease(id, lease);
      }
    }

    // Normal resume — claim synchronously so a live lease 409s before we
    // respond (no double executor while a fresh lease exists).
    if (await leaseIsAlive(id)) {
      return Response.json(
        { error: "A live executor holds this run's lease — it is still working. Poll the run instead." },
        { status: 409 }
      );
    }
    const lease = await claimLease(id);
    if (!lease) {
      return Response.json({ error: "A live executor holds this run's lease." }, { status: 409 });
    }
    if (stranded.length > 0) {
      await db.agentTask.updateMany({
        where: { id: { in: stranded.map((t) => t.id) } },
        data: { status: "failed" },
      });
    }
    // Execute in the background — the claim (epoch increment) already happened.
    after(async () => {
      await executeRun(id, { resume: true, lease });
    });
    return Response.json({ resumed: true, leaseEpoch: lease.epoch }, { status: 202 });
  } catch (error) {
    const { message, status } = errorStatus(error);
    return Response.json({ error: message }, { status });
  }
}
