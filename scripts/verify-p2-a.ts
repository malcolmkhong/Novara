// ---------------------------------------------------------------------------
// Novara AI — P2-a verification (Phase 2, inert compaction groundwork).
//
// ZERO GLM calls. Asserts that the Phase 2 additive footprint (one table
// ContextSummary, one column AgentRun.contextSpec, one config section
// budgets.contextCompaction) landed correctly and is INERT: nothing in any
// live path writes summary rows, canonical transcript replay is untouched,
// and the compaction config ships disabled. The absorb-chain supersede /
// per-cut idempotence shapes exercised here on fixture rows are the same
// shapes the P2-c leaseholder writer will produce (agent-ctx/p2-design.md
// §2). NOTE: the "live DB has zero summary rows" check is the P2-a inertness
// proof and is expected to be superseded when P2-c introduces the real
// writer.
//
// Usage: bun scripts/verify-p2-a.ts   (run scripts/verify-stage-a.ts first —
// it must stay ALL GREEN at every Phase 2 stage)
// ---------------------------------------------------------------------------

import { PrismaClient, Prisma } from "@prisma/client";
import {
  appendAgentMessages,
  claimLease,
  loadConversation,
  releaseLease,
} from "../src/lib/agent/messages";
import { getBudgets } from "../src/lib/novara/content";

const db = new PrismaClient();

