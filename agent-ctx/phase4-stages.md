# Phase 4 — Stage Execution Record (evidence embedded)

**Date: 2026-11-05 (UTC). Evidence discipline: every harness line, probe
output, and measurement below is embedded VERBATIM at the moment it was
produced — /tmp logs and DB rows are treated as losable (the probe run and
scratch novel were cascade-deleted after evidence; the DB is back to 1 novel
/ 0 runs / 0 messages).**

Approval state: **O1 APPROVED WITH AMENDMENTS A1–A4 — implemented, both
stages executed, quintet green at every stage.** Shipped at rest:
`contextSlicing.enabled=false` (A4 — inert exactly like compaction).

---

## §P4-A — Inert ship: slice module + rollback knob + call site + harness

### Files touched (additive only)

| file | change |
|---|---|
| `src/lib/agent/snapshot-slice.ts` | NEW — pure module: section renderer (byte-pinned to `renderSnapshot`), declared A2 slice map, deterministic guard, `buildMemberSnapshotSlice()`. Zero GLM, zero I/O, zero config reads (the gate is injected). |
| `src/lib/novara/content.ts` | +`contextSlicing: { enabled: z.boolean() }` in the budgets schema; default `{ enabled: false }`. |
| `agent/config/budgets.yaml` | +`contextSlicing:` section, `enabled: false` at rest, with the probe-pack note (mirrors the compaction section's discipline). |
| `src/lib/agent/runtime.ts` | ONE call-site swap in `executeTask` (`renderSnapshot(snapshot)` → `buildMemberSnapshotSlice(snapshot, task, { enabled: budgets.contextSlicing.enabled })`) + the import. Nothing else — leader envelope, `finalizeWire`, compaction machinery, meter semantics, `read_novel` all untouched. |
| `scripts/verify-p4.ts` | NEW — the regression quartet becomes a QUINTET (38 checks, zero GLM). |
| `scripts/p4-live-probe.ts` / `p4-live-exec.ts` / `p4-live-evidence.ts` | NEW — the A1 acceptance rig (controller / detached executor / standalone evidence+cleanup). |

**A3 — PINNED-BLOCK TREATMENT (the declared sentence):** author-pinned refs
are ALWAYS shipped WHOLE and are never sliced — they ride the envelope after
the snapshot block via the runtime's unconditional `novelParts.push("",
params.pinnedContext)` (leader-curated per task, already task-specific by
construction), are neither an input to nor an output of the slice module, and
verify-p4 §S7 asserts all of this in source (exactly ONE
`buildMemberSnapshotSlice` call site; pinned push unconditional and
downstream of it; the module's code contains no pinned reference).

### The declared slice map (A2 — conservative-by-default, verbatim mechanism)

Default slice = **FULL** snapshot. A section is reduced only through a
reason-declared map entry; the deterministic cheap guard then force-includes
WHOLE any section the brief text references (beat number → OUTLINE,
foreshadow → FORESHADOW, chapter index → CHAPTERS, cast name/alias → CAST +
ARCS). Structural floor — never droppable by any entry: `novel, synopsis,
progress, next_chapter, cast, contract, memory` (+ the `"CHAPTERS: none yet"`
identity line, which keeps floor byte-identity total). Fail-open: unknown
shape, Task 0, or gate-off ⇒ FULL. Of the 20 enumerated dispatcher pairs,
**8 declared slices, 12 fall through to FULL**:

| shape | map (all entries reason-declared in the module) |
|---|---|
| `sage:chapter` (prose write) | bounded only: OUTLINE→target±window (4 beats), FORESHADOW→5 most recent, CHAPTERS→10 most recent, TIMELINE→8 most recent; nothing excluded |
| `sage:outline_beat` | exclude WORLD; bounded CHAPTERS→10 recent |
| `nova:chapter` (read-only research) | bounded OUTLINE→target window only |
| `nova:outline_beat` | exclude WORLD; bounded CHAPTERS→10 recent |
| `nova:world_entry` | exclude OUTLINE, FORESHADOW, ARCS, CHAPTERS |
| `nova:character` | exclude OUTLINE, WORLD; bounded CHAPTERS→10 recent |
| `prism:chapter` (review/certify) | bounded OUTLINE→target window only (continuity/ledger/arcs/contract all kept whole — review dimensions) |
| `forge:chapter` (build/export) | exclude OUTLINE, FORESHADOW, ARCS, TIMELINE, WORLD, STORYLINES |

Deliberate consequence of A2's guard, stated honestly: per-character ARCS
windowing from the proposal sketch is unreachable (any named character pulls
CAST+ARCS back whole), and the CHAPTERS window rarely survives on chapter
tasks (the brief names the chapter index by construction). The guard's
protection was chosen over maximal savings — by the amendment's own terms.

### verify-p4.ts — full run output (zero GLM)

```
P4: [PASS] S1 floor (real novel, empty): section join BYTE-IDENTICAL to shipped renderSnapshot — 168 chars
P4: [PASS] S1 representative: section join BYTE-IDENTICAL to shipped renderSnapshot — 23985 chars
P4: [PASS] S1 ceiling: section join BYTE-IDENTICAL to shipped renderSnapshot — 39915 chars
P4: [PASS] S1 edge (all empty): section join BYTE-IDENTICAL to shipped renderSnapshot — 141 chars
P4: [PASS] S1 representative: section keys in canonical order — novel,synopsis,progress,next_chapter,chapters,outline,cast,world,contract,storylines,timeline,arcs,foreshadow,memory
P4: [PASS] S2 every map key is an enumerated dispatcher pair — sage:chapter, sage:outline_beat, nova:chapter, nova:outline_beat, nova:world_entry, nova:character, prism:chapter, forge:chapter
P4: [PASS] S2 every exclusion/bounded entry carries a declared reason (≥20 chars)
P4: [PASS] S2 starvation floor honored — no map entry drops novel/synopsis/progress/next_chapter/cast/contract/memory
P4: [PASS] S2 every declared slice ⊇ its documented required-set (representative fixture) — all 8 shapes
P4: [PASS] S2 all 20 enumerated pairs resolve (declared slice or full) without throwing
P4: [PASS] S3 unknown shape ⇒ FULL snapshot byte-identical (fail-open, A2)
P4: [PASS] S3 Task 0 (auto impact assessment) ⇒ FULL snapshot byte-identical
P4: [PASS] S4 floor: ALL 20 shapes × slicing ENABLED byte-identical to full render (real empty novel) — 168 chars
P4: [PASS] S5 gate OFF (shipped default): slice output BYTE-IDENTICAL to full render
P4: [PASS] S5 gate OFF: all 20 shapes byte-identical on the representative fixture
P4: [PASS] S5 sage:chapter slice is strictly smaller than full (representative) — 13562 < 23985 chars
P4: [PASS] S5 outline bulk physically absent — ≤4 beat lines in window (40 seeded) — 4 beat lines
P4: [PASS] S5 foreshadow bulk physically absent — ≤5 ledger entries (30 seeded) — 5 entries
P4: [PASS] S5 chapters bulk physically absent — ≤10 roster lines (12 seeded) — 10 lines
P4: [PASS] S5 timeline bulk physically absent — ≤8 event lines (20 seeded) — 8 lines
P4: [PASS] S5 unique marker UNIQ-F30 (seeded far past the window) ABSENT
P4: [PASS] S5 kept sections all present (novel…arcs + memory) — all 10 present
P4: [PASS] S6 base nova:world_entry: outline absent (40 beats excluded)
P4: [PASS] S6 base nova:world_entry: foreshadow ledger absent
P4: [PASS] S6 base nova:world_entry: arcs absent
P4: [PASS] S6 base nova:world_entry: chapters absent
P4: [PASS] S6 guard: beat-number reference restores OUTLINE WHOLE (40 lines) — 40 lines
P4: [PASS] S6 guard: foreshadow reference restores the FULL ledger (30 entries) — 30 entries
P4: [PASS] S6 guard: chapter-index reference restores the FULL roster (12 lines) — 12 lines
P4: [PASS] S6 guard: character-name reference restores CAST + ARCS
P4: [PASS] S7 exactly ONE buildMemberSnapshotSlice call site (member envelope only) — call sites=1
P4: [PASS] S7 pinned push is UNCONDITIONAL and DOWNSTREAM of the slice call (A3: always shipped whole, never sliced) — slice@97284 < pinned@97410
P4: [PASS] S7 leader envelope still renders the FULL snapshot (renderSnapshot at leader)
P4: [PASS] S7 read_novel tool still returns the FULL fresh snapshot
P4: [PASS] S7 slice module never touches pinned context in CODE (A3 doc comment may declare it)
P4: [PASS] S8 budgets.yaml at rest: contextSlicing section present with enabled=false (shipped inert, A4)
P4: [PASS] S8 parsed budgets: contextSlicing.enabled === false
P4: [PASS] S8 parsed budgets: contextCompaction.enabled === false (untouched by P4)
P4: ---- MEAS: per-shape savings on the representative fixture (countTokens est; CJK billed truth ~1.4×) ----
P4:   sage:chapter         full≈5888 sliced≈3090 saved≈2798 tok (47.5%)
P4:   sage:outline_beat    full≈5888 sliced≈5311 saved≈577 tok (9.8%)
P4:   nova:chapter         full≈5888 sliced≈4721 saved≈1167 tok (19.8%)
P4:   nova:outline_beat    full≈5888 sliced≈5311 saved≈577 tok (9.8%)
P4:   nova:world_entry     full≈5888 sliced≈2223 saved≈3665 tok (62.2%)
P4:   nova:character       full≈5888 sliced≈4012 saved≈1876 tok (31.9%)
P4:   prism:chapter        full≈5888 sliced≈4721 saved≈1167 tok (19.8%)
P4:   forge:chapter        full≈5888 sliced≈974 saved≈4914 tok (83.5%)
P4:   ceiling sage:chapter   full≈9023 sliced≈5777 saved≈3246 tok (36.0%)
P4: ALL CHECKS PASSED (38 checks)
```

Two implementation defects were caught and fixed BY the harness during §P4-A
(both in my map authoring, never in shipped behavior): (1) exclude values
were first authored as `{reason}` objects while the type contract says plain
strings — Bun does not typecheck, so exclusions silently no-opped until S6
failed; (2) the first floor assertion exposed that exclusion shapes dropped
the `"CHAPTERS: none yet"` identity line on an empty novel — fixed by
declaring that line floor furniture (byte-identity at floor is now TOTAL
across all 20 shapes, S4).

### Regression QUINTET + ship health (§P4-A, measured 2026-11-05)

| harness | runtime checks | result |
|---------|---------------|--------|
| verify-stage-a.ts | 17 | ALL CHECKS PASSED |
| verify-p2-a.ts | 13 | ALL CHECKS PASSED |
| verify-p2-b.ts | 35 | ALL CHECKS PASSED |
| verify-p2-c.ts | 46 | ALL CHECKS PASSED |
| verify-p4.ts | 38 (incl. MEAS) | ALL CHECKS PASSED |

- `bun run lint` — clean. Dev server (`:3000`) — 200s on `/` and
  `/api/agent/runs?novelId=…`, no errors in dev.log.

---

## §P4-B — A1 live-fire behavioral acceptance (the ONE free flash run)

**Attempt history (disclosed in full):** the acceptance rig took four
attempts; all model calls on every attempt were **glm-4-flash (FREE tier —
billable spend $0.00 throughout)**.

1. **Attempt #1 — aborted pre-run (harness bug, zero behavior tested).** Two
   probe-side assertion bugs: a non-global `String.match` used as a match
   COUNT (returns capture groups), and a foreshadow-ledger regex
   (`/^-\s*\[f/`) authored against the synthetic fixture's `"f1"` ids — real
   foreshadow ids are CUIDs. Controller killed; manual cleanup restored
   budgets.yaml and deleted the run + scratch novel (verified 0 rows left).
2. **Attempt #2 — aborted pre-run (same regex family).** The broadened
   ledger regex then matched storyline (`- [active] …`) AND memory
   (`- [story_fact] (ch9) …`) lines (56 "entries"). Killed pre-evidence;
   manual cleanup. Fix: the ledger's unambiguous signature is
   `/^-\s*\[[^\]]*\]\s*\([^)]*planted ch/gm` (the `planted ch` token exists
   only in ledger lines).
3. **Attempt #3 — run started; reaped by the sandbox mid-run.** The executor
   child shared the controller's process group; both died at ~15 min (sandbox
   background-process ceiling, despite setsid on the controller). Before
   death it produced one honest behavioral observation: Task 1 (sage write)
   **failed write verification** — the flash model repeatedly sent
   `create_chapter` WITHOUT the paired ```novel-write prose block (5
   consecutive protocol errors, 2 repair rounds; its envelope WAS correctly
   sliced at 20,567 chars — slicing was not the failure). The leader then
   re-dispatched (Task 2) and hung mid-GLM-call at reaping. Cleaned up
   manually (yaml byte-restored, run + novel deleted).
