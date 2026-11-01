/**
 * Shared DTOs for the AI Team workspace.
 *
 * This module is intentionally PURE (no server-only imports) so both client
 * components and API routes can import it. Database rows are serialized to
 * these shapes by the API layer before reaching the client.
 */

export type MessageRole = "user" | "assistant" | "system";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AgentDto {
  id: string;
  /** Stable slug: "leader" | "researcher" | "writer" | "engineer" | "analyst". */
  key: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  isLeader: boolean;
  emoji: string;
  /** Hex color used for avatar rings / accents. */
  color: string;
  sortOrder: number;
}

export interface MessageDto {
  id: string;
  role: MessageRole;
  content: string;
  /** Task ids created via this (assistant) message — rendered as live chips. */
  taskIds: string[];
  createdAt: string;
}

export interface TaskLogDto {
  id: string;
  message: string;
  progress: number;
  createdAt: string;
}

export interface TaskDto {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  progress: number;
  result: string | null;
  error: string | null;
  assignee: AgentDto;
  creator: AgentDto;
  creatorIsUser: boolean;
  createdAt: string;
  updatedAt: string;
  logs: TaskLogDto[];
}

export interface ChatSendResponse {
  success: boolean;
  error?: string;
  userMessage?: MessageDto;
  assistantMessage?: MessageDto;
  tasks?: TaskDto[];
}
