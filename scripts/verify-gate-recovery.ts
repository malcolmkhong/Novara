// ---------------------------------------------------------------------------
// Novara AI — gate-recovery verification (audit H2/H3 fix).
//
// ZERO model calls. Drives the EXPORTED production seams (decideApproval,
// pauseForApproval) against fixture rows — nothing is re-implemented here.
//
// H2 — approval-wait timeout must NOT leave a zombie gate:
//   T1. the real pauseForApproval timeout path (budget temporarily lowered to
//       the schema minimum, restored byte-exact afterwards) flips the run to
//       paused, blocks the task, and emits a visible message event.
//   T2. decideApproval on the timed-out (paused) run REFUSES the commit —
//       nothing is written, status stays paused.
//   T3. the resume seam accepts a paused run with no live executor and no
//       stranded gate (claims the lease; caller releases it — no executor is
//       started by the seam itself).
//
// H3 — author-rejected paused runs must be resumable, not cancel-only:
//   R1. decideApproval(reject) → task blocked, run paused, nothing written.
//   R2. the resume seam accepts that paused run too.
//   R3. a paused run WITH a live executor lease is still refused (no double
//       executor).
//
// Fixture discipline: one throwaway Novel ("GATE-RECOVERY harness" marker);
// cleanup deletes novel (cascades runs/tasks/events/chapters) and asserts
// counts return to pre-run shape. budgets.yaml is restored BYTE-EXACT in a
// finally block even on failure.
// Usage: bun scripts/verify-gate-recovery.ts
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { decideApproval, pauseForApproval, resumePausedRun } from "../src/lib/agent/runtime";
import { claimLease, releaseLease } from "../src/lib/agent/messages";

