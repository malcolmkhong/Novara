# Novara — Standing Risk Register

Established 2026-11-05. The Phase 2 risk register (p2-design.md §8) is CLOSED —
all seven items CLOSED or HELD. This file is the standing, cross-phase register
for operational facts discovered during phase work that outlive their phase.
Entries are docs-only pins: evidence is cited from the phase records (embedded
there verbatim at production time), never from /tmp logs or DB rows.

---

## OPS-1 — Free-tier flash model write-protocol weakness (OPEN)

**Fact.** `glm-4-flash` (free tier) demonstrably fails the paired write
protocol under multi-turn agent dispatch. On the P4-B attempt-3 live run, the
sage write task produced **5 consecutive protocol errors** — the model sent
`create_chapter` WITHOUT the paired ```novel-write prose block — across 2
repair rounds; the leader re-dispatched (Task 2) and the run was reaped before
the re-dispatch could be judged.

**What it is NOT (bounded, so nobody misattributes):**
- NOT a slicing/wire defect — the envelope was correctly sliced (20,567 chars)
  while the protocol errors occurred (phase4-stages.md §P4-B attempt #3).
- NOT a repair-machinery failure — the ≤2-round repair loop behaved as
  designed; the model exhausted it.
- NOT a metering artifact — the failures were behavioral (missing paired
  block), observed in transcript rows.

**Mitigation that worked.** Goal tightening — "write immediately,
prose+create_chapter in ONE reply, 500–700 words" — produced a completed,
verified write on attempt #4 (`verified.words=382` == DB truth).

**Disposition / impact on future phases.**
1. Any live-fire validation on the free tier uses the tightened-goal pattern;
   loose goals on flash are a known protocol-error generator.
2. Protocol errors on a live run must NEVER be attributed to wire / meter /
   slicing / ledger changes until the model tier is checked first.
3. Billable-tier behavior (glm-4.6) on this exact protocol shape is
   UNEXERCISED in surviving evidence — free-flash runs are a weak proxy for
   production-model reliability, and enablement decisions (Phase 5 gates)
   must carry that caveat.

**Evidence:** agent-ctx/phase4-stages.md §P4-B attempt history #3 and #4
(verbatim, embedded 2026-11-05).

---

## OPS-2 — Sandbox ~15-minute process-group reap (OPEN)

**Fact.** Background processes in this sandbox are reaped at ~15 minutes, and
the reap takes the whole process group. Three independent observations:
- P2-c attempt 1: died to sandbox process cleanup mid-run
  (phase1-2-closeout.md §3).
- P4-B attempt #3: controller + executor child **both** died at ~15 min
  despite `setsid` on the controller (the child shared the controller's
  process group).
- P4-B attempt #4: the controller was reaped again mid-poll — but the
  hardened architecture absorbed it.

**What survives (the proven pattern).** FULL session detachment of the worker
(`setsid` via `sh` into its own session, file-redirected output) + a persisted
pre-run state file so evidence and cleanup are a STANDALONE pass
(`p4-live-evidence.ts`). Attempt #4's executor finished the run in its own
session after the controller died, and the standalone evidence pass ran clean.

**Disposition / impact on future phases.**
1. Any Phase 5+ live-fire acceptance run expected to exceed ~10 minutes MUST
   use the hardened P4 rig (detached executor + state file + standalone
   evidence pass) or be chunked into shorter stages.
2. A controller left in a background shell must be assumed dead at ~15 min;
   nothing critical may live only in controller memory or /tmp logs.
3. Evidence discipline (embed at production time) is the standing mitigation —
   this entry explains WHY the discipline exists in operational terms.

**Evidence:** agent-ctx/phase4-stages.md §P4-B attempts #3 and #4;
agent-ctx/phase1-2-closeout.md §3 (P2-c attempt 1) — all verbatim, embedded
at production time 2026-11-05.
