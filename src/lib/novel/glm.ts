/**
 * Server-side GLM plumbing for the Novel Creator.
 *
 * Two call styles:
 *  - glmJson: bounded non-streaming call for structured JSON (init/plan/
 *    sediment/review). Output stays compact so the whole exchange fits in
 *    the ~60s gateway budget; one automatic retry on parse failure.
 *  - streamGlmProse: streaming call for chapter prose. The SDK's
 *    `stream: true` returns raw SSE byte fragments; we decode + parse them
 *    ourselves. Streaming keeps bytes flowing so long generations are immune
 *    to idle-proxy cutoffs, and the UI can render the chapter live.
 *
 * "z-ai-web-dev-sdk" is backend-only — never import this from a client
 * component.
 */
import ZAI from "z-ai-web-dev-sdk";

import { withTimeout } from "@/lib/ai-heuristics";

export interface GlmMessage {
  role: "assistant" | "user";
  content: string;
}

const GLM_JSON_TIMEOUT_MS = 60_000;

/** Common schema keys used to repair GLM's merged-key corruption. */
const KNOWN_KEYS =
  "title|logline|coreConflict|world|power|goldenFinger|themes|characters|" +
  "villain|volumes|beats|chapters|summary|facts|charStates|foreshadows|" +
  "overallScore|dimensions|blocking|suggestions|consistencyFlags|number|" +
  "index|name|role|desire|flaw|arc|goal|timeAnchor|mustCover|endHook|phase|" +
  "action|ref|note|score|comment|issue|fix|change|startChapter|endChapter";

/**
 * Best-effort repair of GLM's known JSON corruption patterns:
 *  1. smart quotes → ASCII quotes
 *  2. trailing commas before } or ]
 *  3. merged key+value strings ("name苏晴" — the model drops `":"`) for
 *     known schema keys. The lookahead only fires when the quoted token is
 *     NOT followed by `:`, so legitimate keys are never touched.
 */
export function repairJson(raw: string): string {
  let text = raw.trim();
  text = text.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (/^```/.test(text)) {
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  }
  text = text.replace(/,\s*([}\]])/g, "$1");
  text = text.replace(
    new RegExp(`"(${KNOWN_KEYS})([^":{}\\[\\],]*)"(?!\\s*:)`, "g"),
    '"$1":"$2"',
  );
  return text;
}

/** Extract the plain-text reply from an untyped SDK completion payload. */
function extractCompletionContent(completion: unknown): string | null {
  if (typeof completion !== "object" || completion === null) return null;
  const choices = (completion as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

interface GlmJsonOptions<T> {
  /** Label used in logs. */
  label: string;
  /**
   * Domain parser: validates shape defensively and returns null when the
   * payload is unusable. Receives the raw reply untouched; parsers apply
   * extractJson/repairJson internally.
   */
  parse: (raw: string) => T | null;
}

/**
 * Non-streaming GLM call with a domain parse function. Attempts:
 * generate → parse twice, then one GLM self-repair round-trip showing the
 * model its own broken output. First successful parse wins; null on total
 * failure. Never throws.
 */
export async function glmJson<T>(
  messages: GlmMessage[],
  options: GlmJsonOptions<T>,
): Promise<T | null> {
  const generate = async (msgs: GlmMessage[]): Promise<string | null> => {
    const zai = await ZAI.create();
    const completion: unknown = await withTimeout(
      zai.chat.completions.create({
        messages: msgs,
        thinking: { type: "disabled" },
      }),
      GLM_JSON_TIMEOUT_MS,
      `[novel/${options.label}]`,
    );
    return extractCompletionContent(completion);
  };

  let lastRaw: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await generate(messages);
      const parsed = raw === null ? null : options.parse(raw);
      if (parsed !== null) return parsed;
      lastRaw = raw;
      console.warn(
        `[novel/${options.label}] parse failed on attempt ${attempt + 1}`,
      );
    } catch (error) {
      console.error(`[novel/${options.label}] attempt ${attempt + 1} failed:`, error);
    }
  }

  // One self-repair round-trip: show the model its own broken JSON and ask
  // for a syntax-only fix.
  if (lastRaw !== null) {
    try {
      const capped =
        lastRaw.length > 4000 ? `${lastRaw.slice(0, 4000)}…` : lastRaw;
      const repairMessages: GlmMessage[] = [
        ...messages,
        {
          role: "user",
          content: `你上面输出的 JSON 存在语法错误，无法解析。请只修复语法（不要改动内容、不要解释），重新输出完整合法的 JSON 对象。原文：\n${capped}`,
        },
      ];
      const fixedRaw = await generate(repairMessages);
      const parsed = fixedRaw === null ? null : options.parse(fixedRaw);
      if (parsed !== null) return parsed;
      console.warn(`[novel/${options.label}] GLM self-repair failed`);
    } catch (error) {
      console.error(`[novel/${options.label}] self-repair failed:`, error);
    }
  }
  return null;
}

