// ---------------------------------------------------------------------------
// Novara AI — credit ledger core (Step 54).
//
// THE ONLY WRITER of CreditAccount. Every balance change goes through this
// module, and every balance change is accompanied by exactly one
// CreditLedger row (the append-only history) — written in the SAME
// transaction, so the balance and the history can never disagree.
//
// Product rules (PM, Step 54):
//   · free allowance 20 credits/day (CREDITS_DAILY_FREE);
//   · the grant RESETS the balance to the allowance — credits do NOT
//     accumulate across days;
//   · the reset is LAZY: it is checked on the next credit operation, there
//     is no cron and no scheduler;
//   · admins are unlimited: no deduction, but the spend is still recorded;
//   · a global kill switch stops all non-admin spend once the world's spend
//     for the day passes CREDITS_GLOBAL_DAILY_CAP.
//
// ATOMICITY. A spend is ONE conditional write —
//   updateMany({ where: { userId, balance: { gte: cost } },
//                data:  { balance: { decrement: cost } } })
// The balance check lives in the WHERE clause, so the check and the
// decrement are the same statement: there is no read-then-write window, and
// N parallel spends can never take the balance below zero.
//
// OWNERSHIP. Both tables carry a `userId` scalar, so the ownership
// extension (src/lib/db.ts) covers them automatically: reads are filtered to
// { userId: uid } and creates are stamped with the caller's uid. This module
// never bypasses it — with ONE documented exception, globalSpendToday(),
// which is a global operational metric by definition (see its comment).
//
// NOT WIRED YET: no API route calls this module (Step 54 scope). The proof
// script scripts/prove-credits.ts is the only caller today.
// ---------------------------------------------------------------------------

import { db, dbRaw, warmIdentity } from "@/lib/db";
import { isAdminUid } from "@/lib/auth/admin";
import { utcDayKey } from "@/lib/usage/retention";

/**
 * The interactive-transaction client type of the EXTENDED client (`db` is
 * `base.$extends(...)`, so its transaction client is not PrismaClient).
 */
type CreditTx = Omit<
  typeof db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Run a credit transaction with the identity ALREADY resolved.
 *
 * The warm-up is not an optimisation. DATABASE_URL carries
 * `connection_limit=3` (the Neon pooler) and an interactive transaction takes
 * a connection out of the pool, while the ownership extension's identity
 * lookup uses the base client — so a cold identity inside a transaction can
 * wait on the pool. Resolving the identity first fills the per-request cache.
 *
 * The retry: two transactions can race to create the SAME account row (the
 * loser gets P2002) or hit a write conflict (P2034). Both roll the whole
 * transaction back and both are safe to retry — the operation is idempotent:
 * the grant only happens when the conditional update actually changes a row,
 * so the retry's "loser" sees today's date and grants nothing.
 *
 * maxWait/timeout are raised because several credit transactions queue
 * behind the pooled connections (ten parallel calls take a couple of
 * transactions each).
 */
async function creditTransaction<T>(fn: (tx: CreditTx) => Promise<T>): Promise<T> {
  await warmIdentity();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(fn, { maxWait: 20_000, timeout: 20_000 });
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code;
      if (code !== "P2002" && code !== "P2034") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** The configured daily free allowance, in credits. Read lazily (testable). */
export function creditsDailyFree(): number {
  return envInt("CREDITS_DAILY_FREE", 20);
}

/** The configured global daily spend cap, in credits, across ALL users. */
export function creditsGlobalDailyCap(): number {
  return envInt("CREDITS_GLOBAL_DAILY_CAP", 500);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

/** The account row, as the ledger sees it. */
export interface CreditAccountState {
  userId: string;
  balance: number;
  /** "YYYY-MM-DD" UTC — the last day the free allowance was granted. */
  allowanceDate: string;
  /** What the last daily grant was worth. */
  allowanceGiven: number;
  updatedAt: Date;
}

/** What a spend/refund is about. Both fields are optional. */
export interface CreditMeta {
  /** What the operation refers to (a run id, a request id, …). */
  refId?: string | null;
  /** Free text. Never required, never rendered as a fact. */
  note?: string | null;
}

export type CreditConsumeReason =
  | "consumed"
  | "refunded"
  | "admin"
  | "insufficient"
  | "kill-switch";

export interface CreditConsumeResult {
  /** True when the spend was allowed (and, for non-admins, deducted). */
  ok: boolean;
  reason: CreditConsumeReason;
  /** Balance after the operation; null when there is no account. */
  balance: number | null;
}

/** Is this user an admin? (The ONE admin rule — src/lib/auth/admin.ts.) */
export function isAdmin(uid: string): boolean {
  return isAdminUid(uid);
}

function requirePositiveInt(cost: number): number {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`credit cost must be a positive integer, got ${String(cost)}`);
  }
  return Math.trunc(cost);
}

