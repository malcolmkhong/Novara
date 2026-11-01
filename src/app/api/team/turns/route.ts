import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * GET /api/team/turns?limit=50&outcome=…&agentKey=…
 *
 * Turn telemetry feed — the observability layer of the self-healing loop.
 * Lists recent glmAgentTurn records (outcome classification, per-tool-call
 * results, corrections fired) plus an outcome histogram so problem rates
 * (tool_exhausted / model_error) are measurable over time.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), 200)
    : 50;
  const outcome = url.searchParams.get("outcome") ?? undefined;
  const agentKey = url.searchParams.get("agentKey") ?? undefined;

  try {
    const [rows, grouped] = await Promise.all([
      db.teamTurnLog.findMany({
        where: {
          ...(outcome ? { outcome } : {}),
          ...(agentKey ? { agentKey } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      db.teamTurnLog.groupBy({
        by: ["outcome"],
        _count: { _all: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      summary: grouped.map((group) => ({
        outcome: group.outcome,
        count: group._count._all,
      })),
      turns: rows.map((row) => ({
        id: row.id,
        agentKey: row.agentKey,
        label: row.label,
        outcome: row.outcome,
        rounds: row.rounds,
        toolCalls: safeParse(row.toolCalls),
        correctionsFired: safeParse(row.correctionsFired),
        durationMs: row.durationMs,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[team/turns] GET failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load turn telemetry." },
      { status: 500 },
    );
  }
}
