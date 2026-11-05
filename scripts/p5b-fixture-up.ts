// ---------------------------------------------------------------------------
// Novara AI — P5-b panel-regression fixture (UP).
//
// Creates ONE completed AgentRun + THREE kind="usage" AgentEvents on the
// existing scratch novel ("abc") so the Context Usage panel's THIS-CALL and
// THIS-RUN blocks render distinctive numbers. The SAME rows are read by the
// pre-swap and post-swap browser captures — identical data in, so any
// rendering difference would be a regression, not new data.
//
// ZERO GLM calls — rows are written directly to SQLite. Cleanup is
// p5b-fixture-down.ts (deleting the run cascades its events; the novel and
// its non-run data are untouched).
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const NOVEL_ID = "cmw40s6hc0000t4v8fgaarzkg"; // scratch novel "abc"
const RUN_ID = "p5b-panel-run";

const EVENTS = [
  {
    idx: 1,
    at: new Date(Date.now() - 60_000),
    used: 4200,
    real: { promptTokens: 4200, completionTokens: 150, totalTokens: 4350 },
    sections: { system: 900, tools: 600, skills: 300, novel: 1200, conversation: 1200, mcp: 0 },
  },
  {
    idx: 2,
    at: new Date(Date.now() - 30_000),
    used: 5300,
    real: { promptTokens: 5300, completionTokens: 210, totalTokens: 5510 },
    sections: { system: 1000, tools: 700, skills: 350, novel: 1500, conversation: 1750, mcp: 0 },
  },
  {
    idx: 3,
    at: new Date(),
    used: 6100,
    real: { promptTokens: 6100, completionTokens: 300, totalTokens: 6400 },
    sections: { system: 1100, tools: 750, skills: 400, novel: 1700, conversation: 2150, mcp: 0 },
  },
];

async function main() {
  // Idempotent: remove any prior fixture first.
  await db.agentRun.deleteMany({ where: { id: RUN_ID } });

  const run = await db.agentRun.create({
    data: {
      id: RUN_ID,
      novelId: NOVEL_ID,
      goal: "P5-b panel regression fixture — zero GLM",
      status: "completed",
    },
    select: { id: true },
  });

  for (const e of EVENTS) {
    await db.agentEvent.create({
      data: {
        runId: run.id,
        kind: "usage",
        summary: `Context usage (p5b fixture turn ${e.idx})`,
        payload: JSON.stringify({
          usage: {
            modelId: "glm-4.6",
            contextWindow: 200000,
            used: e.used,
            actor: `p5b fixture · turn ${e.idx}`,
            sections: e.sections,
            updatedAt: e.at.toISOString(),
            real: e.real,
          },
        }),
        createdAt: e.at,
      },
    });
  }

  const count = await db.agentEvent.count({ where: { runId: RUN_ID, kind: "usage" } });
  console.log(`P5B-FIXTURE-UP: run=${RUN_ID} events=${count} (expect 3)`);
  const totals = EVENTS.reduce(
    (a, e) => ({
      prompt: a.prompt + e.real.promptTokens,
      out: a.out + e.real.completionTokens,
      billed: a.billed + e.real.totalTokens,
    }),
    { prompt: 0, out: 0, billed: 0 }
  );
  console.log(
    `P5B-FIXTURE-UP: expected THIS-RUN = 3 calls · prompt ${totals.prompt} · output ${totals.out} · Σ ${totals.billed}; expected THIS-CALL = billed ${EVENTS[2].real.totalTokens} / output ${EVENTS[2].real.completionTokens}`
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error("P5B-FIXTURE-UP crashed:", error);
    await db.$disconnect();
    process.exit(1);
  });
