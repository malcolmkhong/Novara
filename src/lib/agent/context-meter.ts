// ---------------------------------------------------------------------------
// Novara AI — Context meter (P2 Context Usage).
//
// Measures what ONE agent conversation actually sends to the model, section
// by section, so the composer's Context Usage panel shows real numbers
// instead of guesses. One meter per conversation (leader loop or member
// task); the runtime snapshots it before every GLM call and emits the result
// as a `usage` event — which rides the existing SSE stream to the panel.
//
// Sections (the honest map of THIS system — there is no MCP):
//   system       role card minus its tool documentation
//   tools        the ```novel-tool / team-delegate protocol docs embedded in
//                the role card (our "tool schemas" are prose, not JSON)
//   skills       injected skill bodies (agent/skills/**)
//   novel        story snapshot + pinned @refs + quota/certify addenda —
//                this system's equivalent of "external knowledge"
//   conversation goal envelope + turn history + tool-result feeds
//   mcp          always 0 — reserved row, shown so the panel can answer
//                "do we use MCP?" with a visible 0% instead of silence.
//
// Token counting: gpt-tokenizer cl100k for latin text, 0.7 tokens/CJK char
// for Chinese (cl100k over-counts CJK ~1.4×; GLM's tokenizer compresses
// Chinese to roughly 0.6–0.7 tok/char). It is an estimate by nature — the
// panel says so.
// ---------------------------------------------------------------------------

import { countTokens as cl100kCount } from "gpt-tokenizer/encoding/cl100k_base";
import type { ContextUsage } from "@/lib/novara/agent-types";

export type ContextSectionKey =
  | "system"
  | "tools"
  | "skills"
  | "novel"
  | "conversation"
  | "mcp";

const CJK_RE = /[\u3000-\u303F\u3400-\u9FBF\uF900-\uFAFF\uFF00-\uFFEF]/g;

/** Hybrid estimator — CJK-aware (see header note). */
export function countTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK_RE)?.length ?? 0;
  const rest = cjk > 0 ? text.replace(CJK_RE, " ") : text;
  return Math.round(cjk * 0.7 + cl100kCount(rest));
}

/**
 * P2-d (design §7) — observability split of the conversation section into
 * compaction-relevant buckets. The three values ALWAYS sum to
 * `sections.conversation` (harness-asserted):
 *   compacted — the projection block (the deterministic compaction summary);
 *               0 on every wire without one (disabled / fallback / members)
 *   tail      — verbatim tail rows replayed after the projection (the whole
 *               replay when no projection is present)
 *   shared    — per-assembly injections (resume_note & co., design §2.0.1):
 *               they ride EVERY wire this session assembles regardless of
 *               compaction, so their cost is attributed to neither bucket
 */
export interface ConversationSub {
  compacted: number;
  tail: number;
  shared: number;
}

export interface MeterInit {
  modelId: string;
  contextWindow: number;
  /** Texts counted ONCE into fixed sections at construction. */
  system?: string[];
  tools?: string;
  skills?: string[];
  novel?: string[];
  /** Conversation pieces present before the first turn (the goal envelope). */
  conversation?: string[];
  /**
   * P2-d (design §7) — TAGGED conversation pieces. When present, these three
   * arrays REPLACE `conversation` as the metered pieces (same order: compacted
   * → tail → shared), each counted into its sub-bucket. Pieces added later via
   * addConversation() are tagged explicitly ("tail" default — transcript-bound
   * rows; "shared" for per-assembly injections).
   */
  conversationSub?: { compacted?: string[]; tail?: string[]; shared?: string[] };
}

export interface ContextMeter {
  /**
   * Count one appended conversation piece. `tag` routes it into the §7
   * observability sub-buckets: "tail" (default) = a transcript-bound row
   * (reply / tool_results feed); "shared" = a per-assembly injection that
   * rides every wire regardless of compaction (design §2.0.1).
   */
  addConversation(text: string, tag?: "tail" | "shared"): void;
  /** Current usage snapshot — what the NEXT glm call would send. */
  snapshot(actor: string): ContextUsage;
}

