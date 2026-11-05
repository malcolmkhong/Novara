// Stage C evidence: settle probe adopt-skip via the REAL executeTool (zero GLM).
// Precondition: one real GLM sedimentation pass on ch2 夜雁 (the only permitted GLM call here).
import { db } from "@/lib/db";
import { executeTool } from "@/lib/agent/runtime";
import { sedimentChapterCore } from "@/lib/novara/sediment";
import type { PrismaClient } from "@prisma/client";

const F = (d: Date | null) => (d ? d.toISOString() : "NULL");
const ch = await db.chapter.findFirst({ where: { novelId: "cmw1mldiz001qqiv8vc2ewluk", title: "夜雁" } });
if (!ch) throw new Error("chapter 夜雁 not found");
console.log(`target: ch${ch.index} "${ch.title}" ${ch.wordCount}w id=${ch.id}`);

// 1. One real GLM settlement pass — creates the current-digest precondition.
console.log(" invoking sedimentChapterCore (1 GLM pass)…");
const t0 = Date.now();
const sed = await sedimentChapterCore(ch.id);
console.log(` sediment done in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(sed.result));

const digestAfterSediment = await db.chapterDigest.findUnique({ where: { chapterId: ch.id }, select: { updatedAt: true, createdAt: true } });
const chapterRow = await db.chapter.findUnique({ where: { id: ch.id }, select: { updatedAt: true } });
console.log(` digest.created=${F(digestAfterSediment!.createdAt)} digest.updated=${F(digestAfterSediment!.updatedAt)} | chapter.updated=${F(chapterRow!.updatedAt)}`);
console.log(` probe condition (digest.updated >= chapter.updated): ${digestAfterSediment!.updatedAt.getTime() >= chapterRow!.updatedAt.getTime()}`);

// 2. ZERO-GLM harness call — the adopt-skip branch of the settle probe.
const mkParams = () => ({
  action: { action: "settle_chapter", index: ch.index } as never,
  prose: null,
  runId: "settle-probe-harness", // probe path reads no run rows before returning
  novelId: ch.novelId,
  taskId: null,
  taskKey: "Harness",
  taskBrief: "",
  measured: { chaptersWritten: 0, chaptersUpdated: 0, outlineBeatsUpdated: 0, words: 0, reviewsRun: 0, blockingFound: 0, exportsRun: 0, chaptersFinalized: 0, settlesRun: 0 },
  qc: { repairs: new Map() },
  signal: new AbortController().signal,
  actor: "prism" as const,
});
console.log("\n harness settle_chapter call #1 (expect adopt-skip, zero GLM):");
const r1 = await executeTool(mkParams());
console.log(` ok=${r1.ok} :: ${r1.feed}`);

const digestAfterCall1 = await db.chapterDigest.findUnique({ where: { chapterId: ch.id }, select: { updatedAt: true } });
console.log(` digest.updated unchanged after call #1: ${digestAfterCall1!.updatedAt.getTime() === digestAfterSediment!.updatedAt.getTime()} (no re-sedimentation = no GLM)`);

console.log("\n harness settle_chapter call #2 (idempotence of the skip):");
const r2 = await executeTool(mkParams());
console.log(` ok=${r2.ok} :: ${r2.feed}`);

// 3. Negative control at condition level (NO second GLM pass): touch the chapter
//    content → digest becomes stale → the probe comparison inverts.
await db.chapter.update({ where: { id: ch.id }, data: { content: ch.content + "\n\n（作者补记：用于探针负向对照的一句话。）" } });
const chAfterTouch = await db.chapter.findUnique({ where: { id: ch.id }, select: { updatedAt: true } });
const d = await db.chapterDigest.findUnique({ where: { chapterId: ch.id }, select: { updatedAt: true } });
console.log(`\n after author-style content touch: chapter.updated=${F(chAfterTouch!.updatedAt)} digest.updated=${F(d!.updatedAt)}`);
console.log(` probe condition now: ${d!.updatedAt.getTime() >= chAfterTouch!.updatedAt.getTime()} (false = probe would MISS → re-sediment on a real dispatch; NOT executed here to keep the one-GLM budget)`);
await db.$disconnect();
