// ---------------------------------------------------------------------------
// Novara AI — Agent run collection endpoints (Phase 3, contract §4.1).
//
// GET  /api/agent/runs?novelId=…            → recent runs (summaries)
// GET  /api/agent/runs?novelId=…&active=1   → active run DETAIL or null
// GET  /api/agent/runs?novelId=…&latest=1   → latest run DETAIL (any status)
// POST /api/agent/runs {novelId, goal, mode} → create + kick the executor
//                                              via after() (response is fast;
//                                              planning streams via SSE)
// ---------------------------------------------------------------------------

import { after } from "next/server";
import { parseBody, validationError } from "@/lib/novara/api-helpers";
import { startRunInputSchema } from "@/lib/novara/agent-schemas";
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

  const runs = await listRuns(novelId);
  return Response.json({ runs });
}

export async function POST(req: Request) {
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = startRunInputSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  try {
    const detail = await createRun({
      novelId: schema.data.novelId,
      goal: schema.data.goal,
      mode: schema.data.mode,
      pinned: schema.data.pinned,
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
