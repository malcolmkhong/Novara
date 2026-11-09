// ---------------------------------------------------------------------------
// Novara AI — persisted AI usage ledger store (Phase 5 / P5-a, extended
// P5-b, P5-c; layered P5-f).
//
// Single source of truth for usage accounting (Ruling 2, user 2026-11-05):
// ONE row per measured-or-failed provider ATTEMPT in the UsageCall table,
// every surface. Since P5-b the in-memory per-process ledger is DELETED
// outright — this store is the only thing feeding any UI, with no debug
// layer and no dual feed.
//
// RETENTION LAYERING (Ruling R-2, user 2026-11-06 — supersedes Ruling 1's
// "permanent, no purge"): detail rows live 90 days, then the retention
// sweep (lib/usage/retention.ts) rolls them into UsageDaily — day × surface
// × novel-or-null × model, NEVER deleted — and deletes the details. Every
// read path here therefore merges BOTH sources: lifetime totals are
// aggregates + retained details (invariant across a purge), and the history
// block itemizes the last ~31 days of details plus older persisted daily
// summaries, labeled "summary — details retained 90 days".
//
// Honesty rules (P5-b Policy F, see usage-shapes.ts):
//   - MEASURED rows: the provider returned a usage object; tokens are billed
//     truth, never guessed, never padded. A null usage on a successful
//     completion records NOTHING (F4 — rowless-with-documentation).
//   - FAILED rows (F1): an attempt that ended with NO completion payload
//     (timeout / transport / 429 / 5xx / mid-flight abort) records ONE row
//     with zero tokens — the zeros mean UNKNOWN, never "0 tokens billed" —
//     plus an errorKind. Retries are separate attempts, hence separate rows.
//   - Pre-send failures (SDK init, abort before send) record NOTHING (F3 —
//     the provider was never reached).
//   - modelId records the REQUEST-side value exactly as sent. Calls that
//     carried no model field are stored under GATEWAY_DEFAULT_MODEL_ID —
//     never relabeled to a registry id the request did not carry (the
//     gateway rewrites response echoes anyway — phase3-stages.md §P3-A-2).
//
// Every write is fire-and-forget (F5): a ledger failure must never break a
// model call (mirrors emitUsageEvent's discipline in the agent runtime).
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import {
  DAILY_SUMMARY_NOTE,
  type AccountUsageSnapshot,
  type CountSum,
  type LedgerDailySummary,
  type LedgerNovelUsage,
  type LedgerSurfaceUsage,
  type NovelUsageSummary,
  type RealUsage,
  type UsageHistoryBlock,
} from "./usage-shapes";
import { estimateUpperBoundUsd, priceForModelId, PRICING_VERSION } from "./pricing";
import {
  ACCOUNT_WIDE_NOVEL_KEY,
  USAGE_HISTORY_WINDOW_DAYS,
  usageDetailCutoff,
  usageHistoryCutoff,
  utcDayKey,
} from "./retention";

export type {
  RealUsage,
  AiFailureKind,
  LedgerSurfaceUsage,
  LedgerNovelUsage,
  LedgerModelUsage,
  AccountEstimate,
  AccountUsageSnapshot,
  NovelUsageSummary,
  CountSum,
  LedgerDailySummary,
  UsageHistoryBlock,
} from "./usage-shapes";
export { extractRealUsage, classifyAiFailure, DAILY_SUMMARY_NOTE } from "./usage-shapes";
export { PRICING_VERSION, priceForModelId } from "./pricing";
export {
  ACCOUNT_WIDE_NOVEL_KEY,
  USAGE_DETAIL_RETENTION_DAYS,
  USAGE_HISTORY_WINDOW_DAYS,
  purgeExpiredUsageCalls,
  buildUsageStatement,
  usageDetailCutoff,
  usageHistoryCutoff,
  utcDayKey,
} from "./retention";

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

export type UsageCallStatus = "measured" | "failed";

export interface UsageCallEntry extends UsageCallScope {
  surface: string;
  /** Request-side model id exactly as sent; undefined = gateway default. */
  modelId?: string;
  /**
   * Measured provider truth. null + no status = record NOTHING (measured-only
   * rule); null + status:"failed" = one zero-token failed attempt row (F1).
   */
  usage: RealUsage | null;
  /** Default "measured". "failed" rows carry errorKind + zero tokens. */
  status?: UsageCallStatus;
  /** Policy F taxonomy (timeout | rate-limit | server-error | network | aborted | unknown). */
  errorKind?: string;
}

