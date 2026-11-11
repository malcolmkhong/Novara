// ---------------------------------------------------------------------------
// Novara AI — Agent run collection endpoints (Phase 3, contract §4.1).
//
// GET  /api/agent/runs?novelId=…            → recent runs (summaries)
// GET  /api/agent/runs?novelId=…&limit=…    → same list, page size 1..50 (default 20)
// GET  /api/agent/runs?novelId=…&active=1   → active run DETAIL or null
// GET  /api/agent/runs?novelId=…&latest=1   → latest run DETAIL (any status)
// POST /api/agent/runs {novelId, goal, mode} → create + kick the executor
//                                              via after() (response is fast;
//                                              planning streams via SSE)
// ---------------------------------------------------------------------------

import { after } from "next/server";
import { parseBody, validationError } from "@/lib/novara/api-helpers";
import { startRunInputSchema } from "@/lib/novara/agent-schemas";
import { canAfford, callerUid } from "@/lib/credits/charge";
import {
  activeRunFor,
  createRun,
  errorStatus,
  executeRun,
  healStaleRuns,
  latestRunFor,
  listRuns,
} from "@/lib/agent/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(req: Request) {
  await healStaleRuns();
  const url = new URL(req.url);
  const novelId = url.searchParams.get("novelId");
  if (!novelId) {
    return Response.json({ error: "novelId query parameter is required" }, { status: 400 });
  }

  if (url.searchParams.get("active") === "1") {
    const detail = await activeRunFor(novelId);
    return Response.json({ detail });
  }

  if (url.searchParams.get("latest") === "1") {
    const detail = await latestRunFor(novelId);
    return Response.json({ detail });
  }

  // STEP 65 — optional page size for the rail's Write list. The ONLY change
  // to this route: `limit` is clamped to 1..50 and defaults to 20 (the
  // runtime's own default). The query itself is untouched — the ownership
  // filter is applied by the db.ts $allOperations extension (rule 2:
  // AgentRun.novelId in the caller's owned novel ids), so nothing here may
  // add, remove or reorder a where clause.
  const rawLimit = url.searchParams.get("limit");
  const parsedLimit =
    rawLimit === null ? 20 : Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(50, Math.max(1, parsedLimit))
    : 20;

  const runs = await listRuns(novelId, limit);
  return Response.json({ runs });
}

export async function POST(req: Request) {
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = startRunInputSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  // Step 57 — D15: an agent run is a HARD surface. The whole turn must be
  // affordable BEFORE the run starts, so an unfunded user is refused here
  // (402) instead of getting a run that dies in the background. The run
  // itself still charges every turn it makes (the choke point does that).
  const uid = callerUid(req);
  if (!uid) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const affordable = await canAfford(uid, "agent-turn");
  if (!affordable.ok) {
    if (affordable.reason === "kill-switch") {
      return Response.json({ error: "globally_paused" }, { status: 429 });
    }
    return Response.json(
      {
        error: "insufficient_credits",
        need: affordable.need ?? 0,
        balance: affordable.balance ?? 0,
        resetAt: affordable.resetAt ?? null,
      },
      { status: 402 },
    );
  }

  try {
    const detail = await createRun({
      novelId: schema.data.novelId,
      goal: schema.data.goal,
      mode: schema.data.mode,
      pinned: schema.data.pinned,
      modelId: schema.data.modelId,
      thinkingLevel: schema.data.thinkingLevel,
    });
    // Execute in the background — the board fills in via SSE.
    after(async () => {
      await executeRun(detail.run.id);
    });
    return Response.json({ detail }, { status: 201 });
  } catch (error) {
    const { message, status } = errorStatus(error);
    return Response.json({ error: message }, { status });
  }
}
