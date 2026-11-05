import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const start = Date.now();
while (Date.now() - start < 240_000) {
  const run = await db.agentRun.findUnique({ where: { id: "cmw382l91004uoxwawedw12yy" }, select: { status: true, finalReport: true } });
  if (run && ["completed", "failed", "cancelled"].includes(run.status)) {
    console.log(`RUN ${run.status} at ${new Date().toISOString()}`);
    if (run.finalReport) console.log("finalReport:", run.finalReport);
    break;
  }
  await new Promise(r => setTimeout(r, 4000));
}
const tasks = await db.agentTask.findMany({ where: { runId: "cmw382l91004uoxwawedw12yy" }, orderBy: { order: "asc" }, select: { key: true, status: true, title: true } });
for (const t of tasks) console.log(`  ${t.key} [${t.status}] ${t.title}`);
const chs = await db.chapter.findMany({ where: { novelId: "cmw1mldiz001qqiv8vc2ewluk", title: "夜雨" }, select: { index: true, wordCount: true } });
console.log(`chapters titled 夜雨: ${chs.length}`, chs.map(c => `#${c.index} ${c.wordCount}w`).join(" | "));
await db.$disconnect();
