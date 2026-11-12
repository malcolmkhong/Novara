// ---------------------------------------------------------------------------
// Novara AI — content layer loader (development plan §3 "Content Layer").
//
// The ONLY place that reads the agent/ directory at runtime:
//   agent/config/*.yaml   team + skills registries (fail-fast) and budgets
//                         (merged over hard-coded defaults)
//   agent/system/*.md     role system prompt cards
//   agent/skills/**/*.md  skill bodies injected after the role card
//
// - team/skills/system files: zod-validated, fail-fast on missing/corrupt —
//   the tool loop must never run against a silently-wrong contract.
// - budgets.yaml: merges over DEFAULT_BUDGETS so a corrupt file degrades to
//   known-good numbers instead of taking routes down (warn + fallback).
// - Cached in module memory after first successful load (per process).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const AGENT_DIR = path.join(process.cwd(), "agent");

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const roleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  enabled: z.boolean(),
  system: z.string().min(1),
  skills: z.array(z.string().min(1)).max(12),
});

const teamSchema = z.object({ roles: z.array(roleSchema).min(1).max(12) });

const skillEntrySchema = z.object({
  id: z.string().min(1),
  appliesTo: z.enum(["atlas", "member", "all"]),
  path: z.string().min(1),
  description: z.string().max(200).default(""),
});

const skillsRegistrySchema = z.object({
  skills: z.array(skillEntrySchema).min(1).max(60),
});

export const budgetsSchema = z.object({
  ai: z.object({
    timeoutMs: z.number().int().positive(),
    routeMaxDuration: z.number().int().positive(),
    maxTurns: z.number().int().min(1).max(8),
    maxActionsPerTurn: z.number().int().min(1).max(8),
    planMaxTasks: z.number().int().min(1).max(64),
    // Phase 5: Atlas leader-loop turn budget (delegate rounds).
    leaderMaxTurns: z.number().int().min(1).max(32),
    chapterContextChars: z.number().int().min(1000),
    // STEP 71 — the sediment extractor reads the whole chapter in overlapping,
    // sentence-aligned windows; these two are the window size and its overlap.
    sedimentWindowChars: z.number().int().min(1000),
    sedimentWindowOverlapChars: z.number().int().min(0),
    sedimentTimeoutMs: z.number().int().min(1000),
    sedimentWindowPauseMs: z.number().int().min(0),
    chapterTailChars: z.number().int().min(500),
    snapshotCastLimit: z.number().int().min(1),
    snapshotOutlineLimit: z.number().int().min(1),
    snapshotFactsLimit: z.number().int().min(1),
    repairRounds: z.number().int().min(0).max(4),
    // Phase 6: transient-error retry + global AI concurrency semaphore.
    retryAttempts: z.number().int().min(0).max(5),
    retryBackoffMs: z.number().int().min(250),
    maxConcurrent: z.number().int().min(1).max(8),
  }),
  qc: z.object({
    // Phase 6 E2: hard budget of review→repair→re-review cycles per chapter.
    revisionRounds: z.number().int().min(1).max(6),
    approvalWaitMs: z.number().int().min(30_000),
  }),
  draft: z.object({
    quotaMinWords: z.number().int().positive(),
    quotaMaxWords: z.number().int().positive(),
    avgChapterWordsSignal: z.number().int().positive(),
    fallbackChapterWords: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    appendFloorWords: z.number().int().positive(),
  }),
  sse: z.object({
    snapshotIntervalMs: z.number().int().min(200),
    heartbeatMs: z.number().int().min(1000),
    staleRunMs: z.number().int().min(60_000),
  }),
  client: z.object({
    fallbackPollMs: z.number().int().min(250),
  }),
  prompt: z.object({
    systemPromptCapChars: z.number().int().min(1000),
    taskBriefCapChars: z.number().int().min(400),
  }),
  memory: z.object({
    topK: z.number().int().min(1).max(60),
    contextBudgetChars: z.number().int().min(400),
    itemContentChars: z.number().int().min(80),
    digestWindow: z.number().int().min(0).max(10),
    digestSummaryChars: z.number().int().min(100),
    recencyHalfLifeChapters: z.number().int().min(1),
    staleLoopChapters: z.number().int().min(3),
  }),
  // Phase 2 — context compaction. Eligibility keys off THIS section only,
  // never off contextSpec (agent-ctx/p2-design.md §1). enabled=false ships
  // inert: nothing consumes the section until P2-b's assembler.
  contextCompaction: z.object({
    enabled: z.boolean(),
    triggerTokens: z.number().int().min(4000),
    tailTurns: z.number().int().min(1).max(64),
    minCompactableRows: z.number().int().min(2),
  }),
  // Phase 4 — member snapshot slicing (agent-ctx/phase4-proposal.md, O1).
  // Shipped inert (enabled=false) exactly like compaction; ENABLED by user
  // ruling R-1 at P5-e (2026-11-06) — the first optimization that changes
  // model-visible bytes. The runtime passes the flag to
  // buildMemberSnapshotSlice; false reproduces the full pre-P4 snapshot
  // byte-identically (the rollback contract).
  contextSlicing: z.object({
    enabled: z.boolean(),
  }),
});

