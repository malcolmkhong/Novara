/**
 * Local statistical heuristics for AI-generated-text detection.
 *
 * This module is intentionally PURE (no server-only imports such as
 * `z-ai-web-dev-sdk`) so that shared types can be safely imported from
 * client components as well. All functions are deterministic.
 */

/** A rich-punctuation char set used for punctuation diversity. */
const PUNCTUATION_MARKS: readonly string[] = [
  "?",
  "!",
  ";",
  ":",
  "—",
  "–",
  "(",
  ")",
  '"',
  "'",
  ",",
  "“",
  "”",
  "‘",
  "…",
];

/**
 * Hallmark AI-assistant phrases (checked case-insensitively as substrings).
 * Overlapping matches are allowed on purpose, e.g. "deep dive into" hits
 * both "deep dive" and "dive into".
 */
const AI_PHRASES: readonly string[] = [
  "delve",
  "tapestry",
  "in conclusion",
  "it's important to note",
  "it is important to note",
  "moreover",
  "furthermore",
  "additionally",
  "it is worth noting",
  "it's worth noting",
  "in today's fast-paced world",
  "navigate the complexities",
  "plays a crucial role",
  "plays a vital role",
  "underscores",
  "testament to",
  "holistic approach",
  "leverage",
  "robust",
  "seamless",
  "unlock the potential",
  "foster",
  "realm of",
  "landscape of",
  "ever-evolving",
  "game-changer",
  "dive into",
  "deep dive",
];

