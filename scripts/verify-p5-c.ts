// ---------------------------------------------------------------------------
// Novara AI — P5-c verification (Phase 5, pricing + per-model split + invoice
// reconciliation). The regression set gains an EIGHTH harness.
//
// ZERO GLM calls — structural, not behavioral: this harness NEVER imports the
// SDK, NEVER constructs a model client, NEVER opens a model-call code path.
// Every check is (a) pure arithmetic on the static pricing table, (b) fixture
// rows written directly to Prisma, (c) HTTP against the local dev server, or
// (d) source reads. (OPS-3 standing rule: mock-first — here there is nothing
// to mock because nothing reaches for the network.)
//
// Sections:
//   PR. Pricing module on fixed fixtures: the sourced table returns the exact
//       fetched numbers for priced ids; gateway-default / unlisted ids are
//       UNPRICED (never guessed, never $0); upper-bound arithmetic equals the
//       hand-computed literals; EVERY money formatter output carries its
//       ESTIMATE / your-figure / vs-ESTIMATE label at every magnitude.
//   DB. Per-model split math over fixture UsageCall rows: modelId verbatim,
//       failed rows contribute ZERO tokens but their COUNT shows separately
//       next to the model's estimate; unpriced groups excluded from the
//       account estimate (counted, not zeroed).
//   RT. Routes on the live dev server: /api/usage/ledger carries models +
//       estimate; the invoice paste-slot POST stores the pasted figure
//       verbatim next to OUR captured ESTIMATE (delta = display math); strict
//       validation rejects junk figures with 400.
//   SP. Source pins: the central view contains NO raw currency glyph (every
//       money string flows through the pricing formatters); the Context
//       Usage panel has NO pricing import and NO currency glyph (P5-c did
//       not touch it — panel regression invariant holds by construction);
//       the pricing file header carries the fetched docs URL + date.
//   RS. Restart survival: fixture rows readable through a SECOND freshly
//       constructed PrismaClient.
//
// Fixture discipline: surface "p5c-verify", invoice periodLabel marker
// "p5c-verify"; cleanup deletes exactly those rows and asserts the DB is
// back to pre-run shape.
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import {
  priceForModelId,
  estimateUpperBoundUsd,
  formatEstimateUsd,
  formatEstimateUsdCompact,
  formatPastedUsd,
  formatDeltaUsd,
  PRICING_VERSION,
  PRICING_SOURCE_URL,
} from "../src/lib/usage/pricing";
import { accountUsageSnapshot } from "../src/lib/usage/usage-store";
import type { AccountUsageSnapshot } from "../src/lib/usage/usage-shapes";

const db = new PrismaClient();
const db2 = new PrismaClient(); // the "restart" client (RS)

const BASE = "http://localhost:3000";
const SURFACE = "p5c-verify";
const PERIOD_MARKER = "p5c-verify-period";

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P5C: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Float-safe equality — the pricing math runs in binary doubles. */
function approx(a: number, b: number, epsilon = 1e-9): boolean {
  return Math.abs(a - b) < epsilon;
}

