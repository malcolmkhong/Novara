// ---------------------------------------------------------------------------
// Novara AI — P5-e slicing-enablement live-fire CONTROLLER (free flash, $0).
//
// Gate doc §3 validation protocol, slicing leg (phase5-gate-p5d.md), executed
// AFTER the production flip (user ruling R-1 of 2026-11-06):
//   - budgets.yaml + DEFAULT_BUDGETS now carry contextSlicing.enabled=true at
//     rest — this run validates the SHIPPED state, so unlike the P4 rig there
//     is NO probe-pack surgery and NO restore: the flip is the product.
//   - One free-tier (glm-4-flash) run through the HARDENED P4 rig pattern
//     (OPS-2 mandatory): detached executor in its own session (reuses the
//     run-agnostic scripts/p4-live-exec.ts), pre-run state persisted to
//     /tmp/p5e-live-state.json BEFORE any model call, standalone evidence
//     pass (scripts/p5e-live-evidence.ts) reconstructable after a reap.
//   - Tightened goal per OPS-1: the EXACT P4-B attempt-#4 goal text that
//     produced a completed, verified write on the free tier (loose goals on
//     flash are a known protocol-error generator).
//   - Mock-first standing rule (OPS-3): every other probe stays mocked; this
//     run is the gate's one sanctioned live-fire.
//
// Phases:
//   0. preflight — shipped config at rest is the RULED state (slicing true,
//                  compaction false); no active runs.
//   1. seed      — scratch novel at the P4 representative fixture dims; load
//                  the PRE-RUN snapshot (structured data + full render);
//                  compute the EXPECTED leader envelope byte-exactly;
//                  persist the state file (including the yaml at-rest text
//                  so evidence can prove the flip STAYS).
//   2. run       — create the run (glm-4-flash = FREE, full_access, thinking
//                  off); spawn the detached executor; poll until terminal
//                  (cap 9 min).
//   3. evidence  — delegate to p5e-live-evidence.ts (exit code relayed).
//
// GLM discipline: every model call belongs to the single FREE flash run;
// the controller itself makes zero GLM calls.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { countTokens } from "../src/lib/agent/context-meter";
import { loadStorySnapshot, renderSnapshot } from "../src/lib/agent/snapshot";

const db = new PrismaClient();
const YAML_PATH = "agent/config/budgets.yaml";
const STATE_PATH = "/tmp/p5e-live-state.json";
const PROBE_MODEL = "glm-4-flash"; // FREE tier — budget zero
const runCapMs = 9 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let checks: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`P5E-LIVE: [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

// OPS-1 tightened goal — VERBATIM the P4-B attempt-#4 text (the only wording
// that produced a completed verified write on the free tier).
const GOAL = [
  "P4 acceptance run. Work in SEPARATE turns — one action per turn:",
  "1. Dispatch EXACTLY ONE chapter-write task to sage via a team-delegate block: title 'Write chapter 13', detail 'Write the next chapter of this novel (it will be created at index 13), following the outline. IMPORTANT: in ONE reply include BOTH the full chapter prose in a novel-write block AND a novel-tool block calling create_chapter — never split them across turns. Do not read anything first; write immediately. 500–700 words of Chinese prose. Do not finalize or export.', assignee 'sage', artifactType 'chapter', artifactLabel 'chapter 13'.",
  "2. When that task reports done, dispatch EXACTLY ONE read-only research task to nova via a team-delegate block: title 'Chapter 13 continuity notes', detail 'Read chapter 13 and report continuity notes only — no writes of any kind.', assignee 'nova', artifactType 'chapter', artifactLabel 'chapter 13'.",
  "3. Dispatch nothing else. Finish tool-free with a ```run-report block.",
].join("\n");

// --- seed helpers (P4 representative fixture dims, real DB rows) --------------

const fill = (n: number, tag: string) => (tag + "。").repeat(Math.ceil(n / (tag.length + 1))).slice(0, n);

const CAST_NAMES = ["沈青梧", "楚昭南", "陆怀沙", "林晚", "苏折柳", "白榆", "顾行舟", "阿蛮", "温故", "谢必安", "洛九", "灰奴"];

function seedChapterContent(index: number): string {
  const lines = [`第${index}章 灯下的信（ seeded prose ）`, ""];
  for (let i = 0; i < 14; i++) {
    lines.push(
      `灯船在夜雾里滑行，沈青梧数着更漏。第${index}章第${i + 1}段：楚昭南没有回头，陆怀沙的账册摊开在石桌上，雨点砸在天井的石板上，誓约的残句压进袖底。`
    );
  }
  lines.push("她在灰烬里翻出半页账册，火燎的边缘卷曲如枯叶。");
  return lines.join("\n");
}

// --- main ---------------------------------------------------------------------

