// ---------------------------------------------------------------------------
// Novara AI — per-novel usage ledger endpoint (Phase 5 / P5-a).
//
// GET /api/novels/[id]/usage → the novel's OWN complete usage ledger
// (Ruling: every novel has its own totals, complete for post-creation
// attribution):
//   - `direct` — calls tagged with this novelId at record time (agent runs,
//     draft/review/sediment, novel-scoped studio calls);
//   - `linked` — calls attached retroactively via UsageProvenance (the
//     pre-novel wizard session that culminated in this novel);
//   - `total`  — direct + linked (the two sets are disjoint by construction).
//
// 404 for an unknown novel; the ACCOUNT view (not this route) is where
// deleted novels' history renders as "(deleted novel)".
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { novelUsageSummary } from "@/lib/usage/usage-store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const summary = await novelUsageSummary(id);
  if (!summary) {
    return NextResponse.json({ error: "Novel not found" }, { status: 404 });
  }
  return NextResponse.json(summary, {
    headers: { "Cache-Control": "no-store" },
  });
}
