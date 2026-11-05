// ---------------------------------------------------------------------------
// Novara AI — P4 live acceptance EXECUTOR (child process).
//
// One process = one executor session, mirroring the resume route's
// claim-then-execute flow (same shape as p2-c-probe-exec.ts):
//   bun scripts/p4-live-exec.ts <runId> fresh
//
// The controller creates the run and polls the DB; this child just runs it.
// Every model call inside belongs to the ONE free flash acceptance run.
// ---------------------------------------------------------------------------

import { claimLease } from "../src/lib/agent/messages";
import { executeRun } from "../src/lib/agent/runtime";

async function main() {
  const [runId, mode] = process.argv.slice(2);
  if (!runId || mode !== "fresh") {
    console.error("[p4-exec] usage: p4-live-exec.ts <runId> fresh");
    process.exit(2);
  }
  console.log(`[p4-exec] session start — run=${runId} pid=${process.pid}`);
  await executeRun(runId);
  console.log(`[p4-exec] session end — run=${runId}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[p4-exec] fatal:", e);
  process.exit(1);
});
