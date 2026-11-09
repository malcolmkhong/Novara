// ---------------------------------------------------------------------------
// Novara AI — THE ONLY place model ids, prices and context windows are defined.
//
// CONFIGURATION, NOT MEASUREMENT. Nothing below was verified against a live
// endpoint (Step 5's probe returned no 200) or a fetched pricing page. Every
// wireModel, price and context window is env-overridable; the literal defaults
// are provisional and MUST be confirmed before any user-visible ESTIMATE is
// trusted. Do not add a model id / price / context window to any other file.
// ---------------------------------------------------------------------------

import type { ModelDef, ProviderId, Tier } from "./types";
import { readEnv } from "./http";

interface Seed {
  provider: ProviderId;
  tier: Tier;
  label: string;
  vendor: string;
  /** Env var holding this model's provider-facing wire id. */
  wireEnv: string;
  /** Provisional default; override with wireEnv. */
  wire: string;
  contextWindow: number;
  maxOutputTokens: number;
  writingScore: 1 | 2 | 3 | 4 | 5;
  inputUsdPer1M: number;
  cachedInputUsdPer1M: number | null;
  outputUsdPer1M: number;
  supportsStreaming: boolean;
  authMode: "adc" | "apiKey";
  envKeyName: string;
}

export const PROVIDER_IDS: ProviderId[] = [
  "gemini",
  "deepseek",
  "minimax",
  "openai",
  "anthropic",
];

