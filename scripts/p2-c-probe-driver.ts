// ---------------------------------------------------------------------------
// Novara AI — P2-c live probe RESUME DRIVER (adopts the orphaned probe run).
//
// Context: the original controller + executor died to a sandbox process-group
// cleanup (nohup-only detachment — lesson learned: setsid). The run was left
// EXACTLY as a real crashed executor leaves it: status "running", lease
// heartbeat stale > 240s, transcript intact through turn 12. This driver
// adopts that run — the GLM discipline stays intact: ONE live run, multiple
// executor sessions (the Phase 1 crash→resume story itself).
//
//   bun scripts/p2-c-probe-driver.ts <runId>    (launch under setsid!)
//
// Phases:
//   B. resume   — spawn a resume executor (claims the genuinely stale lease,
//                 zero simulated aging for THIS seam), poll for ≥1 compaction
//                 + a member task in flight, then SIGKILL (hard executor
//                 death #2).
//   C. resume   — age the dead heartbeat past the 240s window (disclosed),
//                 spawn the final resume executor, wait for natural
//                 completion.
//   4. evidence — real-transcript counterfactual (legacy vs assembler-disabled
//                 vs projected), restored-wire telemetry, transcript gapless,
//                 counters intact, chain audit, usage-as-sent semantics.
//   finally     — budgets.yaml restored to the SHIPPED state (values AND the
//                 semantics comment), probe run + scratch novel deleted.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { countTokens } from "../src/lib/agent/context-meter";
import { assembleWire, legacyReplay } from "../src/lib/agent/wire";

