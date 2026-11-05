// ---------------------------------------------------------------------------
// Novara AI — persisted GLM usage ledger store (Phase 5 / P5-a).
//
// Single source of truth for usage accounting (Ruling 2, user 2026-11-05):
// ONE row per MEASURED provider call in the UsageCall table, every surface.
// The in-memory per-process ledger in ./ledger.ts still feeds the Context
// Usage panel until P5-b swaps its data source; from P5-b on, THIS store is
// the only thing feeding any UI.
//
// Ruling 1 (user 2026-11-05): rows are PERMANENT account history — novelId /
// runId are plain strings with NO foreign key and NO cascade, so deleting a
// novel or a run never erases account-scope spend history (orphans render as
// "(deleted novel)"). There is NO purge path in Phase 5 scope.
//
// Honesty rules (unchanged from the in-memory ledger):
//   - Only MEASURED calls are recorded. A null usage object is a no-op —
//     never guessed, never padded. Estimates never enter this store.
//   - modelId records the REQUEST-side value exactly as sent. Calls that
//     carried no model field are stored under GATEWAY_DEFAULT_MODEL_ID —
//     never relabeled to a registry id the request did not carry (the
//     gateway rewrites response echoes anyway — phase3-stages.md §P3-A-2).
//
// Every write is fire-and-forget: a ledger failure must never break a model
// call (mirrors emitUsageEvent's discipline in the agent runtime).
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import type { RealUsage } from "./ledger";

/**
 * Request-side model label for calls that carried NO model field (the
 * gateway's server default). Kept distinct from any registry id on purpose:
 * the pricing module (P5-c) must treat this as UNPRICED, never $0-by-guess.
 */
export const GATEWAY_DEFAULT_MODEL_ID = "gateway-default";

/** Scope links a chokepoint knows at record time (all optional). */
export interface UsageCallScope {
  runId?: string;
  taskId?: string;
  conversationId?: string;
  novelId?: string;
  correlationId?: string;
}

export interface UsageCallEntry extends UsageCallScope {
  surface: string;
  /** Request-side model id exactly as sent; undefined = gateway default. */
  modelId?: string;
  /** Measured provider truth. null = record NOTHING (measured-only rule). */
  usage: RealUsage | null;
}

/** Persist one measured call. Fire-and-forget; null usage is a no-op. */
export function recordUsageCall(entry: UsageCallEntry): void {
  if (!entry.usage) return;
  void db.usageCall
    .create({
      data: {
        surface: entry.surface,
        modelId: entry.modelId ?? GATEWAY_DEFAULT_MODEL_ID,
        promptTokens: entry.usage.promptTokens,
        completionTokens: entry.usage.completionTokens,
        totalTokens: entry.usage.totalTokens,
        runId: entry.runId ?? null,
        taskId: entry.taskId ?? null,
        conversationId: entry.conversationId ?? null,
        novelId: entry.novelId ?? null,
        correlationId: entry.correlationId ?? null,
      },
    })
    .catch((error: unknown) => {
      console.warn(
        "[usage-ledger] persist failed (call not lost from the panel, missing from account ledger):",
        error instanceof Error ? error.message : error
      );
    });
}

/**
 * The retro-tag link (Ruling: provenance created at run/novel creation).
 * Idempotent per (correlationId, novelId) via the schema's unique index —
 * a retried create cannot double-link. Fire-and-forget.
 */
export function recordProvenanceLink(
  surface: string,
  correlationId: string,
  novelId: string
): void {
  void db.usageProvenance
    .upsert({
      where: {
        correlationId_novelId: { correlationId, novelId },
      },
      create: { surface, correlationId, novelId },
      update: {},
    })
    .catch((error: unknown) => {
      console.warn(
        "[usage-ledger] provenance link failed:",
        error instanceof Error ? error.message : error
      );
    });
}

// ---------------------------------------------------------------------------
// Read shapes — the account snapshot deliberately mirrors the in-memory
// GlobalUsageSnapshot surface/totals shape so the P5-b panel swap changes
// the data source, not the rendering.
// ---------------------------------------------------------------------------

export interface LedgerSurfaceUsage {
  surface: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LedgerNovelUsage {
  novelId: string;
  /** null = the novel row no longer exists — render "(deleted novel)". */
  title: string | null;
  deleted: boolean;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AccountUsageSnapshot {
  /** Earliest persisted row (the honest epoch — rows before P5-a do not exist). */
  since: string | null;
  /** All-time when null (no period filter given). */
  period: string | null;
  surfaces: LedgerSurfaceUsage[];
  novels: LedgerNovelUsage[];
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  /** Permanent-retention disclosure (Ruling 1) for the UI to render. */
  retention: string;
}

const RETENTION_NOTE =
  "Permanent account history — usage rows survive novel deletion; there is no purge in this build. Rows before the persisted ledger shipped (Phase 5) do not exist.";

/** Expand "2026-11" into the UTC month window; null when unparseable. */
function monthWindow(period: string): { gte: Date; lt: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(year, month, 1)),
  };
}

interface SumRow {
  _sum: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null };
  _count: { _all: number };
}

function toSurfaceUsage(sum: SumRow, surface: string): LedgerSurfaceUsage {
  return {
    surface,
    calls: sum._count._all,
    promptTokens: sum._sum.promptTokens ?? 0,
    completionTokens: sum._sum.completionTokens ?? 0,
    totalTokens: sum._sum.totalTokens ?? 0,
  };
}

function sumsToTotals(rows: LedgerSurfaceUsage[]): Pick<
  AccountUsageSnapshot,
  "totalCalls" | "totalPromptTokens" | "totalCompletionTokens" | "totalTokens"