export type Budgets = z.infer<typeof budgetsSchema>;

export const DEFAULT_BUDGETS: Budgets = {
  ai: {
    timeoutMs: 60_000,
    routeMaxDuration: 90,
    maxTurns: 3,
    maxActionsPerTurn: 3,
    planMaxTasks: 44, // multi-chapter QC runs need ~3 orders per chapter
    leaderMaxTurns: 22, // Phase 5: Atlas delegate rounds per run
    chapterContextChars: 24_000,
    sedimentWindowChars: 4_000,
    sedimentWindowOverlapChars: 800,
    sedimentTimeoutMs: 120_000,
    sedimentWindowPauseMs: 8_000,
    chapterTailChars: 6_000,
    snapshotCastLimit: 12,
    snapshotOutlineLimit: 40,
    snapshotFactsLimit: 20,
    repairRounds: 2,
    retryAttempts: 2,      // Phase 6: transient-error retries per AI call
    retryBackoffMs: 2_500, // exponential backoff base (2.5s → 5s)
    maxConcurrent: 2,      // global in-flight AI calls
  },
  qc: {
    revisionRounds: 2,     // Phase 6 E2: repair cycles per chapter (hard budget)
    approvalWaitMs: 1_800_000, // gate wait ceiling (30 min)
  },
  draft: {
    quotaMinWords: 300,
    quotaMaxWords: 4000,
    avgChapterWordsSignal: 200,
    fallbackChapterWords: [500, 800],
    appendFloorWords: 200,
  },
  sse: {
    snapshotIntervalMs: 1200,
    heartbeatMs: 15_000,
    staleRunMs: 900_000,
  },
  client: {
    fallbackPollMs: 2000,
  },
  prompt: {
    systemPromptCapChars: 8000,
    taskBriefCapChars: 1800,
  },
  memory: {
    topK: 14,                  // max scored memory items per draft
    contextBudgetChars: 2600,  // char budget for the memory prompt block
    itemContentChars: 240,     // per-item clip inside the block
    digestWindow: 3,           // recent chapter digests injected verbatim
    digestSummaryChars: 500,   // per-digest clip
    recencyHalfLifeChapters: 12,  // chapters until recency factor ≈ 0.75
    staleLoopChapters: 10,     // doctor: open loop untouched for N chapters → warn
  },
  contextCompaction: {
    enabled: false,        // Phase 2 ships inert — flipped only in a P2-c probe run
    triggerTokens: 6_000,  // reachable default (§8-predicted leader ceiling ~9–10K; 24K could never fire)
    tailTurns: 8,          // verbatim turns kept after the cut
    minCompactableRows: 12, // never compact below this many coverable rows
  },
  contextSlicing: {
    // P5-e (user ruling R-1, 2026-11-06): slicing is ON — both here (the
    // degrade-gracefully fallback) and in agent/config/budgets.yaml (the
    // operative source). Rollback = one flip to false in both places; no
    // data migration, no schema coupling (phase5-gate-p5d.md §4).
    enabled: true,
  },
};

export type RoleConfig = z.infer<typeof roleSchema>;
export type SkillEntry = z.infer<typeof skillEntrySchema>;

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

function readText(relPath: string): string {
  const full = path.join(AGENT_DIR, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`[agent-content] required file missing: agent/${relPath}`);
  }
  return fs.readFileSync(full, "utf-8");
}

function readYaml(relPath: string): unknown {
  const raw = readText(relPath);
  try {
    return YAML.parse(raw);
  } catch (error) {
    throw new Error(
      `[agent-content] YAML parse failed for agent/${relPath}: ${error instanceof Error ? error.message : "unknown"}`
    );
  }
}

// ---------------------------------------------------------------------------
// Cached singletons
// ---------------------------------------------------------------------------

interface ContentCache {
  budgets: Budgets;
  roles: RoleConfig[];
  skills: SkillEntry[];
  files: Map<string, string>;
}

let cache: ContentCache | null = null;

