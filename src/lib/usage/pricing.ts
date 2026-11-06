// ---------------------------------------------------------------------------
// Novara AI — GLM pricing table (Phase 5 / P5-c, proposal §6.1).
//
// ONE versioned, static, request-side-modelId-keyed table. This module is the
// only place in the codebase that knows a token price; it is PURE (zero
// imports) so both the persisted store (server) and the central view (client)
// can key off it.
//
// PRICING VERSION 2026-11-06.1 — sources (fetched LIVE 2026-11-06, HTTP 200):
//
//   https://docs.z.ai/guides/overview/pricing
//     — section "Models · Text Models", table "Prices per 1M tokens",
//       columns: Model | Input | Cached Input | Cached Input Storage | Output
//       (parsed from the fetched page's <table> rows, verbatim:)
//         GLM-4.6     | $0.6 | $0.11 | Limited-time Free | $2.2
//         GLM-4.5-Air | $0.2 | $0.03 | Limited-time Free | $1.1
//         GLM-4.5-Flash | Free | Free | Free | Free
//         GLM-4.7-Flash | Free | Free | Free | Free
//   https://docs.z.ai/guides/llm/glm-4.6  (model page, HTTP 200, fetched
//     2026-11-06 — corroborates the GLM-4.6 row; matches the numbers already
//     user-approved in phase5-proposal.md §6.1, investigated P3-a)
//
//   NOT LISTED (verified 2026-11-06): registry ids "glm-4-flash" and
//   "glm-4-long" have NO row on the fetched pricing page, and
//   https://docs.z.ai/guides/llm/glm-4-flash returns HTTP 404. Binding rule
//   (§6.2.3): a missing pricing row renders UNPRICED — never a guess, never
//   $0-by-assumption ("free tier" is P4 operational lore, not a priced row).
//
//   GATEWAY-DEFAULT rows (modelId "gateway-default" — requests that carried
//   no model field; usage-store.ts GATEWAY_DEFAULT_MODEL_ID) are UNPRICED by
//   construction: there is no model to key a price on (P5-a store comment).
//
// HONESTY RULES (proposal §6.2, binding):
//   1. Every $ figure = measured tokens × listed price, from UsageCall rows
//      only, and is labeled ESTIMATE — ALWAYS, because the cached-input
//      discount (cached-in $0.11/1M on GLM-4.6) is invisible to us: we never
//      observe which bytes hit the cache. Our figure is an UPPER BOUND.
//   2. No per-call cached discount, no echo-derived tiering, no hand
//      adjustments. Retries are real rows and real money.
//   3. A $ column that cannot honestly compute renders UNPRICED, never $0.
//
// EVERY dollar string a user can ever see is produced by the formatters at
// the bottom of this file — each permanently carries its ESTIMATE/figure
// label. UI files contain no raw dollar glyphs (harness-pinned).
// ---------------------------------------------------------------------------

/** Bump when any row changes; stored on invoice entries for reproducibility. */
export const PRICING_VERSION = "2026-11-06.1";

/** Docs page every row below was parsed from, fetched 2026-11-06 (HTTP 200). */
export const PRICING_SOURCE_URL = "https://docs.z.ai/guides/overview/pricing";
export const PRICING_FETCHED_AT = "2026-11-06";

export interface PriceRow {
  /** USD per 1M prompt tokens (the table's "Input" column). */
  inputUsdPer1M: number;
  /** USD per 1M completion tokens (the table's "Output" column). */
  outputUsdPer1M: number;
  /** Present in the docs but NEVER applied — see honesty rule 1. */
  cachedInputUsdPer1M: number | null;
  sourceUrl: string;
  fetchedAt: string;
}

/** The static table — keyed by REQUEST-side modelId exactly as sent. */
const PRICE_TABLE: Record<string, PriceRow> = {
  "glm-4.6": {
    inputUsdPer1M: 0.6,
    outputUsdPer1M: 2.2,
    cachedInputUsdPer1M: 0.11,
    sourceUrl: PRICING_SOURCE_URL,
    fetchedAt: PRICING_FETCHED_AT,
  },
  "glm-4.5-air": {
    inputUsdPer1M: 0.2,
    outputUsdPer1M: 1.1,
    cachedInputUsdPer1M: 0.03,
    sourceUrl: PRICING_SOURCE_URL,
    fetchedAt: PRICING_FETCHED_AT,
  },
};

export type PricingResult =
  | {
      priced: true;
      row: PriceRow;
      pricingVersion: string;
      /** Fixed disclosure: what the number is and why it is an upper bound. */
      basis: string;
    }
  | {
      priced: false;
      pricingVersion: string;
      reason: "gateway-default" | "unlisted-model";
    };

/**
 * Keyed lookup by request-side modelId. "gateway-default" (no model field on
 * the wire) and any id absent from the fetched docs render UNPRICED — never
 * guessed, never $0 (§6.2 rule 3).
 */
export function priceForModelId(modelId: string): PricingResult {
  if (modelId === "gateway-default") {
    return { priced: false, reason: "gateway-default", pricingVersion: PRICING_VERSION };
  }
  const row = PRICE_TABLE[modelId];
  if (!row) {
    return { priced: false, reason: "unlisted-model", pricingVersion: PRICING_VERSION };
  }
  return {
    priced: true,
    row,
    pricingVersion: PRICING_VERSION,
    basis:
      "measured tokens x listed price; cached-input discount never applied, so this is an upper bound",
  };
}

/**
 * §6.2 rule 1 arithmetic: measured tokens × listed price. Upper bound by
 * construction (cached discount invisible). Call only on priced:true results.
 */
export function estimateUpperBoundUsd(
  row: PriceRow,
  promptTokens: number,
  completionTokens: number
): number {
  return (promptTokens * row.inputUsdPer1M + completionTokens * row.outputUsdPer1M) / 1_000_000;
}

/** Permanent suffix for every rendered estimate — rule 1 is not optional. */
export const ESTIMATE_LABEL = "ESTIMATE (upper bound)";

/** Significant digits adapt to magnitude; the label never changes. */
export function formatEstimateUsd(usd: number): string {
  const abs = Math.abs(usd);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const trimmed = String(parseFloat(usd.toFixed(digits)));
  return `$${trimmed} ${ESTIMATE_LABEL}`;
}

/** Compact per-row variant for tight lists — still carries the EST label
 *  (a bare dollar figure is never rendered anywhere). */
export function formatEstimateUsdCompact(usd: number): string {
  const abs = Math.abs(usd);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const trimmed = String(parseFloat(usd.toFixed(digits)));
  return `$${trimmed} EST`;
}

/** The user's own invoice figure, always marked as THEIR input, not ours. */
export function formatPastedUsd(raw: string): string {
  const cleaned = raw.trim().replace(/^\$/, "");
  return `$${cleaned} — your figure (as pasted)`;
}

/** Signed gap between the pasted actual and our ESTIMATE, labeled. */
export function formatDeltaUsd(deltaUsd: number): string {
  const abs = Math.abs(deltaUsd);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const trimmed = String(parseFloat(abs.toFixed(digits)));
  const sign = deltaUsd > 0 ? "+" : deltaUsd < 0 ? "-" : "+/-";
  return `${sign}$${trimmed} vs our ESTIMATE`;
}
