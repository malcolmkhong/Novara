// ---------------------------------------------------------------------------
// Novara AI — P2-b verification (Phase 2, wire assembler + compaction).
//
// ZERO GLM calls. Counterfactual replay harness:
//   A. Corpus REBUILT THROUGH THE PRODUCTION APPEND PATH (lease-fenced
//      appendAgentMessages on a throwaway run) — Phase-1-E2E-shaped content
//      (leader delegate loops, CJK chapter prose, verified feeds, historical
//      markers). Provenance: the accepted Phase 1 cleanup emptied
//      AgentMessage and the pre-Phase-1 backup predates the canonical
//      transcript, so no legacy corpus exists anywhere; these are genuine
//      canonical rows, not in-memory fabrications.
//   B. compaction disabled ⇒ assembleWire === legacyReplay BYTE-IDENTICAL
//      per conversation; merged-user-wire adjacency preserved 1:1.
//   C. decideCut: tail-keeping + minCompactableRows guard.
//   D. Fenced summary write: active row, framing elements, byte-determinism
//      vs the in-process builder, idempotent retry (P2002 ⇒ already=true).
//   E. ABSORB-INPUT SENTINEL: a prior summary's text provably never enters a
//      new projection (chain link rewrites from raw rows only).
//   F. Fencing: stale lease ⇒ LeaseLostError, no row, chain head unchanged.
//   G. Enabled wire: [system_note][envelope][projection][verbatim tail],
//      deterministic across calls.
//   H. Corrupt chain state ⇒ loud fallback to the full raw replay.
//   I. MEASURED token table (legacy vs projected) — pasted into the P2-b
//      report; no hand math anywhere.
// Usage: bun scripts/verify-p2-b.ts
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";
import {
  appendAgentMessages,
  claimLease,
  loadConversation,
  LeaseLostError,
  releaseLease,
  type ExecutorLease,
} from "../src/lib/agent/messages";
import {
  PROJECTION_VERSION,
  assembleWire,
  buildProjectionBody,
  decideCut,
  legacyReplay,
  renderProjection,
  writeCompactionSummary,
  type SequencedRow,
} from "../src/lib/agent/wire";
import { countTokens } from "../src/lib/agent/context-meter";

const db = new PrismaClient();
const TEST_NOVEL_ID = "cmw1mldiz001qqiv8vc2ewluk";
const GOAL = "P2-B corpus run — counterfactual replay harness";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P2-B: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// --- deterministic E2E-shaped content generators -----------------------------

const CJK_SENTENCES = [
  "沈青梧按住剑柄，指尖在青铜门上停了半拍，塔内的灯火随她的呼吸明灭。",
  "楚昭南没有回头，只把染血的袖口挽了上去，声音低得像是从井底传来。",
  "卷轴上的墨迹未干，昨日立下的誓约此刻看来竟像旁人的故事。",
  "雨点砸在天井的石板上，她数着更漏，把每一句要质问的话都咽了回去。",
];

function leaderReply(turn: number): string {
  return [
    `Turn ${turn}: narration — ${CJK_SENTENCES[turn % CJK_SENTENCES.length]}`,
    `Plan check: ${CJK_SENTENCES[(turn + 2) % CJK_SENTENCES.length]} The oath's deadline stays on the page; the archive-tower motif carries the reveal.`,
    "Dispatching the next orders; verified outcomes will decide the following step.",
    "```team-delegate",
    JSON.stringify(
      [
        {
          assignee: "sage",
          title: `Write chapter ${turn}`,
          detail: `Chapter ${turn}: ${CJK_SENTENCES[(turn + 1) % CJK_SENTENCES.length]} Target ${900 + turn} words; keep the archive-tower motif and the oath's deadline on the page. Close on the scorched ledger discovery once the tower sequence completes.`,
          artifactType: "chapter",
          artifactLabel: `Chapter ${turn}`,
        },
        {
          assignee: "prism",
          title: `Review chapter ${turn}`,
          detail: `QC pass on chapter ${turn}: continuity against the oath deadline, 陆怀沙's ledger timestamps, and the tower-fire foreshadow planted in chapter 1.`,
          artifactType: "chapter",
          artifactLabel: `Chapter ${turn}`,
        },
      ],
      null,
      2
    ),
    "```",
    "```run-report",
    JSON.stringify({ chaptersWritten: 0, words: 900 + turn, qcPassed: 1, issues: 0 }),
    "```",
  ].join("\n");
}

