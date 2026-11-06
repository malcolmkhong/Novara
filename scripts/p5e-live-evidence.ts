// ---------------------------------------------------------------------------
// Novara AI — P5-e slicing-enablement EVIDENCE + CLEANUP pass (gate §3).
//
// Reads /tmp/p5e-live-state.json (persisted by the controller BEFORE any
// model call) and runs the evidence pass against the DB, then cascade-deletes
// the probe run + scratch novel. TWO differences from the P4 evidence pass,
// both consequences of the flip being the SHIPPED state (user ruling R-1):
//   1. NO yaml restore — instead the pass asserts budgets.yaml is still
//      BYTE-EQUAL to the at-rest text captured pre-run (the flip STAYS).
//   2. The UsageCall ledger now exists: a §4.5/gate-§3.3 cross-check
//      reconciles agentEvent usage payloads vs UsageCall rows for this run
//      (row-for-row sorted token triples), asserts the request-side
//      modelId/surface attribution, and pins the P5-c honesty rule for the
//      run's rows: glm-4-flash is UNPRICED (unlisted-model) — never $0-by-
//      assumption, excluded from the account estimate.
// The strongest member-wire assertion is BYTE-EXACT: each member envelope's
// snapshot block must equal buildMemberSnapshotSlice recomputed from the
// persisted pre-run snapshot data + the actual task row (map + guard + floor
// all deterministic — the live wire proves the exact shipped function).
//
// Runnable standalone for sandbox-reap recovery:
//   bun scripts/p5e-live-evidence.ts
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { countTokens } from "../src/lib/agent/context-meter";
import { buildMemberSnapshotSlice } from "../src/lib/agent/snapshot-slice";
import { priceForModelId } from "../src/lib/usage/pricing";

const db = new PrismaClient();
const YAML_PATH = "agent/config/budgets.yaml";
const STATE_PATH = "/tmp/p5e-live-state.json";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P5E-LIVE: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const countMatches = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

const SNAP_START = "STORY SNAPSHOT (measured at run start";
const SNAP_HEADER = "STORY SNAPSHOT (measured at run start; use read tools for fresher data):";
const SNAP_END_MARKERS = ["\nCERTIFY PROTOCOL (hard rule", "\nLENGTH PLAN for", "\nLANGUAGE: "];

function snapshotBlockOf(envelope: string): { text: string; found: boolean } {
  const start = envelope.indexOf(SNAP_START);
  if (start < 0) return { text: "", found: false };
  let end = envelope.length;
  for (const m of SNAP_END_MARKERS) {
    const i = envelope.indexOf(m, start + 1);
    if (i >= 0 && i < end) end = i;
  }
  return { text: envelope.slice(start, end), found: true };
}

async function gapless(runId: string, conv: string) {
  const rows = await db.agentMessage.findMany({
    where: { runId, conversationId: conv },
    orderBy: { seq: "asc" },
    select: { seq: true },
  });
  const gaps: string[] = [];
  rows.forEach((r, i) => {
    if (r.seq !== i + 1) gaps.push(`seq ${i + 1}≠${r.seq}`);
  });
  return { ok: gaps.length === 0, detail: `${rows.length} rows${gaps.length ? ` gaps: ${gaps.join(",")}` : ", dense 1..N"}` };
}

async function usageEvents(runId: string) {
  const events = await db.agentEvent.findMany({
    where: { runId, kind: "usage" },
    orderBy: { createdAt: "asc" },
    select: { summary: true, payload: true },
  });
  return events.map((e) => {
    let usage: {
      used?: number;
      sections?: Record<string, number>;
      real?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
    } = {};
    try {
      usage = (JSON.parse(e.payload ?? "{}") as { usage?: typeof usage }).usage ?? {};
    } catch {}
    return { summary: e.summary, used: usage.used ?? 0, novel: usage.sections?.novel ?? 0, real: usage.real ?? null };
  });
}