/**
 * Persist one ledger row: a MEASURED call (tokens = billed truth) or a
 * FAILED attempt (zero tokens = unknown cost, errorKind = why). One row per
 * HTTP attempt — retry loops call this once per attempt. Fire-and-forget.
 */
export function recordUsageCall(entry: UsageCallEntry): void {
  const failed = entry.status === "failed";
  if (!failed && !entry.usage) return; // measured-only rule (F4) stays intact
  void db.usageCall
    .create({
      data: {
        surface: entry.surface,
        modelId: entry.modelId ?? GATEWAY_DEFAULT_MODEL_ID,
        promptTokens: entry.usage?.promptTokens ?? 0,
        completionTokens: entry.usage?.completionTokens ?? 0,
        totalTokens: entry.usage?.totalTokens ?? 0,
        status: failed ? "failed" : "measured",
        errorKind: failed ? entry.errorKind ?? "unknown" : null,
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
// Read shapes — types live in usage-shapes.ts (client-safe); this module
// produces them from the persisted table.
// ---------------------------------------------------------------------------

export const RETENTION_NOTE =
  "Detail rows are retained 90 days, then permanently deleted — their totals survive as permanent daily summaries (never deleted). Export the CSV statement before expiry to keep the per-call lines. Rows before the persisted ledger shipped (Phase 5) do not exist.";

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

/** UI cap for the itemized history list (rows stay in the DB either way). */
const HISTORY_ITEM_CAP = 150;

interface CountAcc {
  calls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function emptyAcc(): CountAcc {
  return { calls: 0, failedCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function addAcc(a: CountAcc, b: { calls: number; failedCalls?: number; promptTokens: number; completionTokens: number; totalTokens: number }): CountAcc {
  return {
    calls: a.calls + b.calls,
    failedCalls: a.failedCalls + (b.failedCalls ?? 0),
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

/** Account-scope snapshot: aggregates (UsageDaily) + retained details
 *  (UsageCall) merged per dimension — invariant across a purge. */
export async function accountUsageSnapshot(period?: string): Promise<AccountUsageSnapshot> {
  const window = period ? monthWindow(period) : null;
  const where = window ? { createdAt: window } : {};
  // String day comparison is safe here: zero-padded same-width UTC keys.
  const dailyWhere = window
    ? { day: { gte: utcDayKey(window.gte), lt: utcDayKey(window.lt) } }
    : {};

  const [bySurface, byNovel, byModel, failedByModel, earliestDetail, failedCount, dailyRows] =
    await Promise.all([
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
      db.usageCall.groupBy({
        by: ["modelId"],
        where,
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
        _count: { _all: true },
      }),
      db.usageCall.groupBy({
        by: ["modelId"],
        where: { ...where, status: "failed" },
        _count: { _all: true },
      }),
      db.usageCall.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      db.usageCall.count({ where: { ...where, status: "failed" } }),
      db.usageDaily.findMany({ where: dailyWhere }),
    ]);

  // ---- merge the aggregate source into per-dimension accumulators -------
  const aggBySurface = new Map<string, CountAcc>();
  const aggByModel = new Map<string, CountAcc>();
  const aggByNovelKey = new Map<string, CountAcc>();
  let aggFailedTotal = 0;
  for (const bucket of dailyRows) {
    const acc: CountAcc = {
      calls: bucket.calls,
      failedCalls: bucket.failedCalls,
      promptTokens: bucket.promptTokens,
      completionTokens: bucket.completionTokens,
      totalTokens: bucket.totalTokens,
    };
    aggFailedTotal += bucket.failedCalls;
    aggBySurface.set(bucket.surface, addAcc(aggBySurface.get(bucket.surface) ?? emptyAcc(), acc));
    aggByModel.set(bucket.modelId, addAcc(aggByModel.get(bucket.modelId) ?? emptyAcc(), acc));
    if (bucket.novelKey !== ACCOUNT_WIDE_NOVEL_KEY) {
      aggByNovelKey.set(
        bucket.novelKey,
        addAcc(aggByNovelKey.get(bucket.novelKey) ?? emptyAcc(), acc)
      );
    }
  }

  const detailFailedByModel = new Map(failedByModel.map((r) => [r.modelId, r._count._all]));
  const failedFor = (modelId: string, agg: CountAcc | undefined) =>
    (detailFailedByModel.get(modelId) ?? 0) + (agg?.failedCalls ?? 0);

  // ---- surfaces ----------------------------------------------------------
  const surfaceAcc = new Map<string, CountAcc>();
  for (const row of bySurface) {
    const sum = row as SumRow;
    surfaceAcc.set(row.surface, {
      calls: sum._count._all,
      failedCalls: 0,
      promptTokens: sum._sum.promptTokens ?? 0,
      completionTokens: sum._sum.completionTokens ?? 0,
      totalTokens: sum._sum.totalTokens ?? 0,
    });
  }
  for (const [surface, acc] of aggBySurface) {
    surfaceAcc.set(surface, addAcc(surfaceAcc.get(surface) ?? emptyAcc(), acc));
  }
  const surfaces: LedgerSurfaceUsage[] = [...surfaceAcc.entries()]
    .map(([surface, acc]) => ({
      surface,
      calls: acc.calls,
      promptTokens: acc.promptTokens,
      completionTokens: acc.completionTokens,
      totalTokens: acc.totalTokens,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // ---- models (P5-c split, P5-f merged) ----------------------------------
  const modelAcc = new Map<string, CountAcc>();
  for (const row of byModel) {
    const sum = row as SumRow;
    modelAcc.set(row.modelId, {
      calls: sum._count._all,
      failedCalls: 0,
      promptTokens: sum._sum.promptTokens ?? 0,
      completionTokens: sum._sum.completionTokens ?? 0,
      totalTokens: sum._sum.totalTokens ?? 0,
    });
  }
  for (const [modelId, acc] of aggByModel) {
    modelAcc.set(modelId, addAcc(modelAcc.get(modelId) ?? emptyAcc(), acc));
  }
  let unpricedGroups = 0;
  let estimatedTotalUsd = 0;
  const models = [...modelAcc.entries()]
    .map(([modelId, acc]) => {
      const pricing = priceForModelId(modelId);
      const estimatedUsd = pricing.priced
        ? estimateUpperBoundUsd(pricing.row, acc.promptTokens, acc.completionTokens)
        : null;
      if (estimatedUsd === null) unpricedGroups += 1;
      else estimatedTotalUsd += estimatedUsd;
      return {
        modelId,
        calls: acc.calls,
        failedCalls: failedFor(modelId, aggByModel.get(modelId)),
        promptTokens: acc.promptTokens,
        completionTokens: acc.completionTokens,
        totalTokens: acc.totalTokens,
        priced: pricing.priced,
        unpricedReason: pricing.priced ? null : pricing.reason,
        estimatedUsd,
        pricingVersion: pricing.pricingVersion,
        sourceUrl: pricing.priced ? pricing.row.sourceUrl : null,
        fetchedAt: pricing.priced ? pricing.row.fetchedAt : null,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // ---- novels (deleted novels still render) ------------------------------
  const novelIds = [...new Set([...byNovel.map((r) => r.novelId as string), ...aggByNovelKey.keys()])];
  const knownNovels =
    novelIds.length > 0
      ? await db.novel.findMany({
          where: { id: { in: novelIds } },
          select: { id: true, title: true },
        })
      : [];
  const titleById = new Map(knownNovels.map((n) => [n.id, n.title]));

  const novelAcc = new Map<string, CountAcc>();
  for (const row of byNovel) {
    const sum = row as SumRow;
    const novelId = row.novelId as string;
    novelAcc.set(novelId, {
      calls: sum._count._all,
      failedCalls: 0,
      promptTokens: sum._sum.promptTokens ?? 0,
      completionTokens: sum._sum.completionTokens ?? 0,
      totalTokens: sum._sum.totalTokens ?? 0,
    });
  }
  for (const [novelKey, acc] of aggByNovelKey) {
    novelAcc.set(novelKey, addAcc(novelAcc.get(novelKey) ?? emptyAcc(), acc));
  }
  const novels: LedgerNovelUsage[] = [...novelAcc.entries()]
    .map(([novelId, acc]) => {
      const title = titleById.get(novelId) ?? null;
      return {
        novelId,
        title,
        deleted: title === null,
        calls: acc.calls,
        promptTokens: acc.promptTokens,
        completionTokens: acc.completionTokens,
        totalTokens: acc.totalTokens,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // ---- history block (P5-f): itemized window + persisted summaries -------
  const historyCutoff = usageHistoryCutoff();
  const [windowRows, windowCount, retainedNotItemized] = await Promise.all([
    db.usageCall.findMany({
      where: { createdAt: { gte: historyCutoff } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_ITEM_CAP,
      select: {
        id: true,
        createdAt: true,
        surface: true,
        modelId: true,
        novelId: true,
        status: true,
        errorKind: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
      },
    }),
    db.usageCall.count({ where: { createdAt: { gte: historyCutoff } } }),
    db.usageCall.count({ where: { createdAt: { lt: historyCutoff } } }),
  ]);
  const history: UsageHistoryBlock = {
    windowDays: USAGE_HISTORY_WINDOW_DAYS,
    rows: windowRows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      surface: r.surface,
      modelId: r.modelId,
      novelId: r.novelId,
      status: r.status,
      errorKind: r.errorKind,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
    })),
    omitted: Math.max(0, windowCount - windowRows.length),
    summaries: dailyRows
      .filter((b) => b.day < utcDayKey(historyCutoff))
      .sort((a, b) => (a.day === b.day ? a.surface.localeCompare(b.surface) : a.day.localeCompare(b.day)))
      .map((b) => ({
        day: b.day,
        surface: b.surface,
        modelId: b.modelId,
        novelId: b.novelId,
        novelKey: b.novelKey,
        calls: b.calls,
        failedCalls: b.failedCalls,
        promptTokens: b.promptTokens,
        completionTokens: b.completionTokens,
        totalTokens: b.totalTokens,
        estimatedUsd: b.estimatedUsd,
        pricingVersion: b.pricingVersion,
      })),
    retainedNotItemized,
    summaryNote: DAILY_SUMMARY_NOTE,
  };

  // ---- honest epoch: earliest detail OR earliest aggregate day -----------
  const aggEarliest = dailyRows.length > 0
    ? new Date(`${dailyRows.reduce((min, b) => (b.day < min ? b.day : min), dailyRows[0].day)}T00:00:00.000Z`)
    : null;
  const since =
    earliestDetail && aggEarliest
      ? (earliestDetail.createdAt < aggEarliest ? earliestDetail.createdAt : aggEarliest).toISOString()
      : earliestDetail
        ? earliestDetail.createdAt.toISOString()
        : aggEarliest
          ? aggEarliest.toISOString()
          : null;

  return {
    since,
    period: period && window ? period : null,
    surfaces,
    novels,
    models,
    estimate: {
      pricingVersion: PRICING_VERSION,
      upperBound: true,
      usd: estimatedTotalUsd,
      unpricedGroups,
    },
    ...sumsToTotals(surfaces),
    failedCalls: failedCount + aggFailedTotal,
    retention: RETENTION_NOTE,
    history,
  };
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

  // P5-f: this novel's purged rows, preserved as permanent daily aggregates
  // (novelKey = novelId). They join `total` and the per-surface list, so the
  // novel lifetime total is invariant across a purge.
  const archivedRows = await db.usageDaily.findMany({
    where: { novelKey: novelId },
    select: {
      surface: true,
      day: true,
      calls: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
    },
  });

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

  // P5-f: purged rows preserved as aggregates join the surface list; they
  // are disclosed as `archived` (a different epistemic layer than the
  // detail-derived direct/linked splits) and are part of `total`.
  let archived: NovelUsageSummary["archived"] = {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  for (const bucket of archivedRows) {
    archived = {
      calls: archived.calls + bucket.calls,
      promptTokens: archived.promptTokens + bucket.promptTokens,
      completionTokens: archived.completionTokens + bucket.completionTokens,
      totalTokens: archived.totalTokens + bucket.totalTokens,
    };
    const entry = bySurface.get(bucket.surface) ?? {
      surface: bucket.surface,
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    entry.calls += bucket.calls;
    entry.promptTokens += bucket.promptTokens;
    entry.completionTokens += bucket.completionTokens;
    entry.totalTokens += bucket.totalTokens;
    bySurface.set(bucket.surface, entry);
  }

  const detailSince = rows.length > 0
    ? rows
        .map((r) => r.createdAt)
        .reduce((min, d) => (d < min ? d : min))
    : null;
  const aggEarliestDay = archivedRows.length > 0
    ? archivedRows.reduce((min, b) => (b.day < min ? b.day : min), archivedRows[0].day)
    : null;
  const aggSince = aggEarliestDay ? new Date(`${aggEarliestDay}T00:00:00.000Z`) : null;
  const since =
    detailSince && aggSince
      ? (detailSince < aggSince ? detailSince : aggSince).toISOString()
      : detailSince
        ? detailSince.toISOString()
        : aggSince
          ? aggSince.toISOString()
          : null;

  const total = addCounts(direct, linked);
  return {
    novelId,
    title: novel.title,
    direct,
    linked,
    archived,
    surfaces: [...bySurface.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    since,
    total: {
      calls: total.calls + archived.calls,
      promptTokens: total.promptTokens + archived.promptTokens,
      completionTokens: total.completionTokens + archived.completionTokens,
      totalTokens: total.totalTokens + archived.totalTokens,
    },
    retention: RETENTION_NOTE,
  };
}
