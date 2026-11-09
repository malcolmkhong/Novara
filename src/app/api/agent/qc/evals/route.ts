import { runQcEvals } from "@/lib/novara/qc-evals";
import { getBudgets } from "@/lib/novara/content";

export const dynamic = "force-dynamic";

// GET /api/agent/qc/evals — behavioral QC console (Phase 6). Runs the
// fixture-style probes over the pure decision layers (tool protocol, write
// gate, E2 gates, revision budget, digital audit, line protocols, word
// count). Zero AI calls, zero DB writes — safe to run anytime.
export async function GET() {
  const budgets = getBudgets();
  const report = await runQcEvals();
  return Response.json({
    ...report,
    budgets: {
      revisionRounds: budgets.qc.revisionRounds,
      aiRetries: budgets.ai.retryAttempts,
      maxConcurrent: budgets.ai.maxConcurrent,
    },
  });
}
