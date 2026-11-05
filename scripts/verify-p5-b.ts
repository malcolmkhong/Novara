// ---------------------------------------------------------------------------
// Novara AI — P5-b verification (Phase 5, failed-call accounting + ledger
// retirement + central view). The SEXTET gains a SEVENTH harness ("6+1").
//
// ZERO GLM calls: every model-call shape below runs against a MOCKED
// z-ai-web-dev-sdk (bun mock.module) — no packet leaves the process, so the
// $0.00 discipline is structural, not behavioral.
//
// Sections:
//   FA. Retry shape (Policy F1): transient 429 then success ⇒ TWO rows under
//       one logical call — attempt-1 status:"failed" (0 tokens, errorKind
//       "rate-limit"), attempt-2 measured (tokens = billed truth). Retries
//       are separate rows.
//   FB. Ultimately-failed call (F2): every attempt 429s ⇒ three failed rows,
//       zero measured rows, glmChat throws the last error.
//   FC. Completion WITHOUT a usage object (F4): rowless — token counts are
//       unknowable and a 0-token row would understate. Measured-only intact.
//   FD. Billed-truth completeness fix: completion WITH usage but EMPTY
//       content ⇒ ONE measured row (the provider billed it) even though
//       glmChat still throws empty-response. (Pre-P5-b this call leaked.)
//   FE. Pre-send failure (F3): ZAI.create() throws ⇒ NO row — the provider
//       was never reached.
//   FF. Timeout shape (F1): withTimeout fires ⇒ failed rows, errorKind
//       "timeout", one per attempt.
//   RB. Reconciliation over a failed/retried shape (§4.5 extension): for the
//       FA/FB/FF correlations, Σ measured tokens == the provider-truth book
//       (what the mock returned), every failed row is 0-token with a kind,
//       and failed rows never carry AgentEvents (events exist only for
//       successful turns — the run feed is a transcript, the ledger is the
//       billing view).
//   SC. Schema: status/errorKind columns exist on UsageCall (additive).
//   RT. Routes on the live dev server: /api/usage/ledger 200 with
//       since/retention/failedCalls; /api/usage/global 404 (retired);
//       per-novel route total == direct + linked (failed rows included in
//       counts, contributing zero tokens); retention on BOTH routes; orphan
//       rendering after novel deletion (deleted:true "(deleted novel)" on
//       the account route, 404 on the novel route).
//   SP. Source pins: no "@/lib/usage/ledger" imports anywhere; the panel
//       fetches /api/usage/ledger; the central view is mounted at the
//       writer-app badge anchor.
//   RS. Restart survival: fixture rows readable through a SECOND freshly
//       constructed PrismaClient.
//
// Fixture discipline: surface "p5b-verify-f" (mocked calls), "p5b-verify-n"
// (novel-scope rows), correlation "p5b-verify-*"; cleanup deletes exactly
// those rows + the fixture novel and asserts the DB is back to pre-run shape.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { mock } from "bun:test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const db2 = new PrismaClient(); // the "restart" client (RS)

const SURFACE_F = "p5b-verify-f"; // mocked glmChat scenarios
const SURFACE_N = "p5b-verify-n"; // novel-scope route fixture
const CORR_FA = "p5b-verify-fa-retry";
const CORR_FB = "p5b-verify-fb-allfail";
const CORR_FC = "p5b-verify-fc-nousage";
const CORR_FD = "p5b-verify-fd-emptybilled";
const CORR_FE = "p5b-verify-fe-initfail";
const CORR_FF = "p5b-verify-ff-timeout";
const CORR_WIZ = "p5b-verify-wizard-session";
const BASE = "http://localhost:3000";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P5B: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 6000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mocked SDK — installed BEFORE importing glm.ts. Zero network, $0.00 by
// construction: ZAI.create() returns a fake client whose create() behavior is
// scripted per scenario.
// ---------------------------------------------------------------------------

type Behavior = () => Promise<unknown>;
let behavior: Behavior = async () => {
  throw new Error("p5b harness: no scenario armed");
};
let initFailure: Error | null = null;

const OK_USAGE = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };

