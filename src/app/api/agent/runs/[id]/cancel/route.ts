// POST /api/agent/runs/[id]/cancel — abort the run; unsettled drafts discarded.

import { cancelRun, errorStatus } from "@/lib/agent/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  try {
    const detail = await cancelRun(id);
    return Response.json({ detail });
  } catch (error) {
    const { message, status } = errorStatus(error);
    return Response.json({ error: message }, { status });
  }
}
