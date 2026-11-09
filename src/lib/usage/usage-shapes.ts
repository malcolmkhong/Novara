// ---------------------------------------------------------------------------
// Novara AI — usage ledger SHARED SHAPES (Phase 5 / P5-b).
//
// Pure module: NO imports, NO server-only dependencies. Safe to import from
// client components (the Context Usage panel and the central "Usage &
// balance" view) and from the persisted store alike.
//
// P5-b (Ruling 2, user 2026-11-05): the in-memory process ledger
// (src/lib/usage/ledger.ts) is DELETED outright — no debug layer, no dual
// feed. These shapes are the only usage contract in the app.
//
// FAILED-CALL ACCOUNTING (P5-b Policy F, pinned):
//   F1  One UsageCall row per HTTP attempt after send. "measured" when the
//       provider returned a usage object (tokens = billed truth); "failed"
//       (zero tokens + errorKind) when the attempt ended with NO completion
//       payload at our boundary. Retries = separate attempts = separate rows.
//   F2  An ultimately-failed logical call leaves only failed rows.
//   F3  Pre-send failures (SDK init, abort before send) never reached the
//       provider — NO row.
//   F4  A completion payload received WITHOUT a usage object (streaming
//       without a usage chunk, stripped usage, empty content) records
//       NOTHING — token counts are unknowable, and a 0-token row would
//       understate. Rowless-with-documentation, measured-only rule intact.
//   F5  Every write is fire-and-forget; ledger failure never breaks a call.
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

/**
 * Policy F error taxonomy for status:"failed" rows. The kind classifies what
 * our boundary observed; it never claims what the provider billed.
 */
export type AiFailureKind =
  | "timeout"
  | "rate-limit"
  | "server-error"
  | "network"
  | "aborted"
  | "unknown";

const TIMEOUT_RE = /timed?\s*out|timeout/i;
const RATE_LIMIT_RE = /429|rate.?limit|too many requests|quota/i;
const SERVER_RE = /502|503|504|bad gateway|service unavailable|overloaded|5\d{2}\b/i;
const NETWORK_RE =
  /econn|enet|ehost|fetch failed|network|socket|premature close|dns|reset/i;
const ABORT_RE = /abort/i;

