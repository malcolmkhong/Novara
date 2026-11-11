// ---------------------------------------------------------------------------
// Novara AI — the signed-in user's credit state (Step 61).
//
// GET /api/usage/credits → the ONE endpoint that answers "what can I spend
// right now?". It exists because every other credit surface in the app is a
// REFUSAL (the 402 payload) — nothing could read the balance.
//
// The numbers are the ones the user will actually spend against:
//
//   · the lazy daily grant runs FIRST (it is the first credit operation of
//     the day), so a user who has not spent today sees their allowance, not
//     a stale 0 that would scare them;
//   · balance is the account row (the ownership extension scopes it to the
//     caller — the CreditAccount table carries userId, so no unscoped read
//     is needed or used);
//   · usedToday is the NET of the account's own spend and refund rows for
//     today (the same NET rule as the global cap: the rows summed with their
//     sign, so a refunded call nets to zero);
//   · resetAt / resetsInSeconds describe the lazy reset (tomorrow 00:00 UTC,
//     granted on the next credit operation — there is no cron);
//   · globalPaused mirrors the global kill switch (the world's spend today is
//     over the cap) — the UI can say so before the user tries.
//
// An admin is unlimited: nothing is deducted, so balance is null and
// unlimited is true.
//
// Nothing here re-implements the ledger: accountState(), nextResetAt(),
// creditsDailyFree(), globalKillSwitchActive() and usedToday() all come from
// @/lib/credits/ledger.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { isAdminUid } from "@/lib/auth/admin";
import { callerUid } from "@/lib/credits/charge";
import {
  accountState,
  creditsDailyFree,
  ensureDailyGrant,
  globalKillSwitchActive,
  nextResetAt,
  usedToday,
} from "@/lib/credits/ledger";
import type { CreditsSnapshot } from "@/lib/usage/usage-shapes";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // The middleware verifies the bearer token and forwards the verified uid
  // (it strips any client-supplied identity headers).
  const uid = callerUid(req);
  if (!uid) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const allowance = creditsDailyFree();
  const resetAt = nextResetAt();
  const resetsInSeconds = Math.max(
    0,
    Math.round((new Date(resetAt).getTime() - Date.now()) / 1000),
  );
  const globalPaused = await globalKillSwitchActive();
  const admin = isAdminUid(uid);
  const used = await usedToday(uid);

  const body: CreditsSnapshot = admin
    ? {
        // Admins are unlimited — nothing is deducted, so there is no balance.
        balance: null,
        allowance,
        usedToday: used,
        resetAt,
        resetsInSeconds,
        admin: true,
        unlimited: true,
        globalPaused,
      }
    : {
        balance: 0,
        allowance,
        usedToday: used,
        resetAt,
        resetsInSeconds,
        admin: false,
        unlimited: false,
        globalPaused,
      };

  if (!admin) {
    // The lazy daily grant FIRST: the balance below must be the one the user
    // will actually spend against (the grant happens on the first credit
    // operation of the UTC day).
    await ensureDailyGrant(uid);
    const state = await accountState(uid);
    body.balance = state?.balance ?? 0;
  }

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
