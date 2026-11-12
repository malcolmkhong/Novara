// ---------------------------------------------------------------------------
// Novara AI — provider router + ZAI compatibility surface.
//
// All 8 legacy `ZAI.create()` call sites keep their exact call shape; `create`
// is a thin compat wrapper over ProviderAdapter.chat / ProviderAdapter.stream,
// so the old call sites and the raw-SSE parser stay untouched.
// ---------------------------------------------------------------------------

import type {
  ChatRequest,
  ChatResponse,
  CompatRequest,
  ProviderAdapter,
  ProviderId,
  ThinkingEffort,
} from "./providers/types";
import type { ModelDef } from "./providers/types";
import {
  DEFAULT_MODEL_ID,
  isProviderEnabled,
  resolveModel,
} from "./providers/registry";
import { geminiAdapter } from "./providers/gemini";
import { deepseekAdapter } from "./providers/deepseek";
import { minimaxAdapter } from "./providers/minimax";
import { openaiAdapter } from "./providers/openai";
import { anthropicAdapter } from "./providers/anthropic";

const FACTORIES: Record<ProviderId, () => ProviderAdapter> = {
  gemini: () => geminiAdapter,
  deepseek: () => deepseekAdapter,
  minimax: () => minimaxAdapter,
  openai: () => openaiAdapter,
  anthropic: () => anthropicAdapter,
};

/** One adapter instance per provider for the life of the process. */
const ADAPTER_CACHE = new Map<ProviderId, ProviderAdapter>();

export function resolveAdapter(modelId: string): ProviderAdapter {
  const model = resolveModel(modelId);
  const cached = ADAPTER_CACHE.get(model.provider);
  if (cached) return cached;
  const adapter = FACTORIES[model.provider]();
  ADAPTER_CACHE.set(model.provider, adapter);
  return adapter;
}

export { DEFAULT_MODEL_ID, resolveModel } from "./providers/registry";

function normalizeThinking(value: CompatRequest["thinking"]): ThinkingEffort {
  if (!value) return "off";
  if (typeof value === "string") return value;
  // Legacy SDK shape was `thinking: { type: "disabled" | "enabled" }`.
  return value.type === "enabled" ? "high" : "off";
}

function toChatRequest(req: CompatRequest, model: ModelDef): ChatRequest {
  return {
    model: model.wireModel,
    messages: req.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    maxTokens: req.max_tokens ?? req.maxTokens,
    stream: req.stream,
    signal: req.signal,
    thinking: normalizeThinking(req.thinking),
  };
}

function assertUsable(model: ModelDef): void {
  if (!isProviderEnabled(model.provider)) {
    throw new Error(
      `[router] provider "${model.provider}" is not configured — set ${model.envKeyName}.`,
    );
  }
  if (!model.wireModel) {
    throw new Error(`[router] model "${model.id}" has an empty wireModel.`);
  }
}

function create(req: CompatRequest & { stream: true }): Promise<AsyncIterable<Uint8Array>>;
function create(req: CompatRequest): Promise<ChatResponse>;
async function create(
  req: CompatRequest,
): Promise<ChatResponse | AsyncIterable<Uint8Array>> {
  const model = resolveModel(req.model);
  assertUsable(model);
  const adapter = resolveAdapter(model.id);
  const chatRequest = toChatRequest(req, model);

  if (req.stream === true) {
    if (!model.supportsStreaming) {
      throw new Error(`[router] model "${model.id}" does not support streaming.`);
    }
    return adapter.stream(chatRequest);
  }

  const response = await adapter.chat(chatRequest);
  // Honesty rule F4: a completion with no observed usage must NOT become a
  // fabricated 0-token ledger row. Strip `usage` so extractRealUsage()->null.
  if (!response.usage || response.usage.total_tokens <= 0) {
    return { choices: response.choices } as ChatResponse;
  }
  return response;
}

/** Drop-in replacement for the removed provider SDK default export. */
const ZAI = {
  create() {
    return { chat: { completions: { create } } };
  },
};

export default ZAI;