function leaderFeed(turn: number): string {
  return (
    `TOOL RESULTS:\n` +
    `1. Task ${turn} (sage) → done (verified) — chapter ${turn} committed, ${900 + turn} words\n` +
    `2. qc: pass (draft ${turn} clean, no repair rounds)\n` +
    `3. ledger: wordcount ledger updated (measured, not claimed)`
  );
}

const ENVELOPE = [
  "AUTHOR GOAL: 续写十章 —— 沈青梧查明档案塔失火的真相，楚昭南的旧誓约必须在第九章兑现。",
  "",
  "IMPACT ASSESSMENT (Task 0, verified read-only — plan around this):",
  `${CJK_SENTENCES[0]}${CJK_SENTENCES[1]} pinned 章节《第一章 档案塔》确立了三件事：塔火并非意外、账册缺了二十年前的半年、陆怀沙的签名有两处笔迹。改动本章会影响：第 2、7 章的塔内时间线；陆怀沙的动机链；第 9 章誓约兑现的倒计时设定。建议执行顺序：先修第一章的火场细节，再补第 7 章的账册对页，最后动第 9 章。`,
  "",
  "PINNED REFS: @chapter:第一章 档案塔 (verbatim context attached at execution time)",
  "",
  "LEAD THE TEAM: read what you need, then dispatch work with ```team-delegate",
  "blocks (JSON array of orders). Each executed order's VERIFIED outcome comes",
  "back to you as a tool result — decide the next step from those, never from",
  "the member's narration alone. Finish with a tool-free reply.",
  "",
  "STORY SNAPSHOT (measured now):",
  ...CJK_SENTENCES.map((s, i) => `- beat ${i + 1}: ${s}`),
  "- cast: 沈青梧(protagonist) 楚昭南(rival) 陆怀沙(archivist)",
  "- promises: 旧誓约于第九章兑现 (due ch9, made ch1)",
  "- clues: 火场账册缺页 (planted ch1, reveal ch7)",
].join("\n");

const ATLAS_SYSTEM = [
  "You are Atlas, the leader of a five-agent novel-writing team.",
  "Contract: verified DB writes only — model self-report never advances state.",
  ...CJK_SENTENCES,
  "Tools are prose blocks (```novel-tool / ```team-delegate); think → act → observe.",
].join("\n");

const SAGE_SYSTEM = [
  "You are Sage, the prose craftsperson.",
  ...CJK_SENTENCES,
  "Chapters are committed only through the write gate; repairs are explicit.",
].join("\n");

const MEMBER_ENVELOPE = [
  "TASK: Write chapter 1 of the archive-tower arc.",
  `BRIEF: ${CJK_SENTENCES[0]} End on the discovery of the scorched ledger.`,
  "CONTRACT: 900+ words, verbatim commit through the write gate.",
].join("\n");

const CHAPTER_DRAFT = [
  `第一章 档案塔\n`,
  ...Array.from({ length: 8 }, (_, i) => CJK_SENTENCES[i % CJK_SENTENCES.length]).join(""),
  "她在灰烬里翻出半页账册，火燎的边缘卷曲如枯叶——那正是二十年前的那一笔。",
  ...Array.from({ length: 8 }, (_, i) => CJK_SENTENCES[(i + 2) % CJK_SENTENCES.length]).join(""),
].join("\n");

const CHAPTER_REPAIR = CHAPTER_DRAFT.replace("二十年前的那一笔", "二十一年前的那一笔——多出的一年，正是誓约的期限。");

// --- corpus builder (PRODUCTION append path only) ----------------------------

type ConvSpec = { name: string; build: (runId: string, lease: ExecutorLease) => Promise<void> };

