// ---------------------------------------------------------------------------
// Novara AI — Next.js instrumentation hook (Phase 5 / P5-f, Ruling R-2).
//
// Runs once per server start (nodejs runtime). Fires the usage retention
// sweep (90-day rollup-then-purge) in the background: it must never block
// or fail startup — a failed sweep leaves details in place and the next
// start (or scripts/purge-usage.ts) retries deterministically.
// ---------------------------------------------------------------------------

export async function register() {
  // Dynamic import: keep the startup path free of any DB work when the
  // module graph is only being inspected (e.g. next build).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { purgeExpiredUsageCalls } = await import("@/lib/usage/retention");
    void purgeExpiredUsageCalls()
      .then((result) => {
        if (result.swept > 0) {
          console.log(
            `[usage-retention] startup sweep: rolled up + deleted ${result.deleted} detail row(s) beyond the 90-day window into ${result.buckets} daily bucket(s)`
          );
        }
      })
      .catch((error: unknown) => {
        console.warn(
          "[usage-retention] startup sweep failed (details retained; next start retries):",
          error instanceof Error ? error.message : error
        );
      });
  } catch (error) {
    console.warn(
      "[usage-retention] sweep module failed to load (startup continues):",
      error instanceof Error ? error.message : error
    );
  }
}
