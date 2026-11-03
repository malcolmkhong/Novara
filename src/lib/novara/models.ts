// ---------------------------------------------------------------------------
// Novara AI — Model registry (Phase P2).
//
// ONE source of truth for every model the team can run on. Adding a model is
// a DATA change: append one entry below and (when the gateway starts serving
// it for real) flip `available`. Nothing else in the codebase hardcodes a
// model id — the runtime, the run API and the composer picker all read this
// registry.
//
// Entry shape:
//   id             stable registry id, also what AgentRun stores
//   sdkModel       value passed to the SDK `model` field (undefined = leave
//                  the field off and let the gateway use its server default)
//   thinkingLevels ordered low→high; the picker shows exactly these for the
//                  selected model ("根据所选模型显示可用的思考等级")
//   toSdkParams    translates a thinking level into SDK request params
//
// HONESTY (verified by probe, 2025): this gateway currently accepts every
// id below but routes them to ONE shared GLM backend (echoes model
// "glm-4-plus"). Today the only REAL behavioral switch is thinking on/off.
// The registry still carries each entry's published spec so the panel and
// picker are correct the moment the gateway differentiates backends.
// ---------------------------------------------------------------------------

export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface ThinkingLevelMeta {
  id: ThinkingLevel;
  label: string;
  hint: string;
}

export const THINKING_LEVEL_META: Record<ThinkingLevel, ThinkingLevelMeta> = {
  off: { id: "off", label: "Off", hint: "Direct answers — fastest, cheapest." },
  low: { id: "low", label: "Low", hint: "A brief think before acting." },
  medium: { id: "medium", label: "Medium", hint: "Balanced reasoning depth." },
  high: { id: "high", label: "High", hint: "Deep thinking — slowest, most thorough." },
};

/** SDK request params a resolved (model, level) pair produces. */
export interface SdkModelParams {
  model?: string;
  thinking?: { type: "enabled" | "disabled" };
}

export interface ModelDefinition {
  id: string;
  label: string;
  vendor: string;
  /** Published context window, in tokens (drives the Context Usage panel). */
  contextWindow: number;
  maxOutputTokens: number;
  /** Ordered low→high thinking levels this model accepts. */
  thinkingLevels: ThinkingLevel[];
  /** Level used when the author picks the model without touching thinking. */
  defaultThinkingLevel: ThinkingLevel;
  /** False = shown in the picker as a coming-soon row, not selectable. */
  available: boolean;
  /** One-line capability note shown in the picker. */
  note: string;
  /** Level → SDK params (kept per-entry so future gateways can differ). */
  toSdkParams: (level: ThinkingLevel) => SdkModelParams;
}

/** GLM-style gateway: thinking is a binary toggle today. */
const glmThinking = (sdkModel?: string) => ({
  toSdkParams: (level: ThinkingLevel): SdkModelParams => ({
    ...(sdkModel ? { model: sdkModel } : {}),
    thinking: { type: level === "off" ? "disabled" : "enabled" },
  }),
});

export const MODEL_REGISTRY: ModelDefinition[] = [
  {
    id: "glm-4.6",
    label: "GLM-4.6",
    vendor: "Z.ai",
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    thinkingLevels: ["off", "high"],
    defaultThinkingLevel: "off",
    available: true,
    note: "Flagship — deep novel work, 200K context spec.",
    ...glmThinking("glm-4.6"),
  },
  {
    id: "glm-4.5-air",
    label: "GLM-4.5 Air",
    vendor: "Z.ai",
    contextWindow: 128_000,
    maxOutputTokens: 96_000,
    thinkingLevels: ["off", "high"],
    defaultThinkingLevel: "off",
    available: true,
    note: "Lightweight — fast drafting and research turns.",
    ...glmThinking("glm-4.5-air"),
  },
  {
    id: "glm-4-flash",
    label: "GLM-4 Flash",
    vendor: "Z.ai",
    contextWindow: 128_000,
    maxOutputTokens: 96_000,
    thinkingLevels: ["off"],
    defaultThinkingLevel: "off",
    available: true,
    note: "Speed-first — no thinking mode, tight budgets.",
    ...glmThinking("glm-4-flash"),
  },
  {
    id: "glm-4-long",
    label: "GLM-4 Long",
    vendor: "Z.ai",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_000,
    thinkingLevels: ["off", "high"],
    defaultThinkingLevel: "off",
    available: true,
    note: "1M-context spec — whole-novel passes and recap runs.",
    ...glmThinking("glm-4-long"),
  },
];

export const DEFAULT_MODEL_ID = "glm-4.6";

/** The author-facing (model, thinking level) pair stored per run / per novel. */
export interface ModelSelection {
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export function getModelDefinition(modelId: string | undefined | null): ModelDefinition {
  return (
    MODEL_REGISTRY.find((m) => m.id === modelId) ??
    MODEL_REGISTRY.find((m) => m.id === DEFAULT_MODEL_ID) ??
    MODEL_REGISTRY[0]
  );
}

export function defaultSelection(): ModelSelection {
  const def = getModelDefinition(DEFAULT_MODEL_ID);
  return { modelId: def.id, thinkingLevel: def.defaultThinkingLevel };
}

/**
 * Validate + resolve a client-supplied selection against the registry.
 * Throws with a user-readable message on any mismatch — the run API maps
 * that to a 400 before anything is persisted.
 */
export function resolveModelSelection(
  modelId: string | undefined | null,
  thinkingLevel: string | undefined | null
): { selection: ModelSelection; sdk: SdkModelParams; contextWindow: number; label: string } {
  const def = MODEL_REGISTRY.find((m) => m.id === modelId);
  if (modelId && !def) {
    throw new Error(`Unknown model "${modelId}" — not in the registry.`);
  }
  const entry = def ?? getModelDefinition(DEFAULT_MODEL_ID);
  if (!entry.available) {
    throw new Error(`Model ${entry.label} is not available yet.`);
  }
  const level = (thinkingLevel ?? entry.defaultThinkingLevel) as ThinkingLevel;
  if (!entry.thinkingLevels.includes(level)) {
    throw new Error(
      `Thinking level "${thinkingLevel}" is not available on ${entry.label} (supported: ${entry.thinkingLevels.join(", ")}).`
    );
  }
  return {
    selection: { modelId: entry.id, thinkingLevel: level },
    sdk: entry.toSdkParams(level),
    contextWindow: entry.contextWindow,
    label: entry.label,
  };
}

/** "200K" / "1.0M" — compact window formatter for picker + panel. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}