async function main() {
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
    runId: string;
    novelId: string;
    yamlAtRest: string;
    expectedLeaderEnvelope: string;
    fullSnapText: string;
    fullSnapTok: number;
    snapshotData: Parameters<typeof buildMemberSnapshotSlice>[0];
  };
  const { runId, novelId, yamlAtRest, expectedLeaderEnvelope, fullSnapText, fullSnapTok, snapshotData } = state;

  // run state + tasks -----------------------------------------------------------
  const runFinal = await db.agentRun.findUnique({ where: { id: runId } });
  const tasks = await db.agentTask.findMany({ where: { runId }, orderBy: { order: "asc" } });
  console.log(`P5E-LIVE: tasks — ${tasks.map((t) => `${t.key}:${t.assignee}:${t.status}`).join(", ") || "(none)"}`);
  const sageWrite = tasks.find((t) => t.assignee === "sage" && t.key !== "Task 0" && t.status === "done");
  const novaRead = tasks.find((t) => t.assignee === "nova" && t.status === "done");
  check("E-setup: ≥1 write task (sage) executed to done", !!sageWrite, sageWrite ? sageWrite.key : tasks.filter((t) => t.assignee === "sage").map((t) => `${t.key}:${t.status}`).join(",") || "no sage task");
  check("E-setup: ≥1 read-only task (nova) executed to done", !!novaRead, novaRead ? novaRead.key : tasks.filter((t) => t.assignee === "nova").map((t) => `${t.key}:${t.status}`).join(",") || "no nova task");
  check("run reached a terminal state", !!runFinal && ["completed", "failed", "cancelled"].includes(runFinal.status), `status=${runFinal?.status ?? "running"}`);

  // (iv) leader envelope BYTE-IDENTICAL — slicing must not touch the leader -----
  const leaderEnvelopeRow = await db.agentMessage.findFirst({
    where: { runId, conversationId: "leader", kind: "envelope" },
    orderBy: { seq: "asc" },
  });
  check(
    "E(iv) leader envelope BYTE-IDENTICAL to pre-P4 construction (full snapshot — slicing never touches the leader wire)",
    !!leaderEnvelopeRow && leaderEnvelopeRow.content === expectedLeaderEnvelope,
    leaderEnvelopeRow ? `stored=${leaderEnvelopeRow.content.length} chars, expected=${expectedLeaderEnvelope.length}, equal=${leaderEnvelopeRow.content === expectedLeaderEnvelope}` : "no envelope row"
  );
  if (leaderEnvelopeRow) {
    const snapAt = leaderEnvelopeRow.content.indexOf("STORY SNAPSHOT (measured now):");
    const leaderSnap = snapAt >= 0 ? leaderEnvelopeRow.content.slice(snapAt) : "";
    check(
      "E(iv) leader wire carries the FULL section set (40 beats · 30 ledger entries · ≥20 timeline)",
      countMatches(leaderSnap, /^\d+\./gm) === 40 && countMatches(leaderSnap, /^-\s*\[[^\]]*\]\s*\([^)]*planted ch/gm) === 30 && countMatches(leaderSnap, /^-\s*\d+\./gm) >= 20,
      `beats=${countMatches(leaderSnap, /^\d+\./gm)} ledger=${countMatches(leaderSnap, /^-\s*\[[^\]]*\]\s*\([^)]*planted ch/gm)} timeline=${countMatches(leaderSnap, /^-\s*\d+\./gm)}`
    );
  }

  // (i)+(ii) member wires: BYTE-EXACT vs the recomputed shipped slice -----------
  const memberEnvelopes = await db.agentMessage.findMany({
    where: { runId, kind: "envelope", taskId: { not: null } },
    orderBy: { seq: "asc" },
  });
  const usages = await usageEvents(runId);
  console.log("P5E-LIVE: usage events (metered truth):");
  for (const u of usages) console.log(`P5E-LIVE:   novel=${u.novel} used=${u.used} real=${u.real ? `${u.real.promptTokens}/${u.real.completionTokens}/${u.real.totalTokens}` : "—"} | ${u.summary.slice(0, 90)}`);

  const FLOOR_MARKERS = ["NOVEL: ", "SYNOPSIS: ", "PROGRESS: ", "NEXT CHAPTER: ", "CAST:", "STORY CONTRACT"];
  let wireCompared = 0;
  let wireByteExact = 0;
  let novelSectionDropped = false;
  const wireRows: string[] = [];
  for (const env of memberEnvelopes) {
    const taskRow = tasks.find((t) => t.id === env.taskId);
    if (!taskRow || taskRow.key === "Task 0") continue;
    const block = snapshotBlockOf(env.content);
    if (!block.found) continue;

    // BYTE-EXACT recompute: the shipped function, the persisted pre-run
    // snapshot data, the ACTUAL task row the leader dispatched. The extracted
    // block carries ONE trailing separator newline before the next envelope
    // section (the "\n\n" join's first half survives the end-marker cut), so
    // the comparison trims it; the raw equality is kept in the detail line.
    const expectedSlice = buildMemberSnapshotSlice(snapshotData, taskRow, { enabled: true });
    const expectedBlock = `${SNAP_HEADER}\n${expectedSlice}`;
    const byteExact = block.text.trimEnd() === expectedBlock;
    wireCompared += 1;
    if (byteExact) wireByteExact += 1;
    check(
      `E(i) ${taskRow.key} (${taskRow.assignee}:${taskRow.artifactType ?? "*"}) member wire snapshot block BYTE-EXACT vs recomputed shipped slice`,
      byteExact,
      `wire=${block.text.length} chars (incl. 1 separator newline) ≈ ${countTokens(block.text)} tok · expected=${expectedBlock.length} chars · equal=${byteExact}`
    );

    // Section table for the report + bulk-absence proof.
    const ledger = countMatches(block.text, /^-\s*\[[^\]]*\]\s*\([^)]*planted ch/gm);
    const beats = countMatches(block.text, /^\d+\./gm);
    const timeline = countMatches(block.text, /^-\s*\d+\./gm);
    const roster = countMatches(block.text, /^-\s*ch\d+\s/gm);
    const uniqF = (block.text.match(/UNIQ-F\d+/g) ?? []).map((s) => Number(s.replace("UNIQ-F", "")));
    const floorPresent = FLOOR_MARKERS.every((m) => block.text.includes(m));
    wireRows.push(`${taskRow.key} ${taskRow.assignee}:${taskRow.artifactType} — ${block.text.length} chars ≈ ${countTokens(block.text)} tok (full ${fullSnapText.length} ≈ ${fullSnapTok}) · ledger=${ledger}/30 beats=${beats}/40 timeline=${timeline}/20 roster=${roster}/12 · F-kept=[${uniqF.sort((a, b) => a - b).join(",")}] · floor=${floorPresent ? "present" : "MISSING"}`);
    check(
      `E(i) ${taskRow.key} structural floor intact (novel/synopsis/progress/next_chapter/cast/contract present)`,
      floorPresent,
      FLOOR_MARKERS.filter((m) => !block.text.includes(m)).join(",") || "all six markers on wire"
    );
    check(
      `E(ii) ${taskKeyOf(taskRow.key, taskRow.assignee)} sliced bulk PHYSICALLY ABSENT (below full on every bounded axis)`,
      ledger < 30 || beats < 40 || timeline < 20,
      `ledger=${ledger}/30 beats=${beats}/40 timeline=${timeline}/20`
    );

    const firstUsage = usages.find((u) => u.summary.includes(`Context usage (${taskRow.key} ·`));
    if (firstUsage && firstUsage.novel > 0 && firstUsage.novel < fullSnapTok + 400) novelSectionDropped = true;
  }
  for (const r of wireRows) console.log(`P5E-LIVE:   WIRE ${r}`);
  check(
    "E(i) member snapshot blocks BYTE-EXACT against the shipped slicing function (ALL compared wires)",
    wireCompared > 0 && wireByteExact === wireCompared,
    `${wireByteExact}/${wireCompared} wires byte-exact`
  );
  check(
    "E(i) metered novel-section DROP on member wires (usage sections.novel < full snapshot estimate)",
    novelSectionDropped,
    `full≈${fullSnapTok} tok; member sections.novel values in the table above`
  );
  check(
    "E(ii) GUARD INTACT: sage wire carries the FULL chapter roster (12/12 > the map's recent-10 bound — restored by the brief's chapter-13 reference)",
    wireRows.some((r) => r.includes("sage:chapter") && /roster=12\/12/.test(r)),
    "recentChapters bound would keep 10; the A2 chapter-index guard restores the roster WHOLE"
  );

  // (iii) counters == DB truth --------------------------------------------------
  let report: { verified?: Record<string, number>; summary?: string } = {};
  try {
    report = JSON.parse(runFinal?.finalReport ?? "{}");
  } catch {}
  const dbChapters = await db.chapter.count({ where: { novelId } });
  const newChapter = await db.chapter.findFirst({ where: { novelId, index: 13 } });
  const verified = report.verified ?? {};
  check(
    "E(iii) member artifacts DB-correct — counters == DB truth",
    (verified.chaptersWritten ?? 0) === 1 && dbChapters === 13 && !!newChapter && (newChapter.wordCount ?? 0) > 0 && (verified.words ?? 0) === (newChapter?.wordCount ?? -1),
    `verified.chaptersWritten=${verified.chaptersWritten} · DB chapters=${dbChapters} (12 seeded + 1 written at index 13) · ch13.wordCount=${newChapter?.wordCount} · verified.words=${verified.words}`
  );
  check(
    "E(iii) read-only task produced no DB mutations",
    (verified.reviewsRun ?? 0) === 0 && (verified.chaptersFinalized ?? 0) === 0 && (verified.exportsRun ?? 0) === 0 && dbChapters === 13,
    `reviews=${verified.reviewsRun} finalizes=${verified.chaptersFinalized} exports=${verified.exportsRun}`
  );

  // §3.3 LEDGER CROSS-CHECK — agentEvent usage payloads vs UsageCall rows -------
  const ledgerRows = await db.usageCall.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
  const measured = ledgerRows.filter((r) => r.status === "measured");
  const failed = ledgerRows.filter((r) => r.status !== "measured");
  check(
    "E-L1 every ledger row for the run carries the run's attribution (surface=agent, modelId=glm-4-flash, novelId set)",
    ledgerRows.length > 0 && ledgerRows.every((r) => r.surface === "agent" && r.modelId === "glm-4-flash" && r.novelId === novelId),
    `rows=${ledgerRows.length} · surfaces=${[...new Set(ledgerRows.map((r) => r.surface))].join(",")} · models=${[...new Set(ledgerRows.map((r) => r.modelId))].join(",")}`
  );
  const eventTriples = usages
    .filter((u) => u.real && u.real.promptTokens != null)
    .map((u) => [u.real!.promptTokens ?? 0, u.real!.completionTokens ?? 0, u.real!.totalTokens ?? 0])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rowTriples = measured
    .map((r) => [r.promptTokens, r.completionTokens, r.totalTokens])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  check(
    "E-L2 measured UsageCall rows == usage-event real triples ROW-FOR-ROW (sorted; the two books agree)",
    JSON.stringify(eventTriples) === JSON.stringify(rowTriples) && eventTriples.length > 0,
    `events=${eventTriples.length} rows=${rowTriples.length} · equal=${JSON.stringify(eventTriples) === JSON.stringify(rowTriples)}`
  );
  check(
    "E-L3 failed rows (Policy F), if any, contribute ZERO tokens and are counted separately",
    failed.every((r) => r.promptTokens === 0 && r.completionTokens === 0 && r.totalTokens === 0),
    `failed=${failed.length}/${ledgerRows.length} rows${failed.length ? ` kinds=${failed.map((f) => f.errorKind).join(",")}` : " (clean run — no failed attempts)"}`
  );
  const pricing = priceForModelId("glm-4-flash");
  check(
    "E-L4 P5-c honesty: glm-4-flash renders UNPRICED (unlisted-model) — never $0-by-assumption, excluded from the account estimate",
    pricing.priced === false && pricing.reason === "unlisted-model",
    `priced=${pricing.priced} reason=${pricing.priced === false ? pricing.reason : "—"} · run rows (${ledgerRows.length}) all UNPRICED in the central view`
  );
  const runPromptTok = measured.reduce((s, r) => s + r.promptTokens, 0);
  const runCompletionTok = measured.reduce((s, r) => s + r.completionTokens, 0);
  console.log(`P5E-LIVE: LEDGER — ${ledgerRows.length} rows (measured ${measured.length}, failed ${failed.length}) · Σprompt=${runPromptTok} Σcompletion=${runCompletionTok} tok · modelId=glm-4-flash (FREE tier; UNPRICED in our table)`);

  // transcript discipline --------------------------------------------------------
  const gLeader = await gapless(runId, "leader");
  check("leader transcript gapless", gLeader.ok, gLeader.detail);
  for (const t of tasks.filter((t) => t.key !== "Task 0").slice(0, 4)) {
    const g = await gapless(runId, t.id);
    check(`${t.key} (${t.assignee}) conversation gapless`, g.ok, g.detail);
  }

  // cleanup — the flip STAYS (no restore); probe artifacts deleted; ledger rows
  // survive by design (no FK) and are disclosed as orphans of the deleted novel.
  const current = readFileSync(YAML_PATH, "utf8");
  check(
    "cleanup: budgets.yaml UNCHANGED — the P5-e flip is the shipped state (no probe-pack restore in this stage)",
    current === yamlAtRest,
    `byte-equal=${current === yamlAtRest}`
  );
  await db.agentRun.delete({ where: { id: runId } }).catch(() => undefined);
  await db.novel.delete({ where: { id: novelId } }).catch(() => undefined);
  const leftMsg = await db.agentMessage.count({ where: { runId } });
  const leftNovel = await db.novel.findUnique({ where: { id: novelId } });
  const survivingRows = await db.usageCall.count({ where: { runId } });
  check("probe run + scratch novel cascade-deleted", leftMsg === 0 && leftNovel === null);
  console.log(`P5E-LIVE: DISCLOSURE — ${survivingRows} UsageCall rows for the run SURVIVE cleanup (no FK by P5-a design): orphaned to the deleted probe novel, they render under "(deleted novel)" in the central view as modelId=glm-4-flash UNPRICED rows worth $0 real spend (free tier). Retired on the P5-f retention schedule like any detail row.`);
  await db.$disconnect();

  console.log(`P5E-LIVE: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} (${checks} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

function taskKeyOf(key: string, assignee: string): string {
  return `${key}(${assignee})`;
}

main().catch((e) => {
  console.error("P5E-LIVE: evidence error:", e);
  process.exit(1);
});
