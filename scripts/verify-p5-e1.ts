// ---------------------------------------------------------------------------
// Novara AI — P5-e.1 verification (OPS-4 fix: guarded failure flip at executor
// loop exit). The regression set gains a NINTH harness.
//
// ZERO GLM calls — OPS-3 mock-first standing rule. This harness imports the
// production runtime module (module load is side-effect-free: no client is
// constructed, no network is touched) and drives the EXPORTED production
// seam guardedFailureFlip() — the exact function executeRun's catch now
// delegates to — against fixture AgentRun rows. Nothing is re-implemented in
// the harness; every behavioral check runs the shipped code path.
//
// Sections:
//   RC. Root cause reproduced synthetically: on a lease-RELEASED row the old
//       owner/epoch-fenced flip primitive matches ZERO rows (count=0) — the
//       dead fence that swallowed every real executor error. Then the shipped
//       guardedFailureFlip heals the SAME row.
//   A.  Stuck-at-running shape (lease released, no executor, status running):
//       guarded flip writes status=failed, persists the REAL error on the run
//       row, and emits an AgentEvent that NAMES the cause — visible in the
//       event stream, never console-only.
//   B.  awaiting_approval rows heal the same way (the gate-wait dying case).
//   C.  FENCING INVARIANT: an evicted executor (stale token) facing a LIVE
//       lease (fresh heartbeat, different owner) CANNOT flip the row — status
//       unchanged, error unchanged, zero new events. Silence is the contract.
//   D.  Still-owner corner (releaseLease itself failed): the owner/epoch CAS
//       is the strongest claim and flips directly.
//   E.  Terminal rows (completed) are never touched.
//   F.  Author-owned paused rows are never clobbered (status filter: only
//       running/awaiting_approval flip on the guarded path).
//   G.  Stale-but-OWNED rows (crashed executor's lingering lease): the
//       leaseOwner:null CAS refuses — silent, janitor's turf (healStaleRuns
//       semantics untouched; requirement #5).
//   J.  healStaleRuns untouched: source pins — the dual condition (live-lease
//       continue + stale event age) and the generic heal message are intact;
//       the janitor does not call guardedFailureFlip; executeRun's catch
//       delegates to the seam.
//   Z.  Zero-spend proof: NO UsageCall rows created (nothing reached GLM).
//
// Fixture discipline: one throwaway Novel ("P5-E.1 OPS-4 harness" marker),
// runs under it; cleanup deletes runs (events cascade) + novel and asserts
// agentRun/agentEvent/usageCall counts return to pre-run shape.
// Usage: bun scripts/verify-p5-e1.ts
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { guardedFailureFlip } from "../src/lib/agent/runtime";
import { LEASE_STALE_MS } from "../src/lib/agent/messages";

const db = new PrismaClient();

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P5E1: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const MARKER = "P5-E.1 OPS-4 harness";
const CAUSE = "timeout chain exhausted after 3 attempts (provider retry budget spent) — final persist also failed";

async function events(runId: string): Promise<number> {
  return db.agentEvent.count({ where: { runId } });
}

