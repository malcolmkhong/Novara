// ---------------------------------------------------------------------------
// Stage B verification — ZERO-GLM idempotency-probe harness (executeTool-level).
// Creates synthetic artifacts on the test novel, fires each probe twice,
// and prints PASS/FAIL evidence + DB counts. Cleans up its own rows.
// ---------------------------------------------------------------------------
import { db } from "../src/lib/db";
import { executeTool } from "../src/lib/agent/runtime";
import type { ToolAction } from "../src/lib/agent/tool-protocol";

const NOVEL = "cmw1mldiz001qqiv8vc2ewluk";
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass += 1; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Synthetic run + task rows (no executor started — pure tool-level calls).
const run = await db.agentRun.create({
  data: { novelId: NOVEL, goal: "[stage-b probe harness]", mode: "full_access", status: "completed", modelId: "glm-4-flash" },
});
const task = await db.agentTask.create({
  data: { runId: run.id, key: "Task 1", assignee: "sage", title: "[probe]", detail: "", status: "in_progress", order: 1 },
});
const base = {
  runId: run.id, novelId: NOVEL, taskId: task.id, taskKey: "Task 1",
  taskBrief: "", qc: { lastBlocking: new Map(), repairs: new Map() },
  signal: new AbortController().signal, actor: "sage" as const,
};
const measured = { chaptersWritten: 0, chaptersUpdated: 0, outlineBeatsUpdated: 0, words: 0, reviewsRun: 0, blockingFound: 0, exportsRun: 0, chaptersFinalized: 0, settlesRun: 0 };
const m = () => ({ ...measured });

const PROSE1 = "第一回正文。夜色像浸了水的绸缎，压在长街尽头。她握紧伞柄，听见更夫敲过三下。";
const PROSE2 = "第二版正文，完全不同的句子。风从巷口灌进来，吹熄了灯笼，也吹乱了她的头发。";

// ---- 1. create probe #1: exact title+content natural key -------------------
const r1 = await executeTool({ ...base, measured: m(), action: { action: "create_chapter", title: "夜雨" } as ToolAction, prose: PROSE1 });
check("create #1 commits normally", r1.ok && r1.feed.includes("created with"), r1.feed.slice(0, 80));
const countAfter1 = await db.chapter.count({ where: { novelId: NOVEL, title: "夜雨" } });
check("create #1 chapter rows == 1", countAfter1 === 1, `count=${countAfter1}`);

const r2 = await executeTool({ ...base, measured: m(), action: { action: "create_chapter", title: "夜雨" } as ToolAction, prose: PROSE1 });
check("create probe #1 (same title+content) ADOPTS", r2.ok && r2.adopted === "write" && r2.feed.includes("adopted existing Chapter"), r2.feed.slice(0, 110));
const countAfter2 = await db.chapter.count({ where: { novelId: NOVEL } });
check("no duplicate chapter after probe #1", countAfter2 === 1, `count=${countAfter2}`);

// ---- 2. create probe #2: run-scope title, DIFFERENT regenerated prose ------
const r3 = await executeTool({ ...base, measured: m(), action: { action: "create_chapter", title: "夜雨" } as ToolAction, prose: PROSE2 });
check("create probe #2 (same title, different prose) ADOPTS", r3.ok && r3.adopted === "write" && r3.feed.includes("adopted existing Chapter"), r3.feed.slice(0, 110));
const countAfter3 = await db.chapter.count({ where: { novelId: NOVEL, title: "夜雨" } });
check("zero duplicate Chapter rows (DB count evidence)", countAfter3 === 1, `count=${countAfter3}`);

const ch = await db.chapter.findFirst({ where: { novelId: NOVEL, title: "夜雨" } });
if (!ch) throw new Error("probe chapter missing");

