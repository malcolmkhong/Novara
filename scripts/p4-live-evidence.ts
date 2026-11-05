// ---------------------------------------------------------------------------
// Novara AI — P4 live acceptance EVIDENCE + CLEANUP pass (A1 i–iv).
//
// Reads /tmp/p4-live-state.json (persisted by the controller BEFORE any model
// call) and runs the full evidence pass against the DB, then restores
// budgets.yaml BYTE-EXACT and cascade-deletes the probe run + scratch novel.
//
// Runnable standalone for sandbox-reap recovery:
//   bun scripts/p4-live-evidence.ts
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { countTokens } from "../src/lib/agent/context-meter";

const db = new PrismaClient();
const YAML_PATH = "agent/config/budgets.yaml";
const STATE_PATH = "/tmp/p4-live-state.json";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P4-LIVE: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const countMatches = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

const SNAP_START = "STORY SNAPSHOT (measured at run start";
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
    let usage: { used?: number; sections?: Record<string, number>; real?: { promptTokens?: number } | null } = {};
    try {
      usage = (JSON.parse(e.payload ?? "{}") as { usage?: typeof usage }).usage ?? {};
    } catch {}
    return { summary: e.summary, used: usage.used ?? 0, novel: usage.sections?.novel ?? 0, realPrompt: usage.real?.promptTokens ?? null };
  });
}

