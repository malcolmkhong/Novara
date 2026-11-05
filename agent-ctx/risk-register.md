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