function load(): ContentCache {
  if (cache) return cache;

  // Budgets — degrade gracefully over defaults.
  let budgets = DEFAULT_BUDGETS;
  try {
    const parsed = budgetsSchema.safeParse(
      YAML.parse(fs.readFileSync(path.join(AGENT_DIR, "config/budgets.yaml"), "utf-8"))
    );
    if (parsed.success) {
      budgets = parsed.data;
    } else {
      console.warn("[agent-content] budgets.yaml invalid — using defaults", parsed.error.message);
    }
  } catch {
    console.warn("[agent-content] budgets.yaml unreadable — using defaults");
  }

  // Team + skills registries — fail-fast.
  const team = teamSchema.parse(readYaml("config/team.yaml"));
  const registry = skillsRegistrySchema.parse(readYaml("config/skills.yaml"));

  // Every referenced system/skill file must exist right now (fail-fast).
  const files = new Map<string, string>();
  const ensure = (rel: string) => {
    if (!files.has(rel)) files.set(rel, readText(rel));
    return files.get(rel)!;
  };
  for (const role of team.roles) ensure(role.system);
  for (const skill of registry.skills) ensure(skill.path);

  cache = { budgets, roles: team.roles, skills: registry.skills, files };
  return cache;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getBudgets(): Budgets {
  return load().budgets;
}

export function getRoles(): RoleConfig[] {
  return load().roles;
}

export function getSkillEntry(id: string): SkillEntry | undefined {
  return load().skills.find((s) => s.id === id);
}

/** Raw file text (system card or skill body), cached. */
export function getAgentFile(relPath: string): string {
  return load().files.get(relPath) ?? readText(relPath);
}

/**
 * Role cards mark their tool-documentation section with HTML comments
 * (`<!-- ctx:tools-start -->` … `<!-- ctx:tools-end -->`). The markers are
 * stripped from what the model sees; the slices feed the Context Usage meter
 * so "Tools" (our prose tool protocol) can be counted separately from the
 * persona/rules part of the card. Cards without markers → tools = "".
 */
const TOOLS_START = "<!-- ctx:tools-start -->";
const TOOLS_END = "<!-- ctx:tools-end -->";

function splitToolSection(card: string): { before: string; tools: string; after: string } {
  const start = card.indexOf(TOOLS_START);
  const end = card.indexOf(TOOLS_END);
  if (start === -1 || end === -1 || end < start) {
    return { before: card.trim(), tools: "", after: "" };
  }
  const before = card.slice(0, start).trim();
  const tools = card.slice(start + TOOLS_START.length, end).trim();
  const after = card.slice(end + TOOLS_END.length).trim();
  return { before, tools, after };
}

/**
 * Assemble a role's system prompt: role card + skill bodies (dedup by id,
 * order preserved), capped at prompt.systemPromptCapChars.
 *
 * extraSkillIds (Phase 5 delegate): additional skills appended after the
 * role's defaults — used by team-delegate's optional `skills` field. Unknown
 * ids are skipped here; the caller (runtime) records which were injected.
 *
 * `parts` exposes the SAME text split for context accounting:
 * system (card minus tool docs) + tools (protocol docs) + skills (bodies).
 */
export function buildSystemPrompt(
  roleId: string,
  extraSkillIds: string[] = []
): {
  prompt: string;
  injectedSkillIds: string[];
  parts: { system: string; tools: string; skills: { id: string; body: string }[] };
} {
  const state = load();
  const role = state.roles.find((r) => r.id === roleId);
  if (!role) throw new Error(`[agent-content] unknown role: ${roleId}`);
  if (!role.enabled) throw new Error(`[agent-content] role disabled: ${roleId}`);

  const cap = state.budgets.prompt.systemPromptCapChars;
  const card = splitToolSection(getAgentFile(role.system).trim());
  // Assembled role text — same bytes the card carried, markers stripped.
  const roleText = [card.before, card.tools, card.after].filter(Boolean).join("\n\n");
  const parts: string[] = [roleText];
  let used = roleText.length;

  const injectedSkillIds: string[] = [];
  const skillBodies: { id: string; body: string }[] = [];
  const seen = new Set<string>();
  const ordered = [
    ...role.skills,
    ...extraSkillIds.filter((id) => !role.skills.includes(id)),
  ];
  for (const id of ordered) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = state.skills.find((s) => s.id === id);
    if (!entry) {
      // Delegate-supplied ids may reference anything — skip unknowns quietly
      // (the runtime records what was actually injected).
      if (!role.skills.includes(id)) continue;
      throw new Error(`[agent-content] role ${roleId} references unknown skill: ${id}`);
    }
    const body = getAgentFile(entry.path).trim();
    if (used + body.length + 4 > cap) {
      parts.push(`[skill ${id} omitted: prompt budget reached]`);
      break;
    }
    parts.push(body);
    skillBodies.push({ id, body });
    used += body.length + 4;
    injectedSkillIds.push(id);
  }

  return {
    prompt: parts.join("\n\n"),
    injectedSkillIds,
    parts: {
      system: [card.before, card.after].filter(Boolean).join("\n\n"),
      tools: card.tools,
      skills: skillBodies,
    },
  };
}
