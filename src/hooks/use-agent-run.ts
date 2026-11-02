"use client";

// ---------------------------------------------------------------------------
// Novara AI — React binding for the Agent Task Board (plan §4.1).
// One hook per workspace: it restores an active run (survives tab switches
// within the session) and keeps the UI in sync via the gateway's subscribe.
// The mock gateway pushes on timers; the live gateway will push via SSE with
// the same callback shape, so this hook survives the swap unchanged.
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

  // Restore an active run for this novel (if any), then subscribe.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let alive = true;
    setLoading(true);
    try {
      const existing = agentGateway.activeRunFor(novelId);
      setDetail(existing);
      if (existing) {
        unsub = agentGateway.subscribe(existing.run.id, (next) => {
          if (alive) setDetail(next);
        });
      }
    } finally {
      if (alive) setLoading(false);
    }
    return () => {
      alive = false;
      unsub?.();
    };
  }, [novelId]);

  const start = useCallback(async (options: MockStartOptions) => {
    const started = agentGateway.start(options);
    setDetail(started);
    agentGateway.subscribe(started.run.id, (next) => {
      if (novelRef.current === next.run.novelId) setDetail(next);
    });
    return started;
  }, []);

  const approve = useCallback(async (taskId: string) => {
    setDetail((d) => (d ? agentGateway.approve(d.run.id, taskId) : d));
  }, []);

  const reject = useCallback(async (taskId: string) => {
    setDetail((d) => (d ? agentGateway.reject(d.run.id, taskId) : d));
  }, []);

  const cancel = useCallback(async () => {
    setDetail((d) => (d ? agentGateway.cancel(d.run.id) : d));
  }, []);

  const setMode = useCallback(async (mode: AgentRunMode) => {
    setDetail((d) => (d ? agentGateway.setMode(d.run.id, mode) : d));
  }, []);

  const approval = detail?.pendingApproval ?? null;

  return { detail, loading, approval, start, approve, reject, cancel, setMode };
}
