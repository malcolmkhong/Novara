// ---------------------------------------------------------------------------
// Novara AI — Stage A verification (Phase 1, canonical transcript + lease).
//
// Exercises src/lib/agent/messages.ts against the live SQLite DB with ZERO
// GLM calls (no token burn): lease claim/renew/verify/steal/fencing, seq
// allocation + ordering, the unique-index backstop, and stateJson
// checkpoints. Everything runs on a THROWAWAY AgentRun row that is deleted
// at the end (AgentMessage rows cascade-delete with it).
//
// Usage: bun scripts/verify-stage-a.ts
// ---------------------------------------------------------------------------

import { PrismaClient, Prisma } from "@prisma/client";
import {
  LEASE_STALE_MS,
  LeaseLostError,
  appendAgentMessage,
  claimLease,
  leaseIsAlive,
  loadConversation,
  parseRunLoopState,
  readLoopState,
  releaseLease,
  renewLease,
  verifyLease,
  writeLoopState,
  type RunLoopState,
} from "../src/lib/agent/messages";

const db = new PrismaClient();

const TEST_NOVEL_ID = "cmw1mldiz001qqiv8vc2ewluk";
const VERIFY_CONV = "stage-a-verify";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`STAGE-A: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  // --- fixture: throwaway run on the test novel (create if missing) -------
  let novel = await db.novel.findUnique({ where: { id: TEST_NOVEL_ID }, select: { id: true } });
  if (!novel) {
    novel = await db.novel.create({
      data: { title: "[stage-a-verify] scratch novel", genre: "test" },
      select: { id: true },
    });
  }
  const run = await db.agentRun.create({
    data: { novelId: novel.id, goal: "[stage-a-verify] lease + transcript harness", status: "completed" },
    select: { id: true },
  });
  const runId = run.id;

  try {
    // --- 1. lease claim / double-claim / renew / verify --------------------
    const leaseA = await claimLease(runId);
    check("claimLease on free lease succeeds", !!leaseA);
    check("leaseIsAlive after claim", await leaseIsAlive(runId));

    const leaseB = await claimLease(runId);
    check("second claimLease while lease fresh is REFUSED", leaseB === null);

    check("renewLease by owner succeeds", await renewLease(runId, leaseA!));
    check("verifyLease by owner succeeds", await verifyLease(runId, leaseA!));

    // --- 2. stale steal + epoch fencing ------------------------------------
    const beforeEpoch = leaseA!.epoch;
    await db.agentRun.update({
      where: { id: runId },
      data: { leaseHeartbeatAt: new Date(Date.now() - LEASE_STALE_MS - 1000) },
    });
    const leaseC = await claimLease(runId);
    check("claimLease on STALE lease succeeds", !!leaseC);
    check("epoch incremented on steal", leaseC!.epoch === beforeEpoch + 1, `${beforeEpoch} -> ${leaseC!.epoch}`);

    const fencedWrite = await writeLoopState(runId, leaseA!, {
      phase: "leading", turnsUsed: 99, taskCounter: 0, delegateCount: 0,
      claimed: {}, issues: [], qcRepairs: {}, impactReport: null, wrapUpGranted: false,
    });
    check("STALE owner's stateJson write is FENCED OUT (false)", fencedWrite === false);

    let appendRejected = false;
    try {
      await appendAgentMessage({
        runId, conversationId: VERIFY_CONV, agent: "atlas", role: "user",
        kind: "resume_note", content: "stale owner must not append", lease: leaseA!,
      });
    } catch (e) {
      appendRejected = e instanceof LeaseLostError;
    }
    check("STALE owner's transcript append throws LeaseLostError", appendRejected);

    // --- 3. transcript append + ordering + seq backstop ---------------------
    for (const [i, kind] of ["envelope", "reply", "tool_results"].entries()) {
      await appendAgentMessage({
        runId, conversationId: VERIFY_CONV, taskId: null, agent: "atlas",
        role: kind === "reply" ? "assistant" : "user",
        kind: kind as "envelope" | "reply" | "tool_results",
        content: `msg ${i + 1} (${kind}) — full verbatim content, 未截断`,
        lease: leaseC!,
      });
    }
    const conv = await loadConversation(runId, VERIFY_CONV);
    check("loadConversation returns 3 rows in seq order", conv.length === 3 && conv[0].content.startsWith("msg 1") && conv[2].content.startsWith("msg 3"), `n=${conv.length}`);

    let uniqueHeld = false;
    try {
      await db.agentMessage.create({
        data: { runId, conversationId: VERIFY_CONV, agent: "atlas", role: "user", seq: 1, content: "duplicate seq", kind: "reply" },
      });
    } catch (e) {
      uniqueHeld = e instanceof Prisma.PrismaClientKnownRequestError && (e as Prisma.PrismaClientKnownRequestError).code === "P2002";
    }
    check("duplicate seq is REJECTED by unique index (P2002)", uniqueHeld);

    // --- 4. stateJson checkpoint round-trip ---------------------------------
    const state: RunLoopState = {
      phase: "post-impact", turnsUsed: 5, taskCounter: 3, delegateCount: 3,
      claimed: { chaptersWritten: 2 }, issues: ["Task 1 failed: no verified write"],
      qcRepairs: { "3": 1 }, impactReport: "impact text 中文", wrapUpGranted: false,
    };
    check("writeLoopState by CURRENT owner succeeds", await writeLoopState(runId, leaseC!, state));
    const readBack = await readLoopState(runId);
    check("readLoopState round-trips exactly",
      !!readBack &&
      readBack.turnsUsed === 5 && readBack.taskCounter === 3 && readBack.delegateCount === 3 &&
      readBack.claimed.chaptersWritten === 2 && readBack.issues.length === 1 &&
      readBack.qcRepairs["3"] === 1 && readBack.impactReport === "impact text 中文" &&
      readBack.phase === "post-impact");
    check("parseRunLoopState(null) → null (fresh-run semantics)", parseRunLoopState(null) === null);

    // --- 5. graceful release -------------------------------------------------
    await releaseLease(runId, leaseC!);
    const freed = await claimLease(runId);
    check("releaseLease frees the lease for a new claim", !!freed);
    await releaseLease(runId, freed!);

    // --- 6. message count for this conversation ------------------------------
    const count = await db.agentMessage.count({ where: { runId, conversationId: VERIFY_CONV } });
    check("exactly 3 transcript rows persisted (no dupes from retries)", count === 3, `count=${count}`);
  } finally {
    // --- cleanup: run delete cascades AgentMessage rows ---------------------
    await db.agentRun.delete({ where: { id: runId } }).catch(() => undefined);
    const leftovers = await db.agentMessage.count({ where: { conversationId: VERIFY_CONV } });
    check("cascade delete removed all transcript rows", leftovers === 0);
    await db.$disconnect();
  }

  console.log(`STAGE-A: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("STAGE-A: harness error:", e);
  process.exit(1);
});
