// ---------------------------------------------------------------------------
// Novara AI — on-demand usage retention sweep (Phase 5 / P5-f, Ruling R-2).
//
// Rolls every UsageCall row older than the 90-day window into UsageDaily,
// then deletes exactly those detail rows. Idempotent: running it twice in a
// row sweeps zero rows the second time. Aggregates are NEVER deleted.
//
// The same function also runs once at server start (src/instrumentation.ts).
// Zero GLM calls; zero new dependencies.
// Usage: bun scripts/purge-usage.ts
// ---------------------------------------------------------------------------

import { purgeExpiredUsageCalls } from "../src/lib/usage/retention";
import { db } from "../src/lib/db";

const retentionDays = Number(process.argv[2] ?? "");

async function main() {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : undefined;
  const before = await db.usageCall.count();
  const result = await purgeExpiredUsageCalls(days);
  const after = await db.usageCall.count();
  console.log(
    `[purge-usage] retention=${days ?? 90}d swept=${result.swept} deleted=${result.deleted} buckets=${result.buckets} details ${before}->${after}`
  );
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error("[purge-usage] sweep failed:", error instanceof Error ? error.message : error);
  await db.$disconnect();
  process.exit(1);
});
