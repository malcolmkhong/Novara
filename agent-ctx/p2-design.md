# Novara Phase 2 — Context Compaction Design (CORRECTED, post-review)

Status: **v3 — supersedes the original proposal's §3/§8.** Review points 1–3 are
folded in (v2), and the three P2-c gate amendments M1/M2/M3 (reviewer-confirmed)
are now folded into §2 below — P2-c proceeds under this document.

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
  - **metered active-context tokens ≥ `triggerTokens`** — measured as the
    last model call's PROVIDER-RECONCILED prompt tokens (the billed truth for
    the wire just sent) when available, else the meter's raw `used` estimate.
    Pinned live in the P2-c probe: the raw estimator undercounts this
    CJK-heavy corpus ~1.4× vs the provider's billing, so the estimate alone
    can never be trusted for a threshold decision — the reconciliation
    (context-meter.ts) exists for exactly this reason, AND
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

### 2.0 Projection builder — BINDING INPUT RULE (review point 1, resolved)

The original text contradicted itself ("absorbs active summary text + rows" vs
"winner recomputes from canonical AgentMessage"). The contradiction is resolved
FOR EVERYWHERE by the reviewer's rule, which is now the single binding
statement:

> **Every summary row is a DETERMINISTIC, ZERO-GLM projection recomputed from
> the raw canonical AgentMessage rows over `[fromSeq..toSeq]` ONLY. Prior
> summary text is NEVER an input. The superseded row exists solely to (a)
> define the prior cut and (b) serve as the audit trail of cuts.**

Consequences, all intended:

- **No loss compounding** — a summary-of-summary can never drift; chain link
  N+1 is exactly as faithful to the raw rows as link N was.
- **Full-span recomputation is free** — the builder is deterministic code (no
  GLM), so extending the cut to a new `toSeq` simply re-derives over the whole
  span `[envelope.seq + 1 .. newCut]` from the immutable transcript.
- "Absorb-chain" is retained as the CHAIN SHAPE (one active row; `fromSeq`
  reaches back to the first compacted seq; replay = newest row only + tail;
  cap stays flat), but the word "absorb" no longer implies summary-on-summary
  input anywhere in this document.
- The builder renders only rows that are legal model context (`reply`,
  `final`, `tool_results`, `repair`). Marker kinds (`gate_stop`,
  `resume_note`) are covered by the seq range (density, no holes) but are NOT
  rendered — consistent with their existing never-replayed contract.

### 2.0.1 Marker precedence — the M1 carve-out (BINDING)

The "never rendered" rule above governs **transcript rendering only** — i.e.
what a projection builder or a replay filter may lift out of persisted
`AgentMessage` rows. It deliberately does NOT govern **dynamic per-assembly
injections**, which live in the ASSEMBLER/RUNTIME layer, outside transcript
rendering. This is the precedence rule that resolves the collision between the
never-replayed marker contract and Phase 1's point-3 fix (the FRESH
`resume_note` is pushed onto `messages` + metered so the first resumed call
sees it — under a naive reading, a compaction cut covering the tail span would
filter it out and silently disable the anti-blind-re-dispatch signal):

> **Precedence rule (M1):**
> 1. Marker ROWS (`gate_stop`, `resume_note`) are excluded from PROJECTION
>    RENDERING and from every replay of transcript history — historical
>    markers never appear on any wire, compacted or not.
> 2. DYNAMIC PER-ASSEMBLY INJECTIONS — the CURRENT resume's `resume_note`,
>    resume-time board state — are produced by the runtime's wire-assembly
>    step AFTER the transcript replay/projection is built, and ALWAYS appear
>    on every wire assembled while the injection is current, regardless of
>    compaction, cut position, or cover range. Compaction never filters them
>    (it cannot see them: they are not transcript-rendered content).
>
> Implementation shape: the runtime keeps the session's live injections in a
> dedicated list; every wire rebuild (resume init, between-turns compaction
> rewire, fallback rewire) is `assembly output + live injections`, and the
> meter conversation section is rebuilt from exactly those pieces — metered
> as sent.

