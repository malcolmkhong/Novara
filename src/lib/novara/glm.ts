// ---------------------------------------------------------------------------
// Novara AI — GLM call resilience layer (Phase 6, plan §Phase6 "性能").
//
// ONE wrapper for every GLM chat completion in the codebase (chatJson, draft,
// sediment, agent runtime turns). It adds three code-enforced behaviors the
// raw SDK call lacks:
//   1. transient-error retry with exponential backoff + jitter — 429 rate
//      limits, 5xx gateway errors, timeouts and network drops are classified
//      and retried (budgets.glm.retryAttempts); permanent errors rethrow
//      immediately.
//   2. a global in-flight semaphore (budgets.glm.maxConcurrent) so parallel
//      runs / parallel AI features cannot stampede the provider into 429s.
//   3. uniform empty-response handling — an empty completion is an error,
//      not a silent "".
// Honesty rule: retries are invisible to callers — a returned string is the
// final content; a thrown error is the last error, tagged for the feed.
// ---------------------------------------------------------------------------

import ZAI from "z-ai-web-dev-sdk";
import { withTimeout } from "./api-helpers";
import { getBudgets } from "./content";

export type ChatMessage = { role: "assistant" | "user"; content: string };

const TRANSIENT_RE =
  /429|rate.?limit|quota|too many requests|timeout|timed out|502|503|504|bad gateway|service unavailable|overloaded|econn|enet|ehost|fetch failed|network|socket|premature close/i;

export function isTransientGlmError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return TRANSIENT_RE.test(error.message);
}

// ---------------------------------------------------------------------------
// Global in-flight semaphore — one queue for the whole process.
// ---------------------------------------------------------------------------

let inFlight = 0;
const waiters: (() => void)[] = [];

async function acquireSlot(signal?: AbortSignal): Promise<void> {
  const limit = getBudgets().glm.maxConcurrent;
  if (inFlight < limit) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const take = () => {
      if (signal) signal.removeEventListener("abort", onAbort);
      inFlight += 1;
      resolve();
    };
    const onAbort = () => {
      const i = waiters.indexOf(take);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error("Aborted while waiting for a GLM slot"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    waiters.push(take);
  });
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function glmChat(opts: {
  messages: ChatMessage[];
  /** Tag for timeout/error messages, e.g. "AI review" or "leader turn 2". */
  tag: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const budgets = getBudgets();
  const retries = budgets.glm.retryAttempts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new Error("Aborted before GLM call");
    try {
      await acquireSlot(opts.signal);
      try {
        const zai = await ZAI.create();
        const completion = await withTimeout(
          zai.chat.completions.create({
            messages: opts.messages,
            thinking: { type: "disabled" },
          }),
          opts.timeoutMs ?? budgets.glm.timeoutMs,
          opts.tag
        );
        const content = completion.choices[0]?.message?.content?.trim() ?? "";
        if (!content) throw new Error("The AI returned an empty response");
        return content;
      } finally {
        releaseSlot();
      }
    } catch (error) {
      lastError = error;
      if (opts.signal?.aborted) throw error;
      const retryable = attempt < retries && isTransientGlmError(error);
      if (retryable) {
        const backoff =
          budgets.glm.retryBackoffMs * Math.pow(2, attempt) +
          Math.floor(Math.random() * 400); // jitter
        console.warn(
          `[glm] transient error on "${opts.tag}" (attempt ${attempt + 1}/${retries + 1}) — retrying in ${backoff}ms: ${error instanceof Error ? error.message : error}`
        );
        await sleep(backoff);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`GLM call failed: ${opts.tag}`);
}
