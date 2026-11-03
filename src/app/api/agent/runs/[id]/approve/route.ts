// POST /api/agent/runs/[id]/approve — D2 gate decision.
// Body: { taskId, decision: "approve" | "reject" }
// approve  → the PENDING WRITE is committed here (the model never commits),
//            task → done, run → running (executor resumes from its poll).
// reject   → nothing is written; task → blocked, run → paused.

import { parseBody, validationError } from "@/lib/novara/api-helpers";
import { approvalDecisionSchema } from "@/lib/novara/agent-schemas";
import { decideApproval, errorStatus } from "@/lib/agent/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = approvalDecisionSchema.safeParse({ ...(parsed.data as object), runId: id });
  if (!schema.success) return validationError(schema.error);

  try {
    const detail = await decideApproval(id, schema.data.taskId, schema.data.decision);
    return Response.json({ detail });
  } catch (error) {
    const { message, status } = errorStatus(error);
    return Response.json({ error: message }, { status });
  }
}