// 5 providers x 2 tiers = 10. `label` / `vendor` are UI strings; everything
// factual (wire id, window, price) is derived from env with a provisional
// default. Writing scores are editorial, not measured.
const SEEDS: Seed[] = [
  {
    provider: "gemini",
    tier: "pro",
    label: "Gemini Pro",
    vendor: "Google",
    wireEnv: "GEMINI_WIRE_MODEL_PRO",
    wire: "google/gemini-2.5-pro",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    writingScore: 5,
    inputUsdPer1M: 1.25,
    cachedInputUsdPer1M: 0.31,
    outputUsdPer1M: 10.0,
    supportsStreaming: true,
    authMode: "adc",
    envKeyName: "GOOGLE_APPLICATION_CREDENTIALS",
  },
  {
    provider: "gemini",
    tier: "fast",
    label: "Gemini Fast",
    vendor: "Google",
    wireEnv: "GEMINI_WIRE_MODEL_FAST",
    wire: "google/gemini-2.5-flash",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    writingScore: 3,
    inputUsdPer1M: 0.3,
    cachedInputUsdPer1M: 0.075,
    outputUsdPer1M: 2.5,
    supportsStreaming: true,
    authMode: "adc",
    envKeyName: "GOOGLE_APPLICATION_CREDENTIALS",
  },
  {
    provider: "deepseek",
    tier: "pro",
    label: "DeepSeek Pro",
    vendor: "DeepSeek",
    wireEnv: "DEEPSEEK_PRO_WIRE_MODEL",
    wire: "deepseek-reasoner",
    contextWindow: 65_536,
    maxOutputTokens: 8_192,
    writingScore: 4,
    inputUsdPer1M: 0.55,
    cachedInputUsdPer1M: 0.14,
    outputUsdPer1M: 2.19,
    supportsStreaming: true,
    authMode: "apiKey",
    envKeyName: "DEEPSEEK_API_KEY",
  },
  {
    provider: "deepseek",
    tier: "fast",
    label: "DeepSeek Fast",
    vendor: "DeepSeek",
    wireEnv: "DEEPSEEK_FAST_WIRE_MODEL",
    wire: "deepseek-chat",
    contextWindow: 65_536,
    maxOutputTokens: 8_192,
    writingScore: 3,
    inputUsdPer1M: 0.27,
    cachedInputUsdPer1M: 0.07,
    outputUsdPer1M: 1.1,
    supportsStreaming: true,
    authMode: "apiKey",
    envKeyName: "DEEPSEEK_API_KEY",
  },
  {
    provider: "minimax",
    tier: "pro",
    label: "MiniMax Pro",
    vendor: "MiniMax",
    wireEnv: "MINIMAX_PRO_WIRE_MODEL",
    wire: "MiniMax-M1",
    contextWindow: 1_000_000,
    maxOutputTokens: 40_000,
    writingScore: 3,
    inputUsdPer1M: 0.3,
    cachedInputUsdPer1M: null,
    outputUsdPer1M: 1.65,
    // MiniMax's SSE framing differs from OpenAI's; the existing parser in
    // src/lib/novel/ai.ts expects choices[].delta.content, so streaming is
    // disabled until a translating adapter is verified.
    supportsStreaming: false,
    authMode: "apiKey",
    envKeyName: "MINIMAX_API_KEY",
  },
  {
    provider: "minimax",
    tier: "fast",
    label: "MiniMax Fast",
    vendor: "MiniMax",
    wireEnv: "MINIMAX_FAST_WIRE_MODEL",
    wire: "MiniMax-Text-01",
    contextWindow: 1_000_000,
    maxOutputTokens: 16_000,
    writingScore: 2,
    inputUsdPer1M: 0.2,
    cachedInputUsdPer1M: null,
    outputUsdPer1M: 1.1,
    supportsStreaming: false,
    authMode: "apiKey",
    envKeyName: "MINIMAX_API_KEY",
  },
  {
    provider: "openai",
    tier: "pro",
    label: "OpenAI Pro",
    vendor: "OpenAI",
    wireEnv: "OPENAI_PRO_WIRE_MODEL",
    wire: "gpt-4o",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    writingScore: 4,
    inputUsdPer1M: 2.5,
    cachedInputUsdPer1M: 1.25,
    outputUsdPer1M: 10.0,
    supportsStreaming: true,
    authMode: "apiKey",
    envKeyName: "OPENAI_API_KEY",
  },
  {
    provider: "openai",
    tier: "fast",
    label: "OpenAI Fast",
    vendor: "OpenAI",
    wireEnv: "OPENAI_FAST_WIRE_MODEL",
    wire: "gpt-4o-mini",
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    writingScore: 2,
    inputUsdPer1M: 0.15,
    cachedInputUsdPer1M: 0.075,
    outputUsdPer1M: 0.6,
    supportsStreaming: true,
    authMode: "apiKey",
    envKeyName: "OPENAI_API_KEY",
  },
  {
    provider: "anthropic",
    tier: "pro",
    label: "Anthropic Pro",
    vendor: "Anthropic",
    wireEnv: "ANTHROPIC_PRO_WIRE_MODEL",
    wire: "claude-sonnet-4-20250514",
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    writingScore: 5,
    inputUsdPer1M: 3.0,
    cachedInputUsdPer1M: 0.3,
    outputUsdPer1M: 15.0,
    supportsStreaming: false,
    authMode: "apiKey",
    envKeyName: "ANTHROPIC_API_KEY",
  },
  {
    provider: "anthropic",
    tier: "fast",
    label: "Anthropic Fast",
    vendor: "Anthropic",
    wireEnv: "ANTHROPIC_FAST_WIRE_MODEL",
    wire: "claude-3-5-haiku-20241022",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    writingScore: 3,
    inputUsdPer1M: 0.8,
    cachedInputUsdPer1M: 0.08,
    outputUsdPer1M: 4.0,
    supportsStreaming: false,
    authMode: "apiKey",
    envKeyName: "ANTHROPIC_API_KEY",
  },
];