const corpusSpecs: ConvSpec[] = [
  {
    // §8 worst case: full-budget leader run — 22 delegate turns. Corpus is
    // CALIBRATED to the reviewer's predicted ~9–10K conversation-section
    // ceiling (real envelopes carry the ≤2400-char impact assessment; real
    // replies carry multi-order delegate blocks) — validated by measurement
    // below, never by fiat.
    name: "corpus-leader-max",
    build: async (runId, lease) => {
      await appendAgentMessages(lease, [
        { runId, conversationId: "corpus-leader-max", taskId: null, agent: "atlas", role: "assistant", kind: "system_note", content: ATLAS_SYSTEM },
        { runId, conversationId: "corpus-leader-max", taskId: null, agent: "atlas", role: "user", kind: "envelope", content: ENVELOPE },
      ]);
      for (let turn = 1; turn <= 22; turn++) {
        await appendAgentMessages(lease, [
          { runId, conversationId: "corpus-leader-max", taskId: null, agent: "atlas", role: "assistant", kind: "reply", content: leaderReply(turn) },
          { runId, conversationId: "corpus-leader-max", taskId: null, agent: "atlas", role: "user", kind: "tool_results", content: leaderFeed(turn) },
        ]);
      }
    },
  },
  {
    // Gate-shaped leader run: historical resume_note marker + gate-stop batch.
    name: "corpus-leader-gated",
    build: async (runId, lease) => {
      const conv = "corpus-leader-gated";
      await appendAgentMessages(lease, [
        { runId, conversationId: conv, taskId: null, agent: "atlas", role: "assistant", kind: "system_note", content: ATLAS_SYSTEM },
        { runId, conversationId: conv, taskId: null, agent: "atlas", role: "user", kind: "envelope", content: ENVELOPE },
      ]);
      for (let turn = 1; turn <= 4; turn++) {
        await appendAgentMessages(lease, [
          { runId, conversationId: conv, taskId: null, agent: "atlas", role: "assistant", kind: "reply", content: leaderReply(turn) },
          { runId, conversationId: conv, taskId: null, agent: "atlas", role: "user", kind: "tool_results", content: leaderFeed(turn) },
        ]);
      }
      // Historical marker (audit row; never replayed).
      await appendAgentMessages(lease, [
        { runId, conversationId: conv, taskId: null, agent: "atlas", role: "user", kind: "resume_note", content: "[resume] executor recovered from canonical transcript — re-dispatch pending work." },
      ]);
      for (let turn = 5; turn <= 9; turn++) {
        await appendAgentMessages(lease, [
          { runId, conversationId: conv, taskId: null, agent: "atlas", role: "assistant", kind: "reply", content: leaderReply(turn) },
          { runId, conversationId: conv, taskId: null, agent: "atlas", role: "user", kind: "tool_results", content: leaderFeed(turn) },
        ]);
      }
      // Gate-stop batch — reply + partial feeds + marker, one atomic batch.
      await appendAgentMessages(lease, [
        { runId, conversationId: conv, taskId: null, agent: "atlas", role: "assistant", kind: "reply", content: leaderReply(10) },
        { runId, conversationId: conv, taskId: null, agent: "atlas", role: "user", kind: "tool_results", content: `TOOL RESULTS:\n${leaderFeed(10)}\n(gate stop: Task 10 left the loop at the approval gate.)` },
        { runId, conversationId: conv, taskId: null, agent: "atlas", role: "user", kind: "gate_stop", content: "GATE STOP — Task 10 paused at the approval gate." },
      ]);
    },
  },
  {
    // CJK-heavy member write task with repair round ⇒ consecutive user rows.
    name: "corpus-member-write",
    build: async (runId, lease) => {
      const conv = "corpus-member-write";
      await appendAgentMessages(lease, [
        { runId, conversationId: conv, taskId: null, agent: "sage", role: "assistant", kind: "system_note", content: SAGE_SYSTEM },
        { runId, conversationId: conv, taskId: null, agent: "sage", role: "user", kind: "envelope", content: MEMBER_ENVELOPE },
        { runId, conversationId: conv, taskId: null, agent: "sage", role: "assistant", kind: "reply", content: CHAPTER_DRAFT },
        { runId, conversationId: conv, taskId: null, agent: "sage", role: "user", kind: "tool_results", content: "TOOL RESULTS:\n1. write_gate: committed draft 1 — 1024 words (measured)" },
        // Verify FAILED → repair note lands directly after the feed (two
        // consecutive user rows on the persisted transcript and the wire).
        { runId, conversationId: conv, taskId: null, agent: "sage", role: "user", kind: "repair", content: "VERIFY FAILED: oath deadline (第九章) missing from the draft — revise and resubmit." },
        { runId, conversationId: conv, taskId: null, agent: "sage", role: "assistant", kind: "reply", content: CHAPTER_REPAIR },
        { runId, conversationId: conv, taskId: null, agent: "sage", role: "user", kind: "tool_results", content: "TOOL RESULTS:\n1. write_gate: committed draft 2 — 1041 words (measured); qc pass" },
      ]);
    },
  },
  {
    name: "corpus-member-read",
    build: async (runId, lease) => {
      const conv = "corpus-member-read";
      await appendAgentMessages(lease, [
        { runId, conversationId: conv, taskId: null, agent: "nova", role: "assistant", kind: "system_note", content: SAGE_SYSTEM },
        { runId, conversationId: conv, taskId: null, agent: "nova", role: "user", kind: "envelope", content: "TASK: read-only continuity check on the archive-tower chapters." },
        { runId, conversationId: conv, taskId: null, agent: "nova", role: "assistant", kind: "reply", content: `Reading chapters 1–4 for continuity.\n${CJK_SENTENCES[1]}` },
        { runId, conversationId: conv, taskId: null, agent: "nova", role: "user", kind: "tool_results", content: "TOOL RESULTS:\n1. read: 4 chapters, 0 continuity conflicts found" },
      ]);
    },
  },
];