/**
 * Grant the free allowance if the last grant was not today.
 *
 * Idempotent under concurrency: two simultaneous calls grant ONCE.
 *   1. the account row is created if missing (an upsert — concurrent
 *      callers create at most one row),
 *   2. the grant itself is a CONDITIONAL WRITE that only fires when
 *      `allowanceDate != today`; a second concurrent caller waits on the row
 *      lock and then re-reads the row, finds today's date and changes
 *      nothing,
 *   3. exactly one `daily_grant` ledger row is written — in the same
 *      transaction as the balance change.
 *
 * The grant RESETS the balance to the allowance (credits do not accumulate).
 */
export async function ensureDailyGrant(userId: string): Promise<CreditAccountState> {
  const today = utcDayKey(new Date());
  const allowance = creditsDailyFree();

  return await creditTransaction(async (tx) => {
    // 1. The account row must exist. `update: {}` makes this a no-op for an
    //    existing row, so concurrent callers cannot create two.
    await tx.creditAccount.upsert({
      where: { userId },
      create: { userId, balance: 0, allowanceDate: "", allowanceGiven: 0 },
      update: {},
    });

    // 2. The grant: one conditional write. The predicate is re-evaluated
    //    after the row lock is released, so the loser of the race updates
    //    0 rows and grants nothing.
    const granted = await tx.creditAccount.updateMany({
      where: { userId, allowanceDate: { not: today } },
      data: {
        allowanceDate: today,
        allowanceGiven: allowance,
        balance: { set: allowance },
      },
    });

    // 3. One history row per grant, in the same transaction.
    if (granted.count === 1) {
      await tx.creditLedger.create({
        data: {
          userId,
          delta: allowance,
          kind: "daily_grant",
          refId: null,
          note: `free daily allowance ${allowance} (${today} UTC)`,
        },
      });
    }

    const account = await tx.creditAccount.findUnique({ where: { userId } });
    if (!account) throw new Error(`credit account missing for user ${userId}`);
    return account;
  });
}

/**
 * Try to spend `cost` credits.
 *
 * - admins: unlimited. No deduction, but the spend is recorded
 *   (`admin_usage`).
 * - kill switch active: refused with reason "kill-switch" (admins are
 *   never blocked).
 * - otherwise: the lazy daily grant runs first, then ONE conditional write
 *   takes the credits. `count === 0` means "not enough credits".
 */
