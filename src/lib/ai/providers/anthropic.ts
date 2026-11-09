// Anthropic — /v1/messages has a different request AND response shape, so this
// adapter translates it into ChatResponse instead of using the shared factory.
// Streaming is flagged unsupported in the registry: Anthropic SSE emits
// content_block_delta events, which ai.ts's choices[].delta.content parser
// cannot read.
import type { ChatRequest, ChatResponse, ProviderAdapter } from "./types";
import { postJson, readEnv } from "./http";

const ENDPOINT =
  "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

interface AnthropicRaw {
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const key = readEnv("ANTHROPIC_API_KEY");
    if (!key) throw new Error("[anthropic] ANTHROPIC_API_KEY is not set");

    const system = req.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const messages = req.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      }));

    const raw = (await postJson({
      url: readEnv("ANTHROPIC_BASE_URL") ?? ENDPOINT,
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      body: {
        model: req.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(system ? { system } : {}),
        messages,
        ...(req.thinking && req.thinking !== "off"
          ? { thinking: { type: "enabled", budget_tokens: 8192 } }
          : {}),
      },
      signal: req.signal,
      label: "anthropic",
    })) as AnthropicRaw;

    const text = (raw.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    const prompt = raw.usage?.input_tokens ?? 0;
    const completion = raw.usage?.output_tokens ?? 0;

    return {
      choices: [{ message: { content: text } }],
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
      },
    };
  },

  stream(): AsyncIterable<Uint8Array> {
    throw new Error(
      "[anthropic] streaming is unsupported: anthropic:* models are marked supportsStreaming=false in registry.ts",
    );
  },
};