> {
  return rows.reduce(
    (acc, t) => ({
      totalCalls: acc.totalCalls + t.calls,
      totalPromptTokens: acc.totalPromptTokens + t.promptTokens,
      totalCompletionTokens: acc.totalCompletionTokens + t.completionTokens,
      totalTokens: acc.totalTokens + t.totalTokens,
    }),
    { totalCalls: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0 }
  );
}

/** Account-scope snapshot: every measured call, all surfaces, novel breakdown. */
export async function accountUsageSnapshot(period?: string): Promise<AccountUsageSnapshot> {
  const window = period ? monthWindow(period) : null;
  const where = window ? { createdAt: window } : {};

  const [bySurface, byNovel, earliest] = await Promise.all([
    db.usageCall.groupBy({
      by: ["surface"],
      where,
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
      _count: { _all: true },
      orderBy: { surface: "asc" },
    }),
    db.usageCall.groupBy({
      by: ["novelId"],
      where: { ...where, novelId: { not: null } },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
      _count: { _all: true },
    }),
    db.usageCall.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const surfaces = bySurface
    .map((row) => toSurfaceUsage(row as SumRow, row.surface))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const novelIds = byNovel.map((row) => row.novelId as string);
  const knownNovels =
    novelIds.length > 0
      ? await db.novel.findMany({
          where: { id: { in: novelIds } },
          select: { id: true, title: true },
        })
      : [];
  const titleById = new Map(knownNovels.map((n) => [n.id, n.title]));

  const novels: LedgerNovelUsage[] = byNovel
    .map((row) => {
      const novelId = row.novelId as string;
      const title = titleById.get(novelId) ?? null;
      const sum = row as SumRow;
      return {
        novelId,
        title,
        deleted: title === null,
        calls: sum._count._all,
        promptTokens: sum._sum.promptTokens ?? 0,
        completionTokens: sum._sum.completionTokens ?? 0,
        totalTokens: sum._sum.totalTokens ?? 0,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    since: earliest ? earliest.createdAt.toISOString() : null,
    period: period && window ? period : null,
    surfaces,
    novels,
    ...sumsToTotals(surfaces),
    retention: RETENTION_NOTE,
  };
}

export interface NovelUsageSummary {
  novelId: string;
  title: string;
  /** Calls tagged with this novelId at record time. */
  direct: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number };
  /** Calls attached via provenance links (pre-novel wizard/init sessions). */
  linked: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number };
  surfaces: LedgerSurfaceUsage[];
  since: string | null;
  /** direct + linked — the ruling's "complete per-novel total". */
  total: CountSum;
}

interface CountSum {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const EMPTY: CountSum = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function addCounts(a: CountSum, b: CountSum): CountSum {
  return {
    calls: a.calls + b.calls,
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/**
 * Per-novel usage (Ruling: every novel has its OWN complete ledger).
 * direct = rows tagged novelId at record time; linked = rows whose
 * correlationId resolves through UsageProvenance. The two sets are
 * DISJOINT by construction (a linked row carries novelId = null) — the
 * harness asserts the no-double-count invariant.
 */
export async function novelUsageSummary(novelId: string): Promise<NovelUsageSummary | null> {
  const novel = await db.novel.findUnique({ where: { id: novelId }, select: { title: true } });
  if (!novel) return null;

  const links = await db.usageProvenance.findMany({
    where: { novelId },
    select: { correlationId: true },
  });
  const correlationIds = links.map((l) => l.correlationId);

  const [directRows, linkedRows] = await Promise.all([
    db.usageCall.findMany({
      where: { novelId },
      select: {
        surface: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        createdAt: true,
      },
    }),
    correlationIds.length > 0
      ? db.usageCall.findMany({
          // novelId: null keeps direct and linked disjoint even if a future
          // chokepoint ever sets both — no double counting by construction.
          where: { correlationId: { in: correlationIds }, novelId: null },
          select: {
            surface: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            createdAt: true,
          },
        })
      : Promise.resolve([] as typeof directRows),
  ]);

  const rows = [...directRows, ...linkedRows];
  const bySurface = new Map<string, LedgerSurfaceUsage>();
  let direct: CountSum = { ...EMPTY };
  let linked: CountSum = { ...EMPTY };

  const accumulate = (target: CountSum, row: (typeof directRows)[number]): CountSum => ({
    calls: target.calls + 1,
    promptTokens: target.promptTokens + row.promptTokens,
    completionTokens: target.completionTokens + row.completionTokens,
    totalTokens: target.totalTokens + row.totalTokens,
  });

  for (const row of directRows) {
    direct = accumulate(direct, row);
    const entry = bySurface.get(row.surface) ?? {
      surface: row.surface,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    entry.calls += 1;
    entry.promptTokens += row.promptTokens;
    entry.completionTokens += row.completionTokens;
    entry.totalTokens += row.totalTokens;
    bySurface.set(row.surface, entry);
  }
  for (const row of linkedRows) {
    linked = accumulate(linked, row);
    const entry = bySurface.get(row.surface) ?? {
      surface: row.surface,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    entry.calls += 1;
    entry.promptTokens += row.promptTokens;
    entry.completionTokens += row.completionTokens;
    entry.totalTokens += row.totalTokens;
    bySurface.set(row.surface, entry);
  }

  const since = rows.length > 0
    ? rows
        .map((r) => r.createdAt)
        .reduce((min, d) => (d < min ? d : min))
        .toISOString()
    : null;

  return {
    novelId,
    title: novel.title,
    direct,
    linked,
    surfaces: [...bySurface.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    since,
    total: addCounts(direct, linked),
  };
}