Consequence: the Phase 1 anti-blind-re-dispatch guarantee survives compaction
UNCONDITIONALLY — a resume after N compactions still shows the fresh note as
the last wire message. Harness-asserted (verify-p2-c §M1) and exercised live
by the P2-c kill→resume probe (the orphaned member task makes the fresh note
fire on a compacted wire).

### 2.1 Chain shape and replay

- At any moment there is **exactly one ACTIVE** `ContextSummary` row per
  `(runId, conversationId)` (`supersededAt IS NULL`).
- Compaction N+1: builder recomputes over `[envelope.seq + 1 .. newCut]` (raw
  rows only, per §2.0) → ONE new row (`fromSeq = envelope.seq + 1`,
  `toSeq = newCut`) → the prior active row is fenced-superseded
  (`supersededAt = now`). The prior row defines the prior cut for
  eligibility/audit; it is never textually consumed.
- Replay = **newest active row only** (rendered as the projection block below,
  a user message) + verbatim tail rows ⇒ the active-context cap stays flat
  regardless of how many compactions fire.
- Auditability: originals are immutable; every row declares its cover
  `[fromSeq..toSeq]`; any projection can be re-derived byte-for-byte and
  diffed against the stored text. Stacked (replay all chain rows) is rejected
  — cost grows per compaction, defeating the cap.

### 2.1.x Projection block framing — PINNED (review point 2)

Byte-exact template (deterministic given identical inputs; the version token
makes framing changes distinguishable in transcripts and meter attribution):

```
[CONTEXT PROJECTION ctx-proj/v1 — deterministic compaction of transcript rows seq {fromSeq}..{toSeq}. NOT verbatim history. Originals remain in canonical history; retrieve exact detail with read tools.]
{body}
[/CONTEXT PROJECTION]
```

The four required elements: (a) explicit label — "deterministic compaction" +
"NOT verbatim history"; (b) covered range — `seq {fromSeq}..{toSeq}`; (c)
pointer — "Originals remain in canonical history; retrieve exact detail with
read tools"; (d) static version token — `ctx-proj/v1`. The body is one line
per covered replayable row in seq order (`seq {n} · {kind}: {clipped text}`;
clips are fixed constants in `src/lib/agent/wire.ts`), so identical inputs
yield byte-identical blocks — required for stable counterfactual comparison.

### 2.1.y Adjacency ownership — ONE normalization at assembly output (M2)

The projection block is a USER message and the first tail row is often user
(`tool_results`) — and transcript-internal adjacent user pairs already exist
(`tool_results` + `repair`, the resume wire tail `…tool_results, resume_note`).
The adjacency decision therefore has EXACTLY ONE OWNER, at assembly output:

> **M2 rule:** wire assembly ends with a single normalization step
> (`finalizeWire` in `src/lib/agent/wire.ts`) applied to the FULL assembled
> output — disabled replay, projected replay, and fallback replay all flow
> through it. Transcript rows are untouched on disk, always. The normalization's
> contract (Phase-2 shipped state): **adjacent user messages are preserved
> 1:1 VERBATIM — never merged** — covering every adjacency kind: projection →
> user-tail AND transcript-internal pairs. This matches the provider-proven
> Phase 1 wire (consecutive user rows sent and consumed unmerged on live
> resume runs) and keeps the disabled path byte-identical (the step is
> identity-preserving on legacy wires). If a provider constraint ever forces
> a merge, this function is the single place to change it — one owner, one
> diff, one version-token bump on the projection framing if framing shifts.

Harness-asserted as a MATRIX (verify-p2-c §M2): every combination of
{projection present? × tail-first kind ∈ reply / tool_results / resume-note}
— shape asserted when enabled, BYTE IDENTITY asserted when disabled.

