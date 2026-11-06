# P5-g — TEAM-1 repair plan (READ-ONLY, approval-gated)

**Status: APPROVED 2026-11-06 with amendments A1/A2/A3 — folded into §9–§11 below.
Code may start.** Per R-3 (user, 2026-11-06): TEAM-1 is ruled REBUILD but is
new-product scope, so this READ-ONLY plan was delivered first. The original
§1–§8 are preserved verbatim below for the record; where an amendment
contradicts them, the amendment wins. Archived with the Phase 5 report
(agent-ctx/phase5-stages.md).

---

## 1. Forensic chain (verified from git, 2026-11-06)

| Commit | Date | What it did |
|---|---|---|
| `b8aa210` | Nov 1 | ADDED the ai-team backend: 5 schema models (`TeamAgent`, `TeamConversation`, `TeamMessage`, `TeamTask`, `TeamTaskLog`) + all API routes + the floating UI widget |
| `7725023` | (pre-Nov 2) | ADDED the 6th model `TeamTurnLog` (turn telemetry for the self-healing loop) |
| `f32b9df` | Nov 2 | **DELETED all six Team\* models from `prisma/schema.prisma` AND the entire ai-team application surface** (19 files: 4 lib, 5 routes, 10 UI) |
| `c23c745` | Nov 3 | RE-ADDED the ai-team application code verbatim (lib + routes + old UI) alongside the new Novara writer — **but did NOT restore the schema models** |

Result (TEAM-1 in risk-register.md): the generated Prisma client has no
Team models, so `db.teamAgent` is `undefined` and every team surface 500s.
(Corrected 2026-11-06 per amendment A2: the original table said the code
"SURVIVED" f32b9df — in fact f32b9df deleted it too; c23c745 brought it
back one day later without the schema. Same 500 consequence either way.)

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
- No backfill of lost team conversations (none exist in this DB lineage —
  see §11: they DO exist in the Nov-2 backup; restore ruled out absent
  explicit approval).
- No marketing-page floating widget revival (needs a separate ruling).

**Awaiting your ruling: approve the plan as written, or amend.**
→ Ruled 2026-11-06: APPROVED with amendments A1/A2/A3. See §9–§11.

---

## 9. A2 — Forensic addendum (completed before any code, 2026-11-06)

**f32b9df's commit message, quoted verbatim:** `f875634b-46cb-4f37-8d38-7794bf482521`
— an auto-generated UUID. It carries NO intent statement; intent cannot be
read from the message.

**Diff scope:** 69 files changed, +2,968 / −12,977. This is the **Novara
pivot commit** — a wholesale application replacement, not a schema cleanup:
it deleted the ENTIRE old product in one stroke (detector surface ×10 files,
old novel surface ×14 files, ai-team surface ×19 files) and added the Novara
app (marketing pages, writer shell, config, NOVARA_AI_DEVELOPMENT_PLAN.md).
**Verdict: deliberate removal by product replacement** — the ai-team tables
were collateral of the old app's removal, not of a schema reorganization.
The same commit also added `db/custom.backup-20261102-061118.db` (667 KB) —
the pre-pivot database, preserved alongside the deletion (see §11).

**(i) Full grep inventory of surviving `db.team*` references** (every
revival path, not just server.ts:212):

| Path | References |
|---|---|
| `src/lib/ai-team/server.ts` | `db.teamAgent` ×5 (count/upsert/findFirst/findMany), `db.teamConversation` ×2 + updates, `db.teamTurnLog` ×2, `db.teamMessage` ×3 + createMany, `db.teamTask` ×4 (create/updateMany/findUnique/update) |
| `src/app/api/team/agents/route.ts` | `db.teamAgent.findMany` |
| `src/app/api/team/chat/route.ts` | `db.teamAgent` ×4, `db.teamMessage` ×2 + create/createMany, `db.teamConversation` (via helpers) |
| `src/app/api/team/tasks/route.ts` | `db.teamAgent.findUnique/findFirst`, `db.teamTask.create/findMany`, `db.teamTaskLog.create` |
| `src/app/api/team/tasks/[id]/run/route.ts` | `db.teamTask.findUnique` |
| `src/app/api/team/turns/route.ts` | `db.teamTurnLog.findMany/groupBy` |

All six revival paths funnel through the ONE shared client (`@/lib/db`) —
restoring the six models + regenerating the client revives every path
simultaneously. No other file in `src/` touches `db.team*` (verified by
ripgrep over the whole tree).

**(ii) UI entry points driving ai-team TODAY — finding that amends §2/§6:**