export async function tryConsume(
  userId: string,
  cost: number,
  meta: CreditMeta = {},
): Promise<CreditConsumeResult> {
  const amount = requirePositiveInt(cost);

  // Admins are unlimited — no deduction, but the spend is still recorded.
  if (isAdmin(userId)) {
    await db.creditLedger.create({
      data: {
        userId,
        delta: -amount,
        kind: "admin_usage",
        refId: meta.refId ?? null,
        note: meta.note ?? "admin spend (unlimited — no deduction)",
      },
    });
    return { ok: true, reason: "admin", balance: null };
  }

  // The global kill switch: all non-admin spend stops here.
  if (await globalKillSwitchActive()) {
    return { ok: false, reason: "kill-switch", balance: null };
  }

  // Lazy reset: the allowance is granted (or refreshed) on the next credit
  // operation — no cron, no scheduler.
  await ensureDailyGrant(userId);

  return await creditTransaction(async (tx) => {
    // The spend is ONE conditional write: the check and the decrement are
    // the same statement. Never read-then-write.
    const spent = await tx.creditAccount.updateMany({
      where: { userId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });

    if (spent.count === 0) {
      const account = await tx.creditAccount.findUnique({ where: { userId } });
      return { ok: false, reason: "insufficient", balance: account?.balance ?? null };
    }

    await tx.creditLedger.create({
      data: {
        userId,
        delta: -amount,
        kind: "spend",
        refId: meta.refId ?? null,
        note: meta.note ?? null,
      },
    });

    const account = await tx.creditAccount.findUnique({ where: { userId } });
    return { ok: true, reason: "consumed", balance: account?.balance ?? null };
  });
}

/**
 * Give `cost` credits back (a failed call). Writes a POSITIVE ledger row
 * and restores the balance — a history row alone would not give the credit
 * back.
 *
 * For an admin nothing was ever deducted, so the credit is recorded as
 * history and the balance is left alone.
 */
export async function refund(
  userId: string,
  cost: number,
  meta: CreditMeta = {},
): Promise<CreditConsumeResult> {
  const amount = requirePositiveInt(cost);

  if (isAdmin(userId)) {
    await db.creditLedger.create({
      data: {
        userId,
        delta: amount,
        kind: "adjustment",
        refId: meta.refId ?? null,
        note: meta.note ?? "admin refund — no balance was deducted",
      },
    });
    return { ok: true, reason: "admin", balance: null };
  }

  return await creditTransaction(async (tx) => {
    const credited = await tx.creditAccount.updateMany({
      where: { userId },
      data: { balance: { increment: amount } },
    });
    if (credited.count === 0) {
      return { ok: false, reason: "insufficient", balance: null };
    }
    await tx.creditLedger.create({
      data: {
        userId,
        delta: amount,
        kind: "adjustment",
        refId: meta.refId ?? null,
        note: meta.note ?? "refund",
      },
    });
    const account = await tx.creditAccount.findUnique({ where: { userId } });
    return { ok: true, reason: "refunded", balance: account?.balance ?? null };
  });
}

/**
 * The world's NET spend today (credits), across ALL users.
 *
 * D11: NET, not "sum of the negative deltas". The spend rows (-hold, -spend)
 * and the refund rows (+adjustment) are summed WITH their sign, so a call
 * that was fully refunded returns the total to its pre-call value. Before
 * D11 a refunded call still counted its hold against the world cap.
 *
 * Also excluded (D10 + the grant rule):
 *   · `admin_usage` — an admin's spend is not the world's spend; it must
 *     never trip the kill switch for everybody else,
 *   · `daily_grant` — a grant is not spend.
 *
 * This is the ONE unscoped read in this module, and it is deliberate: the
 * metric is global by definition. The ownership-scoped client CANNOT express
 * it — it would return the CALLER's spend, and the kill switch would
 * silently become a per-user cap instead of the global one the PM specified.
 *
 * It reads an aggregate number only: no user id, no note, no row content.
 */
export async function globalSpendToday(): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const agg = await dbRaw.creditLedger.aggregate({
    where: {
      createdAt: { gte: start },
      // NET of the spend and refund rows of ordinary users.
      kind: { in: ["spend", "adjustment"] },
    },
    _sum: { delta: true },
  });
  return -(agg._sum.delta ?? 0);
}

/** Is the global kill switch active? (World spend today > the cap.) */
export async function globalKillSwitchActive(): Promise<boolean> {
  return (await globalSpendToday()) > creditsGlobalDailyCap();
}

/**
 * The NET credits THIS account consumed today (the same NET rule as the
 * global spend: the spend and refund rows summed with their sign, so a
 * fully refunded call nets to zero). Grants are excluded (a grant is not
 * spend); an admin's `admin_usage` rows ARE included, because they are real
 * consumption even though nothing was deducted from a balance.
 *
 * The read is SCOPED: the ownership extension filters CreditLedger by the
 * caller's userId (the table carries userId), so this never needs dbRaw.
 */
export async function usedToday(userId: string, now = new Date()): Promise<number> {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const agg = await db.creditLedger.aggregate({
    where: {
      userId,
      createdAt: { gte: start },
      kind: { in: ["spend", "adjustment", "admin_usage"] },
    },
    _sum: { delta: true },
  });
  return -(agg._sum.delta ?? 0);
}