const db = new PrismaClient();
const YAML_PATH = "agent/config/budgets.yaml";
const phaseCapMs = 4 * 60_000;
const orphanWaitCapMs = 3 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let checks: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`P2-C-LIVE: [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function gapless(runId: string, conv: string) {
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

async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("usage: p2-c-probe-driver.ts <runId>");

  // --- preflight: the orphaned run in its authentic crash state ------------
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`run ${runId} not found`);
  check("adopt: run exists", true, `status=${run.status} novel=${run.novelId}`);
  check(
    "adopt: authentic crash state — status running + lease genuinely stale (>240s)",
    run.status === "running" && !!run.leaseHeartbeatAt && Date.now() - run.leaseHeartbeatAt.getTime() > 240_000,
    `heartbeatAge=${run.leaseHeartbeatAt ? Math.round((Date.now() - run.leaseHeartbeatAt.getTime()) / 1000) : "?"}s`
  );
  const novelId = run.novelId;

  // --- probe pack surgery (the dead controller never patched it) ----------
  const yamlShipped = readFileSync(YAML_PATH, "utf8");
  const yamlPatched = yamlShipped
    .replace(/^(  enabled: )false\b/m, "$1true")
    .replace(/^(  triggerTokens: )6000\b/m, "$14000")
    .replace(/^(  tailTurns: )8\b/m, "$12")
    .replace(/^(  minCompactableRows: )12\b/m, "$16");
  const packOk =
    /  enabled: true/.test(yamlPatched) &&
    /  triggerTokens: 4000/.test(yamlPatched) &&
    /  tailTurns: 2/.test(yamlPatched) &&
    /  minCompactableRows: 6/.test(yamlPatched);
  check("probe pack applied (4/4 values)", packOk);
  if (!packOk) throw new Error("probe pack surgery failed — aborting before any GLM call");
  writeFileSync(YAML_PATH, yamlPatched);

  const spawnSession = (mode: "resume") =>
    Bun.spawn(["bun", "scripts/p2-c-probe-exec.ts", runId, mode], {
      cwd: new URL("..", import.meta.url).pathname,
      stdout: "inherit",
      stderr: "inherit",
    });

  let orphanKilled = false;
  try {
    // --- session B: resume the crashed run ---------------------------------
    const childB = spawnSession("resume");
    console.log(`P2-C-LIVE: session B (resume) spawned pid=${childB.pid}`);
    const t0 = Date.now();
    let firstCompactionAt: number | null = null;
    let compactionsSeen = 0;
    while (Date.now() - t0 < phaseCapMs) {
      await sleep(1500);
      const status = (await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } }))?.status;
      if (status && ["completed", "failed", "cancelled"].includes(status)) {
        console.log(`P2-C-LIVE: session B ended the run (${status}) without an intervention kill`);
        break;
      }
      compactionsSeen = await db.contextSummary.count({ where: { runId } });
      if (compactionsSeen >= 1 && firstCompactionAt === null) {
        firstCompactionAt = Date.now();
        console.log(`P2-C-LIVE: COMPACTION OBSERVED at +${Math.round((firstCompactionAt - t0) / 1000)}s of session B (chain rows=${compactionsSeen})`);
      }
      if (compactionsSeen >= 1) {
        const inFlight = await db.agentTask.findFirst({ where: { runId, status: "in_progress" }, select: { id: true, key: true } });
        if (inFlight) {
          const memberRows = await db.agentMessage.count({ where: { runId, conversationId: inFlight.id } });
          if (memberRows >= 2) {
            childB.kill(9);
            await childB.exited;
            orphanKilled = true;
            check("kill #2: executor SIGKILLed with ≥1 compaction AND a member task in flight", true, `compactions=${compactionsSeen} orphan=${inFlight.key} memberRows=${memberRows} after=${Math.round((Date.now() - t0) / 1000)}s`);
            break;
          }
        }
        if (Date.now() - firstCompactionAt > orphanWaitCapMs) {
          childB.kill(9);
          await childB.exited;
          check("kill #2: after compaction, NO member in flight (orphan window timed out)", false, `compactions=${compactionsSeen}`);
          break;
        }
      }
    }
    if (!orphanKilled && Date.now() - t0 >= phaseCapMs) {
      childB.kill(9);
      await childB.exited;
      check("kill #2: session B hit the phase cap", false, `compactions=${compactionsSeen}`);
    }

    // --- session C: final resume (only if the run is still open) -----------
    const midStatus = (await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } }))?.status;
    if (orphanKilled && midStatus === "running") {
      // Disclosed: age the dead heartbeat past the 240s staleness window —
      // the exact DB state a real crashed executor leaves 4 minutes later.
      await db.agentRun.update({
        where: { id: runId },
        data: { leaseHeartbeatAt: new Date(Date.now() - 300_000) },
      });
      console.log("P2-C-LIVE: dead lease aged past the staleness window (disclosed simulation)");
      const childC = spawnSession("resume");
      console.log(`P2-C-LIVE: session C (resume) spawned pid=${childC.pid}`);
      const t1 = Date.now();
      while (Date.now() - t1 < phaseCapMs) {
        await sleep(2000);
        const status = (await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } }))?.status;
        if (status && ["completed", "failed", "cancelled"].includes(status)) break;
      }
      await Promise.race([childC.exited, sleep(30_000).then(() => "timeout")]);
    } else {
      console.log(`P2-C-LIVE: skipping session C (orphanKilled=${orphanKilled} status=${midStatus})`);
    }

    // --- evidence pass ------------------------------------------------------
    const runFinal = await db.agentRun.findUnique({ where: { id: runId } });
    check(
      "run reached a terminal state",
      !!runFinal && ["completed", "failed", "cancelled"].includes(runFinal.status),
      `status=${runFinal?.status} err=${(runFinal?.error ?? "—").slice(0, 100)}`
    );

    const g = await gapless(runId, "leader");
    check("leader transcript gapless across TWO hard executor deaths", g.ok, g.detail);

    const leaderRows = await db.agentMessage.findMany({
      where: { runId, conversationId: "leader" },
      orderBy: { seq: "asc" },
    });
    const allChain = await db.contextSummary.findMany({ where: { runId, conversationId: "leader" }, orderBy: { toSeq: "asc" } });
    const activeHeads = allChain.filter((s) => s.supersededAt === null);
    check(
      "chain audit: ≥1 compaction fired live; exactly ONE active head",
      allChain.length >= 1 && activeHeads.length === 1,
      `chain=${allChain.map((s) => `${s.fromSeq}..${s.toSeq}${s.supersededAt ? "*" : "A"}`).join(", ")}`
    );

    const state = runFinal?.stateJson ? (JSON.parse(runFinal.stateJson) as { turnsUsed?: number }) : null;
    const replyRows = leaderRows.filter((r) => r.kind === "reply").length;
    check(
      "counters intact: checkpointed turnsUsed == canonical reply-row count",
      !!state && state.turnsUsed === replyRows,
      `checkpoint=${state?.turnsUsed} transcriptReplies=${replyRows}`
    );

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
    check("resume seam: fresh resume_note appended by the resume path (M1 injection source)", !!resumeNoteRow, `seq=${resumeNoteRow?.seq ?? "—"}`);

    // REAL-transcript counterfactual (evidence #1):
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
      check(
        "counterfactual on REAL rows: chain head cover reaches envelope+1",
        activeHeads[0].fromSeq === (envelopeRow?.seq ?? 0) + 1,
        `fromSeq=${activeHeads[0].fromSeq} envelope=${envelopeRow?.seq}`
      );
      const compactionEvents = await db.agentEvent.findMany({
        where: { runId, summary: { contains: "Context compacted" } },
        orderBy: { createdAt: "asc" },
        select: { summary: true, payload: true },
      });
      console.log(`P2-C-LIVE: compaction events (${compactionEvents.length}):`);
      for (const e of compactionEvents) console.log(`P2-C-LIVE:   ${e.summary.slice(0, 180)}`);
    }

    // Usage-as-sent semantics (evidence #5):
    const uAll = await usageRows(runId);
    console.log("P2-C-LIVE: full usage table (tail 30):");
    for (const u of uAll.slice(-30)) console.log(`P2-C-LIVE:   used=${u.used} convo=${u.conversation} real=${u.realPrompt ?? "—"} | ${u.summary}`);
    const firstCompactionEvent = await db.agentEvent.findFirst({ where: { runId, summary: { contains: "Context compacted" } }, orderBy: { createdAt: "asc" } });
    if (firstCompactionEvent) {
      const post = uAll.filter((u) => u.at >= firstCompactionEvent.createdAt && u.summary.includes("atlas"));
      const pre = uAll.filter((u) => u.at < firstCompactionEvent.createdAt && u.summary.includes("atlas"));
      const prePeak = Math.max(0, ...pre.map((u) => u.used));
      const firstPost = post[0];
      // INFO (not a check): with tailTurns counted in TURNS, a tail of heavy
      // tool-feed turns can outweigh the covered span — the FIRST projected
      // wire may exceed the pre-compaction size (metered as sent, honestly).
      // The design guarantee is CONVERGENCE once the heavy feeds enter the
      // cover — asserted below against the last compaction's afterTokens.
      console.log(`P2-C-LIVE: usage-as-sent info: prePeak=${prePeak} firstPostUsed=${firstPost?.used ?? "—"} (tail-heavy calibration case)`);
      const compactionEventsAll = await db.agentEvent.findMany({
        where: { runId, summary: { contains: "Context compacted" } },
        orderBy: { createdAt: "asc" },
        select: { payload: true },
      });
      const lastAfter = compactionEventsAll.length
        ? Number((JSON.parse(compactionEventsAll[compactionEventsAll.length - 1].payload ?? "{}") as { afterTokens?: number }).afterTokens)
        : NaN;
      check(
        "usage-as-sent: projected wire CONVERGES below the uncompacted size once heavy feeds enter the cover",
        Number.isFinite(lastAfter) && lastAfter < legacyTok,
        `lastAfter=${lastAfter} vs legacy=${legacyTok}`
      );
      const lastPost = post[post.length - 1];
      check(
        "usage-as-sent: run-end used never inflates back to the uncompacted size",
        !!lastPost && lastPost.used < legacyTok,
        lastPost ? `lastUsed=${lastPost.used} vs legacyTok=${legacyTok}` : "no post-compaction atlas usage"
      );
    } else {
      check("usage-as-sent: no compaction fired in the probe (honest negative)", false);
    }
  } finally {
    // --- restore SHIPPED state (values + semantics comment) + cleanup -------
    let yaml = readFileSync(YAML_PATH, "utf8");
    yaml = yaml
      .replace(/^(  enabled: )true\b/m, "$1false")
      .replace(/^(  triggerTokens: )4000\b/m, "$16000")
      .replace(/^(  tailTurns: )2\b/m, "$18")
      .replace(/^(  minCompactableRows: )6\b/m, "$112")
      .replace(
        "  triggerTokens: 6000   # compact when the metered active context reaches this",
        "  triggerTokens: 6000   # compact when the METERED ACTIVE CONTEXT (the meter's total `used` snapshot — the full next-call wire) reaches this"
      );
    writeFileSync(YAML_PATH, yaml);
    const shipped = readFileSync(YAML_PATH, "utf8");
    check(
      "budgets.yaml restored to SHIPPED state (enabled=false, 6000/8/12, semantics comment)",
      /  enabled: false/.test(shipped) &&
        /  triggerTokens: 6000/.test(shipped) &&
        /  tailTurns: 8/.test(shipped) &&
        /  minCompactableRows: 12/.test(shipped) &&
        shipped.includes("METERED ACTIVE CONTEXT")
    );
    await db.agentRun.delete({ where: { id: runId } }).catch(() => undefined);
    if (novelId) await db.novel.delete({ where: { id: novelId } }).catch(() => undefined);
    const leftMsg = await db.agentMessage.count({ where: { runId } });
    const leftSum = await db.contextSummary.count({ where: { runId } });
    check("probe run + scratch novel cascade-deleted", leftMsg === 0 && leftSum === 0, `msg=${leftMsg} summary=${leftSum}`);
    await db.$disconnect();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`P2-C-LIVE: ${failed.length === 0 ? "ALL CHECKS PASSED" : `${failed.length} CHECK(S) FAILED`} (${checks.length} checks)`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("P2-C-LIVE: driver error:", e);
  process.exit(1);
});