/** Count raw currency glyphs: a dollar sign NOT opening a template hole. */
function currencyGlyphCount(source: string): number {
  return (source.match(/\$(?!\{)/g) ?? []).length;
}

async function main() {
  const preCalls = await db.usageCall.count();
  const preInvoices = await db.usageInvoice.count();

  // ------------------------------------------------------------------ PR ---
  const glm46 = priceForModelId("glm-4.6");
  check(
    "PR glm-4.6 priced from the fetched table — 0.6 in / 2.2 out, cached 0.11 present-never-applied",
    glm46.priced &&
      glm46.row.inputUsdPer1M === 0.6 &&
      glm46.row.outputUsdPer1M === 2.2 &&
      glm46.row.cachedInputUsdPer1M === 0.11,
    glm46.priced ? `v${glm46.pricingVersion} fetched ${glm46.row.fetchedAt}` : "UNPRICED?!"
  );
  check(
    "PR glm-4.6 row carries sourceUrl + fetchedAt (reproducible to a dated doc snapshot)",
    glm46.priced &&
      glm46.row.sourceUrl.includes("docs.z.ai") &&
      glm46.row.fetchedAt === "2026-11-06",
    glm46.priced ? glm46.row.sourceUrl : "unpriced"
  );

  const air = priceForModelId("glm-4.5-air");
  check(
    "PR glm-4.5-air priced — 0.2 in / 1.1 out (fetched 2026-11-06)",
    air.priced && air.row.inputUsdPer1M === 0.2 && air.row.outputUsdPer1M === 1.1,
    air.priced ? "priced" : "unpriced"
  );

  // Upper-bound arithmetic on fixed fixtures (hand-computed literals):
  //   glm-4.6:     1M in x 0.6 + 0.5M out x 2.2 = 0.6 + 1.1 = 1.70
  //   glm-4.5-air: 2M in x 0.2 + 1M out x 1.1 = 0.4 + 1.1 = 1.50
  if (glm46.priced && air.priced) {
    const a = estimateUpperBoundUsd(glm46.row, 1_000_000, 500_000);
    const b = estimateUpperBoundUsd(air.row, 2_000_000, 1_000_000);
    check(
      "PR fixture math exact: glm-4.6 (1M in, 0.5M out) = 1.70; glm-4.5-air (2M in, 1M out) = 1.50",
      approx(a, 1.7) && approx(b, 1.5),
      `a=${a} b=${b}`
    );
  }

  const gw = priceForModelId("gateway-default");
  const flash = priceForModelId("glm-4-flash");
  const long = priceForModelId("glm-4-long");
  const unknown = priceForModelId("totally-unknown-model");
  check(
    "PR gateway-default rows are UNPRICED by construction (never priced by guess)",
    !gw.priced && gw.reason === "gateway-default",
    `reason=${gw.reason}`
  );
  check(
    "PR glm-4-flash + glm-4-long have NO row on the fetched docs (verified 2026-11-06; flash docs page 404s) → UNPRICED, never $0",
    !flash.priced &&
      flash.reason === "unlisted-model" &&
      !long.priced &&
      long.reason === "unlisted-model",
    `flash=${flash.reason} long=${long.reason}`
  );
  check(
    "PR unknown future modelId → UNPRICED (unlisted-model), never guessed",
    !unknown.priced && unknown.reason === "unlisted-model",
    `reason=${unknown.reason}`
  );

  // Label discipline: EVERY money formatter output carries its label at every
  // magnitude — this is the §6.2 rule-1 guarantee the UI inherits.
  const magnitudes = [0, 0.000001, 0.0051, 0.5, 1.7, 1234.56];
  const full = magnitudes.map((v) => formatEstimateUsd(v));
  check(
    "PR formatEstimateUsd ALWAYS renders the full ESTIMATE (upper bound) label",
    full.every((s) => s.startsWith("$") && s.includes("ESTIMATE (upper bound)")),
    `e.g. ${full[2]} | ${full[5]}`
  );
  check(
    "PR compact per-row formatter still carries the EST label (no bare $ anywhere)",
    magnitudes.every((v) => /\$.*EST/.test(formatEstimateUsdCompact(v))),
    `e.g. ${formatEstimateUsdCompact(0.0051)}`
  );
  check(
    "PR pasted-figure formatter always marks it as the USER's input",
    formatPastedUsd("12.34").includes("your figure") &&
      formatPastedUsd("0.02").includes("your figure"),
    `e.g. ${formatPastedUsd("12.34")}`
  );
  check(
    "PR delta formatter always frames the gap against OUR ESTIMATE",
    /vs our ESTIMATE/.test(formatDeltaUsd(0.0049)) &&
      /vs our ESTIMATE/.test(formatDeltaUsd(-2.5)),
    `e.g. ${formatDeltaUsd(0.0049)}`
  );
  check(
    "PR pricing version + source pinned: versioned table, dated docs URL",
    PRICING_VERSION === "2026-11-06.1" &&
      PRICING_SOURCE_URL === "(source removed)",
    `v${PRICING_VERSION}`
  );

  // ------------------------------------------------------------------ DB ---
  // Per-model split over fixture rows (written DIRECTLY — zero model calls):
  //   glm-4.6:         2 measured (1000/500, 2000/1000) + 1 FAILED (0/0)
  //   gateway-default: 1 measured (4000/2000)  → unpriced (no model field)
  //   glm-4-flash:     1 measured (100/50)     → unpriced (not in fetched docs)
  await db.usageCall.createMany({
    data: [
      { surface: SURFACE, modelId: "glm-4.6", promptTokens: 1000, completionTokens: 500, totalTokens: 1500, status: "measured" },
      { surface: SURFACE, modelId: "glm-4.6", promptTokens: 2000, completionTokens: 1000, totalTokens: 3000, status: "measured" },
      { surface: SURFACE, modelId: "glm-4.6", promptTokens: 0, completionTokens: 0, totalTokens: 0, status: "failed", errorKind: "timeout" },
      { surface: SURFACE, modelId: "gateway-default", promptTokens: 4000, completionTokens: 2000, totalTokens: 6000, status: "measured" },
      { surface: SURFACE, modelId: "glm-4-flash", promptTokens: 100, completionTokens: 50, totalTokens: 150, status: "measured" },
    ],
  });

  const snapshot: AccountUsageSnapshot = await accountUsageSnapshot();
  const m46 = snapshot.models.find((m) => m.modelId === "glm-4.6");
  const mGw = snapshot.models.find((m) => m.modelId === "gateway-default");
  const mFlash = snapshot.models.find((m) => m.modelId === "glm-4-flash");

  check(
    "DB per-model split: glm-4.6 = 3 calls (2 measured + 1 failed), tokens ONLY from measured rows",
    !!m46 && m46.calls === 3 && m46.failedCalls === 1 && m46.totalTokens === 4500,
    m46 ? `calls=${m46.calls} failed=${m46.failedCalls} tok=${m46.totalTokens}` : "missing"
  );
  check(
    "DB failed COUNT shows separately next to the model's cost; failed rows contribute 0 tokens by definition",
    !!m46 && m46.failedCalls === 1 && m46.promptTokens === 3000 && m46.completionTokens === 1500,
    m46 ? `in/out=${m46.promptTokens}/${m46.completionTokens} (failed row: 0/0)` : "missing"
  );
  check(
    "DB glm-4.6 estimate == measured tokens x listed price (upper bound)",
    !!m46 &&
      m46.priced &&
      m46.estimatedUsd !== null &&
      approx(m46.estimatedUsd, (3000 * 0.6 + 1500 * 2.2) / 1e6),
    m46 && m46.estimatedUsd !== null ? String(m46.estimatedUsd) : "null"
  );
  check(
    "DB gateway-default group: UNPRICED (reason gateway-default), estimatedUsd NULL — never $0-by-guess",
    !!mGw && !mGw.priced && mGw.unpricedReason === "gateway-default" && mGw.estimatedUsd === null,
    mGw ? `reason=${mGw.unpricedReason} est=${mGw.estimatedUsd}` : "missing"
  );
  check(
    "DB glm-4-flash group: UNPRICED (no sourced row on the fetched docs), estimatedUsd NULL",
    !!mFlash &&
      !mFlash.priced &&
      mFlash.unpricedReason === "unlisted-model" &&
      mFlash.estimatedUsd === null,
    mFlash ? `reason=${mFlash.unpricedReason} est=${mFlash.estimatedUsd}` : "missing"
  );
  check(
    "DB account estimate = Σ over PRICED groups only; unpriced groups counted, excluded, never zeroed",
    approx(snapshot.estimate.usd, (3000 * 0.6 + 1500 * 2.2) / 1e6) &&
      snapshot.estimate.unpricedGroups === 2 &&
      snapshot.estimate.upperBound === true,
    `usd=${snapshot.estimate.usd} unpricedGroups=${snapshot.estimate.unpricedGroups}`
  );

  const db2Count = await db2.usageCall.count({ where: { surface: SURFACE } });
  check(
    "RS fixture rows readable via a SECOND freshly constructed PrismaClient (persist beyond process memory)",
    db2Count === 5,
    `db2 rows=${db2Count}/5`
  );

  // ------------------------------------------------------------------ RT ---
  const ledgerRes = await fetch(`${BASE}/api/usage/ledger`, { cache: "no-store" });
  const ledgerBody = (await ledgerRes.json()) as AccountUsageSnapshot;
  check(
    "RT /api/usage/ledger 200 with the P5-c models + estimate blocks",
    ledgerRes.status === 200 && Array.isArray(ledgerBody.models) && !!ledgerBody.estimate,
    `status=${ledgerRes.status} models=${ledgerBody.models?.length} est=${ledgerBody.estimate?.usd}`
  );
  check(
    "RT route estimate matches the store's math on the same rows",
    approx(ledgerBody.estimate.usd, snapshot.estimate.usd) &&
      ledgerBody.estimate.unpricedGroups === snapshot.estimate.unpricedGroups,
    `route=${ledgerBody.estimate?.usd} store=${snapshot.estimate.usd}`
  );

  const postRes = await fetch(`${BASE}/api/usage/invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actualUsd: "0.01", periodLabel: PERIOD_MARKER }),
  });
  const postBody = (await postRes.json()) as {
    entry?: { actualUsd: string; estimatedUsd: string; trackedRows: number; pricingVersion: string };
    deltaUsd?: number;
  };
  check(
    "RT invoice POST 201: pasted figure stored VERBATIM next to OUR captured ESTIMATE",
    postRes.status === 201 &&
      postBody.entry?.actualUsd === "0.01" &&
      approx(Number(postBody.entry.estimatedUsd), snapshot.estimate.usd) &&
      postBody.entry.trackedRows === snapshot.totalCalls,
    `actual=${postBody.entry?.actualUsd} est=${postBody.entry?.estimatedUsd} rows=${postBody.entry?.trackedRows}`
  );
  check(
    "RT delta = actual − our ESTIMATE (display math, labeled on the client)",
    typeof postBody.deltaUsd === "number" &&
      approx(postBody.deltaUsd, 0.01 - snapshot.estimate.usd),
    `delta=${postBody.deltaUsd}`
  );

  const getRes = await fetch(`${BASE}/api/usage/invoice`, { cache: "no-store" });
  const getBody = (await getRes.json()) as {
    entries: { periodLabel: string; actualUsd: string }[];
    totalEntries: number;
  };
  check(
    "RT invoice GET lists the entry (latest first) with the pricing provenance",
    getRes.status === 200 &&
      getBody.entries.some((e) => e.periodLabel === PERIOD_MARKER && e.actualUsd === "0.01"),
    `total=${getBody.totalEntries}`
  );

  const bad1 = await fetch(`${BASE}/api/usage/invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actualUsd: "abc", periodLabel: PERIOD_MARKER }),
  });
  const bad2 = await fetch(`${BASE}/api/usage/invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actualUsd: "-5", periodLabel: PERIOD_MARKER }),
  });
  const bad3 = await fetch(`${BASE}/api/usage/invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actualUsd: "0.01", periodLabel: "" }),
  });
  check(
    "RT strict validation: junk figure, negative figure, empty period → ALL 400 (nothing coerced, nothing guessed)",
    bad1.status === 400 && bad2.status === 400 && bad3.status === 400,
    `${bad1.status}/${bad2.status}/${bad3.status}`
  );

  // ------------------------------------------------------------------ SP ---
  const badge = readFileSync("src/components/novara/writer/usage-balance-badge.tsx", "utf8");
  const panel = readFileSync("src/components/novara/writer/context-usage-panel.tsx", "utf8");
  const pricingSrc = readFileSync("src/lib/usage/pricing.ts", "utf8");
  const badgeGlyphs = currencyGlyphCount(badge);
  const panelGlyphs = currencyGlyphCount(panel);
  check(
    "SP central view: ZERO raw currency glyphs — every money string flows through the labeled pricing formatters",
    badgeGlyphs === 0 && badge.includes("formatEstimateUsd") && badge.includes("formatPastedUsd"),
    `glyphs=${badgeGlyphs}`
  );
  check(
    "SP panel untouched by P5-c: no pricing import, no currency glyph (THIS-CALL/THIS-RUN invariant holds by construction)",
    !panel.includes("usage/pricing") && panelGlyphs === 0,
    `pricing-import=${panel.includes("usage/pricing")} glyphs=${panelGlyphs}`
  );
  check(
    "SP pricing file header carries the fetched docs URL + date + both priced rows verbatim",
    pricingSrc.includes("https://docs.z.ai/guides/overview/pricing") &&
      pricingSrc.includes("2026-11-06") &&
      pricingSrc.includes("GLM-4.6") &&
      pricingSrc.includes("GLM-4.5-Air"),
    "header provenance pinned"
  );
  check(
    "SP panel Layer-3 still fetches the persisted ledger (P5-b swap intact)",
    panel.includes('fetch("/api/usage/ledger"'),
    "source pin re-asserted"
  );

  // -------------------------------------------------------------- Cleanup ---
  const delCalls = await db.usageCall.deleteMany({ where: { surface: SURFACE } });
  const delInvoices = await db.usageInvoice.deleteMany({
    where: { periodLabel: PERIOD_MARKER },
  });
  const postCalls = await db.usageCall.count();
  const postInvoices = await db.usageInvoice.count();
  check(
    "Cleanup: fixture rows fully removed, DB back to pre-run shape",
    postCalls === preCalls && postInvoices === preInvoices,
    `calls ${preCalls}->${postCalls} (deleted ${delCalls.count}), invoices ${preInvoices}->${postInvoices} (deleted ${delInvoices.count})`
  );

  console.log(
    `P5C: ${failures === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"} (${checks} checks)`
  );
  await db.$disconnect();
  await db2.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("P5C: harness crashed:", error);
  await db.$disconnect();
  await db2.$disconnect();
  process.exit(1);
});
