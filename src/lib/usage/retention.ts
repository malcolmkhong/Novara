// ---------------------------------------------------------------------------
// Novara AI — usage ledger retention (Phase 5 / P5-f, Ruling R-2).
//
// DETAIL RETENTION: UsageCall rows are kept 90 days, then PERMANENTLY
// DELETED — but never before their counts and tokens are rolled up into
// UsageDaily (day × surface × novel-or-null × model), which NO code path
// ever deletes. This module is the only writer of UsageDaily and the only
// deleter of UsageCall; the sweep is deterministic (keyed on createdAt
// alone), idempotent end-to-end (a second run over the same state sweeps
// zero rows), and never a side effect of content deletion.
//
// IDEMPOTENCE / CRASH BIAS. Per bucket the sweep deletes the detail rows
// FIRST (already captured in memory), then upserts the aggregate increment.
// SQLite's single-writer makes each step atomic; if the process dies
// between the two, the rerun cannot double-count (the rows are gone), so
// the worst case of a torn sweep is an UNDERCOUNT of one bucket's
// aggregate chunk — never a money inflation. In the normal path the
// totals invariant holds exactly: purge moves counts/tokens from details
// into aggregates without changing any total.
//
// PROVENANCE AT ROLLUP. Detail rows with novelId = null but a
// correlationId that resolves through UsageProvenance (the wizard
// precedent — pre-novel consumption retro-tagged at novel creation) roll
// up into the LINKED novel's bucket, so novel lifetime totals survive the
// purge. A correlationId linked to more than one novel is left
// account-wide (counted, never guessed between novels).
//
// ZERO new dependencies; zero server-side file persistence. The sweep runs
// from src/instrumentation.ts at server start and on demand via
// scripts/purge-usage.ts — same function, same guarantees.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import {
  PRICING_VERSION,
  estimateUpperBoundUsd,
  priceForModelId,
} from "./pricing";

/** Ruled detail-retention window (R-2): 90 days, then delete. */
export const USAGE_DETAIL_RETENTION_DAYS = 90;

/** Ruled display window for itemized history (R-2): the most recent ~31 days. */
export const USAGE_HISTORY_WINDOW_DAYS = 31;

/** novelKey sentinel for account-wide (unlinked) rollup buckets. */
export const ACCOUNT_WIDE_NOVEL_KEY = "-";

export function usageDetailCutoff(now = new Date(), retentionDays = USAGE_DETAIL_RETENTION_DAYS): Date {
  return new Date(now.getTime() - retentionDays * 86_400_000);
}

export function usageHistoryCutoff(now = new Date(), windowDays = USAGE_HISTORY_WINDOW_DAYS): Date {
  return new Date(now.getTime() - windowDays * 86_400_000);
}

/** UTC day key "YYYY-MM-DD" — aggregates are day-bucketed in UTC. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface PurgeResult {
  /** Detail rows found beyond the retention window. */
  swept: number;
  /** Detail rows deleted (= swept in the normal path). */
  deleted: number;
  /** UsageDaily buckets touched by this sweep. */
  buckets: number;
}

/**
 * Roll up every UsageCall row older than the retention window into
 * UsageDaily, then delete exactly those rows. Rerunning over a purged
 * state sweeps zero rows (idempotent). Aggregates are only ever
 * incremented, never reset or deleted.
 */