4. **Attempt #4 — the ACCEPTED A1 run (architecture hardened first).**
   Executor spawned DETACHED in its OWN session (`setsid` via sh, file-
   redirected output — controller death can't take it); pre-run state
   (expected leader envelope, pre-run snapshot, original yaml text, ids)
   persisted to a state file so the evidence+cleanup pass is standalone
   (`p4-live-evidence.ts`) and reaper-proof; goal tightened (write
   immediately, prose+create_chapter in ONE reply, 500–700 words). The
   controller was in fact reaped by the sandbox again mid-poll — the
   detachment + state-file design absorbed it: the executor finished the run
   in its own session and the standalone evidence pass ran clean.

### Setup (attempt #4)

- Scratch novel seeded at the P4 measurement fixture dims (real DB rows):
  12 chapters, 40 outline beats, 12 cast, 12 world entries, contract,
  12 storylines, 20 timeline entries, 24 arcs, 30 open foreshadows (unique
  `UNIQ-F{n}` markers), 3 digests + 6 facts + 4 character states (memory
  block renders). Pre-run snapshot measured: **25,885 chars ≈ 19,385 tok
  (est) — 40 beats · 30 ledger entries** (CJK-heavy live corpus; the latin-
  filler synthetic representative is 5,768 tok — same shape, bigger body).
- Run `cmw3ntzg90059qfcvo14o2tuf`: glm-4-flash (FREE), full_access,
  thinking off. Goal dispatches exactly ONE sage chapter write and ONE nova
  read-only task.

### A1 evidence — ALL 14 CHECKS VERBATIM

```
P4-LIVE: tasks — Task 1:sage:done, Task 2:nova:done
P4-LIVE: [PASS] A1 setup: ≥1 write task (sage) executed to done — Task 1
P4-LIVE: [PASS] A1 setup: ≥1 read-only task (nova) executed to done — Task 2
P4-LIVE: [PASS] run reached a terminal state — status=completed
P4-LIVE: [PASS] A1(iv) leader envelope BYTE-IDENTICAL to pre-P4 construction (full snapshot, untouched builder) — stored=27202 chars, expected=27202, equal=true
P4-LIVE: [PASS] A1(iv) leader wire carries the FULL section set (40 beats · 30 ledger entries · 20 timeline) — beats=40 ledger=30 timeline=20
P4-LIVE: usage events:
P4-LIVE:   novel=19497 used=21578 real=21578 | Context usage (atlas · turn 1): 21.6K / 128.0K tokens
P4-LIVE:   novel=10928 used=12945 real=12945 | Context usage (Task 1 · sage · turn 1): 12.9K / 128.0K tokens
P4-LIVE:   novel=10919 used=13328 real=13328 | Context usage (Task 1 · sage · turn 2): 13.3K / 128.0K tokens
P4-LIVE:   novel=19504 used=21762 real=21762 | Context usage (atlas · turn 2): 21.8K / 128.0K tokens
P4-LIVE:   novel=15491 used=16308 real=16308 | Context usage (Task 2 · nova · turn 1): 16.3K / 128.0K tokens
P4-LIVE:   novel=15484 used=16767 real=16767 | Context usage (Task 2 · nova · turn 2): 16.8K / 128.0K tokens
P4-LIVE:   novel=15478 used=17226 real=17226 | Context usage (Task 2 · nova · turn 3): 17.2K / 128.0K tokens
P4-LIVE:   novel=19511 used=21874 real=21874 | Context usage (atlas · turn 3): 21.9K / 128.0K tokens
P4-LIVE: Task 1 (sage) — snapshot block 15049 chars ≈ 10854 tok (est) vs FULL 25885 chars ≈ 19385 tok · usage sections.novel=10928
P4-LIVE:   sections on wire — ledger=5/30, beats=4/40, timeline=8/20, roster=12/12
P4-LIVE: Task 2 (nova) — snapshot block 21216 chars ≈ 15585 tok (est) vs FULL 25885 chars ≈ 19385 tok · usage sections.novel=15491
P4-LIVE:   sections on wire — ledger=30/30, beats=4/40, timeline=20/20, roster=12/12
P4-LIVE: [PASS] A1(i) member wire carried the SLICED novel section (payload < full · meter sections.novel < full estimate) — nova:chapter: snap=15585 tok < full=19385 tok · sections.novel=15491 (< full+400 addenda bound)
P4-LIVE: [PASS] A1(ii) ≥1 big map-excluded section physically ABSENT from a member wire — FORESHADOW bulk absent (5/30 entries on wire, map window=5)
P4-LIVE: [PASS] A1(iii) member artifacts DB-correct — counters == DB truth — verified.chaptersWritten=1 · DB chapters=13 (12 seeded + 1 written at index 13) · ch13.wordCount=382 · verified.words=382
P4-LIVE: [PASS] A1(iii) read-only task produced no DB mutations — reviews=0 finalizes=0 exports=0
P4-LIVE: [PASS] leader transcript gapless — 7 rows, dense 1..N
P4-LIVE: [PASS] Task 1 (sage) conversation gapless — 4 rows, dense 1..N
P4-LIVE: [PASS] Task 2 (nova) conversation gapless — 6 rows, dense 1..N
P4-LIVE: [PASS] budgets.yaml restored BYTE-EXACT to the shipped at-rest state
P4-LIVE: [PASS] probe run + scratch novel cascade-deleted
P4-LIVE: ALL CHECKS PASSED (14 checks)
```

### Reading the evidence (what each number proves)

- **A1(i) — the wire CARRIED the sliced section, metered as sent.** Sage
  snapshot block 15,049 chars ≈ 10,854 tok vs full 25,885/19,385 (−44.0%);
  nova 21,216/15,585 (−19.6%). The meter's `sections.novel` tracked the real
  wire (10,928 sage / 15,491 nova — snapshot + quota/language addenda), and
  the provider's billed `prompt_tokens` (real= column: 12,945 sage turn 1 vs
  21,578 leader turn 1) confirms the member wire actually SHIPPED smaller —
  billed truth, not estimate.
