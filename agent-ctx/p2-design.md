# Novara Phase 2 — Context Compaction Design (CORRECTED, post-review)

Status: **v2 draft — supersedes the original proposal's §3/§8.** Points 1–3 of the
review are folded in here. P2-a/P2-b proceed under this document; **P2-c does not
start until this corrected design is explicitly confirmed.**

Review deltas honored:
1. **STRUCTURAL** — compaction eligibility decoupled from `contextSpec` (§1 below).
2. **CLARIFICATION** — multi-summary composition, contiguity invariant, fencing
   stated exactly (§2 below).
3. **TIGHTENING** — §8 arithmetic demoted to predictions; all projected caps and
   Σprompt reductions are measured from the P2-b/P2-c counterfactual harness and
   pasted as numbers in those stage reports (§3 below).

---

## §1 — Compaction eligibility (STRUCTURAL fix)

**Old (wrong):** compaction gated on `contextSpec === "v2"` ⇒ unexecutable during
Phase 2 (all Phase 2 runs are v1; the v2 wire flip is Phase 3's first step).

**Corrected rule:**

- Compaction eligibility is governed ONLY by `budgets.contextCompaction`:
  - `enabled: true`, AND
  - metered active-context tokens ≥ `triggerTokens`, AND
  - coverable rows (envelope-boundary → candidate cut) ≥ `minCompactableRows`.
  `contextSpec` plays **no** role in eligibility.
- `contextSpec` governs ONLY system-prompt delivery on the wire:
  - `"v1"` — system card replayed as the fake assistant message (`system_note`
    row, today's wire). Phase 2 runs are v1; the column defaults to `"v1"` and
    Phase 2 never writes anything else.
  - `"v2"` — native system message (Phase 3's first step flips it).

**v1 guarantee, restated:**

- `v1 + compaction disabled` ⇒ replayed wire is **byte-identical to today's**
  (asserted by the P2-b counterfactual harness against real persisted transcripts).
- `v1 + compaction enabled` ⇒ replayed wire is a **read-side projection**:
  `[system_note][envelope][summary projection][verbatim tail rows > cut]` —
  non-identical **by design**, and metered as what is actually sent (the meter's
  conversation section reflects the projected wire, never the raw transcript).

Compaction is orthogonal to system-delivery format. Under v1 the projection keeps
`system_note` + `envelope` verbatim (they are the conversation anchor) and
compresses only what follows the envelope boundary. The original "byte-identical"
promise was about system delivery via replay — never a promise that the full
transcript must always replay uncompressed.

---

## §2 — Multi-summary replay composition (CLARIFICATION)

### 2.1 Composition rule: ABSORB-CHAIN (chosen)

- At any moment there is **exactly one ACTIVE** `ContextSummary` row per
  `(runId, conversationId)` (`supersededAt IS NULL`).
- Compaction N+1 absorbs: input = (active summary text) + (verbatim AgentMessage
  rows in `(priorCut, newCut]`) → **ONE new row** with:
  - `fromSeq` = envelope.seq + 1 — reaches back to the FIRST compacted seq;
  - `toSeq` = newCut;
  - `summary` = absorbed text;
  - then the prior active row is fenced-superseded (`supersededAt = now`).
- Replay = **newest active row only** + verbatim tail ⇒ the active-context cap
  stays **flat** regardless of how many compactions fire.
- Auditability holds because the originals are never touched: AgentMessage rows
  are immutable; every summary row declares its cover `[fromSeq..toSeq]`, so any
  projection can be re-derived, diffed, and audited after the fact. Stacked
  (replay all chain rows) is rejected — cost grows per compaction, defeating the
  cap.

The summary rides the wire as a deterministic, versioned user-message frame
(marker text defined byte-exact in P2-b, e.g. `[CONTEXT SUMMARY — seq X..Y
absorbed; verbatim originals remain in the canonical transcript] …`). The
covering range includes marker kinds (`gate_stop`/`resume_note`) so the seq
domain has no holes; markers remain non-replayable and are simply absorbed as
content like everything else.

### 2.2 Contiguity invariant (fail loud, never silent)

On every compacted replay, the active summary must form ONE contiguous cover
from the envelope boundary:

- `summary.fromSeq === envelopeSeq + 1`, AND
- `summary.toSeq + 1 === firstReplayedTailRow.seq` (or `summary.toSeq === maxSeq`
  when the tail is empty — possible only if `tailTurns` were consumed by markers).

AgentMessage seqs are dense by construction (MAX+1 allocation, unique index, no
deletes), so any violation means a corrupt/foreign summary row.

**Violation handling:** fall back to the FULL raw replay for that conversation
(raw rows are always intact and always safe) + fail loud: `console.error` AND an
`AgentEvent(kind="error")` naming the row and the gap. **Content is never
silently dropped.**

### 2.3 Fencing / idempotence

- Only the leaseholder compacts — compaction runs inside the leader/member loop
  under the same lease guard as every append and checkpoint.
- **Lease changes hands mid-compaction:** the summary write is a lease-verified
  interactive transaction — (a) re-verify `(owner, epoch)` on AgentRun, (b)
  insert the new `ContextSummary` row stamped `leaseEpoch`, (c) conditional
  supersede of the prior active row. If the lease was lost, the transaction
  aborts: **the loser's write lands count=0, the winner's row stands**. The
  winner never trusts or adopts the loser's partial work — it recomputes its own
  summary from canonical AgentMessage (summaries are DERIVED state, always
  recomputable, never authoritative).
- **Idempotence per cut point:** `@@unique([runId, conversationId, toSeq])`. A
  crash→retry that re-attempts the same cut hits P2002 and treats the existing
  active row at that `toSeq` as done. Re-compaction after new turns gets a new
  `toSeq` — a new chain link, per 2.1.
- Compaction fires **between turns** (after a turn's transcript batch is
  appended, before the next model call) — never mid-turn, never concurrent with
  a fenced append of the same conversation.

---

## §3 — §8 arithmetic demoted to predictions (TIGHTENING)

The original §8 numbers (claimed flat active-context "4.6–5K") are **withdrawn
as claims**. The reviewer's arithmetic (~6.4K: tail 8 turns × ~250 tok +
envelope ~2.0K + fixed overhead ~1.8K + summary ~0.6K) is adopted as the
**standing prediction**.

No hand math in stage reports. The P2-b/P2-c counterfactual harness replays
**real persisted transcripts** (Phase 1 runs in `db/custom.db`) through:

1. today's replay path, and
2. the P2 assembler with compaction **disabled** → assert byte-identical, report
   measured token counts; and
3. the P2 assembler with a **lowered threshold** (P2-c's one flash run) → report
   the measured projected cap and measured Σprompt reduction.

Those measured numbers are pasted into the P2-b and P2-c stage reports.
§8 numbers are predictions to be checked, not claims to be defended.

---

## §4 — Additive footprint (unchanged constraint, now concretely)

Exactly:

- **One table** — `ContextSummary` (see schema: cover range, absorbed text,
  `leaseEpoch` fencing token, `supersededAt` chain-head marker,
  `@@unique([runId, conversationId, toSeq])` idempotence). Cascade-deletes with
  the run; AgentMessage is untouched by design.
- **One column** — `AgentRun.contextSpec String @default("v1")`.
- **One config section** — `budgets.contextCompaction` (`enabled=false` shipped
  inert; `triggerTokens`, `tailTurns`, `minCompactableRows`).

No new dependencies. No UI changes. No business-logic changes: compaction is a
read-side projection plus derived rows; canonical history (AgentMessage) is
NEVER rewritten — compaction summaries coexist with the transcript by range.

### Back-compat summary (restated)

- `v1 + compaction disabled` ⇒ wire byte-identical to today (P2-b assertion).
- `v1 + compaction enabled` ⇒ wire = projection + verbatim tail; non-identical
  by design; metered as sent.
- `contextSpec` changes only WHERE the system card sits on the wire, never its
  content; the flip to v2 is Phase 3's first step and out of Phase 2 scope.

---

## §5 — Stage plan & harness assertions

Stages: P2-a (inert schema+config+harness) → P2-b (assembler + counterfactual
byte-identity + disabled-default) → P2-c (one short flash run, lowered threshold,
summary range + absorb-chain + fence evidence) → P2-d (wrap-up report).
Report after each; wait for confirmation before the next.

`verify-stage-a.ts` stays green at every stage. Sibling harnesses carry the
P2-stage assertions:

- **P2-a:** `contextSpec` defaults to `"v1"`; `ContextSummary` inert round-trip;
  absorb-chain supersede shape; P2002 per-cut idempotence; cascade delete;
  config parses with `enabled=false`; canonical replay untouched; zero summary
  rows written by any live path.
- **P2-b:** summary write/read/fence; supersede/contiguity (incl. gap → loud
  fallback); **disabled ⇒ byte-identical** on real persisted transcripts;
  **merged-user-wire shape** (consecutive user messages preserved verbatim —
  e.g. resume wire ending `…tool_results(user), resume_note(user)` is replayed
  as-is, never merged); meter reflects projected wire.
- **P2-c:** live-run evidence — summary row range correct, chain head unique,
  fence verdicts, measured-vs-predicted §8 table, usage reconciliation.

GLM discipline: P2-c = 1 short flash run with lowered threshold; everything
else zero-GLM.