export function classifyAiFailure(error: unknown): AiFailureKind {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (ABORT_RE.test(message)) return "aborted";
  if (TIMEOUT_RE.test(message)) return "timeout";
  if (RATE_LIMIT_RE.test(message)) return "rate-limit";
  if (SERVER_RE.test(message)) return "server-error";
  if (NETWORK_RE.test(message)) return "network";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Read shapes — the account snapshot mirrors the retired in-memory snapshot's
// surface/totals shape so the P5-b panel swap changed the data source, not
// the rendering (types moved here from usage-store for client-safe imports).
// ---------------------------------------------------------------------------

export interface LedgerSurfaceUsage {
  surface: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * P5-c per-model split (§6): UsageCall.modelId stores the REQUEST-side value
 * verbatim; this aggregates it. Failed rows contribute ZERO tokens by
 * definition (Policy F) — their count is disclosed SEPARATELY, next to the
 * model's estimated cost, and is never folded into the token sums.
 */
export interface LedgerModelUsage {
  modelId: string;
  /** All attempts (measured + failed). */
  calls: number;
  /** Policy F rows with no completion payload — shown separately. */
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** false = no sourced price row exists → estimatedUsd is null, never $0. */
  priced: boolean;
  /** "gateway-default" | "unlisted-model" — why a group is unpriced. */
  unpricedReason: string | null;
  /** Σ(measured tokens × listed price), UPPER BOUND (cached discount
   *  invisible); null when unpriced (§6.2 rule 3: never $0-by-guess). */
  estimatedUsd: number | null;
  pricingVersion: string;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

/** P5-c account-level estimate — Σ over PRICED groups only. */
export interface AccountEstimate {
  pricingVersion: string;
  /** Always an upper bound: cached-input discount is invisible to us. */
  upperBound: true;
  /** Σ over priced model groups (0 when nothing is priced — never null at
   *  account level; per-group unpriced-ness is disclosed via unpricedGroups). */
  usd: number;
  /** Model groups with no honest price — EXCLUDED from usd, never $0. */
  unpricedGroups: number;
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

// ---------------------------------------------------------------------------
// P5-f (Ruling R-2, user 2026-11-06) — retention layering shapes. Detail rows
// are kept 90 days, then rolled into UsageDaily (never deleted) and purged.
// Views render ~31 days of itemized detail history + persisted daily
// summaries for older days; lifetime totals are aggregates + retained
// details, so they are invariant across a purge.
// ---------------------------------------------------------------------------

/** One persisted UsageDaily bucket, rendered as a daily summary line. */
export interface LedgerDailySummary {
  /** UTC day "YYYY-MM-DD" the rolled-up detail rows fell in. */
  day: string;
  surface: string;
  modelId: string;
  /** null = account-wide bucket (unlinked rows). */
  novelId: string | null;
  novelKey: string;
  calls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Rollup-time Σ upper-bound estimate over PRICED contributions;
   *  null = nothing in this bucket was priced (never $0-by-guess). */
  estimatedUsd: number | null;
  pricingVersion: string;
}

/** Ruled disclosure attached to every summary render. */
export const DAILY_SUMMARY_NOTE = "summary — details retained 90 days";

export interface UsageHistoryBlock {
  /** The itemized-detail window in days (ruled: 31). */
  windowDays: number;
  /** Itemized detail rows within the window, newest first (capped). */
  rows: {
    id: string;
    at: string;
    surface: string;
    modelId: string;
    novelId: string | null;
    status: string;
    errorKind: string | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }[];
  /** Detail rows inside the window beyond the UI cap (still in the DB). */
  omitted: number;
  /** Persisted daily summaries for days older than the window, day asc. */
  summaries: LedgerDailySummary[];
  /** Retained detail rows OLDER than the window (31–90 days): kept in the
   *  DB, exportable, not itemized in the compact view. */
  retainedNotItemized: number;
  /** The ruled summary label for every aggregated line. */
  summaryNote: string;
}

export interface AccountUsageSnapshot {
  /** Earliest persisted row (the honest epoch — rows before P5-a do not exist). */
  since: string | null;
  /** All-time when null (no period filter given). */
  period: string | null;
  surfaces: LedgerSurfaceUsage[];
  novels: LedgerNovelUsage[];
  /** P5-c: per-request-side-model split with separately-disclosed failures. */
  models: LedgerModelUsage[];
  /** P5-c: account-level ESTIMATE over priced groups (upper bound). */
  estimate: AccountEstimate;
  totalCalls: number;
  /** P5-b Policy F: attempts with NO completion payload (0-token rows). */
  failedCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  /** Permanent-retention disclosure (R-2) for the UI to render. */
  retention: string;
  /** P5-f: recent itemized history (31d) + persisted daily summaries. */
  history: UsageHistoryBlock;
}

export interface NovelUsageSummary {
  novelId: string;
  title: string;
  /** Calls tagged with this novelId at record time. */
  direct: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number };
  /** Calls attached via provenance links (pre-novel wizard/init sessions). */
  linked: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number };
  /** P5-f: this novel's purged rows, preserved as UsageDaily aggregates
   *  (never deleted) — part of `total`, disclosed separately. */
  archived: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number };
  surfaces: LedgerSurfaceUsage[];
  since: string | null;
  /** direct + linked + archived — the ruling's "complete per-novel total",
   *  aggregates + retained details (invariant across a purge). */
  total: CountSum;
  /** P5-b: retention disclosure travels with BOTH ledger routes. */
  retention: string;
}

export interface CountSum {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// P5-c invoice reconciliation shapes (§6.3) — what /api/usage/invoice returns
// and the central view's paste-slot consumes. actualUsd is USER-SUPPLIED text
// stored verbatim; estimatedUsd is OUR upper-bound figure captured at save
// time (String of the number, reproducible via pricingVersion).
// ---------------------------------------------------------------------------

export interface InvoiceEntry {
  id: string;
  /** The pasted figure, exactly as supplied (currency mark stripped). */
  actualUsd: string;
  currency: string;
  /** User-typed period the figure covers. */
  periodLabel: string;
  note: string | null;
  /** OUR ESTIMATE at save time (upper bound; String of the USD number). */
  estimatedUsd: string;
  /** UsageCall rows the estimate summed. */
  trackedRows: number;
  sinceAtSave: string | null;
  pricingVersion: string;
  createdAt: string;
}

export interface InvoiceSnapshot {
  entries: InvoiceEntry[];
  totalEntries: number;
  pricingVersion: string;
  sourceUrl: string;
  fetchedAt: string;
  retention: string;
}
