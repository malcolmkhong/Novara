"use client";

// ---------------------------------------------------------------------------
// Novara AI — React binding for the Agent Task Board (plan §4.1).
// One hook per workspace: it restores an active run (survives tab switches
// within the session) and keeps the UI in sync via the gateway's subscribe.
// The live gateway pushes via SSE (full snapshots) with polling fallback;
// all mutations are async REST calls — the hook awaits and re-sets state.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentRunDetail,
  AgentRunMode,
  ApprovalRequest,
} from "@/lib/novara/agent-types";
import { agentGateway, type MockStartOptions } from "@/lib/novara/agent-client";

export interface UseAgentRunResult {
  detail: AgentRunDetail | null;
  loading: boolean;
  /** Latest approval request when the run is awaiting_approval. */
  approval: ApprovalRequest | null;
  start: (options: MockStartOptions) => Promise<AgentRunDetail>;
  approve: (taskId: string) => Promise<void>;
  reject: (taskId: string) => Promise<void>;
  cancel: () => Promise<void>;
  setMode: (mode: AgentRunMode) => Promise<void>;
}

export function useAgentRun(novelId: string): UseAgentRunResult {
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const novelRef = useRef(novelId);
  novelRef.current = novelId;
  const detailRef = useRef<AgentRunDetail | null>(null);
  detailRef.current = detail;
  const unsubRef = useRef<(() => void) | undefined>(undefined);

  // Restore an active run for this novel (if any), then subscribe.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const existing = await agentGateway.activeRunFor(novelId);
        if (!alive) return;
        setDetail(existing);
        if (existing) {
          unsubRef.current?.();
          unsubRef.current = agentGateway.subscribe(existing.run.id, (next) => {
            if (novelRef.current === next.run.novelId) setDetail(next);
          });
        }
      } catch (error) {
        console.error("[use-agent-run] restore failed", error);
        if (alive) setDetail(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      unsubRef.current?.();
      unsubRef.current = undefined;
    };
  }, [novelId]);

  const start = useCallback(async (options: MockStartOptions) => {
    const started = await agentGateway.start(options);
    if (novelRef.current !== started.run.novelId) return started;
    setDetail(started);
    unsubRef.current?.();
    unsubRef.current = agentGateway.subscribe(started.run.id, (next) => {
      if (novelRef.current === next.run.novelId) setDetail(next);
    });
    return started;
  }, []);

  const approve = useCallback(async (taskId: string) => {
    const current = detailRef.current;
    if (!current) return;
    try {
      setDetail(await agentGateway.approve(current.run.id, taskId));
    } catch (error) {
      console.error("[use-agent-run] approve failed", error);
    }
  }, []);

  const reject = useCallback(async (taskId: string) => {
    const current = detailRef.current;
    if (!current) return;
    try {
      setDetail(await agentGateway.reject(current.run.id, taskId));
    } catch (error) {
      console.error("[use-agent-run] reject failed", error);
    }
  }, []);

  const cancel = useCallback(async () => {
    const current = detailRef.current;
    if (!current) return;
    try {
      setDetail(await agentGateway.cancel(current.run.id));
    } catch (error) {
      console.error("[use-agent-run] cancel failed", error);
    }
  }, []);

  const setMode = useCallback(async (mode: AgentRunMode) => {
    const current = detailRef.current;
    if (!current) return;
    try {
      setDetail(await agentGateway.setMode(current.run.id, mode));
    } catch (error) {
      console.error("[use-agent-run] setMode failed", error);
    }
  }, []);

  const approval = detail?.pendingApproval ?? null;

  return { detail, loading, approval, start, approve, reject, cancel, setMode };
}
