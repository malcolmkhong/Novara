// Stage B fencing drill — simulate a takeover by bumping the lease epoch and
// clearing the owner (exactly what a legitimate new claim leaves behind).
// The live executor's next fenced write/renewal must then abort (count=0).
import { db } from "../src/lib/db";
const runId = process.argv[2];
if (!runId) throw new Error("usage: bun run scripts/stage-b-drill.ts <runId>");
const before = await db.agentRun.findUnique({ where: { id: runId }, select: { leaseOwner: true, leaseEpoch: true, status: true } });
console.log("BEFORE DRILL:", JSON.stringify(before));
const r = await db.agentRun.update({
  where: { id: runId },
  data: { leaseOwner: null, leaseEpoch: { increment: 1 }, leaseHeartbeatAt: null },
});
console.log("AFTER DRILL:", JSON.stringify({ leaseOwner: r.leaseOwner, leaseEpoch: r.leaseEpoch, status: r.status }));
await db.$disconnect();