- **A1(ii) — bulk absence is real and SHAPE-SPECIFIC, live.** Sage wire:
  ledger **5/30**, beats **4/40**, timeline **8/20** — the map's windows,
  physically absent. Nova wire: beats **4/40** but ledger **30/30** and
  timeline **20/20** — exactly the `nova:chapter` map, which bounds ONLY the
  outline. Two shapes, two different slices, both matching their declared
  entries on real model-visible bytes.
- **The A2 guard fired live, as designed:** the sage wire carried the FULL
  chapter roster (**12/12**) because the brief says "chapter 13" — the
  chapter-index trigger restored CHAPTERS whole despite its map window. The
  guard is not a paper rule; it shaped the real wire.
- **A1(iii) — behavior unharmed: counters == DB truth.** One verified write
  (Chapter 13, 382 words — `verified.words=382` equals the DB row), read-only
  task mutated nothing, all transcripts gapless.
- **A1(iv) — leader byte-identity, proven live:** the stored leader envelope
  (27,202 chars) equals the pre-P4 construction expression byte-for-byte
  (`equal=true`) and carries the FULL snapshot (40/30/20).

### GLM ledger — §P4-B

All calls glm-4-flash = FREE tier. **Billable calls spent: 0. Billable
tokens: 0. $0.00.** Free-tier call volume (for honesty, not cost): attempt #3
≈ 10 calls (leader + sage task 1 + repair rounds), attempt #4 = 9 calls (3
atlas + 2 sage + 3 nova + 1 sage finish) — every one recorded in the usage
table above or in the deleted attempt-3 run's telemetry pattern.

