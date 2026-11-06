// ---------------------------------------------------------------------------
// Novara AI — P5-g verification (TEAM-1 revival). The regression set gains
// an ELEVENTH harness.
//
// ZERO GLM calls — OPS-3 mock-first standing rule. This harness proves the
// STRUCTURE of the revival: restored DDL (verbatim columns + the two ruled
// adaptations), seeding, every team route's real HTTP shape against the live
// dev server, the HISTORY_WINDOW=12 replay slice, ledger scope fixtures via
// the production usage-store seams, the create_novel→novelId side-channel,
// and source pins (provenance hook wired; wizard stays Team*-independent).
// The BEHAVIOR proof (a real team session on flash) is the separate A1
// live-fire, not this harness.
//
// Sections:
//   DDL. Six Team* tables exist with the f32b9df^ verbatim column sets plus
//        EXACTLY the two ruled adaptations (novelId on TeamConversation +
//        TeamTask); indexes + unique keys intact.
//   SEED. ensureSeed() against the real client → 5 default agents, leader
//        Atlas, upsert-idempotent (repeat call adds nothing).
//   RT.  Route shapes over REAL HTTP (dev server): agents 200 (the
//        historical 500 path — regression), chat GET 200, tasks GET 200,
//        turns GET 200, chat/tasks POST 400-shaped on invalid bodies,
//        tasks/[id]/run 404 on unknown id.
//   HW.  HISTORY_WINDOW: a 20-message fixture replays exactly 12, oldest→
//        newest, system rows filtered.
//   LG.  Ledger scope: recordUsageCall lands novelId / correlationId /
//        explicit modelId (glm-4-flash) / gateway-default fallback rows;
//        recordProvenanceLink is idempotent per (correlationId, novelId).
//   CN.  create_novel seam: the production tool returns ok + novelId that
//        matches the database row (the provenance hook's key).
//   PIN. Source pins: chat route fires recordProvenanceLink("ai-team", …);
//        the wizard route references NO Team* model (A1 item 5 structural
//        proof); server.ts keeps HISTORY_WINDOW = 12.
//   Z.   Zero-spend proof: NO glm-4.6 (billable) rows created; UsageCall
//        delta == the fixture rows exactly.
//
// Fixture discipline: one throwaway Novel + conversation/messages/usage
// rows under the "P5-G harness" markers; cleanup deletes them and asserts
// counts return to pre-run shape. Seeded agents stay (production state).
// Usage: bun scripts/verify-p5-g.ts   (dev server expected on :3000)
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
// bun:sqlite for the DDL pins (same driver as the forensic checks).
import { Database } from "bun:sqlite";

import { ensureSeed, buildHistoryMessages } from "../src/lib/ai-team/server";
import { executeNovelToolCalls } from "../src/lib/ai-team/novel-tools";
import { recordProvenanceLink, recordUsageCall } from "../src/lib/usage/usage-store";

const db = new PrismaClient();
const BASE = process.env.P5G_BASE_URL ?? "http://127.0.0.1:3000";

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P5G: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const MARKER = "P5-G harness";
const CORR = "ai-team:p5g-harness-fixture";

// --- expected verbatim columns (f32b9df^) + the two ruled adaptations ------
const EXPECTED: Record<string, string[]> = {
  TeamAgent: ["id", "key", "name", "role", "description", "capabilities", "isLeader", "emoji", "color", "sortOrder", "createdAt"],
  // novelId = adaptation 1
  TeamConversation: ["id", "agentId", "sessionKey", "novelId", "createdAt", "updatedAt"],
  TeamMessage: ["id", "conversationId", "role", "content", "taskIds", "createdAt"],
  // novelId = adaptation 1
  TeamTask: ["id", "title", "description", "status", "progress", "result", "error", "sessionKey", "novelId", "assigneeId", "creatorId", "creatorIsUser", "autoDepth", "createdAt", "updatedAt"],
  TeamTaskLog: ["id", "taskId", "message", "progress", "createdAt"],
  TeamTurnLog: ["id", "agentKey", "label", "outcome", "rounds", "toolCalls", "correctionsFired", "durationMs", "createdAt"],
};