const numericEnv = (name: string, fallback: number): number => {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nullableNumericEnv = (name: string, fallback: number | null): number | null => {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const envPrefix = (id: string): string => id.replace(":", "_").toUpperCase();

function fromSeed(seed: Seed): ModelDef {
  const id = `${seed.provider}:${seed.tier}`;
  const prefix = envPrefix(id);
  return {
    id,
    provider: seed.provider,
    tier: seed.tier,
    label: seed.label,
    vendor: seed.vendor,
    wireModel: readEnv(seed.wireEnv) ?? seed.wire,
    contextWindow: numericEnv(`${prefix}_CONTEXT_WINDOW`, seed.contextWindow),
    maxOutputTokens: numericEnv(`${prefix}_MAX_OUTPUT_TOKENS`, seed.maxOutputTokens),
    supportsStreaming: seed.supportsStreaming,
    writingScore: seed.writingScore,
    price: {
      inputUsdPer1M: numericEnv(`${prefix}_INPUT_USD_PER_1M`, seed.inputUsdPer1M),
      cachedInputUsdPer1M: nullableNumericEnv(
        `${prefix}_CACHED_INPUT_USD_PER_1M`,
        seed.cachedInputUsdPer1M,
      ),
      outputUsdPer1M: numericEnv(`${prefix}_OUTPUT_USD_PER_1M`, seed.outputUsdPer1M),
    },
    authMode: seed.authMode,
    envKeyName: seed.envKeyName,
  };
}

export const PROVIDER_MODELS: ModelDef[] = SEEDS.map(fromSeed);

export const DEFAULT_MODEL_ID = "gemini:fast";

/**
 * Migration shim for ids already persisted in AgentRun / UsageCall rows. This
 * is a repoint, NOT a claim of model equivalence: historical figures keep
 * their own ledger rows and only future calls use the new provider.
 */
export const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "glm-4.6": "gemini:pro",
  "glm-4.5-air": "deepseek:fast",
  "glm-4-flash": "gemini:fast",
  "glm-4-long": "minimax:pro",
  "gateway-default": DEFAULT_MODEL_ID,
};

export function resolveModel(id: string | null | undefined): ModelDef {
  const key = id ? (LEGACY_MODEL_ALIASES[id] ?? id) : DEFAULT_MODEL_ID;
  const found = PROVIDER_MODELS.find((model) => model.id === key);
  if (!found) throw new Error(`Unknown model "${id ?? ""}" — not in PROVIDER_MODELS.`);
  return found;
}

export function modelsByProvider(): Record<ProviderId, ModelDef[]> {
  const grouped = {} as Record<ProviderId, ModelDef[]>;
  for (const provider of PROVIDER_IDS) grouped[provider] = [];
  for (const model of PROVIDER_MODELS) grouped[model.provider].push(model);
  return grouped;
}

/** Ordered for the picker: editorial writing score, then pro before fast. */
export function listForUi(): ModelDef[] {
  return [...PROVIDER_MODELS].sort(
    (a, b) =>
      b.writingScore - a.writingScore ||
      (a.tier === b.tier ? a.id.localeCompare(b.id) : a.tier === "pro" ? -1 : 1),
  );
}

/**
 * Provider availability. The public allowlist is read FIRST with a STATIC
 * member access, which Next.js inlines into the client bundle; the old
 * dynamic `process.env[name]` lookup returned undefined in the browser and
 * made SSR and hydration disagree. Server-only credential check stays as the
 * fallback when the allowlist is unset.
 */
export function isProviderEnabled(provider: ProviderId): boolean {
  const publicList = process.env.NEXT_PUBLIC_AI_PROVIDERS_ENABLED;
  if (publicList && publicList.trim()) {
    return publicList
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .includes(provider);
  }
  const model = PROVIDER_MODELS.find((entry) => entry.provider === provider);
  if (!model) return false;
  if (model.authMode === "adc") {
    return Boolean(
      readEnv("GEMINI_ACCESS_TOKEN") ??
        readEnv("GOOGLE_APPLICATION_CREDENTIALS") ??
        readEnv("GOOGLE_CLOUD_PROJECT") ??
        readEnv("GCP_PROJECT_ID"),
    );
  }
  return Boolean(readEnv(model.envKeyName));
}
