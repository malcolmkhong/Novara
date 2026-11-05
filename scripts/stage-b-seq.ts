// Stage B evidence — AgentMessage seq integrity + lease state + duplicate check.
import { db } from "../src/lib/db";
const runId = process.argv[2];
if (!runId) throw new Error("usage: bun run scripts/stage-b-seq.ts <runId>");
const run = await db.agentRun.findUnique({ where: { id: runId }, select: { status: true, leaseOwner: true, leaseEpoch: true, stateJson: true, finalReport: true, error: true } });
console.log("RUN:", JSON.stringify(run, null, 1));
const msgs = await db.agentMessage.findMany({ where: { runId }, orderBy: [{ conversationId: "asc" }, { seq: "asc" }], select: { conversationId: true, seq: true, kind: true, role: true, agent: true } });
const byConv = new Map<string, number[]>();
for (const m of msgs) {
  if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, []);
  byConv.get(m.conversationId)!.push(m.seq);
}
let allGapless = true;
for (const [conv, seqs] of byConv) {
  const expected = Array.from({ length: seqs.length }, (_, i) => i + 1);
  const gapless = seqs.every((s, i) => s === expected[i]);
  const dupFree = new Set(seqs).size === seqs.length;
  if (!gapless || !dupFree) allGapless = false;
  console.log(`conv=${conv} rows=${seqs.length} seqs=${seqs.join(",")} gapless=${gapless} dupFree=${dupFree}`);
}
console.log("ALL CONVERSATIONS GAPLESS + DUP-FREE:", allGapless, "| total rows:", msgs.length);
const chapters = await db.chapter.findMany({ where: { novelId: "cmw1mldiz001qqiv8vc2ewluk" }, select: { index: true, title: true, wordCount: true } });
console.log("NOVEL CHAPTERS:", JSON.stringify(chapters));
await db.$disconnect();
