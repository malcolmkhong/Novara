// ---------------------------------------------------------------------------
// Novara AI — behavioral QC evals (Phase 6, plan §Phase6 "行为 evals").
//
// Fixtures-style probes over the PURE decision layers of the pipeline — zero
// AI calls, zero DB. The rule they enforce: "what the eval verifies is
// literally what the gate runs" — every probe imports the same function the
// runtime/routes use (no re-implementations).
//
// Exposed via GET /api/agent/qc/evals and rendered in the QC artifact panel.
// ---------------------------------------------------------------------------

import { parseAgentTurn } from "@/lib/agent/tool-protocol";
import { assessOverwrite } from "./write-gate";
import { auditReport, evaluateFinalize, evaluateRepair, evaluateSettle } from "./qc";
import { parseLooseJson } from "./parse-json";
import { parseSedimentLines } from "./sediment";
import { countWords } from "./words";
import { formatMemoryLines, type ScoredMemoryItem } from "./memory";
import { getBudgets } from "./content";

export interface EvalCheck {
  id: string;
  group: string;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  ms: number;
}

export interface EvalReport {
  checks: EvalCheck[];
  passed: number;
  failed: number;
  totalMs: number;
  runAt: string;
}

type Probe = () => Promise<{ expected: string; actual: string; pass: boolean }>;

function check(id: string, group: string, name: string, probe: Probe): Promise<EvalCheck> {
  const t0 = Date.now();
  return probe()
    .then(({ expected, actual, pass }) => ({
      id,
      group,
      name,
      pass,
      expected,
      actual,
      ms: Date.now() - t0,
    }))
    .catch((error) => ({
      id,
      group,
      name,
      pass: false,
      expected: "no throw",
      actual: error instanceof Error ? error.message : String(error),
      ms: Date.now() - t0,
    }));
}

const eq = (expected: unknown, actual: unknown) => ({
  expected: JSON.stringify(expected),
  actual: JSON.stringify(actual),
  pass: JSON.stringify(expected) === JSON.stringify(actual),
});

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

function protocolProbes(): Promise<EvalCheck>[] {
  return [
    check("protocol-jsonrepair", "protocol-tolerance", "malformed tool JSON is salvaged", async () => {
      const turn = parseAgentTurn('```novel-tool\n{"action":"read_novel",}\n```');
      return eq("read_novel", turn.toolCalls[0]?.action?.action ?? null);
    }),
    check("protocol-unclosed", "protocol-tolerance", "unclosed novel-write fence is salvaged", async () => {
      const turn = parseAgentTurn("Draft follows.\n```novel-write\nRain fell on the pier.");
      return eq("Rain fell on the pier.", turn.novelWrite);
    }),
    check("protocol-write-no-action", "protocol-tolerance", "prose without a write action is kept for the repair note", async () => {
      const turn = parseAgentTurn("```novel-write\nSome prose.\n```");
      return eq({ prose: true, writeActions: 0 }, { prose: turn.novelWrite !== null, writeActions: turn.toolCalls.filter((t) => t.action?.action === "create_chapter" || t.action?.action === "update_chapter").length });
    }),
    check("protocol-blocked", "protocol-tolerance", "BLOCKED line becomes an honest refusal", async () => {
      const turn = parseAgentTurn("I cannot do that.\nBLOCKED: chapter 1 is empty and the outline has no beats for it.");
      return eq("chapter 1 is empty and the outline has no beats for it.", turn.blockedReason);
    }),
    check("protocol-delegate", "protocol-tolerance", "team-delegate orders parse with assignee", async () => {
      const turn = parseAgentTurn('```team-delegate\n[{"title":"Draft Chapter 4","detail":"cover the ledger reveal","assignee":"sage","artifactType":"chapter","artifactLabel":"Chapter 4"}]\n```');
      return eq({ count: 1, assignee: "sage" }, { count: turn.delegates.filter((d) => d.order).length, assignee: turn.delegates[0]?.order?.assignee ?? null });
    }),
    check("protocol-run-report", "protocol-tolerance", "run-report numbers are extracted", async () => {
      const turn = parseAgentTurn('```run-report\n{"chaptersWritten":1,"words":539}\n```');
      return eq({ chaptersWritten: 1, words: 539 }, turn.runReport);
    }),
    check("protocol-json-fences", "protocol-tolerance", "loose JSON extraction survives markdown fences", async () => {
      const parsed = parseLooseJson('Here you go:\n```json\n{"issues":[]}\n```');
      return eq({ issues: [] }, parsed);
    }),
  ];
}

