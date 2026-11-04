import { jsonrepair } from "jsonrepair";
import { glmChat } from "./glm";
import { parseLooseJson } from "./parse-json";

/**
 * GLM JSON helper: asks the model for a strict JSON object, then parses and
 * validates it. GLM routinely breaks JSON by embedding unescaped quotes from
 * chapter dialogue inside string values, so the parse chain is:
 *   JSON.parse → jsonrepair (fixes unescaped quotes/trailing commas) →
 *   retry the model call if repair also fails.
 * Network resilience (429/5xx/timeout retries, concurrency cap) lives in
 * glmChat — this layer only retries STRUCTURAL failures (bad JSON / zod).
 */
export async function chatJson<T>(opts: {
  system: string;
  user: string;
  /** Tag for timeout/error messages, e.g. "AI review". */
  tag: string;
  /** Zod-style validator: parse the raw JSON, throw to trigger a retry. */
  parse: (json: unknown) => T;
  attempts?: number;
}): Promise<T> {
  const attempts = opts.attempts ?? 2;
  const messages = [
    { role: "assistant" as const, content: opts.system },
    { role: "user" as const, content: opts.user },
  ];
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const { text: raw } = await glmChat({ messages, tag: opts.tag, surface: "review" });
      return opts.parse(parseLooseJson(raw));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("AI JSON generation failed");
}