const TEST_NOVEL_ID = "cmw1mldiz001qqiv8vc2ewluk";
const VERIFY_CONV = "p2-a-verify";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P2-A: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  // --- 0. inertness: no live path writes summary rows yet ------------------
  const preExisting = await db.contextSummary.count();
  check("live DB has ZERO ContextSummary rows (compaction not wired yet)", preExisting === 0, `count=${preExisting}`);

  // --- fixture: throwaway run on the test novel (create if missing) --------
  let novel = await db.novel.findUnique({ where: { id: TEST_NOVEL_ID }, select: { id: true } });
  if (!novel) {
    novel = await db.novel.create({
      data: { title: "[p2-a-verify] scratch novel", genre: "test" },
      select: { id: true },
    });
  }
  const run = await db.agentRun.create({
    data: { novelId: novel.id, goal: "[p2-a-verify] compaction groundwork harness", status: "completed" },
    select: { id: true },
  });
  const runId = run.id;

  try {
    // --- 1. contextSpec column: defaults to "v1" ---------------------------
    const fresh = await db.agentRun.findUnique({
      where: { id: runId },
      select: { contextSpec: true },
    });
    check("new AgentRun.contextSpec defaults to 'v1'", fresh?.contextSpec === "v1", `got=${fresh?.contextSpec}`);

    // --- 2. canonical transcript replay is untouched by the new table ------
    const lease = await claimLease(runId);
    check("lease claimed for fixture conversation", !!lease);
    await appendAgentMessages(lease!, [
      { runId, conversationId: VERIFY_CONV, taskId: null, agent: "atlas", role: "assistant", kind: "system_note", content: "system card (verbatim)" },
      { runId, conversationId: VERIFY_CONV, taskId: null, agent: "atlas", role: "user", kind: "envelope", content: "AUTHOR GOAL: verify replay integrity" },
      { runId, conversationId: VERIFY_CONV, taskId: null, agent: "atlas", role: "assistant", kind: "reply", content: "turn reply — full verbatim 内容, 未截断" },
      { runId, conversationId: VERIFY_CONV, taskId: null, agent: "atlas", role: "user", kind: "tool_results", content: "TOOL RESULTS:\n1. ok" },
      { runId, conversationId: VERIFY_CONV, taskId: null, agent: "atlas", role: "user", kind: "resume_note", content: "[resume] marker row" },
    ]);
    const conv = await loadConversation(runId, VERIFY_CONV);
    check(
      "loadConversation returns all 5 rows in seq order, verbatim (incl. consecutive user rows)",
      conv.length === 5 &&
        conv[0].kind === "system_note" &&
        conv[1].kind === "envelope" &&
        conv[2].content === "turn reply — full verbatim 内容, 未截断" &&
        conv[3].role === "user" && conv[4].role === "user",
      `n=${conv.length}`
    );
    // envelope boundary for this conversation is seq 2 → compactable cover starts at 3
    const envelopeSeq = 2;

    // --- 3. ContextSummary inert round-trip ---------------------------------
    const s1 = await db.contextSummary.create({
      data: {
        runId,
        conversationId: VERIFY_CONV,
        taskId: null,
        agent: "atlas",
        fromSeq: envelopeSeq + 1,
        toSeq: 14,
        summary: "[CONTEXT SUMMARY] absorbed rows 3..14 — fixture text 中文",
        leaseEpoch: lease!.epoch,
      },
    });
    const s1back = await db.contextSummary.findUnique({ where: { id: s1.id } });
    check(
      "summary row round-trips verbatim (cover, text, epoch, active)",
      !!s1back &&
        s1back.fromSeq === 3 && s1back.toSeq === 14 &&
        s1back.summary === "[CONTEXT SUMMARY] absorbed rows 3..14 — fixture text 中文" &&
        s1back.leaseEpoch === lease!.epoch &&
        s1back.supersededAt === null,
      `from=${s1back?.fromSeq} to=${s1back?.toSeq}`
    );

    // --- 4. absorb-chain: second row reaches back, supersedes the first ----
    const s2 = await db.contextSummary.create({
      data: {
        runId,
        conversationId: VERIFY_CONV,
        taskId: null,
        agent: "atlas",
        fromSeq: envelopeSeq + 1, // reaches back to the FIRST compacted seq
        toSeq: 20,
        summary: "[CONTEXT SUMMARY] absorbed (prior summary + rows 15..20) — chain link 2",
        leaseEpoch: lease!.epoch,
      },
    });
    await db.contextSummary.update({
      where: { id: s1.id },
      data: { supersededAt: new Date() },
    });
    const active = await db.contextSummary.findMany({
      where: { runId, conversationId: VERIFY_CONV, supersededAt: null },
    });
    check(
      "exactly ONE active chain head after supersede — the newest absorb row",
      active.length === 1 && active[0].id === s2.id && active[0].toSeq === 20 && active[0].fromSeq === 3,
      `active=${active.length}`
    );
    const superseded = await db.contextSummary.findUnique({ where: { id: s1.id } });
    check("prior chain link retained (auditability: originals + superseded row persist)", !!superseded?.supersededAt);

    // --- 5. per-cut idempotence: P2002 on duplicate (run, conv, toSeq) -----
    let dupRejected = false;
    try {
      await db.contextSummary.create({
        data: {
          runId,
          conversationId: VERIFY_CONV,
          taskId: null,
          agent: "atlas",
          fromSeq: 3,
          toSeq: 20, // same cut point as s2 — a crash→retry would land here
          summary: "duplicate cut — must be rejected",
        },
      });
    } catch (e) {
      dupRejected = e instanceof Prisma.PrismaClientKnownRequestError && (e as Prisma.PrismaClientKnownRequestError).code === "P2002";
    }
    check("duplicate cut point REJECTED by unique index (P2002)", dupRejected);

    // --- 6. contextCompaction config: parses, ships disabled ---------------
    const cc = getBudgets().contextCompaction;
    check(
      "contextCompaction parses from budgets.yaml with enabled=false",
      cc.enabled === false && cc.triggerTokens === 24000 && cc.tailTurns === 8 && cc.minCompactableRows === 12,
      JSON.stringify(cc)
    );
    check("compaction config is independent of contextSpec (still 'v1')", fresh?.contextSpec === "v1");

    // --- 7. no side effects on the transcript from summary writes ----------
    const postConv = await loadConversation(runId, VERIFY_CONV);
    const postCount = await db.agentMessage.count({ where: { runId, conversationId: VERIFY_CONV } });
    check("summary writes left the canonical transcript untouched", postConv.length === 5 && postCount === 5, `rows=${postCount}`);
  } finally {
    // --- cleanup: run delete cascades AgentMessage + ContextSummary --------
    await db.agentRun.delete({ where: { id: runId } }).catch(() => undefined);
    const msgLeft = await db.agentMessage.count({ where: { conversationId: VERIFY_CONV } });
    const sumLeft = await db.contextSummary.count();
    check("cascade delete removed transcript rows", msgLeft === 0, `left=${msgLeft}`);
    check("cascade delete removed summary rows", sumLeft === 0, `left=${sumLeft}`);
    await db.$disconnect();
  }

  console.log(`P2-A: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("P2-A: harness error:", e);
  process.exit(1);
});
