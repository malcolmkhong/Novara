// Stage B verification — read-only state check (zero GLM).
import { db } from "../src/lib/db";

const novelId = "cmw1mldiz001qqiv8vc2ewluk";
const novel = await db.novel.findUnique({ where: { id: novelId }, select: { id: true, title: true } });
console.log("novel:", novel?.title ?? "MISSING");
const chapters = await db.chapter.count({ where: { novelId } });
const beats = await db.outlineBeat.count({ where: { novelId } });
const runs = await db.agentRun.findMany({ where: { novelId }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, status: true, createdAt: true, leaseOwner: true, leaseEpoch: true } });
console.log("chapters:", chapters, "beats:", beats);
console.log("recent runs:", JSON.stringify(runs, null, 1));
const msgCount = await db.agentMessage.count();
console.log("AgentMessage rows (all runs):", msgCount);
await db.$disconnect();
