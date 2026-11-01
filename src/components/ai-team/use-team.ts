"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createTask, fetchAgents, fetchConversation, fetchNovelDetail, fetchNovelList, fetchTasks, retryTask, sendChatMessage } from "./api";
import { useSessionKey } from "./use-session";

/** The fixed roster — seeds itself on first fetch, rarely changes. */
export function useAgents() {
  return useQuery({
    queryKey: ["team", "agents"],
    queryFn: fetchAgents,
    staleTime: 5 * 60 * 1000,
  });
}

/** One agent's conversation; polls while visible so task reports stream in. */
export function useConversation(agentId: string, poll: boolean) {
  const sessionKey = useSessionKey();
  return useQuery({
    queryKey: ["team", "chat", sessionKey, agentId],
    queryFn: () => fetchConversation(agentId, sessionKey),
    enabled: Boolean(sessionKey && agentId),
    refetchInterval: poll ? 3000 : false,
  });
}

/** Global task list; light polling powers the live progress UI. */
export function useTasks(poll: boolean) {
  const sessionKey = useSessionKey();
  return useQuery({
    queryKey: ["team", "tasks", sessionKey],
    queryFn: () => fetchTasks(sessionKey),
    enabled: Boolean(sessionKey),
    refetchInterval: poll ? 2500 : false,
  });
}

export function useSendMessage() {
  const sessionKey = useSessionKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, content }: { agentId: string; content: string }) =>
      sendChatMessage(agentId, sessionKey, content),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team", "chat", sessionKey] });
      void queryClient.invalidateQueries({ queryKey: ["team", "tasks"] });
    },
  });
}

export function useCreateTask() {
  const sessionKey = useSessionKey();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assigneeId, title, description }: { assigneeId: string; title: string; description: string }) =>
      createTask(assigneeId, title, description, sessionKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team", "tasks"] });
    },
  });
}

export function useRetryTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => retryTask(taskId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team", "tasks"] });
    },
  });
}

/** Bookshelf for the side panel (书房 tab). */
export function useNovelList() {
  return useQuery({
    queryKey: ["novel", "list"],
    queryFn: fetchNovelList,
    staleTime: 20_000,
  });
}

/** Full book payload (volumes / chapters / foreshadows), lazy per expanded novel. */
export function useNovelDetail(novelId: string | null) {
  return useQuery({
    queryKey: ["novel", "detail", novelId],
    queryFn: () => fetchNovelDetail(novelId as string),
    enabled: Boolean(novelId),
    staleTime: 10_000,
  });
}
