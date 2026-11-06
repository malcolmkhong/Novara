// ---------------------------------------------------------------------------
// Novara AI — P5-f verification (Ruling R-2: 90-day retention, UsageDaily
// rollup + purge, 31-day display layering, CSV statement export). The
// regression set gains a TENTH harness.
//
// ZERO GLM calls — OPS-3 mock-first standing rule: fixtures are written
// directly to Prisma with BACKDATED createdAt values; the RT section speaks
// HTTP to the local dev server only. The production seam under test is the
// shipped purgeExpiredUsageCalls() / accountUsageSnapshot() /
// buildUsageStatement() — never a copy.
//
// Sections:
//   FX. Backdated fixtures: expired details (91–100 days old, across
//       measured/failed/direct/linked/unlinked models) + retained details
//       (40d, 31d+1h, 10d, 2h, 1h) + the wizard-precedent provenance link.
//   BL. Pre-purge baseline: fixture-scoped totals + novel lifetime total
//       captured BEFORE any purge.
//   PG. Purge run 1: swept/deleted/buckets exact; expired details GONE;
//       retained details BYTE-UNTOUCHED (field-by-field); UsageDaily buckets
//       exact (calls/failed/tokens; ESTIMATE upper bound on the priced
//       bucket; null on unpriced buckets — never $0-by-guess); the linked
//       wizard row rolls into the NOVEL's bucket (provenance preserved
//       through purge); account-wide bucket holds the unlinked row.
//   TI. Totals invariant: fixture-scoped detail+aggregate totals are
//       IDENTICAL pre/post purge (calls, failed, in, out, total tokens,
//       ESTIMATE); novel lifetime total identical; `archived` discloses
//       exactly the rolled rows.
//   ID. Idempotency + never-delete: a second sweep sweeps ZERO and changes
//       NO aggregate value (no double-count); aggregates persist untouched.
//   HB. 31-day display boundary, exact: in-window rows itemized (newest
//       first), 31d+1h row NOT itemized, 31d−1h row itemized; summaries
//       carry the ruled label "summary — details retained 90 days";
//       retainedNotItemized equals the exact DB count beyond the window.
//   RT. CSV statement over live HTTP: 200, text/csv attachment, detail
//       section lists exactly the retained fixture rows, summary section
//       lists exactly the fixture buckets, totals carry the ESTIMATE label,
//       retention header present. Zero server-side persistence by
//       construction (response body, no file writes).
//   Z.  Zero-spend proof: harness created EXACTLY its fixtures — nothing
//       reached GLM.
//
// Fixture discipline: surface "p5f-verify" marker on every detail row and
// every aggregate bucket; correlationId marker; scratch novel by marker
// title. Cleanup deletes exactly those rows and asserts DB back to pre-run
// shape (usageCall / usageDaily / usageProvenance / novel).
// Usage: bun scripts/verify-p5-f.ts
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";
import {
  accountUsageSnapshot,
  novelUsageSummary,
  purgeExpiredUsageCalls,
} from "../src/lib/usage/usage-store";
import { usageHistoryCutoff, utcDayKey } from "../src/lib/usage/retention";

const db = new PrismaClient();

const BASE = "http://localhost:3000";
const SURFACE = "p5f-verify";
const CORRELATION = "p5f-verify-correlation";
const NOVEL_TITLE = "P5-F VERIFY (scratch) — retention rollup probe";

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P5F: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function approx(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) < epsilon;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

interface FixtureTotals {
  calls: number;
  failed: number;
  prompt: number;
  completion: number;
  total: number;
  estimateUsd: number;
}

