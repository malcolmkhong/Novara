import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { CreditError } from "@/lib/credits/charge";
import {
  appendGroundTruthIfClaimed,
  buildHistoryMessages,
  createContinuationTask,
  createTasksFromDelegations,
  ensureSeed,
  getOrCreateConversation,
  teamAgentTurn,
  teamText,
  noteTurnCorrections,
  parseDelegations,
  runTasksSequentially,
  synthesizeAssignmentReply,
  toAgentDto,
  toMessageDto,
  toTaskDto,
  verifyCompletionClaims,
} from "@/lib/ai-team/server";
import type { AiScope, TaskRow } from "@/lib/ai-team/server";
import { buildDelegationRepairMessages, buildLeaderSystemPrompt, buildMemberChatPrompt } from "@/lib/ai-team/prompts";
import { buildNovelToolPrompt } from "@/lib/ai-team/novel-tools";
import type { ChatSendResponse } from "@/lib/ai-team/types";
import { recordProvenanceLink } from "@/lib/usage/usage-store";

export const dynamic = "force-dynamic";

const getSchema = z.object({
  agentId: z.string().min(1),
  sessionKey: z.string().min(1).max(64),
  // P5-g: optional workspace pin — a conversation opened inside a novel
  // workspace attributes there (pinned at creation, plan §5.1).
  novelId: z.string().min(1).max(64).optional(),
});

const postSchema = z.object({
  agentId: z.string().min(1),
  sessionKey: z.string().min(1).max(64),
  content: z.string().trim().min(1).max(2000),
  novelId: z.string().min(1).max(64).optional(),
  // P5-g: optional request-side model override (live-fire/ops tooling;
  // production callers omit it → gateway default, recorded honestly).
  model: z.string().trim().min(1).max(64).optional(),
});

