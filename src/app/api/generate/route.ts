import { NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "@/lib/ai/router";
import { AI_TIMEOUT_MS, withTimeout } from "@/lib/ai-heuristics";
import { classifyAiFailure, extractRealUsage } from "@/lib/usage/usage-shapes";
import { recordUsageCall, GATEWAY_DEFAULT_MODEL_ID } from "@/lib/usage/usage-store";
import { beginCharge, callerUid, creditsFromUsage, settleCharge } from "@/lib/credits/charge";

export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Schema & prompts
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  mode: z.enum(["ai-essay", "ai-fiction", "ai-answer"]),
  topic: z.string().max(300).optional(),
  question: z.string().max(2000).optional(),
});

const ESSAY_SYSTEM_PROMPT =
  "You generate realistic sample AI-assistant prose for testing an AI detector. Write 150-220 words of typical polished chatbot-style text about the given topic: smooth generic transitions, balanced paragraphs, hallmark AI phrasing. Output ONLY the text, no preamble.";

const FICTION_SYSTEM_PROMPT =
  "You generate realistic sample AI-assistant FICTION for testing a novel-writing AI detector. Write a 150-220 word fiction scene about the given topic, full of hallmark LLM fiction tells: purple metaphors and over-description, emotional over-narration (naming feelings instead of showing them), dialogue tags with adverbs ('she said softly'), em-dashes, trailing participial phrases (', turning toward her'), tricolon rhythm, and stock phrases like 'couldn't help but', 'something shifted', 'a mixture of awe and fear', 'the air hung heavy'. Output ONLY the scene text, no preamble.";

const ANSWER_SYSTEM_PROMPT = "You are a helpful, confident assistant.";

// ---------------------------------------------------------------------------
// AI plumbing (server-side only)
// ---------------------------------------------------------------------------

interface AiMessage {
  role: "assistant" | "user";
  content: string;
}

/** Pull the plain-text reply out of an untyped SDK completion payload. */
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

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          parsedBody.error.issues[0]?.message ??
          "Invalid body: provide `mode` ('ai-essay' | 'ai-fiction' | 'ai-answer') plus optional `topic` / `question`.",
      },
      { status: 400 },
    );
  }

  const { mode, topic, question } = parsedBody.data;

  // ---- SPEND GATE (Step 55) -------------------------------------------
  // The credits are reserved BEFORE the provider is called, so an
  // unaffordable request never reaches the model and never costs money.
  const uid = callerUid(req);
  if (!uid) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const charge = await beginCharge(uid, "generate", { refId: mode, note: "generate" });
  if (!charge.ok) {
    if (charge.reason === "kill-switch") {
      // The world spend for the day is over the cap: all non-admin AI spend
      // stops until the next reset.
      return NextResponse.json({ error: "globally_paused" }, { status: 429 });
    }
    return NextResponse.json(
      {
        error: "insufficient_credits",
        need: charge.need ?? 0,
        balance: charge.balance ?? 0,
        resetAt: charge.resetAt ?? null,
      },
      { status: 402 },
    );
  }
  // ----------------------------------------------------------------------

  let messages: AiMessage[];
  if (mode === "ai-essay") {
    messages = [
      { role: "assistant", content: ESSAY_SYSTEM_PROMPT },
      {
        role: "user",
        content: topic && topic.trim().length > 0 ? topic : "the benefits of remote work",
      },
    ];
  } else if (mode === "ai-fiction") {
    messages = [
      { role: "assistant", content: FICTION_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          topic && topic.trim().length > 0
            ? topic
            : "a lighthouse keeper discovers a mysterious door",
      },
    ];
  } else {
    // ai-answer mode is pointless without a question to answer.
    if (!question || question.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "`question` is required for mode 'ai-answer'." },
        { status: 400 },
      );
    }
    messages = [
      { role: "assistant", content: ANSWER_SYSTEM_PROMPT },
      { role: "user", content: question },
    ];
  }

  // Policy F (P5-b): ZAI.create() failing below is a PRE-SEND failure — no
  // row (F3). A sent attempt with no completion payload records one zero-token
  // failed row (F1); a completion without usage records nothing (F4).
  let sent = false;
  let completion: unknown = null;
  let providerError: unknown = null;
  try {
    const zai = await ZAI.create();
    sent = true;
    completion = await withTimeout(
      zai.chat.completions.create({
        messages,
        thinking: { type: "disabled" },
      }),
      AI_TIMEOUT_MS,
      "[generate] AI request",
    );
  } catch (error) {
    providerError = error;
  }

  if (providerError) {
    if (sent) {
      recordUsageCall({
        surface: "generate",
        usage: null,
        status: "failed",
        errorKind: classifyAiFailure(providerError),
      });
    }
    // A failed call is NOT charged: the whole hold comes back (0 tokens).
    try {
      await settleCharge(uid, charge.hold, 0, { refId: mode, note: "call failed — hold refunded" });
    } catch (settleError) {
      console.error("[generate] settle failed:", settleError);
    }
    console.error("[generate] AI request failed:", providerError);
    return NextResponse.json(
      {
        success: false,
        error:
          "AI is busy or took too long to respond. Please try again in a moment.",
      },
      { status: 502 },
    );
  }

  // Persist the per-call row (standalone detector tool — global-only,
  // never culminates in a novel). Measured even when the content check
  // below fails — the provider billed what it billed.
  const usage = extractRealUsage(completion);
  recordUsageCall({ surface: "generate", usage });

  // ---- SPEND GATE: settle the reservation against the MEASURED cost -----
  // The tokens used here are exactly the ones recorded in UsageCall. This
  // route sends no model field, so the request-side id is
  // "gateway-default" — the price comes from the DEFAULT model's row and
  // the ledger row is tagged "priced-by-fallback" (an unpriced call is
  // never free). With no usage object at all the cost is unknown: the hold
  // stands (no refund).
  const charged = usage
    ? creditsFromUsage(GATEWAY_DEFAULT_MODEL_ID, usage.promptTokens, usage.completionTokens)
    : null;
  try {
    await settleCharge(uid, charge.hold, charged ? charged.credits : charge.hold, {
      refId: mode,
      note: charged?.note ?? "no usage reported — the hold stands",
    });
  } catch (settleError) {
    console.error("[generate] settle failed:", settleError);
  }
  // -----------------------------------------------------------------------

  const text = extractCompletionContent(completion);
  if (text === null || text.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: "AI returned an empty response." },
      { status: 502 },
    );
  }
  return NextResponse.json({
    success: true,
    text: text.trim(),
    model: "AI",
  });
}
