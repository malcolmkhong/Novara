# Phase 4 Proposal — Story Snapshot Dedup for Member Tasks

**Status: READ-ONLY — no code shipped, awaiting approval.** Date: 2026-11-05.
Rules honored: additive-only, zero new deps, no business-logic/UI changes,
zero-GLM evidence discipline. Evidence embedded at production time per the
standing process rule. Scripts produced for grounding:
`scripts/p4-snapshot-fraction.ts`, `scripts/p4-snapshot-fraction-backup.ts`,
`scripts/p4-snapshot-synthetic.ts` (all zero-GLM, read-only).

---

## §1 What the snapshot actually is — measured, in three labeled tiers

**Anchor honesty first:** NO real Phase 1/2 transcripts survive to measure
against. Current DB: 0 runs / 0 messages (only the empty novel "abc"). The
Nov 2 backup (`custom.backup-20261102-061118.db`) predates the agent schema
entirely (`TeamMessage`-era tables — no AgentRun/AgentMessage). The live-fire
runs' rows were cascade-deleted by their controller (close-out §3). Surviving
REAL anchors are therefore artifact-attested numbers only; everything else
below is reconstructed through the REAL renderer with every dimension bounded
by SHIPPED budget constants, and labeled as such.

**Tier 1 — REAL, artifact-attested:**
| anchor | value | source |
|---|---|---|
| Member wire, max, live runs | ~1.5K tok | runtime.ts P2-c evidence #4 (comment) |
| Leader turn-6 wire, billed | 8,726 tok | close-out §2 row 3 |
| Raw-estimate CJK undercount | ~1.4× | close-out §2 row 1 (applies to all "tok (est)" below) |

**Tier 2 — RECONSTRUCTED-EXACT** (pure `renderSnapshot` on budget-bounded
synthetic data; script output verbatim, `countTokens` estimator basis):
```
REPRESENTATIVE: snapshot 23724 chars ≈ 5768 tok (est) · member envelope 25318 chars ≈ 6063 tok (est) · snapshot share = 95.1% tok / 93.7% chars
  per-section (representative):
       11 tok — NOVEL · 72 — SYNOPSIS · 19 — PROGRESS · 19 — NEXT CHAPTER
      245 tok — CHAPTERS · 1299 — OUTLINE · 210 — CAST · 535 — WORLD
      108 tok — STORY CONTRACT · 374 — STORYLINES · 583 — TIMELINE
      613 tok — CHARACTER ARCS · 1386 — OPEN FORESHADOW LEDGER · 286 — memory block
CEILING (every section at its shipped cap): snapshot 39915 chars ≈ 9023 tok (est) · member envelope 41509 chars ≈ 9318 tok (est) · snapshot share = 96.8% tok / 96.2% chars
FLOOR (real novel "abc", empty): snapshot 168 chars ≈ 55 tok · share of reconstructed envelope ≈ 15.7% tok
```

**Tier 3 — the contradiction that defines the problem (derived, both sides
attested):** the real "~1.5K max member wire" anchor was measured on the
live-fire runs, which ran on the EMPTY test novel — the snapshot there was the
55-tok FLOOR. A representative novel's snapshot alone (≈5.8K tok est) is
**385% of that "max" member wire**; the ceiling case is 602%. Conclusion: on
any real working novel, the member wire is **snapshot-dominated (~95%)**, and
the snapshot's full weight re-ships identically into EVERY member task's
envelope (`executeTask`: `novelParts = ["", "STORY SNAPSHOT (measured at run
start…):", renderSnapshot(snapshot), …]` — N tasks ⇒ N full copies per run).

**Also flagged honestly:** the same floor-anchored figure backs the P2-c
comment that member compaction "would be dead code" (member wires ~1.5K ≪
triggerTokens). The NUMBER is wrong for real novels (9K ceiling ≪ 128K window
— compaction still doesn't apply, member conversations have no replay path and
are 1–3 turns), but the rationale's measurement basis is noted as
floor-calibrated.

## §2 What "eliminate repeated delivery" can mean under the constraint set

(a) members receive everything required for their task · (b) task
independence · (c) no "DB access replaces model context" · (d) task-specific
assembly · (e) no unrelated history to members.

