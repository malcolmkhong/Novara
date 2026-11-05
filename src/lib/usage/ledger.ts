// ---------------------------------------------------------------------------
// Novara AI — process-wide GLM usage ledger (P4 / T5).
//
// Every GLM chat completion in the app flows through ONE of two chokepoints:
//   1. glmChat (src/lib/novara/glm.ts) — agent runtime + draft/review/sediment
//   2. direct zai.chat.completions.create calls — novel studio (init/plan/
//      review/sediment/write), detect routes, generate, wizard, ai-team
//
// Both capture the provider's REAL usage object (prompt_tokens /
// completion_tokens / total_tokens) via extractRealUsage and hand it to
// recordGlobalUsage with a surface tag. The ledger is in-memory on globalThis
// (survives dev hot reload, resets on server restart — the panel says so) and
// is exposed via GET /api/usage/global.
//
// Honesty rule: only MEASURED calls are recorded. A null usage (streaming
// chunks, stripped fields) is a no-op — never guessed, never padded.
// ---------------------------------------------------------------------------

export interface RealUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Extract the provider's real usage object from an SDK completion payload. */
export function extractRealUsage(completion: unknown): RealUsage | null {
  if (typeof completion !== "object" || completion === null) return null;
  const usage = (completion as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const promptTokens =
    typeof u.prompt_tokens === "number" && Number.isFinite(u.prompt_tokens)
      ? u.prompt_tokens
      : null;
  if (promptTokens === null) return null;
  const completionTokens =
    typeof u.completion_tokens === "number" && Number.isFinite(u.completion_tokens)
      ? u.completion_tokens
      : 0;
  const totalTokens =
    typeof u.total_tokens === "number" && Number.isFinite(u.total_tokens)
      ? u.total_tokens
      : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

interface SurfaceTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SurfaceUsage extends SurfaceTotals {
  surface: string;
}

interface LedgerState {
  since: string;
  surfaces: Map<string, SurfaceTotals>;
}

// globalThis cache — survives route-module reloads in dev, per Node process.
const globalForLedger = globalThis as {
  __novaraUsageLedger?: LedgerState;
};

function ledger(): LedgerState {
  if (!globalForLedger.__novaraUsageLedger) {
    globalForLedger.__novaraUsageLedger = {
      since: new Date().toISOString(),
      surfaces: new Map(),
    };
  }
  return globalForLedger.__novaraUsageLedger;
}

/** Record one measured call. Null usage (streaming / stripped) is a no-op. */
export function recordGlobalUsage(surface: string, usage: RealUsage | null): void {
  if (!usage) return;
  const s = ledger();
  const row =
    s.surfaces.get(surface) ??
    { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  row.calls += 1;
  row.promptTokens += usage.promptTokens;
  row.completionTokens += usage.completionTokens;
  row.totalTokens += usage.totalTokens;
  s.surfaces.set(surface, row);
}

export interface GlobalUsageSnapshot {
  since: string;
  surfaces: SurfaceUsage[];
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

/** Current ledger state, surfaces sorted by total tokens desc. */
export function globalUsageSnapshot(): GlobalUsageSnapshot {
  const s = ledger();
  const surfaces: SurfaceUsage[] = [...s.surfaces.entries()]
    .map(([surface, t]) => ({ surface, ...t }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
  const totals = surfaces.reduce(
    (acc, t) => ({
      totalCalls: acc.totalCalls + t.calls,
      totalPromptTokens: acc.totalPromptTokens + t.promptTokens,
      totalCompletionTokens: acc.totalCompletionTokens + t.completionTokens,
      totalTokens: acc.totalTokens + t.totalTokens,
    }),
    { totalCalls: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0 },
  );
  return { since: s.since, surfaces, ...totals };
}
