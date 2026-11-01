import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  buildHistoryMessages,
  createTasksFromDelegations,
  ensureSeed,
  getOrCreateConversation,
  glmText,
  parseDelegations,
  runTasksSequentially,
  toAgentDto,
  toMessageDto,
  toTaskDto,
} from "@/lib/ai-team/server";
import { buildDelegationRepairMessages, buildLeaderSystemPrompt, buildMemberChatPrompt } from "@/lib/ai-team/prompts";
import type { ChatSendResponse } from "@/lib/ai-team/types";

export const dynamic = "force-dynamic";

const getSchema = z.object({
  agentId: z.string().min(1),
  sessionKey: z.string().min(1).max(64),
});

const postSchema = z.object({
  agentId: z.string().min(1),
  sessionKey: z.string().min(1).max(64),
  content: z.string().trim().min(1).max(2000),
});

/** GET /api/team/chat?agentId=…&sessionKey=… — one agent's conversation. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = getSchema.safeParse({
    agentId: url.searchParams.get("agentId") ?? "",
    sessionKey: url.searchParams.get("sessionKey") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "agentId and sessionKey are required." },
      { status: 400 },
    );
  }
  try {
    await ensureSeed();
    const agent = await db.teamAgent.findUnique({ where: { id: parsed.data.agentId } });
    if (!agent) {
      return NextResponse.json({ success: false, error: "Unknown agent." }, { status: 404 });
    }
    const conversation = await getOrCreateConversation(agent.id, parsed.data.sessionKey);
    const messages = await db.teamMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      success: true,
      agent: toAgentDto(agent),
      messages: messages.map(toMessageDto),
    });
  } catch (error) {
    console.error("[team/chat] GET failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load the conversation." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/team/chat — send a message to an agent (leader or member).
 *
 * The GLM reply is produced first (so failures leave no phantom messages),
 * then the user message + cleaned reply are persisted, then any
 * delegations are turned into tasks which run in the background.
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
      { success: false, error: "Provide agentId, sessionKey and content (1-2000 chars)." },
      { status: 400 },
    );
  }
  const { agentId, sessionKey, content } = parsed.data;

  try {
    await ensureSeed();
    const agent = await db.teamAgent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return NextResponse.json({ success: false, error: "Unknown agent." }, { status: 404 });
    }

    const conversation = await getOrCreateConversation(agent.id, sessionKey);
    const history = await buildHistoryMessages(conversation.id);

    let systemPrompt: string;
    if (agent.isLeader) {
      const members = await db.teamAgent.findMany({
        where: { isLeader: false },
        orderBy: { sortOrder: "asc" },
      });
      systemPrompt = buildLeaderSystemPrompt(agent, members);
    } else {
      const leader = await db.teamAgent.findFirst({ where: { isLeader: true } });
      systemPrompt = buildMemberChatPrompt(agent, leader?.name ?? "the team leader");
    }

    const glmMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content },
    ];

    const raw = await glmText(glmMessages, agent.key);
    if (raw === null) {
      return NextResponse.json(
        {
          success: false,
          error: `${agent.name} could not reply in time (model busy). Please try again.`,
        },
        { status: 504 },
      );
    }

    const { clean, delegations: parsedDelegations } = parseDelegations(raw);
    let delegations = parsedDelegations;

    // Safety net: the agent announced work but skipped the protocol block,
    // so nothing would be tracked. One bounded repair round-trip converts
    // the announcement into real tasks.
    if (delegations.length === 0) {
      const candidates = agent.isLeader
        ? await db.teamAgent.findMany({ where: { isLeader: false } })
        : [agent];
      const mentioned = candidates.filter((candidate) =>
        clean.toLowerCase().includes(candidate.name.toLowerCase()),
      );
      if (mentioned.length > 0) {
        const repairRaw = await glmText(
          [
            ...glmMessages,
            { role: "assistant", content: raw },
            ...buildDelegationRepairMessages(mentioned.map((candidate) => candidate.name)),
          ],
          `${agent.key}-repair`,
          25_000,
        );
        if (repairRaw !== null && !/^NO_BLOCK$/i.test(repairRaw.trim())) {
          const repaired = parseDelegations(repairRaw);
          if (repaired.delegations.length > 0) {
            delegations = repaired.delegations;
          }
        }
      }
    }

    const reply = clean.length > 0 ? clean : "Understood — noted.";

    const userMessage = await db.teamMessage.create({
      data: { conversationId: conversation.id, role: "user", content },
    });

    const tasks = delegations.length > 0
      ? await createTasksFromDelegations(delegations, agent, false, sessionKey)
      : [];

    const assistantMessage = await db.teamMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: reply,
        taskIds: tasks.length > 0 ? JSON.stringify(tasks.map((task) => task.id)) : null,
      },
    });
    await db.teamConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    const serializedTasks = tasks.map(toTaskDto);
    if (serializedTasks.length > 0) {
      // Execute in the background so the POST returns well within budget.
      after(() => runTasksSequentially(tasks.map((task) => task.id)));
    }

    const payload: ChatSendResponse = {
      success: true,
      userMessage: toMessageDto(userMessage),
      assistantMessage: toMessageDto(assistantMessage),
      tasks: serializedTasks,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[team/chat] POST failed:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error while chatting." },
      { status: 500 },
    );
  }
}
