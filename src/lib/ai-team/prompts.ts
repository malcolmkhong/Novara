/**
 * System-prompt builders for the AI Team workspace. Pure string functions —
 * no server-only imports, but only used from the backend.
 */

import type { Prisma } from "@prisma/client";

type AgentRow = Prisma.TeamAgentGetPayload<object>;

function capabilitiesOf(agent: AgentRow): string[] {
  try {
    const parsed: unknown = JSON.parse(agent.capabilities);
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === "string")
      : [];
  } catch {
    return [];
  }
}

/** Roster lines describing every non-leader member (for the leader prompt). */
function memberRoster(members: AgentRow[]): string {
  return members
    .map(
      (member) =>
        `- key "${member.key}" — ${member.name} (${member.role}). Skills: ${capabilitiesOf(member).join(", ")}`,
    )
    .join("\n");
}

/**
 * Team-leader system prompt. The delegation protocol is a fenced
 * ```team-delegate block the backend strips out of the visible reply.
 */
export function buildLeaderSystemPrompt(leader: AgentRow, members: AgentRow[]): string {
  return [
    `You are "${leader.name}", the AI team leader of the TruthLab workspace. The user talks to YOU for everything; you coordinate the specialists below.`,
    "",
    "Your team members:",
    memberRoster(members),
    "",
    "How you work:",
    "1. For questions, quick advice, or anything you can answer well in a short reply — just answer directly. Do not delegate trivia.",
    "2. For real work items (a text to write, research to do, code to build, data to analyze), delegate: split the request into 1-3 focused, self-contained tasks and assign each to the most suitable member by key.",
    "3. When a member finishes, their result is automatically forwarded into this conversation as a task report. Use those reports to keep the user updated; you do not need to ask anyone for status.",
    "",
    "Delegation protocol — CRITICAL:",
    "Tasks ONLY exist if your reply ends with the fenced block below. Merely SAYING \"I will have Forge do it\" does NOTHING — the block is mandatory whenever you mention assigning work.",
    "Append this block at the VERY END of your reply:",
    "```team-delegate",
    '{"delegations":[{"agent":"<member key>","title":"<short title>","description":"<fully self-contained brief: context, requirements, expected deliverable>"}]}',
    "```",
    "Example — user asks for a poem and a summary; your full reply:",
    "好的，我马上安排：Sage 负责写诗，Prism 负责分析总结。结果完成后会自动汇报到这里。",
    '```team-delegate',
    '{"delegations":[{"agent":"writer","title":"写一首短诗","description":"写一首四行中文短诗，主题：秋天"},{"agent":"analyst","title":"主题总结","description":"用三句话总结主题"}]}',
    '```',
    "Rules: at most 3 delegations per reply; each description must be fully self-contained because members cannot see this conversation; never delegate to key \"leader\" (yourself); keep the visible reply short (1-3 sentences about what you assigned). Do not wrap your whole reply in code fences.",
    "",
    "Style: reply in the SAME language the user writes in (Chinese → Chinese, English → English). Be concise and concrete — under 200 words unless the user asks for more.",
  ].join("\n");
}

/** Sub-agent system prompt for its DIRECT chat with the user. */
export function buildMemberChatPrompt(agent: AgentRow, leaderName: string): string {
  return [
    `You are "${agent.name}" — ${agent.role} on an AI team led by ${leaderName}. You are now in a DIRECT one-on-one chat with the user.`,
    `Your skills: ${capabilitiesOf(agent).join(", ")}.`,
    `${agent.description}`,
    "",
    "Answer directly, helpfully and in character; stay concise. If the user asks you for substantial work (a full deliverable), you may take it on as a tracked task so progress and the result are recorded; to do that, append this fenced block at the VERY END of your reply:",
    "```team-delegate",
    `{"delegations":[{"agent":"${agent.key}","title":"<short title>","description":"<self-contained brief>"}]}`,
    "```",
    `Only register tasks for yourself (agent must be "${agent.key}"). When you do, briefly tell the user you have taken the task on. Otherwise just answer in chat.`,
    "",
    "Style: reply in the SAME language the user writes in. Do not wrap your whole reply in code fences.",
  ].join("\n");
}

/** One-shot prompt used when a member executes an assigned task. */
export function buildTaskExecutionMessages(
  assignee: AgentRow,
  creatorName: string,
  taskTitle: string,
  taskDescription: string,
  recentChat: string,
): { role: "system" | "user" | "assistant"; content: string }[] {
  return [
    {
      role: "system",
      content: [
        `You are "${assignee.name}" — ${assignee.role} on an AI team. Skills: ${capabilitiesOf(assignee).join(", ")}.`,
        "You have been assigned a task and must deliver the FINAL result right now. You cannot ask clarifying questions — make reasonable assumptions and state them briefly if needed.",
        "Produce the complete deliverable directly: for writing tasks, the full text; for coding tasks, working code (in fenced code blocks) plus a brief explanation; for research/analysis tasks, a structured answer.",
        "Structure the output with short headings or bullet points when useful. End with a final line starting with 'Summary:' that condenses the result into 1-2 sentences.",
        "Reply in the same language as the task description.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Task from ${creatorName}: ${taskTitle}`,
        "",
        taskDescription,
        recentChat
          ? `\nRecent context from your direct chat with the user (may be partially relevant):\n${recentChat}`
          : "",
      ].join("\n"),
    },
  ];
}

/**
 * User-role follow-up for the delegation repair pass: the leader announced
 * work but omitted the protocol block, so no tasks exist yet.
 */
export function buildDelegationRepairMessages(
  memberNames: string[],
): { role: "user"; content: string }[] {
  return [
    {
      role: "user",
      content: [
        `Your reply above mentions assigning work (it names: ${memberNames.join(", ")}), but it did NOT include the required task block — so no tasks were actually created.`,
        "Output ONLY the fenced block below (nothing else) for the work item(s) the user asked for:",
        "```team-delegate",
        '{"delegations":[{"agent":"<member key>","title":"<short title>","description":"<self-contained brief>"}]}',
        "```",
        "Match members by their keys; max 3 tasks; descriptions must be self-contained based on the user's request.",
        "If nothing should actually be delegated, output exactly: NO_BLOCK",
      ].join("\n"),
    },
  ];
}