The decomposition that falls out: **bytes shared across conversations cannot
be deduplicated at all** under (b)+(c) — every member conversation is a
separate model context, and the only cross-context mechanism (provider prefix
caching) is UNMEASURABLE on this stack (Phase 3 stop condition: no cache fields
at our boundary). What CAN be eliminated — and what (d)+(e) actually demand —
is the repeated **irrelevant** portion: today every member receives all ~14
snapshot sections regardless of task (OUTLINE 1,299 + FORESHADOW 1,386 +
TIMELINE 583 + WORLD 535 + ARCS 613 = 4,416 tok est, **77% of the
representative snapshot**, is frequently context for a different job). The
dedup scope is therefore: **task-specific slicing of the snapshot at the seam
Phase 2 already built**, not cross-wire byte sharing.

## §3 Options ranked by risk (lowest risk first that MEETS the scope)

**O1 — Task-specific SLICED snapshot via the `novelParts` / `sections.novel`
seam (RECOMMENDED).** The snapshot is already assembled as ONE discrete block
through ONE builder, metered as its own section on both leader and member
meters, and the per-task quota block is ALREADY sliced today
(`quotaForChapter`). Add a pure `snapshot-slice` module: a DECLARED section
map (task-shape → section set, auditable constants), `buildMemberSnapshotSlice
(snapshot, task)`, fail-open to FULL snapshot on any unrecognized task shape.
Slices stay IN-WIRE (constraint c respected); each wire remains self-contained
(a, b); irrelevant sections drop (d, e). The assembler, `finalizeWire`, the
compaction guard, and the meter are untouched — the change is one function
call at envelope construction. Risk: **low-medium**; the only real risk is
starvation-by-omission, closed in §4.

**O2 — Accept-and-cache-prefix-only (the floor, not the proposal).** Ship
nothing; the snapshot already sits at the wire's stable head (position 0–1 of
every member call) so implicit caching already discounts repeats *if* it
happens. Zero risk, zero work — but savings are UNMEASURABLE (P3-a: no cache
fields exist to observe), and it eliminates nothing. It remains true as a
background property of O1's output (sliced or not, the envelope stays at the
stable head); it cannot be the answer to the approved scope.

**O3 — Diff-based snapshot (REJECTED).** A delta needs a shared prior the
reader holds. Members have none: tasks are independent fresh conversations
(b), and carrying "your last known state vN + delta" re-imports history into
each new task (violates e) or strands a member whose base version doesn't
exist. First-task-per-member degrades to full snapshot anyway. Mismatched to
the wire's independence model; rejected without an implementation phase.

**O4 — Snapshot-pointer + read-on-demand (REJECTED).** The member wire carries
a pointer; context arrives via tool call. This is exactly the pattern
constraint (c) forbids assuming ("DB access replaces model context"), and it
converts (a) from a construction guarantee into a behavioral hope — the model
may skip the read (the starvation mode the M1 anti-blind-injection work exists
to prevent). It also ADDS a GLM turn per member task, which on 1–3-turn member
tasks can exceed the tokens it saves. Rejected; revisitable only with a
verified tool-follow guarantee, which does not exist today.

## §4 Recommendation, savings estimate, starvation safety

**Recommendation: O1.** Pure, additive, in-wire, grounded on the Phase 2 seam
(`novel` section / `novelParts` layer), no assembler rewrite, zero GLM.

**Savings estimate (derived from the Tier 2 section table — estimator basis,
CJK billed-truth runs ~1.4× higher):**
- Example write-task slice: core (NOVEL/PROGRESS/NEXT CHAPTER ≈ 121) + SYNOPSIS
  72 + CAST 210 + STORYLINES 374 + CONTRACT 108 + memory 286 + assigned
  characters' ARCS ≈ 130 + FORESHADOW top-5 ≈ 231 + OUTLINE near-beats ≈ 97 +
  CHAPTERS recent window ≈ 102 + TIMELINE recent window ≈ 292 + WORLD 535
  ≈ **2.56K tok est vs full 5.77K** ⇒ **≈3.2K tok est saved per member task
  (≈55% of the 6.06K representative envelope)**; review/research slices land
  in the same 40–60% band.
- Per 6-member run ≈ **19K tok est** (≈27K billed-truth tok at the attested
  1.4× factor — labeled multiplication, not a measurement).
- Leader wire: unchanged (leader keeps the FULL snapshot — planning needs all
  sections).

