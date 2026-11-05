// ---------------------------------------------------------------------------
// Novara AI — P5-b panel-regression fixture (DOWN).
// Deletes the fixture run; AgentEvents cascade with it (schema cascade).
// The novel, its chapters, and any non-fixture data are untouched.
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const before = await db.agentEvent.count({ where: { runId: "p5b-panel-run" } });
  await db.agentRun.deleteMany({ where: { id: "p5b-panel-run" } });
  const afterEvents = await db.agentEvent.count({ where: { runId: "p5b-panel-run" } });
  const runs = await db.agentRun.count({ where: { id: "p5b-panel-run" } });
  console.log(
    `P5B-FIXTURE-DOWN: removed run (had ${before} usage events) — leftover events=${afterEvents} runs=${runs}`
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error("P5B-FIXTURE-DOWN crashed:", error);
    await db.$disconnect();
    process.exit(1);
  });
