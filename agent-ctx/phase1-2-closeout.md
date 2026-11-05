# Novara Phase 1–2 Close-Out (one page)

Date: 2026-11-05 · Scope: P2-a → P2-d, post P2-d sweep · Design doc: `agent-ctx/p2-design.md` **v4**

## 1. What shipped (additive only — no schema breaks, no UI changes, no new deps)

**P2-a — inert foundation.** `prisma/schema.prisma` (`ContextSummary` table:
cover range + leaseEpoch fence + supersededAt chain head + `@@unique([runId,
conversationId, toSeq])`, cascade w/ run; `AgentRun.contextSpec @default("v1")`)
· `agent/config/budgets.yaml` (`contextCompaction`: enabled **false**,
6000/8/12) · `src/lib/novara/content.ts` (zod) · `scripts/verify-p2-a.ts`.

**P2-b — assembler + counterfactual.** `src/lib/agent/wire.ts` (legacy replay
preserved byte-for-byte; deterministic §2.0 projection builder; pinned
`ctx-proj/v1` framing; contiguity checks; lease-fenced
`writeCompactionSummary` w/ M3 active-check) · `scripts/verify-p2-b.ts`.

**P2-c — runtime wiring + one live flash run.** `src/lib/agent/runtime.ts`
(single assembler path on resume; between-turns `maybeCompact`; fallback →
`AgentEvent(kind="error")`; M1 `liveInjections`; trigger pinned to
PROVIDER-RECONCILED promptTokens) · `scripts/verify-p2-c.ts` · probe infra
(`scripts/p2-c-probe*.ts`) · design doc v3 (M1/M2/M3 folded).

**P2-d — monotone cost guard + meter observability.** `src/lib/agent/wire.ts`
(`COMPACTION_SLACK_TOKENS=256`, `countWireTokens`, `monotoneGuardCheck`,
`guardSkipSummary` — pure, zero-GLM, single owner of the rule + wording) ·
`src/lib/agent/context-meter.ts` (`ConversationSub` compacted/tail/shared;
tagged init + `addConversation(text, tag)`; reconcile scales buckets, sum
invariant survives) · `src/lib/novara/agent-types.ts` (optional
`ContextUsage.conversationSub` — panel untouched) · `src/lib/agent/runtime.ts`
(guard ordered guard→write→rewire inside `maybeCompact`; loud skip telemetry
`guard:"monotone-cost"`; sub-bucket metering in `applyAssembly` + resume init;
injections → `shared`) · `scripts/verify-p2-c.ts` 33→45 checks (§G, §7) ·
`agent-ctx/p2-design.md` v4 (§2.3.1, §1 fourth gate, §7, §8 register) ·
`scripts/p3-usage-probe.ts` (Phase 3 evidence, 2 calls).

## 2. Measured numbers (the table that replaces §8 predictions)

| # | Measurement | Value | Source |
|---|---|---|---|
| 1 | Raw estimate vs billed (CJK-heavy) | ~1.4× undercount | P2-c live probe |
| 2 | Real-transcript counterfactual (final chain head) | **79.1% Σprompt reduction** | P2-c live run |
| 3 | Turn-6 transient anomaly (pre-guard) | 8726 → 12345 tok (billing) | P2-c live run |
| 4 | Guard fixture G1 (feed-heavy, turn-6 shape) | 3591 → 3689 (+98) ⇒ **SKIP** | verify-p2-c §G1 |
| 5 | Guard fixture G2 (normal, clips bind) | 5736 → 3626 (−2110) ⇒ **PROCEED** | verify-p2-c §G2 |
| 6 | Slack constant | 256 tok (documented, not config) | wire.ts |
| 7 | Regression quartet (final sweep) | **17 / 13 / 35 / 45 — all green** | stage-a / p2-a / p2-b / p2-c |
| 8 | Lint | clean (exit 0) | eslint |
| 9 | Shipped config at rest | enabled=false, 6000/8/12 + semantics comment | budgets.yaml |
| 10 | Context Usage panel | renders unchanged, zero console/page errors | browser check |
| 11 | P3 probe usage fields (our SDK pathway) | only 3 base fields; **no cached_tokens** | p3-usage-probe |

## 3. GLM budget across P2-c (honest accounting)

- Attempt 1+2 run (cmw3glwe…, glm-4-flash, **free**): 25 measured calls, Σbilled
  prompt ≈ **98,491 tok** (usage table in `/tmp/p2c-driver.log`); attempt 1 died
  to sandbox process cleanup mid-run (that run also produced the 1.4×
  calibration lesson: its trigger never crossed on the raw estimate).
- Attempt 3 run (cmw3hat…, glm-4-flash, **free**): the successful
  compaction+kill+resume run; exact call count unrecoverable (its log lost the
  evidence pass; run cascade-deleted by the controller) — bounded ≤ 1 leader
  run (≤22 turns + members).
- Phase 3 capability probe (glm-4.6, billable): 2 calls, **2,654 tok ≈ $0.001**
  — disclosed above.

## 4. Final risk register

Live in design doc v4 §8 — all seven items CLOSED or HELD; the two acceptance
additions are folded verbatim: #2 adjacency ("consecutive user messages
accepted, provider-tolerated, single owner = finalizeWire, no merge") and #3
transient-increase (monotone cost guard, §2.3.1).
