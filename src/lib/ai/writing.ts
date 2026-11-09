/**
 * Server-side AI plumbing for the Novel Creator.
 *
 * Two call styles:
 *  - completeJson: bounded non-streaming call for structured JSON (init/plan/
 *    sediment/review). Output stays compact so the whole exchange fits in
 *    the ~60s gateway budget; one automatic retry on parse failure.
 *  - streamProse: streaming call for chapter prose. The SDK's
 *    `stream: true` returns raw SSE byte fragments; we decode + parse them
 *    ourselves. Streaming keeps bytes flowing so long generations are immune
 *    to idle-proxy cutoffs, and the UI can render the chapter live.
 *
 * "the provider SDK" is backend-only — never import this from a client
 * component.
 */
import ZAI from "@/lib/ai/router";

import { withTimeout } from "@/lib/ai-heuristics";
import {
  classifyAiFailure,
  extractRealUsage,
} from "@/lib/usage/usage-shapes";
import { recordUsageCall, type UsageCallScope } from "@/lib/usage/usage-store";

export interface AiMessage {
  role: "assistant" | "user";
  content: string;
}

const AI_JSON_TIMEOUT_MS = 60_000;

/** Common schema keys used to repair AI's merged-key corruption. */
const KNOWN_KEYS =
  "title|logline|coreConflict|world|power|goldenFinger|themes|characters|" +
  "villain|volumes|beats|chapters|summary|facts|charStates|foreshadows|" +
  "overallScore|dimensions|blocking|suggestions|consistencyFlags|number|" +
  "index|name|role|desire|flaw|arc|goal|timeAnchor|mustCover|endHook|phase|" +
  "action|ref|note|score|comment|issue|fix|change|startChapter|endChapter";

/**
 * Best-effort repair of AI's known JSON corruption patterns:
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

interface JsonOptions<T> {
  /** Label used in logs. */
  label: string;
  /**
   * Domain parser: validates shape defensively and returns null when the
   * payload is unusable. Receives the raw reply untouched; parsers apply
   * extractJson/repairJson internally.
   */
  parse: (raw: string) => T | null;
  /**
   * P5 — persisted-ledger scope links. Pre-creation init passes a
   * correlationId (retro-tagged at novel creation); novel-scoped routes pass
   * novelId directly.
   */
  ledger?: UsageCallScope;
}

/**
 * Non-streaming AI call with a domain parse function. Attempts:
 * generate → parse twice, then one AI self-repair round-trip showing the
 * model its own broken output. First successful parse wins; null on total
 * failure. Never throws.
 */
export async function completeJson<T>(
  messages: AiMessage[],
  options: JsonOptions<T>,
): Promise<T | null> {
  const generate = async (msgs: AiMessage[]): Promise<string | null> => {
    const zai = await ZAI.create();
    // Policy F (P5-b): one row per HTTP attempt. ZAI.create() above failing
    // is a PRE-SEND failure — it throws before any provider contact, no row
    // (F3). Everything below runs once per parse-retry/self-repair call.
    try {
      const completion: unknown = await withTimeout(
        zai.chat.completions.create({
          messages: msgs,
          thinking: { type: "disabled" },
        }),
        AI_JSON_TIMEOUT_MS,
        `[novel/${options.label}]`,
      );
      // Measured row when the provider returned usage (billed truth — even
      // if the content extraction below fails); no usage object ⇒ no row (F4).
      recordUsageCall({
        surface: "studio",
        usage: extractRealUsage(completion),
        ...options.ledger,
      });
      return extractCompletionContent(completion);
    } catch (error) {
      // F1 — sent but no completion payload at our boundary: one zero-token
      // failed row under the same scope. The outer parse-retry loop calls
      // generate() again — that next HTTP attempt gets its own row.
      recordUsageCall({
        surface: "studio",
        usage: null,
        status: "failed",
        errorKind: classifyAiFailure(error),
        ...options.ledger,
      });
      throw error;
    }
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
      const repairMessages: AiMessage[] = [
        ...messages,
        {
          role: "user",
          content: `你上面输出的 JSON 存在语法错误，无法解析。请只修复语法（不要改动内容、不要解释），重新输出完整合法的 JSON 对象。原文：\n${capped}`,
        },
      ];
      const fixedRaw = await generate(repairMessages);
      const parsed = fixedRaw === null ? null : options.parse(fixedRaw);
      if (parsed !== null) return parsed;
      console.warn(`[novel/${options.label}] AI self-repair failed`);
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
  /** True if the AI stream completed normally ([DONE] received). */
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
 * Streaming AI call for chapter prose. Parses the SDK's raw SSE byte
 * fragments (data: {...} lines) and forwards content deltas. Enforces a
 * stall watchdog (no bytes for 45s) and an overall cap (150s). Never throws.
 */
export async function streamProse(
  messages: AiMessage[],
  callbacks: StreamCallbacks,
  /** P5 — persisted-ledger scope links (novel-scoped write route). */
  ledger?: UsageCallScope,
): Promise<StreamOutcome> {
  let full = "";
  const controller = new AbortController();
  const overallTimer = setTimeout(() => controller.abort(), OVERALL_STREAM_MS);
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const resetStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), CHUNK_STALL_MS);
  };

  // Policy F (P5-b) attempt markers:
  //   sent     = the stream request was handed to the provider (init done)
  //   recorded = a row (measured OR failed) already written this attempt
  //   streamUsage = the usage chunk, when the provider sent one
  // F3: ZAI.create() throwing before `sent` = pre-send failure, NO row.
  // F1: sent && no completion payload ⇒ one zero-token failed row.
  // F4: [DONE] received without a usage chunk ⇒ rowless (tokens unknowable).
  let sent = false;
  let recorded = false;
  let streamUsage: ReturnType<typeof extractRealUsage> = null;

  try {
    const zai = await ZAI.create();
    resetStall();
    sent = true;
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
          if (!streamUsage) streamUsage = extractRealUsage(json);
        } catch {
          // JSON spanning chunk boundaries — reassembled via remaining lines.
        }
      }
      if (completed) break;
    }

    // Billed truth: a usage chunk (usually the final one) ⇒ measured row,
    // regardless of whether [DONE] made it (F1's "no completion payload"
    // does not apply once usage arrived — the provider billed real tokens
    // and we measured them). [DONE] without any usage chunk ⇒ rowless (F4).
    if (streamUsage) {
      recordUsageCall({ surface: "studio", usage: streamUsage, ...ledger });
      recorded = true;
    } else if (!completed) {
      // Stream ended without [DONE] and without usage: no completion payload
      // at our boundary — one zero-token failed row (F1; kind "timeout" —
      // the only silent path here is the watchdog/stall cutoff).
      recordUsageCall({
        surface: "studio",
        usage: null,
        status: "failed",
        errorKind: "timeout",
        ...ledger,
      });
      recorded = true;
    }
    return { text: full, completed };
  } catch (error) {
    const aborted = controller.signal.aborted;
    if (sent && !recorded) {
      if (streamUsage) {
        // Transport died AFTER the usage chunk arrived: billed truth stands.
        recordUsageCall({ surface: "studio", usage: streamUsage, ...ledger });
      } else {
        // F1 — no completion payload: one zero-token failed row.
        recordUsageCall({
          surface: "studio",
          usage: null,
          status: "failed",
          errorKind: aborted ? "aborted" : classifyAiFailure(error),
          ...ledger,
        });
      }
    }
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
 * Defensive string helper: coerce unknown AI output into a trimmed
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
