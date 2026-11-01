/**
 * Shared TypeScript contracts for the TruthLab detector frontend.
 * These mirror the backend API responses consumed by both panels.
 */

/* ---------- Shared primitives ---------- */

export type Severity = "high" | "medium" | "low" | "info";

export type AIVerdict = "ai" | "human" | "mixed" | "uncertain";

export type ClaimStatus =
  | "supported"
  | "unsupported"
  | "contradicted"
  | "unverifiable";

export type RiskLevel = "low" | "medium" | "high";

export type CheckMode = "open-domain" | "grounded";

export type TextType = "novel" | "general";

export interface ApiFailure {
  success: false;
  error: string;
}

/* ---------- POST /api/detect/ai ---------- */

export interface AISignal {
  label: string;
  description: string;
  severity: Severity;
}

export interface SentenceScore {
  text: string;
  aiLikelihood: number;
  note?: string;
}

export interface FictionHeuristics {
  /** Em/en dashes per 1000 characters. */
  emDashDensity: number;
  /** Dialogue tags with an adverb ("said softly"). */
  dialogueAdverbTags: number;
  /** ", <word>ing" participial phrases per 1000 characters. */
  participialDensity: number;
}

export interface AIHeuristics {
  burstiness: number;
  avgSentenceLength: number;
  lexicalDiversity: number;
  aiPhraseCount: number;
  aiPhrasesFound: string[];
  repetitiveStarters: number;
  punctuationDiversity: number;
  heuristicScore: number;
  /** Present only for novel/fiction analysis. */
  fiction?: FictionHeuristics;
}

export interface AIDetectSuccess {
  success: true;
  verdict: AIVerdict;
  aiScore: number;
  glmScore: number;
  confidence: number;
  summary: string;
  signals: AISignal[];
  sentences: SentenceScore[];
  heuristics: AIHeuristics;
  textType: TextType;
  model: string;
}

export type AIDetectResponse = AIDetectSuccess | ApiFailure;

/* ---------- POST /api/detect/hallucination ---------- */

export interface ClaimResult {
  claim: string;
  status: ClaimStatus;
  explanation: string;
  confidence: number;
}

export interface HallucinationSuccess {
  success: true;
  hallucinationScore: number;
  riskLevel: RiskLevel;
  summary: string;
  claims: ClaimResult[];
  checkedWith: string;
  mode: CheckMode;
}

export type HallucinationResponse = HallucinationSuccess | ApiFailure;

/* ---------- POST /api/generate ---------- */

export interface GenerateSuccess {
  success: true;
  text: string;
  model: string;
}

export type GenerateResponse = GenerateSuccess | ApiFailure;