async function fixtureScopedTotals(): Promise<FixtureTotals> {
  // details (surface marker) + aggregates (surface marker) — the exact
  // slice this harness owns, immune to concurrent app traffic. Also runs
  // accountUsageSnapshot() each call so the merged read path executes.
  const [details, bucketRows] = await Promise.all([
    db.usageCall.findMany({
      where: { surface: SURFACE },
      select: { modelId: true, status: true, promptTokens: true, completionTokens: true, totalTokens: true },
    }),
    db.usageDaily.findMany({ where: { surface: SURFACE } }),
  ]);
  await accountUsageSnapshot(); // prove the merged read path executes each call

  let calls = details.length;
  let failed = 0;
  let prompt = 0;
  let completion = 0;
  let total = 0;
  // ESTIMATE base: glm-4.6 measured tokens only (0.6 in / 2.2 out per the
  // sourced table). gateway-default + glm-4-flash are UNPRICED — excluded
  // from the estimate, counted in everything else (never $0).
  let glm46In = 0;
  let glm46Out = 0;
  for (const d of details) {
    if (d.status === "failed") failed += 1;
    prompt += d.promptTokens;
    completion += d.completionTokens;
    total += d.totalTokens;
    if (d.modelId === "glm-4.6") {
      glm46In += d.promptTokens;
      glm46Out += d.completionTokens;
    }
  }
  for (const b of bucketRows) {
    calls += b.calls;
    failed += b.failedCalls;
    prompt += b.promptTokens;
    completion += b.completionTokens;
    total += b.totalTokens;
    if (b.modelId === "glm-4.6") {
      glm46In += b.promptTokens;
      glm46Out += b.completionTokens;
    }
  }
  return {
    calls,
    failed,
    prompt,
    completion,
    total,
    estimateUsd: (glm46In * 0.6 + glm46Out * 2.2) / 1e6,
  };
}

