# P5-g — TEAM-1 repair plan (READ-ONLY, approval-gated)

**Status: PLAN ONLY — no code has been touched.** Per R-3 (user, 2026-11-06):
TEAM-1 is ruled REBUILD but is new-product scope, so this READ-ONLY plan is
delivered first. **Nothing below executes until you approve it.**
Archived with the Phase 5 report (agent-ctx/phase5-stages.md).

---

## 1. Forensic chain (verified from git, 2026-11-06)

| Commit | Date | What it did |
|---|---|---|
| `b8aa210` | Nov 1 | ADDED the ai-team backend: 5 schema models (`TeamAgent`, `TeamConversation`, `TeamMessage`, `TeamTask`, `TeamTaskLog`) + all API routes + the floating UI widget |
| `7725023` | (pre-Nov 2) | ADDED the 6th model `TeamTurnLog` (turn telemetry for the self-healing loop) |
| `f32b9df` | Nov 2 | **DELETED all six Team\* models from `prisma/schema.prisma`** — while the ai-team application code (`src/lib/ai-team/*`, `src/app/api/team/*`) SURVIVED |

Result (TEAM-1 in risk-register.md): the generated Prisma client has no
Team models, so `db.teamAgent` is `undefined` and every team surface 500s.

## 2. The exact 500 path (today's build, traced)

```
novel-workspace.tsx:365   <AiTeamPanel /> mounts on EVERY novel-workspace open
  → ai-team-panel first data call: GET /api/team/agents
    → src/app/api/team/agents/route.ts:11  ensureSeed()
      → src/lib/ai-team/server.ts:212  const count = await db.teamAgent.count()
        → TypeError: Cannot read properties of undefined (reading 'count')
          (db.teamAgent does not EXIST in the generated client)
      → GET /api/team/agents 500
```

The fix is schema-only: once the six models are restored and the client is
regenerated, `db.teamAgent` exists, `ensureSeed()` seeds the 5 default agents
(atlas/writer/engineer/analyst + leader), and **all five team routes return**:
`/api/team/agents`, `/api/team/chat` (GET+POST), `/api/team/tasks`
(GET+POST), `/api/team/tasks/[id]/run`, `/api/team/turns` (turn telemetry).

## 3. Restored schema — original form + current-convention adaptations

Source of truth: `git show b8aa210:prisma/schema.prisma` (five models,
verbatim) + `git show f32b9df^:prisma/schema.prisma` (TeamTurnLog, verbatim).
The six models are ADDITIVE to today's schema: **zero existing tables are
touched, zero columns altered, no name collisions** (current schema has 0
`model Team*` declarations — verified).

Verbatim restoration (fields unchanged): TeamAgent (`key` unique, capabilities
JSON-string, isLeader, emoji/color/sortOrder), TeamConversation
(`@@unique([agentId, sessionKey])`), TeamMessage (`taskIds` JSON-string,
`@@index([conversationId, createdAt])`), TeamTask (status/progress/result/
error/sessionKey/assignee/creator/creatorIsUser, `@@index([status])`),
TeamTaskLog (`@@index([taskId, createdAt])`), TeamTurnLog (agentKey/label/
outcome/rounds/toolCalls/correctionsFired/durationMs, `@@index([createdAt])`,
`@@index([agentKey, outcome])`). Internal relations keep the original
`onDelete: Cascade` — the same style the current schema uses for
AgentEvent → AgentRun.

**Adaptations to current conventions (the only deltas from the originals):**
1. **Novel scope columns** (ledger family convention: plain string, NO FK,
   NO cascade — identical to UsageCall.novelId):
   - `TeamConversation.novelId String?` — a conversation opened inside a
     novel workspace is pinned to that novel; all its turns attribute there.
   - `TeamTask.novelId String?` — tasks created from that conversation
     inherit it (delegation provenance).
2. **Header comments** updated to current style + a TEAM-1 reference
   ("restored per P5-g plan; deleted in f32b9df, original b8aa210/7725023").
3. Nothing else. The JSON-as-serialized-string pattern already matches the
   current codebase (SQLite + Prisma, same as AgentRun.stateJson).

## 4. Migration strategy

- **One step**: append the six models to `prisma/schema.prisma` →
  `bun run db:push`. Additive-only; today's push path is the project
  standard (used by P5-a and P5-f without incident).
- **Pre-flight check** (in the implementation pass, before push): confirm the
  live SQLite file holds no orphaned `Team*` tables from the b8aa210 era
  (the DB was recreated during Phase 3/4, and today's P5-f push ran drift-
  clean in 21ms, so none are expected; `sqlite_master` query included in the
  implementation checklist). If any exist, `db push` reconciles them to the
  restored schema — no data decision is required either way.
