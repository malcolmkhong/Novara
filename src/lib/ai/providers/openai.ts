// OpenAI — OpenAI-compatible chat/completions.
import type { ProviderAdapter } from "./types";
import { openAiCompatibleAdapter, readEnv, thinkingToReasoningEffort } from "./http";

export const openaiAdapter: ProviderAdapter = openAiCompatibleAdapter({
  id: "openai",
  label: "openai",
  url: () => readEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1/chat/completions",
  headers: async () => {
    const key = readEnv("OPENAI_API_KEY");
    if (!key) throw new Error("[openai] OPENAI_API_KEY is not set");
    return { authorization: `Bearer ${key}` };
  },
  // OpenAI documents `reasoning_effort`; the other providers do not, so this is
  // the only adapter that forwards `thinking` today.
  body: (req) => thinkingToReasoningEffort(req.thinking),
});
