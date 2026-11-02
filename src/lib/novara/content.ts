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
  glm: z.object({
    timeoutMs: z.number().int().positive(),
    routeMaxDuration: z.number().int().positive(),
    maxTurns: z.number().int().min(1).max(8),
    maxActionsPerTurn: z.number().int().min(1).max(8),
    planMaxTasks: z.number().int().min(1).max(24),
    chapterContextChars: z.number().int().min(1000),
    chapterTailChars: z.number().int().min(500),
    snapshotCastLimit: z.number().int().min(1),
    snapshotOutlineLimit: z.number().int().min(1),
    snapshotFactsLimit: z.number().int().min(1),
    repairRounds: z.number().int().min(0).max(4),
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
});

export type Budgets = z.infer<typeof budgetsSchema>;

export const DEFAULT_BUDGETS: Budgets = {
  glm: {
    timeoutMs: 60_000,
    routeMaxDuration: 90,
    maxTurns: 3,
    maxActionsPerTurn: 3,
    planMaxTasks: 8,
    chapterContextChars: 24_000,
    chapterTailChars: 6_000,
    snapshotCastLimit: 12,
    snapshotOutlineLimit: 40,
    snapshotFactsLimit: 20,
    repairRounds: 2,
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
    systemPromptCapChars: 6000,
    taskBriefCapChars: 1800,
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
 * Assemble a role's system prompt: role card + skill bodies (dedup by id,
 * order preserved), capped at prompt.systemPromptCapChars.
 */
export function buildSystemPrompt(roleId: string): string {
  const state = load();
  const role = state.roles.find((r) => r.id === roleId);
  if (!role) throw new Error(`[agent-content] unknown role: ${roleId}`);
  if (!role.enabled) throw new Error(`[agent-content] role disabled: ${roleId}`);

  const cap = state.budgets.prompt.systemPromptCapChars;
  const parts: string[] = [getAgentFile(role.system).trim()];
  let used = parts[0].length;

  for (const id of role.skills) {
    const entry = state.skills.find((s) => s.id === id);
    if (!entry) {
      throw new Error(`[agent-content] role ${roleId} references unknown skill: ${id}`);
    }
    const body = getAgentFile(entry.path).trim();
    if (used + body.length + 4 > cap) {
      parts.push(`[skill ${id} omitted: prompt budget reached]`);
      break;
    }
    parts.push(body);
    used += body.length + 4;
  }

  return parts.join("\n\n");
}
