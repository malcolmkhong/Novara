// ---------------------------------------------------------------------------
// Novara AI — P2-c verification (Phase 2, runtime wiring + amendments).
//
// ZERO GLM calls. Covers the three reviewer amendments + the P2-c fallback
// wiring, on corpora rebuilt through the PRODUCTION append path
// (lease-fenced appendAgentMessages on a throwaway run — same discipline as
// verify-p2-b):
//   M1. Marker precedence carve-out (design §2.0.1): historical gate_stop /
//       resume_note rows never render (projection body, tail, legacy parity);
//       the CURRENT resume's resume_note — a per-assembly injection applied
//       AFTER assembly — rides the compacted wire regardless of cover range.
//   M2. Adjacency ownership (design §2.1.y): ONE normalization owner
//       (finalizeWire) at assembly output; matrix over {projection present? ×
//       tail-first kind ∈ reply / tool_results / resume-note} — shape when
//       enabled, BYTE IDENTITY when disabled; transcript rows untouched.
//   M3. P2002 idempotence verifies ACTIVE status (design §2.3): retry at an
//       ACTIVE cut completes itself (already=true); P2002 against a
//       SUPERSEDED row is NOT "done" — ok:false("cut already superseded"),
//       active head unchanged.
//   FW. fallbackWarnings → AgentEvent(kind="error") wiring: corrupt-summary
//       fixtures produce byte-identical fallback replay AND an event body via
//       fallbackErrorSummary() that names the row and the gap.
//   CF. Shipped config at rest: budgets.yaml carries enabled=false with the
//       reachable defaults — the probe pack exists only in the probe script.
// Usage: bun scripts/verify-p2-c.ts
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import {
  appendAgentMessages,
  claimLease,
  loadConversation,
  releaseLease,
  type ExecutorLease,
} from "../src/lib/agent/messages";
import {
  PROJECTION_VERSION,
  assembleWire,
  buildProjectionBody,
  fallbackErrorSummary,
  finalizeWire,
  legacyReplay,
  renderProjection,
  writeCompactionSummary,
  type ActiveSummary,
  type SequencedRow,
} from "../src/lib/agent/wire";
import { getBudgets } from "../src/lib/novara/content";

const db = new PrismaClient();
const TEST_NOVEL_ID = "cmw1mldiz001qqiv8vc2ewluk";
const GOAL = "P2-C harness run — amendments M1/M2/M3 + fallback wiring";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P2-C: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// --- corpus -------------------------------------------------------------------

const CJK = [
  "沈青梧按住剑柄，指尖在青铜门上停了半拍。",
  "楚昭南没有回头，只把染血的袖口挽了上去。",
  "卷轴上的墨迹未干，誓约看来竟像旁人的故事。",
  "雨点砸在天井的石板上，她数着更漏。",
];

const SYS = "You are Atlas, the leader. Verified writes only. " + CJK[0];
const ENV = "AUTHOR GOAL: continuity audit.\n" + CJK[1] + "\nSTORY SNAPSHOT: " + CJK[2];

const reply = (i: number) => `Turn ${i}: continuity note — ${CJK[i % CJK.length]} Keep the oath deadline and the ledger gap on the page.`;
const feed = (i: number) => `TOOL RESULTS:\n1. read: chapter ${i} — ${CJK[(i + 1) % CJK.length]}`;

type RowSpec = {
  kind: "system_note" | "envelope" | "reply" | "tool_results" | "resume_note" | "gate_stop";
  role: "user" | "assistant";
  content: string;
};

function baseRows(turns: number): RowSpec[] {
  const rows: RowSpec[] = [
    { kind: "system_note", role: "assistant", content: SYS },
    { kind: "envelope", role: "user", content: ENV },
  ];
  for (let i = 1; i <= turns; i++) {
    rows.push({ kind: "reply", role: "assistant", content: reply(i) });
    rows.push({ kind: "tool_results", role: "user", content: feed(i) });
  }
  return rows;
}

async function persist(runId: string, conv: string, specs: RowSpec[], lease: ExecutorLease) {
  await appendAgentMessages(
    lease,
    specs.map((s) => ({
      runId,
      conversationId: conv,
      taskId: null,
      agent: "atlas",
      role: s.role,
      kind: s.kind,
      content: s.content,
    }))
  );
  return loadConversation(runId, conv);
}

/** Active summary built by the DETERMINISTIC builder over raw rows (§2.0). */
function summaryFor(rows: SequencedRow[], fromSeq: number, toSeq: number): ActiveSummary {
  return { fromSeq, toSeq, summary: renderProjection(fromSeq, toSeq, buildProjectionBody(rows, fromSeq, toSeq)) };
}