### 2.2 Contiguity invariant (fail loud, never silent)

On every compacted replay, the active summary must form ONE contiguous cover
from the envelope boundary:

- exactly one active row exists (two active rows ⇒ corrupt state), AND
- `summary.fromSeq === envelopeSeq + 1` (no replayable row silently lost
  between the envelope and the projection — the head-gap failure mode), AND
- `summary.toSeq <= maxSeq` (no cover reaching past the transcript), AND
- the tail is exactly the replayable rows with `seq > toSeq` (markers inside
  the tail span stay non-replayed, per their contract).

AgentMessage seqs are dense by construction (MAX+1 allocation, unique index,
no deletes), so any violation means a corrupt/foreign summary row.

**Violation handling:** fall back to the FULL raw replay for that conversation
(raw rows are always intact and always safe) + fail loud: `console.error` from
the assembler AND a `fallbackWarnings` return value that the caller (runtime,
in P2-c) turns into an `AgentEvent(kind="error")` naming the row and the gap.
**Content is never silently dropped.**

### 2.3 Fencing / idempotence

- Only the leaseholder compacts — compaction runs inside the leader/member loop
  under the same lease guard as every append and checkpoint.
- **Lease changes hands mid-compaction:** the summary write is a lease-verified
  interactive transaction — (a) re-verify `(owner, epoch)` on AgentRun, (b)
  build the projection from raw canonical rows over the full span (§2.0), (c)
  insert the new `ContextSummary` row stamped `leaseEpoch`, (d) conditional
  supersede of the prior active row. If the lease was lost, the transaction
  aborts: **the loser's write lands count=0, the winner's row stands**. Every
  writer recomputes from raw rows — nobody ever adopts another writer's
  summary text, so there is nothing to trust and no drift to inherit.
- **Idempotence per cut point:** `@@unique([runId, conversationId, toSeq])`. A
  crash→retry that re-attempts the same cut hits P2002 and treats the existing
  row at that `toSeq` as done — **but ONLY if it is ACTIVE** (`supersededAt
  IS NULL`), and only after completing its supersede step (M3, one-line code
  rule in `writeCompactionSummary`: `if (existing.supersededAt !== null)
  return { ok: false, reason: "cut already superseded" }`). **A P2002 against
  a SUPERSEDED row at that `toSeq` is NOT "done"** — the writer returns
  `ok:false` and the caller recompute/SKIPS LOUDLY (`console.error` +
  `AgentEvent(kind="error")`), never adopting the dead row and never writing
  a duplicate at the same cut. Byte-identity anyway holds for the true
  retry (same inputs → same deterministic builder). Re-compaction after new
  turns gets a new `toSeq` — a new chain link, per 2.1.
- Compaction fires **between turns** (after a turn's transcript batch is
  appended, before the next model call) — never mid-turn, never concurrent with
  a fenced append of the same conversation.

---

## §3 — §8 arithmetic demoted to predictions (TIGHTENING)

The original §8 numbers (claimed flat active-context "4.6–5K") are **withdrawn
as claims**. The reviewer's arithmetic (~6.4K: tail 8 turns × ~250 tok +
envelope ~2.0K + fixed overhead ~1.8K + summary ~0.6K) is adopted as the
**standing prediction**.

`triggerTokens` ships at **6000** — a REACHABLE default: the predicted
conversation-section ceiling of a full-budget 22-turn leader run is ~9–10K tok,
so the original 24000 default could never fire. P2-b pastes measured per-wire
totals; P2-c may tune further. No config ships that silently does nothing.

No hand math in stage reports. The P2-b/P2-c counterfactual harness replays
**persisted canonical transcripts** through:

1. today's replay path, and
2. the P2 assembler with compaction **disabled** → assert byte-identical, report
   measured token counts; and
