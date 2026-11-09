// ---------------------------------------------------------------------------
// Novara AI — provider layer contracts (multi-provider migration).
//
// Pure contracts only: no provider SDK imports, and NO model id, price or
// context window lives here. Those live ONLY in ./registry.ts.
// ---------------------------------------------------------------------------

export type ProviderId = "gemini" | "deepseek" | "minimax" | "openai" | "anthropic";
export type Tier = "pro" | "fast";
export type ThinkingEffort = "off" | "low" | "medium" | "high";

/**
 * Wire-level message. `role` is deliberately a plain string: the legacy AI
 * helpers use "assistant" for system prompts, and each adapter normalises it.
 */
export interface Msg {
  role: string;
  content: string;
}

export interface ModelDef {
  id: string;            // "gemini:pro" - stable app-level id
  provider: ProviderId;
  tier: Tier;
  label: string;         // shown in the picker
  vendor: string;        // "Google"
  wireModel: string;     // from env, never a literal outside registry.ts
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  writingScore: 1 | 2 | 3 | 4 | 5;   // editorial ranking, drives default order
  price: {
    inputUsdPer1M: number;
    cachedInputUsdPer1M: number | null;
    outputUsdPer1M: number;
  };
  authMode: "adc" | "apiKey";
  envKeyName: string;    // e.g. DEEPSEEK_API_KEY - name only
}

/** `model` is the PROVIDER-FACING wire id, resolved by ../../router.ts. */
export interface ChatRequest {
  model: string;
  messages: Msg[];
  maxTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
  thinking?: ThinkingEffort;
}

export interface ChatResponse {
  choices: { message: { content: string } }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ProviderAdapter {
  id: ProviderId;
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream(req: ChatRequest): AsyncIterable<Uint8Array>;   // raw bytes, SSE
}

/**
 * Legacy `ZAI.create().chat.completions.create(req)` call shape, kept intact so
 * ai.ts and the SSE parser stay untouched. Extra keys are tolerated.
 */
export interface CompatRequest {
  model?: string;
  messages: Msg[];
  thinking?: ThinkingEffort | { type: "enabled" | "disabled" };
  max_tokens?: number;
  maxTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
  [key: string]: unknown;
}
