// ---------------------------------------------------------------------------
// Novara AI — the lifecycle moves for one authored asset (STEP 79).
//
//   POST /api/novels/[id]/[kind]/[assetId]/reopen    → status "draft"
//   POST /api/novels/[id]/[kind]/[assetId]/finalize  → status "final"
//
// kind: chapter | contract | character | world_entry | outline_beat |
//       volume | pack
//
// Both moves are idempotent, both are ownership-checked (the read runs
// through the ownership extension, so an asset of a novel the caller does not
// own is 404, never 403), and both write ONE AssetTransition row.
//
// A reopen changes NOTHING in the memory pool. A finalize projects the
// chapter's memory (or retires the facts that name a canon asset).
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
  params: Promise<{ id: string; kind: string; assetId: string; move: string }>;
};

function isLifecycleMove(value: string): value is LifecycleMove {
  return value === "reopen" || value === "finalize";
}

export async function POST(req: Request, { params }: Params) {
  const { id, kind, assetId, move } = await params;
  if (!isLifecycleKind(kind)) {
    return Response.json({ error: "unknown_kind", kind }, { status: 404 });
  }
  if (!isLifecycleMove(move)) {
    return Response.json({ error: "unknown_move", move }, { status: 404 });
  }
  const result = await moveAsset({
    kind: kind as LifecycleKind,
    assetId,
    novelId: id,
    move,
    byUid: callerUid(req) ?? "",
    source: "author",
  });
  if (!result.ok) {
    return Response.json(result.body, { status: result.status });
  }
  return Response.json(result);
}
