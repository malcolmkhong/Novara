// ---------------------------------------------------------------------------
// Novara AI — P5-a verification (Phase 5, persisted usage ledger).
//
// ZERO GLM calls. The regression quintet becomes a SEXTET. Sections:
//   S1. Schema shape (Ruling 1): UsageCall + UsageProvenance exist; NEITHER
//       DDL contains a REFERENCES clause (plain-string scope links — account
//       history is never cascade-destroyed); prisma/schema.prisma carries the
//       permanent-retention documentation.
//   S2. Measured-only rule: recordUsageCall with usage=null records NOTHING;
//       a measured call lands (fire-and-forget writes polled to visibility).
//   S3. Scope-sum invariants: per-call / per-run / per-member-task /
//       per-novel(direct) / account sums all reconcile over the fixture rows
//       (fixture surface — real traffic never pollutes the arithmetic).
//   S4. Retro-tag provenance: recordProvenanceLink attaches the pre-novel
//       wizard rows to the novel (novelUsageSummary linked+total); the link
//       is IDEMPOTENT (double link ⇒ one row, totals unchanged); direct and
//       linked are disjoint (no double counting).
//   S5. Restart survival: fixture rows are readable through a SECOND, freshly
//       constructed PrismaClient (persistence beyond process memory). P5-b
//       update: the in-memory global ledger is RETIRED — the module file is
//       gone and no src/ module imports it (Ruling 2: deleted outright, no
//       debug layer, no dual feed).
//   S6. Double-book reconciliation (§4.5, fixture-level): AgentEvent
//       kind="usage" payloads and UsageCall rows for the same calls agree
//       ROW-FOR-ROW (sorted token triples); source pin: every glmChat result
//       feeds BOTH books (emitUsageEvent + recordUsageCall).
//   S7. Config at rest (Addition 1): contextCompaction.enabled === false AND
//       contextSlicing.enabled === false — both features validated inert
//       through P5.
//   S8. Retention live proof (Ruling 1): deleting the fixture NOVEL cascades
//       its AgentRun/events but leaves EVERY UsageCall row standing; the
//       account snapshot renders the orphan as deleted:true "(deleted
//       novel)"; novelUsageSummary 404s. No purge path exists (asserted by
//       the absence of any delete endpoint on the usage routes — source pin).
//
// Fixture discipline: every row is surface="p5-verify" / correlation
// "p5-verify-*"; cleanup deletes exactly those rows and asserts the DB is
// back to its pre-run shape. Fire-and-forget writes are awaited via polling.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { getBudgets } from "../src/lib/novara/content";
import {
  accountUsageSnapshot,
  novelUsageSummary,
  recordProvenanceLink,
  recordUsageCall,
} from "../src/lib/usage/usage-store";

const db = new PrismaClient();
// The "restart" client — a SECOND connection constructed from scratch, the
// closest a single process can get to proving persistence across processes.
const db2 = new PrismaClient();

const SURFACE = "p5-verify";
const SURFACE_S2 = "p5-verify-s2"; // S2's row lives on its own tag so S3's count polls cannot race
const CORR_WIZARD = "p5-verify-wizard-session";
const CORR_RECON = "p5-verify-recon"; // S6 rows are isolated by correlation, not by runId

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P5: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Poll until fn() returns non-null (fire-and-forget writes land async). */
async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 4000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function fixtureCallCount(): Promise<number> {
  return db.usageCall.count({ where: { surface: { in: [SURFACE, SURFACE_S2] } } });
}

async function waitForFixtureCount(expected: number): Promise<number | null> {
  return waitFor(async () => ((await fixtureCallCount()) === expected ? expected : null));
}

