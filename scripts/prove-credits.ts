// ---------------------------------------------------------------------------
// Credit ledger proof (Step 54).
//
// Exercises every guarantee of src/lib/credits/ledger.ts against the real
// database:
//
//   (a) a fresh user's first credit operation grants exactly the allowance
//       and writes exactly ONE daily_grant ledger row;
//   (b) five simultaneous ensureDailyGrant calls grant ONCE (both for a
//       brand-new account and for an account whose last grant was yesterday);
//   (c) ten simultaneous tryConsume(1) against a balance of 5 → exactly five
//       succeed, five are refused, the balance ends at 0 and never negative;
//   (d) an admin is unlimited: the spend succeeds, nothing is deducted, and
//       the spend is still recorded as admin_usage;
//   (e) the global kill switch refuses a non-admin spend while the world's
//       spend is over the cap, and stops refusing once the cap is restored.
//
// It WRITES rows (accounts + ledger rows) for its own throw-away users and
// DELETES them in a finally block; the tables are back to their original
// state afterwards.
//
// The admin allowlist is overridden for this run (ADMIN_UIDS = the proof's
// own admin uid) so the real admins are never involved.
//
// Run:  bun run db:prove:credits
// ---------------------------------------------------------------------------

import { db, withUser } from "@/lib/db";
import {
  creditsDailyFree,
  creditsGlobalDailyCap,
  ensureDailyGrant,
  globalKillSwitchActive,
  globalSpendToday,
  tryConsume,
} from "@/lib/credits/ledger";

const USER_A = "credit-proof-user-a";
const USER_B = "credit-proof-user-b";
const ADMIN = "credit-proof-admin";
const PROOF_USERS = [USER_A, USER_B, ADMIN];

// The proof owns its own admin uid — the real ADMIN_UIDS list is untouched.
process.env.ADMIN_UIDS = ADMIN;

const log = (line: string) => console.log(line);

async function accountOf(userId: string) {
  return await withUser(userId, false, () => db.creditAccount.findUnique({ where: { userId } }));
}

async function countRows(userId: string, kind: string) {
  return await withUser(userId, false, () =>
    db.creditLedger.count({ where: { userId, kind } }),
  );
}

