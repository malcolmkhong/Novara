import { NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { classifyGlmFailure, extractRealUsage } from "@/lib/usage/usage-shapes";
import { recordUsageCall } from "@/lib/usage/usage-store";
import {
  capForGlm,
  clamp,
  extractJson,
  GLM_TIMEOUT_MS,
  withTimeout,
} from "@/lib/ai-heuristics";

export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Schema & prompts
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  text: z.string().min(1).max(20000),
  source: z.string().max(20000).optional(),
  question: z.string().max(2000).optional(),
});

const JSON_SHAPE_INSTRUCTION = `Respond with ONLY valid JSON, no fences: {"hallucinationScore": <0-100, 0 = fully factual, 100 = mostly fabricated>, "riskLevel": "low"|"medium"|"high", "summary": "<2-3 sentences>", "claims": [{"claim": "...", "status": "supported"|"unsupported"|"contradicted"|"unverifiable", "explanation": "<1-2 sentences with your reasoning>", "confidence": <0-100>}]}. If there are no checkable claims, return an empty claims array and a low score.`;

const OPEN_DOMAIN_SYSTEM_PROMPT = `You are a rigorous fact-checking analyst detecting hallucinations in an AI-generated answer. Extract the most significant checkable factual claims (up to 20) about dates, numbers, names, events, quotes, statistics, attributions and causal statements. Verify each against your own knowledge. Classify each claim as: "supported" (well-established true), "unsupported" (likely false or no evidence exists), "contradicted" (known false), "unverifiable" (subjective, obscure, or insufficient data). ${JSON_SHAPE_INSTRUCTION}`;

const GROUNDED_SYSTEM_PROMPT = `You are a rigorous fact-checking analyst detecting hallucinations in an AI-generated answer. Extract the most significant checkable factual claims (up to 20) about dates, numbers, names, events, quotes, statistics, attributions and causal statements. Verify each claim STRICTLY against the provided source document. Classify each claim as: "supported" (directly stated or entailed by the source), "unsupported" (not present in the source; invented), "contradicted" (contradicts the source), "unverifiable" (the source does not cover it). The hallucinationScore (0-100) expresses the degree of (un)grounding: 0 means every claim is grounded in the source, 100 means most claims are fabricated or absent from the source. ${JSON_SHAPE_INSTRUCTION}`;

// ---------------------------------------------------------------------------
// Types (GLM output is untrusted — validated defensively below)
// ---------------------------------------------------------------------------

type ClaimStatus = "supported" | "unsupported" | "contradicted" | "unverifiable";
type RiskLevel = "low" | "medium" | "high";
type DetectionMode = "open-domain" | "grounded";

const STATUSES: readonly ClaimStatus[] = [
  "supported",
  "unsupported",
  "contradicted",
  "unverifiable",
];

interface CheckedClaim {
  claim: string;
  status: ClaimStatus;
  explanation: string;
  confidence: number;
}

interface GlmHallucinationAnalysis {
  hallucinationScore: number; // required — without it the parse is considered failed
  summary: string;
  claims: CheckedClaim[];
}

// ---------------------------------------------------------------------------
// GLM plumbing (server-side only)
// ---------------------------------------------------------------------------

interface GlmMessage {
  role: "assistant" | "user";
  content: string;
}