mock.module("z-ai-web-dev-sdk", () => ({
  default: {
    create: async () => {
      if (initFailure) throw initFailure;
      return {
        chat: {
          completions: {
            create: (_opts: unknown) => behavior(),
          },
        },
      };
    },
  },
}));

const { glmChat } = await import("../src/lib/novara/glm");

const completionOf = (content: string, usage?: Record<string, number> | null) => ({
  choices: [{ message: { content } }],
  ...(usage === undefined ? {} : usage === null ? {} : { usage }),
});

async function rowsFor(correlationId: string) {
  return db.usageCall.findMany({
    where: { surface: SURFACE_F, correlationId },
    orderBy: { createdAt: "asc" },
  });
}

async function main() {
  // ---------- idempotent cleanup of any prior run ----------
  await db.usageCall.deleteMany({ where: { surface: { in: [SURFACE_F, SURFACE_N] } } });
  await db.usageProvenance.deleteMany({ where: { correlationId: { startsWith: "p5b-verify" } } });
  await db.novel.deleteMany({ where: { title: { startsWith: "P5B-VERIFY (scratch)" } } });
  const novelsBefore = await db.novel.count();

  // ---------- SC: schema shape ----------
  const cols = (await db.$queryRawUnsafe<{ name: string }[]>(
    "PRAGMA table_info(UsageCall)"
  )) as { name: string }[];
  const colNames = cols.map((c) => c.name);
  check(
    "SC status + errorKind columns exist on UsageCall (additive — Policy F)",
    colNames.includes("status") && colNames.includes("errorKind"),
    colNames.filter((n) => n === "status" || n === "errorKind").join(",") || "missing"
  );

  // ---------- FA: retry shape — one row per ATTEMPT (F1) ----------
  let faCalls = 0;
  behavior = async () => {
    faCalls += 1;
    if (faCalls === 1) throw new Error("429 Too Many Requests — slow down");
    return completionOf("retry-ok", OK_USAGE);
  };
  const fa = await glmChat({
    messages: [{ role: "user", content: "fa" }],
    tag: "p5b FA",
    surface: SURFACE_F,
    ledger: { correlationId: CORR_FA },
  });
  const faRows = await waitFor(async () => {
    const rows = await rowsFor(CORR_FA);
    return rows.length === 2 ? rows : null;
  });
  check(
    "FA retry shape: transient-429-then-success ⇒ TWO rows for ONE logical call (F1 per-attempt)",
    faRows !== null && fa.text === "retry-ok",
    faRows ? `2 attempts, HTTP calls=${faCalls}` : `rows=${(await rowsFor(CORR_FA)).length}`
  );
  const faFailed = faRows?.[0];
  const faMeasured = faRows?.[1];
  check(
    "FA attempt-1 = failed row (0 tokens, errorKind rate-limit), attempt-2 = measured (billed truth)",
    !!faFailed &&
      !!faMeasured &&
      faFailed.status === "failed" &&
      faFailed.totalTokens === 0 &&
      faFailed.errorKind === "rate-limit" &&
      faMeasured.status === "measured" &&
      faMeasured.promptTokens === 120 &&
      faMeasured.completionTokens === 30 &&
      faMeasured.totalTokens === 150,
    faRows
      ? `a1=${faFailed?.status}/${faFailed?.errorKind}/${faFailed?.totalTokens} a2=${faMeasured?.status}/${faMeasured?.totalTokens}`
      : "missing"
  );

  // ---------- FB: ultimately-failed call (F2) ----------
  behavior = async () => {
    throw new Error("429 Too Many Requests — still slammed");
  };
  let fbThrew = "";
  try {
    await glmChat({
      messages: [{ role: "user", content: "fb" }],
      tag: "p5b FB",
      surface: SURFACE_F,
      ledger: { correlationId: CORR_FB },
    });
  } catch (error) {
    fbThrew = error instanceof Error ? error.message : String(error);
  }
  const fbRows = await waitFor(async () => {
    const rows = await rowsFor(CORR_FB);
    return rows.length === 3 ? rows : null;
  });
  check(
    "FB ultimately-failed call: 3 attempts (budget retries=2) ⇒ 3 failed rows, 0 measured, caller gets the error (F2)",
    fbRows !== null &&
      fbThrew.includes("429") &&
      fbRows.every((r) => r.status === "failed" && r.totalTokens === 0 && r.errorKind === "rate-limit"),
    fbRows ? `3 failed rows, threw="${fbThrew.slice(0, 40)}"` : `rows=${(await rowsFor(CORR_FB)).length}`
  );

  // ---------- FC: completion without usage (F4 — rowless) ----------
  behavior = async () => completionOf("prose without usage", null);
  const fc = await glmChat({
    messages: [{ role: "user", content: "fc" }],
    tag: "p5b FC",
    surface: SURFACE_F,
    ledger: { correlationId: CORR_FC },
  });
  await new Promise((r) => setTimeout(r, 350));
  const fcRows = await rowsFor(CORR_FC);
  check(
    "FC completion WITHOUT usage object ⇒ rowless (F4 — tokens unknowable, never 0-claimed)",
    fc.text === "prose without usage" && fcRows.length === 0,
    `rows=${fcRows.length}`
  );

  // ---------- FD: billed-truth completeness (empty content WITH usage) ----------
  // NOTE: glmChat's loop retries EVERY error (backoff is transient-only —
  // pre-existing P4 semantics): the non-transient empty-content error makes
  // 3 INSTANT attempts. Each attempt returned usage {77,0,77} — so Policy F
  // lands ONE measured row PER ATTEMPT (3 rows). Pre-P5-b this shape leaked
  // entirely (no row ever).
  behavior = async () => completionOf("", { prompt_tokens: 77, completion_tokens: 0, total_tokens: 77 });
  let fdThrew = "";
  try {
    await glmChat({
      messages: [{ role: "user", content: "fd" }],
      tag: "p5b FD",
      surface: SURFACE_F,
      ledger: { correlationId: CORR_FD },
    });
  } catch (error) {
    fdThrew = error instanceof Error ? error.message : String(error);
  }
  const fdRows = await waitFor(async () => {
    const rows = await rowsFor(CORR_FD);
    return rows.length === 3 ? rows : null;
  });
  check(
    "FD empty content WITH usage ⇒ billed row PER ATTEMPT (3 instant retries × 77 tok measured) even though the call errors",
    fdRows !== null &&
      fdThrew.includes("empty response") &&
      fdRows.every((r) => r.status === "measured" && r.totalTokens === 77 && r.errorKind === null),
    fdRows ? `3 measured rows (77 tok each), threw="${fdThrew.slice(0, 32)}"` : `rows=${(await rowsFor(CORR_FD)).length} — leak`
  );

  // ---------- FE: pre-send failure (F3 — no row) ----------
  initFailure = new Error("SDK init failed (p5b scenario)");
  let feThrew = "";
  try {
    await glmChat({
      messages: [{ role: "user", content: "fe" }],
      tag: "p5b FE",
      surface: SURFACE_F,
      ledger: { correlationId: CORR_FE },
    });
  } catch (error) {
    feThrew = error instanceof Error ? error.message : String(error);
  }
  initFailure = null;
  await new Promise((r) => setTimeout(r, 350));
  const feRows = await rowsFor(CORR_FE);
  check(
    "FE SDK-init failure (never reached the provider) ⇒ NO row (F3)",
    feThrew.length > 0 && feRows.length === 0,
    `rows=${feRows.length}`
  );

  // ---------- FF: timeout shape (F1, errorKind=timeout) ----------
  behavior = () => new Promise(() => undefined); // never resolves
  let ffThrew = "";
  try {
    await glmChat({
      messages: [{ role: "user", content: "ff" }],
      tag: "p5b FF",
      timeoutMs: 60,
      surface: SURFACE_F,
      ledger: { correlationId: CORR_FF },
    });
  } catch (error) {
    ffThrew = error instanceof Error ? error.message : String(error);
  }
  const ffRows = await waitFor(async () => {
    const rows = await rowsFor(CORR_FF);
    return rows.length === 3 ? rows : null;
  });
  check(
    "FF timeout on every attempt ⇒ 3 failed rows with errorKind=timeout, caller gets the timeout",
    ffRows !== null &&
      ffThrew.includes("timed out") &&
      ffRows.every((r) => r.status === "failed" && r.errorKind === "timeout" && r.totalTokens === 0),
    ffRows ? `3 timeout rows, threw="${ffThrew.slice(0, 40)}"` : `rows=${(await rowsFor(CORR_FF)).length}`
  );

  // ---------- RB: reconciliation over a failed/retried shape (§4.5) ----------
  const allF = [
    ...(await rowsFor(CORR_FA)),
    ...(await rowsFor(CORR_FB)),
    ...(await rowsFor(CORR_FC)),
    ...(await rowsFor(CORR_FD)),
    ...(await rowsFor(CORR_FE)),
    ...(await rowsFor(CORR_FF)),
  ];
  const measuredRows = allF.filter((r) => r.status === "measured");
  const failedRows = allF.filter((r) => r.status === "failed");
  const measuredSum = measuredRows.reduce((a, r) => a + r.totalTokens, 0);
  // ---------- RB: reconciliation over a failed/retried shape (§4.5) ----------
  // Provider-truth book: every usage object the mock returned across ALL
  // attempts — FA attempt-2 (150) + FD's three attempts (77 each) = 381.
  const truthSum = 150 + 77 * 3;
  check(
    "RB books agree over a failed/retried shape: Σ measured rows == provider-truth usage (150 + 77×3)",
    measuredRows.length === 4 && measuredSum === truthSum,
    `measured=${measuredRows.length} Σ=${measuredSum}/${truthSum}`
  );
  check(
    "RB every failed row is 0-token with an errorKind; failed attempts never masquerade as usage",
    failedRows.length === 7 /* FA:1 FB:3 FF:3 */ &&
      failedRows.every((r) => r.totalTokens === 0 && (r.errorKind?.length ?? 0) > 0),
    `failed=${failedRows.length}, all 0-token+kind`
  );
  check(
    "RB failed attempts have NO AgentEvent counterpart (run feed = transcript; ledger = billing view)",
    (await db.agentEvent.count({ where: { runId: { startsWith: "p5b-verify" } } })) === 0,
    "0 events for p5b-verify attempts"
  );

  // ---------- novel-scope route fixture (direct + linked, incl failed row) ----------
  const novel = await db.novel.create({
    data: { title: "P5B-VERIFY (scratch) — per-novel totals", genre: "test" },
    select: { id: true },
  });
  // direct: 1 measured (novelId) + 1 failed (novelId)
  await new Promise((r) => setTimeout(r, 10));
  void db.usageCall.create({ data: {
    surface: SURFACE_N, modelId: "glm-4.6", promptTokens: 500, completionTokens: 50, totalTokens: 550,
    status: "measured", novelId: novel.id,
  }}).catch(() => {});
  void db.usageCall.create({ data: {
    surface: SURFACE_N, modelId: "glm-4.6", promptTokens: 0, completionTokens: 0, totalTokens: 0,
    status: "failed", errorKind: "rate-limit", novelId: novel.id,
  }}).catch(() => {});
  // linked: 2 wizard-correlation rows (pre-novel) + provenance link
  void db.usageCall.create({ data: {
    surface: SURFACE_N, modelId: "gateway-default", promptTokens: 60, completionTokens: 6, totalTokens: 66,
    status: "measured", correlationId: CORR_WIZ,
  }}).catch(() => {});
  void db.usageCall.create({ data: {
    surface: SURFACE_N, modelId: "gateway-default", promptTokens: 40, completionTokens: 4, totalTokens: 44,
    status: "measured", correlationId: CORR_WIZ,
  }}).catch(() => {});
  void db.usageProvenance.create({ data: { surface: "wizard", correlationId: CORR_WIZ, novelId: novel.id } }).catch(() => {});
  const novelFixtureReady = await waitFor(async () => {
    const n = await db.usageCall.count({ where: { surface: SURFACE_N } });
    const l = await db.usageProvenance.count({ where: { correlationId: CORR_WIZ } });
    return n === 4 && l === 1 ? true : null;
  });
  if (novelFixtureReady === null) {
    const partial = await db.usageCall.findMany({ where: { surface: SURFACE_N } });
    console.error(
      `P5B: novel fixture rows did not land in 6s — surface count=${partial.length}, contents:`,
      JSON.stringify(partial.map((r) => ({ status: r.status, novelId: r.novelId, corr: r.correlationId })))
    );
  }
  check(
    "RT fixture precondition: 4 novel-scope rows + 1 provenance link landed (fire-and-forget awaited)",
    novelFixtureReady === true,
    novelFixtureReady === true ? "4 rows + 1 link" : "TIMEOUT — see diagnostic above"
  );

  // ---------- RT: routes on the live dev server ----------
  const ledgerRes = await fetch(`${BASE}/api/usage/ledger`, { cache: "no-store" });
  const ledgerBody = (await ledgerRes.json()) as {
    since: string | null; retention: string; failedCalls: number;
    surfaces: { surface: string; calls: number; totalTokens: number }[];
    novels: { novelId: string; deleted: boolean; calls: number; totalTokens: number }[];
    totalCalls: number;
  };
  const dbFailedCount = await db.usageCall.count({ where: { status: "failed" } });
  check(
    "RT /api/usage/ledger 200 — persisted snapshot with since/retention/failedCalls",
    ledgerRes.status === 200 &&
      typeof ledgerBody.retention === "string" &&
      ledgerBody.retention.length > 0 &&
      ledgerBody.since !== null &&
      typeof ledgerBody.failedCalls === "number",
    `since=${ledgerBody.since?.slice(0, 10)} failedCalls=${ledgerBody.failedCalls}`
  );
  check(
    "RT snapshot.failedCalls == COUNT(status='failed') in the table (failed attempts disclosed, not hidden)",
    ledgerBody.failedCalls === dbFailedCount && dbFailedCount >= 8 /* 1 FA + 3 FB + 3 FF + 1 novel */,
    `snapshot=${ledgerBody.failedCalls} db=${dbFailedCount}`
  );
  const globalRes = await fetch(`${BASE}/api/usage/global`, { cache: "no-store" });
  check(
    "RT /api/usage/global is RETIRED (404) — no dual feed survives (Ruling 2)",
    globalRes.status === 404,
    `status=${globalRes.status}`
  );
  const novelRes = await fetch(`${BASE}/api/novels/${novel.id}/usage`, { cache: "no-store" });
  const novelBody = (await novelRes.json()) as {
    direct: { calls: number; totalTokens: number };
    linked: { calls: number; totalTokens: number };
    total: { calls: number; totalTokens: number };
    retention: string;
  };
  check(
    "RT per-novel: total.calls == direct + linked (4 = 2 direct incl failed + 2 linked), total.Σ == 660",
    novelRes.status === 200 &&
      novelBody.total.calls === novelBody.direct.calls + novelBody.linked.calls &&
      novelBody.direct.calls === 2 &&
      novelBody.linked.calls === 2 &&
      novelBody.total.totalTokens === 550 + 66 + 44,
    `direct=${novelBody.direct.calls}(${novelBody.direct.totalTokens}) linked=${novelBody.linked.calls}(${novelBody.linked.totalTokens}) total=${novelBody.total.calls}(${novelBody.total.totalTokens})`
  );
  check(
    "RT retention disclosure travels on BOTH ledger routes",
    typeof novelBody.retention === "string" &&
      novelBody.retention.length > 0 &&
      novelBody.retention === ledgerBody.retention,
    "identical disclosure string on /api/usage/ledger and /api/novels/[id]/usage"
  );

  // ---------- orphan rendering (Ruling 1) ----------
  await db.novel.delete({ where: { id: novel.id } });
  const ledgerAfter = (await (await fetch(`${BASE}/api/usage/ledger`, { cache: "no-store" })).json()) as typeof ledgerBody;
  const orphan = ledgerAfter.novels.find((n) => n.novelId === novel.id);
  check(
    "RT deleted novel ⇒ orphan renders on the ACCOUNT route (deleted:true, calls kept)",
    orphan !== undefined && orphan.deleted === true && orphan.calls === 2 && orphan.totalTokens === 550,
    orphan ? `calls=${orphan.calls} Σ=${orphan.totalTokens}` : "orphan missing"
  );
  const orphanNovelRes = await fetch(`${BASE}/api/novels/${novel.id}/usage`, { cache: "no-store" });
  check(
    "RT deleted novel ⇒ per-novel route 404s (documented: orphan history lives on the account route)",
    orphanNovelRes.status === 404,
    `status=${orphanNovelRes.status}`
  );

  // ---------- SP: source pins ----------
  let importers: string[] = [];
  try {
    const out = execSync(
      `rg -l 'from "@/lib/usage/ledger"|from "\\./ledger"|from "../usage/ledger"' src/`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    importers = out ? out.split("\n") : [];
  } catch {
    importers = [];
  }
  check(
    "SP in-memory ledger fully deleted: file gone, /api/usage/global gone, zero imports (no debug layer)",
    !existsSync("src/lib/usage/ledger.ts") &&
      !existsSync("src/app/api/usage/global") &&
      importers.length === 0,
    "deleted outright (Ruling 2)"
  );
  const panelSource = readFileSync("src/components/novara/writer/context-usage-panel.tsx", "utf8");
  const writerSource = readFileSync("src/components/novara/writer/writer-app.tsx", "utf8");
  check(
    "SP panel Layer-3 fetches /api/usage/ledger; central view mounted at the writer-app badge anchor",
    panelSource.includes('fetch("/api/usage/ledger"') &&
      writerSource.includes("<UsageBalanceBadge") &&
      existsSync("src/components/novara/writer/usage-balance-badge.tsx"),
    "panel swap + central view pin"
  );
  const glmSource = readFileSync("src/lib/novara/glm.ts", "utf8");
  check(
    "SP glmChat keeps the dual-feed source pin (emitUsageEvent in runtime + recordUsageCall in glm) and records failed attempts",
    glmSource.includes('status: "failed"') && glmSource.includes("recordUsageCall({"),
    "runtime.ts + glm.ts"
  );

  // ---------- RS: restart survival ----------
  const viaDb2 = await db2.usageCall.findMany({
    where: { surface: { in: [SURFACE_F, SURFACE_N] } },
  });
  const expectedRows = 2 /*FA*/ + 3 /*FB*/ + 3 /*FD*/ + 3 /*FF*/ + 4 /*novel*/;
  check(
    "RS fixture rows readable via a SECOND freshly constructed PrismaClient (persist beyond process memory)",
    viaDb2.length === expectedRows,
    `db2 rows=${viaDb2.length}/${expectedRows}`
  );

  // ---------- cleanup + final shape ----------
  await db.usageCall.deleteMany({ where: { surface: { in: [SURFACE_F, SURFACE_N] } } });
  await db.usageProvenance.deleteMany({ where: { correlationId: { startsWith: "p5b-verify" } } });
  const leftoverCalls = await db.usageCall.count({ where: { surface: { in: [SURFACE_F, SURFACE_N] } } });
  const leftoverLinks = await db.usageProvenance.count({ where: { correlationId: { startsWith: "p5b-verify" } } });
  const novelsAfter = await db.novel.count();
  check(
    "Cleanup: fixture rows fully removed, DB back to pre-run shape",
    leftoverCalls === 0 && leftoverLinks === 0 && novelsAfter === novelsBefore,
    `calls=${leftoverCalls} links=${leftoverLinks} novels=${novelsAfter}/${novelsBefore}`
  );

  await db.$disconnect();
  await db2.$disconnect();

  console.log(`P5B: ${failures === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"} (${checks} checks)`);
  if (failures > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error("P5B: harness crashed:", error);
  try {
    await db.usageCall.deleteMany({ where: { surface: { in: [SURFACE_F, SURFACE_N] } } });
    await db.usageProvenance.deleteMany({ where: { correlationId: { startsWith: "p5b-verify" } } });
    await db.$disconnect();
    await db2.$disconnect();
  } catch {
    // best-effort cleanup on crash
  }
  process.exit(1);
});
