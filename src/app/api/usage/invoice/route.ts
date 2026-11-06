// ---------------------------------------------------------------------------
// Novara AI — invoice reconciliation endpoint (Phase 5 / P5-c, §6.3).
//
// GET  /api/usage/invoice → pasted-figure entries, latest first (cap 20),
//                           plus the pricingVersion they were judged under.
// POST /api/usage/invoice → record ONE user-supplied console figure:
//                           { actualUsd: "12.34", periodLabel: "2026-11",
//                             note?: "…" }
//
// The actual number is a USER-INPUT DEPENDENCY (§6.3): no code can discharge
// it. This endpoint stores the pasted text VERBATIM alongside OUR ESTIMATE
// captured at save time (Σ over priced model groups — an upper bound; the
// cached-input discount is invisible). The comparison shown in the central
// view is display math on those two labeled figures; it is NOT a defect
// claim — our ESTIMATE covers only persisted app rows since the ledger's
// `since`, while the pasted figure covers whatever period the account holder
// named.
//
// Additive route (P5-c); no existing endpoint is touched. Validation is
// strict: a figure that cannot be parsed as a non-negative decimal is
// rejected with 400 — nothing is coerced, nothing is guessed.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { accountUsageSnapshot } from "@/lib/usage/usage-store";
import { PRICING_VERSION, PRICING_SOURCE_URL, PRICING_FETCHED_AT } from "@/lib/usage/pricing";

export const dynamic = "force-dynamic";

const MAX_ENTRIES = 20;

const postSchema = z.object({
  // Exact text as pasted: optional leading $, up to 7 integer digits, up to
  // 2 decimals. Stored verbatim; parsed here once for validation only.
  actualUsd: z
    .string()
    .trim()
    .regex(/^\$?\d{1,7}(\.\d{1,2})?$/, "Paste a plain non-negative amount, e.g. 12.34"),
  periodLabel: z.string().trim().min(1, "Name the period the figure covers").max(64),
  note: z.string().trim().max(280).optional(),
});

export async function GET() {
  const [entries, count] = await Promise.all([
    db.usageInvoice.findMany({ orderBy: { createdAt: "desc" }, take: MAX_ENTRIES }),
    db.usageInvoice.count(),
  ]);
  return NextResponse.json(
    {
      entries: entries.map((entry) => ({
        id: entry.id,
        actualUsd: entry.actualUsd,
        currency: entry.currency,
        periodLabel: entry.periodLabel,
        note: entry.note,
        estimatedUsd: entry.estimatedUsd,
        trackedRows: entry.trackedRows,
        sinceAtSave: entry.sinceAtSave,
        pricingVersion: entry.pricingVersion,
        createdAt: entry.createdAt.toISOString(),
      })),
      totalEntries: count,
      pricingVersion: PRICING_VERSION,
      sourceUrl: PRICING_SOURCE_URL,
      fetchedAt: PRICING_FETCHED_AT,
      retention:
        "Reconciliation entries are permanent account history (same retention family as usage rows).",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const numeric = Number(parsed.data.actualUsd.replace(/^\$/, ""));
  if (!Number.isFinite(numeric) || numeric < 0) {
    return NextResponse.json({ error: "Figure must be a non-negative amount." }, { status: 400 });
  }

  // OUR side of the comparison, captured at save: the current account
  // ESTIMATE (upper bound over priced model groups) + what it covered.
  const snapshot = await accountUsageSnapshot();

  const entry = await db.usageInvoice.create({
    data: {
      actualUsd: parsed.data.actualUsd.replace(/^\$/, ""),
      periodLabel: parsed.data.periodLabel,
      note: parsed.data.note ?? null,
      estimatedUsd: String(snapshot.estimate.usd),
      trackedRows: snapshot.totalCalls,
      sinceAtSave: snapshot.since,
      pricingVersion: PRICING_VERSION,
    },
  });

  // Display math for the central view's comparison row — labels stay attached
  // on the client; these bare numbers are the two figures being compared.
  return NextResponse.json(
    {
      entry: {
        id: entry.id,
        actualUsd: entry.actualUsd,
        currency: entry.currency,
        periodLabel: entry.periodLabel,
        note: entry.note,
        estimatedUsd: entry.estimatedUsd,
        trackedRows: entry.trackedRows,
        sinceAtSave: entry.sinceAtSave,
        pricingVersion: entry.pricingVersion,
        createdAt: entry.createdAt.toISOString(),
      },
      deltaUsd: numeric - snapshot.estimate.usd,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