---

## §P4-C — What stays byte-identical for v1 runs (restated with live proof)

1. **Existing transcripts replay byte-identically** — the assembler path is
   untouched; slicing happens only at NEW-run member-envelope construction.
2. **Wire shape** — `[system_note][envelope][…]` unchanged; role union
   untouched (P3-b ruling); `finalizeWire` untouched.
3. **Leader envelope** — FULL snapshot, byte-identical construction:
   **live-proven** (A1(iv), `equal=true`).
4. **At-rest gate (A4)** — with `contextSlicing.enabled=false`, EVERY member
   envelope of every new run is byte-identical to pre-P4 (S5: all 20 shapes ×
   representative fixture; and the real floor novel, S4, even with the gate
   ON).
5. **Compaction machinery** — untouched; `contextCompaction.enabled=false`
   untouched (S8).
6. **Meter semantics** — the sliced snapshot still rides `sections.novel`,
   metered as sent (A1(i): sections.novel tracked the real sliced wire; §7
   conversationSub invariants untouched).
7. **Pinned refs (A3)** — always whole, outside the module (S7).
8. **All five harnesses green post-probe** — 17 / 13 / 35 / 46 / 38, lint
   clean, dev healthy, DB back to pristine (1 novel / 0 runs / 0 messages).

**Production enablement stays an explicit product decision (A4)** — the same
rule P2 set for compaction. The enablement pack, when that decision is made:
flip `contextSlicing.enabled: true` (no other value exists — the map is
code, not config); expected effect at measured sizes: −44% (sage write),
−20% (chapter research/review) to −84% (build) of the snapshot's share of
member wires, estimator basis (CJK billed truth runs ~1.4× the estimate).

---

## §Phase 5 heads-up (recorded per standing instruction; no work done)

1. **Per-novel ledger question (open since the audit):** pre-novel surfaces —
   wizard / team / generate — must decide attribution to the NEW novel vs
   global. Current ledger reality (`src/lib/usage/ledger.ts`): in-memory
   per-process, per-SURFACE totals only, no model field, no novel field, no
   persistence.
2. **Billing attribution outcome folded in (phase3-stages.md §P3-A-2):** the
   response `model` echo is cosmetic and unread; token records are
   provider-billed counts keyed by request-side selection; the invoice-tier
   residual is not observable from inside the sandbox.
3. **USER-INPUT DEPENDENCY (flagged per this phase's instruction):** the
   Phase 5 invoice-reconciliation row — one real bill/dashboard figure
   reconciled against request-side attribution before any $ display ships —
   requires the **account holder (the author) to pull that figure** from the
   provider console when Phase 5 reaches cost display. No code can discharge
   this dependency; it is recorded here so Phase 5's plan carries it as an
   explicit user-input gate.
4. **The audit's per-novel consumption gap:** needs tag-at-record-time
   (agent runs carry novelId; pre-novel surfaces need §1's policy decision)
   and a persistent store — Phase 5 scope, not now.