async function main() {
  log("=== (a) fresh user: the first operation grants exactly the allowance ===");
  const aAccount = await withUser(USER_A, false, () => ensureDailyGrant(USER_A));
  const aGrants = await countRows(USER_A, "daily_grant");
  log(`  CREDITS_DAILY_FREE            = ${creditsDailyFree()}`);
  log(`  balance=${aAccount.balance} allowanceDate=${aAccount.allowanceDate} allowanceGiven=${aAccount.allowanceGiven}`);
  log(`  daily_grant ledger rows       = ${aGrants}   (expect 1)`);

  log("");
  log("=== (b) five simultaneous grants grant ONCE ===");
  const bParallel = await withUser(USER_B, false, () =>
    Promise.all([1, 2, 3, 4, 5].map(() => ensureDailyGrant(USER_B))),
  );
  const bGrants = await countRows(USER_B, "daily_grant");
  log(`  brand-new account: 5 parallel calls -> balances ${bParallel.map((a) => a.balance).join(",")}`);
  log(`  brand-new account: daily_grant rows = ${bGrants}   (expect 1)`);

  // Spend 5 so a RESET is visible (a reset restores 20; accumulation would
  // show 35).
  await withUser(USER_B, false, () => tryConsume(USER_B, 5, { note: "proof setup" }));
  const bBefore = await accountOf(USER_B);
  // Simulate "yesterday" on the PROOF'S OWN row (the product code never
  // writes CreditAccount outside the ledger module; the proof has to fake a
  // day boundary to test it).
  await withUser(USER_B, false, () =>
    db.creditAccount.update({ where: { userId: USER_B }, data: { allowanceDate: "2000-01-01" } }),
  );
  const b2Parallel = await withUser(USER_B, false, () =>
    Promise.all([1, 2, 3, 4, 5].map(() => ensureDailyGrant(USER_B))),
  );
  const b2Grants = await countRows(USER_B, "daily_grant");
  log(`  stale-date account: balance before the burst = ${bBefore?.balance} (5 spent)`);
  log(`  stale-date account: 5 parallel calls -> balances ${b2Parallel.map((a) => a.balance).join(",")}   (expect 20 = reset, NOT 35)`);
  log(`  stale-date account: daily_grant rows = ${b2Grants}   (expect 2 — one per day)`);

  log("");
  log("=== (c) ten simultaneous spends of 1 against a balance of 5 ===");
  await withUser(USER_A, false, () => tryConsume(USER_A, 15, { note: "proof setup" }));
  const cBefore = await accountOf(USER_A);
  const cResults = await withUser(USER_A, false, () =>
    Promise.all(Array.from({ length: 10 }, () => tryConsume(USER_A, 1, { note: "proof parallel spend" }))),
  );
  const cOk = cResults.filter((r) => r.ok).length;
  const cRefused = cResults.length - cOk;
  const cAfter = await accountOf(USER_A);
  const cSpends = await countRows(USER_A, "spend");
  log(`  balance before = ${cBefore?.balance}   (expect 5)`);
  log(`  parallel tryConsume(1) x10 -> ok=${cOk} refused=${cRefused}   (expect ok=5 refused=5)`);
  log(`  reasons = ${cResults.map((r) => r.reason).join(",")}`);
  log(`  balance after  = ${cAfter?.balance}   (expect 0 — never negative)`);
  log(`  spend ledger rows = ${cSpends}   (expect 6 = one 15-credit spend + five 1-credit spends)`);

  log("");
  log("=== (d) admin: unlimited, nothing deducted, spend still recorded ===");
  const dBefore = await withUser(ADMIN, true, () => ensureDailyGrant(ADMIN));
  const dResult = await withUser(ADMIN, true, () => tryConsume(ADMIN, 3, { note: "proof admin spend" }));
  const dAfter = await withUser(ADMIN, true, () => db.creditAccount.findUnique({ where: { userId: ADMIN } }));
  const dRows = await withUser(ADMIN, true, () =>
    db.creditLedger.count({ where: { userId: ADMIN, kind: "admin_usage" } }),
  );
  log(`  balance before = ${dBefore.balance}`);
  log(`  tryConsume -> ok=${dResult.ok} reason=${dResult.reason}   (expect ok=true reason=admin)`);
  log(`  balance after  = ${dAfter?.balance}   (expect unchanged = ${dBefore.balance})`);
  log(`  admin_usage ledger rows = ${dRows}   (expect 1)`);

  log("");
  log("=== (e) global kill switch ===");
  const spendNow = await globalSpendToday();
  const capNow = creditsGlobalDailyCap();
  process.env.CREDITS_GLOBAL_DAILY_CAP = "1";
  const eResult = await withUser(USER_B, false, () => tryConsume(USER_B, 1, { note: "proof kill switch" }));
  const eActive = await globalKillSwitchActive();
  process.env.CREDITS_GLOBAL_DAILY_CAP = String(capNow);
  const eRestored = await withUser(USER_B, false, () => tryConsume(USER_B, 1, { note: "proof after restore" }));
  log(`  global spend today = ${spendNow} credits (cap was ${capNow})`);
  log(`  with cap=1 -> tryConsume ok=${eResult.ok} reason=${eResult.reason}   (expect ok=false reason=kill-switch); kill switch active=${eActive}`);
  log(`  after restoring the cap -> ok=${eRestored.ok} reason=${eRestored.reason}   (expect ok=true)`);
}

main()
  .then(async () => {
    // Cleanup: only the proof's own rows.
    await withUser(ADMIN, true, async () => {
      const ledgers = await db.creditLedger.deleteMany({ where: { userId: { in: PROOF_USERS } } });
      const accounts = await db.creditAccount.deleteMany({ where: { userId: { in: PROOF_USERS } } });
      const leftL = await db.creditLedger.count({ where: { userId: { in: PROOF_USERS } } });
      const leftA = await db.creditAccount.count({ where: { userId: { in: PROOF_USERS } } });
      console.log("");
      console.log(
        `cleanup: deleted ${ledgers.count} CreditLedger row(s) and ${accounts.count} CreditAccount row(s); ` +
          `left: ledger=${leftL} account=${leftA}`,
      );
    });
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("CREDIT PROOF FAILED:", error);
    try {
      await withUser(ADMIN, true, async () => {
        await db.creditLedger.deleteMany({ where: { userId: { in: PROOF_USERS } } });
        await db.creditAccount.deleteMany({ where: { userId: { in: PROOF_USERS } } });
      });
      console.log("cleanup: proof rows removed after the failure");
    } catch (cleanupError) {
      console.error("cleanup failed:", cleanupError);
    }
    process.exit(1);
  });
