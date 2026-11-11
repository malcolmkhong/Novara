// ---------------------------------------------------------------------------
// Ownership isolation proof.
//
// Exercises the SAME code paths the routes use — direct `db.*` calls AND
// `db.$transaction(async (tx) => …)` — then cleans up the rows it created.
//
// It WRITES rows (one per previously-leaking table, plus one written inside
// an interactive transaction) and DELETES them in a finally block; the tables
// are back to their original counts afterwards.
//
// It also reports whether the ownership filter applies to the three client
// shapes: direct `db.*`, the interactive `db.$transaction(async (tx) => …)`
// form, and the array `db.$transaction([…])` form.
//
// The assertion is DELTA-based: it measures how many rows userA already owns
// BEFORE this run and compares the AFTER counts against that baseline. It
// never asserts absolute counts, so a leftover row from an earlier run (or a
// re-run of this script) can no longer turn a PASS into "RESULT: LEAK".
//
// Run:  bun run db:prove:ownership
// ---------------------------------------------------------------------------

import { db, dbRaw, withUser } from "@/lib/db";

const USER_A = "proof-user-a";
const USER_B = "proof-user-b";
const TAG = `proof-${Date.now()}`;

const created = { invoiceId: "", turnId: "", txInvoiceId: "" };

async function diagnosticClientShapes() {
  console.log("=== CLIENT SHAPES: is the ownership filter applied? ===");
  // userA owns NO novels, so a filtered Novel query must return 0 rows.
  // An unfiltered one returns every novel in the database.
  const rawTotal = await dbRaw.novel.count();

  const direct = await withUser(USER_A, false, () => db.novel.findMany());

  let txRows: unknown[] = [];
  await withUser(USER_A, false, () =>
    db.$transaction(async (tx) => {
      txRows = await tx.novel.findMany();
    }),
  );

  let arrayRows: unknown[] = [];
  await withUser(USER_A, false, () =>
    db.$transaction([db.novel.findMany()]).then((r) => {
      arrayRows = r[0] as unknown[];
    }),
  );

  console.log(`novels in database (raw)        : ${rawTotal}`);
  console.log(`direct db.novel.findMany        : ${direct.length} rows  -> ${direct.length === 0 ? "FILTERED" : "NOT FILTERED"}`);
  console.log(`tx     novel.findMany           : ${txRows.length} rows  -> ${txRows.length === 0 ? "FILTERED" : "NOT FILTERED"}`);
  console.log(`array  db.$transaction([...])   : ${arrayRows.length} rows  -> ${arrayRows.length === 0 ? "FILTERED" : "NOT FILTERED"}`);
  console.log("");
}

async function main() {
  await diagnosticClientShapes();

  console.log("=== PROOF: /api/usage/invoice + /api/team/turns model paths ===");

  // BASELINE. The assertion below is about the DELTA this run creates, never
  // about absolute counts — otherwise one leftover row from an earlier run
  // makes a healthy database look like a leak.
  const beforeInvoices = await withUser(USER_A, false, () => db.usageInvoice.count());
  const beforeTurns = await withUser(USER_A, false, () => db.teamTurnLog.count());
  console.log(`baseline: userA already owns UsageInvoice=${beforeInvoices} TeamTurnLog=${beforeTurns}`);
  console.log("");

  let ok = false;
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

    // --- and one row written INSIDE an interactive transaction -----------
    const txInvoice = await withUser(USER_A, false, () =>
      db.$transaction(async (tx) =>
        tx.usageInvoice.create({
          data: {
            actualUsd: "2.00",
            periodLabel: TAG,
            estimatedUsd: "2.00",
            trackedRows: 0,
            pricingVersion: "proof",
          },
        }),
      ),
    );
    created.txInvoiceId = txInvoice.id;
    console.log(`userA wrote UsageInvoice (inside tx) owner=${txInvoice.userId}`);

    // --- userB must see none of them -------------------------------------
    const bInvoices = await withUser(USER_B, false, () => db.usageInvoice.findMany());
    const bInvoiceCount = await withUser(USER_B, false, () => db.usageInvoice.count());
    const bTurns = await withUser(USER_B, false, () => db.teamTurnLog.findMany());
    const bTurnCount = await withUser(USER_B, false, () => db.teamTurnLog.count());
    console.log(`userB sees UsageInvoice rows=${bInvoices.length} count=${bInvoiceCount}`);
    console.log(`userB sees TeamTurnLog  rows=${bTurns.length} count=${bTurnCount}`);

    // --- userB must also see none of them INSIDE a transaction -----------
    let bTxInvoices: unknown[] = [];
    let bTxTurns: unknown[] = [];
    await withUser(USER_B, false, () =>
      db.$transaction(async (tx) => {
        bTxInvoices = await tx.usageInvoice.findMany();
        bTxTurns = await tx.teamTurnLog.findMany();
      }),
    );
    console.log(`userB sees UsageInvoice inside tx rows=${bTxInvoices.length}`);
    console.log(`userB sees TeamTurnLog  inside tx rows=${bTxTurns.length}`);

    // --- userA must see exactly the rows it owns, PLUS this run's delta ---
    const aInvoices = await withUser(USER_A, false, () => db.usageInvoice.findMany());
    const aTurns = await withUser(USER_A, false, () => db.teamTurnLog.findMany());
    const invoiceDelta = aInvoices.length - beforeInvoices;
    const turnDelta = aTurns.length - beforeTurns;
    console.log(`userA sees UsageInvoice rows=${aInvoices.length} (delta +${invoiceDelta}, expected +2)`);
    console.log(`userA sees TeamTurnLog  rows=${aTurns.length} (delta +${turnDelta}, expected +1)`);

    ok =
      bInvoices.length === 0 && bInvoiceCount === 0 &&
      bTurns.length === 0 && bTurnCount === 0 &&
      bTxInvoices.length === 0 && bTxTurns.length === 0 &&
      invoiceDelta === 2 && turnDelta === 1 &&
      invoice.userId === USER_A && turn.userId === USER_A && txInvoice.userId === USER_A;
    console.log(
      ok
        ? "PASS — ISOLATED (userB sees 0 via direct / array $transaction / interactive $transaction; userA delta +2 invoices, +1 turn)"
        : "FAIL — LEAK or wrong delta (see the numbers above)",
    );
  } finally {
    // --- cleanup: remove the proof rows with the RAW client ---------------
    for (const id of [created.invoiceId, created.txInvoiceId]) {
      if (id) await dbRaw.usageInvoice.delete({ where: { id } });
    }
    if (created.turnId) await dbRaw.teamTurnLog.delete({ where: { id: created.turnId } });

    // The run must leave the tables exactly as it found them, so a re-run
    // starts from the same baseline and produces the same verdict.
    const afterInvoices = await withUser(USER_A, false, () => db.usageInvoice.count());
    const afterTurns = await withUser(USER_A, false, () => db.teamTurnLog.count());
    const restored = afterInvoices === beforeInvoices && afterTurns === beforeTurns;
    console.log(
      `cleanup done: UsageInvoice rows now=${afterInvoices} (baseline ${beforeInvoices}), ` +
        `TeamTurnLog rows now=${afterTurns} (baseline ${beforeTurns}) -> ${restored ? "RESTORED" : "NOT RESTORED"}`,
    );
    if (!restored) ok = false;
  }
  return ok;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error("PROOF FAILED:", err);
    process.exit(1);
  });
