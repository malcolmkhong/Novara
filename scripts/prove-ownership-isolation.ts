// ---------------------------------------------------------------------------
// Ownership isolation proof (STEP 48).
//
// Exercises the SAME code path the two routes use — direct `db.*` calls, not
// a transaction client — then cleans up the rows it created.
//
// It WRITES two rows (one per previously-leaking table) and DELETES them in a
// finally block; the tables are back to their original counts afterwards.
//
// It also diagnoses whether the ownership filter applies to the three client
// shapes: direct `db.*`, the interactive `db.$transaction(async (tx) => …)`
// form, and the array `db.$transaction([…])` form.
//
// Run:  bun run db:prove:ownership
// ---------------------------------------------------------------------------

import { db, dbRaw, withUser } from "@/lib/db";

const USER_A = "proof-user-a";
const USER_B = "proof-user-b";
const TAG = `proof-${Date.now()}`;

const created = { invoiceId: "", turnId: "" };

async function diagnosticTxBypass() {
  console.log("=== DIAGNOSTIC: does the ownership filter apply inside an interactive transaction? ===");
  // userA owns NO novels, so a filtered Novel query must return 0 rows.
  // An unfiltered one returns every novel in the database.
  const direct = await withUser(USER_A, false, () => db.novel.findMany());
  let txRows: unknown[] = [];
  await db.$transaction(async (tx) => {
    txRows = await (tx as unknown as { novel: { findMany(a?: unknown): Promise<unknown[]> } }).novel.findMany();
  });
  const rawTotal = await dbRaw.novel.count();
  console.log(`novels in database (raw)        : ${rawTotal}`);
  console.log(`direct db.novel.findMany        : ${direct.length} rows  -> ${direct.length === 0 ? "FILTERED" : "NOT FILTERED"}`);
  console.log(`tx     novel.findMany           : ${txRows.length} rows  -> ${txRows.length === 0 ? "FILTERED" : "NOT FILTERED"}`);

  // Array form: the promises are built by the EXTENDED client, so the filter
  // should already be baked in.
  let arrayRows: unknown[] = [];
  await withUser(USER_A, false, () =>
    db.$transaction([db.novel.findMany()]).then((r) => {
      arrayRows = r[0] as unknown[];
    }),
  );
  console.log(`array  db.$transaction([...])   : ${arrayRows.length} rows  -> ${arrayRows.length === 0 ? "FILTERED" : "NOT FILTERED"}`);
  console.log("");
}

async function main() {
  await diagnosticTxBypass();

  console.log("=== PROOF: /api/usage/invoice + /api/team/turns model paths ===");
  try {
    // --- userA writes one row in each previously-leaking table -----------
    const invoice = await withUser(USER_A, false, () =>
      db.usageInvoice.create({
        data: {
          actualUsd: "1.00",
          periodLabel: TAG,
          estimatedUsd: "1.00",
          trackedRows: 0,
          pricingVersion: "proof",
        },
      }),
    );
    const turn = await withUser(USER_A, false, () =>
      db.teamTurnLog.create({
        data: { agentKey: "proof", label: TAG, outcome: "answered", rounds: 1 },
      }),
    );
    created.invoiceId = invoice.id;
    created.turnId = turn.id;
    console.log(`userA wrote UsageInvoice owner=${invoice.userId}`);
    console.log(`userA wrote TeamTurnLog  owner=${turn.userId}`);

    // --- userB must see neither ------------------------------------------
    const bInvoices = await withUser(USER_B, false, () => db.usageInvoice.findMany());
    const bInvoiceCount = await withUser(USER_B, false, () => db.usageInvoice.count());
    const bTurns = await withUser(USER_B, false, () => db.teamTurnLog.findMany());
    const bTurnCount = await withUser(USER_B, false, () => db.teamTurnLog.count());
    console.log(`userB sees UsageInvoice rows=${bInvoices.length} count=${bInvoiceCount}`);
    console.log(`userB sees TeamTurnLog  rows=${bTurns.length} count=${bTurnCount}`);

    // --- userA must see exactly their own ---------------------------------
    const aInvoices = await withUser(USER_A, false, () => db.usageInvoice.findMany());
    const aTurns = await withUser(USER_A, false, () => db.teamTurnLog.findMany());
    console.log(`userA sees UsageInvoice rows=${aInvoices.length}`);
    console.log(`userA sees TeamTurnLog  rows=${aTurns.length}`);

    const ok =
      bInvoices.length === 0 && bInvoiceCount === 0 &&
      bTurns.length === 0 && bTurnCount === 0 &&
      aInvoices.length === 1 && aTurns.length === 1 &&
      invoice.userId === USER_A && turn.userId === USER_A;
    console.log(ok ? "RESULT: ISOLATED (userB sees 0, userA sees 1)" : "RESULT: LEAK");
  } finally {
    // --- cleanup: remove the proof rows with the RAW client ---------------
    if (created.invoiceId) {
      await dbRaw.usageInvoice.delete({ where: { id: created.invoiceId } });
    }
    if (created.turnId) {
      await dbRaw.teamTurnLog.delete({ where: { id: created.turnId } });
    }
    const left = await dbRaw.usageInvoice.count();
    const leftT = await dbRaw.teamTurnLog.count();
    console.log(`cleanup done: UsageInvoice rows now=${left}, TeamTurnLog rows now=${leftT}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("PROOF FAILED:", err);
    process.exit(1);
  });
