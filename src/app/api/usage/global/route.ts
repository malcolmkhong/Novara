// ---------------------------------------------------------------------------
// Novara AI — global GLM usage ledger endpoint (P4 / T5).
//
// GET /api/usage/global → every MEASURED GLM call this server process has
// made since startup, grouped by app surface (agent / draft / review /
// sediment / studio / detect / generate / wizard / ai-team). The Context
// Usage panel's "All AI surfaces" block renders this — token transparency
// doesn't stop at the agent run boundary.
//
// In-memory by design: the ledger lives on globalThis and resets when the
// server restarts. That is stated in the panel, not hidden.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { globalUsageSnapshot } from "@/lib/usage/ledger";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(globalUsageSnapshot(), {
    headers: { "Cache-Control": "no-store" },
  });
}
