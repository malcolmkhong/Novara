// ---------------------------------------------------------------------------
// Novara AI — the lifecycle moves for one ledger row (STEP 79).
//
//   POST /api/ledger/[kind]/[id]/reopen    → lock "draft"
//   POST /api/ledger/[kind]/[id]/finalize  → lock "final"
//
// kind: storyline | timeline | arc | promise | clue
//
// The ledger rows are authored canon assets like every other authored entity,
// so they obey the same rule — and their canon flag lives in a differently
// named column (`lock` for storyline/promise/clue, `status` for timeline/arc),
// which the lifecycle service knows.
//
// Both moves are idempotent, both are ownership-checked (the read runs
// through the ownership extension, so a row of a novel the caller does not own
// is 404, never 403), and both write ONE AssetTransition row.
// ---------------------------------------------------------------------------

import { callerUid } from "@/lib/credits/charge";
import {
  isLifecycleKind,
  moveAsset,
  type LifecycleKind,
  type LifecycleMove,
} from "@/lib/novara/lifecycle";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ kind: string; id: string; move: string }>;
};

const LEDGER_KINDS = ["storyline", "timeline", "arc", "promise", "clue"];

function isLifecycleMove(value: string): value is LifecycleMove {
  return value === "reopen" || value === "finalize";
}

export async function POST(req: Request, { params }: Params) {
  const { kind, id, move } = await params;
  if (!LEDGER_KINDS.includes(kind) || !isLifecycleKind(kind)) {
    return Response.json({ error: "unknown_kind", kind }, { status: 404 });
  }
  if (!isLifecycleMove(move)) {
    return Response.json({ error: "unknown_move", move }, { status: 404 });
  }
  const result = await moveAsset({
    kind: kind as LifecycleKind,
    assetId: id,
    move,
    byUid: callerUid(req) ?? "",
    source: "author",
  });
  if (!result.ok) {
    return Response.json(result.body, { status: result.status });
  }
  return Response.json(result);
}