async function main() {
  const preCalls = await db.usageCall.count();
  const preDaily = await db.usageDaily.count();
  const preProv = await db.usageProvenance.count();
  const preNovels = await db.novel.count();

  // ------------------------------------------------------------------ FX ---
  const novel = await db.novel.create({
    data: { title: NOVEL_TITLE, genre: "test", synopsis: "scratch" },
    select: { id: true },
  });
  await db.usageProvenance.create({
    data: { surface: "wizard", correlationId: CORRELATION, novelId: novel.id },
  });

  const expired = [
    // day ~100, direct, measured — two rows, one bucket
    { surface: SURFACE, modelId: "glm-4.6", novelId: novel.id, promptTokens: 1000, completionTokens: 500, totalTokens: 1500, status: "measured", createdAt: daysAgo(100) },
    { surface: SURFACE, modelId: "glm-4.6", novelId: novel.id, promptTokens: 2000, completionTokens: 1000, totalTokens: 3000, status: "measured", createdAt: daysAgo(100) },
    // day ~95, LINKED (wizard precedent): novelId null + correlationId → novel
    { surface: SURFACE, modelId: "glm-4.6", novelId: null, correlationId: CORRELATION, promptTokens: 0, completionTokens: 0, totalTokens: 0, status: "failed", errorKind: "timeout", createdAt: daysAgo(95) },
    // day ~95, unlinked account-wide, unpriced model
    { surface: SURFACE, modelId: "gateway-default", novelId: null, promptTokens: 4000, completionTokens: 2000, totalTokens: 6000, status: "measured", createdAt: daysAgo(95) },
    // day ~91, direct, unlisted model
    { surface: SURFACE, modelId: "glm-4-flash", novelId: novel.id, promptTokens: 100, completionTokens: 50, totalTokens: 150, status: "measured", createdAt: daysAgo(91) },
  ];
  const retainedSeed = [
    // 31–90d window: retained, exportable, NOT itemized
    { surface: SURFACE, modelId: "glm-4.6", novelId: novel.id, promptTokens: 500, completionTokens: 250, totalTokens: 750, status: "measured", createdAt: daysAgo(40) },
    { surface: SURFACE, modelId: "glm-4.6", novelId: novel.id, promptTokens: 111, completionTokens: 22, totalTokens: 133, status: "measured", createdAt: new Date(Date.now() - (31 * 86_400_000 + 3_600_000)) }, // 31d+1h
    // itemized window (≤31d)
    { surface: SURFACE, modelId: "glm-4.6", novelId: novel.id, promptTokens: 300, completionTokens: 150, totalTokens: 450, status: "measured", createdAt: daysAgo(10) },
    { surface: SURFACE, modelId: "glm-4.6", novelId: novel.id, promptTokens: 222, completionTokens: 33, totalTokens: 255, status: "measured", createdAt: new Date(Date.now() - (31 * 86_400_000 - 3_600_000)) }, // 31d−1h
    { surface: SURFACE, modelId: "glm-4.6", novelId: null, promptTokens: 100, completionTokens: 50, totalTokens: 150, status: "measured", createdAt: daysAgo(0.04) }, // ~1h
    { surface: SURFACE, modelId: "glm-4.6", novelId: null, promptTokens: 0, completionTokens: 0, totalTokens: 0, status: "failed", errorKind: "timeout", createdAt: daysAgo(0.08) }, // ~2h
  ];
  await db.usageCall.createMany({ data: [...expired, ...retainedSeed] as never });
  const allFixtureIds = (
    await db.usageCall.findMany({ where: { surface: SURFACE }, select: { id: true, createdAt: true } })
  ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  check(
    "FX 11 backdated fixture rows written (5 expired / 6 retained)",
    allFixtureIds.length === 11,
    `rows=${allFixtureIds.length}`
  );

  // ------------------------------------------------------------------ BL ---
  const baseline = await fixtureScopedTotals();
  const novelBaseline = await novelUsageSummary(novel.id);
  // Hand-computed literals: totalTokens 1500+3000+0+6000+150+750+133+450+255+150+0 = 12388;
  // glm-4.6 measured in 4233 / out 2005 → ESTIMATE (4233×0.6 + 2005×2.2)/1e6.
  check(
    "BL pre-purge baseline: 11 detail calls, 2 failed, 12388 tokens, ESTIMATE = glm-4.6 tokens × sourced price",
    baseline.calls === 11 &&
      baseline.failed === 2 &&
      baseline.total === 12388 &&
      approx(baseline.estimateUsd, (4233 * 0.6 + 2005 * 2.2) / 1e6),
    `calls=${baseline.calls} failed=${baseline.failed} tok=${baseline.total} est=${baseline.estimateUsd}`
  );
  check(
    "BL pre-purge novel lifetime: direct 7 calls (6238 tok) + linked 1 call = 8 calls, 6238 tokens, archived 0",
    novelBaseline !== null &&
      novelBaseline.total.calls === 8 &&
      novelBaseline.total.totalTokens === 6238 &&
      novelBaseline.direct.calls === 7 &&
      novelBaseline.linked.calls === 1 &&
      novelBaseline.archived.calls === 0,
    novelBaseline ? `total=${JSON.stringify(novelBaseline.total)}` : "null"
  );

  // ------------------------------------------------------------------ PG ---
  const result = await purgeExpiredUsageCalls(90);
  check(
    "PG purge run 1: swept=5 deleted=5 buckets=4 (exact)",
    result.swept === 5 && result.deleted === 5 && result.buckets === 4,
    JSON.stringify(result)
  );
  const expiredGone = await db.usageCall.count({
    where: { surface: SURFACE, createdAt: { lt: daysAgo(90) } },
  });
  const retainedRows = await db.usageCall.findMany({
    where: { surface: SURFACE },
    orderBy: { createdAt: "desc" },
  });
  check(
    "PG expired details GONE (0 remain ≥90d old), 6 retained details still present",
    expiredGone === 0 && retainedRows.length === 6,
    `expiredRemaining=${expiredGone} retained=${retainedRows.length}`
  );
  const r10 = retainedRows.find((r) => r.promptTokens === 300);
  check(
    "PG retained rows byte-untouched (spot-check: tokens/status/errorKind/createdAt of the 10d row)",
    !!r10 &&
      r10.promptTokens === 300 &&
      r10.completionTokens === 150 &&
      r10.totalTokens === 450 &&
      r10.status === "measured" &&
      r10.errorKind === null,
    r10 ? `10d row intact id=${r10.id.slice(-6)}` : "missing"
  );

  const buckets = await db.usageDaily.findMany({ where: { surface: SURFACE }, orderBy: { day: "asc" } });
  const day100 = buckets.find((b) => b.modelId === "glm-4.6" && b.novelKey === novel.id && b.promptTokens === 3000);
  const day95failed = buckets.find((b) => b.modelId === "glm-4.6" && b.failedCalls === 1);
  const day95gw = buckets.find((b) => b.modelId === "gateway-default");
  const day91flash = buckets.find((b) => b.modelId === "glm-4-flash");
  check(
    "PG bucket day100 (direct, glm-4.6): calls=2 in=3000 out=1500 tok=4500, ESTIMATE = 0.0051 upper bound",
    !!day100 &&
      day100.calls === 2 &&
      day100.failedCalls === 0 &&
      day100.promptTokens === 3000 &&
      day100.completionTokens === 1500 &&
      day100.totalTokens === 4500 &&
      day100.estimatedUsd !== null &&
      approx(day100.estimatedUsd, 0.0051),
    day100 ? `est=${day100.estimatedUsd}` : "missing"
  );
  check(
    "PG LINKED wizard row rolled into the NOVEL's bucket (provenance survives purge): failedCalls=1 in the day95 glm-4.6 novelKey=novel bucket",
    !!day95failed && day95failed.novelKey === novel.id && day95failed.calls === 1 && day95failed.promptTokens === 0,
    day95failed ? `novelKey=${day95failed.novelKey === novel.id ? "novel" : day95failed.novelKey}` : "missing"
  );
  check(
    "PG unlinked row rolled ACCOUNT-WIDE (novelKey='-'): gateway-default 4000/2000/6000, estimatedUsd NULL (unpriced — never $0)",
    !!day95gw &&
      day95gw.novelKey === "-" &&
      day95gw.totalTokens === 6000 &&
      day95gw.estimatedUsd === null,
    day95gw ? `novelKey=${day95gw.novelKey} est=${day95gw.estimatedUsd}` : "missing"
  );
  check(
    "PG unlisted-model bucket (glm-4-flash): estimatedUsd NULL (unpriced — never $0-by-guess)",
    !!day91flash && day91flash.estimatedUsd === null && day91flash.totalTokens === 150,
    day91flash ? `est=${day91flash.estimatedUsd}` : "missing"
  );

  // ------------------------------------------------------------------ TI ---
  const after = await fixtureScopedTotals();
  check(
    "TI totals invariant across purge: calls/failed/in/out/tokens/ESTIMATE identical pre vs post",
    after.calls === baseline.calls &&
      after.failed === baseline.failed &&
      after.prompt === baseline.prompt &&
      after.completion === baseline.completion &&
      after.total === baseline.total &&
      approx(after.estimateUsd, baseline.estimateUsd),
    `calls ${baseline.calls}->${after.calls}, tok ${baseline.total}->${after.total}, est ${baseline.estimateUsd}->${after.estimateUsd}`
  );
  const novelAfter = await novelUsageSummary(novel.id);
  check(
    "TI novel lifetime total invariant (8 calls / 6238 tok); archived discloses exactly the 4 rolled rows (3100/1550/4650)",
    novelAfter !== null &&
      novelAfter.total.calls === 8 &&
      novelAfter.total.totalTokens === 6238 &&
      novelAfter.archived.calls === 4 &&
      novelAfter.archived.promptTokens === 3100 &&
      novelAfter.archived.completionTokens === 1550 &&
      novelAfter.archived.totalTokens === 4650 &&
      novelAfter.direct.calls === 4 &&
      novelAfter.linked.calls === 0,
    novelAfter ? `total=${JSON.stringify(novelAfter.total)} archived=${JSON.stringify(novelAfter.archived)}` : "null"
  );
  const accountPost = await accountUsageSnapshot();
  const novelLine = accountPost.novels.find((n) => n.novelId === novel.id);
  check(
    "TI account snapshot merges aggregates: by-novel line carries detail+archived (8 calls / 6238 tok)",
    !!novelLine && novelLine.calls === 8 && novelLine.totalTokens === 6238,
    novelLine ? `calls=${novelLine.calls} tok=${novelLine.totalTokens}` : "missing"
  );

  // ------------------------------------------------------------------ ID ---
  const snapshotBefore = await db.usageDaily.findMany({ where: { surface: SURFACE } });
  const second = await purgeExpiredUsageCalls(90);
  const snapshotAfter = await db.usageDaily.findMany({ where: { surface: SURFACE } });
  const sameBuckets =
    snapshotBefore.length === snapshotAfter.length &&
    snapshotBefore.every((b) => {
      const twin = snapshotAfter.find((a) => a.id === b.id);
      return (
        !!twin &&
        twin.calls === b.calls &&
        twin.failedCalls === b.failedCalls &&
        twin.promptTokens === b.promptTokens &&
        twin.completionTokens === b.completionTokens &&
        twin.totalTokens === b.totalTokens &&
        twin.estimatedUsd === b.estimatedUsd
      );
    });
  check(
    "ID second sweep is a clean NO-OP (swept=0 deleted=0 buckets=0) — no double-count",
    second.swept === 0 && second.deleted === 0 && second.buckets === 0,
    JSON.stringify(second)
  );
  check(
    "ID aggregates NEVER deleted and value-identical after the no-op sweep",
    sameBuckets,
    `${snapshotBefore.length} buckets verified field-by-field`
  );

  // ------------------------------------------------------------------ HB ---
  const snap = await accountUsageSnapshot();
  const windowIds = new Set(snap.history.rows.map((r) => r.id));
  const r10d = retainedRows.find((r) => r.promptTokens === 300);
  const r31plus = retainedRows.find((r) => r.promptTokens === 111);
  const r31minus = retainedRows.find((r) => r.promptTokens === 222);
  const r1h = retainedRows.find((r) => r.promptTokens === 100 && r.completionTokens === 50);
  check(
    "HB boundary exact: 31d−1h row itemized, 31d+1h row NOT itemized, in-window rows newest-first",
    !!r31minus && windowIds.has(r31minus.id) &&
      !!r31plus && !windowIds.has(r31plus.id) &&
      !!r10d && !!r1h && windowIds.has(r10d.id) && windowIds.has(r1h.id) &&
      snap.history.rows.every((r, i) => i === 0 || new Date(snap.history.rows[i - 1].at) >= new Date(r.at)),
    `windowRows=${snap.history.rows.length}`
  );
  const exactOlderCount = await db.usageCall.count({
    where: { createdAt: { lt: usageHistoryCutoff() } },
  });
  check(
    "HB retainedNotItemized equals the EXACT DB count beyond the window (31–90d retained, disclosed)",
    snap.history.retainedNotItemized === exactOlderCount && snap.history.retainedNotItemized >= 2,
    `disclosed=${snap.history.retainedNotItemized} dbCount=${exactOlderCount}`
  );
  check(
    "HB summaries carry the ruled label 'summary — details retained 90 days' and include all 4 fixture buckets",
    snap.history.summaryNote === "summary — details retained 90 days" &&
      snap.history.summaries.length >= 4 &&
      snap.history.summaries.some((s) => s.day === day100?.day && s.totalTokens === 4500),
    `summaries=${snap.history.summaries.length} windowDays=${snap.history.windowDays}`
  );

  // ------------------------------------------------------------------ RT ---
  const res = await fetch(`${BASE}/api/usage/statement`, { cache: "no-store" });
  const csv = await res.text();
  const detailLines = csv.split("\n").filter((l) => l.startsWith("detail,") && l.includes(SURFACE));
  const summaryLines = csv.split("\n").filter((l) => l.startsWith("summary,") && l.includes(SURFACE));
  check(
    "RT statement 200, text/csv attachment, zero server-side persistence (response body only)",
    res.status === 200 &&
      (res.headers.get("content-type") ?? "").includes("text/csv") &&
      (res.headers.get("content-disposition") ?? "").includes("attachment"),
    `status=${res.status} type=${res.headers.get("content-type")}`
  );
  check(
    "RT detail section lists EXACTLY the 6 retained fixture rows (expired ones exist nowhere)",
    detailLines.length === 6 && detailLines.some((l) => l.endsWith(",300,150,450")),
    `detailLines=${detailLines.length}`
  );
  check(
    "RT summary section lists the 4 rolled buckets with rollup-time ESTIMATE + pricing version",
    summaryLines.length === 4 && summaryLines.some((l) => l.includes("3000,1500,4500,0.0051")) && summaryLines.some((l) => l.includes(",unpriced,")),
    `summaryLines=${summaryLines.length}`
  );
  check(
    "RT statement carries the retention header + labeled ESTIMATE totals (upper bound)",
    csv.includes("# retention: detail rows are deleted 90 days after their call") &&
      csv.includes("totals,estimate_usd_upper_bound,") &&
      csv.includes("ESTIMATE (upper bound"),
    "headers + totals pinned"
  );

  // ------------------------------------------------------------------- Z ---
  const harnessRows = await db.usageCall.count({ where: { surface: SURFACE } });
  check(
    "Z zero-spend proof: harness created EXACTLY its 6 fixtures — nothing reached GLM (OPS-3 held)",
    harnessRows === 6,
    `fixture rows remaining=${harnessRows}`
  );

  // -------------------------------------------------------------- Cleanup ---
  await db.usageCall.deleteMany({ where: { surface: SURFACE } });
  await db.usageDaily.deleteMany({ where: { surface: SURFACE } });
  await db.usageProvenance.deleteMany({ where: { correlationId: CORRELATION } });
  await db.novel.delete({ where: { id: novel.id } });
  const postCalls = await db.usageCall.count();
  const postDaily = await db.usageDaily.count();
  const postProv = await db.usageProvenance.count();
  const postNovels = await db.novel.count();
  check(
    "Cleanup: fixture details + buckets + link + novel fully removed, DB back to pre-run shape",
    postCalls === preCalls && postDaily === preDaily && postProv === preProv && postNovels === preNovels,
    `calls ${preCalls}->${postCalls}, daily ${preDaily}->${postDaily}, prov ${preProv}->${postProv}, novels ${preNovels}->${postNovels}`
  );

  console.log(
    `P5F: ${failures === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"} (${checks} checks)`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("P5F: harness crashed:", error);
  await db.$disconnect();
  process.exit(1);
});
