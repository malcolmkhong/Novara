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

**ADDENDUM (2026-11-06, P5-e attempts #1–#3).** SQLite socket timeouts were
observed 2× while a harness controller DB-polled the run row in a tight loop
during live-fire (SQLITE_BUSY-adjacent socket errors under a hammered
single-writer DB). Lesson registered HERE under OPS-2, not as a new OPS
number: **quiet poll is now a standing rig rule.** Harness/observer polling
of live run state must sleep between reads (attempt #2's fix — a 2s interval
polled cleanly for the rest of the session); tight zero-sleep polling of the
same SQLite file as the dev server is treated as rig misuse, equivalent in
spirit to the ~15-min reap: an environmental constraint the rig must absorb,
not a product defect. The product's own DB access (per-call, low-frequency)
was never the trigger.

---

## TEAM-1 — ai-team backend re-added without its schema models; surface 500s (OPEN defect — user decides: fix, rebuild, or remove)

**Found during P5-a** (Ruling 3 forensic pass, 2026-11-05, READ-ONLY — no
repair performed, no code touched).

**Symptom (current build).** Every novel-workspace open renders the mounted
`AiTeamPanel` (`src/components/novara/writer/novel-workspace.tsx` line 365);
its first data call fails:

```
[team/agents] failed: TypeError: Cannot read properties of undefined (reading 'count')
    at ensureSeed (src/lib/ai-team/server.ts:212:36)
    at GET (src/app/api/team/agents/route.ts:11:21)
GET /api/team/agents 500 in 375ms
```

`db.teamAgent` is not an erroring delegate — it is **undefined**: the
generated Prisma client (built from the current schema) has no Team models at
all.

**Evidence chain (git, all dates 2026):**

1. **b8aa210 2026-11-01** — the ai-team stack is born COMPLETE: six models
   (`model TeamAgent / TeamConversation / TeamMessage / TeamTask /
   TeamTaskLog / TeamTurnLog`) enter `prisma/schema.prisma` together with
   `src/lib/ai-team/*`, `src/app/api/team/*`, `src/components/ai-team/*`.
2. **f32b9df 2026-11-02** — a large restructuring commit removes the whole
   ai-team surface: all six `model Team*` blocks out of the schema (diff
   lines −205/−224/−237/−252/−281/−311), all `/api/team/*` routes, all
   `src/components/ai-team/*` components, and `src/lib/ai-team/server.ts`.
3. **c23c745 2026-11-03** — the ai-team BACKEND is re-added
   (`src/lib/ai-team/server.ts`, `/api/team/*` routes re-appear as new
   files) **but the six `model Team*` blocks are NOT restored** —
   `git log -S "model TeamAgent"` shows exactly two schema-touching commits
   ever: b8aa210 (add) and f32b9df (remove). No later commit re-adds them.
4. **Physical DB state (2026-11-05, read-only sqlite_master query):** zero
   `Team%` tables exist in `db/custom.db` — the f32b9df-era
   schema-overwriting push dropped them physically, not just from the
   schema file.
5. **Generated client (2026-11-05):** `node_modules/.prisma/client/index.d.ts`
   contains no `TeamAgent` — hence `db.teamAgent === undefined` and the
   TypeError above (not even a Prisma unknown-model error).

**Why it matters beyond the 500:** the ledger's census (phase5-proposal §2)
treats `ai-team` as a real surface — `glmText`
(`src/lib/ai-team/server.ts:120`) still carries its P4
`recordGlobalUsage("ai-team", …)` line. The surface can never fire in the
current build, but the code path is one schema restore away from running,
so its ledger instrumentation was kept (parity) while the surface itself is
recorded dormant.

**Disposition:** OUT of Phase 5 scope by ruling (user, 2026-11-05). Repair
options on the table for a separate decision: (a) restore the six models
(git-recoverable from b8aa210), (b) rebuild the backend on the current agent
tables, or (c) remove the re-added backend + panel for good. No repair, no
code, no scope creep until the user rules.

---

## OPS-3 — Killed P5-b probe: no diffable gateway counter exists for the incident window (CLOSED — recorded inconclusive, bounded worst case stands)

**Incident.** During P5-b harness development, one probe process
(`p5b-probe-fd.ts`) hung for 60s and was killed before printing anything
(phase5-stages.md §P5-B anomaly disclosure). Window bounded by git: the
P5-a chokepoint commit `3124dbf` (2026-11-05 22:57:26 UTC) and the P5-b fix
commit `7efabab` (2026-11-05 23:56:21 UTC).

**Zero-spend closure check (user-directed, 2026-11-06; result recorded
either way).** An observable counter DOES exist and WAS captured before the
incident — phase3-stages.md §P3-A header JSON, verbatim:
`x-ratelimit-user-daily-remaining: 370`, `x-ratelimit-remaining-daily: 170`,
response date `Thu, 05 Nov 2026 13:00:19 GMT`, `x-ratelimit-reset: 1793883620`
= **2026-11-05 13:00:20 UTC**.

**Why the diff is structurally impossible (no live call spent on it):** the
only pre-incident capture was taken in the daily window that ENDED one second
after it was taken (reset 13:00:20). The incident fell inside the NEXT daily
window (2026-11-05 13:00:20 → 2026-11-06 13:00:20 UTC), whose baseline was
never observed; additionally the P4-B live-fire (phase4-stages.md, embedded
before that record's 21:10:59 UTC commit) consumed the same window before the
incident. A live re-read (which itself requires a free-tier call — headers
ride successful responses only, proposal §5.2) cannot reconstruct a baseline
that never existed, and after 2026-11-06 13:00:20 UTC the incident window's
counter state is unrecoverable regardless. **RESULT: NOT DIFFABLE (baseline
absent).** No GLM call — not even free-tier — was spent producing an
uninterpretable number.

**Bounded worst case (unchanged):** ≤1 unrecorded empty-prompt completion.

**Mitigation — now a standing rule:** mock-first discipline for ALL future
harness probes. A probe that needs gateway-shaped behavior proves the mocked
path first and never constructs the real SDK (P5-b's FA–FF mock.module
pattern is the template; the instrumented re-run proved the mock handled
every call).

---

## OPS-4 — Run-level failure flip is lease-scoped and fires after lease release: stuck-at-running + swallowed error (CLOSED — FIXED as P5-e.1, 2026-11-06)

**Found during P5-e** (attempts #1 and #2 of the slicing live-fire,
2026-11-06 — READ-ONLY observation, no repair performed, no code touched).

**Mechanism.** The run-level catch
(`src/lib/agent/runtime.ts` ~1215–1232) flips a failed run via
`updateMany({ where: { id, leaseOwner: lease.owner, leaseEpoch: lease.epoch } … })`.
When the error surfaces AFTER the lease was released (owner nulled), the
update matches 0 rows, the flip is skipped, and the catch logs ONLY:

```
[agent-runtime] run cmw4ntgs20059n9gdbk0qec4s: failure flip skipped — lease no longer owned (count=0)
```

The actual error `message` is **never logged and never emitted as an event**
(the error event rides the flipped===1 branch). The run row stays
`status=running, error=null` until the 15-minute healer marks it failed.

**Observed consequences (2/2 P5-e attempts).** The closing leader call died
to transient gateway/infra (two 60s timeouts + backoff; the SAME call
succeeded on attempt #3 minutes later), and the post-release error path
then left both runs stuck at `running` with the cause invisible — costing a
manual controller kill + standalone evidence pass each time.

**Bounded blast radius.** UI shows a phantom "running" run for ≤15 min;
underlying artifacts (tasks/events/ledger rows) are intact and were fully
reconcilable in both occurrences. No billing impact (failed calls produce
zero-token rows or nothing, never money).

**Disposition.** OUT of P5-e scope by stage discipline (runtime
error-handling is not the ruled P5-e surface). Fix options for a ruling:
(a) capture the lease identity BEFORE release and flip unconditionally on
0-row match; (b) reorder flip-before-release; (c) log+emit the message
unconditionally in the skipped branch. Smallest honest step is (c) —
observability only.

**RESOLUTION (P5-e.1, user ruling 2026-11-06: "FIX NOW, small and
fence-safe").** Shipped fix = a guarded flip at loop exit
(`guardedFailureFlip`, exported seam in `src/lib/agent/runtime.ts`; the
`executeRun` catch delegates to it). Contract, in order:
1. still-owner fenced flip (owner/epoch CAS) — covers the corner where
   `releaseLease` itself failed (strongest claim);
2. else, if `leaseIsAlive(runId)` is false (nobody holds it), a second CAS on
   `(status ∈ {running, awaiting_approval} AND leaseOwner: null)` writes
   `status=failed` — a claimant that raced in between check and write loses
   the CAS and we stay silent;
3. a LIVE lease ⇒ silence (the holder owns the row); evicted executors can
   NEVER write terminal state over a live lease — the fencing contract is
   strengthened, not relaxed;
4. on a successful flip the executor's REAL error is persisted on the run row
   AND emitted as a kind=error AgentEvent — visible in the event stream,
   never console-only;
5. fail-closed: an unverifiable aliveness check (DB hiccup) stays silent.
`healStaleRuns` was NOT touched (15-min janitor behavior byte-unchanged;
requirement #5); author-owned paused rows and terminal rows are never
clobbered. Harness: `scripts/verify-p5-e1.ts` (18 checks, zero GLM — RC dead-
fence reproduction, stuck-at-running heal with named cause, evicted-vs-live-
lease silence, still-owner flip, terminal/paused/stale-owned refusals,
janitor source pins, zero-spend proof). Full harness family green 2026-11-06.

**Evidence:** agent-ctx/phase5-stages.md §P5-E attempt history (verbatim,
embedded 2026-11-06); agent-ctx/p5e-live-attempt1-evidence.log.txt and
p5e-live-attempt2-full.log.txt (the flip-skip lines + the surrounding
persist-failure context).
