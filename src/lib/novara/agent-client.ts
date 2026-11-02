// ---------------------------------------------------------------------------
// Novara AI — Agent gateway (client side).
//
// SINGLE SWAP POINT between the mock runtime and the Phase 3 backend.
// The UI (components/hooks) only ever talks to `AgentGateway`. When the real
// backend lands: implement `liveAgentGateway` with fetch + SSE
// (POST /api/agent/runs, GET /api/agent/runs/[id], SSE .../events,
// POST .../approve | .../cancel) and flip AGENT_BACKEND to "live".
// No component changes required.
// ---------------------------------------------------------------------------

import type {
  AgentRunDetail,
  AgentRunMode,
} from "./agent-types";
import type { MockStartOptions } from "./agent-schemas";
import { mockAgentRuntime } from "./mock-agent";

export type { MockStartOptions } from "./agent-schemas";

export interface AgentGateway {
  start(options: MockStartOptions): AgentRunDetail;
  activeRunFor(novelId: string): AgentRunDetail | null;
  get(runId: string): AgentRunDetail | null;
  subscribe(runId: string, cb: (detail: AgentRunDetail) => void): () => void;
  approve(runId: string, taskId: string): AgentRunDetail;
  reject(runId: string, taskId: string): AgentRunDetail;
  cancel(runId: string): AgentRunDetail;
  setMode(runId: string, mode: AgentRunMode): AgentRunDetail;
}

export const AGENT_BACKEND: "mock" | "live" = "mock";

export const agentGateway: AgentGateway = mockAgentRuntime;
