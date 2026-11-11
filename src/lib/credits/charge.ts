// ---------------------------------------------------------------------------
// Novara AI — charge maths (Step 55).
//
// THE MATHS AND THE RESERVATION. No routes live here: this module turns a
// measured provider call into a credit amount, and turns "a call is about to
// happen" into a reservation that can be settled afterwards.
//
// THE RULE: 1 credit = $0.001 of measured AI cost (CREDITS_USD_PER_CREDIT).
//
//   usd     = estimateUpperBoundUsd(priceRow, promptTokens, completionTokens)
//             (the EXISTING pricing helper — no second price table here)
//   credits = ceil(usd / CREDITS_USD_PER_CREDIT)
//   and at least 1 credit for any call that actually happened.
//
// UNPRICED MODELS MUST NOT BE FREE. A request that carried no model field
// is recorded under "gateway-default" (and any id with no price row is
// equally unpriced). Those calls fall back to the DEFAULT model's price —
// the model the router actually used — and the ledger row is tagged
// "priced-by-fallback". Without the fallback those calls would cost 0
// credits, which would make the most common surface free.
//
// THE RESERVATION. A call is charged in two steps:
//   beginCharge()  reserves a conservative per-surface hold (the cost is not
//                  known yet — the provider has not answered),
//   settleCharge()  replaces the hold with the MEASURED cost: the surplus is
//                  refunded, and a call that cost MORE than the hold takes
//                  the difference as DEBT (a negative balance, forgiven at the
//                  next daily reset).
// A failed call (0 tokens) is fully refunded: nothing is charged for it.
//
// NOT WIRED YET except for POST /api/generate (Step 55 scope). The other AI
// routes are untouched.
// ---------------------------------------------------------------------------

import { DEFAULT_MODEL_ID } from "@/lib/ai/providers/registry";
import { estimateUpperBoundUsd, priceForModelId } from "@/lib/usage/pricing";
import { currentScopeUserId } from "@/lib/db";
import { headers } from "next/headers";
import {
  accountState,
  ensureDailyGrant,
  globalKillSwitchActive,
  holdCredits,
  isAdmin,
  nextResetAt,
  recordAdminUsage,
  refundCredits,
  takeCreditsAllowDebt,
  type CreditMeta,
} from "./ledger";

/** 1 credit = $0.001 of measured AI cost. */
export const CREDITS_USD_PER_CREDIT = 0.001;

/**
 * Conservative per-surface holds, in credits. A hold is what a call is
 * charged BEFORE its real cost is known; it is returned (or topped up) when
 * the call settles.
 *
 * Env-overridable per surface: CREDITS_RESERVE_GENERATE, _DETECT, _WIZARD,
 * _DRAFT, _REVIEW, _SEDIMENT, _AGENT_TURN, _TEAM_TURN.
 */
const SURFACE_RESERVES: Record<string, number> = {
  generate: 2,
  detect: 2,
  draft: 15,
  wizard: 40,
  review: 20,
  sediment: 20,
  "agent-turn": 15,
  "team-turn": 20,
};

/** The hold for a surface. Unknown surfaces get the LARGEST hold — never a
 *  free pass (a new surface must be added to the map deliberately). */