function projectionUserAdjacency(messages: { role: string }[]): boolean {
  return messages.length > 3 && messages[2].role === "user" && messages[3].role === "user";
}

// --- main ---------------------------------------------------------------------

async function main() {
  // CF. shipped config at rest (probe pack must never sit in the file).
  const budgets = getBudgets();
  check(
    "CF: shipped config at rest — enabled=false, reachable defaults, NOT the probe pack",
    budgets.contextCompaction.enabled === false &&
      budgets.contextCompaction.triggerTokens === 6000 &&
      budgets.contextCompaction.tailTurns === 8 &&
      budgets.contextCompaction.minCompactableRows === 12,
    JSON.stringify(budgets.contextCompaction)
  );
  const yamlRaw = readFileSync("agent/config/budgets.yaml", "utf8");
  check(
    "CF: probe pack appears in budgets.yaml ONLY as documentation (no live keys)",
    !/^  enabled: true/m.test(yamlRaw) &&
      !/^  triggerTokens: 4000/m.test(yamlRaw) &&
      !/^  tailTurns: 2\b/m.test(yamlRaw) &&
      !/^  minCompactableRows: 6\b/m.test(yamlRaw)
  );

  let novel = await db.novel.findUnique({ where: { id: TEST_NOVEL_ID }, select: { id: true } });
  if (!novel) {
    novel = await db.novel.create({ data: { title: "[p2-c-verify] scratch novel", genre: "test" }, select: { id: true } });
  }
  const run = await db.agentRun.create({
    data: { novelId: novel.id, goal: GOAL, status: "completed" },
    select: { id: true },
  });
  const runId = run.id;

  try {
    const lease = await claimLease(runId);
    check("lease claimed for harness run", !!lease);

    // Corpora:
    //  mx-reply  : tail-first kind = reply            (cut 12, cover 3..12)
    //  mx-feed   : tail-first kind = tool_results     (cut 7,  cover 3..7)
    //  mx-marker : historical resume_note inside cover (cut 13, cover 3..13)
    //              AND inside tail (cut 10, cover 3..10 → tail renders 12,13)
    const mxReply = await persist(
      runId,
      "mx-reply",
      [...baseRows(5), { kind: "reply", role: "assistant", content: reply(6) }],
      lease!
    );
    const mxFeed = await persist(runId, "mx-feed", baseRows(4), lease!);
    const mxMarker = await persist(
      runId,
      "mx-marker",
      [
        ...baseRows(4),
        { kind: "resume_note", role: "user", content: "[resume] HISTORICAL note — must never render." },
        { kind: "reply", role: "assistant", content: reply(5) },
        { kind: "tool_results", role: "user", content: feed(5) },
      ],
      lease!
    );
    check("corpus persisted via production append path", mxReply.length === 13 && mxFeed.length === 10 && mxMarker.length === 13, `${mxReply.length}/${mxFeed.length}/${mxMarker.length}`);

    // ------------------------------------------------------------------ M2 --
    // Matrix: {projection present? × tail-first kind} — shape when enabled,
    // BYTE IDENTITY when disabled; transcript rows untouched throughout.
    const matrix: { conv: string; rows: SequencedRow[]; cut: number; tailFirstKind: string }[] = [
      { conv: "mx-reply", rows: mxReply, cut: 12, tailFirstKind: "reply" },
      { conv: "mx-feed", rows: mxFeed, cut: 7, tailFirstKind: "tool_results" },
      // marker inside TAIL span: first RENDERED tail row is the reply at 12
      { conv: "mx-marker", rows: mxMarker, cut: 10, tailFirstKind: "reply(after filtered marker)" },
    ];

    for (const m of matrix) {
      const disabled = assembleWire({ rows: m.rows });
      check(
        `M2 disabled BYTE-IDENTICAL — ${m.conv} (tail-first ${m.tailFirstKind})`,
        same(disabled.messages, legacyReplay(m.rows)) &&
          disabled.projected === null &&
          disabled.fallbackWarnings.length === 0
      );
      const before = JSON.stringify(m.rows);
      const summary = summaryFor(m.rows, 3, m.cut);
      const enabled = assembleWire({ rows: m.rows, activeSummaries: [summary] });
      check(
        `M2 transcript rows untouched by assembly — ${m.conv}`,
        JSON.stringify(m.rows) === before
      );
      const tailRendered = m.rows.filter(
        (r) => r.seq > m.cut && r.kind !== "gate_stop" && r.kind !== "resume_note"
      );
      check(
        `M2 enabled shape [sys][env][projection][tail 1:1] — ${m.conv}`,
        enabled.fallbackWarnings.length === 0 &&
          !!enabled.projected &&
          enabled.projected.fromSeq === 3 &&
          enabled.projected.toSeq === m.cut &&
          enabled.messages.length === 3 + tailRendered.length &&
          enabled.messages[2].content === summary.summary &&
          tailRendered.every((r, i) => same(enabled.messages[3 + i], { role: r.role, content: r.content })),
        `wire=${enabled.messages.length} tail=${tailRendered.length}`
      );
      check(
        `M2 projection framing pinned (ctx-proj/v1 + range) — ${m.conv}`,
        enabled.messages[2].content.includes(PROJECTION_VERSION) &&
          enabled.messages[2].content.includes(`seq 3..${m.cut}`) &&
          enabled.messages[2].content.includes("NOT verbatim history")
      );
    }
    // The tool_results case exercises the projection→user-tail adjacency
    // literally: [projection(user), tool_results(user)] adjacent, 1:1, never
    // merged into one message.
    const feedCase = matrix[1];
    const enabledFeed = assembleWire({
      rows: feedCase.rows,
      activeSummaries: [summaryFor(feedCase.rows, 3, feedCase.cut)],
    });
    check(
      "M2 projection→user-tail adjacency preserved 1:1 (never merged)",
      projectionUserAdjacency(enabledFeed.messages) &&
        enabledFeed.messages[3].content === feed(3),
      `adjacent=${projectionUserAdjacency(enabledFeed.messages)}`
    );

    // ------------------------------------------------------------------ M1 --
    // (a) historical resume_note INSIDE the cover: excluded from the
    //     projection body and from the enabled wire.
    const markerInCover = assembleWire({
      rows: mxMarker,
      activeSummaries: [summaryFor(mxMarker, 3, 13)],
    });
    check(
      "M1 historical resume_note inside cover ⇒ NOT rendered in projection or wire",
      markerInCover.fallbackWarnings.length === 0 &&
        !markerInCover.messages[2].content.includes("HISTORICAL note") &&
        !markerInCover.messages.some((m) => m.content.includes("HISTORICAL note"))
    );
    // (b) historical resume_note INSIDE the tail span: filtered like legacy.
    const markerInTail = assembleWire({
      rows: mxMarker,
      activeSummaries: [summaryFor(mxMarker, 3, 10)],
    });
    check(
      "M1 historical resume_note inside tail span ⇒ filtered (legacy parity)",
      !markerInTail.messages.some((m) => m.content.includes("HISTORICAL note")) &&
        markerInTail.messages.slice(3).every((m) => !m.content.includes("HISTORICAL note")) &&
        markerInTail.messages.length === 3 + 2 /* tail renders only rows 12,13 */
    );
    // (c) legacy path parity: historical markers never replay on any path.
    check(
      "M1 legacy replay also excludes historical markers (parity)",
      !legacyReplay(mxMarker).some((m) => m.content.includes("HISTORICAL note"))
    );
    // (d) THE carve-out: the CURRENT resume's note is a per-assembly injection
    //     applied AFTER assembly — it rides the compacted wire as its own
    //     message (1:1 adjacency with the projection when the tail is empty),
    //     regardless of the cover swallowing its historical position.
    const freshNote = "[resume] CURRENT session note — re-dispatch only what remains.";
    const resumedWire = [
      ...markerInCover.messages, // projection wire (cover 3..13 "swallows" the note position)
      { role: "user" as const, content: freshNote }, // runtime liveInjections push
    ];
    check(
      "M1 fresh resume_note injection rides the COMPACTED wire (cover would otherwise swallow it)",
      resumedWire[resumedWire.length - 1].content === freshNote &&
        resumedWire[resumedWire.length - 2].role === "user" &&
        resumedWire[resumedWire.length - 2].content.includes("[CONTEXT PROJECTION") &&
        // 1:1 — injection is its OWN message, never merged into the projection
        !resumedWire[resumedWire.length - 2].content.includes("re-dispatch only what remains")
    );
    check(
      "M1 finalized injection wire passes the single normalization owner unchanged",
      same(finalizeWire(resumedWire), resumedWire)
    );

    // ------------------------------------------------------------------ M3 --
    // Chain: link 1 at cut 12 (active) → link 2 at cut 13 supersedes it →
    // retry at cut 12 hits P2002 against a SUPERSEDED row ⇒ NOT "done".
    const link1 = await writeCompactionSummary({
      runId,
      conversationId: "mx-reply",
      taskId: null,
      agent: "atlas",
      rows: mxReply,
      newCut: 12,
      lease: lease!,
    });
    check("M3 chain link 1 lands at cut 12", link1.ok && link1.row?.toSeq === 12);
    const link2 = await writeCompactionSummary({
      runId,
      conversationId: "mx-reply",
      taskId: null,
      agent: "atlas",
      rows: mxReply,
      newCut: 13,
      lease: lease!,
    });
    const heads2 = await db.contextSummary.findMany({
      where: { runId, conversationId: "mx-reply", supersededAt: null },
    });
    check(
      "M3 chain link 2 lands; exactly ONE active head at cut 13",
      link2.ok && link2.row?.toSeq === 13 && heads2.length === 1 && heads2[0].toSeq === 13
    );
    const retrySuperseded = await writeCompactionSummary({
      runId,
      conversationId: "mx-reply",
      taskId: null,
      agent: "atlas",
      rows: mxReply,
      newCut: 12, // the now-SUPERSEDED cut
      lease: lease!,
    });
    const headsAfterRetry = await db.contextSummary.findMany({
      where: { runId, conversationId: "mx-reply", supersededAt: null },
    });
    check(
      "M3 P2002 against a SUPERSEDED row is NOT done — ok:false('cut already superseded'), head unchanged",
      retrySuperseded.ok === false &&
        retrySuperseded.already === undefined &&
        retrySuperseded.reason === "cut already superseded" &&
        headsAfterRetry.length === 1 &&
        headsAfterRetry[0].toSeq === 13,
      `reason=${retrySuperseded.reason}`
    );
    const retryActive = await writeCompactionSummary({
      runId,
      conversationId: "mx-reply",
      taskId: null,
      agent: "atlas",
      rows: mxReply,
      newCut: 13, // the ACTIVE cut — a true crash→retry
      lease: lease!,
    });
    check(
      "M3 P2002 against the ACTIVE row IS done — ok:true already:true, still one head",
      retryActive.ok === true && retryActive.already === true
    );
    const activeAfter = await db.contextSummary.count({
      where: { runId, conversationId: "mx-reply", supersededAt: null },
    });
    check("M3 no duplicate row was ever written at either cut", activeAfter === 1);

    // ------------------------------------------------------------------ FW --
    // Corrupt-summary fixtures: fallback replay byte-identity + the runtime's
    // AgentEvent(kind="error") body via fallbackErrorSummary().
    const legacy = legacyReplay(mxReply);
    const headGap = assembleWire({
      rows: mxReply,
      activeSummaries: [{ fromSeq: 5, toSeq: 12, summary: "corrupt" }],
    });
    check(
      "FW head-gap fixture ⇒ byte-identical FULL raw replay fallback",
      same(headGap.messages, legacy) && headGap.fallbackWarnings.length > 0
    );
    const gapEvent = fallbackErrorSummary(headGap.fallbackWarnings);
    check(
      "FW error-event body names the row and the gap (fail loud, §2.2)",
      gapEvent.startsWith("Context compaction fell back to the FULL raw transcript replay") &&
        gapEvent.includes("head gap") &&
        gapEvent.includes("fromSeq=5") &&
        gapEvent.includes("envelope.seq+1=3"),
      gapEvent.slice(0, 120)
    );
    const doubleHead = assembleWire({
      rows: mxReply,
      activeSummaries: [
        summaryFor(mxReply, 3, 12),
        { fromSeq: 3, toSeq: 11, summary: "second head" },
      ],
    });
    check(
      "FW double-active fixture ⇒ byte-identical fallback + corrupt-chain event body",
      same(doubleHead.messages, legacy) &&
        fallbackErrorSummary(doubleHead.fallbackWarnings).includes("corrupt chain state")
    );
    // finalizeWire is the single adjacency owner: 1:1 preservation + empty drop.
    check(
      "FW finalizeWire: adjacent users preserved 1:1; empty-content messages dropped",
      same(finalizeWire([{ role: "user", content: "a" }, { role: "user", content: "b" }]), [
        { role: "user", content: "a" },
        { role: "user", content: "b" },
      ]) &&
        finalizeWire([{ role: "user", content: "  " }, { role: "assistant", content: "keep" }]).length === 1
    );
  } finally {
    await db.agentRun.delete({ where: { id: runId } }).catch(() => undefined);
    const msgLeft = await db.agentMessage.count({ where: { runId } });
    const sumLeft = await db.contextSummary.count({ where: { runId } });
    check("cascade delete removed harness transcript rows", msgLeft === 0, `left=${msgLeft}`);
    check("cascade delete removed harness summary rows", sumLeft === 0, `left=${sumLeft}`);
    await db.$disconnect();
  }

  console.log(`P2-C: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} (${checks} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("P2-C: harness error:", e);
  process.exit(1);
});
