import { after } from "next/server";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { runTask } from "@/lib/ai-team/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/team/tasks/[id]/run — run (or retry) a task in the background.
 * Claiming is atomic inside runTask, so concurrent triggers are safe.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const task = await db.teamTask.findUnique({ where: { id }, select: { status: true } });
    if (!task) {
      return NextResponse.json({ success: false, error: "Task not found." }, { status: 404 });
    }
    if (task.status === "completed") {
      return NextResponse.json(
        { success: false, error: "Task is already completed." },
        { status: 400 },
      );
    }
    if (task.status === "in_progress") {
      return NextResponse.json(
        { success: false, error: "Task is already running." },
        { status: 409 },
      );
    }
    after(() => runTask(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[team/tasks/run] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to start the task." },
      { status: 500 },
    );
  }
}
