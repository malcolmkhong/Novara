# Novara — Phase 1–5 Final Close-Out

**Date: 2026-11-06 (UTC). This document is the ARC INDEX: one screen per
phase, what shipped, what stays honest, what remains open. The per-phase
records in this folder remain the evidence source of truth — every number
below is cited from them (embedded at production time), never re-derived.**

Approval state: Phases 1–4 CLOSED (records: phase1-2-closeout.md,
phase3-stages.md, phase4-stages.md). Phase 5 stages a–c EXECUTED and
delivered (phase5-stages.md §P5-A/B/C); **P5-d is a GATE, not a stage** —
its document (phase5-gate-p5d.md) ships with this close-out and awaits the
user's ruling. Both enablement features remain INERT.

---

## Phase 1 — Agent runtime core (CLOSED)

Leader loop, canonical transcripts (AgentMessage), run/task/event board,
lease-fenced executor with CAS + epoch fencing, checkpoint/resume
(stateJson), approval gates. Verified by verify-stage-a (17 checks, still
green in every later regression set).

## Phase 2 — Context management (CLOSED, compaction INERT)

Model registry (`src/lib/novara/models.ts` — single source of truth; request
side carries the registry id or NO model field, which the ledger records as
`gateway-default`); system-card wire v1 (fake-assistant replay, byte-identical
guarantee); context budgets with the paired-write protocol; compaction
DESIGNED and validated inert: 79.1% Σprompt counterfactual on the real final
chain head, guards G1⇒SKIP / G2⇒PROCEED measured, slack 256 —
`contextCompaction.enabled=false` to this day (P5-d decides).

## Phase 3 — Writer UI + metering ground truth (CLOSED)

Writer app (dashboard/workspace), agent console, create wizard (3-a/3-b
records). §P3-A meter investigation established the billing boundary facts
the whole cost layer now rests on: gateway rate-limit headers are CALL-COUNT
quotas (`limit-daily 300`, `user-10min 30`, two undocumented daily counters),
observable only by spending, no billing API, response echoes rewritten —
hence: request-side modelId is the only honest pricing key, and the Balance
row renders unavailable-not-fabricated.

## Phase 4 — Slicing + live-fire discipline (CLOSED, slicing INERT)

`contextSlicing` shipped inert with the measured pack: per-shape savings
−47.5% (sage:chapter) … −83.5% (forge:chapter); A1 live-fire −44.0% chars /
−19.6% billed-truth; floor byte-identity on all 20 shapes. P4-B born the
operational law still in force: **OPS-1** (free-flash write-protocol
weakness — never attribute protocol errors to wire/meter/ledger before
checking the model tier) and **OPS-2** (~15-minute sandbox process-group
reap — hardened rig mandatory beyond ~10 minutes).

## Phase 5 — Usage ledger, central view, pricing (a–c EXECUTED; d = GATE)

- **P5-a — persisted core.** `UsageCall` + `UsageProvenance`: one row per
  HTTP attempt at every send site; plain-string scope links, NO foreign key,
  NO cascade (Ruling 1 — account history survives novel deletion, orphans
  render "(deleted novel)", no purge path exists); measured-only (null usage
  ⇒ no row); fire-and-forget writes; provenance seams at both creation
  points (studio-init server-side, wizard client-session), idempotent per
  (correlationId, novelId). TEAM-1 (ai-team backend without its schema
  models) found read-only and filed.
- **P5-b — failed-call accounting + single source + central view.** Policy F
  pinned (F1 per-attempt rows; F2 ultimately-failed = only failed rows; F3
  pre-send = nothing; F4 no-usage completion = nothing; zero tokens on
  failed rows mean UNKNOWN); the in-memory ledger DELETED outright (Ruling
  2 — file + route + all consumers gone); guest-session badge census passed
  on every spend-producing surface; central "Usage & balance" view mounted
  there; Context Usage panel swapped at Layer 3 with THIS-CALL/THIS-RUN
  byte-identical (screenshot-pinned). Latent P5-a defect (detect routes
  missing import, 59-minute window, zero real calls — see §P5-C) found by
  re-audit, disclosed, fixed.
- **P5-c — pricing + per-model split + invoice reconciliation.** Pricing
  module `src/lib/usage/pricing.ts`: versioned static table (`2026-11-06.1`)
  keyed by request-side modelId, every price sourced to a LIVE-fetched docs
  snapshot (fetched 2026-11-06: GLM-4.6 0.6/2.2 cached 0.11;
  GLM-4.5-Air 0.2/1.1; NO row for glm-4-flash/glm-4-long — their docs page
  404s) — cached discount NEVER applied, so every figure is an ESTIMATE and
  an UPPER BOUND; gateway-default rows render UNPRICED, never guessed,
  never $0. Per-model split with failed COUNT disclosed separately next to
  each model's estimate (failed rows contribute zero tokens by definition).
  Invoice reconciliation: paste-slot in the central view + `UsageInvoice`
  storage (user figure verbatim vs OUR captured ESTIMATE, delta = labeled
  display math) — the actual number is a USER-INPUT DEPENDENCY (stated in
  the P5-c report; waits on the account holder's one console row).
  Browser-verified golden path; one real UI defect (popover taller than the
  viewport) caught and fixed by that verification.
- **P5-d — enablement gate: DOCS ONLY** (phase5-gate-p5d.md). Nothing flips
  without the ruling. Recommended order: slicing first, compaction second.

---

## Standing risk register (all OPEN entries)

| id | fact | disposition |
|---|---|---|
| OPS-1 | free-tier flash fails paired write protocol under loose goals | tightened goals; tier checked first on protocol errors; billable-tier caveat carried into P5-d |
| OPS-2 | sandbox reaps process groups at ~15 min | hardened rig (detached executor + state file + standalone evidence pass) mandatory >~10 min |
| OPS-3 | killed P5-b probe NOT DIFFABLE (baseline-absent; window closed) | bounded worst case ≤1 unrecorded completion; **mock-first is the standing rule for all future probes** |
| TEAM-1 | ai-team backend re-added without its six schema models; panel 500s | pre-existing defect OUT of Phase 5 scope; repair options on the table (restore / rebuild / remove) — user decides separately |

## Honest boundaries of the shipped system

1. The ledger's history begins at Phase 5 (`since` rendered everywhere);
   nothing pretends otherwise; there is NO backfill and NO purge path.
2. Every dollar figure is an ESTIMATE upper bound (cached discount
   invisible); unpriced models render UNPRICED; the balance row renders
   unavailable-not-fabricated.
3. Failed attempts are visible as counts with kinds; their token zeros mean
   UNKNOWN, never "0 billed".
4. The invoice comparison is pending one user-supplied console row; until it
   arrives the paste-slot says exactly that.
5. Both Phase-2 compaction and Phase-4 slicing are OFF; the P5-d gate document
   is the only path to ON.

## Verification estate at close (all green 2026-11-06)

verify-stage-a 17 · verify-p2-a 13 · verify-p2-b 35 · verify-p2-c 46 ·
verify-p4 38 · verify-p5 24 · verify-p5-b 24 · **verify-p5-c 30 (new)** —
plus lint clean, dev health probed, browser golden paths verified with
evidence screenshots in this folder.

## Open items after this close-out

1. P5-d ruling (the gate document) — the ONLY remaining Phase 5 decision.
2. Invoice reconciliation row (user-input dependency — see P5-c report §"What
   I need you to fetch").
3. TEAM-1 repair decision (separate, user-ruled).
4. Purge path / account-level actions — deliberately NOT built (Ruling 1
   documents the policy); if ever built it must be explicit, never a cascade.
