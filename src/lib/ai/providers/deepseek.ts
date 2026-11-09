// DeepSeek — OpenAI-compatible chat/completions.
import type { ProviderAdapter } from "./types";
import { openAiCompatibleAdapter, readEnv } from "./http";

export const deepseekAdapter: ProviderAdapter = openAiCompatibleAdapter({
  id: "deepseek",
  label: "deepseek",
  url: () => readEnv("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com/chat/completions",
  headers: async () => {
    const key = readEnv("DEEPSEEK_API_KEY");
    if (!key) throw new Error("[deepseek] DEEPSEEK_API_KEY is not set");
    return { authorization: `Bearer ${key}` };
  },
});
