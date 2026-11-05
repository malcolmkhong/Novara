// ---------------------------------------------------------------------------
// Novara AI — P2-c live probe CONTROLLER v2 (the ONE permitted GLM run).
//
// v2 lessons folded in (attempt 1 died to sandbox process-group cleanup;
// attempt 2's trigger never crossed because the meter's raw estimate
// undercounts CJK ~1.4× vs the provider's billing — now fixed in the
// runtime: the trigger measures the last call's PROVIDER-RECONCILED prompt
// tokens). v2 changes: explicit read_chapter tool syntax in the goal (the
// flash model looped on the wrong parameter name in attempts 1–2) and the
// controller must be launched under `setsid nohup` to survive tool-session
// cleanup.
//
// Phases:
//   0. preflight — shipped config at rest; no active runs.
//   1. seed      — a scratch novel with 3 CJK chapters + outline beats +
//                  characters (zero GLM; the read tools need real DB texture).
//   2. probe     — write the TEMPORARY probe pack into budgets.yaml
//                  (enabled:true, triggerTokens:4000, tailTurns:2,
//                  minCompactableRows:6), createRun(glm-4-flash,
//                  full_access, read-only survey goal), spawn the executor
//                  child, poll the DB until ≥1 compaction has fired AND a
//                  member task is mid-execution (guaranteed resume orphan),
//                  then SIGKILL the child — a hard executor death.
//   3. resume    — age the dead lease heartbeat past the 240s staleness
//                  window (exactly what a real crash leaves behind;
//                  DISCLOSED), spawn the resume child, wait for completion.
//   4. evidence  — real-transcript counterfactual table (legacy vs
//                  assembler-disabled vs projected), restored-wire proof
//                  (resume telemetry + usage events), transcript gapless,
//                  counters intact, chain audit, usage-as-sent semantics.
//   finally      — budgets.yaml restored byte-exact; probe run + scratch
//                  novel cascade-deleted.
//
// GLM discipline: ALL model calls in this script belong to the single probe
// RUN (leader + its member). The controller itself makes zero GLM calls.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { claimLease } from "../src/lib/agent/messages";
import {
  assembleWire,
  legacyReplay,
} from "../src/lib/agent/wire";
import { countTokens } from "../src/lib/agent/context-meter";

const db = new PrismaClient();
const YAML_PATH = "agent/config/budgets.yaml";
const PROBE_MODEL = "glm-4-flash";
const WIRETAP = "P2-c live probe — kill/resume across a real compaction";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const phase1CapMs = 11 * 60_000;
const phase2CapMs = 11 * 60_000;
const orphanWaitCapMs = 7 * 60_000;

const GOAL = [
  "Continuity survey of this novel's manuscript. READ-ONLY: do not write, update, finalize or export anything.",
  "Work in SEPARATE turns — one action per turn — and reply with a 3–5 sentence continuity note after each read.",
  'TOOL SYNTAX (use exactly this shape): {"action":"read_chapter","index":1} — the chapter parameter is named "index" (a number).',
  "1. read_outline.",
  "2. Dispatch EXACTLY ONE read-only research task to nova via a team-delegate block: title 'Cast cross-check', detail 'Cross-check the cast list against the chapters; report findings only, no writes.'",
  "3. read_novel.",
  "4. read_chapter for each existing chapter (index 1, then 2, then 3), ONE chapter per turn, in order.",
  "5. Dispatch ONE more read-only nova task via team-delegate: title 'Timeline sweep', detail 'List any timeline inconsistencies you can find; report only, no writes.'",
  "6. read_foreshadows.",
  "7. Finish tool-free with a ```run-report block summarizing the survey.",
].join("\n");

// --- helpers -------------------------------------------------------------------

