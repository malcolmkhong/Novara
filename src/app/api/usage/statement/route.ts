// ---------------------------------------------------------------------------
// Novara AI — CSV usage statement endpoint (Phase 5 / P5-f, Ruling R-2).
//
// GET /api/usage/statement → text/csv attachment. The R-2 export: ALL
// retained detail rows (the 90-day window) + ALL persisted daily summaries
// (older than 90 days — the only surviving trace of purged details), plus
// labeled totals. Built entirely in memory — ZERO server-side file
// persistence; the browser downloads it straight from the response body.
//
// This is the user's pre-expiry escape hatch: once the sweep deletes a
// detail row (always AFTER rolling it into UsageDaily) the per-call line
// exists nowhere except in statements already exported.
// ---------------------------------------------------------------------------

import { contentDisposition } from "@/lib/novara/api-helpers";
import { buildUsageStatement } from "@/lib/usage/retention";

export const dynamic = "force-dynamic";

export async function GET() {
  const csv = await buildUsageStatement();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(
        "attachment",
        `novara-usage-statement-${stamp}.csv`
      ),
      "Cache-Control": "no-store",
    },
  });
}
