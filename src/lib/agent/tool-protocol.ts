// ---------------------------------------------------------------------------
// Novara AI — agent turn protocol parser (development plan §7.1).
//
// The model speaks in fenced blocks; CODE parses and executes (the model
// never calls anything directly):
//   ```novel-tool {"action": "..."} ```   one JSON action per block
//   ```novel-write  ...prose...      ```   the prose payload of a write
//   ```run-report   {"k": n}         ```   final task report (verified later)
//   BLOCKED: <reason>                      honest refusal line
//
// Deliberately NOT JSON-for-everything (Phase 2 lesson): chapter prose is full
// of dialogue quotes that break JSON escaping — prose travels in its own
// block. Invalid tool JSON is salvaged with jsonrepair before rejection so a
// single malformed block doesn't kill the turn.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import type { AgentRoleId, ArtifactType } from "@/lib/novara/agent-types";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const toolActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read_novel") }),
  z.object({ action: z.literal("read_chapter"), index: z.number().int().positive() }),
  z.object({ action: z.literal("read_outline") }),
  z.object({ action: z.literal("read_foreshadows") }),
  // Phase 4: scored query over the sediment layer (StoryFact/CharacterState/
  // Foreshadow digests). Read-only, free — the agent asks the story bible
  // mid-run instead of guessing established canon.
  z.object({
    action: z.literal("memory_query"),
    query: z.string().trim().min(1).max(500),
    category: z
      .enum([
        "world_rule",
        "character_state",
        "relationship",
        "story_fact",
        "open_loop",
        "decision",
        "style",
        "dialogue",
        "inspiration",
      ])
      .optional(),
  }),
  z.object({ action: z.literal("doctor_scan") }),
  // Phase 5: Prism's structured review (same core as the Review tab).
  z.object({
    action: z.literal("review_chapter"),
    index: z.number().int().positive(),
  }),
  // Phase 6 E2 gate tools — prism-only; CODE decides via the latest persisted
  // ChapterReview verdict, never via model claims.
  z.object({
    action: z.literal("finalize_chapter"),
    index: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("settle_chapter"),
    index: z.number().int().positive(),
  }),
  // Phase 5: Forge's manuscript build (real generation, feed-reported).
  z.object({ action: z.literal("export_markdown") }),
  // STEP 70 — the open-loop ledger. Two narrow actions:
  //   read_promises  — what is still open (promises + clues) for this novel.
  //   update_ledger  — move ONE promise or clue forward (never backwards).
  // Only "promise" and "clue" are writable; the storyline / timeline / arc
  // ledgers stay author-owned.
  z.object({ action: z.literal("read_promises") }),
  z.object({
    action: z.literal("update_ledger"),
    // The kind and the status are validated by the TOOL, not by the schema:
    // the tool's own message is the one the model reads ("kind must be
    // promise or clue — storylines, timeline and arcs are author-owned").
    kind: z.string().trim().min(1).max(24),
    id: z.string().trim().min(1).max(64),
    // The lifecycle of each kind is its own: a promise is open | advanced |
    // paid, a clue is planted | surfaced | revealed. The runtime accepts the
    // forward steps of the matching machine and refuses the rest.
    status: z.string().trim().min(1).max(24),
    /** Why the loop moved — recorded on the row's existing fields. */
    note: z.string().trim().max(400).optional(),
  }),
  z.object({
    action: z.literal("create_chapter"),
    title: z.string().trim().min(1).max(200),
  }),
  z.object({ action: z.literal("update_chapter"), index: z.number().int().positive() }),
  z.object({
    action: z.literal("update_outline_beat"),
    index: z.number().int().positive(),
    summary: z.string().trim().min(1).max(2000),
  }),
  z.object({ action: z.literal("finish") }),
]);

export type ToolAction = z.infer<typeof toolActionSchema>;

// ---------------------------------------------------------------------------
// team-delegate (Phase 5): Atlas dispatches work orders to members.
// One fenced block per turn, body = JSON array of orders. Code creates the
// AgentTask rows and executes them; the model never runs members itself.
// ---------------------------------------------------------------------------

export const delegateOrderSchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(6000).default(""),
  // atlas may not delegate to itself — members only
  assignee: z.enum(["sage", "nova", "prism", "forge"]),
  artifactType: z
    .enum(["chapter", "outline_beat", "world_entry", "character"])
    .nullish()
    .transform((v) => (v ?? null) as ArtifactType | null),
  artifactLabel: z.string().trim().max(120).nullish().transform((v) => v ?? null),
  // Optional skill ids injected into the member prompt (registry-validated
  // by the runtime; unknown ids here are dropped with a feed note).
  skills: z.array(z.string().trim().min(1).max(80)).max(6).optional(),
});

export type DelegateOrder = z.infer<typeof delegateOrderSchema>;

export interface ParsedDelegate {
  position: number;
  order: DelegateOrder | null;
  error: string | null;
}