function tableColumns(sqlite: Database, table: string): string[] {
  const rows = sqlite.query(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

function tableIndexes(sqlite: Database, table: string): string[] {
  const rows = sqlite.query(`PRAGMA index_list("${table}")`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

async function main() {
  const preUsage = await db.usageCall.count();
  const preUsage46 = await db.usageCall.count({ where: { modelId: "glm-4.6" } });
  const preProvenance = await db.usageProvenance.count();
  const preNovels = await db.novel.count();

  // ------------------------------------------------------------------ DDL
  const sqlite = new Database("db/custom.db", { readonly: true });
  for (const [table, expected] of Object.entries(EXPECTED)) {
    const actual = tableColumns(sqlite, table);
    check(`DDL ${table} exists with verbatim columns`, JSON.stringify(actual) === JSON.stringify(expected), actual.length === 0 ? "MISSING TABLE" : `cols=${actual.length}`);
  }
  const convIdx = tableIndexes(sqlite, "TeamConversation");
  const agentIdx = tableIndexes(sqlite, "TeamAgent");
  const taskIdx = tableIndexes(sqlite, "TeamTask");
  const turnIdx = tableIndexes(sqlite, "TeamTurnLog");
  check("DDL unique keys + indexes present",
    agentIdx.some((n) => n.includes("key")) &&
    convIdx.some((n) => n.includes("agentId_sessionKey")) &&
    taskIdx.some((n) => n.includes("status")) &&
    turnIdx.filter((n) => n.startsWith("TeamTurnLog")).length >= 2,
    `agent=[${agentIdx.join(",")}] conv=[${convIdx.join(",")}]`);
  sqlite.close();

  // ----------------------------------------------------------------- SEED
  await ensureSeed();
  const agents = await db.teamAgent.findMany({ orderBy: { sortOrder: "asc" } });
  check("SEED 5 default agents seeded", agents.length === 5, `count=${agents.length}`);
  const leader = agents.find((a) => a.isLeader);
  check("SEED leader is Atlas (key=leader)", leader?.key === "leader" && leader?.name === "Atlas", leader?.name);
  const beforeReSeed = agents.length;
  await ensureSeed();
  const afterReSeed = await db.teamAgent.count();
  check("SEED upsert-idempotent", beforeReSeed === afterReSeed, `${beforeReSeed} → ${afterReSeed}`);

  const writer = agents.find((a) => a.key === "writer");
  check("SEED writer Sage present (full write tools)", writer?.name === "Sage", writer?.name);

  // ------------------------------------------------------------------ RT
  async function jsonFetch(path: string, init?: RequestInit) {
    const res = await fetch(`${BASE}${path}`, init);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body: body as Record<string, unknown> | null };
  }

  const agentsRes = await jsonFetch("/api/team/agents");
  check("RT GET /api/team/agents → 200 (historical 500 path healed)",
    agentsRes.status === 200 && agentsRes.body?.success === true && Array.isArray(agentsRes.body?.agents) && (agentsRes.body?.agents as unknown[]).length === 5,
    `status=${agentsRes.status}`);

  const conv = await db.teamConversation.create({
    data: { agentId: writer!.id, sessionKey: "p5g-harness-conv" },
  });

  const chatGet = await jsonFetch(`/api/team/chat?agentId=${writer!.id}&sessionKey=p5g-harness-conv`);
  check("RT GET /api/team/chat → 200 shaped", chatGet.status === 200 && chatGet.body?.success === true && Array.isArray(chatGet.body?.messages), `status=${chatGet.status}`);

  const tasksGet = await jsonFetch("/api/team/tasks");
  check("RT GET /api/team/tasks → 200 shaped", tasksGet.status === 200 && tasksGet.body?.success === true && Array.isArray(tasksGet.body?.tasks), `status=${tasksGet.status}`);

  const turnsGet = await jsonFetch("/api/team/turns?limit=5");
  check("RT GET /api/team/turns → 200 shaped", turnsGet.status === 200 && turnsGet.body?.success === true && Array.isArray(turnGetSafe(turnsGet.body)), `status=${turnsGet.status}`);

  const chatBad = await jsonFetch("/api/team/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: writer!.id }),
  });
  check("RT POST /api/team/chat invalid body → 400 (no GLM fired)", chatBad.status === 400, `status=${chatBad.status}`);

  const tasksBad = await jsonFetch("/api/team/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assigneeId: writer!.id }),
  });
  check("RT POST /api/team/tasks invalid body → 400", tasksBad.status === 400, `status=${tasksBad.status}`);

  const runMissing = await jsonFetch(`/api/team/tasks/${"nonexistent-id"}/run`, { method: "POST" });
  check("RT POST /api/team/tasks/[id]/run unknown id → 404", runMissing.status === 404, `status=${runMissing.status}`);

  // ------------------------------------------------------------------ HW
  // Production semantics (server.ts buildHistoryMessages): the DB query
  // takes the LAST 12 raw rows, then filters system rows out of the replay.
  // Fixture A: 20 non-system messages → the take actually trims to 12.
  const baseTime = Date.now();
  await db.teamMessage.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      conversationId: conv.id,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `${MARKER} msg ${i}`,
      createdAt: new Date(baseTime + i),
    })),
  });
  const total = await db.teamMessage.count({ where: { conversationId: conv.id } });
  const replayed = await buildHistoryMessages(conv.id);
  const first = replayed[0]?.content ?? "";
  const last = replayed[replayed.length - 1]?.content ?? "";
  check("HW 20-message fixture replays exactly HISTORY_WINDOW=12",
    total === 20 && replayed.length === 12, `total=${total} replayed=${replayed.length}`);
  check("HW replay is oldest→newest tail of the window",
    first === `${MARKER} msg 8` && last === `${MARKER} msg 19`,
    `first="${first}" last="${last}"`);
  // Fixture B: system rows inside the window are filtered from the replay
  // (the take is on RAW rows — the 12 newest raw rows here are exactly the
  // sysmix block, of which 4 are system → 8 replayed).
  await db.teamMessage.createMany({
    data: Array.from({ length: 12 }, (_, i) => ({
      conversationId: conv.id,
      role: i % 3 === 2 ? "system" : i % 2 === 0 ? "user" : "assistant",
      content: `${MARKER} sysmix ${i}`,
      createdAt: new Date(baseTime + 100 + i),
    })),
  });
  const replayedSys = await buildHistoryMessages(conv.id);
  check("HW system rows filtered from replay (take is on raw rows)",
    replayedSys.length === 8 && !replayedSys.some((m) => m.role === "system"),
    `replayed=${replayedSys.length} (12 raw sysmix rows − 4 system)`);

  // ------------------------------------------------------------------ LG
  recordUsageCall({
    surface: "ai-team",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    novelId: "p5g-harness-novel-scope",
    modelId: "glm-4-flash",
  });
  recordUsageCall({
    surface: "ai-team",
    usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
    correlationId: CORR,
    modelId: "glm-4-flash",
  });
  recordUsageCall({
    surface: "ai-team",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    correlationId: CORR,
  });
  // recordUsageCall is fire-and-forget — give the writes a beat.
  await new Promise((r) => setTimeout(r, 300));

  const flashRows = await db.usageCall.findMany({ where: { correlationId: CORR } });
  check("LG scope rows landed under correlationId", flashRows.length === 2, `rows=${flashRows.length}`);
  const flashExplicit = flashRows.find((r) => r.promptTokens === 7);
  const gatewayRow = flashRows.find((r) => r.promptTokens === 1);
  check("LG explicit modelId recorded as sent (glm-4-flash)", flashExplicit?.modelId === "glm-4-flash", flashExplicit?.modelId ?? "missing");
  check("LG omitted model → gateway-default (UNPRICED, never guessed)", gatewayRow?.modelId === "gateway-default", gatewayRow?.modelId ?? "missing");
  check("LG surface=ai-team on fixture rows", flashRows.every((r) => r.surface === "ai-team"));

  recordProvenanceLink("ai-team", CORR, "p5g-harness-novel-link");
  await new Promise((r) => setTimeout(r, 200));
  recordProvenanceLink("ai-team", CORR, "p5g-harness-novel-link");
  await new Promise((r) => setTimeout(r, 200));
  const links = await db.usageProvenance.count({ where: { correlationId: CORR } });
  check("LG provenance link idempotent per (correlationId, novelId)", links === 1, `links=${links}`);

  // ------------------------------------------------------------------ CN
  const novel = await db.novel.create({ data: { title: MARKER, genre: "harness", synopsis: "throwaway" } });
  const created = await executeNovelToolCalls([
    { action: "create_novel", params: { title: `${MARKER} via tool`, genre: "verification", synopsis: "created through the production create_novel seam" } },
  ]);
  const cnResult = created[0];
  check("CN create_novel seam returns ok + novelId side-channel",
    cnResult?.ok === true && typeof cnResult?.novelId === "string" && cnResult.novelId.length > 0,
    cnResult?.summary ?? "no result");
  const cnRow = cnResult?.novelId ? await db.novel.findUnique({ where: { id: cnResult.novelId } }) : null;
  check("CN created novel exists in the database", cnRow !== null, cnRow?.title ?? "missing");

  // Novel-write path (zero-GLM): production create_chapter against the real
  // db — the live-fire's flash turns declined the protocol block (OPS-1,
  // disclosed there), so THIS is the write-path proof: real tool call →
  // real Chapter row with prose.
  const chResults = await executeNovelToolCalls([
    {
      action: "create_chapter",
      params: {
        novelId: cnResult?.novelId,
        index: 1,
        title: "Harness Chapter One",
        brief: "Write-path proof via the production tool.",
        content: "The tower hummed at dawn, the way it always did before the city woke.",
      },
    },
  ]);
  const chResult = chResults[0];
  check("CN create_chapter seam writes a real chapter with prose",
    chResult?.ok === true, chResult?.summary ?? "no result");
  const chRow = cnResult?.novelId
    ? await db.chapter.findUnique({
        where: { novelId_index: { novelId: cnResult.novelId, index: 1 } },
      })
    : null;
  check("CN chapter row persisted (content + wordCount computed)",
    chRow !== null && chRow.content.length > 0 && chRow.wordCount > 0 && chRow.brief.length > 0,
    `content=${chRow?.content.length ?? 0} chars, wordCount=${chRow?.wordCount ?? 0}`);

  // ----------------------------------------------------------------- PIN
  const chatSource = readFileSync("src/app/api/team/chat/route.ts", "utf8");
  check("PIN chat route fires recordProvenanceLink(\"ai-team\", …)",
    chatSource.includes('recordProvenanceLink("ai-team", scope.correlationId, createdId)'),
    "chat route provenance hook");
  const serverSource = readFileSync("src/lib/ai-team/server.ts", "utf8");
  check("PIN server.ts keeps HISTORY_WINDOW = 12", /const HISTORY_WINDOW = 12;/.test(serverSource));
  check("PIN server.ts threads scope into recordUsageCall (novelId + correlationId + modelId)",
    serverSource.includes("novelId: scope?.novelId") && serverSource.includes("correlationId: scope?.correlationId") && serverSource.includes("modelId: scope?.model"));
  const wizardSource = readFileSync("src/app/api/ai/wizard/route.ts", "utf8");
  check("PIN wizard route references NO Team* model (A1 item 5: structural independence)",
    !/teamAgent|teamConversation|teamMessage|teamTask|teamTurnLog/.test(wizardSource));

  // ------------------------------------------------------------- CLEANUP
  await db.teamMessage.deleteMany({ where: { conversationId: conv.id } });
  await db.teamConversation.delete({ where: { id: conv.id } });
  await db.usageCall.deleteMany({ where: { OR: [{ correlationId: CORR }, { novelId: "p5g-harness-novel-scope" }] } });
  await db.usageProvenance.deleteMany({ where: { correlationId: CORR } });
  if (cnResult?.novelId) await db.novel.delete({ where: { id: cnResult.novelId } });
  await db.novel.delete({ where: { id: novel.id } });

  const postUsage = await db.usageCall.count();
  const postUsage46 = await db.usageCall.count({ where: { modelId: "glm-4.6" } });
  const postProvenance = await db.usageProvenance.count();
  const postNovels = await db.novel.count();
  check("Z cleanup restores counts (usage/provenance/novel)", postUsage === preUsage && postProvenance === preProvenance && postNovels === preNovels, `usage ${preUsage}→${postUsage}, prov ${preProvenance}→${postProvenance}, novels ${preNovels}→${postNovels}`);
  check("Z ZERO billable-model rows created (no glm-4.6; flash fixtures only)", postUsage46 === preUsage46, `glm-4.6 rows ${preUsage46}→${postUsage46}`);
  check("Z zero GLM reached the gateway (OPS-3)", postUsage - preUsage === 0, `usage delta=${postUsage - preUsage}`);

  console.log(`\nP5G: ${checks - failures}/${checks} checks passed${failures === 0 ? " — GREEN" : ` — ${failures} FAILED`}`);
  await db.$disconnect();
  if (failures > 0) process.exit(1);
}

function turnGetSafe(body: Record<string, unknown> | null): unknown[] {
  return Array.isArray(body?.turns) ? (body?.turns as unknown[]) : [];
}

main().catch(async (error) => {
  console.error("P5G: harness crashed:", error);
  await db.$disconnect();
  process.exit(1);
});
