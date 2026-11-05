// Stage B heal verification — zero GLM.
// (1) POSITIVE: sacrificial running run with lease gone + events backdated
//     beyond sse.staleRunMs (raw SQL) → heal must mark it failed.
// (2) DUAL-CONDITION DISCRIMINATION: same run but with a FRESH heartbeat and
//     stale events → heal must skip it (the old event-age-only bug).
import { db, Prisma } from "../src/lib/db";
import { healStaleRuns } from "../src/lib/agent/runtime";

const NOVEL = "cmw1mldiz001qqiv8vc2ewluk";
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass += 1; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

// --- (2) fresh lease + stale events => SKIP ---------------------------------
const rAlive = await db.agentRun.create({ data: { novelId: NOVEL, goal: "[heal-drill alive]", mode: "full_access", status: "running", modelId: "glm-4-flash", leaseOwner: "heal-drill-owner", leaseHeartbeatAt: new Date() } });
await db.agentEvent.create({ data: { runId: rAlive.id, kind: "message", summary: "[heal drill]" } });
await db.$executeRawUnsafe(`UPDATE AgentEvent SET createdAt = datetime('now', '-30 minutes') WHERE runId = '${rAlive.id}'`);
await healStaleRuns();
const after1 = await db.agentRun.findUnique({ where: { id: rAlive.id } });
check("STALE events + LIVE lease => heal SKIPS (lease-liveness check)", after1?.status === "running", `status=${after1?.status}`);

// --- (1) stale lease + stale events => HEALED --------------------------------
await db.agentRun.update({ where: { id: rAlive.id }, data: { leaseOwner: null, leaseHeartbeatAt: null } });
await healStaleRuns();
const after2 = await db.agentRun.findUnique({ where: { id: rAlive.id } });
check("STALE events + NO lease => heal marks failed", after2?.status === "failed", `status=${after2?.status}`);

// cleanup
await db.agentEvent.deleteMany({ where: { runId: rAlive.id } });
await db.agentTask.deleteMany({ where: { runId: rAlive.id } });
await db.agentMessage.deleteMany({ where: { runId: rAlive.id } });
await db.agentRun.delete({ where: { id: rAlive.id } });
console.log(`\nRESULT: ${pass} pass / ${fail} fail`);
await db.$disconnect();
process.exit(fail === 0 ? 0 : 1);
