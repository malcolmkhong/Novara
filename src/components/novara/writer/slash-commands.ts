// ---------------------------------------------------------------------------
// Novara AI — slash command registry (P3 command layer).
//
// The "/" layer is prompt-template sugar only: each command expands into a
// goal text that the author reviews and sends through the normal composer
// (POST /api/agent/runs). Nothing here touches the runtime — agent powers
// stay exactly what team.yaml + the tool whitelist already grant.
//
// /next is mode-aware: in approval mode the team proposes and waits at the
// gate; in full_access mode it plans and executes autonomously. That mapping
// needs no new machinery — AgentRunMode already drives both behaviors, the
// goal text just makes the intent explicit for Atlas.
// ---------------------------------------------------------------------------

import type { AgentRunMode } from "@/lib/novara/agent-types";

export interface SlashCommand {
  id: string;
  /** Menu label, including the leading slash. */
  command: string;
  /** One-line menu description. */
  description: string;
  /** Optional second menu line (e.g. /next's per-mode behavior). */
  detail?: string;
  /** Right-aligned argument hint, e.g. "chapter". */
  paramHint?: string;
  /** Goal text that replaces the "/query" token in the draft. */
  buildGoal: (args: string, mode: AgentRunMode) => string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "next",
    command: "/next",
    description:
      "Not sure what to do next? The team identifies the next best steps and recommends options.",
    detail:
      "Approval: proposes a plan and waits for your review · Full access: plans and executes autonomously.",
    buildGoal: (_args, mode) =>
      mode === "full_access"
        ? "Assess the current novel state against the outline, bible and ledger. Decide the next best steps, put the execution plan on the board, and carry it out autonomously through the gates."
        : "Assess the current novel state against the outline, bible and ledger. Identify the next best steps and recommend available options with a recommended plan. Present the plan for my review — wait at the approval gate before any writes.",
  },
  {
    id: "write",
    command: "/write",
    description: "Draft a chapter — Sage writes, Atlas dispatches and verifies.",
    paramHint: "chapter",
    buildGoal: (args) => {
      const target = args ? `chapter ${args}` : "the next chapter";
      return `Write ${target}. Follow the outline beat and the story bible, hit the length plan within ±20%. Draft via create_chapter/update_chapter, then report real counters.`;
    },
  },
  {
    id: "review",
    command: "/review",
    description: "Structured review — issue list, then finalize & settle if clean.",
    paramHint: "chapter",
    buildGoal: (args) => {
      const target = args ? `chapter ${args}` : "the newest draft chapter";
      return `Review ${target}. Produce a structured issue list; numbers are audited, blocking is decided server-side. If 0 blocking issues, finalize_chapter then settle_chapter in the same task.`;
    },
  },
  {
    id: "outline",
    command: "/outline",
    description: "Plan or adjust the beat board — planning only, no prose.",
    buildGoal: () =>
      "Plan the next chapters: decompose the goal into outline beats and update the beat board. Planning only — no chapter drafting in this run.",
  },
  {
    id: "recap",
    command: "/recap",
    description: "Settle memory — digests, ledger and bible from what was written.",
    buildGoal: () =>
      "Settle the book's memory: summarize recent chapters into digests and reconcile the ledger (storylines, timeline, arcs, promises, clues) against the current manuscript. Housekeeping only — no new chapters.",
  },
  {
    id: "doctor",
    command: "/doctor",
    description: "Continuity scan across the whole novel — report only, no rewrites.",
    buildGoal: () =>
      "Scan the novel for continuity problems — contradictions between chapters, unresolved setups and promises, bible drift. Report findings only; do not rewrite anything.",
  },
];

/**
 * Filter the menu by the text after "/". Matches the command name only (the
 * word before any arguments); once the name matches exactly, typing args
 * keeps that single row highlighted.
 */
export function filterSlashCommands(
  commands: SlashCommand[],
  query: string
): SlashCommand[] {
  const name = query.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (!name) return commands;
  const exact = commands.filter((c) => c.command.slice(1) === name);
  if (exact.length > 0) return exact;
  return commands.filter((c) => c.command.slice(1).startsWith(name));
}