function buildMessages(
  mode: DetectionMode,
  text: string,
  source: string | undefined,
  question: string | undefined,
  forceJson: boolean,
): GlmMessage[] {
  const parts: string[] = [];
  parts.push(
    `QUESTION (if any):\n${
      question && question.trim().length > 0 ? question : "(none)"
    }`,
  );
  if (mode === "grounded" && source !== undefined) {
    parts.push(`SOURCE DOCUMENT:\n${source}`);
  }
  parts.push(`ANSWER TO CHECK:\n${text}`);
  let userContent = parts.join("\n\n");
  if (forceJson) {
    userContent += "\n\nReturn only the JSON object.";
  }
  return [
    {
      role: "assistant",
      content: mode === "grounded" ? GROUNDED_SYSTEM_PROMPT : OPEN_DOMAIN_SYSTEM_PROMPT,
    },
    { role: "user", content: userContent },
  ];
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

/**
 * One GLM request. Returns the reply text, or null on ANY failure
 * (transport error, empty content, unexpected shape). Never throws.
 */
async function requestGlmText(messages: GlmMessage[]): Promise<string | null> {
  // Policy F (P5-b): ZAI.create() failing below is a PRE-SEND failure — no
  // row (F3). A sent attempt that produces no completion payload records one
  // zero-token failed row (F1); a completion without usage records nothing (F4).
  let sent = false;
  try {
    const zai = await ZAI.create();
    sent = true;
    const completion: unknown = await zai.chat.completions.create({
      messages,
      thinking: { type: "disabled" },
    });
    // Persist the per-call row (standalone detector — global-only).
    recordUsageCall({ surface: "detect", usage: extractRealUsage(completion) });
    return extractCompletionContent(completion);
  } catch (error) {
    if (sent) {
      recordUsageCall({
        surface: "detect",
        usage: null,
        status: "failed",
        errorKind: classifyGlmFailure(error),
      });
    }
    console.error("[detect/hallucination] GLM request failed:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Defensive parsing of GLM JSON
// ---------------------------------------------------------------------------

function mapClaim(value: unknown): CheckedClaim | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const claim = typeof record.claim === "string" ? record.claim.trim() : "";
  if (!claim) return null;
  const status: ClaimStatus =
    typeof record.status === "string" &&
    (STATUSES as readonly string[]).includes(record.status)
      ? (record.status as ClaimStatus)
      : "unverifiable";
  const explanation =
    typeof record.explanation === "string" ? record.explanation.trim() : "";
  const confidence =
    typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? clamp(Math.round(record.confidence), 0, 100)
      : 0;
  return { claim, status, explanation, confidence };
}

function parseGlmAnalysis(raw: string): GlmHallucinationAnalysis | null {
  const parsed: unknown = extractJson(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;

  // `hallucinationScore` cannot be synthesized — missing/invalid = failed parse.
  if (
    typeof record.hallucinationScore !== "number" ||
    !Number.isFinite(record.hallucinationScore)
  ) {
    return null;
  }

  const claims = Array.isArray(record.claims)
    ? record.claims
        .map(mapClaim)
        .filter((claim): claim is CheckedClaim => claim !== null)
    : [];

  return {
    hallucinationScore: clamp(Math.round(record.hallucinationScore), 0, 100),
    summary: typeof record.summary === "string" ? record.summary : "",
    claims,
  };
}

/** Canonical risk bands: low <35, medium 35-64, high >=65. */
function deriveRiskLevel(hallucinationScore: number): RiskLevel {
  if (hallucinationScore < 35) return "low";
  if (hallucinationScore < 65) return "medium";
  return "high";
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
          "Invalid body: provide `text` (1-20000 chars), optional `source` (<=20000 chars) and `question` (<=2000 chars).",
      },
      { status: 400 },
    );
  }

  const { text } = parsedBody.data;
  // Grounded mode requires a usable (non-blank) source document.
  const mode: DetectionMode =
    typeof parsedBody.data.source === "string" &&
    parsedBody.data.source.trim().length > 0
      ? "grounded"
      : "open-domain";
  const source = mode === "grounded" ? parsedBody.data.source : undefined;

  // GLM gets a bounded excerpt of both answer and source so the prompt and
  // the JSON it must return stay small and the call finishes well within
  // upstream proxy timeouts. Nothing else changes semantically.
  const glmText = capForGlm(text);
  const glmSource =
    mode === "grounded" && source !== undefined
      ? capForGlm(source)
      : undefined;

  try {
    let raw = await withTimeout(
      requestGlmText(
        buildMessages(mode, glmText, glmSource, parsedBody.data.question, false),
      ),
      GLM_TIMEOUT_MS,
      "[detect/hallucination] first GLM attempt",
    );
    let analysis = raw === null ? null : parseGlmAnalysis(raw);

    // Retry ONCE with an explicit JSON-only instruction before giving up.
    if (analysis === null) {
      raw = await withTimeout(
        requestGlmText(
          buildMessages(mode, glmText, glmSource, parsedBody.data.question, true),
        ),
        GLM_TIMEOUT_MS,
        "[detect/hallucination] retry GLM attempt",
      );
      analysis = raw === null ? null : parseGlmAnalysis(raw);
    }

    if (analysis === null) {
      return NextResponse.json(
        {
          success: false,
          error:
            "GLM could not finish the fact-check in time. Please try again — shorter text checks faster.",
        },
        { status: 502 },
      );
    }

    // Clamp the score and recompute riskLevel from it, so the pair is always
    // internally consistent (low <35, medium 35-64, high >=65).
    const hallucinationScore = clamp(analysis.hallucinationScore, 0, 100);
    const riskLevel = deriveRiskLevel(hallucinationScore);

    return NextResponse.json({
      success: true,
      hallucinationScore,
      riskLevel,
      summary: analysis.summary,
      claims: analysis.claims,
      checkedWith: "GLM",
      mode,
    });
  } catch (error) {
    console.error("[detect/hallucination] unexpected failure:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error while checking for hallucinations.",
      },
      { status: 500 },
    );
  }
}
