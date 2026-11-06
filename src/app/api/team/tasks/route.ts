import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  ensureSeed,
  getLeader,
  healOrphanTasks,
  runTask,
  toTaskDto,
} from "@/lib/ai-team/server";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  assigneeId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  sessionKey: z.string().min(1).max(64),
  // P5-g: optional delegation provenance — runTask reads it off the task
  // row and attributes its GLM calls directly to the novel (plan §5.1).
  novelId: z.string().min(1).max(64).optional(),
});

/** GET /api/team/tasks — latest tasks with logs; re-kicks orphaned pending work. */
export async function GET(req: Request) {
  const sessionKey = new URL(req.url).searchParams.get("sessionKey");
  try {
    await ensureSeed();
    healOrphanTasks();
    const tasks = await db.teamTask.findMany({
      where: sessionKey ? { sessionKey } : undefined,
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        assignee: true,
        creator: true,
        logs: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    return NextResponse.json({ success: true, tasks: tasks.map(toTaskDto) });
  } catch (error) {
    console.error("[team/tasks] GET failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load tasks." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/team/tasks — the user assigns a task directly to a member.
 * The leader stays informed: completion reports are forwarded to its chat.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Provide assigneeId, title (≤120) and description (≤2000)." },
      { status: 400 },
    );
  }
  try {
    await ensureSeed();
    const assignee = await db.teamAgent.findUnique({ where: { id: parsed.data.assigneeId } });
    if (!assignee) {
      return NextResponse.json({ success: false, error: "Unknown assignee." }, { status: 404 });
    }
    if (assignee.isLeader) {
      return NextResponse.json(
        { success: false, error: "Assign tasks to a specialist — the leader coordinates via chat." },
        { status: 400 },
      );
    }
    const leader = await getLeader();
    if (!leader) {
      return NextResponse.json({ success: false, error: "Team leader missing." }, { status: 500 });
    }

    const task = await db.teamTask.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description,
        sessionKey: parsed.data.sessionKey,
        ...(parsed.data.novelId ? { novelId: parsed.data.novelId } : {}),
        assigneeId: assignee.id,
        creatorId: leader.id,
        creatorIsUser: true,
      },
      include: { assignee: true, creator: true, logs: true },
    });
    await db.teamTaskLog.create({
      data: { taskId: task.id, message: "Task created by the user.", progress: 5 },
    });

    after(() => runTask(task.id));

    return NextResponse.json({ success: true, task: toTaskDto(task) });
  } catch (error) {
    console.error("[team/tasks] POST failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create the task." },
      { status: 500 },
    );
  }
}
