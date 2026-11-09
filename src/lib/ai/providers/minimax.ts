// MiniMax — chatcompletion_v2. Response is OpenAI-shaped enough for `toContent`,
// but its SSE framing is NOT OpenAI-shaped, so `supportsStreaming` is false in
// the registry and this adapter refuses streaming rather than feeding the
// existing parser bytes it cannot read.
import type { ProviderAdapter } from "./types";
import { openAiCompatibleAdapter, readEnv } from "./http";

export const minimaxAdapter: ProviderAdapter = openAiCompatibleAdapter({
  id: "minimax",
  label: "minimax",
  streaming: false,
  url: () =>
    readEnv("MINIMAX_BASE_URL") ?? "https://api.minimax.chat/v1/text/chatcompletion_v2",
  headers: async () => {
    const key = readEnv("MINIMAX_API_KEY");
    if (!key) throw new Error("[minimax] MINIMAX_API_KEY is not set");
    return { authorization: `Bearer ${key}` };
  },
});