export interface StreamCallbacks {
  /** Called for each decoded prose delta. */
  onDelta: (text: string) => void;
}

export interface StreamOutcome {
  /** Full accumulated prose (or whatever arrived before failure). */
  text: string;
  /** True if the GLM stream completed normally ([DONE] received). */
  completed: boolean;
  /** Error message when completed === false. */
  error?: string;
}

const CHUNK_STALL_MS = 45_000;
const OVERALL_STREAM_MS = 150_000;

/** Normalize an SDK stream chunk (numeric-key object or Uint8Array) to bytes. */
function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw)) {
    const values = raw.filter((n): n is number => typeof n === "number");
    if (values.length === raw.length) return new Uint8Array(values);
  }
  if (typeof raw === "object" && raw !== null) {
    const values = Object.values(raw as Record<string, unknown>);
    if (values.length > 0 && values.every((n) => typeof n === "number")) {
      return new Uint8Array(values as number[]);
    }
  }
  return null;
}

/**
 * Streaming GLM call for chapter prose. Parses the SDK's raw SSE byte
 * fragments (data: {...} lines) and forwards content deltas. Enforces a
 * stall watchdog (no bytes for 45s) and an overall cap (150s). Never throws.
 */
export async function streamGlmProse(
  messages: GlmMessage[],
  callbacks: StreamCallbacks,
): Promise<StreamOutcome> {
  let full = "";
  const controller = new AbortController();
  const overallTimer = setTimeout(() => controller.abort(), OVERALL_STREAM_MS);
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), CHUNK_STALL_MS);
  };

  try {
    const zai = await ZAI.create();
    resetStall();
    const stream = (await zai.chat.completions.create({
      messages,
      thinking: { type: "disabled" },
      stream: true,
      signal: controller.signal,
    } as never)) as AsyncIterable<unknown>;

    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;

    for await (const raw of stream) {
      resetStall();
      const bytes = toBytes(raw);
      if (!bytes) continue;
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          completed = true;
          continue;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            callbacks.onDelta(delta);
          }
        } catch {
          // JSON spanning chunk boundaries — reassembled via remaining lines.
        }
      }
      if (completed) break;
    }

    return { text: full, completed };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      text: full,
      completed: false,
      error: aborted
        ? `Generation stopped early (${aborted && full.length === 0 ? "no output" : "watchdog timeout"}).`
        : error instanceof Error
          ? error.message
          : "Unknown streaming error.",
    };
  } finally {
    clearTimeout(overallTimer);
    if (stallTimer) clearTimeout(stallTimer);
  }
}

/**
 * Defensive string helper: coerce unknown GLM output into a trimmed
 * non-empty string, else null.
 */
export function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Coerce unknown into a bounded string array (drops empties, caps length). */
export function asStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const str = asString(item);
    if (str !== null) out.push(str);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Clamp helper (kept local to avoid coupling to detector heuristics). */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