/** The current account row, or null when the user has none. */
export async function accountState(userId: string): Promise<CreditAccountState | null> {
  return await db.creditAccount.findUnique({ where: { userId } });
}

/**
 * The next lazy daily reset: tomorrow 00:00:00 UTC. The allowance is
 * granted on the first credit operation after that moment, so this is when
 * the balance goes back to the allowance (and any debt is forgiven).
 */
export function nextResetAt(now = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

/**
 * Reserve (hold) credits for a charge that has not been measured yet: ONE
 * conditional write, `balance >= amount`. `ok === false` means the user
 * cannot afford it.
 */
export async function holdCredits(
  userId: string,
  amount: number,
  meta: CreditMeta = {},
): Promise<{ ok: boolean; balance: number | null }> {
  const value = requirePositiveInt(amount);
  return await creditTransaction(async (tx) => {
    const taken = await tx.creditAccount.updateMany({
      where: { userId, balance: { gte: value } },
      data: { balance: { decrement: value } },
    });
    if (taken.count === 0) {
      const account = await tx.creditAccount.findUnique({ where: { userId } });
      return { ok: false, balance: account?.balance ?? null };
    }
    await tx.creditLedger.create({
      data: {
        userId,
        delta: -value,
        kind: "spend",
        refId: meta.refId ?? null,
        note: meta.note ?? null,
      },
    });
    const account = await tx.creditAccount.findUnique({ where: { userId } });
    return { ok: true, balance: account?.balance ?? null };
  });
}

/**
 * Give credits back (a surplus hold, a refund). Increments the balance and
 * writes a positive history row in the same transaction.
 */
export async function refundCredits(
  userId: string,
  amount: number,
  meta: CreditMeta = {},
): Promise<{ ok: boolean; balance: number | null }> {
  const value = requirePositiveInt(amount);
  return await creditTransaction(async (tx) => {
    const given = await tx.creditAccount.updateMany({
      where: { userId },
      data: { balance: { increment: value } },
    });
    if (given.count === 0) return { ok: false, balance: null };
    await tx.creditLedger.create({
      data: {
        userId,
        delta: value,
        kind: "adjustment",
        refId: meta.refId ?? null,
        note: meta.note ?? null,
      },
    });
    const account = await tx.creditAccount.findUnique({ where: { userId } });
    return { ok: true, balance: account?.balance ?? null };
  });
}

/**
 * Take credits even when that pushes the balance NEGATIVE.
 *
 * The balance may go below zero on purpose: the cost was really incurred
 * (a measured call cost more than the hold reserved). The debt is recorded
 * in the ledger like any other spend and is FORGIVEN at the next daily
 * reset — `ensureDailyGrant` sets the balance back to the allowance.
 */
export async function takeCreditsAllowDebt(
  userId: string,
  amount: number,
  meta: CreditMeta = {},
): Promise<{ ok: boolean; balance: number | null }> {
  const value = requirePositiveInt(amount);
  return await creditTransaction(async (tx) => {
    const taken = await tx.creditAccount.updateMany({
      where: { userId },
      data: { balance: { decrement: value } },
    });
    if (taken.count === 0) return { ok: false, balance: null };
    await tx.creditLedger.create({
      data: {
        userId,
        delta: -value,
        kind: "spend",
        refId: meta.refId ?? null,
        note: meta.note ?? null,
      },
    });
    const account = await tx.creditAccount.findUnique({ where: { userId } });
    return { ok: true, balance: account?.balance ?? null };
  });
}

/**
 * Record an admin's spend: a ledger row, NO deduction. Admins are
 * unlimited (product decision) — but the spend is still recorded, and it
 * does NOT count toward the global kill switch (D10).
 */
export async function recordAdminUsage(
  userId: string,
  amount: number,
  meta: CreditMeta = {},
): Promise<void> {
  const value = requirePositiveInt(amount);
  await db.creditLedger.create({
    data: {
      userId,
      delta: -value,
      kind: "admin_usage",
      refId: meta.refId ?? null,
      note: meta.note ?? null,
    },
  });
}