async function main() {
  const preRuns = await db.agentRun.count();
  const preEvents = await db.agentEvent.count();
  const preUsage = await db.usageCall.count();

  const novel = await db.novel.create({
    data: { title: MARKER, genre: "harness", synopsis: "throwaway" },
  });

  const mkRun = (goal: string, data: Record<string, unknown>) =>
    db.agentRun.create({
      data: {
        novelId: novel.id,
        goal,
        status: "running",
        leaseOwner: null,
        leaseEpoch: 4,
        ...data,
      } as never,
    });

  // ------------------------------------------------------------------ RC ---
  // The exact OPS-4 shape: executor's finally already released the lease
  // (leaseOwner=null), then the catch's owner/epoch-fenced flip matches zero
  // rows. Reproduce the dead fence with the raw primitive, then heal with the
  // shipped seam.
  const rcRun = await mkRun("RC — dead-fence reproduction", {
    leaseOwner: null,
    leaseEpoch: 4,
  });
  const rcToken = { owner: "released-executor", epoch: 4 };
  const deadFence = await db.agentRun
    .updateMany({
      where: { id: rcRun.id, leaseOwner: rcToken.owner, leaseEpoch: rcToken.epoch },
      data: { status: "failed", error: CAUSE },
    })
    .catch(() => ({ count: 0 }));
  check(
    "RC root cause reproduced: the OLD fenced flip on a released row matches ZERO rows (count=0) — this is the swallow",
    deadFence.count === 0,
    `count=${deadFence.count}`
  );
  const rcHealed = await guardedFailureFlip(rcRun.id, rcToken, CAUSE);
  const rcAfter = await db.agentRun.findUnique({ where: { id: rcRun.id } });
  check(
    "RC the shipped guardedFailureFlip heals the SAME row the dead fence refused",
    rcHealed === true && rcAfter?.status === "failed",
    `flip=${rcHealed} status=${rcAfter?.status}`
  );

  // ------------------------------------------------------------------- A ---
  const aRun = await mkRun("A — stuck-at-running synthetic", {
    leaseOwner: null,
    leaseEpoch: 2,
  });
  const aEventsBefore = await events(aRun.id);
  const aFlipped = await guardedFailureFlip(aRun.id, { owner: "gone-executor", epoch: 2 }, CAUSE);
  const aAfter = await db.agentRun.findUnique({ where: { id: aRun.id } });
  const aEvent = await db.agentEvent.findFirst({
    where: { runId: aRun.id, kind: "error" },
    orderBy: { createdAt: "desc" },
  });
  check(
    "A stuck-at-running (lease released, no executor): guarded flip writes status=failed",
    aFlipped === true && aAfter?.status === "failed",
    `flip=${aFlipped} status=${aAfter?.status}`
  );
  check(
    "A the executor's REAL error is persisted on the run row (not a generic janitor message)",
    aAfter?.error === CAUSE,
    aAfter?.error ?? "null"
  );
  check(
    "A the swallowed error is now VISIBLE in the event stream: kind=error event naming the cause",
    aEvent !== null &&
      (aEvent?.summary.includes("Run failed:") ?? false) &&
      (aEvent?.summary.includes("timeout chain exhausted") ?? false) &&
      (await events(aRun.id)) === aEventsBefore + 1,
    aEvent ? `"${aEvent.summary.slice(0, 90)}"` : "no event"
  );

  // ------------------------------------------------------------------- B ---
  const bRun = await mkRun("B — gate-wait dying case", {
    status: "awaiting_approval",
    leaseOwner: null,
    leaseEpoch: 9,
  });
  const bFlipped = await guardedFailureFlip(
    bRun.id,
    { owner: "gone-executor", epoch: 9 },
    "GLM persist failure: ledger write rejected mid-turn"
  );
  const bAfter = await db.agentRun.findUnique({ where: { id: bRun.id } });
  check(
    "B awaiting_approval row heals the same way: failed + real message + event",
    bFlipped === true && bAfter?.status === "failed" && (bAfter?.error ?? "").includes("persist failure"),
    `flip=${bFlipped} status=${bAfter?.status}`
  );

  // ------------------------------------------------------------------- C ---
  // THE fencing invariant: evicted executor (stale token) vs LIVE lease
  // (fresh heartbeat, different owner). Must stay silent — the holder owns
  // the row.
  const cRun = await mkRun("C — evicted executor vs live lease", {
    leaseOwner: "holder-executor",
    leaseHeartbeatAt: new Date(),
    leaseEpoch: 7,
  });
  const cEventsBefore = await events(cRun.id);
  const cFlipped = await guardedFailureFlip(
    cRun.id,
    { owner: "evicted-executor", epoch: 6 },
    "the evicted executor's dying words must NEVER land"
  );
  const cAfter = await db.agentRun.findUnique({ where: { id: cRun.id } });
  check(
    "C evicted executor CANNOT flip a live-lease row: status still running",
    cFlipped === false && cAfter?.status === "running",
    `flip=${cFlipped} status=${cAfter?.status}`
  );
  check(
    "C live-lease row untouched end-to-end: error unchanged, ZERO new events (silence is the contract)",
    cAfter?.error === null && (await events(cRun.id)) === cEventsBefore,
    `error=${cAfter?.error} events ${cEventsBefore}->${await events(cRun.id)}`
  );

  // ------------------------------------------------------------------- D ---
  // Still-owner corner: releaseLease itself failed, executor still holds the
  // lease — the owner/epoch CAS is the strongest claim and flips directly.
  const dRun = await mkRun("D — still-owner fenced flip", {
    leaseOwner: "owner-executor",
    leaseHeartbeatAt: new Date(),
    leaseEpoch: 3,
  });
  const dFlipped = await guardedFailureFlip(
    dRun.id,
    { owner: "owner-executor", epoch: 3 },
    "loop error while still owning the lease"
  );
  const dAfter = await db.agentRun.findUnique({ where: { id: dRun.id } });
  check(
    "D still-owner corner: owner/epoch CAS flips directly (strongest claim preserved)",
    dFlipped === true && dAfter?.status === "failed",
    `flip=${dFlipped} status=${dAfter?.status}`
  );

  // ------------------------------------------------------------------- E ---
  const eRun = await mkRun("E — terminal row", { status: "completed" });
  const eEventsBefore = await events(eRun.id);
  const eFlipped = await guardedFailureFlip(eRun.id, null, "must not touch terminal rows");
  const eAfter = await db.agentRun.findUnique({ where: { id: eRun.id } });
  check(
    "E terminal row (completed) never touched: flip refused, status intact, zero events",
    eFlipped === false && eAfter?.status === "completed" && (await events(eRun.id)) === eEventsBefore,
    `flip=${eFlipped} status=${eAfter?.status}`
  );

  // ------------------------------------------------------------------- F ---
  const fRun = await mkRun("F — author-owned paused row", { status: "paused" });
  const fFlipped = await guardedFailureFlip(
    fRun.id,
    { owner: "gone-executor", epoch: 1 },
    "must not clobber the author's pause decision"
  );
  const fAfter = await db.agentRun.findUnique({ where: { id: fRun.id } });
  check(
    "F author-owned paused row not clobbered: guarded path only flips running/awaiting_approval",
    fFlipped === false && fAfter?.status === "paused",
    `flip=${fFlipped} status=${fAfter?.status}`
  );

  // ------------------------------------------------------------------- G ---
  // Crashed executor's LINGERING lease: heartbeat stale (alive=false by age)
  // but leaseOwner is still SET. The leaseOwner:null CAS refuses — the row is
  // the janitor's turf (healStaleRuns semantics untouched, requirement #5).
  const gRun = await mkRun("G — stale-but-owned lingering lease", {
    leaseOwner: "crashed-executor",
    leaseHeartbeatAt: new Date(Date.now() - LEASE_STALE_MS * 3),
    leaseEpoch: 5,
  });
  const gEventsBefore = await events(gRun.id);
  const gFlipped = await guardedFailureFlip(
    gRun.id,
    { owner: "someone-else-entirely", epoch: 4 },
    "must not write over a recorded owner"
  );
  const gAfter = await db.agentRun.findUnique({ where: { id: gRun.id } });
  check(
    "G stale-but-OWNED row: leaseOwner:null CAS refuses even when aliveness says dead — janitor's turf untouched",
    gFlipped === false && gAfter?.status === "running" && gAfter?.leaseOwner === "crashed-executor",
    `flip=${gFlipped} status=${gAfter?.status} owner=${gAfter?.leaseOwner}`
  );
  check(
    "G silent means silent: zero new events on the refused row",
    (await events(gRun.id)) === gEventsBefore,
    `events ${gEventsBefore}->${await events(gRun.id)}`
  );

  // ------------------------------------------------------------------- J ---
  const runtimeSrc = readFileSync("src/lib/agent/runtime.ts", "utf8");
  const healStart = runtimeSrc.indexOf("export async function healStaleRuns");
  const healEnd = runtimeSrc.indexOf("/**", healStart);
  const healBody = healStart >= 0 ? runtimeSrc.slice(healStart, healEnd) : "";
  check(
    "J healStaleRuns untouched (requirement #5): dual condition intact — live-lease continue + stale event age",
    healBody.includes("if (await leaseIsAlive(run.id)) continue;") &&
      healBody.includes("staleRunMs") &&
      healBody.includes("Runtime restarted or the run stalled"),
    `heal body ${healBody.length} chars`
  );
  check(
    "J the janitor does NOT route through the guarded seam (15-min behavior byte-unchanged)",
    !healBody.includes("guardedFailureFlip"),
    "no seam reference in healStaleRuns"
  );
  check(
    "J executeRun's catch delegates to the exported production seam (harness tested exactly what ships)",
    runtimeSrc.includes("await guardedFailureFlip(runId, lease, message);"),
    "catch → guardedFailureFlip(runId, lease, message)"
  );

  // ------------------------------------------------------------------- Z ---
  check(
    "Z zero-spend proof: NO UsageCall rows were created by this harness (OPS-3 mock-first held)",
    (await db.usageCall.count()) === preUsage,
    `usageCall ${preUsage}->${await db.usageCall.count()}`
  );

  // -------------------------------------------------------------- Cleanup ---
  await db.agentRun.deleteMany({ where: { novelId: novel.id } });
  await db.novel.delete({ where: { id: novel.id } });
  const postRuns = await db.agentRun.count();
  const postEvents = await db.agentEvent.count();
  check(
    "Cleanup: fixture runs + events fully removed, DB back to pre-run shape",
    postRuns === preRuns && postEvents === preEvents,
    `runs ${preRuns}->${postRuns}, events ${preEvents}->${postEvents}`
  );

  console.log(
    `P5E1: ${failures === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"} (${checks} checks)`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error("P5E1: harness crashed:", error);
  await db.$disconnect();
  process.exit(1);
});
