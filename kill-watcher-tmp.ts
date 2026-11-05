import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const PIDS = [8922 8924 8925 8938 ];
const start = Date.now();
await db.chapter.findFirst({ where: { id: "warmup" } }).catch(() => null);
console.log(`[${new Date().toISOString()}] watcher hot`);
while (Date.now() - start < 300_000) {
  const ch = await db.chapter.findFirst({ where: { novelId: "cmw1mldiz001qqiv8vc2ewluk", title: "夜雨" }, select: { id: true, index: true, wordCount: true, createdAt: true } });
  if (ch) {
    console.log(`CHAPTER COMMITTED ${ch.createdAt.toISOString()} (ch${ch.index}, ${ch.wordCount}w) — KILLING at ${new Date().toISOString()} (+${Date.now() - ch.createdAt.getTime()}ms after commit)`);
    for (const p of PIDS) { try { process.kill(p, "SIGKILL"); } catch {} }
    console.log("kill signals sent");
    await db.$disconnect();
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 300));
}
console.log("TIMEOUT");
await db.$disconnect();
