// ---------------------------------------------------------------------------
// Novara AI — persisted account usage ledger endpoint (Phase 5 / P5-a).
//
// GET /api/usage/ledger?period=YYYY-MM (optional; default = all-time) → the
// account-scope snapshot from the PERSISTED UsageCall table: every measured
// GLM call since the ledger shipped, grouped by surface and by novel
// (deleted novels render as "(deleted novel)" — Ruling 1: ledger rows are
// permanent account history, never cascade-deleted with content).
//
// This is the P5-b data source for the central "Usage & balance" view and
// the Context Usage panel's "All AI surfaces" block — one source of truth
// (Ruling 2). The in-memory /api/usage/global stays available until the
// P5-b swap retires it; do not add new consumers.
//
// Honesty: only measured calls exist here (null usage never records);
// `since` is the earliest persisted row — rows before Phase 5 simply do not
// exist, and the UI states that discontinuity rather than hiding it.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { accountUsageSnapshot } from "@/lib/usage/usage-store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const period = new URL(req.url).searchParams.get("period") ?? undefined;
  const snapshot = await accountUsageSnapshot(period ?? undefined);
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}