const db = new PrismaClient();
const YAML_PATH = "agent/config/budgets.yaml";
const MARKER = "GATE-RECOVERY harness";

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`GATE: [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function mkFixture(status: string) {
  const novel = await db.novel.create({ data: { title: MARKER, genre: "harness", synopsis: "throwaway" } });
  const run = await db.agentRun.create({
    data: { novelId: novel.id, goal: "gate-recovery fixture", mode: "approval", status, leaseOwner: null, leaseEpoch: 1 } as never,
  });
  const task = await db.agentTask.create({
    data: { runId: run.id, key: "Task 1", assignee: "sage", title: "Write chapter 1", status: "needs_approval", artifactType: "chapter", order: 1 },
  });
  const payload = {
    pending: true,
    action: "create_chapter",
    kind: "new_chapter",
    taskId: task.id,
    taskKey: task.key,
    novelId: novel.id,
    index: 1,
    chapterId: null,
    title: "Fixture Chapter",
    targetLabel: "Chapter 1",
    wordCount: 10,
    existingWords: 0,
    content: "Fixture draft content — never committed by this harness.",
  };
  await db.agentEvent.create({
    data: { runId: run.id, taskId: task.id, actor: "sage", kind: "write", summary: "pending write fixture", payload: JSON.stringify(payload) },
  });
  return { novel, run, task, payload };
}

async function main() {
  const preNovels = await db.novel.count();
  const preRuns = await db.agentRun.count();
  const preUsage = await db.usageCall.count();
  const yamlOriginal = readFileSync(YAML_PATH, "utf8");
  const createdNovelIds: string[] = [];

  try {
    // ------------------------------------------------------------------ T1 ---
    // Real timeout path: lower approvalWaitMs to the schema minimum (30s),
    // drive the shipped pauseForApproval, and require an honest terminal flip.
    writeFileSync(YAML_PATH, yamlOriginal.replace(/approvalWaitMs:\s*\d+/, "approvalWaitMs: 30000"), "utf8");
    const t1 = await mkFixture("running");
    createdNovelIds.push(t1.novel.id);
    // Simulate the gate having been opened by the executor.
    await db.agentRun.update({ where: { id: t1.run.id }, data: { status: "awaiting_approval" } });
    const controller = new AbortController();
    const gate = await pauseForApproval({
      payload: t1.payload as never,
      pendingSummary: "fixture pending write",
      runId: t1.run.id,
      taskId: t1.task.id,
      measured: { chaptersWritten: 0, chaptersUpdated: 0, words: 0, finalizes: 0, exportsRun: 0 } as never,
      signal: controller.signal,
    });
    const t1Run = await db.agentRun.findUnique({ where: { id: t1.run.id } });
    const t1Task = await db.agentTask.findUnique({ where: { id: t1.task.id } });
    const t1Events = await db.agentEvent.findMany({ where: { runId: t1.run.id, kind: "message" } });
    check("T1 timeout returns stopped", gate.stopped === true, `feed=${gate.feed}`);
    check("T1 timeout flips run to paused (no zombie awaiting_approval)", t1Run?.status === "paused", `status=${t1Run?.status}`);
    check("T1 timeout blocks the gated task", t1Task?.status === "blocked", `status=${t1Task?.status}`);
    check("T1 timeout emits a visible message naming the timeout", t1Events.some((e) => /timed out|timeout/i.test(e.summary)), `messages=${t1Events.length}`);
    check("T1 nothing was committed", (await db.chapter.count({ where: { novelId: t1.novel.id } })) === 0);

    // ------------------------------------------------------------------ T2 ---
    // Late approve on the timed-out run must refuse — never commit into a run
    // with no executor, never flip it back to a fake "running".
    let refused = false;
    try {
      await decideApproval(t1.run.id, t1.task.id, "approve");
    } catch {
      refused = true;
    }
    const t2Run = await db.agentRun.findUnique({ where: { id: t1.run.id } });
    check("T2 late approve on timed-out run is refused", refused);
    check("T2 run stays paused after refused approve", t2Run?.status === "paused", `status=${t2Run?.status}`);
    check("T2 still nothing committed", (await db.chapter.count({ where: { novelId: t1.novel.id } })) === 0);

    // ------------------------------------------------------------------ T3 ---
    // The resume seam accepts the timed-out paused run (no live lease, no
    // stranded gate). Claim happens inside the seam; release it here — no
    // executor is started by the seam itself.
    const t3 = await resumePausedRun(t1.run.id);
    check("T3 resume seam accepts timed-out paused run", t3.ok === true, JSON.stringify(t3));
    if (t3.ok) await releaseLease(t1.run.id, t3.lease);

    // ------------------------------------------------------------------ R1 ---
    const r1 = await mkFixture("awaiting_approval");
    createdNovelIds.push(r1.novel.id);
    const detail = await decideApproval(r1.run.id, r1.task.id, "reject");
    const r1Task = await db.agentTask.findUnique({ where: { id: r1.task.id } });
    check("R1 reject → run paused", detail.run.status === "paused", `status=${detail.run.status}`);
    check("R1 reject → task blocked", r1Task?.status === "blocked", `status=${r1Task?.status}`);
    check("R1 reject writes nothing", (await db.chapter.count({ where: { novelId: r1.novel.id } })) === 0);

    // ------------------------------------------------------------------ R2 ---
    const r2 = await resumePausedRun(r1.run.id);
    check("R2 resume seam accepts author-rejected paused run", r2.ok === true, JSON.stringify(r2));
    if (r2.ok) {
      const r2Run = await db.agentRun.findUnique({ where: { id: r1.run.id } });
      check("R2 resume flips the run back to running", r2Run?.status === "running", `status=${r2Run?.status}`);
      await releaseLease(r1.run.id, r2.lease);
    }

    // ------------------------------------------------------------------ R3 ---
    // A paused run whose lease is STILL alive must be refused (a live
    // executor owns it — resuming would double-write). Put the run back to
    // paused (R2 flipped it) and claim a live lease to simulate that shape.
    await db.agentRun.update({ where: { id: r1.run.id }, data: { status: "paused" } });
    const liveLease = await claimLease(r1.run.id);
    check("R3 setup: live lease claimed", liveLease !== null);
    const r3 = await resumePausedRun(r1.run.id);
    check("R3 resume refused while a live executor holds the lease", r3.ok === false, JSON.stringify(r3));
    if (liveLease) await releaseLease(r1.run.id, liveLease);

    // ------------------------------------------------------------------ Z ---
    check("Z zero-spend proof: no UsageCall rows created", (await db.usageCall.count()) === preUsage);
  } finally {
    // Restore budgets BYTE-EXACT before anything else can read the cache again.
    writeFileSync(YAML_PATH, yamlOriginal, "utf8");
    for (const id of createdNovelIds) {
      await db.novel.delete({ where: { id } }).catch(() => {});
    }
    const postNovels = await db.novel.count();
    const postRuns = await db.agentRun.count();
    check("Cleanup: novel/run counts back to pre-run shape", postNovels === preNovels && postRuns === preRuns, `novels ${preNovels}->${postNovels}, runs ${preRuns}->${postRuns}`);
    check("Cleanup: budgets.yaml restored byte-exact", readFileSync(YAML_PATH, "utf8") === yamlOriginal);
  }

  console.log(`GATE: ${checks - failures}/${checks} checks passed${failures === 0 ? " — GATE-RECOVERY GREEN" : ` — ${failures} FAILED`}`);
  await db.$disconnect();
  if (failures > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("GATE: harness crashed:", e);
  await db.$disconnect();
  process.exit(1);
});