/** GET /api/team/chat?agentId=…&sessionKey=… — one agent's conversation. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = getSchema.safeParse({
    agentId: url.searchParams.get("agentId") ?? "",
    sessionKey: url.searchParams.get("sessionKey") ?? "",
    novelId: url.searchParams.get("novelId") ?? undefined,
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
    const conversation = await getOrCreateConversation(
      agent.id,
      parsed.data.sessionKey,
      parsed.data.novelId,
    );
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
 * The AI reply is produced first (so failures leave no phantom messages),
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

    const conversation = await getOrCreateConversation(
      agent.id,
      sessionKey,
      parsed.data.novelId,
    );
    // Effective attribution scope (plan §5): the conversation's pinned
    // novelId wins (created inside a workspace → direct attribution);
    // otherwise this request's novelId, if any; otherwise the pre-novel
    // session namespace "ai-team:<sessionKey>" (wizard precedent — a
    // create_novel later retro-adopts these rows via the provenance link).
    const effectiveNovelId = conversation.novelId ?? parsed.data.novelId ?? null;
    const scope: AiScope = effectiveNovelId
      ? { novelId: effectiveNovelId, ...(parsed.data.model ? { model: parsed.data.model } : {}) }
      : {
          correlationId: `ai-team:${sessionKey}`,
          ...(parsed.data.model ? { model: parsed.data.model } : {}),
        };
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
    // Leaders coordinate: read-only novel access (writes are delegated).
    // Members get full read/write tools.
    systemPrompt += `\n\n${await buildNovelToolPrompt({ readonly: agent.isLeader })}`;

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content },
    ];

    const turn = await teamAgentTurn(messages, agent.key, undefined, scope);
    if (turn.text === null) {
      return NextResponse.json(
        {
          success: false,
          error: `${agent.name} could not reply in time (model busy). Please try again.`,
        },
        { status: 504 },
      );
    }

    const { clean: initialClean, delegations: parsedDelegations } = parseDelegations(turn.text);
    let delegations = parsedDelegations;
    let clean = initialClean;
    const corrections: string[] = [];
    // Repair/verify passes only make sense on turns that actually finished;
    // an exhausted turn recovers through the continuation task instead.
    const turnAnswered = turn.outcome === "answered";

    // Safety net: the agent announced work but skipped the protocol block,
    // so nothing would be tracked. One bounded repair round-trip converts
    // the announcement into real tasks.
    //
    // GATE: never repair while the reply asks the user a question — a
    // clarifying question (“你想创作什么类型呢？我可以安排Sage…”) is a
    // conditional offer, not an assignment; auto-dispatching here would run
    // tasks the user has not confirmed yet.
    if (turnAnswered && delegations.length === 0 && !/[？?]/.test(clean)) {
      const candidates = agent.isLeader
        ? await db.teamAgent.findMany({ where: { isLeader: false } })
        : [agent];
      const mentioned = candidates.filter((candidate) =>
        clean.toLowerCase().includes(candidate.name.toLowerCase()),
      );
      if (mentioned.length > 0) {
        const repairRaw = await teamText(
          [
            ...messages,
            { role: "assistant", content: turn.text },
            ...buildDelegationRepairMessages(mentioned.map((candidate) => candidate.name)),
          ],
          `${agent.key}-repair`,
          25_000,
          scope,
        );
        if (repairRaw !== null && !/^NO_BLOCK$/i.test(repairRaw.trim())) {
          const repaired = parseDelegations(repairRaw);
          if (repaired.delegations.length > 0) {
            delegations = repaired.delegations;
            corrections.push("delegation-repair");
          }
        }
      }
    }

    // Ground-truth verification: a reply that claims novel completion (or
    // merely suggests continuing) with zero writes/delegations this turn is
    // the exact mechanism behind fabricated “已完成” answers. One bounded
    // corrective round with the live library state; any delegations it
    // emits become real tasks below.
    if (turnAnswered && delegations.length === 0 && clean.length > 0) {
      const verified = await verifyCompletionClaims({
        baseMessages: messages,
        draftReply: clean,
        label: `${agent.key}-claim-verify`,
        scope,
      });
      if (verified.delegations.length > 0) {
        delegations = verified.delegations;
        corrections.push("claim-verify");
      }
      clean = verified.text;
    }

    // Budget-exhaustion self-healing: the turn ended mid-tooling. Spawn ONE
    // tracked continuation task assigned to the same agent so the job
    // finishes on its own instead of asking the user to say “继续”.
    let continuation: TaskRow | null = null;
    if (delegations.length === 0 && turn.outcome === "tool_exhausted") {
      continuation = await createContinuationTask(agent, sessionKey, turn, content, effectiveNovelId);
      if (continuation) corrections.push("continuation");
    }

    // P5-g provenance (plan §5.2): a pre-novel turn whose tool loop created
    // a novel retro-adopts its ledger rows into that novel's ledger — the
    // wizard precedent. Idempotent per (correlationId, novelId).
    if (scope.correlationId && turn.createdNovelIds.length > 0) {
      for (const createdId of turn.createdNovelIds) {
        recordProvenanceLink("ai-team", scope.correlationId, createdId);
      }
    }

    const userMessage = await db.teamMessage.create({
      data: { conversationId: conversation.id, role: "user", content },
    });

    const tasks = delegations.length > 0
      ? await createTasksFromDelegations(delegations, agent, false, sessionKey, 0, effectiveNovelId)
      : [];
    const allTaskIds = [
      ...tasks.map((task) => task.id),
      ...(continuation ? [continuation.id] : []),
    ];

    let reply: string;
    if (continuation) {
      const receipts =
        turn.writes.length > 0
          ? `（已写入库：${turn.writes.slice(0, 3).join(" | ")}）`
          : "";
      reply = `上一轮的工具操作已执行${receipts}，但轮次预算内没能给出最终答复。我已自动安排一次收尾执行来完成剩余部分，完成后结果会直接汇报到这里——不需要回复“继续”。`;
    } else {
      reply =
        clean.length > 0
          ? clean
          : tasks.length > 0
            ? synthesizeAssignmentReply(tasks)
            : turn.toolLog
              ? "已根据库内数据完成查询/写入，结果见上方工具记录。需要我继续推进时说一声即可。"
              : "（这轮我没能生成有效回复——模型可能暂时不可用。请重发一次或换个说法，我会重新处理。）";
      if (tasks.length === 0 && clean.length > 0) {
        // Even after correction, make sure a lingering completion claim is
        // labeled with the factual library state.
        const beforeGroundTruth = reply;
        reply = await appendGroundTruthIfClaimed(reply);
        if (reply !== beforeGroundTruth) corrections.push("ground-truth-note");
      }
    }
    await noteTurnCorrections(turn.turnLogId, corrections);

    // Persist tool activity first (transparent, ordered before the reply).
    const replyTime = new Date();
    if (turn.toolLog) {
      await db.teamMessage.create({
        data: {
          conversationId: conversation.id,
          role: "system",
          content: turn.toolLog,
          createdAt: replyTime,
        },
      });
    }

    const assistantMessage = await db.teamMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: reply,
        taskIds: allTaskIds.length > 0 ? JSON.stringify(allTaskIds) : null,
        createdAt: new Date(replyTime.getTime() + 2),
      },
    });
    await db.teamConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    const serializedTasks = [
      ...tasks.map(toTaskDto),
      ...(continuation ? [toTaskDto(continuation)] : []),
    ];
    if (allTaskIds.length > 0) {
      // Execute in the background so the POST returns well within budget.
      after(() => runTasksSequentially(allTaskIds));
    }

    const payload: ChatSendResponse = {
      success: true,
      userMessage: toMessageDto(userMessage),
      assistantMessage: toMessageDto(assistantMessage),
      tasks: serializedTasks,
    };
    return NextResponse.json(payload);
  } catch (error) {
    // Step 58 — a credit refusal keeps its status and its payload.
    if (error instanceof CreditError) {
      return NextResponse.json(error.payload, { status: error.status });
    }
    console.error("[team/chat] POST failed:", error);
    return NextResponse.json(
      { success: false, error: "Unexpected server error while chatting." },
      { status: 500 },
    );
  }
}