- **§2's 500 path is historically real but has NO UI caller today.** Today's
  `novel-workspace.tsx` mounts `ai-team-panel.tsx`, but that panel was
  rebuilt as a STATIC roster card (amber "preview build" notice, config-driven
  agent cards, zero `/api/team` fetches). The plan's §6.1 claim "post-revival
  it works as-is: agents list, per-agent chat, delegated tasks" is FALSE for
  today's build — revived routes make the API healthy, but no UI calls them.
- **The full functional UI exists ORPHANED on disk:**
  `src/components/ai-team/*` (10 files — ai-team-widget, side-panel ×767
  lines, chat-panel ×425, tasks-tab, agents-tab, popout-chat, store, api.ts,
  use-session, use-team; re-added verbatim by c23c745) with ZERO importers
  in the current tree (ripgrep: no `from "…/components/ai-team/…"` matches).
  Its `api.ts` is the only surviving client-side caller of `/api/team/*`.
- **The wizard does NOT depend on ai-team tables.** `/api/ai/wizard` ("New
  with the AI team") is a direct-SDK surface with a team-flavored prompt
  (Atlas/Sage personas); it touches no Team* table.

Per the A2 ruling ("note it but do not fix UI — out of scope"): the orphaned
UI and the static panel are NOT touched in P5-g. Consequence for A1: the
live-fire drives the revived API directly (HTTP), which is sufficient to
prove the CHAT works. UI revival is a separate ruling.

## 10. A1 — Functional live-fire acceptance (added to §7 verification)

The schema + zero-500 proof alone does NOT close P5-g. Acceptance additionally
requires ONE free-flash live team session, shortest sufficient, OPS-1-tightened
goal, budget $0.00:

1. Multi-turn chat against a seeded specialist (full write tools) with the
   message count driven PAST 12 so the `HISTORY_WINDOW = 12` replay slice
   (`server.ts:576 take: HISTORY_WINDOW`) actually trims;
2. `create_novel` fires via the real tool protocol and the wizard-precedent
   provenance link is written (`recordProvenanceLink("ai-team",
   "ai-team:<sessionKey>", novelId)`) — the restored feature reproduces the
   wizard's provenance shape;
3. Ledger rows appear with `surface = "ai-team"` under Policy F semantics
   (measured rows per HTTP attempt; the split is the P5-b-instrumented
   glmText exit paths) — every live-fire row `modelId = glm-4-flash`, zero
   billable-model rows;
4. The novel's OWN ledger view (novel-usage route) shows the linked calls —
   the retro-adoption renders;
5. The wizard entry completes end-to-end: since the wizard is independent of
   Team* tables (§9-ii) and a real wizard call would be billable glm-4.6
   spend (it takes no model override), its live proof is structural — source
   pin that the route touches no Team* table + family green compiles it —
   and the team-side create_novel→provenance chain (item 2) is the live
   wizard-precedent behavior. Disclosed as such in the report.

The eleventh harness (`scripts/verify-p5-g.ts`) stays ZERO-GLM for structure;
this one live run is the behavior proof.

## 11. A3 — Data-loss honesty statement

**All team conversation data from before Nov 2 is permanently gone from the
LIVE database.** The pivot's schema deletion dropped the Team* tables through
db:push; the c23c745 code re-add did not bring the data back. The restored
feature starts EMPTY: `ensureSeed()` rebuilds the 5-agent roster (Atlas/Nova/
Sage/Forge/Prism) on first request; conversations, messages, tasks, task logs
and turn telemetry begin at zero on revival. **No recovery path exists inside
the live database.**

**Backup check (performed 2026-11-06, `db/custom.backup-20261102-061118.db`,
committed by f32b9df itself): the pre-pivot backup DOES still contain all six
team tables with real data** — TeamAgent 5, TeamConversation 21, TeamMessage
149, TeamTask 19, TeamTaskLog 81, TeamTurnLog 7 rows.

Restore-from-backup is technically possible (the backup's team schema matches
the f32b9df^ definitions being restored) but is **NOT advisable** without an
explicit ruling: (a) the rows carry Nov-2-era agent roster and ids that would
clash with the fresh `ensureSeed()` upsert semantics; (b) the live schema has
evolved (Phase 3–5 conventions, UsageCall family) and the backup predates
them; (c) reviving stale conversations/tasks into a fresh feature muddies the
"tracking began" honesty the ledger renders. **No data has been restored and
none will be without the user asking for it.** The backup file is untouched
and remains the sole carrier of pre-Nov-2 team history.