export function createContextMeter(init: MeterInit): ContextMeter {
  const sections: Record<ContextSectionKey, number> = {
    system: 0,
    tools: 0,
    skills: 0,
    novel: 0,
    conversation: 0,
    mcp: 0,
  };

  for (const text of init.system ?? []) sections.system += countTokens(text);
  sections.tools += countTokens(init.tools ?? "");
  for (const text of init.skills ?? []) sections.skills += countTokens(text);
  for (const text of init.novel ?? []) sections.novel += countTokens(text);

  // Cache per-piece counts so repeated snapshots never recount history.
  const pieces: { text: string; tokens: number }[] = [];
  const sub: ConversationSub = { compacted: 0, tail: 0, shared: 0 };
  const addPiece = (text: string, tag: keyof ConversationSub) => {
    const tokens = countTokens(text);
    pieces.push({ text, tokens });
    sections.conversation += tokens;
    sub[tag] += tokens;
  };
  if (init.conversationSub) {
    // Tagged pieces REPLACE the untagged array (see MeterInit.conversationSub).
    for (const text of init.conversationSub.compacted ?? []) addPiece(text, "compacted");
    for (const text of init.conversationSub.tail ?? []) addPiece(text, "tail");
    for (const text of init.conversationSub.shared ?? []) addPiece(text, "shared");
  } else {
    // Untagged init pieces are the verbatim replay — tail semantics.
    for (const text of init.conversation ?? []) addPiece(text, "tail");
  }

  return {
    addConversation(text, tag = "tail") {
      if (!text) return;
      addPiece(text, tag);
    },
    snapshot(actor) {
      const used = Object.values(sections).reduce((a, b) => a + b, 0);
      return {
        modelId: init.modelId,
        contextWindow: init.contextWindow,
        used,
        actor,
        sections: { ...sections },
        conversationSub: { ...sub },
        updatedAt: new Date().toISOString(),
      };
    },
  };
}

/** "58.1K / 192.0K" style summary for the usage event's feed line. */
export function formatUsageSummary(usage: ContextUsage): string {
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}K`
        : String(n);
  return `${fmt(usage.used)} / ${fmt(usage.contextWindow)} tokens`;
}

/**
 * P4 / T4 — anchor a call's usage to the provider's REAL billed numbers.
 *
 * The meter's section split stays an estimate (cl100k + CJK heuristic), but
 * the TOTAL must not be: the provider's prompt_tokens is the hard truth.
 * This scales every section proportionally so they still sum to the measured
 * total (rounding drift is absorbed into the largest section), and attaches
 * the real object — the panel distinguishes "measured" from "estimated" by
 * its presence. When no real usage exists the estimate passes through
 * untouched (real: null).
 */
export function reconcileUsageWithReal(
  usage: ContextUsage,
  real: { promptTokens: number; completionTokens: number; totalTokens: number } | null,
): ContextUsage {
  if (!real || real.promptTokens <= 0) return { ...usage, real: real ?? null };
  const estimateUsed = Math.max(usage.used, 1);
  const factor = real.promptTokens / estimateUsed;
  const keys = Object.keys(usage.sections) as (keyof ContextUsage["sections"])[];
  const sections = { ...usage.sections };
  // Scale every section, then push the accumulated rounding drift into the
  // largest one so the sections sum EXACTLY to the measured prompt total.
  let drift = real.promptTokens;
  let largestKey = keys[0];
  for (const key of keys) {
    const scaled = Math.round(usage.sections[key] * factor);
    sections[key] = scaled;
    drift -= scaled;
    if (usage.sections[key] > usage.sections[largestKey]) largestKey = key;
  }
  sections[largestKey] = Math.max(0, sections[largestKey] + drift);
  // P2-d (§7): scale the conversation sub-buckets with the same factor, then
  // absorb their rounding drift into the largest bucket so they still sum
  // EXACTLY to the (scaled) conversation section.
  let conversationSub: ContextUsage["conversationSub"] = null;
  if (usage.conversationSub) {
    const subKeys = ["compacted", "tail", "shared"] as const;
    const scaledSub: ConversationSub = { compacted: 0, tail: 0, shared: 0 };
    let subDrift = sections.conversation;
    let largestSub: (typeof subKeys)[number] = subKeys[0];
    for (const key of subKeys) {
      const scaled = Math.round(usage.conversationSub[key] * factor);
      scaledSub[key] = scaled;
      subDrift -= scaled;
      if (usage.conversationSub[key] > usage.conversationSub[largestSub]) largestSub = key;
    }
    scaledSub[largestSub] = Math.max(0, scaledSub[largestSub] + subDrift);
    conversationSub = scaledSub;
  }
  return {
    ...usage,
    used: real.promptTokens,
    sections,
    conversationSub,
    real: {
      promptTokens: real.promptTokens,
      completionTokens: real.completionTokens,
      totalTokens: real.totalTokens,
    },
  };
}