async function main() {
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
    runId: string;
    novelId: string;
    yamlOriginal: string;
    expectedLeaderEnvelope: string;
    fullSnapText: string;
    fullSnapTok: number;
  };
  const { runId, novelId, yamlOriginal, expectedLeaderEnvelope, fullSnapText, fullSnapTok } = state;

  // run state + tasks -----------------------------------------------------------
  const runFinal = await db.agentRun.findUnique({ where: { id: runId } });
  const tasks = await db.agentTask.findMany({ where: { runId }, orderBy: { order: "asc" } });
  console.log(`P4-LIVE: tasks — ${tasks.map((t) => `${t.key}:${t.assignee}:${t.status}`).join(", ") || "(none)"}`);
  const sageWrite = tasks.find((t) => t.assignee === "sage" && t.key !== "Task 0" && t.status === "done");
  const novaRead = tasks.find((t) => t.assignee === "nova" && t.status === "done");
  check("A1 setup: ≥1 write task (sage) executed to done", !!sageWrite, sageWrite ? sageWrite.key : tasks.filter((t) => t.assignee === "sage").map((t) => `${t.key}:${t.status}`).join(",") || "no sage task");
  check("A1 setup: ≥1 read-only task (nova) executed to done", !!novaRead, novaRead ? novaRead.key : tasks.filter((t) => t.assignee === "nova").map((t) => `${t.key}:${t.status}`).join(",") || "no nova task");
  check("run reached a terminal state", !!runFinal && ["completed", "failed", "cancelled"].includes(runFinal.status), `status=${runFinal?.status ?? "running"}`);

  // (iv) leader envelope BYTE-IDENTICAL to the pre-P4 construction --------------
  const leaderEnvelopeRow = await db.agentMessage.findFirst({
    where: { runId, conversationId: "leader", kind: "envelope" },
    orderBy: { seq: "asc" },
  });
  check(
    "A1(iv) leader envelope BYTE-IDENTICAL to pre-P4 construction (full snapshot, untouched builder)",
    !!leaderEnvelopeRow && leaderEnvelopeRow.content === expectedLeaderEnvelope,
    leaderEnvelopeRow ? `stored=${leaderEnvelopeRow.content.length} chars, expected=${expectedLeaderEnvelope.length}, equal=${leaderEnvelopeRow.content === expectedLeaderEnvelope}` : "no envelope row"
  );
  if (leaderEnvelopeRow) {
    // Count ONLY within the snapshot region (the goal text carries its own
    // numbered lines — whole-envelope counts would inflate).
    const snapAt = leaderEnvelopeRow.content.indexOf("STORY SNAPSHOT (measured now):");
    const leaderSnap = snapAt >= 0 ? leaderEnvelopeRow.content.slice(snapAt) : "";
    check(
      "A1(iv) leader wire carries the FULL section set (40 beats · 30 ledger entries · 20 timeline)",
      countMatches(leaderSnap, /^\d+\./gm) === 40 && countMatches(leaderSnap, /^-\s*\[[^\]]*\]\s*\([^)]*planted ch/gm) === 30 && countMatches(leaderSnap, /^-\s*\d+\./gm) >= 20,
      `beats=${countMatches(leaderSnap, /^\d+\./gm)} ledger=${countMatches(leaderSnap, /^-\s*\[[^\]]*\]\s*\([^)]*planted ch/gm)} timeline=${countMatches(leaderSnap, /^-\s*\d+\./gm)}`
    );
  }

  // (i)+(ii) member wires carried the SLICED snapshot ---------------------------
  const memberEnvelopes = await db.agentMessage.findMany({
    where: { runId, kind: "envelope", taskId: { not: null } },
    orderBy: { seq: "asc" },
  });
  const usages = await usageEvents(runId);
  console.log("P4-LIVE: usage events:");
  for (const u of usages) console.log(`P4-LIVE:   novel=${u.novel} used=${u.used} real=${u.realPrompt ?? "—"} | ${u.summary.slice(0, 90)}`);

  let sliceEvidence = { shape: "—", snapTok: 0, fullTok: fullSnapTok, novelSection: 0 };
  let bigAbsence = { absent: false, detail: "" };
  for (const env of memberEnvelopes) {
    const taskRow = tasks.find((t) => t.id === env.taskId);
    if (!taskRow || taskRow.key === "Task 0") continue;
    const block = snapshotBlockOf(env.content);
    if (!block.found) continue;
    const snapTok = countTokens(block.text);
    const firstUsage = usages.find((u) => u.summary.includes(`Context usage (${taskRow.key} ·`));
    const novelSection = firstUsage?.novel ?? 0;
    console.log(`P4-LIVE: ${taskRow.key} (${taskRow.assignee}) — snapshot block ${block.text.length} chars ≈ ${snapTok} tok (est) vs FULL ${fullSnapText.length} chars ≈ ${fullSnapTok} tok · usage sections.novel=${novelSection}`);
    sliceEvidence = { shape: `${taskRow.assignee}:${taskRow.artifactType ?? "*"}`, snapTok, fullTok: fullSnapTok, novelSection };
    const ledger = countMatches(block.text, /^-\s*\[[^\]]*\]\s*\([^)]*planted ch/gm);
    const beats = countMatches(block.text, /^\d+\./gm);
    const timeline = countMatches(block.text, /^-\s*\d+\./gm);
    const roster = countMatches(block.text, /^-\s*ch\d+\s/gm);
    console.log(`P4-LIVE:   sections on wire — ledger=${ledger}/30, beats=${beats}/40, timeline=${timeline}/20, roster=${roster}/12`);
    if (!bigAbsence.absent) {
      if (ledger <= 5 && ledger < 30) bigAbsence = { absent: true, detail: `FORESHADOW bulk absent (${ledger}/30 entries on wire, map window=5)` };
      else if (beats <= 4 && beats < 40) bigAbsence = { absent: true, detail: `OUTLINE bulk absent (${beats}/40 beats on wire, map window=4)` };
      else if (timeline <= 8 && timeline < 20) bigAbsence = { absent: true, detail: `TIMELINE bulk absent (${timeline}/20 events on wire, map window=8)` };
    }
  }
  check(
    "A1(i) member wire carried the SLICED novel section (payload < full · meter sections.novel < full estimate)",
    sliceEvidence.snapTok > 0 && sliceEvidence.snapTok < sliceEvidence.fullTok && sliceEvidence.novelSection > 0 && sliceEvidence.novelSection < sliceEvidence.fullTok + 400,
    `${sliceEvidence.shape}: snap=${sliceEvidence.snapTok} tok < full=${sliceEvidence.fullTok} tok · sections.novel=${sliceEvidence.novelSection} (< full+400 addenda bound)`
  );
  check("A1(ii) ≥1 big map-excluded section physically ABSENT from a member wire", bigAbsence.absent, bigAbsence.detail || "no bulk absence observed");

  // (iii) counters == DB truth --------------------------------------------------
  let report: { verified?: Record<string, number>; summary?: string } = {};
  try {
    report = JSON.parse(runFinal?.finalReport ?? "{}");
  } catch {}
  const dbChapters = await db.chapter.count({ where: { novelId } });
  const newChapter = await db.chapter.findFirst({ where: { novelId, index: 13 } });
  const verified = report.verified ?? {};
  check(
    "A1(iii) member artifacts DB-correct — counters == DB truth",
    (verified.chaptersWritten ?? 0) === 1 && dbChapters === 13 && !!newChapter && (newChapter.wordCount ?? 0) > 0 && (verified.words ?? 0) === (newChapter?.wordCount ?? -1),
    `verified.chaptersWritten=${verified.chaptersWritten} · DB chapters=${dbChapters} (12 seeded + 1 written at index 13) · ch13.wordCount=${newChapter?.wordCount} · verified.words=${verified.words}`
  );
  check(
    "A1(iii) read-only task produced no DB mutations",
    (verified.reviewsRun ?? 0) === 0 && (verified.chaptersFinalized ?? 0) === 0 && (verified.exportsRun ?? 0) === 0 && dbChapters === 13,
    `reviews=${verified.reviewsRun} finalizes=${verified.chaptersFinalized} exports=${verified.exportsRun}`
  );

  // transcript discipline --------------------------------------------------------
  const gLeader = await gapless(runId, "leader");
  check("leader transcript gapless", gLeader.ok, gLeader.detail);
  for (const t of tasks.filter((t) => t.key !== "Task 0").slice(0, 4)) {
    const g = await gapless(runId, t.id);
    check(`${t.key} (${t.assignee}) conversation gapless`, g.ok, g.detail);
  }

  // cleanup — restore yaml BYTE-EXACT, cascade-delete probe artifacts ------------
  const current = readFileSync(YAML_PATH, "utf8");
  const restoreRe = /(contextSlicing:\n(?:[^\n]*\n)*?  enabled: )true/;
  writeFileSync(YAML_PATH, current.replace(restoreRe, "$1false"));
  const restored = readFileSync(YAML_PATH, "utf8");
  check("budgets.yaml restored BYTE-EXACT to the shipped at-rest state", restored === yamlOriginal);
  await db.agentRun.delete({ where: { id: runId } }).catch(() => undefined);
  await db.novel.delete({ where: { id: novelId } }).catch(() => undefined);
  const leftMsg = await db.agentMessage.count({ where: { runId } });
  const leftNovel = await db.novel.findUnique({ where: { id: novelId } });
  check("probe run + scratch novel cascade-deleted", leftMsg === 0 && leftNovel === null);
  await db.$disconnect();

  console.log(`P4-LIVE: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} (${checks} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("P4-LIVE: evidence error:", e);
  process.exit(1);
});