const CONV_NAMES = corpusSpecs.map((c) => c.name);

// --- helpers ------------------------------------------------------------------

async function loadRows(runId: string, conv: string): Promise<SequencedRow[]> {
  return loadConversation(runId, conv);
}

function wireTokens(messages: { content: string }[]): number {
  return messages.reduce((sum, m) => sum + countTokens(m.content), 0);
}

function hasUserAdjacency(messages: { role: string }[]): number {
  let n = 0;
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "user" && messages[i - 1].role === "user") n += 1;
  }
  return n;
}

const SENTINEL = "SENTINEL-PRIOR-TEXT-7f3a must never leak into any projection";

// --- main ---------------------------------------------------------------------

async function main() {
  let novel = await db.novel.findUnique({ where: { id: TEST_NOVEL_ID }, select: { id: true } });
  if (!novel) {
    novel = await db.novel.create({ data: { title: "[p2-b-verify] scratch novel", genre: "test" }, select: { id: true } });
  }
  const run = await db.agentRun.create({
    data: { novelId: novel.id, goal: GOAL, status: "completed" },
    select: { id: true },
  });
  const runId = run.id;

  try {
    // --- A. corpus through the production append path ----------------------
    const lease = await claimLease(runId);
    check("lease claimed for corpus run", !!lease);
    for (const spec of corpusSpecs) {
      await spec.build(runId, lease!);
      const rows = await loadRows(runId, spec.name);
      check(`corpus ${spec.name} persisted via production path`, rows.length >= 4, `rows=${rows.length}`);
    }
    const leaderRows = await loadRows(runId, "corpus-leader-max");
    check("leader-max corpus shape matches the §8 worst case", leaderRows.length === 2 + 22 * 2, `rows=${leaderRows.length}`);

    // --- B. disabled ⇒ byte-identical + merged-user-wire shape -------------
    let adjacencyTotal = 0;
    for (const conv of CONV_NAMES) {
      const rows = await loadRows(runId, conv);
      const legacy = legacyReplay(rows);
      const assembled = assembleWire({ rows });
      const identical = JSON.stringify(legacy) === JSON.stringify(assembled.messages);
      check(
        `disabled replay BYTE-IDENTICAL to legacy — ${conv}`,
        identical && assembled.projected === null && assembled.fallbackWarnings.length === 0,
        `rows=${rows.length}`
      );
      const adjacency = hasUserAdjacency(legacy);
      adjacencyTotal += adjacency;
      if (conv === "corpus-member-write") {
        check(
          "merged-user-wire shape: consecutive user rows preserved 1:1 (tool_results + repair), never merged",
          adjacency === 1 && identical,
          `adjacency=${adjacency}`
        );
      }
    }
    check("corpus exercises the consecutive-user wire shape", adjacencyTotal >= 1, `adjacencies=${adjacencyTotal}`);

    // --- C. cut selection ----------------------------------------------------
    const cut8 = decideCut(leaderRows, 8, 12);
    check(
      "decideCut keeps the last 8 reply turns verbatim",
      !!cut8 && cut8.cut === 30 && cut8.coverableRows === 28,
      cut8 ? `cut=${cut8.cut} coverable=${cut8.coverableRows}` : "null"
    );
    check(
      "decideCut refuses under-min rows / short conversations",
      decideCut(leaderRows, 8, 40) === null &&
        decideCut(await loadRows(runId, "corpus-member-write"), 8, 12) === null &&
        decideCut(await loadRows(runId, "corpus-member-read"), 8, 12) === null
    );

    // --- E(part 1). plant the sentinel as a fake PRIOR active summary -------
    const sentinelRow = await db.contextSummary.create({
      data: {
        runId,
        conversationId: "corpus-leader-max",
        taskId: null,
        agent: "atlas",
        fromSeq: 3,
        toSeq: 10,
        summary: SENTINEL,
        leaseEpoch: lease!.epoch,
      },
    });

    // --- D. fenced summary write + framing + byte-determinism ---------------
    const written = await writeCompactionSummary({
      runId,
      conversationId: "corpus-leader-max",
      taskId: null,
      agent: "atlas",
      rows: leaderRows,
      newCut: cut8!.cut,
      lease: lease!,
    });
    check(
      "writeCompactionSummary lands the chain link",
      written.ok && !written.already && !!written.row && written.row.fromSeq === 3 && written.row.toSeq === 30,
      `cut=${written.row?.toSeq}`
    );
    const rebuilt = renderProjection(3, cut8!.cut, buildProjectionBody(leaderRows, 3, cut8!.cut));
    check(
      "stored summary is BYTE-IDENTICAL to the deterministic rebuild from raw rows",
      written.row?.summary === rebuilt
    );
    const frame = written.row?.summary ?? "";
    check(
      "projection framing carries all four pinned elements",
      frame.startsWith("[CONTEXT PROJECTION ") &&
        frame.includes(PROJECTION_VERSION) &&
        frame.includes(`seq 3..${cut8!.cut}`) &&
        frame.includes("NOT verbatim history") &&
        frame.includes("Originals remain in canonical history") &&
        frame.includes("read tools") &&
        frame.trimEnd().endsWith("[/CONTEXT PROJECTION]"),
      PROJECTION_VERSION
    );
    const retry = await writeCompactionSummary({
      runId,
      conversationId: "corpus-leader-max",
      taskId: null,
      agent: "atlas",
      rows: leaderRows,
      newCut: cut8!.cut,
      lease: lease!,
    });
    const activeAfterRetry = await db.contextSummary.count({
      where: { runId, conversationId: "corpus-leader-max", supersededAt: null },
    });
    check(
      "idempotent retry at the same cut ⇒ already=true, still ONE active head",
      retry.ok && retry.already === true && activeAfterRetry === 1,
      `active=${activeAfterRetry}`
    );

    // --- E(part 2). sentinel leak check + chain link 2 ----------------------
    const activeAfterLink1 = await db.contextSummary.findFirst({
      where: { runId, conversationId: "corpus-leader-max", supersededAt: null },
    });
    check("sentinel prior was superseded by the real write (audit trail intact)", activeAfterLink1?.id !== sentinelRow.id && (await db.contextSummary.findUnique({ where: { id: sentinelRow.id } }))?.supersededAt !== null);
    check("prior summary text NEVER enters the new projection (absorb-input rule)", !(activeAfterLink1?.summary ?? "").includes("SENTINEL-PRIOR-TEXT-7f3a"));

    const cut2 = decideCut(leaderRows, 2, 12)!;
    const link2 = await writeCompactionSummary({
      runId,
      conversationId: "corpus-leader-max",
      taskId: null,
      agent: "atlas",
      rows: leaderRows,
      newCut: cut2.cut,
      lease: lease!,
    });
    check(
      "chain link 2 lands (cut extends, head reaches back to the first compacted seq)",
      link2.ok && link2.row?.toSeq === cut2.cut && link2.row?.fromSeq === 3,
      `cut=${link2.row?.toSeq}`
    );
    const chain = await db.contextSummary.findMany({
      where: { runId, conversationId: "corpus-leader-max" },
      orderBy: { toSeq: "asc" },
    });
    const activeLink2 = chain.filter((r) => r.supersededAt === null);
    check(
      "exactly ONE active head after link 2; superseded rows persist for audit",
      chain.length === 3 && activeLink2.length === 1 && activeLink2[0].toSeq === cut2.cut,
      `rows=${chain.length} active=${activeLink2.length}`
    );
    check("chain link 2 also contains no sentinel text", !activeLink2[0].summary.includes("SENTINEL-PRIOR-TEXT-7f3a"));

    // --- F. fencing: stale lease ⇒ LeaseLostError, nothing lands ------------
    await db.agentRun.update({
      where: { id: runId },
      data: { leaseHeartbeatAt: new Date(Date.now() - 300_000) },
    });
    const newLease = await claimLease(runId);
    check("lease stolen by a fresh claimer (epoch bumped)", !!newLease && newLease.epoch === lease!.epoch + 1);
    let fenced = false;
    try {
      await writeCompactionSummary({
        runId,
        conversationId: "corpus-leader-max",
        taskId: null,
        agent: "atlas",
        rows: leaderRows,
        newCut: cut2.cut + 2,
        lease: lease!, // deposed writer
      });
    } catch (e) {
      fenced = e instanceof LeaseLostError;
    }
    const rowsAtFencedCut = await db.contextSummary.count({
      where: { runId, conversationId: "corpus-leader-max", toSeq: cut2.cut + 2 },
    });
    check(
      "DEPOSED writer lands count=0 (LeaseLostError, no row, head unchanged)",
      fenced && rowsAtFencedCut === 0 && (await db.contextSummary.count({ where: { runId, conversationId: "corpus-leader-max", supersededAt: null } })) === 1,
      `fenced=${fenced} rowsAtCut=${rowsAtFencedCut}`
    );
    await releaseLease(runId, newLease!);

    // --- G. enabled wire: projection + verbatim tail, deterministic ---------
    const freshRows = await loadRows(runId, "corpus-leader-max");
    const activeSummaries = await db.contextSummary.findMany({
      where: { runId, conversationId: "corpus-leader-max", supersededAt: null },
    });
    const assembledOn = assembleWire({ rows: freshRows, activeSummaries });
    const sysRow = freshRows[0];
    const envRow = freshRows[1];
    const tailRows = freshRows.filter((r) => r.seq > cut2.cut && r.kind !== "gate_stop" && r.kind !== "resume_note");
    check(
      "enabled wire = [system_note][envelope][projection][verbatim tail]",
      assembledOn.fallbackWarnings.length === 0 &&
        assembledOn.messages[0].content === sysRow.content &&
        assembledOn.messages[1].content === envRow.content &&
        assembledOn.messages[2].role === "user" &&
        assembledOn.messages[2].content === activeSummaries[0].summary &&
        assembledOn.messages.length === 3 + tailRows.length &&
        tailRows.every((r, i) => assembledOn.messages[3 + i].content === r.content && assembledOn.messages[3 + i].role === r.role),
      `messages=${assembledOn.messages.length} tail=${tailRows.length}`
    );
    check(
      "assembler reports the projection block",
      !!assembledOn.projected && assembledOn.projected.fromSeq === 3 && assembledOn.projected.toSeq === cut2.cut
    );
    const assembledAgain = assembleWire({ rows: freshRows, activeSummaries });
    check("enabled wire is byte-deterministic across calls", JSON.stringify(assembledAgain) === JSON.stringify(assembledOn));

    // --- H. corrupt chain state ⇒ loud fallback to raw replay ---------------
    const legacy = legacyReplay(freshRows);
    const headGap = assembleWire({ rows: freshRows, activeSummaries: [{ fromSeq: 5, toSeq: cut2.cut, summary: "corrupt" }] });
    check(
      "head gap (fromSeq≠envelope+1) ⇒ full raw replay fallback + warning",
      JSON.stringify(headGap.messages) === JSON.stringify(legacy) && headGap.fallbackWarnings.some((w) => w.includes("head gap")),
      headGap.fallbackWarnings[0] ?? ""
    );
    const overshoot = assembleWire({ rows: freshRows, activeSummaries: [{ fromSeq: 3, toSeq: 9999, summary: "corrupt" }] });
    check(
      "cover overshoot ⇒ fallback + warning",
      JSON.stringify(overshoot.messages) === JSON.stringify(legacy) && overshoot.fallbackWarnings.some((w) => w.includes("overshoot"))
    );
    const doubleActive = assembleWire({ rows: freshRows, activeSummaries: [activeSummaries[0], { fromSeq: 3, toSeq: 12, summary: "second head" }] });
    check(
      "two active heads ⇒ fallback + warning (corrupt state never projected)",
      JSON.stringify(doubleActive.messages) === JSON.stringify(legacy) && doubleActive.fallbackWarnings.some((w) => w.includes("corrupt chain state"))
    );

    // --- I. MEASURED numbers (pasted into the report; no hand math) ---------
    console.log("P2-B: ---- measured token table (countTokens over wire message contents) ----");
    console.log("P2-B: conversation | wireRows | legacyTok | projectedTok | savedTok | saved% | eligible@defaults");
    for (const conv of CONV_NAMES) {
      const rows = await loadRows(runId, conv);
      const legacyWire = legacyReplay(rows);
      const legacyTok = wireTokens(legacyWire);
      const cut = decideCut(rows, 8, 12);
      let line = `${conv} | ${legacyWire.length} | ${legacyTok} | — | — | — | ${cut ? `yes(cut=${cut.cut})` : "no"}`;
      if (cut) {
        const projText = renderProjection(3, cut.cut, buildProjectionBody(rows, 3, cut.cut));
        const sys = rows.find((r) => r.kind === "system_note");
        const env = rows.find((r) => r.kind === "envelope");
        const tail = rows.filter((r) => r.seq > cut.cut && r.kind !== "gate_stop" && r.kind !== "resume_note");
        const projectedWire = [
          ...(sys ? [{ role: sys.role, content: sys.content }] : []),
          ...(env ? [{ role: env.role, content: env.content }] : []),
          { role: "user" as const, content: projText },
          ...tail.map((r) => ({ role: r.role, content: r.content })),
        ];
        const projectedTok = wireTokens(projectedWire);
        const saved = legacyTok - projectedTok;
        const pct = legacyTok > 0 ? ((saved / legacyTok) * 100).toFixed(1) : "0.0";
        line = `${conv} | ${legacyWire.length} | ${legacyTok} | ${projectedTok} | ${saved} | ${pct}% | yes(cut=${cut.cut})`;
      }
      console.log(`P2-B: ${line}`);
    }
    // Second measurement point: leader-max at tailTurns=2 (the chain-link-2 cut).
    {
      const rows = freshRows;
      const legacyTok = wireTokens(legacy);
      const projText = activeLink2[0].summary;
      const tail = rows.filter((r) => r.seq > cut2.cut && r.kind !== "gate_stop" && r.kind !== "resume_note");
      const projectedTok = wireTokens([
        { role: "assistant" as const, content: rows[0].content },
        { role: "user" as const, content: rows[1].content },
        { role: "user" as const, content: projText },
        ...tail.map((r) => ({ role: r.role, content: r.content })),
      ]);
      const saved = legacyTok - projectedTok;
      const pct = ((saved / legacyTok) * 100).toFixed(1);
      console.log(`P2-B: corpus-leader-max@tail2 | ${legacy.length} | ${legacyTok} | ${projectedTok} | ${saved} | ${pct}% | tailTurns=2`);
      check("compaction SAVES measured tokens on the worst-case corpus", saved > 0 && projectedTok < legacyTok, `saved=${saved}tok`);
      check(
        "trigger reachability: worst-case legacy conversation exceeds the 6000 default",
        legacyTok > 6000,
        `legacyTok=${legacyTok}`
      );
    }
  } finally {
    // --- cleanup: throwaway run cascades messages + summaries --------------
    await db.agentRun.delete({ where: { id: runId } }).catch(() => undefined);
    const msgLeft = await db.agentMessage.count({ where: { runId } });
    const sumLeft = await db.contextSummary.count({ where: { runId } });
    check("cascade delete removed corpus transcript rows", msgLeft === 0, `left=${msgLeft}`);
    check("cascade delete removed corpus summary rows", sumLeft === 0, `left=${sumLeft}`);
    await db.$disconnect();
  }

  console.log(`P2-B: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("P2-B: harness error:", e);
  process.exit(1);
});