export interface HeuristicResult {
  /** 0-100: variance of sentence lengths, normalized (higher = more human). */
  burstiness: number;
  /** Words per sentence. */
  avgSentenceLength: number;
  /** 0-100: unique words / total words. */
  lexicalDiversity: number;
  aiPhraseCount: number;
  aiPhrasesFound: string[];
  /** Count of consecutive sentences starting with the same first word (beyond the first). */
  repetitiveStarters: number;
  /** 0-100: distribution over ?, !, ;, :, —, (, ), quotes etc. */
  punctuationDiversity: number;
  /** 0-100 composite probability-of-AI from these signals. */
  heuristicScore: number;
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Split text into sentences: cut on runs of `.`, `!`, `?` followed by
 * whitespace or end of string. Simple heuristic — abbreviations like
 * "Dr." will split; that is acceptable for statistical purposes.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+\s*/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Extract the first word (lowercased) of a sentence, or null if none. */
function firstWord(sentence: string): string | null {
  const tokens = sentence.toLowerCase().match(/[a-z0-9']+/g);
  return tokens && tokens.length > 0 ? tokens[0] : null;
}

/** Count word tokens in a string. */
function wordTokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compute deterministic local heuristics that complement the GLM judgment
 * in the AI-detector route.
 */
export function computeHeuristics(text: string): HeuristicResult {
  const trimmed = text.trim();
  const sentences = splitSentences(trimmed);
  const words = wordTokens(trimmed);
  const wordCount = words.length;

  // --- Average sentence length (words per sentence) -----------------------
  const avgSentenceLengthRaw =
    sentences.length > 0 ? wordCount / sentences.length : 0;
  const avgSentenceLength = Math.round(avgSentenceLengthRaw * 10) / 10;

  // --- Burstiness -----------------------------------------------------------
  // Coefficient of variation (stddev / mean) of sentence word counts.
  // Human prose typically sits at CV 0.5-0.9; AI prose at 0.1-0.4.
  // Scale by 125 so a healthy human CV of 0.8 maps to 100.
  // A single sentence carries no variance information -> neutral 50.
  let burstiness = 50;
  if (sentences.length >= 2 && avgSentenceLengthRaw > 0) {
    const lengths = sentences.map((sentence) => wordTokens(sentence).length);
    const mean = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;
    if (mean > 0) {
      const variance =
        lengths.reduce((sum, len) => sum + (len - mean) ** 2, 0) /
        lengths.length;
      const cv = Math.sqrt(variance) / mean;
      burstiness = clamp(Math.round(cv * 125), 0, 100);
    }
  }

  // --- Lexical diversity ----------------------------------------------------
  const lexicalDiversity =
    wordCount > 0
      ? clamp(Math.round((new Set(words).size / wordCount) * 100), 0, 100)
      : 0;

  // --- AI phrase hits ---------------------------------------------------------
  let aiPhraseCount = 0;
  const aiPhrasesFound: string[] = [];
  for (const phrase of AI_PHRASES) {
    const matches = trimmed.match(new RegExp(escapeRegExp(phrase), "gi"));
    if (matches && matches.length > 0) {
      // Every occurrence counts; repeated clichés compound.
      aiPhraseCount += matches.length;
      aiPhrasesFound.push(phrase);
    }
  }

  // --- Repetitive sentence starters -------------------------------------------
  let repetitiveStarters = 0;
  let previousStarter: string | null = null;
  for (const sentence of sentences) {
    const starter = firstWord(sentence);
    if (starter !== null && previousStarter === starter) {
      repetitiveStarters += 1;
    }
    previousStarter = starter;
  }

  // --- Punctuation diversity ----------------------------------------------------
  // Fraction of the rich-punctuation char set that actually appears.
  const presentMarks = PUNCTUATION_MARKS.filter((mark) =>
    trimmed.includes(mark),
  ).length;
  const punctuationDiversity = clamp(
    Math.round((presentMarks / PUNCTUATION_MARKS.length) * 100),
    0,
    100,
  );

  // --- Composite heuristic score -------------------------------------------------
  // Start neutral (50) and push down (more human) / up (more AI):
  //   - burstiness*0.25   : rhythmic variety is strongly human
  //   - punctuation*0.15  : rich punctuation is strongly human
  //   - lexical>75 -> -10 : very high vocabulary variety is human
  //   - +6 per AI phrase  : capped at +30
  //   - +4 per repeat starter: templated rhythm
  //   - +10 if 15-25 words/sentence: the AI "sweet spot" paragraph cadence
  let heuristicScore = 50;
  heuristicScore -= burstiness * 0.25;
  heuristicScore -= punctuationDiversity * 0.15;
  if (lexicalDiversity > 75) {
    heuristicScore -= 10;
  }
  heuristicScore += Math.min(aiPhraseCount * 6, 30);
  heuristicScore += repetitiveStarters * 4;
  if (avgSentenceLengthRaw >= 15 && avgSentenceLengthRaw <= 25) {
    heuristicScore += 10;
  }
  heuristicScore = clamp(Math.round(heuristicScore), 0, 100);

  return {
    burstiness,
    avgSentenceLength,
    lexicalDiversity,
    aiPhraseCount,
    aiPhrasesFound,
    repetitiveStarters,
    punctuationDiversity,
    heuristicScore,
  };
}

/**
 * Robustly extract a JSON value from an LLM response string.
 *
 * - trims the string and strips ```json / ``` markdown fences
 * - falls back to slicing from the first `{` to the last `}`
 * - JSON.parse inside try/catch; returns null on any failure
 */
export function extractJson<T>(raw: string): T | null {
  if (typeof raw !== "string") {
    return null;
  }
  let candidate = raw.trim();

  // Strip a full markdown fence: ```json ... ``` or ``` ... ```
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced && fenced[1] !== undefined) {
    candidate = fenced[1].trim();
  } else if (/^```(?:json)?/i.test(candidate)) {
    // Unterminated fence — just drop the fence markers.
    candidate = candidate
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  }

  const tryParse = (input: string): T | null => {
    try {
      return JSON.parse(input) as T;
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct !== null) {
    return direct;
  }

  // Fallback: slice from the first `{` to the last `}`.
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return tryParse(candidate.slice(first, last + 1));
  }
  return null;
}