export async function purgeExpiredUsageCalls(
  retentionDays = USAGE_DETAIL_RETENTION_DAYS
): Promise<PurgeResult> {
  const cutoff = usageDetailCutoff(new Date(), retentionDays);
  const expired = await db.usageCall.findMany({
    where: { createdAt: { lt: cutoff } },
    select: {
      id: true,
      surface: true,
      modelId: true,
      novelId: true,
      correlationId: true,
      status: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      createdAt: true,
      userId: true,
    },
  });
  if (expired.length === 0) return { swept: 0, deleted: 0, buckets: 0 };

  // Resolve retro-tag links for expired null-novel rows (wizard precedent):
  // correlationId → the ONE linked novel, else account-wide.
  const unlinkedIds = [
    ...new Set(
      expired.filter((r) => r.novelId === null && r.correlationId !== null).map((r) => r.correlationId as string)
    ),
  ];
  const links = unlinkedIds.length
    ? await db.usageProvenance.findMany({
        where: { correlationId: { in: unlinkedIds } },
        orderBy: { createdAt: "asc" },
        select: { correlationId: true, novelId: true },
      })
    : [];
  const novelByCorrelation = new Map<string, string>();
  const conflict = new Set<string>();
  for (const link of links) {
    const known = novelByCorrelation.get(link.correlationId);
    if (known === undefined) novelByCorrelation.set(link.correlationId, link.novelId);
    else if (known !== link.novelId) conflict.add(link.correlationId);
  }
  for (const id of conflict) novelByCorrelation.delete(id);

  // Bucket: (UTC day, surface, novelKey, modelId).
  interface Bucket {
    ids: string[];
    novelId: string | null;
    novelKey: string;
    calls: number;
    failedCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    // ATTRIBUTION (Step 53): the owners of the detail rows in this bucket.
    // One owner -> the bucket gets it; several or none -> the bucket stays
    // unattributed. Never invented, never merged.
    userIds: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  for (const row of expired) {
    const resolvedNovelId =
      row.novelId ?? (row.correlationId ? novelByCorrelation.get(row.correlationId) ?? null : null);
    const novelKey = resolvedNovelId ?? ACCOUNT_WIDE_NOVEL_KEY;
    const key = `${utcDayKey(row.createdAt)}|${row.surface}|${novelKey}|${row.modelId}`;
    const bucket = buckets.get(key) ?? {
      ids: [],
      novelId: resolvedNovelId,
      novelKey,
      calls: 0,
      failedCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      userIds: new Set<string>(),
    };
    bucket.ids.push(row.id);
    bucket.calls += 1;
    if (row.status === "failed") bucket.failedCalls += 1;
    bucket.promptTokens += row.promptTokens;
    bucket.completionTokens += row.completionTokens;
    bucket.totalTokens += row.totalTokens;
    if (row.userId) bucket.userIds.add(row.userId);
    buckets.set(key, bucket);
  }

  let deleted = 0;
  let touched = 0;
  for (const [key, bucket] of buckets) {
    const [day, surface, , modelId] = key.split("|");

    // Delete FIRST (rows already captured above): a torn sweep biases to
    // undercount on rerun, never to double-count — see module header.
    const gone = await db.usageCall.deleteMany({ where: { id: { in: bucket.ids } } });
    deleted += gone.count;

    // This contribution's ESTIMATE: priced upper bound over this sweep's
    // measured tokens; an unpriced model contributes nothing (never $0).
    const pricing = priceForModelId(modelId);
    const contributionUsd =
      pricing.priced
        ? estimateUpperBoundUsd(pricing.row, bucket.promptTokens, bucket.completionTokens)
        : null;

    await db.usageDaily.upsert({
      where: {
        day_surface_novelKey_modelId: { day, surface, novelKey: bucket.novelKey, modelId },
      },
      create: {
        day,
        surface,
        modelId,
        novelId: bucket.novelId,
        novelKey: bucket.novelKey,
        calls: bucket.calls,
        failedCalls: bucket.failedCalls,
        promptTokens: bucket.promptTokens,
        completionTokens: bucket.completionTokens,
        totalTokens: bucket.totalTokens,
        estimatedUsd: contributionUsd,
        pricingVersion: PRICING_VERSION,
        // ATTRIBUTION (Step 53): one owner for the whole bucket -> that
        // owner; several owners (or none) -> unattributed, never guessed.
        userId: bucket.userIds.size === 1 ? [...bucket.userIds][0] : null,
      },
      update: {
        calls: { increment: bucket.calls },
        failedCalls: { increment: bucket.failedCalls },
        promptTokens: { increment: bucket.promptTokens },
        completionTokens: { increment: bucket.completionTokens },
        totalTokens: { increment: bucket.totalTokens },
        // A priced contribution joins the stored sum; an unpriced one changes
        // nothing (null stays null — never $0-by-guess).
        estimatedUsd: contributionUsd === null ? undefined : { increment: contributionUsd },
        pricingVersion: PRICING_VERSION,
      },
    });
    touched += 1;
  }

  return { swept: expired.length, deleted, buckets: touched };
}

// ---------------------------------------------------------------------------
// CSV statement — the R-2 export: ALL retained detail rows (the 90-day
// window) + ALL persisted daily summaries, plus labeled totals. Built in
// memory; ZERO server-side file persistence.
// ---------------------------------------------------------------------------

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build the full CSV statement text. The estimate figure is recomputed from
 * preserved tokens with the CURRENT sourced price table (the same math the
 * views use), so it is consistent across purged and unpurged history; the
 * per-bucket estimatedUsd column discloses the rollup-time figure.
 */
export async function buildUsageStatement(now = new Date()): Promise<string> {
  const { accountUsageSnapshot } = await import("./usage-store");
  const snapshot = await accountUsageSnapshot();
  const cutoff = usageDetailCutoff(now);
  const details = await db.usageCall.findMany({
    where: { createdAt: { gte: cutoff } },
    orderBy: { createdAt: "asc" },
    select: {
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
  });
  const summaries = await db.usageDaily.findMany({ orderBy: [{ day: "asc" }, { surface: "asc" }] });

  const lines: string[] = [];
  lines.push("# Novara AI — usage statement (CSV)");
  lines.push(`# generated-at: ${now.toISOString()}`);
  lines.push("# scope: account, all surfaces, entire retained history");
  lines.push(
    `# pricing: ESTIMATE (upper bound — cached-input discount invisible), price table ${snapshot.estimate.pricingVersion}`
  );
  lines.push(
    `# retention: detail rows are deleted ${USAGE_DETAIL_RETENTION_DAYS} days after their call;` +
      ` older history appears only as persisted daily summaries (never deleted)` +
      ` — export before expiry to keep the per-call lines`
  );
  lines.push(`# tracking began: ${snapshot.since ?? "n/a (no rows yet)"}`);
  lines.push(`# detail rows in this statement: ${details.length} (the retained ${USAGE_DETAIL_RETENTION_DAYS}-day window)`);
  lines.push(`# daily summaries in this statement: ${summaries.length}`);

  lines.push("");
  lines.push("section,at_utc,surface,model,novel,status,error,prompt_tokens,completion_tokens,total_tokens");
  for (const d of details) {
    lines.push(
      [
        "detail",
        d.createdAt.toISOString(),
        csvCell(d.surface),
        csvCell(d.modelId),
        csvCell(d.novelId),
        csvCell(d.status),
        csvCell(d.errorKind),
        d.promptTokens,
        d.completionTokens,
        d.totalTokens,
      ].join(",")
    );
  }

  lines.push("");
  lines.push(
    "section,day,surface,model,novel,calls,failed_calls,prompt_tokens,completion_tokens,total_tokens,estimate_usd,pricing_version"
  );
  for (const s of summaries) {
    lines.push(
      [
        "summary",
        s.day,
        csvCell(s.surface),
        csvCell(s.modelId),
        csvCell(s.novelId ?? s.novelKey),
        s.calls,
        s.failedCalls,
        s.promptTokens,
        s.completionTokens,
        s.totalTokens,
        s.estimatedUsd === null ? "unpriced" : String(s.estimatedUsd),
        csvCell(s.pricingVersion),
      ].join(",")
    );
  }

  lines.push("");
  lines.push("section,label,value");
  lines.push(`totals,total_calls,${snapshot.totalCalls}`);
  lines.push(`totals,failed_calls_zero_tokens,${snapshot.failedCalls}`);
  lines.push(`totals,prompt_tokens,${snapshot.totalPromptTokens}`);
  lines.push(`totals,completion_tokens,${snapshot.totalCompletionTokens}`);
  lines.push(`totals,total_tokens,${snapshot.totalTokens}`);
  lines.push(`totals,estimate_usd_upper_bound,${snapshot.estimate.usd}`);
  lines.push(`totals,unpriced_model_groups_excluded,${snapshot.estimate.unpricedGroups}`);
  return lines.join("\n") + "\n";
}
