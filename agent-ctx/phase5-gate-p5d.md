# Phase 5 / P5-d — Enablement Gate Document

**Status: DOCS-ONLY deliverable (user-approved sequencing, proposal §7–§8).
Nothing in this document changes any config, any code path, or any wire.
Both features ship and remain INERT: `contextCompaction.enabled=false` (P2)
and `contextSlicing.enabled=false` (P4-A4). verify-p4's S8 inertness
assertions hold in the green 38.**

**This gate awaits ONE user ruling.** Until that ruling arrives, neither
feature turns on — not partially, not temporarily, not "just to see". The
recommended order below is a recommendation; the ruling decides.

---

## 1. What is being gated

| | Compaction (`contextCompaction`, P2) | Slicing (`contextSlicing`, P4-A4) |
|---|---|---|
| What it does | Replaces the oldest off-floor conversation history with persisted summaries when the wire would otherwise exceed budget; guard-refused cycles skip loudly | Replaces the per-member wire's novel-context block with the shape-filtered slice each member actually needs; structural floor (novel/synopsis/progress/next_chapter/cast/contract/memory) never droppable |
| Where the switch lives | `contextCompaction.enabled` — one flag | `contextSlicing.enabled` — one flag |
| Current state | shipped, validated INERT (P2-d closure; verify-p2-c 46 green) | shipped, validated INERT (P4; verify-p4 38 green, S8 = inertness) |

## 2. Enablement packs (measured, evidence embedded in the phase records)

**Compaction**
- P2-d real-transcript counterfactual (final chain head): **79.1% Σprompt
  reduction** (phase1-2-closeout.md §2 table).
- Guards measured on fixtures: G1 (feed-heavy, turn-6 shape) 3591 → 3689
  (+98) ⇒ **SKIP**; G2 (normal, clips bind) 5736 → 3626 (−2110) ⇒ **PROCEED**
  (verify-p2-c §G1/§G2). A compaction that would make the NEXT call larger
  than the skip baseline by more than the documented slack (256) is refused.
- Re-compaction baseline = current-wire (P2-d closure).

**Slicing**
- Per-shape savings table (estimator basis; CJK billed ~1.4×): sage:chapter
  full≈5888 → sliced≈3090 (**−47.5%**) … forge:chapter full≈5888 → sliced≈974
  (**−83.5%**) (phase4-stages.md §savings table).
- A1 live-fire: snapshot block 15,049 chars ≈ 10,854 tok vs full
  25,885/19,385 — **−44.0% chars / −19.6% billed-truth confirmed**
  (phase4-stages.md §A1).
- Floor byte-identity: ALL 20 shapes × slicing ENABLED byte-identical to the
  full render on a real empty novel (168 chars) — verify-p4 S4; leader wire
  byte-identity live-proven.

## 3. Validation protocol (identical shape for both, per feature)

1. One free-tier (`glm-4-flash`) live-fire through the **P4 hardened rig** —
   OPS-2 mandatory (detached executor + persisted state file + standalone
   evidence pass; the ~15-minute sandbox reap is standing fact). Tightened
   goals per OPS-1 (free-tier flash + loose goals = known protocol-error
   generator). Expected billable cost: **$0.00** (free tier); free-call count
   disclosed in the stage record. Mock-first standing rule (OPS-3) applies to
   every probe that is not this sanctioned live-fire.
2. Dashboard evidence from REAL enabled wires:
   - Compaction: `conversationSub.compacted > 0` on live wires; Σprompt
     before/after at billed truth; guard SKIP telemetry counts.
   - Slicing: per-shape member-wire sizes + per-run totals vs the
     enabled:false baseline in the ledger (now with P5-c per-model rows +
     ESTIMATE columns as the measuring stick).
3. Ledger cross-check (§4.5): agent-usage events vs UsageCall rows agree on
   the measured subset, per P5-b's extended reconciliation.

## 4. Rollback (both features)

One config flip to `false`, per feature, independently. No data migration,
no schema coupling (the ledger stores request-side modelId + tokens; it is
indifferent to wire shape). A rollback stage re-runs the eighth-set + lint
and re-probes the panel/central view.

## 5. Recommended order — SLICING FIRST (working assumption; the ruling decides)

1. **Slicing first**: bigger, better-bounded savings (−47.5%…−83.5% per
   shape; −44.0%/−19.6% live-confirmed); leader byte-identity live-proven;
   per-shape attribution is straightforward (each member's wire is
   independently slliced); failure blast radius is one member turn.
2. **Compaction second**: wire-shape change on the shared conversation;
   validated by its own conversationSub evidence once slicing's effects are
   the settled baseline (avoids attributing one feature's delta to the
   other).

## 6. Caveats the ruling must carry

- **OPS-1**: billable-tier (glm-4.6) behavior on the exact protocol shapes is
  UNEXERCISED in surviving evidence — free-flash runs are a weak proxy for
  production-model reliability. Enablement on the billable tier is a separate
  risk acceptance.
- **OPS-2**: any validation run expected to exceed ~10 minutes MUST use the
  hardened rig or be chunked.
- **OPS-3 (new)**: mock-first standing rule for all harness probes; the only
  sanctioned live calls are the gate's own free-tier validation runs.
- The pricing ESTIMATE column (P5-c) is an upper bound; savings percentages
  computed from it are conservative in the billed-truth direction.
- Invoice reconciliation (§6.3) is pending its USER-INPUT DEPENDENCY (the
  account holder's one console row) — it is NOT a blocker for this gate; the
  gate's evidence protocol does not depend on it.

## 7. The decision being asked for

- [ ] Approve slicing enablement validation (free-flash live-fire per §3), then slicing ON.
- [ ] Approve compaction enablement validation (free-flash live-fire per §3), then compaction ON.
- [ ] Approve order (recommended: slicing first, compaction second).
- [ ] OR: keep both inert; revisit later.

No box checked = nothing changes. The shipped Phase 5 ledger/dashboard is
complete and valuable with both features off.