export interface ParsedToolCall {
  /** Position among the turn's tool blocks (0-based). */
  position: number;
  action: ToolAction | null;
  error: string | null;
}

export interface ParsedTurn {
  /** Reply text with all recognized blocks stripped (what the user sees). */
  narration: string;
  toolCalls: ParsedToolCall[];
  /** First ```novel-write body — the prose payload for a write action. */
  novelWrite: string | null;
  /** Extra novel-write blocks were present (dropped — one write per turn). */
  extraWriteBlocks: number;
  /** Parsed ```run-report numbers, or null. */
  runReport: Record<string, number> | null;
  /** Phase 5: parsed ```team-delegate orders (leader loop only). */
  delegates: ParsedDelegate[];
  /** The model's honest refusal: text after a leading BLOCKED: line. */
  blockedReason: string | null;
  /** True when the turn contains a finish action or no tool calls at all. */
  endsLoop: boolean;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const FENCE_RE = /```[ \t]*\r?\n?[ \t]*([a-zA-Z][a-zA-Z0-9_-]*)[ \t]*\r?\n?([\s\S]*?)```/g;
const BLOCKED_RE = /(^|\n)[ \t]*BLOCKED[:：][ \t]*(.+)/;
/** AI sometimes drops the closing fence — salvage a trailing known block. */
const UNCLOSED_RE = /```[ \t]*\r?\n?[ \t]*(novel-write|run-report|novel-tool|team-delegate)\b[ \t]*\r?\n?([\s\S]*)$/;

function parseJsonObject(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: "empty block" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    try {
      return { ok: true, value: JSON.parse(jsonrepair(text)) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "invalid JSON",
      };
    }
  }
}

function parseRunReport(raw: string): Record<string, number> | null {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed.value as Record<string, unknown>)) {
    const num = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(num)) out[key] = num;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function parseAgentTurn(reply: string): ParsedTurn {
  const toolCalls: ParsedToolCall[] = [];
  const delegates: ParsedDelegate[] = [];
  let novelWrite: string | null = null;
  let extraWriteBlocks = 0;
  let runReport: Record<string, number> | null = null;

  const handleBlock = (lang: string, body: string): string | null => {
    if (lang === "novel-tool") {
      const position = toolCalls.length;
      const parsed = parseJsonObject(body);
      if (!parsed.ok) {
        toolCalls.push({ position, action: null, error: `invalid JSON: ${parsed.error}` });
        return "";
      }
      const action = toolActionSchema.safeParse(parsed.value);
      if (!action.success) {
        toolCalls.push({ position, action: null, error: action.error.issues[0]?.message ?? "unknown action shape" });
        return "";
      }
      toolCalls.push({ position, action: action.data, error: null });
      return "";
    }
    if (lang === "team-delegate") {
      const parsed = parseJsonObject(body);
      if (!parsed.ok) {
        delegates.push({ position: delegates.length, order: null, error: `invalid JSON: ${parsed.error}` });
        return "";
      }
      const list = Array.isArray(parsed.value) ? parsed.value : [parsed.value];
      for (const raw of list) {
        const check = delegateOrderSchema.safeParse(raw);
        if (!check.success) {
          delegates.push({
            position: delegates.length,
            order: null,
            error: check.error.issues[0]?.message ?? "unknown delegate shape",
          });
        } else {
          delegates.push({ position: delegates.length, order: check.data, error: null });
        }
      }
      return "";
    }
    if (lang === "novel-write") {
      const text = body.trim();
      if (text) {
        if (novelWrite === null) novelWrite = text;
        else extraWriteBlocks += 1;
      }
      return "";
    }
    if (lang === "run-report") {
      runReport = parseRunReport(body) ?? runReport;
      return "";
    }
    return null; // unknown fence language — keep it in the narration
  };

  // Pass 1: complete fenced blocks (whitespace-tolerant after the backticks).
  let narration = reply.replace(FENCE_RE, (match, lang: string, body: string) => {
    const kept = handleBlock(lang, body);
    return kept === null ? match : kept;
  });

  // Pass 2: AI occasionally drops the closing ``` — if a KNOWN block opener
  // trails in the leftover text, treat everything after it as that body.
  const unclosed = narration.match(UNCLOSED_RE);
  if (unclosed) {
    const kept = handleBlock(unclosed[1], unclosed[2] ?? "");
    if (kept !== null) {
      narration = narration.slice(0, unclosed.index ?? 0);
    }
  }

  const cleanNarration = narration
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const blockedMatch = cleanNarration.match(BLOCKED_RE);
  const blockedReason = blockedMatch ? blockedMatch[2].trim().slice(0, 500) : null;

  const hasFinish = toolCalls.some((t) => t.action?.action === "finish");
  const endsLoop = hasFinish || toolCalls.length === 0;

  return {
    narration: cleanNarration,
    toolCalls,
    novelWrite,
    extraWriteBlocks,
    runReport,
    delegates,
    blockedReason,
    endsLoop,
  };
}