- **Seed**: `ensureSeed()` (already in server.ts, upsert-safe against the
  unique key) repopulates the 5 default agents on first request after
  revival. Historical team CHAT data is gone (tables were empty at deletion
  in this DB lineage); the plan does NOT fabricate any.
- **Rollback**: one commit revert + `bun run db:push` (tables dropped).
  The ledger is untouched by the rollback: `ai-team` UsageCall rows are
  plain rows in an independent table.

## 5. Ledger integration (ruled: surface tag + novelId attribution)

`recordUsageCall({ surface: "ai-team", … })` is ALREADY wired at both
glmText and glmAgentTurn exit paths (server.ts ~130 measured / ~134 failed;
instrumented at parity in P5-b while dormant, so the revival is
ledger-visible from the first call). Two integration deltas in this plan:

1. **Scope threading**: `glmAgentTurn(messages, label, timeoutMs)` and
   `glmText(...)` gain an optional trailing `scope?: { novelId?: string;
   correlationId?: string }` parameter, passed through to both
   `recordUsageCall` call sites. Callers:
   - Chat/task routes read `novelId` (and pass `sessionKey`) from the
     request — the writer's AiTeamPanel mount sends the workspace's novelId.
     A novel-scoped conversation pins `TeamConversation.novelId` at creation
     (`getOrCreateConversation` gains the optional novelId argument) and
     every turn's ledger row carries that novelId → the novel's OWN ledger
     (direct attribution, same as agent runs).
2. **Pre-novel sessions follow the wizard precedent** (exact R-3 wording):
   a floating/pre-novel conversation records
   `correlationId = "ai-team:" + sessionKey` (namespaced so provenance rows
   are self-describing) with novelId = null → account-only. IF the session
   culminates in `create_novel` (the novel-tool protocol already supports
   it), the route writes ONE `UsageProvenance` row
   (`recordProvenanceLink("ai-team", correlationId, novelId)` — idempotent
   per the P5-a unique index) and the novel's ledger retro-adopts those
   calls as `linked`, exactly like the wizard. No novel → account-only
   history, honestly rendered as unattributed in the account view.
3. Pricing: ai-team calls run glm-4.6 → priced (0.6/2.2 upper bound) — the
   ESTIMATE split and the per-model "By model" lines pick the surface up
   with zero view changes. The badge surface label "Onboarding team build"
   already exists (P4-era SURFACE_LABELS).

## 6. Today's UI entry points (post-revival)

1. **Novel workspace → AI Team panel** (`novel-workspace.tsx:365`) — the
   ONLY mount in today's build, and the source of the 500. Post-revival it
   works as-is: agents list, per-agent chat, delegated tasks, task runs.
   Novel-scoped by the workspace's novelId (new prop thread, §5.1).
2. **b8aa210's floating widget / marketing-page entry is NOT in today's
   build** — the plan does not re-add it (new-product scope belongs to the
   rebuild ruling, not this repair). If you want a floating pre-novel team
   chat (the wizard-precedent path in §5.2), that is an explicit add-on
   decision after this plan is approved.
3. **Usage surfaces** (zero new UI): the badge's "Onboarding team build"
   surface line and the novel ledger's direct rows appear automatically.

## 7. Effort shape + verification plan (for AFTER approval)

- Small, fence-safe, one stage: schema block (+6 models, 2 scope columns) →
  db:push → scope threading in server.ts + 3 routes → AiTeamPanel novelId
  prop → `scripts/verify-p5-g.ts` (eleventh harness, ZERO GLM): DDL pin
  (six tables exist, original columns verbatim), ensureSeed green against
  the real client, all five routes 200-shaped, ledger scope assertions via
  fixture-backed recordUsageCall (novel-scoped / correlation / provenance
  link on create_novel path), 500-path regression (agents route returns
  200 with seeded agents). Full family re-run + lint + dev health.
- GLM budget: zero (mock-first standing rule — no live team calls needed to
  prove the revival; first REAL spend belongs to whoever uses the feature).

## 8. Explicitly out of scope (this plan)

- No new UI beyond wiring the existing panel's novelId prop.
- No changes to the agent runtime, the ledger schema (UsageCall/UsageDaily/
  UsageProvenance untouched), or any P5-e/f behavior.
- No backfill of lost team conversations (none exist in this DB lineage).
- No marketing-page floating widget revival (needs a separate ruling).

**Awaiting your ruling: approve the plan as written, or amend.**
