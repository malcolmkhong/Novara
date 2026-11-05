// ---------------------------------------------------------------------------
// Novara AI — P2-c live probe EXECUTOR (child process).
//
// One process = one executor session. Invoked by scripts/p2-c-probe.ts:
//   bun scripts/p2-c-probe-exec.ts <runId> fresh   → executeRun (claims lease)
//   bun scripts/p2-c-probe-exec.ts <runId> resume  → claim + executeRun(resume)
//     (mirrors the resume route's claim-then-execute flow; the controller has
//      already aged the dead executor's heartbeat past LEASE_STALE_MS, exactly
//      the state a real crash leaves after the 240s staleness window).
//
// The controller SIGKILLs the fresh session to simulate executor death; a
// SIGKILL leaves no finally-block behind — run status stays "running" with a
// dead lease, the canonical transcript stays exactly as appended.
// ---------------------------------------------------------------------------

import { claimLease } from "../src/lib/agent/messages";
import { executeRun } from "../src/lib/agent/runtime";

async function main() {
  const [runId, mode] = process.argv.slice(2);
  if (!runId || (mode !== "fresh" && mode !== "resume")) {
    console.error(`[probe-exec] usage: p2-c-probe-exec.ts <runId> fresh|resume`);
    process.exit(2);
  }
  console.log(`[probe-exec] session start — run=${runId} mode=${mode} pid=${process.pid}`);
  if (mode === "fresh") {
    await executeRun(runId);
  } else {
    const lease = await claimLease(runId);
    if (!lease) throw new Error("[probe-exec] resume: lease not claimable (alive executor?)");
    console.log(`[probe-exec] resume lease claimed — epoch=${lease.epoch}`);
    await executeRun(runId, { resume: true, lease });
  }
  console.log(`[probe-exec] session end — run=${runId} mode=${mode}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[probe-exec] fatal:", e);
  process.exit(1);
});