// ---- 3. update probe: exact content already live ---------------------------
const beforeVersions = await db.chapterVersion.count({ where: { chapterId: ch.id } });
const r4 = await executeTool({ ...base, measured: m(), action: { action: "update_chapter", index: ch.index } as ToolAction, prose: PROSE1 });
check("update probe (content already live) ADOPTS", r4.ok && r4.adopted === "write" && r4.feed.includes("adopted — the chapter already carries exactly this content"), r4.feed.slice(0, 110));
const afterVersions = await db.chapterVersion.count({ where: { chapterId: ch.id } });
check("no duplicate version row from update probe", afterVersions === beforeVersions, `${beforeVersions} -> ${afterVersions}`);

// ---- 4. finalize probe: already final --------------------------------------
await db.chapter.update({ where: { id: ch.id }, data: { status: "final" } });
const finalizeEventsBefore = await db.agentEvent.count({ where: { runId: run.id, kind: "write" } });
const r5 = await executeTool({ ...base, actor: "prism" as const, measured: m(), action: { action: "finalize_chapter", index: ch.index } as ToolAction, prose: null });
check("finalize probe (already final) ADOPTS", r5.ok && r5.adopted === "finalize" && r5.feed.includes("already FINAL — adopted"), r5.feed.slice(0, 110));
const finalizeEventsAfter = await db.agentEvent.count({ where: { runId: run.id, kind: "write" } });
check("no duplicate finalize event", finalizeEventsAfter === finalizeEventsBefore, `${finalizeEventsBefore} -> ${finalizeEventsAfter}`);
await db.chapter.update({ where: { id: ch.id }, data: { status: "draft" } });

// ---- 5. settle probe: digest newer than chapter edit (ZERO GLM) ------------
await db.chapterDigest.create({ data: { chapterId: ch.id, novelId: NOVEL, summary: "[probe digest]" } });
const t0 = Date.now();
const r6 = await executeTool({ ...base, actor: "prism" as const, measured: m(), action: { action: "settle_chapter", index: ch.index } as ToolAction, prose: null });
const elapsed = Date.now() - t0;
check("settle probe (digest current) ADOPTS without GLM", r6.ok && r6.feed.includes("memory already settled") && elapsed < 5000, `${r6.feed.slice(0, 90)} (${elapsed}ms)`);

// ---- 6. beat probe: identical summary ---------------------------------------
const beat = await db.outlineBeat.create({ data: { novelId: NOVEL, index: 901, title: "[probe beat]", summary: "原有的伏笔概要" } });
const r7 = await executeTool({ ...base, measured: m(), action: { action: "update_outline_beat", index: 901, summary: "原有的伏笔概要" } as ToolAction, prose: null });
check("beat probe (identical summary) ADOPTS", r7.ok && r7.feed.includes("already carries this summary"), r7.feed.slice(0, 100));
const beatEvents = await db.agentEvent.count({ where: { runId: run.id, kind: "write" } });
check("no event from beat no-op", beatEvents === finalizeEventsAfter, `${beatEvents}`);

// ---- 7. event-derived measured re-derivation --------------------------------
const derived = await (await import("../src/lib/agent/runtime")).deriveMeasuredFromEvents(run.id);
check("deriveMeasuredFromEvents: 1 create_chapter from events", derived.chaptersWritten === 1 && derived.words > 0, JSON.stringify({ chaptersWritten: derived.chaptersWritten, words: derived.words }));

// ---- cleanup -----------------------------------------------------------------
await db.chapterDigest.deleteMany({ where: { chapterId: ch.id } });
await db.outlineBeat.delete({ where: { id: beat.id } }).catch(() => undefined);
await db.agentEvent.deleteMany({ where: { runId: run.id } });
await db.agentMessage.deleteMany({ where: { runId: run.id } });
await db.agentTask.deleteMany({ where: { runId: run.id } });
await db.chapterVersion.deleteMany({ where: { novelId: NOVEL, chapterId: ch.id } });
await db.chapter.delete({ where: { id: ch.id } });
await db.agentRun.delete({ where: { id: run.id } });
console.log(`\nRESULT: ${pass} pass / ${fail} fail (cleanup done)`);
await db.$disconnect();
process.exit(fail === 0 ? 0 : 1);
