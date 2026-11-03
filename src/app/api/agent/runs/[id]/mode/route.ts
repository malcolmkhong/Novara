// POST /api/agent/runs/[id]/mode — flip execution mode mid-run (D2).
// Body: { mode: "approval" | "full_access" }
// Takes effect at the NEXT gate; an already-open gate is decided manually.

import { parseBody, validationError } from "@/lib/novara/api-helpers";
import { setRunModeSchema } from "@/lib/novara/agent-schemas";
import { errorStatus, setRunMode } from "@/lib/agent/runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = setRunModeSchema.safeParse({ ...(parsed.data as object), runId: id });
  if (!schema.success) return validationError(schema.error);

  try {
    const detail = await setRunMode(id, schema.data.mode);
    return Response.json({ detail });
  } catch (error) {
    const { message, status } = errorStatus(error);
    return Response.json({ error: message }, { status });
  }
}
