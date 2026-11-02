import ZAI from "z-ai-web-dev-sdk";
import { jsonrepair } from "jsonrepair";
import { withTimeout } from "@/lib/novara/api-helpers";
import { getBudgets } from "@/lib/novara/content";

// Budget single-source: timeout lives in agent/config/budgets.yaml (glm.timeoutMs).
const glmTimeoutMs = () => getBudgets().glm.timeoutMs;

/**
 * GLM JSON helper: asks the model for a strict JSON object, then parses and
 * validates it. GLM routinely breaks JSON by embedding unescaped quotes from
 * chapter dialogue inside string values, so the parse chain is:
 *   JSON.parse → jsonrepair (fixes unescaped quotes/trailing commas) →
 *   retry the model call if repair also fails.
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
  const zai = await ZAI.create();
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const completion = await withTimeout(
        zai.chat.completions.create({
          messages: [
            { role: "assistant", content: opts.system },
            { role: "user", content: opts.user },
          ],
          thinking: { type: "disabled" },
        }),
        glmTimeoutMs(),
        opts.tag
      );
      const raw = completion.choices[0]?.message?.content?.trim() ?? "";
      if (!raw) {
        lastError = new Error("The AI returned an empty response");
        continue;
      }
      return opts.parse(parseLooseJson(raw));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("AI JSON generation failed");
}

/** Extracts the first JSON object/array from model output (tolerates fences). */
export function parseLooseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in AI output");
  const slice = candidate.slice(start).trim();

  try {
    return JSON.parse(slice);
  } catch {
    // Repair pass: fixes unescaped quotes, trailing commas, etc.
    const repaired = jsonrepair(slice);
    return JSON.parse(repaired);
  }
}
