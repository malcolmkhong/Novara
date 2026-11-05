// Stage B verification — deterministic wrap-up reconciliation (ZERO GLM).
// Synthetic run: turnsUsed=22, wrapUpGranted=true, 1 done task + 1 in_progress,
// one committed create_chapter event, one chapter with a blocking review.
// POST /resume must reconcile from the DB and return the report in-response.
import { db } from "../src/lib/db";

const NOVEL = "cmw1mldiz001qqiv8vc2ewluk";
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass += 1; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const run = await db.agentRun.create({
  data: { novelId: NOVEL, goal: "[stage-b wrap-up reconciliation harness]", mode: "full_access", status: "running", modelId: "glm-4-flash" },
});
const chapter = await db.chapter.create({
  data: { novelId: NOVEL, index: 950, title: "[wrap-up probe chapter]", content: "内容。", wordCount: 3, status: "draft" },
});
await db.agentEvent.create({
  data: { runId: run.id, kind: "write", summary: "Created Chapter 950 (harness)", payload: JSON.stringify({ artifact: "chapter", chapterId: chapter.id, index: 950, words: 3, op: "create_chapter", title: "[wrap-up probe chapter]" }) },
});
await db.chapterReview.create({ data: { novelId: NOVEL, chapterId: chapter.id, issueCount: 3, blockingCount: 2, issuesJson: "[]", source: "agent" } });
const tDone = await db.agentTask.create({ data: { runId: run.id, key: "Task 1", assignee: "sage", title: "write it", status: "done", order: 1 } });
const tStuck = await db.agentTask.create({ data: { runId: run.id, key: "Task 2", assignee: "prism", title: "certify it", status: "in_progress", order: 2 } });
await db.agentRun.update({
  where: { id: run.id },
  data: { stateJson: JSON.stringify({ phase: "wrap-up", turnsUsed: 22, taskCounter: 2, delegateCount: 2, claimed: { chaptersWritten: 1 }, issues: [], qcRepairs: {}, impactReport: null, wrapUpGranted: true }) },
});

const res = await fetch(`http://localhost:3000/api/agent/runs/${run.id}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const body = await res.json();
console.log("HTTP", res.status, JSON.stringify(body, null, 1).slice(0, 1200));

check("resume returns 200 with reconciled report (in-response)", res.status === 200 && body.reconciled === true && !!body.report);
check("status = failed (a task remained in_progress)", body.status === "failed", `status=${body.status}`);
check("verified counters event-derived (1 chapter, 3 words)", body.report?.verified?.chaptersWritten === 1 && body.report?.verified?.words === 3, JSON.stringify(body.report?.verified));
check("in_progress task flipped failed", (await db.agentTask.findUnique({ where: { id: tStuck.id } }))?.status === "failed");
check("done task untouched", (await db.agentTask.findUnique({ where: { id: tDone.id } }))?.status === "done");
check("blocking review surfaced in blockingIssues", JSON.stringify(body.report?.blockingIssues ?? []).includes("blocking issue(s) unresolved"));
check("run row closed with finalReport", (await db.agentRun.findUnique({ where: { id: run.id } }))?.status === "failed" && !!(await db.agentRun.findUnique({ where: { id: run.id } }))?.finalReport);
check("lease released after reconciliation", (await db.agentRun.findUnique({ where: { id: run.id } }))?.leaseOwner === null);

// Second resume must 409 (already finished).
const res2 = await fetch(`http://localhost:3000/api/agent/runs/${run.id}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
check("second resume → 409 already finished", res2.status === 409);

// Negative guard: a wrap-up NOT yet granted must NOT take this path (it would
// need a live executor) — verify the route 202s only for the flag+budget combo.
// (Checked implicitly by the live run below; here verify flag-absent run:
const run2 = await db.agentRun.create({
  data: { novelId: NOVEL, goal: "[no wrap-up flag]", mode: "full_access", status: "running", modelId: "glm-4-flash",
    stateJson: JSON.stringify({ phase: "leading", turnsUsed: 22, taskCounter: 0, delegateCount: 0, claimed: {}, issues: [], qcRepairs: {}, impactReport: null, wrapUpGranted: false }) },
});
const res3 = await fetch(`http://localhost:3000/api/agent/runs/${run2.id}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
const body3 = await res3.json();
check("turnsUsed=22 but wrapUpGranted=false → NOT reconciled (executor path, 202)", res3.status === 202 && body3.reconciled === undefined, `HTTP ${res3.status} epoch=${body3.leaseEpoch}`);
// That resume started a REAL executor (fresh run, no state) — cancel it before it burns tokens.
const cancel = await fetch(`http://localhost:3000/api/agent/runs/${run2.id}/cancel`, { method: "POST" });
check("canceled the accidentally-started executor", cancel.status === 200);

// cleanup
await db.agentEvent.deleteMany({ where: { runId: { in: [run.id, run2.id] } } });
await db.agentMessage.deleteMany({ where: { runId: { in: [run.id, run2.id] } } });
await db.agentTask.deleteMany({ where: { runId: { in: [run.id, run2.id] } } });
await db.chapterReview.deleteMany({ where: { chapterId: chapter.id } });
await db.agentRun.deleteMany({ where: { id: { in: [run.id, run2.id] } } });
await db.chapter.delete({ where: { id: chapter.id } });
console.log(`\nRESULT: ${pass} pass / ${fail} fail (cleanup done)`);
await db.$disconnect();
process.exit(fail === 0 ? 0 : 1);