let checks: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`P2-C-LIVE: [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const CJK = [
  "沈青梧按住剑柄，指尖在青铜门上停了半拍，塔内的灯火随她的呼吸明灭。",
  "楚昭南没有回头，只把染血的袖口挽了上去，声音低得像是从井底传来。",
  "卷轴上的墨迹未干，昨日立下的誓约此刻看来竟像旁人的故事。",
  "雨点砸在天井的石板上，她数着更漏，把每一句要质问的话都咽了回去。",
];

const seedChapter = (index: number, title: string, beats: string[]) =>
  [
    `${title}\n`,
    ...beats.map((b, i) => `${b}沈青梧${i % 2 === 0 ? "按住剑柄" : "收剑入鞘"}，${b}档案塔的灯火在第${index}层的回廊里明灭，楚昭南的脚步声停在门外半拍之久。`),
    // ~3000 CJK chars of continuous prose — the read_chapter feed carries the
    // full text, and the conversation section must cross the probe trigger
    // (4000 est. tokens) on real model turns, not on seeded padding alone.
    ...Array.from({ length: 66 }, (_, i) =>
      `第${String(i + 1).padStart(3, "0")}段：${CJK[i % 4]}${CJK[(i + 2) % 4]}更漏声里，她把${i % 3 === 0 ? "账册的缺页" : "誓约的残句"}压进袖底，塔外雨声不歇。`
    ),
    "她在灰烬里翻出半页账册，火燎的边缘卷曲如枯叶——那正是二十年前被撕去的那一笔。",
  ].join("\n");

const CHAPTER_BRIEF =
  "细纲：档案塔夜审——沈青梧核对二十年前账册缺页；楚昭南现身但不出手；陆怀沙的两处笔迹暴露内外勾结；" +
  "章末钩子：缺页背后的半枚火漆印与誓约原文同源。保持 900–1100 字节奏，段落短促，雨声与更漏交替做底噪。";

function applyProbePack(raw: string): { patched: string; hits: number } {
  let hits = 0;
  const patched = raw
    .replace(/^(  enabled: )false\b/m, (_m, p1) => (hits++, `${p1}true`))
    .replace(/^(  triggerTokens: )6000\b/m, (_m, p1) => (hits++, `${p1}4000`))
    .replace(/^(  tailTurns: )8\b/m, (_m, p1) => (hits++, `${p1}2`))
    .replace(/^(  minCompactableRows: )12\b/m, (_m, p1) => (hits++, `${p1}6`));
  return { patched, hits };
}

async function gapless(runId: string, conv: string): Promise<{ ok: boolean; detail: string }> {
  const rows = await db.agentMessage.findMany({
    where: { runId, conversationId: conv },
    orderBy: { seq: "asc" },
    select: { seq: true },
  });
  const gaps: string[] = [];
  rows.forEach((r, i) => {
    if (r.seq !== i + 1) gaps.push(`seq ${i + 1}≠${r.seq}`);
  });
  return { ok: gaps.length === 0, detail: `${rows.length} rows${gaps.length ? ` gaps: ${gaps.join(",")}` : ", dense 1..N"}` };
}

async function usageRows(runId: string) {
  const events = await db.agentEvent.findMany({
    where: { runId, kind: "usage" },
    orderBy: { createdAt: "asc" },
    select: { summary: true, payload: true, createdAt: true },
  });
  return events.map((e) => {
    let usage: { used?: number; sections?: Record<string, number>; real?: { promptTokens?: number } | null } = {};
    try {
      usage = (JSON.parse(e.payload ?? "{}") as { usage?: typeof usage }).usage ?? {};
    } catch {}
    return {
      at: e.createdAt,
      summary: e.summary,
      used: usage.used ?? 0,
      conversation: usage.sections?.conversation ?? 0,
      realPrompt: usage.real?.promptTokens ?? null,
    };
  });
}

// --- main ---------------------------------------------------------------------

async function main() {
  // 0. preflight --------------------------------------------------------------
  const yamlOriginal = readFileSync(YAML_PATH, "utf8");
  check(
    "preflight: shipped config at rest (enabled=false, 6000/8/12)",
    /  enabled: false/.test(yamlOriginal) &&
      /  triggerTokens: 6000/.test(yamlOriginal) &&
      /  tailTurns: 8/.test(yamlOriginal) &&
      /  minCompactableRows: 12/.test(yamlOriginal)
  );
  const activeAnywhere = await db.agentRun.count({ where: { status: { in: ["running", "awaiting_approval", "paused"] } } });
  check("preflight: no active runs anywhere", activeAnywhere === 0, `active=${activeAnywhere}`);

  // 1. probe-pack surgery BEFORE anything is created — a failed surgery must
  //    never leak a run or a patched yaml.
  const { patched, hits } = applyProbePack(yamlOriginal);
  check("probe pack applied to budgets.yaml (4 lines)", hits === 4, `hits=${hits}`);
  if (hits !== 4) throw new Error("probe pack surgery failed — aborting before any GLM call");
  writeFileSync(YAML_PATH, patched);

  let novelId: string | null = null;
  let runId: string | null = null;
  let phase1Done = false;
  let phase2Done = false;
  try {
    // 2. seed -------------------------------------------------------------
    const novel = await db.novel.create({
      data: { title: "[p2-c-probe] archive-tower scratch", genre: "wuxia" },
    });
    novelId = novel.id;
    await db.outlineBeat.createMany({
      data: [1, 2, 3].map((i) => ({
        novelId: novel.id,
        index: i,
        title: `档案塔之影 ${i}`,
        summary: `第${i}拍：沈青梧与楚昭南在档案塔第${i}层的对峙；誓约的倒计时逼近；账册缺页的线索再次出现。`,
      })),
    });
  await db.character.createMany({
    data: [
      { novelId: novel.id, name: "沈青梧", role: "protagonist", description: "剑客，追查档案塔失火真相。" },
      { novelId: novel.id, name: "楚昭南", role: "rival", description: "旧誓约的另一半，二十年后归来。" },
    ],
  });
  for (let i = 1; i <= 3; i++) {
    const content = seedChapter(i, `第${["一", "二", "三"][i - 1]}章 档案塔之影`, [
      "塔内的更漏声比记忆里慢了半拍，",
      "陆怀沙的账册摊开在石桌上，",
      "雨水顺着天井的铜兽嘴淌下来，",
    ]);
    await db.chapter.create({
      data: { novelId: novel.id, index: i, title: `第${["一", "二", "三"][i - 1]}章 档案塔之影`, content, wordCount: content.replace(/\s/g, "").length, status: "draft", brief: CHAPTER_BRIEF },
    });
  }
  console.log(`P2-C-LIVE: seeded scratch novel ${novel.id} (3 chapters, beats, cast)`);

  const run = await db.agentRun.create({
    data: { novelId: novel.id, goal: GOAL, mode: "full_access", status: "running", modelId: PROBE_MODEL, thinkingLevel: "off" },
  });
  runId = run.id;
  console.log(`P2-C-LIVE: probe run created — ${runId} (model=${PROBE_MODEL}, mode=full_access)`);

  // 3. probe phase ------------------------------------------------------------
  const child = Bun.spawn(["bun", "scripts/p2-c-probe-exec.ts", runId, "fresh"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdout: "inherit",
      stderr: "inherit",
    });
    console.log(`P2-C-LIVE: executor child spawned pid=${child.pid} — polling for compaction + orphan…`);
    const t0 = Date.now();
    let compactionsSeen = 0;
    let killed = false;
    let firstCompactionAt: number | null = null;
    while (Date.now() - t0 < phase1CapMs) {
      await sleep(1500);
      if ((await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } }))?.status !== "running") {
        // run finished/cancelled on its own (too few turns to compact) — leave loop
        break;
      }
      compactionsSeen = await db.contextSummary.count({ where: { runId } });
      if (compactionsSeen < 1) continue;
      if (firstCompactionAt === null) {
        firstCompactionAt = Date.now();
        console.log(`P2-C-LIVE: first compaction observed at +${Math.round((firstCompactionAt - t0) / 1000)}s — waiting for a member task in flight (orphan window ≤ ${orphanWaitCapMs / 1000}s)…`);
      }
      // ≥1 compaction — wait for a member task mid-execution (guaranteed orphan).
      const inFlight = await db.agentTask.findFirst({
        where: { runId, status: "in_progress" },
        select: { id: true, key: true },
      });
      if (inFlight) {
        const memberRows = await db.agentMessage.count({ where: { runId, conversationId: inFlight.id } });
        if (memberRows >= 2) {
          // member is mid-GLM-task — kill NOW (hard executor death)
          child.kill(9);
          killed = true;
          check("kill: executor SIGKILLed with ≥1 compaction AND a member task in flight", true, `compactions=${compactionsSeen} orphan=${inFlight.key} memberRows=${memberRows} after=${Math.round((Date.now() - t0) / 1000)}s`);
          break;
        }
      }
      if (Date.now() - firstCompactionAt > orphanWaitCapMs && !killed) {
        // orphan window closing — compaction happened but no member is
        // mid-flight; kill anyway and disclose the missing orphan.
        child.kill(9);
        killed = true;
        check("kill: executor SIGKILLed after compaction, NO member in flight (orphan window timed out)", false, `compactions=${compactionsSeen} after=${Math.round((Date.now() - t0) / 1000)}s`);
        break;
      }
    }
    if (!killed) {
      child.kill(9);
      check("kill: executor SIGKILLed", false, `no compaction observed within cap (compactions=${compactionsSeen})`);
    }
    await child.exited;
    phase1Done = true;

    // --- phase-1 evidence dump ---------------------------------------------
    const p1 = await gapless(runId, "leader");
    check("phase-1 leader transcript gapless (dense 1..N, SIGKILL mid-run)", p1.ok, p1.detail);
    const summaries = await db.contextSummary.findMany({ where: { runId, conversationId: "leader" }, orderBy: { toSeq: "asc" } });
    check(
      "phase-1 summary chain: ≥1 row, head active, fromSeq = envelope+1",
      summaries.length >= 1 &&
        summaries.filter((s) => s.supersededAt === null).length === 1 &&
        summaries[0].fromSeq === 3,
      summaries.map((s) => `cut=${s.toSeq}${s.supersededAt ? " (superseded)" : " ACTIVE"} lease=${s.leaseEpoch}`).join(" | ")
    );
    const tasks1 = await db.agentTask.findMany({ where: { runId }, select: { key: true, status: true } });
    console.log(`P2-C-LIVE: tasks at kill — ${tasks1.map((t) => `${t.key}:${t.status}`).join(", ") || "(none)"}`);
    const u1 = await usageRows(runId);
    console.log("P2-C-LIVE: usage events at kill:");
    for (const u of u1) console.log(`P2-C-LIVE:   used=${u.used} convo=${u.conversation} real=${u.realPrompt ?? "—"} | ${u.summary}`);
    const compactionEvents1 = await db.agentEvent.count({ where: { runId, summary: { contains: "Context compacted" } } });
    check("phase-1 compaction telemetry events persisted", compactionEvents1 >= 1, `events=${compactionEvents1}`);

    // 3. resume phase ---------------------------------------------------------
    // Disclosed: age the dead heartbeat past the 240s staleness window — the
    // exact DB state a real crashed executor leaves 4 minutes after death.
    await db.agentRun.update({
      where: { id: runId },
      data: { leaseHeartbeatAt: new Date(Date.now() - 300_000) },
    });
    console.log("P2-C-LIVE: dead lease aged past staleness window (disclosed simulation of the 240s crash window)");
    const resumeLease = await claimLease(runId);
    check("resume: lease claimable after executor death (epoch bumped)", !!resumeLease, `epoch=${resumeLease?.epoch}`);
    await db.agentRun.update({ where: { id: runId }, data: { leaseOwner: null } });
    if (!resumeLease) throw new Error("resume lease unclaimable — aborting");

    const child2 = Bun.spawn(["bun", "scripts/p2-c-probe-exec.ts", runId, "resume"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdout: "inherit",
      stderr: "inherit",
    });
    console.log(`P2-C-LIVE: resume child spawned pid=${child2.pid}`);
    const t1 = Date.now();
    while (Date.now() - t1 < phase2CapMs) {
      await sleep(2000);
      const status = (await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } }))?.status;
      if (status && ["completed", "failed", "cancelled"].includes(status)) break;
    }
    const exited2 = await Promise.race([child2.exited, sleep(30_000).then(() => "timeout")]);
    phase2Done = exited2 !== "timeout";

    // 4. final evidence pass --------------------------------------------------
    const runFinal = await db.agentRun.findUnique({ where: { id: runId } });
    check("resume completed the run", runFinal?.status === "completed", `status=${runFinal?.status} err=${(runFinal?.error ?? "—").slice(0, 80)}`);

    const p2 = await gapless(runId, "leader");
    check("post-resume leader transcript STILL gapless", p2.ok, p2.detail);

    const leaderRows = await db.agentMessage.findMany({
      where: { runId, conversationId: "leader" },
      orderBy: { seq: "asc" },
    });
    const activeHeads = await db.contextSummary.findMany({ where: { runId, conversationId: "leader", supersededAt: null } });
    const allChain = await db.contextSummary.findMany({ where: { runId, conversationId: "leader" }, orderBy: { toSeq: "asc" } });
    check(
      "post-resume chain audit: exactly ONE active head; superseded rows kept for audit",
      activeHeads.length === 1 && allChain.length >= summaries.length,
      `chain=${allChain.map((s) => s.toSeq + (s.supersededAt ? "*" : "A")).join(",")}`
    );

    // Counters intact: the checkpointed cursor == transcript-derived turns.
    const state = runFinal?.stateJson ? (JSON.parse(runFinal.stateJson) as { turnsUsed?: number }) : null;
    const replyRows = leaderRows.filter((r) => r.kind === "reply").length;
    check(
      "counters intact: checkpointed turnsUsed == canonical reply-row count",
      !!state && state.turnsUsed === replyRows,
      `checkpoint=${state?.turnsUsed} transcriptReplies=${replyRows}`
    );

    // Restored-wire proof from the run's own telemetry:
    const resumeProjectionEvent = await db.agentEvent.findFirst({
      where: { runId, summary: { contains: "Resume replayed the compaction projection" } },
    });
    check(
      "resume seam: 'Resume replayed the compaction projection' telemetry persisted",
      !!resumeProjectionEvent,
      resumeProjectionEvent?.summary.slice(0, 140)
    );
    const orphanErrors = await db.agentEvent.findMany({
      where: { runId, kind: "error" },
      orderBy: { createdAt: "asc" },
      select: { summary: true },
    });
    console.log(`P2-C-LIVE: error events (${orphanErrors.length}) — ${orphanErrors.map((e) => e.summary.slice(0, 90)).join(" || ") || "(none)"}`);
    const resumeNoteRow = leaderRows.find((r) => r.kind === "resume_note" && r.content.includes("[resume] The executor was interrupted"));
    check("resume seam: fresh resume_note row appended on resume (M1 injection source)", !!resumeNoteRow, `seq=${resumeNoteRow?.seq ?? "—"}`);

    // REAL-transcript counterfactual (evidence #1) — the live run's own rows:
    const envelopeRow = leaderRows.find((r) => r.kind === "envelope");
    const legacyWire = legacyReplay(leaderRows as never);
    const disabledWire = assembleWire({ rows: leaderRows as never });
    check(
      "counterfactual on REAL rows: assembler-disabled BYTE-IDENTICAL to legacy replay",
      JSON.stringify(disabledWire.messages) === JSON.stringify(legacyWire) && disabledWire.projected === null
    );
    const legacyTok = legacyWire.reduce((s, m) => s + countTokens(m.content), 0);
    console.log("P2-C-LIVE: ---- measured counterfactual table (REAL transcript) ----");
    console.log("P2-C-LIVE: wire | messages | tokens");
    console.log(`P2-C-LIVE: legacy (full replay) | ${legacyWire.length} | ${legacyTok}`);
    if (activeHeads[0]) {
      const enabled = assembleWire({ rows: leaderRows as never, activeSummaries: activeHeads });
      const enabledTok = enabled.messages.reduce((s, m) => s + countTokens(m.content), 0);
      const saved = legacyTok - enabledTok;
      const pct = legacyTok > 0 ? ((saved / legacyTok) * 100).toFixed(1) : "0.0";
      console.log(`P2-C-LIVE: projected (final chain head) | ${enabled.messages.length} | ${enabledTok}`);
      console.log(`P2-C-LIVE: Σprompt reduction (est.) | — | ${saved} tok (${pct}%)`);
      check(
        "counterfactual on REAL rows: projected wire < legacy wire (measured)",
        enabledTok > 0 && enabledTok < legacyTok,
        `legacy=${legacyTok} projected=${enabledTok} saved=${saved}`
      );
      check(
        "counterfactual on REAL rows: historical resume_note never renders on the projected wire (M1)",
        !enabled.messages.some((m) => m.content.includes("[resume] The executor was interrupted"))
      );
      const head = activeHeads[0];
      check(
        "counterfactual on REAL rows: chain head cover reaches envelope+1",
        head.fromSeq === (envelopeRow?.seq ?? 0) + 1,
        `fromSeq=${head.fromSeq} envelope=${envelopeRow?.seq}`
      );
    }

    // Usage-as-sent semantics (evidence #5):
    const uAll = await usageRows(runId);
    console.log("P2-C-LIVE: full usage table:");
    for (const u of uAll) console.log(`P2-C-LIVE:   used=${u.used} convo=${u.conversation} real=${u.realPrompt ?? "—"} | ${u.summary}`);
    const firstCompactionEvent = await db.agentEvent.findFirst({ where: { runId, summary: { contains: "Context compacted" } }, orderBy: { createdAt: "asc" } });
    if (firstCompactionEvent) {
      const post = uAll.filter((u) => u.at >= firstCompactionEvent.createdAt && u.summary.includes("atlas"));
      const pre = uAll.filter((u) => u.at < firstCompactionEvent.createdAt && u.summary.includes("atlas"));
      const prePeak = Math.max(0, ...pre.map((u) => u.conversation));
      const firstPost = post[0];
      const lastPost = post[post.length - 1];
      check(
        "usage-as-sent: first post-compaction call metered the PROJECTED wire (< pre-compaction peak)",
        !!firstPost && firstPost.conversation < prePeak,
        firstPost ? `firstPostConvo=${firstPost.conversation} vs prePeak=${prePeak}` : "no post-compaction atlas usage"
      );
      check(
        "usage-as-sent: run-end conversation never inflates back to the uncompacted size",
        !!lastPost && lastPost.conversation < legacyTok,
        lastPost ? `lastConvo=${lastPost.conversation} vs legacy=${legacyTok}` : "no post-compaction atlas usage"
      );
    } else {
      check("usage-as-sent: skipped — no compaction fired in the probe", false);
    }

    const compactionEvents2 = await db.agentEvent.count({ where: { runId, summary: { contains: "Context compacted" } } });
    console.log(`P2-C-LIVE: total compaction events=${compactionEvents2} phase1Done=${phase1Done} phase2Done=${phase2Done}`);
    check("probe completed both phases", phase1Done && phase2Done);
  } finally {
    // restore shipped config byte-exact + cascade cleanup
    writeFileSync(YAML_PATH, yamlOriginal);
    const restored = readFileSync(YAML_PATH, "utf8");
    check("budgets.yaml restored byte-exact after the probe", restored === yamlOriginal);
    if (runId) {
      await db.agentRun.delete({ where: { id: runId } }).catch(() => undefined);
      const leftMsg = await db.agentMessage.count({ where: { runId } });
      const leftSum = await db.contextSummary.count({ where: { runId } });
      check("probe run cascade-deleted", leftMsg === 0 && leftSum === 0, `msg=${leftMsg} summary=${leftSum}`);
    }
    if (novelId) {
      await db.novel.delete({ where: { id: novelId } }).catch(() => undefined);
    }
    await db.$disconnect();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`P2-C-LIVE: ${failed.length === 0 ? "ALL CHECKS PASSED" : `${failed.length} CHECK(S) FAILED`} (${checks.length} checks)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("P2-C-LIVE: controller error:", e);
  process.exit(1);
});