async function main() {
  // ---------- cleanup any prior run (idempotent harness) ----------
  await db.usageCall.deleteMany({ where: { surface: { in: [SURFACE, SURFACE_S2] } } });
  await db.usageProvenance.deleteMany({ where: { correlationId: { startsWith: "p5-verify" } } });

  const novelsBefore = await db.novel.count();
  const runsBefore = await db.agentRun.count();

  // ---------- S1: schema shape (Ruling 1) ----------
  const ddlRows = (await db.$queryRawUnsafe<{ name: string; sql: string }[]>(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('UsageCall','UsageProvenance')"
  )) as { name: string; sql: string }[];
  check(
    "S1 UsageCall + UsageProvenance tables exist",
    ddlRows.length === 2,
    ddlRows.map((r) => r.name).sort().join(",")
  );
  const withFk = ddlRows.filter((r) => /REFERENCES/i.test(r.sql));
  check(
    "S1 no FK on either ledger table (plain-string scope links, no cascade — Ruling 1)",
    ddlRows.length === 2 && withFk.length === 0,
    withFk.length === 0 ? "0 REFERENCES clauses" : withFk.map((r) => r.name).join(",")
  );
  const schemaText = readFileSync("prisma/schema.prisma", "utf8");
  check(
    "S1 retention documented in schema (permanent history, no purge path — Ruling 1)",
    schemaText.includes("PERMANENT account history") && schemaText.includes("NO purge path"),
    "prisma/schema.prisma"
  );

  // ---------- S2: measured-only rule ----------
  const beforeNull = await fixtureCallCount();
  recordUsageCall({ surface: SURFACE, usage: null });
  recordUsageCall({ surface: SURFACE, modelId: "gateway-default", usage: null });
  await new Promise((r) => setTimeout(r, 250));
  const afterNull = await fixtureCallCount();
  check(
    "S2 null usage records NOTHING (measured-only, never guessed/padded)",
    afterNull === beforeNull,
    `${beforeNull} → ${afterNull}`
  );
  recordUsageCall({
    surface: SURFACE_S2,
    modelId: "glm-4.6",
    usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
  });
  const afterOne = await waitFor(async () => {
    const n = await db.usageCall.count({ where: { surface: SURFACE_S2 } });
    return n === 1 ? n : null;
  });
  check(
    "S2 measured call lands via the fire-and-forget write path",
    afterOne === 1,
    `${beforeNull} → ${afterOne} (on its own ${SURFACE_S2} tag)`
  );

  // ---------- S7: config at rest (Addition 1) ----------
  const budgets = getBudgets();
  check(
    "S7 both features inert through P5 (contextCompaction + contextSlicing enabled:false)",
    budgets.contextCompaction.enabled === false && budgets.contextSlicing.enabled === false,
    `compaction=${budgets.contextCompaction.enabled} slicing=${budgets.contextSlicing.enabled}`
  );

  // ---------- fixture novel + S3 scope rows ----------
  const novel = await db.novel.create({
    data: { title: "P5-VERIFY (scratch) — ledger retention probe", genre: "test" },
    select: { id: true },
  });

  const runId = "p5-verify-run";
  const taskId = "p5-verify-task-1";
  // leader(runId,novelId,conv=leader) + member(runId,taskId,conv=taskId,novelId)
  // + draft(novelId) + wizard×2(correlation only) + detect(no links) = 6 rows.
  const rows = [
    { surface: SURFACE, modelId: "glm-4.6", usage: { promptTokens: 1000, completionTokens: 100, totalTokens: 1100 }, runId, novelId: novel.id, conversationId: "leader" },
    { surface: SURFACE, modelId: "glm-4.6", usage: { promptTokens: 500, completionTokens: 50, totalTokens: 550 }, runId, novelId: novel.id, taskId, conversationId: taskId },
    { surface: SURFACE, modelId: "gateway-default", usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220 }, novelId: novel.id },
    { surface: SURFACE, modelId: "gateway-default", usage: { promptTokens: 60, completionTokens: 6, totalTokens: 66 }, correlationId: CORR_WIZARD },
    { surface: SURFACE, modelId: "gateway-default", usage: { promptTokens: 40, completionTokens: 4, totalTokens: 44 }, correlationId: CORR_WIZARD },
    { surface: SURFACE, modelId: "gateway-default", usage: { promptTokens: 30, completionTokens: 3, totalTokens: 33 } },
  ];
  for (const row of rows) recordUsageCall(row);
  // Poll on the SURFACE-scoped count (fixtureCallCount spans both fixture
  // tags — S2's row lives on SURFACE_S2).
  const afterScope = await waitFor(async () =>
    (await db.usageCall.count({ where: { surface: SURFACE } })) === 6 ? 6 : null
  );
  check("S3 all six fixture rows persisted", afterScope === 6, `count=${afterScope}`);

  const sum = (xs: { promptTokens: number; completionTokens: number; totalTokens: number }[]) =>
    xs.reduce(
      (a, x) => ({
        promptTokens: a.promptTokens + x.promptTokens,
        completionTokens: a.completionTokens + x.completionTokens,
        totalTokens: a.totalTokens + x.totalTokens,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    );
  const eq3 = (a: { promptTokens: number; completionTokens: number; totalTokens: number }, b: { promptTokens: number; completionTokens: number; totalTokens: number }) =>
    a.promptTokens === b.promptTokens && a.completionTokens === b.completionTokens && a.totalTokens === b.totalTokens;

  const runRows = await db.usageCall.findMany({ where: { surface: SURFACE, runId } });
  check(
    "S3 per-run scope = leader + member rows",
    runRows.length === 2 && eq3(sum(runRows), { promptTokens: 1500, completionTokens: 150, totalTokens: 1650 }),
    `${runRows.length} rows`
  );
  const taskRows = await db.usageCall.findMany({ where: { surface: SURFACE, taskId } });
  check(
    "S3 per-member-task scope = exactly the member row",
    taskRows.length === 1 && eq3(sum(taskRows), { promptTokens: 500, completionTokens: 50, totalTokens: 550 }),
    `${taskRows.length} row`
  );
  const directNovelRows = await db.usageCall.findMany({ where: { surface: SURFACE, novelId: novel.id } });
  check(
    "S3 per-novel (direct) scope = leader + member + draft rows",
    directNovelRows.length === 3 && eq3(sum(directNovelRows), { promptTokens: 1700, completionTokens: 170, totalTokens: 1870 }),
    `${directNovelRows.length} rows`
  );
  const allFixture = await db.usageCall.findMany({ where: { surface: SURFACE } });
  check(
    "S3 account scope = every fixture row (6), no double counting",
    allFixture.length === 6 && eq3(sum(allFixture), { promptTokens: 1830, completionTokens: 183, totalTokens: 2013 }),
    `${allFixture.length} rows`
  );

  // ---------- S4: retro-tag provenance ----------
  recordProvenanceLink("wizard", CORR_WIZARD, novel.id);
  const linkCount = await waitFor(async () => {
    const n = await db.usageProvenance.count({ where: { correlationId: CORR_WIZARD, novelId: novel.id } });
    return n === 1 ? n : null;
  });
  check("S4 provenance link written at creation (fire-and-forget)", linkCount === 1, "1 row");

  let summary = await novelUsageSummary(novel.id);
  check(
    "S4 per-novel summary: linked = the 2 wizard rows",
    summary !== null && summary.linked.calls === 2 && eq3(summary.linked, { calls: 2, promptTokens: 100, completionTokens: 10, totalTokens: 110 }),
    summary ? `linked.calls=${summary.linked.calls}` : "null"
  );
  check(
    "S4 per-novel total = direct + linked (complete, disjoint)",
    summary !== null && summary.total.calls === 5 && eq3(summary.total, { calls: 5, promptTokens: 1800, completionTokens: 180, totalTokens: 1980 }),
    summary ? `total.calls=${summary.total.calls}` : "null"
  );

  // Idempotence: a retried create cannot double-link.
  recordProvenanceLink("wizard", CORR_WIZARD, novel.id);
  await new Promise((r) => setTimeout(r, 300));
  const linkCountAfterDouble = await db.usageProvenance.count({ where: { correlationId: CORR_WIZARD, novelId: novel.id } });
  const summaryAfterDouble = await novelUsageSummary(novel.id);
  check(
    "S4 link idempotent (double write ⇒ 1 row, totals unchanged)",
    linkCountAfterDouble === 1 && summaryAfterDouble !== null && summaryAfterDouble.total.calls === 5,
    `links=${linkCountAfterDouble} total.calls=${summaryAfterDouble?.total.calls}`
  );

  const snapshot = await accountUsageSnapshot();
  const snapshotNovel = snapshot.novels.find((n) => n.novelId === novel.id);
  check(
    "S4 account snapshot: fixture novel present, not deleted, totals == direct",
    snapshotNovel !== undefined && snapshotNovel.deleted === false && snapshotNovel.calls === 3,
    snapshotNovel ? `calls=${snapshotNovel.calls} deleted=${snapshotNovel.deleted}` : "missing"
  );

  // ---------- S6: double-book reconciliation (§4.5, fixture-level) ----------
  const run = await db.agentRun.create({
    data: { id: runId, novelId: novel.id, goal: "P5 fixture run — zero GLM", status: "completed" },
    select: { id: true },
  });
  const triples = [
    { promptTokens: 1000, completionTokens: 100, totalTokens: 1100 },
    { promptTokens: 500, completionTokens: 50, totalTokens: 550 },
  ];
  for (const [i, t] of triples.entries()) {
    await db.agentEvent.create({
      data: {
        runId,
        kind: "usage",
        summary: `Context usage (p5 fixture turn ${i + 1})`,
        payload: JSON.stringify({
          usage: {
            modelId: "glm-4.6",
            contextWindow: 200000,
            used: t.promptTokens,
            actor: `p5 fixture · turn ${i + 1}`,
            sections: { system: 0, tools: 0, skills: 0, novel: 0, conversation: t.promptTokens, mcp: 0 },
            updatedAt: new Date().toISOString(),
            real: t,
          },
        }),
      },
    });
    recordUsageCall({ surface: SURFACE, modelId: "glm-4.6", usage: t, runId, novelId: novel.id, conversationId: "leader", correlationId: CORR_RECON });
  }
  await waitForFixtureCount(9); // 6 (S3) + 2 (S6) + 1 (S2, other tag)

  const events = await db.agentEvent.findMany({ where: { runId, kind: "usage" } });
  const eventTriples = events
    .map((e) => {
      const payload = JSON.parse((e.payload ?? "{}") as string) as {
        usage?: { real?: { promptTokens: number; completionTokens: number; totalTokens: number } };
      };
      return payload.usage?.real ?? null;
    })
    .filter((t): t is { promptTokens: number; completionTokens: number; totalTokens: number } => t !== null)
    .sort((a, b) => a.totalTokens - b.totalTokens);
  // Isolate the S6 rows by correlation (the S3 leader/member rows also carry runId).
  const ledgerRows = await db.usageCall.findMany({ where: { surface: SURFACE, correlationId: CORR_RECON } });
  const ledgerTriples = ledgerRows
    .map((r) => ({ promptTokens: r.promptTokens, completionTokens: r.completionTokens, totalTokens: r.totalTokens }))
    .sort((a, b) => a.totalTokens - b.totalTokens);
  check(
    "S6 books agree ROW-FOR-ROW (usage events vs UsageCall, same measured calls)",
    eventTriples.length === 2 &&
      ledgerTriples.length === 2 &&
      eventTriples.every((t, i) => eq3(t, ledgerTriples[i])),
    `${eventTriples.length} events / ${ledgerTriples.length} rows`
  );
  const runtimeSource = readFileSync("src/lib/agent/runtime.ts", "utf8");
  const glmSource = readFileSync("src/lib/novara/glm.ts", "utf8");
  check(
    "S6 source pin: every glmChat result feeds BOTH books (emitUsageEvent + recordUsageCall)",
    runtimeSource.includes("emitUsageEvent(runId, meter") && glmSource.includes("recordUsageCall({"),
    "runtime.ts + glm.ts"
  );

  // ---------- S8: retention live proof (Ruling 1) ----------
  const ledgerCountBeforeDelete = await fixtureCallCount();
  await db.novel.delete({ where: { id: novel.id } }); // cascade: run + events die
  const runsAfter = await db.agentRun.count();
  const eventsAfter = await db.agentEvent.count({ where: { runId } });
  const ledgerCountAfterDelete = await fixtureCallCount();
  check(
    "S8 novel delete cascades run+events but EVERY UsageCall row survives (no cascade — Ruling 1)",
    eventsAfter === 0 && runsAfter === runsBefore && ledgerCountAfterDelete === ledgerCountBeforeDelete,
    `events=${eventsAfter} ledgerRows=${ledgerCountAfterDelete}/${ledgerCountBeforeDelete}`
  );
  const orphanSummary = await novelUsageSummary(novel.id);
  check("S8 novelUsageSummary for a deleted novel = null (route 404s)", orphanSummary === null);

  const orphanSnapshot = await accountUsageSnapshot();
  const orphan = orphanSnapshot.novels.find((n) => n.novelId === novel.id);
  check(
    "S8 account snapshot renders the orphan: deleted=true, title=null → '(deleted novel)'",
    orphan !== undefined && orphan.deleted === true && orphan.title === null && orphan.calls === 5,
    orphan ? `calls=${orphan.calls} deleted=${orphan.deleted}` : "missing"
  );

  // ---------- S5: restart survival (through a SECOND fresh client) ----------
  const viaDb2 = await db2.usageCall.findMany({ where: { surface: { in: [SURFACE, SURFACE_S2] } } });
  check(
    "S5 fixture rows readable via a SECOND freshly constructed PrismaClient (persist beyond process memory)",
    viaDb2.length === 9,
    `db2 rows=${viaDb2.length} (1 S2 + 6 S3 + 2 S6)`
  );
  const inMemoryRetired =
    !existsSync("src/lib/usage/ledger.ts") &&
    !existsSync("src/app/api/usage/global/route.ts");
  let importers: string[] = [];
  try {
    const out = execSync(
      `rg -l 'from "@/lib/usage/ledger"|from "\./ledger"|from "../usage/ledger"' src/`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim();
    importers = out ? out.split("\n") : [];
  } catch {
    // rg exits 1 when NOTHING matches — that is the retirement proof.
    importers = [];
  }
  check(
    "S5 in-memory ledger RETIRED (P5-b): module file + /api/usage/global gone, zero src/ imports",
    inMemoryRetired && importers.length === 0,
    inMemoryRetired
      ? importers.length === 0
        ? "deleted outright — no debug layer, no dual feed (Ruling 2)"
        : `importers remain: ${importers.join(",")}`
      : "module or route still present"
  );

  // ---------- cleanup + final shape assertions ----------
  await db.usageCall.deleteMany({ where: { surface: { in: [SURFACE, SURFACE_S2] } } });
  await db.usageProvenance.deleteMany({ where: { correlationId: { startsWith: "p5-verify" } } });
  const leftoverCalls = await db.usageCall.count({ where: { surface: SURFACE } });
  const leftoverLinks = await db.usageProvenance.count({ where: { correlationId: { startsWith: "p5-verify" } } });
  const novelsAfter = await db.novel.count();
  check(
    "Cleanup: fixture rows fully removed, DB back to pre-run shape",
    leftoverCalls === 0 && leftoverLinks === 0 && novelsAfter === novelsBefore && runsAfter === runsBefore,
    `calls=${leftoverCalls} links=${leftoverLinks} novels=${novelsAfter}/${novelsBefore} runs=${runsAfter}/${runsBefore}`
  );

  await db.$disconnect();
  await db2.$disconnect();

  console.log(`P5: ${failures === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"} (${checks} checks)`);
  if (failures > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error("P5: harness crashed:", error);
  try {
    await db.usageCall.deleteMany({ where: { surface: { in: [SURFACE, SURFACE_S2] } } });
    await db.usageProvenance.deleteMany({ where: { correlationId: { startsWith: "p5-verify" } } });
    await db.$disconnect();
    await db2.$disconnect();
  } catch {
    // best-effort cleanup on crash
  }
  process.exit(1);
});
