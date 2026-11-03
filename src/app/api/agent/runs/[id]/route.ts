// GET /api/agent/runs/[id] — full run detail (run + tasks + events + gate).

import { errorStatus, getRunDetail, healStaleRuns } from "@/lib/agent/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  await healStaleRuns();
  const { id } = await params;
  try {
    const detail = await getRunDetail(id);
    if (!detail) return Response.json({ error: "Run not found" }, { status: 404 });
    return Response.json({ detail });
  } catch (error) {
    const { message, status } = errorStatus(error);
    return Response.json({ error: message }, { status });
  }
}
