// ---------------------------------------------------------------------------
// Novara AI — Agent gateway (client side).
//
// SINGLE SWAP POINT between the mock runtime and the Phase 3 backend — the
// UI (components/hooks) only ever talks to `agentGateway`.
//
// AGENT_BACKEND is now "live": every call hits the REST API
// (POST /api/agent/runs, GET /api/agent/runs/[id], …/approve |cancel|mode)
// and `subscribe` opens the SSE stream …/events with a polling fallback
// (降级轮询) if EventSource errors. All methods are async — the mock runtime
// is wrapped in the same async shape so a rollback is a one-line flip.
// ---------------------------------------------------------------------------

import type {
  AgentRunDetail,
  AgentRunMode,
} from "./agent-types";
import type { MockStartOptions } from "./agent-schemas";
import { mockAgentRuntime } from "./mock-agent";

export type { MockStartOptions } from "./agent-schemas";
export type StartOptions = MockStartOptions;

export interface AgentGateway {
  start(options: StartOptions): Promise<AgentRunDetail>;
  activeRunFor(novelId: string): Promise<AgentRunDetail | null>;
  /** Latest run of any status — history fallback for the conversation pane. */
  latestRunFor(novelId: string): Promise<AgentRunDetail | null>;
  get(runId: string): Promise<AgentRunDetail | null>;
  subscribe(runId: string, cb: (detail: AgentRunDetail) => void): () => void;
  approve(runId: string, taskId: string): Promise<AgentRunDetail>;
  reject(runId: string, taskId: string): Promise<AgentRunDetail>;
  cancel(runId: string): Promise<AgentRunDetail>;
  setMode(runId: string, mode: AgentRunMode): Promise<AgentRunDetail>;
}

export const AGENT_BACKEND: "mock" | "live" = "live";

// ---------------------------------------------------------------------------
// Mock adapter — same async contract over the in-memory runtime (rollback).
// ---------------------------------------------------------------------------

const mockGateway: AgentGateway = {
  async start(options) {
    return mockAgentRuntime.start(options);
  },
  async activeRunFor(novelId) {
    return mockAgentRuntime.activeRunFor(novelId);
  },
  async latestRunFor(novelId) {
    // The mock runtime is in-memory and session-scoped — its latest run is
    // whatever is active right now.
    return mockAgentRuntime.activeRunFor(novelId);
  },
  async get(runId) {
    return mockAgentRuntime.get(runId);
  },
  subscribe(runId, cb) {
    return mockAgentRuntime.subscribe(runId, cb);
  },
  async approve(runId, taskId) {
    return mockAgentRuntime.approve(runId, taskId);
  },
  async reject(runId, taskId) {
    return mockAgentRuntime.reject(runId, taskId);
  },
  async cancel(runId) {
    return mockAgentRuntime.cancel(runId);
  },
  async setMode(runId, mode) {
    return mockAgentRuntime.setMode(runId, mode);
  },
};

// ---------------------------------------------------------------------------
// Live gateway — REST + SSE.
// ---------------------------------------------------------------------------

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

/** Client-side polling fallback interval (mirror of budgets.yaml sse/client). */
const FALLBACK_POLL_MS = 2000;

export const liveAgentGateway: AgentGateway = {
  async start(options) {
    const res = await jsonFetch<{ detail: AgentRunDetail }>("/api/agent/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        novelId: options.novelId,
        goal: options.goal,
        mode: options.mode,
        ...(options.pinned && options.pinned.length > 0 ? { pinned: options.pinned } : {}),
      }),
    });
    return res.detail;
  },

  async activeRunFor(novelId) {
    const res = await jsonFetch<{ detail: AgentRunDetail | null }>(
      `/api/agent/runs?novelId=${encodeURIComponent(novelId)}&active=1`
    );
    return res.detail;
  },

  async latestRunFor(novelId) {
    const res = await jsonFetch<{ detail: AgentRunDetail | null }>(
      `/api/agent/runs?novelId=${encodeURIComponent(novelId)}&latest=1`
    );
    return res.detail;
  },

  async get(runId) {
    try {
      const res = await jsonFetch<{ detail: AgentRunDetail | null }>(
        `/api/agent/runs/${runId}`
      );
      return res.detail;
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) return null;
      throw error;
    }
  },

  subscribe(runId, cb) {
    let closed = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (pollTimer || closed) return;
      pollTimer = setInterval(async () => {
        try {
          const detail = await liveAgentGateway.get(runId);
          if (detail) cb(detail);
        } catch {
          // keep polling — transient errors shouldn't kill the fallback
        }
      }, FALLBACK_POLL_MS);
    };

    try {
      const source = new EventSource(`/api/agent/runs/${runId}/events`);
      source.onmessage = (event) => {
        try {
          cb(JSON.parse(event.data) as AgentRunDetail);
        } catch {
          // ignore malformed frames; the next snapshot resyncs
        }
      };
      source.onerror = () => {
        source.close();
        startPolling(); // 降级轮询
      };
      return () => {
        closed = true;
        source.close();
        if (pollTimer) clearInterval(pollTimer);
      };
    } catch {
      // EventSource unavailable — poll from the start.
      startPolling();
      return () => {
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
      };
    }
  },

  async approve(runId, taskId) {
    const res = await jsonFetch<{ detail: AgentRunDetail }>(
      `/api/agent/runs/${runId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, decision: "approve" }),
      }
    );
    return res.detail;
  },

  async reject(runId, taskId) {
    const res = await jsonFetch<{ detail: AgentRunDetail }>(
      `/api/agent/runs/${runId}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, decision: "reject" }),
      }
    );
    return res.detail;
  },

  async cancel(runId) {
    const res = await jsonFetch<{ detail: AgentRunDetail }>(
      `/api/agent/runs/${runId}/cancel`,
      { method: "POST" }
    );
    return res.detail;
  },

  async setMode(runId, mode) {
    const res = await jsonFetch<{ detail: AgentRunDetail }>(
      `/api/agent/runs/${runId}/mode`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      }
    );
    return res.detail;
  },
};

export const agentGateway: AgentGateway =
  AGENT_BACKEND === "live" ? liveAgentGateway : mockGateway;
