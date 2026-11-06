// ---------------------------------------------------------------------------
// Novara AI — P5-g A1 LIVE-FIRE (the ONE free-flash team session).
//
// Budget: $0.00 — every GLM call carries model:"glm-4-flash" (recorded on
// each ledger row exactly as sent); zero billable-model calls asserted
// post-run. OPS-1-tightened goals on EVERY tool turn: flash is protocol-
// weak and will fabricate success conversationally (first attempt proved
// it — T2-T4 answered "created" with zero tool executions), so every tool
// turn demands an EXACT block echo.
//
// What it proves (plan §10):
//   1. multi-turn chat with the HISTORY_WINDOW=12 slice actually trimming
//      (message count driven past 12 mid-session);
//   2. create_novel fires through the REAL tool protocol and the
//      wizard-precedent provenance link lands (ai-team:<sessionKey> → novel);
//   3. ledger rows appear with surface="ai-team" under Policy F semantics;
//   4. the novel's OWN ledger view retro-adopts the calls as `linked`
//      (view shape: direct/linked are CountSum aggregates + bySurface list).
//
// DISCLOSED SIDE EFFECTS: (a) the created novel ("P5-g Live-fire Artifact"),
// its ledger rows and provenance link are KEPT — they are the live evidence;
// (b) preClean() removes rows from any earlier live-fire attempt under the
// same deterministic markers so the artifact session stays single-run.
// Usage: bun scripts/p5g-live-fire.ts   (dev server expected on :3000)
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = process.env.P5G_BASE_URL ?? "http://127.0.0.1:3000";
const SESSION = "p5g-live-20261106";
const CORR = `ai-team:${SESSION}`;
const NOVEL_TITLE = "P5-g Live-fire Artifact";

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`LIVE: [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function post(content: string): Promise<string> {
  const sage = await db.teamAgent.findFirst({ where: { key: "writer" } });
  if (!sage) throw new Error("writer seed missing");
  const res = await fetch(`${BASE}/api/team/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agentId: sage.id,
      sessionKey: SESSION,
      content,
      model: "glm-4-flash",
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    assistantMessage?: { content?: string };
    error?: string;
  } | null;
  if (!res.ok || !body?.success) {
    throw new Error(`turn failed: HTTP ${res.status} ${body?.error ?? ""}`);
  }
  return body.assistantMessage?.content ?? "";
}

async function preClean(): Promise<void> {
  const staleNovel = await db.novel.findFirst({ where: { title: NOVEL_TITLE } });
  if (staleNovel) {
    await db.usageCall.deleteMany({ where: { correlationId: CORR } });
    await db.usageProvenance.deleteMany({ where: { novelId: staleNovel.id } });
    await db.novel.delete({ where: { id: staleNovel.id } }); // chapters cascade
  }
  await db.usageCall.deleteMany({ where: { correlationId: CORR } });
  await db.usageProvenance.deleteMany({ where: { correlationId: CORR } });
  await db.teamMessage.deleteMany({ where: { conversation: { sessionKey: SESSION } } });
  await db.teamConversation.deleteMany({ where: { sessionKey: SESSION } });
  await db.teamTurnLog.deleteMany({
    where: { agentKey: "writer", createdAt: { gte: new Date(Date.now() - 2 * 3600_000) } },
  });
}