3. the P2 assembler with a **lowered threshold** (P2-c's one flash run) → report
   the measured projected cap and measured Σprompt reduction.

Those measured numbers are pasted into the P2-b and P2-c stage reports.
§8 numbers are predictions to be checked, not claims to be defended.

**Corpus provenance (P2-b):** the accepted Phase 1 cleanup emptied
`AgentMessage` (evidence-first deletion), and the pre-Phase-1 backup predates
the canonical transcript entirely — so P2-b REBUILDS the counterfactual corpus
through the production append path (lease-fenced `appendAgentMessages` on
throwaway runs, Phase-1-E2E-shaped content: leader delegate loops, CJK chapter
prose, verified tool-result feeds, historical markers). These are genuine
canonical rows, not in-memory fabrications; provenance is disclosed in the
P2-b report.

---

## §4 — Additive footprint (unchanged constraint, now concretely)

Exactly:

- **One table** — `ContextSummary` (see schema: cover range, absorbed text,
  `leaseEpoch` fencing token, `supersededAt` chain-head marker,
  `@@unique([runId, conversationId, toSeq])` idempotence). Cascade-deletes with
  the run; AgentMessage is untouched by design.
- **One column** — `AgentRun.contextSpec String @default("v1")`.
- **One config section** — `budgets.contextCompaction` (`enabled=false` shipped
  inert; `triggerTokens=6000` reachable default; `tailTurns=8`;
  `minCompactableRows=12`).

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
byte-identity + disabled-default) → P2-c (runtime wiring + one short flash run,
lowered threshold, kill→resume seam, summary range + chain + fence evidence) →
P2-d (wrap-up report). Report after each; wait for confirmation before the next.

`verify-stage-a.ts` stays green at every stage. Sibling harnesses carry the
P2-stage assertions:

- **P2-a:** `contextSpec` defaults to `"v1"`; `ContextSummary` inert round-trip;
  absorb-chain supersede shape; P2002 per-cut idempotence; cascade delete;
  config parses with `enabled=false`; canonical replay untouched; zero summary
  rows written by any live path.
- **P2-b:** corpus rebuilt through the PRODUCTION append path (lease-fenced
  AgentMessage rows, Phase-1-E2E-shaped content — the accepted Phase 1 cleanup
  emptied `AgentMessage`, so the counterfactual corpus is re-persisted, zero
  GLM, on throwaway runs); summary write/read/fence (stale lease ⇒ count=0);
  per-cut idempotence (P2002 ⇒ already-done); **absorb-input sentinel** (prior
  summary text provably never enters a new projection); supersede/contiguity
  (head-gap and double-active ⇒ loud fallback to raw replay); **disabled ⇒
  byte-identical** legacy-vs-assembler per conversation; **merged-user-wire
  shape** (consecutive user rows preserved 1:1, never merged); measured token
  table (legacy vs projected, per corpus conversation) pasted in the report.
- **P2-c:** live-run evidence — summary row range correct, chain head unique,
  fence verdicts, measured-vs-predicted §8 table, usage reconciliation.
  Amendment-driven additions: **§M1** — fresh `resume_note` rides a COMPACTED
  resume wire (projection present, cover would otherwise swallow its seq) and
  historical markers stay unrendered everywhere; **§M2** — the full adjacency
  matrix {projection? × tail-first kind ∈ reply/tool_results/resume-note} with
  byte identity when disabled; **§M3** — P2002 against a SUPERSEDED row ⇒
  `ok:false("cut already superseded")`, active head unchanged; **fallback
  wiring** — corrupt-summary fixture ⇒ `fallbackErrorSummary` names the row
  and the gap + fallback replay byte-identical to the raw replay; **resume
  seam** — kill the live run after ≥1 compaction, resume, restored wire =
  projection + tail + injected markers, transcript gapless, counters intact;
  **usage semantics** — post-compaction usage events reflect the projected
  wire (no retroactive inflation).

GLM discipline: P2-c = 1 short flash run with lowered threshold; everything
else zero-GLM.
