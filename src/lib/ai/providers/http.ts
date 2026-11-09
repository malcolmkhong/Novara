// ---------------------------------------------------------------------------
// Novara AI — shared provider HTTP plumbing.
//
// No model ids, prices or context windows here (see ./registry.ts). No secrets
// are ever logged; missing credentials raise a named, actionable error.
// ---------------------------------------------------------------------------

import type {
  ChatRequest,
  ChatResponse,
  Msg,
  ProviderAdapter,
  ProviderId,
  ThinkingEffort,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : {};

const numeric = (record: UnknownRecord, key: string): number => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

/**
 * Isomorphic env read. Dynamic keys are NOT inlined by Next.js, so a client
 * bundle safely falls back to registry defaults instead of throwing on
 * `process`. Never returns (or logs) a value.
 */
export function readEnv(name: string): string | undefined {
  try {
    if (typeof process === "undefined" || !process.env) return undefined;
    const value = process.env[name];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function toWireMessages(messages: Msg[]): { role: string; content: string }[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

/**
 * Normalise the usage shapes seen across providers (OpenAI-style,
 * Anthropic-style, MiniMax-style). Returns zeros when the provider sent no
 * usage; router.ts then strips the field so the ledger records NO row rather
 * than a fabricated 0-token row (honesty rule F4).
 */
export function toUsage(raw: unknown): ChatResponse["usage"] {
  const usage = asRecord(asRecord(raw).usage);
  const prompt =
    numeric(usage, "prompt_tokens") ||
    numeric(usage, "input_tokens") ||
    numeric(usage, "promptTokens") ||
    0;
  const completion =
    numeric(usage, "completion_tokens") ||
    numeric(usage, "output_tokens") ||
    numeric(usage, "completionTokens") ||
    0;
  const total =
    numeric(usage, "total_tokens") ||
    numeric(usage, "totalTokens") ||
    prompt + completion;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

export function toContent(raw: unknown): string {
  const choices = asRecord(raw).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message = asRecord(asRecord(choices[0]).message);
  return typeof message.content === "string" ? message.content : "";
}

export interface PostArgs {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
  label: string;
}

export async function postJson(args: PostArgs): Promise<unknown> {
  const response = await fetch(args.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...args.headers },
    body: JSON.stringify(args.body),
    signal: args.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`[${args.label}] HTTP ${response.status}: ${text.slice(0, 400)}`);
  }
  if (!text) throw new Error(`[${args.label}] empty response body`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`[${args.label}] non-JSON response: ${text.slice(0, 200)}`);
  }
}

/** Raw SSE bytes, unchanged — ai.ts's parser owns the framing. */
export async function* sseBytes(
  response: Response,
  label: string,
): AsyncGenerator<Uint8Array> {
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`[${label}] streaming HTTP ${response.status}: ${detail.slice(0, 200)}`);
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export interface CompatConfig {
  id: ProviderId;
  label: string;
  url: () => string;
  headers: () => Promise<Record<string, string>>;
  streaming?: boolean;
  body?: (req: ChatRequest) => Record<string, unknown>;
  content?: (raw: unknown) => string;
  usage?: (raw: unknown) => ChatResponse["usage"];
}

/** Factory for every OpenAI-compatible chat/completions endpoint. */
export function openAiCompatibleAdapter(cfg: CompatConfig): ProviderAdapter {
  const buildBody = (req: ChatRequest, stream: boolean): Record<string, unknown> => ({
    model: req.model,
    messages: toWireMessages(req.messages),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    ...(stream ? { stream: true } : {}),
    ...(cfg.body ? cfg.body(req) : {}),
  });

  async function* runStream(req: ChatRequest): AsyncGenerator<Uint8Array> {
    const response = await fetch(cfg.url(), {
      method: "POST",
      headers: { "content-type": "application/json", ...(await cfg.headers()) },
      body: JSON.stringify(buildBody(req, true)),
      signal: req.signal,
    });
    yield* sseBytes(response, cfg.label);
  }

  return {
    id: cfg.id,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const raw = await postJson({
        url: cfg.url(),
        headers: await cfg.headers(),
        body: buildBody(req, false),
        signal: req.signal,
        label: cfg.label,
      });
      return {
        choices: [{ message: { content: (cfg.content ?? toContent)(raw) } }],
        usage: (cfg.usage ?? toUsage)(raw),
      };
    },
    stream(req: ChatRequest): AsyncIterable<Uint8Array> {
      if (cfg.streaming === false) {
        throw new Error(`[${cfg.label}] streaming is not supported by this adapter`);
      }
      return runStream(req);
    },
  };
}

/** `thinking` only maps to a wire param where the provider documents one. */
export function thinkingToReasoningEffort(
  thinking: ThinkingEffort | undefined,
): Record<string, unknown> {
  return thinking && thinking !== "off" ? { reasoning_effort: thinking } : {};
}
