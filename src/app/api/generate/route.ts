import { NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { GLM_TIMEOUT_MS, withTimeout } from "@/lib/ai-heuristics";
import { extractRealUsage, recordGlobalUsage } from "@/lib/usage/ledger";
import { recordUsageCall } from "@/lib/usage/usage-store";

export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Schema & prompts
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  mode: z.enum(["ai-essay", "ai-fiction", "glm-answer"]),
  topic: z.string().max(300).optional(),
  question: z.string().max(2000).optional(),
});

const ESSAY_SYSTEM_PROMPT =
  "You generate realistic sample AI-assistant prose for testing an AI detector. Write 150-220 words of typical polished chatbot-style text about the given topic: smooth generic transitions, balanced paragraphs, hallmark AI phrasing. Output ONLY the text, no preamble.";

const FICTION_SYSTEM_PROMPT =
  "You generate realistic sample AI-assistant FICTION for testing a novel-writing AI detector. Write a 150-220 word fiction scene about the given topic, full of hallmark LLM fiction tells: purple metaphors and over-description, emotional over-narration (naming feelings instead of showing them), dialogue tags with adverbs ('she said softly'), em-dashes, trailing participial phrases (', turning toward her'), tricolon rhythm, and stock phrases like 'couldn't help but', 'something shifted', 'a mixture of awe and fear', 'the air hung heavy'. Output ONLY the scene text, no preamble.";

const ANSWER_SYSTEM_PROMPT = "You are a helpful, confident assistant.";

// ---------------------------------------------------------------------------
// GLM plumbing (server-side only)
// ---------------------------------------------------------------------------

interface GlmMessage {
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
          "Invalid body: provide `mode` ('ai-essay' | 'ai-fiction' | 'glm-answer') plus optional `topic` / `question`.",
      },
      { status: 400 },
    );
  }

  const { mode, topic, question } = parsedBody.data;

  let messages: GlmMessage[];
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
    // glm-answer mode is pointless without a question to answer.
    if (!question || question.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "`question` is required for mode 'glm-answer'." },
        { status: 400 },
      );
    }
    messages = [
      { role: "assistant", content: ANSWER_SYSTEM_PROMPT },
      { role: "user", content: question },
    ];
  }

  try {
    const zai = await ZAI.create();
    const completion: unknown = await withTimeout(
      zai.chat.completions.create({
        messages,
        thinking: { type: "disabled" },
      }),
      GLM_TIMEOUT_MS,
      "[generate] GLM request",
    );
    // P4 — feed the app-wide usage ledger (measured calls only).
    const usage = extractRealUsage(completion);
    recordGlobalUsage("generate", usage);
    // P5 — persist the per-call row (standalone detector tool — global-only,
    // never culminates in a novel).
    recordUsageCall({ surface: "generate", usage });
    const text = extractCompletionContent(completion);
    if (text === null || text.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "GLM returned an empty response." },
        { status: 502 },
      );
    }
    return NextResponse.json({
      success: true,
      text: text.trim(),
      model: "GLM",
    });
  } catch (error) {
    console.error("[generate] GLM request failed:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          "GLM is busy or took too long to respond. Please try again in a moment.",
      },
      { status: 502 },
    );
  }
}