async function main() {
  const yamlAtRest = readFileSync(YAML_PATH, "utf8");

  // 0. preflight — the RULED state is already shipped (no surgery) -------------
  const slicingRest = yamlAtRest.slice(yamlAtRest.indexOf("contextSlicing:"));
  check(
    "preflight: shipped config at rest is the RULED state (contextSlicing=true, contextCompaction=false)",
    /^  enabled: true/m.test(slicingRest.slice(0, slicingRest.indexOf("\n\n"))) &&
      /^  enabled: false/m.test(yamlAtRest.slice(yamlAtRest.indexOf("contextCompaction:"), yamlAtRest.indexOf("contextSlicing:")))
  );
  const activeAnywhere = await db.agentRun.count({ where: { status: { in: ["running", "awaiting_approval", "paused"] } } });
  check("preflight: no active runs anywhere", activeAnywhere === 0, `active=${activeAnywhere}`);

  let novelId: string | null = null;
  let runId: string | null = null;
  try {
    // 1. seed ------------------------------------------------------------------
    const novel = await db.novel.create({
      data: { title: "长夜灯船（P5-e验收场）", genre: "奇幻", targetWords: 200_000, status: "writing", synopsis: fill(600, "长夜灯船在雾中航行，灯塔的守望者与失落的信件之间的故事，誓约与账册缺页贯穿全篇") },
    });
    novelId = novel.id;

    const chapters: { id: string; index: number }[] = [];
    for (let i = 1; i <= 12; i++) {
      const content = seedChapterContent(i);
      const row = await db.chapter.create({
        data: { novelId: novel.id, index: i, title: `第${i}章 灯下的信`, content, wordCount: content.replace(/\s/g, "").length, status: i === 12 ? "draft" : "final", brief: "细纲：灯船夜航——沈青梧核对账册缺页；楚昭南现身；章末钩子：火漆印与誓约同源。" },
      });
      chapters.push({ id: row.id, index: i });
    }
    await db.chapterDigest.createMany({
      data: [1, 2, 3].map((i) => ({ chapterId: chapters[i - 1].id, novelId: novel.id, summary: fill(500, `第${i}章前情：灯船进入夜雾，沈青梧发现账册缺页与二十年前的誓约有关，楚昭南的脚步声停在门外`) })),
    });
    await db.storyFact.createMany({
      data: [1, 2, 3, 4, 5, 6].map((i) => ({ novelId: novel.id, category: "story_fact", content: `既定事实${i}：灯船的第${i}层回廊藏着${i}号信件，誓言的倒计时与之绑定`, sourceChapter: i })),
    });
    await db.characterState.createMany({
      data: CAST_NAMES.slice(0, 4).map((name, i) => ({ novelId: novel.id, name, chapterIndex: i + 9, state: `第${i + 9}章末状态：${name}携缺页离开回廊，誓约倒计时过半` })),
    });
    await db.outlineBeat.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({
        novelId: novel.id,
        index: i + 1,
        title: `节拍${i + 1}`,
        summary: fill(120, `节拍${i + 1}：沈青梧与楚昭南在档案塔第${(i % 12) + 1}层对峙，誓约倒计时逼近，缺页线索再现`) + (i === 39 ? " UNIQ-B40" : ""),
      })),
    });
    await db.character.createMany({
      data: CAST_NAMES.map((name, i) => ({ novelId: novel.id, name, role: i === 0 ? "protagonist" : i === 1 ? "rival" : "supporting", description: "灯船夜航的乘员，与誓约和缺页纠缠。" })),
    });
    await db.worldEntry.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({ novelId: novel.id, title: `设定${i + 1}`, category: "place", content: fill(300, `设定${i + 1}：灯船的构造与更漏机关，雨水顺着铜兽嘴淌下，回廊里的灯火随呼吸明灭`) })),
    });
    await db.novelContract.create({ data: { novelId: novel.id, content: fill(800, "作品契约：这本书承诺一个关于誓约、账册与灯塔的闭环故事，所有伏笔必须回收，人物不得违背既定立场") } });
    await db.storyline.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({ novelId: novel.id, name: `主线${i + 1}`, status: i % 3 === 0 ? "active" : "dormant", summary: fill(120, `主线${i + 1}：誓约的倒计时与缺页的回收路径`) })),
    });
    await db.timelineEntry.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({ novelId: novel.id, order: i + 1, label: `事件${i + 1}`, detail: fill(120, `事件${i + 1}：灯船抵达第${(i % 12) + 1}层，账册缺页再次出现`), chapterIndex: (i % 12) + 1 })),
    });
    await db.characterArc.createMany({
      data: CAST_NAMES.flatMap((name) => [
        { novelId: novel.id, characterName: name, order: 1, note: fill(80, `${name}的起点：执着于缺页背后的真相`) },
        { novelId: novel.id, characterName: name, order: 2, note: fill(80, `${name}的转变：在誓约与真相之间重新选择`) },
      ]),
    });
    await db.foreshadow.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({ novelId: novel.id, content: fill(120, `伏笔${i + 1}：火漆印的半枚图案与誓约原文同源，指向档案塔第${(i % 12) + 1}层`) + ` UNIQ-F${i + 1}`, plantChapter: (i % 12) + 1, status: "open" })),
    });
    console.log(`P5E-LIVE: seeded scratch novel ${novel.id} (P4 representative dims: 12 chapters, 40 beats, 12 cast, 12 world, 12 storylines, 20 timeline, 24 arcs, 30 foreshadows, contract, 3 digests)`);

    // Pre-run snapshot: structured data (for byte-exact slice recomputation in
    // the evidence pass) + full render (the leader anchor + savings baseline).
    const preRunSnapshot = await loadStorySnapshot(novel.id);
    const fullSnapText = renderSnapshot(preRunSnapshot);
    const fullSnapTok = countTokens(fullSnapText);
    const countMatches = (text: string, re: RegExp): number => (text.match(re) ?? []).length;
    const fullLedgerEntries = countMatches(fullSnapText, /^-\s*\[[^\]]*\]\s*\([^)]*planted ch/gm);
    const fullBeatLines = countMatches(fullSnapText, /^\d+\./gm);
    check(
      "seed: pre-run snapshot loaded at representative dims",
      fullSnapTok > 3000 && fullBeatLines === 40 && fullLedgerEntries === 30,
      `${fullSnapText.length} chars ≈ ${fullSnapTok} tok (est) · ${fullBeatLines} beats · ${fullLedgerEntries} ledger entries`
    );

    const leaderConvParts: string[] = [`AUTHOR GOAL: ${GOAL}`, ""];
    const leaderNovelParts: string[] = [];
    leaderNovelParts.push("STORY SNAPSHOT (measured now):", fullSnapText, "");
    leaderConvParts.push(
      "LEAD THE TEAM: read what you need, then dispatch work with ```team-delegate",
      "blocks (JSON array of orders). Each executed order's VERIFIED outcome comes",
      "back to you as a tool result — decide the next step from those, never from",
      "the member's narration alone. Finish with a tool-free reply."
    );
    const expectedLeaderEnvelope = [...leaderConvParts, ...leaderNovelParts].join("\n");

    // 2. run -------------------------------------------------------------------
    const run = await db.agentRun.create({
      data: { novelId: novel.id, goal: GOAL, mode: "full_access", status: "running", modelId: PROBE_MODEL, thinkingLevel: "off" },
    });
    runId = run.id;
    console.log(`P5E-LIVE: enablement run created — ${runId} (model=${PROBE_MODEL} FREE, mode=full_access, slicing=ON at rest)`);

    // Persist the recovery state BEFORE any model call — p5e-live-evidence.ts
    // reconstructs evidence + cleanup even if this controller is reaped.
    writeFileSync(
      STATE_PATH,
      JSON.stringify({ runId, novelId, yamlAtRest, expectedLeaderEnvelope, fullSnapText, fullSnapTok, snapshotData: preRunSnapshot })
    );
    console.log(`P5E-LIVE: state persisted → ${STATE_PATH}`);

    // Detached executor — its OWN session (setsid), file-redirected output,
    // immune to this controller's death (OPS-2). The P4 executor script is
    // run-agnostic (claim-lease-then-execute) and is REUSED verbatim.
    Bun.spawn(
      ["/bin/sh", "-c", `setsid nohup bun scripts/p4-live-exec.ts ${runId} fresh > /tmp/p5e-exec.log 2>&1 < /dev/null &`],
      { cwd: new URL("..", import.meta.url).pathname, stdout: "ignore", stderr: "ignore" }
    );
    console.log(`P5E-LIVE: executor spawned DETACHED (own session) — polling until terminal (cap ${runCapMs / 60_000} min)…`);
    const t0 = Date.now();
    let finalStatus: string | null = null;
    while (Date.now() - t0 < runCapMs) {
      await sleep(3000);
      const st = (await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } }))?.status;
      if (st && ["completed", "failed", "cancelled"].includes(st)) {
        finalStatus = st;
        break;
      }
    }
    if (!finalStatus) {
      Bun.spawn(["pkill", "-f", `p4-live-exec.ts ${runId}`], { stdout: "ignore", stderr: "ignore" });
      check("run reached a terminal state within the cap", false, "cap hit — executor pkilled");
      await sleep(2000);
    } else {
      check("run reached a terminal state", finalStatus === "completed", `status=${finalStatus}`);
    }

    // 3. evidence + cleanup — delegated (same pass the standalone script runs).
    const ev = Bun.spawn(["bun", "scripts/p5e-live-evidence.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdout: "inherit",
      stderr: "inherit",
    });
    await ev.exited;
    process.exit(ev.exitCode ?? 1);
  } catch (error) {
    console.error("P5E-LIVE: controller error:", error);
    console.error("P5E-LIVE: run the standalone recovery pass: bun scripts/p5e-live-evidence.ts");
    process.exit(1);
  }
}

main();