**Why O1 cannot silently starve a member (the guard chain):**
1. **Fail-open default** — any task whose (assignee × artifactType) shape has
   no declared slice receives the FULL snapshot. Slicing is opt-in per
   declared shape, never a default.
2. **Declared, auditable slice map** — each slice is a named constant
   (section list) in one module; the dispatcher's possible (assignee,
   artifactType) pairs are enumerated by the harness, and a new harness
   (`scripts/verify-p4.ts`, zero-GLM — quartet becomes quintet) asserts every
   emitted pair resolves to a declared slice or full.
3. **Coverage sets** — each declared slice must ⊇ a documented required-set
   for its shape (e.g., write tasks: core + cast + contract + storylines +
   the assigned arc + memory/last-digest + quota + language); harness asserts
   the superset per shape.
4. **In-wire, not in-DB** — everything sliced-in is physically in the
   envelope (constraint c); the "use read tools for fresher data" line stays
   on every slice.
5. **Floor byte-identity** — on a novel small enough that all sections exist
   in every slice's required-set (e.g., the empty-novel floor), the sliced
   envelope is byte-identical to today's construction (harness-asserted).

## §5 What stays byte-identical for v1 runs

1. **Existing transcripts replay byte-identically** — the assembler
   (`assembleWire`/`legacyReplay`) replays STORED canonical rows and is
   untouched; slicing happens only at NEW-run envelope construction.
2. **Canonical-rows-record-what-was-sent** — the envelope row for a new
   sliced task stores exactly the sliced envelope (property unchanged, content
   per new shape changed by design).
3. **Wire shape** — `[system_note][envelope][…]` unchanged; role union
   untouched (P3-b ruling); `finalizeWire` untouched.
4. **Compaction machinery** — projection builder, framing `ctx-proj/v1`,
   monotone guard, slack 256, trigger anchoring: all untouched (leader-only
   consumer, unchanged).
5. **Meter semantics** — sliced snapshot still rides `sections.novel`;
   §7 conversationSub sum invariants unaffected.
6. **Leader envelope** — full snapshot, byte-identical construction.
7. **All 46 current p2-c checks + quartet** — must stay green unchanged.

## §6 Implementation sketch (on approval; additive only)

- NEW `src/lib/agent/snapshot-slice.ts` — section constants + declared slice
  map + `buildMemberSnapshotSlice()` (pure, zero GLM, zero I/O).
- `src/lib/agent/runtime.ts` `executeTask` — one call site swap
  (`renderSnapshot(snapshot)` → `buildMemberSnapshotSlice(snapshot, task)`),
  fail-open inside the new module.
- NEW `scripts/verify-p4.ts` — slice-map coverage, required-set supersets,
  fail-open behavior, floor byte-identity, meter `sections.novel` attribution
  on sliced envelopes. Zero GLM.
- NO schema change, NO config change, NO UI change, NO new deps.

## §7 Phase 5 heads-up (recorded per instruction; no work now)

1. **Per-novel ledger question (open since the audit):** pre-novel surfaces —
   wizard / team / generate — must decide attribution to the NEW novel vs
   global. Current ledger reality (`src/lib/usage/ledger.ts`): in-memory
   per-process (resets on restart), per-SURFACE token totals only, no model
   field, no novel field, no persistence.
2. **Billing attribution outcome folded in (§P3-A-2 of phase3-stages.md):**
   response `model` echo is cosmetic and unread in code; token records are
   provider-billed counts keyed by request-side selection; the invoice-tier
   residual is NOT observable from inside this sandbox — before any $ display
   ships, Phase 5 must reconcile one real invoice/dashboard row against
   request-side attribution (cost-display credibility dependency).
3. **The audit's original per-novel consumption gap:** per-novel attribution
   requires tagging at record time (agent runs carry novelId; pre-novel
   surfaces need the §7.1 policy decision first) and a persistent store —
   both are Phase 5 scope, not now.

## §8 Cost of the proposed Phase 4

- GLM: **zero** (pure assembly change + zero-GLM harness; no live-fire
  required — the slice output is deterministically checkable).
- Code: 1 new module + 1 call-site swap + 1 new harness script. No deps.
- If approved, the standing process rule applies to the implementation
  reports (all evidence embedded at production time).
