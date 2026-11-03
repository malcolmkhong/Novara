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
}

export interface ContextMeter {
  /** Count one appended turn (assistant reply or tool-result feed). */
  addConversation(text: string): void;
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
  const addPiece = (text: string) => {
    const tokens = countTokens(text);
    pieces.push({ text, tokens });
    sections.conversation += tokens;
  };
  for (const text of init.conversation ?? []) addPiece(text);

  return {
    addConversation(text) {
      if (!text) return;
      addPiece(text);
    },
    snapshot(actor) {
      const used = Object.values(sections).reduce((a, b) => a + b, 0);
      return {
        modelId: init.modelId,
        contextWindow: init.contextWindow,
        used,
        actor,
        sections: { ...sections },
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
