/**
 * Client-side API helpers for the AI Team workspace.
 */

import type { AgentDto, ChatSendResponse, MessageDto, TaskDto } from "@/lib/ai-team/types";

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { success?: boolean; error?: string };
  if (!res.ok || data.success === false) {
    throw new Error(data.error ?? `Request failed (${res.status}).`);
  }
  return data;
}

export async function fetchAgents(): Promise<AgentDto[]> {
  const data = await readJson<{ agents: AgentDto[] }>(
    await fetch("/api/team/agents", { cache: "no-store" }),
  );
  return data.agents;
}

export async function fetchConversation(
  agentId: string,
  sessionKey: string,
): Promise<{ agent: AgentDto; messages: MessageDto[] }> {
  const params = new URLSearchParams({ agentId, sessionKey });
  return readJson(
    await fetch(`/api/team/chat?${params.toString()}`, { cache: "no-store" }),
  );
}

export async function sendChatMessage(
  agentId: string,
  sessionKey: string,
  content: string,
): Promise<ChatSendResponse> {
  return readJson(
    await fetch("/api/team/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, sessionKey, content }),
    }),
  );
}

export async function fetchTasks(sessionKey: string): Promise<TaskDto[]> {
  const params = new URLSearchParams();
  if (sessionKey) params.set("sessionKey", sessionKey);
  const qs = params.toString();
  const data = await readJson<{ tasks: TaskDto[] }>(
    await fetch(`/api/team/tasks${qs ? `?${qs}` : ""}`, { cache: "no-store" }),
  );
  return data.tasks;
}

export async function createTask(
  assigneeId: string,
  title: string,
  description: string,
  sessionKey: string,
): Promise<TaskDto> {
  const data = await readJson<{ task: TaskDto }>(
    await fetch("/api/team/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId, title, description, sessionKey }),
    }),
  );
  return data.task;
}

export async function retryTask(taskId: string): Promise<void> {
  await readJson(await fetch(`/api/team/tasks/${taskId}/run`, { method: "POST" }));
}
