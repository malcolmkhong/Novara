import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { ensureSeed, toAgentDto } from "@/lib/ai-team/server";

export const dynamic = "force-dynamic";

/** GET /api/team/agents — list the team (seeds the default roster on first call). */
export async function GET() {
  try {
    await ensureSeed();
    const agents = await db.teamAgent.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ success: true, agents: agents.map(toAgentDto) });
  } catch (error) {
    console.error("[team/agents] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load the AI team." },
      { status: 500 },
    );
  }
}