export function reserveCredits(surface: string): number {
  const key = `CREDITS_RESERVE_${surface.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const raw = process.env[key];
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed);
  }
  const configured = SURFACE_RESERVES[surface];
  if (configured !== undefined) return configured;
  return Math.max(...Object.values(SURFACE_RESERVES));
}

export interface CreditsFromUsage {
  /** Credits to charge for this call (0 when nothing was measured). */
  credits: number;
  /** The measured-cost estimate in USD (an upper bound). */
  usd: number;
  /** Was the price taken from the DEFAULT model because the id had no price? */
  pricedByFallback: boolean;
  /** The model id the price came from. */
  pricedModelId: string;
  /** The ledger note to attach ("priced-by-fallback" when the fallback was used). */
  note: string | null;
}

/**
 * The credit cost of one measured call.
 *
 * `modelId` is the REQUEST-side id exactly as it was recorded in UsageCall
 * ("gateway-default" for a request that carried no model field).
 */
export function creditsFromUsage(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): CreditsFromUsage {
  const prompt = Math.max(0, Math.trunc(promptTokens || 0));
  const completion = Math.max(0, Math.trunc(completionTokens || 0));

  const direct = priceForModelId(modelId);
  let priced = direct.priced;
  let row = direct.priced ? direct.row : null;
  let pricedModelId = modelId;

  if (!direct.priced) {
    // UNPRICED MUST NOT BE FREE: fall back to the DEFAULT model's price —
    // the model the router actually used for a request with no model field.
    const fallback = priceForModelId(DEFAULT_MODEL_ID);
    if (fallback.priced) {
      priced = true;
      row = fallback.row;
      pricedModelId = DEFAULT_MODEL_ID;
    }
  }

  const usd = row ? estimateUpperBoundUsd(row, prompt, completion) : 0;
  const nothingMeasured = prompt + completion === 0;
  const credits = nothingMeasured ? 0 : Math.max(1, Math.ceil(usd / CREDITS_USD_PER_CREDIT));
  const pricedByFallback = !direct.priced && priced;

  return {
    credits,
    usd,
    pricedByFallback,
    pricedModelId,
    note: pricedByFallback ? "priced-by-fallback" : null,
  };
}

/**
 * HARD surfaces: the whole call must be affordable BEFORE it starts. The
 * reserve is the real cost of one such call (an agent turn, a team turn), so
 * a user with less than the reserve is refused outright — a partially funded
 * agent turn would spend money the user cannot cover.
 *
 * SOFT surfaces: everything else. There the hold is capped by what the user
 * has (D13) and only a zero balance is refused.
 */
export const HARD_SURFACES = ["agent-turn", "team-turn"] as const;

export function isHardSurface(surface: string): boolean {
  return (HARD_SURFACES as readonly string[]).includes(surface);
}

/**
 * A refusal the caller can turn into an HTTP answer: the status and the
 * payload. Thrown by the charge choke point so a route never has to guess
 * whether a failure was a credit problem.
 */
export class CreditError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>, message: string) {
    super(message);
    this.name = "CreditError";
    this.status = status;
    this.payload = payload;
  }
}

/** The verified caller of this request (or background job). */
export async function currentChargeUid(): Promise<string | null> {
  const scoped = currentScopeUserId();
  if (scoped) return scoped;
  try {
    const h = await headers();
    const uid = h.get("x-novara-uid")?.trim();
    return uid ? uid : null;
  } catch {
    return null;
  }
}

/**
 * May this caller afford this surface? READ-ONLY — it reserves nothing.
 *
 * The pre-flight for the expensive paths (the agent run route asks before it
 * creates a run, so an unfunded user gets a 402 instead of a run that dies
 * in the background).
 */
export async function canAfford(
  userId: string,
  surface: string,
): Promise<ChargeHold> {
  if (isAdmin(userId)) return { ok: true, hold: 0, admin: true };
  if (await globalKillSwitchActive()) {
    return { ok: false, hold: 0, reason: "kill-switch" };
  }
  const reserve = reserveCredits(surface);
  await ensureDailyGrant(userId);
  const account = await accountState(userId);
  const balance = account?.balance ?? 0;
  if (isHardSurface(surface)) {
    if (balance < reserve) {
      return {
        ok: false,
        hold: 0,
        reason: "insufficient",
        need: reserve,
        balance,
        resetAt: nextResetAt(),
      };
    }
    return { ok: true, hold: reserve, balance };
  }
  if (balance <= 0) {
    return {
      ok: false,
      hold: 0,
      reason: "insufficient",
      need: reserve,
      balance: 0,
      resetAt: nextResetAt(),
    };
  }
  return { ok: true, hold: Math.min(reserve, balance), balance };
}

/**
 * The verified caller of this request (or background job), or a refusal.
 *
 * A spend needs an owner: with no identity in scope the caller must NOT
 * reach the provider.
 */
export async function requireChargeUid(surface: string): Promise<string> {
  const uid = await currentChargeUid();
  if (!uid) {
    throw new CreditError(
      401,
      { error: "unauthenticated" },
      `no request identity in scope for surface "${surface}" — refusing to call the provider`,
    );
  }
  return uid;
}

/**
 * Charge a surface or throw the refusal as a CreditError (the caller decides
 * how to answer it — the routes turn it into a 402 / 429).
 */
export async function chargeOrThrow(
  userId: string,
  surface: string,
  meta: CreditMeta = {},
): Promise<{ uid: string; hold: number }> {
  const charge = await beginCharge(userId, surface, meta);
  if (charge.ok) return { uid: userId, hold: charge.hold };
  if (charge.reason === "kill-switch") {
    throw new CreditError(429, { error: "globally_paused" }, "globally_paused");
  }
  throw new CreditError(
    402,
    {
      error: "insufficient_credits",
      need: charge.need ?? 0,
      balance: charge.balance ?? 0,
      resetAt: charge.resetAt ?? null,
    },
    `insufficient_credits: need ${charge.need ?? 0}, balance ${charge.balance ?? 0}`,
  );
}

export interface ChargeMeta extends CreditMeta {
  /** The app surface the charge belongs to ("generate", "draft", …). */
  surface?: string;
}

export interface ChargeHold {
  /** False → the charge must not proceed. */
  ok: boolean;
  /** The reserved credits (0 for an admin: nothing is reserved). */
  hold: number;
  /** Why the charge was refused. */
  reason?: "insufficient" | "kill-switch";
  /** Credits needed to proceed (the hold). */
  need?: number;
  /** The caller's balance at the moment of the refusal. */
  balance?: number | null;
  /** When the balance is reset (next UTC midnight, lazily). */
  resetAt?: string;
  /** True when the caller is an admin (unlimited, nothing is deducted). */
  admin?: boolean;
}

/**
 * Reserve the credits for a call that is about to happen.
 *
 * Order: admin (unlimited, never blocked) → global kill switch → lazy
 * daily grant → the reservation itself (ONE conditional write).
 *
 * D13 — NEVER REFUSE A FUNDED USER. The hold is capped by what the user
 * actually has: `hold = min(reserve, balance)`. A user with ONE credit and
 * a 2-credit reserve is served with a 1-credit hold, and the settlement
 * settles against the real cost. Only a ZERO balance is refused (402).
 */
export async function beginCharge(
  uid: string,
  surface: string,
  meta: ChargeMeta = {},
): Promise<ChargeHold> {
  if (isAdmin(uid)) {
    // Admins are unlimited: nothing is reserved, nothing is deducted, and
    // the kill switch never blocks them. The spend is recorded at settle.
    return { ok: true, hold: 0, admin: true };
  }

  if (await globalKillSwitchActive()) {
    return { ok: false, hold: 0, reason: "kill-switch" };
  }

  const reserve = reserveCredits(surface);

  // Lazy reset: the allowance is granted on the first credit operation of
  // the day — there is no cron.
  await ensureDailyGrant(uid);

  const account = await accountState(uid);
  const balance = account?.balance ?? 0;

  // D15 — two reserve classes.
  //   HARD  (agent-turn, team-turn): the whole call must be affordable up
  //         front. A user with less than the reserve is refused — no
  //         provider call happens.
  //   SOFT  (everything else): D13 — the hold is capped by the balance and
  //         only a zero balance is refused.
  if (isHardSurface(surface)) {
    if (balance < reserve) {
      return {
        ok: false,
        hold: 0,
        reason: "insufficient",
        need: reserve,
        balance,
        resetAt: nextResetAt(),
      };
    }
  } else if (balance <= 0) {
    return {
      ok: false,
      hold: 0,
      reason: "insufficient",
      need: reserve,
      balance: 0,
      resetAt: nextResetAt(),
    };
  }

  const hold = isHardSurface(surface) ? reserve : Math.min(reserve, balance);
  if (hold <= 0) return { ok: true, hold: 0, balance };

  const reserved = await holdCredits(uid, hold, {
    ...meta,
    note: meta.note ?? `hold for ${surface}`,
  });
  if (!reserved.ok) {
    // Lost a race with a concurrent charge — the balance moved under us.
    const acc = await accountState(uid);
    return {
      ok: false,
      hold: 0,
      reason: "insufficient",
      need: reserve,
      balance: acc?.balance ?? null,
      resetAt: nextResetAt(),
    };
  }
  return { ok: true, hold, balance: reserved.balance };
}

export interface SettleResult {
  ok: boolean;
  /** The credits actually charged. */
  actualCredits: number;
  /** The balance after the settlement. */
  balance: number | null;
  /** Credits returned to the user (the hold surplus). */
  refunded: number;
  /** True when the call cost MORE than the hold and took on debt. */
  wentToDebt: boolean;
  admin?: boolean;
}

/**
 * Settle a reservation against the measured cost.
 *
 * - actual < hold → the surplus is refunded (a positive history row),
 * - actual == hold → nothing changes,
 * - actual > hold → the difference is taken as DEBT (the balance may go
 *   negative; the debt is forgiven at the next daily reset),
 * - actual == 0 → the call did not happen (a failure): the WHOLE hold is
 *   refunded and nothing is charged.
 */
export async function settleCharge(
  uid: string,
  hold: number,
  actualCredits: number,
  meta: CreditMeta = {},
): Promise<SettleResult> {
  const actual = Math.max(0, Math.trunc(actualCredits || 0));

  if (isAdmin(uid)) {
    // No deduction — but the spend is still recorded (and, per D10, it does
    // not count toward the global kill switch).
    if (actual > 0) {
      await recordAdminUsage(uid, actual, {
        ...meta,
        note: meta.note ?? "admin spend (unlimited — no deduction)",
      });
    }
    return { ok: true, actualCredits: actual, balance: null, refunded: 0, wentToDebt: false, admin: true };
  }

  if (actual === 0) {
    // A failed call: full refund, no charge.
    const refunded = hold > 0 ? await refundCredits(uid, hold, { ...meta, note: meta.note ?? "full refund — the call did not happen" }) : { ok: true, balance: null };
    return {
      ok: true,
      actualCredits: 0,
      balance: refunded.balance,
      refunded: hold,
      wentToDebt: false,
    };
  }

  if (actual < hold) {
    const surplus = hold - actual;
    const refunded = await refundCredits(uid, surplus, { ...meta, note: meta.note ?? "hold surplus returned" });
    return {
      ok: true,
      actualCredits: actual,
      balance: refunded.balance,
      refunded: surplus,
      wentToDebt: false,
    };
  }

  if (actual > hold) {
    const extra = await takeCreditsAllowDebt(uid, actual - hold, {
      ...meta,
      note: meta.note ?? "over hold — charged as debt (forgiven at the next daily reset)",
    });
    return {
      ok: true,
      actualCredits: actual,
      balance: extra.balance,
      refunded: 0,
      wentToDebt: true,
    };
  }

  const account = await accountState(uid);
  return { ok: true, actualCredits: actual, balance: account?.balance ?? null, refunded: 0, wentToDebt: false };
}

/**
 * Settle a hold against what the provider actually returned.
 *
 * - real tokens -> the measured credit cost,
 * - no usage (the provider billed us, but gave no numbers) -> the measured
 *   cost is ZERO, so the hold is returned. A call whose cost cannot be
 *   measured is not charged (the same honesty rule the usage ledger uses:
 *   "a completion without usage records nothing").
 */
export async function settleMeasured(
  uid: string,
  hold: number,
  usage: { promptTokens: number; completionTokens: number } | null,
  modelId: string,
  meta: CreditMeta = {},
): Promise<SettleResult> {
  if (!usage) {
    return await settleCharge(uid, hold, 0, {
      ...meta,
      note: meta.note ?? "no measured usage — the hold is returned",
    });
  }
  const charged = creditsFromUsage(modelId, usage.promptTokens, usage.completionTokens);
  return await settleCharge(uid, hold, charged.credits, {
    ...meta,
    note: charged.note ?? meta.note,
  });
}

/**
 * The verified caller of this request. The middleware verifies the Firebase
 * token and forwards `x-novara-uid`; the route reads it from the request.
 */
export function callerUid(req: Request): string | null {
  const uid = req.headers.get("x-novara-uid")?.trim();
  return uid ? uid : null;
}