function gateProbes(): Promise<EvalCheck>[] {
  return [
    check("overwrite-empty", "write-gate", "empty chapter accepts a fresh draft", async () =>
      eq(false, assessOverwrite({ existingContent: "", incomingContent: "New prose.", overwrite: undefined }).blocked)
    ),
    check("overwrite-nonempty", "write-gate", "non-empty replacement without confirmation is blocked", async () =>
      eq(true, assessOverwrite({ existingContent: "Old prose.", incomingContent: "New prose.", overwrite: undefined }).blocked)
    ),
    check("overwrite-confirmed", "write-gate", "explicit overwrite confirmation passes the gate", async () =>
      eq(false, assessOverwrite({ existingContent: "Old prose.", incomingContent: "New prose.", overwrite: true }).blocked)
    ),
    check("e2-finalize-clean", "e2-gate", "clean review allows finalize", async () => {
      const v = evaluateFinalize({ latestBlockingCount: 0, wordCount: 539 });
      return eq({ allowed: true, code: "ok" }, { allowed: v.allowed, code: v.code });
    }),
    check("e2-finalize-blocking", "e2-gate", "open blocking issues refuse finalize", async () => {
      const v = evaluateFinalize({ latestBlockingCount: 2, wordCount: 539 });
      return eq({ allowed: false, code: "blocking_open" }, { allowed: v.allowed, code: v.code });
    }),
    check("e2-finalize-unreviewed", "e2-gate", "a never-reviewed chapter cannot be finalized", async () => {
      const v = evaluateFinalize({ latestBlockingCount: null, wordCount: 539 });
      return eq({ allowed: false, code: "no_review" }, { allowed: v.allowed, code: v.code });
    }),
    check("e2-finalize-empty", "e2-gate", "an empty chapter cannot be finalized even with a clean review", async () => {
      const v = evaluateFinalize({ latestBlockingCount: 0, wordCount: 0 });
      return eq({ allowed: false, code: "empty_chapter" }, { allowed: v.allowed, code: v.code });
    }),
    check("e2-settle-blocking", "e2-gate", "settle refuses while blocking issues are open", async () => {
      const v = evaluateSettle({ latestBlockingCount: 1, wordCount: 300 });
      return eq({ allowed: false, code: "blocking_open" }, { allowed: v.allowed, code: v.code });
    }),
    check("e2-repair-budget", "revision-loop", "third repair round after blocking is refused", async () => {
      const v = evaluateRepair({ latestBlockingCount: 1, repairRoundsUsed: 2, maxRevisionRounds: getBudgets().qc.revisionRounds });
      return eq({ allowed: false, code: "budget_exhausted" }, { allowed: v.allowed, code: v.code });
    }),
    check("e2-repair-within-budget", "revision-loop", "first repair round is allowed", async () => {
      const v = evaluateRepair({ latestBlockingCount: 1, repairRoundsUsed: 0, maxRevisionRounds: getBudgets().qc.revisionRounds });
      return eq(true, v.allowed);
    }),
    check("e2-repair-normal-rewrite", "revision-loop", "ordinary rewrite (no blocking findings) skips the budget", async () => {
      const v = evaluateRepair({ latestBlockingCount: null, repairRoundsUsed: 5, maxRevisionRounds: 2 });
      return eq(true, v.allowed);
    }),
    check("audit-mismatch", "digital-audit", "claimed numbers that drift from DB are flagged", async () => {
      const issues = auditReport({ words: 666, chaptersWritten: 3 }, { words: 539, chaptersWritten: 1 });
      return eq(2, issues.length);
    }),
    check("audit-honest", "digital-audit", "matching claimed numbers pass clean", async () => {
      const issues = auditReport({ words: 539, chaptersWritten: 1 }, { words: 539, chaptersWritten: 1 });
      return eq(0, issues.length);
    }),
  ];
}

function lineProbes(): Promise<EvalCheck>[] {
  const fixture = [
    "SUMMARY: Mara signs the ledger and the tide turns against her.",
    "FACT: world_rule | The harbor ledger records every debt twice — once in ink, once in blood.",
    "FACT: story_fact | Mara Chen now holds the original ledger.",
    "STATE: Mara Chen | Cornered, holding the ledger, unsure who to trust.",
    "PLANT: The ledger's last page is written in a language Mara cannot read.",
    "ADVANCE: ledger-id-1",
    "PAID: ledger-id-2",
  ].join("\n");

  return [
    check("sediment-lines", "line-protocols", "sediment row protocol extracts every record type", async () => {
      const parsed = parseSedimentLines(fixture);
      return eq(
        { summary: 1, facts: 2, states: 1, plants: 1, advance: 1, paid: 1 },
        { summary: parsed.summary ? 1 : 0, facts: parsed.facts.length, states: parsed.characterStates.length, plants: parsed.plants.length, advance: parsed.advanceIds.length, paid: parsed.paidIds.length }
      );
    }),
    check("sediment-category-guard", "line-protocols", "unknown fact categories are dropped", async () => {
      const parsed = parseSedimentLines("FACT: rumor | Something vague.\nFACT: story_fact | A real one.");
      return eq([1, "story_fact"], [parsed.facts.length, parsed.facts[0]?.category ?? null]);
    }),
    check("memory-format-clip", "line-protocols", "memory feed lines clip content to the item budget", async () => {
      const budgets = getBudgets().memory;
      const long = "x".repeat(budgets.itemContentChars + 200);
      const item: ScoredMemoryItem = {
        id: "probe-1",
        category: "story_fact",
        content: long,
        sourceChapter: 3,
        firstSeen: new Date("2026-01-01T00:00:00Z").toISOString(),
        lastSeen: new Date("2026-01-02T00:00:00Z").toISOString(),
        score: 1,
        lastSeenChapter: 3,
      };
      const [line] = formatMemoryLines([item]);
      return eq(true, (line?.length ?? Infinity) <= budgets.itemContentChars + 60);
    }),
    check("words-cjk-latin", "words", "word count handles CJK and latin", async () =>
      eq({ latin: 3, cjk: 5 }, { latin: countWords("The gray pier"), cjk: countWords("码头上的雨") })
    ),
  ];
}

export async function runQcEvals(): Promise<EvalReport> {
  const t0 = Date.now();
  const checks = [...protocolProbes(), ...gateProbes(), ...lineProbes()];
  const results = await Promise.all(checks);
  return {
    checks: results,
    passed: results.filter((c) => c.pass).length,
    failed: results.filter((c) => !c.pass).length,
    totalMs: Date.now() - t0,
    runAt: new Date().toISOString(),
  };
}