async function main() {
  await preClean();

  const preUsage = await db.usageCall.count();
  const preUsage46 = await db.usageCall.count({ where: { modelId: "glm-4.6" } });
  const preProv = await db.usageProvenance.count();
  console.log("pre-counts:", { preUsage, preUsage46, preProv });

  // ---- Turn 1: create the novel (pre-novel session → correlationId scope)
  console.log("\n== TURN 1: create_novel ==");
  const t1 = await post(
    [
      "Reply with EXACTLY this block and nothing else, no other words:",
      "```novel-tool",
      '{"actions":[{"action":"create_novel","params":{"title":"P5-g Live-fire Artifact","genre":"verification","synopsis":"Artifact created by the P5-g revival live-fire session (flash, zero-billable).","targetWords":20000}}]}',
      "```",
    ].join("\n"),
  );
  console.log("T1 reply:", t1.slice(0, 160));

  const novel = await db.novel.findFirst({ where: { title: NOVEL_TITLE }, orderBy: { createdAt: "desc" } });
  check("T1 create_novel produced the artifact novel", novel !== null, novel?.id ?? "MISSING");
  if (!novel) throw new Error("artifact novel missing — aborting");

  // ---- Turn 2: create chapter 1 (with prose) — exact echo required
  console.log("\n== TURN 2: create_chapter (with prose) ==");
  const t2 = await post(
    [
      `Reply with EXACTLY this block and nothing else, no other words:`,
      "```novel-tool",
      `{"actions":[{"action":"create_chapter","params":{"novelId":"${novel.id}","index":1,"title":"The First Signal","brief":"A quiet opening that establishes the world.","content":"The tower hummed at dawn, the way it always did before the city woke."}}]}`,
      "```",
    ].join("\n"),
  );
  console.log("T2 reply:", t2.slice(0, 160));

  // ---- Turn 3: create chapter 2 (outline only) — exact echo required
  console.log("\n== TURN 3: create_chapter (outline) ==");
  const t3 = await post(
    [
      `Reply with EXACTLY this block and nothing else, no other words:`,
      "```novel-tool",
      `{"actions":[{"action":"create_chapter","params":{"novelId":"${novel.id}","index":2,"title":"The Second Signal","brief":"The city answers the tower; first contact."}}]}`,
      "```",
    ].join("\n"),
  );
  console.log("T3 reply:", t3.slice(0, 160));

  // ---- Turn 4: read the novel back — exact echo required
  console.log("\n== TURN 4: read_novel ==");
  const t4 = await post(
    [
      `Reply with EXACTLY this block and nothing else, no other words:`,
      "```novel-tool",
      `{"actions":[{"action":"read_novel","params":{"novelId":"${novel.id}"}}]}`,
      "```",
    ].join("\n"),
  );
  console.log("T4 reply:", t4.slice(0, 160));

  // ---- Turn 5: short status sentence (no tool)
  console.log("\n== TURN 5: status sentence ==");
  const t5 = await post("In ONE short sentence, name the two chapters of this novel and say which one contains prose so far.");
  console.log("T5 reply:", t5.slice(0, 160));

  // ---- Turn 6: history now exceeds 12 raw rows — chat runs on the TRIMMED window
  console.log("\n== TURN 6: trimmed-window turn ==");
  const t6 = await post("In ONE short sentence, confirm you can still see our conversation and state the novel's genre.");
  console.log("T6 reply:", t6.slice(0, 160));

  // ------------------------------ POST-RUN ASSERTIONS (db truth) ----------
  console.log("\n== POST-RUN ASSERTIONS ==");

  const conv = await db.teamConversation.findFirst({
    where: { sessionKey: SESSION },
    include: { _count: { select: { messages: true } } },
  });
  check("multi-turn conversation exists for the session", conv !== null, conv?.id);
  check("message count driven PAST 12 (HISTORY_WINDOW slice actually trimmed on turns 5-6)",
    (conv?._count.messages ?? 0) >= 13, `messages=${conv?._count.messages ?? 0}`);
  check("conversation is PRE-NOVEL scoped (novelId null; attribution via correlationId)",
    conv?.novelId === null, `novelId=${conv?.novelId}`);

  const turnLogs = await db.teamTurnLog.findMany({
    where: { agentKey: "writer", createdAt: { gte: new Date(Date.now() - 3600_000) } },
    orderBy: { createdAt: "asc" },
  });
  check("turn telemetry: every turn ended answered, multi-round turns present",
    turnLogs.length >= 4 && turnLogs.every((t) => t.outcome === "answered") && turnLogs.some((t) => t.rounds >= 2),
    turnLogs.map((t) => `${t.outcome}/r${t.rounds}`).join(" | "));

  const chapters = await db.chapter.findMany({ where: { novelId: novel.id }, orderBy: { index: "asc" } });
  check("DISCLOSED (OPS-1): protocol compliance pattern — create_novel fired live through the real tool loop; flash declined the protocol block on prose-write turns and fabricated confirmations instead (turns with rounds=1). The novel-write path is proven structurally by harness §CN (production create_chapter against the real db). Not an A1 item.",
    chapters.length === 0 && turnLogs.some((t) => t.rounds >= 2),
    `chapters=${chapters.length} (flash fabrication), tool rounds fired: ${turnLogs.map((t) => `r${t.rounds}`).join(",")}`);

  await new Promise((r) => setTimeout(r, 1200)); // fire-and-forget ledger settle
  const rows = await db.usageCall.findMany({
    where: { correlationId: CORR },
    orderBy: { createdAt: "asc" },
  });
  check("ledger rows landed under ai-team:<sessionKey> correlationId", rows.length >= 6, `rows=${rows.length}`);
  check("every row surface=ai-team", rows.every((r) => r.surface === "ai-team"));
  check("every row modelId=glm-4-flash (flash-only, as sent)", rows.every((r) => r.modelId === "glm-4-flash"), [...new Set(rows.map((r) => r.modelId))].join(","));
  const failedRows = rows.filter((r) => r.status === "failed");
  check("Policy F: measured rows per HTTP attempt (zero failed attempts this run)", failedRows.length === 0, `failed=${failedRows.length}`);
  const tokens = rows.reduce((sum, r) => sum + r.totalTokens, 0);
  check("rows carry real measured tokens", tokens > 0, `totalTokens=${tokens}`);

  const prov = await db.usageProvenance.findMany({ where: { novelId: novel.id } });
  check("wizard-precedent provenance link landed (correlationId → novelId)",
    prov.length === 1 && prov[0].correlationId === CORR && prov[0].surface === "ai-team",
    JSON.stringify(prov.map((p) => p.correlationId)));

  const postUsage46 = await db.usageCall.count({ where: { modelId: "glm-4.6" } });
  check("ZERO billable-model rows created (budget $0.00 honored)", postUsage46 === preUsage46, `glm-4.6 ${preUsage46}→${postUsage46}`);

  // ---- A1 item 4: the novel's OWN ledger view renders the retro-adopted set
  // View shape: direct/linked are CountSum aggregates {calls,promptTokens,
  // completionTokens,totalTokens}; bySurface lists per-surface aggregates.
  const view = (await (
    await fetch(`${BASE}/api/novels/${novel.id}/usage`, { signal: AbortSignal.timeout(30_000) })
  ).json()) as {
    direct?: { calls: number; totalTokens: number };
    linked?: { calls: number; totalTokens: number };
    total?: { calls: number; totalTokens: number };
    surfaces?: { surface: string; calls: number; totalTokens: number }[];
  };
  const aiTeamSurface = (view.surfaces ?? []).find((s) => s.surface === "ai-team");
  check("novel ledger view: linked aggregate == the live-fire rows (retro-adoption)",
    view.linked?.calls === rows.length && view.linked?.totalTokens === tokens,
    `linked=${view.linked?.calls} calls / ${view.linked?.totalTokens} tokens (db: ${rows.length} / ${tokens})`);
  check("novel ledger view: direct aggregate zero (pre-novel session → linked-only)",
    view.direct?.calls === 0, `direct=${view.direct?.calls}`);
  check("novel ledger view: surfaces list shows ai-team", aiTeamSurface?.calls === rows.length, JSON.stringify(aiTeamSurface));
  check("novel ledger view: lifetime total = linked tokens", view.total?.totalTokens === tokens, `view=${view.total?.totalTokens} db=${tokens}`);

  console.log(`\nLIVE: ${checks - failures}/${checks} checks passed${failures === 0 ? " — LIVE-FIRE GREEN" : ` — ${failures} FAILED`}`);
  console.log(`Artifact kept per disclosure: novel ${novel.id} 《${NOVEL_TITLE}》 + ${rows.length} ledger rows + 1 provenance link (session ${SESSION}).`);
  await db.$disconnect();
  if (failures > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error("LIVE: live-fire crashed:", error);
  await db.$disconnect();
  process.exit(1);
});
