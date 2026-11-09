// ---------------------------------------------------------------------------
// Novara AI — Model selection surface (P2), now a PROJECTION of the provider
// registry. No model id, price or context window is defined here: see
// src/lib/ai/providers/registry.ts, the single source of truth.
//
// The public shape below is deliberately unchanged so model-picker.tsx,
// context-usage-panel.tsx, conversation-pane.tsx and the run APIs keep
// compiling without edits.
// ---------------------------------------------------------------------------

import {
  DEFAULT_MODEL_ID,
  LEGACY_MODEL_ALIASES,
  isProviderEnabled,
  listForUi,
  resolveModel,
} from "@/lib/ai/providers/registry";
import type { ModelDef } from "@/lib/ai/providers/types";

export { DEFAULT_MODEL_ID };

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

/** Params handed to the SDK-shaped compat wrapper in src/lib/ai/router.ts. */
export interface SdkModelParams {
  model?: string;
  /** Concrete level forwarded verbatim; legacy object shape still accepted. */
  thinking?: ThinkingLevel | { type: "enabled" | "disabled" };
}

export interface ModelDefinition {
  id: string;
  label: string;
  vendor: string;
  contextWindow: number;
  maxOutputTokens: number;
  thinkingLevels: ThinkingLevel[];
  defaultThinkingLevel: ThinkingLevel;
  available: boolean;
  note: string;
  toSdkParams: (level: ThinkingLevel) => SdkModelParams;
}

function project(def: ModelDef): ModelDefinition {
  // gemini-3.8-flash has no zero-thinking mode: "off"/"none"/"minimal" are
  // rejected by the gateway. No adapter currently advertises a different set,
  // so all providers offer the same three levels; branch here if one does.
  const thinkingLevels: ThinkingLevel[] = ["low", "medium", "high"];
  return {
    id: def.id,
    label: def.label,
    vendor: def.vendor,
    contextWindow: def.contextWindow,
    maxOutputTokens: def.maxOutputTokens,
    thinkingLevels,
    defaultThinkingLevel: "low",
    available: isProviderEnabled(def.provider),
    note: `${def.tier === "pro" ? "Pro" : "Fast"} · writing ${def.writingScore}/5${
      def.supportsStreaming ? " · streaming" : ""
    }`,
    toSdkParams: (level) => ({
      model: def.id,
      thinking: thinkingLevels.includes(level) ? level : "low",
    }),
  };
}

/** Ordered by editorial writing score (see registry.listForUi). */
export const MODEL_REGISTRY: ModelDefinition[] = listForUi().map(project);

export interface ModelSelection {
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

/** Tolerant of legacy ids already persisted in AgentRun / UsageCall rows. */
export function getModelDefinition(modelId: string | undefined | null): ModelDefinition {
  const raw = modelId ?? DEFAULT_MODEL_ID;
  const canonical = LEGACY_MODEL_ALIASES[raw] ?? raw;
  return (
    MODEL_REGISTRY.find((model) => model.id === canonical) ??
    MODEL_REGISTRY.find((model) => model.id === DEFAULT_MODEL_ID) ??
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
  thinkingLevel: string | undefined | null,
): { selection: ModelSelection; sdk: SdkModelParams; contextWindow: number; label: string } {
  let resolved: ModelDef | undefined;
  try {
    resolved = resolveModel(modelId);
  } catch {
    resolved = undefined;
  }
  if (modelId && !resolved) {
    throw new Error(`Unknown model "${modelId}" — not in the registry.`);
  }
  const entry = getModelDefinition(resolved?.id ?? DEFAULT_MODEL_ID);
  if (!entry.available) throw new Error(`Model ${entry.label} is not available yet.`);
  const rawLevel = (thinkingLevel ?? entry.defaultThinkingLevel) as ThinkingLevel;
  // Legacy runs and stored preferences still carry "off"; the gateway has no
  // zero-thinking mode, so normalise to the cheapest supported level.
  const level: ThinkingLevel = rawLevel === "off" ? "low" : rawLevel;
  if (!entry.thinkingLevels.includes(level)) {
    throw new Error(
      `Thinking level "${thinkingLevel}" is not available on ${entry.label} (supported: ${entry.thinkingLevels.join(", ")}).`,
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
