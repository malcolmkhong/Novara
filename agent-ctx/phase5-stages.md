# Phase 5 — Stage Execution Record (evidence embedded)

**Date: 2026-11-05 (UTC). Evidence discipline: every harness line, probe
response, and measurement below is embedded VERBATIM at the moment it was
produced — /tmp logs and DB rows are treated as losable.**

Approval state: **PHASE 5 APPROVED (user, 2026-11-05) with Rulings 1–3 and
Additions 1–2 — P5-a executed and complete. Sextet green. $0.00 GLM.**

Rulings implemented in this stage: **R1** no-cascade ledger (plain-string
scope links, permanent retention documented in the schema, no purge built);
**R2** one source of truth = UsageCall rows (the in-memory ledger still feeds
the panel until the P5-b swap; no NEW consumers were added to it);
**R3** TEAM-1 forensic pass executed read-only and filed
(`agent-ctx/risk-register.md` TEAM-1). **Addition 1** — both features
validated inert (harness S7 + verify-p4 S8); the enablement gate stays a
separate P5-d approval with slicing-first as the working assumption.
**Addition 2** — evidence embedded below; sextet + lint + dev health; zero
GLM; additive schema only; UI untouched in this stage (no UI is in P5-a
scope).

---

## §P5-A — Inert ship: persisted ledger core (schema + store + chokepoints + provenance seams + harness)

### Files touched (additive only)

| file | change |
|---|---|
| `prisma/schema.prisma` | +`UsageCall` (one row per measured call, all surfaces; plain-string `runId`/`taskId`/`conversationId`/`novelId`/`correlationId` — NO FK, NO cascade; `modelId` records the REQUEST-side value, `"gateway-default"` when the request carried no model field) + `UsageProvenance` (the retro-tag link; `@@unique([correlationId, novelId])` makes linking idempotent). Retention (R1) documented in the schema comment: PERMANENT account history; no purge path in Phase 5 scope. |
| `src/lib/usage/usage-store.ts` | NEW — `recordUsageCall()` (fire-and-forget measured-only insert), `recordProvenanceLink()` (fire-and-forget idempotent upsert), `accountUsageSnapshot(period?)` (account shape incl. per-novel breakdown with `deleted`/`(deleted novel)` orphan handling + retention disclosure + honest `since` epoch), `novelUsageSummary(novelId)` (direct + linked, disjoint by construction, + total). |
| `src/app/api/usage/ledger/route.ts` | NEW — `GET /api/usage/ledger?period=YYYY-MM` → account snapshot from the persisted table. Comment pins it as the P5-b data source; `/api/usage/global` gets NO new consumers. |
| `src/app/api/novels/[id]/usage/route.ts` | NEW — `GET /api/novels/[id]/usage` → the novel's own complete ledger (direct + linked + total + per-surface split); 404 for unknown novels. |
| `src/lib/novara/glm.ts` | +optional `ledger?: UsageCallScope` on `glmChat`; alongside the P4 `recordGlobalUsage` every measured call now also persists a `UsageCall` row (`modelId: opts.sdkParams?.model` — undefined ⇒ `"gateway-default"`, never a guessed registry id). |
| `src/lib/agent/runtime.ts` | The two `glmChat` sites pass their scope: leader → `{ runId, novelId, conversationId: "leader" }`; member → `{ runId, novelId, taskId, conversationId: task.id }`. Nothing else. |
| `src/app/api/ai/draft/route.ts` | `ledger: { novelId: novel.id }`. |
| `src/lib/novara/ai-json.ts` + `src/lib/novara/review.ts` | `chatJson` gains optional `ledger` passthrough; review passes `{ novelId: chapter.novelId }`. |
| `src/lib/novara/sediment.ts` | `ledger: { novelId: novel.id }`. |
| `src/lib/novel/glm.ts` | `glmJson` options + `streamGlmProse` gain optional `ledger`; both record sites also persist `UsageCall` rows. |
| `src/app/api/novel/route.ts` (studio init) | **Server-side correlation seam (zero client changes):** request-scoped `ledgerCorrelationId = crypto.randomUUID()`; threaded into `glmJson`'s ledger rows; `recordProvenanceLink("studio", id, novel.id)` right after `db.novel.create` — the pre-novel init spend retro-tags onto the created novel. |
| `src/app/api/novels/route.ts` + `src/lib/novara/schemas.ts` | `createNovelSchema` +optional `wizardSessionId`; the create handler writes `recordProvenanceLink("wizard", wizardSessionId, novel.id)` when present. |
| `src/app/api/ai/wizard/route.ts` | +optional `sessionId` (zod, 8–100 chars); persisted rows carry it as `correlationId`. |
| `src/lib/novara/api.ts` + `src/components/novara/writer/create-wizard.tsx` | Client plumbing: `WizardGenerateInput.sessionId` + `CreateNovelInput.wizardSessionId`; the wizard generates a session id per open (crypto.randomUUID with a non-secure-context fallback) and sends it on EVERY section call and the final create. No visual UI change. |
| `src/app/api/generate/route.ts`, `src/app/api/detect/ai/route.ts`, `src/app/api/detect/hallucination/route.ts` | Persist `UsageCall` rows (global-only surfaces — never culminate in a novel). |
| `src/lib/ai-team/server.ts` | Persist `UsageCall` rows at parity, with the DORMANT note (TEAM-1) — the path cannot fire today (schema absent); instrumentation kept so a revival is ledger-visible from its first call. |
| `scripts/verify-p5.ts` | NEW — the regression quintet becomes a SEXTET (24 checks, zero GLM). |

### TEAM-1 forensic pass (Ruling 3 — read-only, filed before P5-a close)

Full evidence chain in `agent-ctx/risk-register.md` TEAM-1. One-paragraph
summary: b8aa210 (2026-11-01) added the six `model Team*` blocks WITH the
ai-team stack; f32b9df (2026-11-02) removed them (schema diff −205/−224/−237/
−252/−281/−311) along with the routes/components; c23c745 (2026-11-03)
RE-ADDED the backend (`src/lib/ai-team/server.ts`, `/api/team/*`) but not the
schema models; SQLite today holds zero `Team%` tables and the generated
client has no delegates — `db.teamAgent` is literally `undefined`:

```
[team/agents] failed: TypeError: Cannot read properties of undefined (reading 'count')
    at ensureSeed (src/lib/ai-team/server.ts:212:36)
    at GET (src/app/api/team/agents/route.ts:11:21)
GET /api/team/agents 500 in 375ms
```

No repair performed. Fix/rebuild/remove is the user's separate decision.

### scripts/verify-p5.ts — full run output (zero GLM; `prisma:query` client-log lines omitted — they are the dev client's query logging, not harness output)

Two harness defects were caught and fixed BY the harness before the green
run (both in my fixture authoring, never in shipped behavior):
(1) S2's single fixture row shared the S3 surface tag, so a transient count
poll could match mid-flight (a 6-row poll satisfied by 5 S3 rows + the S2
row) — fixed by giving S2 its own `p5-verify-s2` tag;
(2) the S6 reconciliation query filtered by `runId`, which also matches the
S3 leader/member rows (4 rows vs 2 events) — fixed by isolating S6 rows
under `correlationId: "p5-verify-recon"`.

```
P5: [PASS] S1 UsageCall + UsageProvenance tables exist — UsageCall,UsageProvenance
P5: [PASS] S1 no FK on either ledger table (plain-string scope links, no cascade — Ruling 1) — 0 REFERENCES clauses
P5: [PASS] S1 retention documented in schema (permanent history, no purge path — Ruling 1) — prisma/schema.prisma
P5: [PASS] S2 null usage records NOTHING (measured-only, never guessed/padded) — 0 → 0
P5: [PASS] S2 measured call lands via the fire-and-forget write path — 0 → 1 (on its own p5-verify-s2 tag)
P5: [PASS] S7 both features inert through P5 (contextCompaction + contextSlicing enabled:false) — compaction=false slicing=false
P5: [PASS] S3 all six fixture rows persisted — count=6
P5: [PASS] S3 per-run scope = leader + member rows — 2 rows
P5: [PASS] S3 per-member-task scope = exactly the member row — 1 row
P5: [PASS] S3 per-novel (direct) scope = leader + member + draft rows — 3 rows
P5: [PASS] S3 account scope = every fixture row (6), no double counting — 6 rows
P5: [PASS] S4 provenance link written at creation (fire-and-forget) — 1 row
P5: [PASS] S4 per-novel summary: linked = the 2 wizard rows — linked.calls=2
P5: [PASS] S4 per-novel total = direct + linked (complete, disjoint) — total.calls=5
P5: [PASS] S4 link idempotent (double write ⇒ 1 row, totals unchanged) — links=1 total.calls=5
P5: [PASS] S4 account snapshot: fixture novel present, not deleted, totals == direct — calls=3 deleted=false
P5: [PASS] S6 books agree ROW-FOR-ROW (usage events vs UsageCall, same measured calls) — 2 events / 2 rows
P5: [PASS] S6 source pin: every glmChat result feeds BOTH books (emitUsageEvent + recordUsageCall) — runtime.ts + glm.ts
P5: [PASS] S8 novel delete cascades run+events but EVERY UsageCall row survives (no cascade — Ruling 1) — events=0 ledgerRows=9/9
P5: [PASS] S8 novelUsageSummary for a deleted novel = null (route 404s)
P5: [PASS] S8 account snapshot renders the orphan: deleted=true, title=null → '(deleted novel)' — calls=5 deleted=true
P5: [PASS] S5 fixture rows readable via a SECOND freshly constructed PrismaClient (persist beyond process memory) — db2 rows=9 (1 S2 + 6 S3 + 2 S6)
P5: [PASS] S5 the in-memory ledger does NOT see the fixture rows (contrast proof for Ruling 2) — in-memory ledger not initialized in this process
P5: [PASS] Cleanup: fixture rows fully removed, DB back to pre-run shape — calls=0 links=0 novels=2/2 runs=0/0
P5: ALL CHECKS PASSED (24 checks)
```

### Regression SEXTET + ship health (measured 2026-11-05)

| harness | checks | result |
|---------|--------|--------|
| verify-stage-a.ts | 17 | ALL CHECKS PASSED |
| verify-p2-a.ts | 13 | ALL CHECKS PASSED |
| verify-p2-b.ts | 35 | ALL CHECKS PASSED |
| verify-p2-c.ts | 46 | ALL CHECKS PASSED |
| verify-p4.ts | 38 | ALL CHECKS PASSED |
| verify-p5.ts | 24 (NEW) | ALL CHECKS PASSED |

- `bun run lint` — clean (no findings).
- Dev server (`:3000`) — healthy after ONE restart (the running process
  held the pre-`db:push` Prisma client without the new delegates; the
  restart is an expected consequence of additive client generation, not a
  code defect). Live probes after restart, verbatim:

```
GET / → 200
GET /api/usage/ledger →
{"since":null,"period":null,"surfaces":[],"novels":[],"totalCalls":0,
 "totalPromptTokens":0,"totalCompletionTokens":0,"totalTokens":0,
 "retention":"Permanent account history — usage rows survive novel deletion; there is no purge in this build. Rows before the persisted ledger shipped (Phase 5) do not exist."}
GET /api/novels/cmw40s6hc0000t4v8fgaarzkg/usage →
{"novelId":"cmw40s6hc0000t4v8fgaarzkg","title":"abc",
 "direct":{"calls":0,...},"linked":{"calls":0,...},"surfaces":[],"since":null,
 "total":{"calls":0,...}}
GET /api/novels/nonexistent/usage → 404
```

The empty snapshot IS the honest initial state (R2 backfill ruling): rows
before P5-a do not exist; the retention disclosure travels with every
response for the P5-b UI to render.

### Ruling-to-code map

| Ruling | Implementation | Harness proof |
|---|---|---|
| R1 — no-cascade, permanent retention | plain-string scope links (no FK); retention doc in schema; no purge endpoint exists | S1 (0 REFERENCES clauses + doc), S8 (novel delete ⇒ 0 ledger rows lost; orphan rendering) |
| R2 — one source of truth (P5-b swap later) | every measured call persists to UsageCall at all 11 chokepoints; NO new consumers for the in-memory ledger | S2, S3, S6 (books agree row-for-row), S5 (in-memory blind to persisted rows) |
| R3 — TEAM-1 forensics | read-only pass filed in the risk register | the dev.log TypeError + git chain (above) |
| Addition 1 — both inert | no config touched | S7 + verify-p4 S8 (in the green 38) |
| Addition 2 — process | evidence embedded; sextet; lint; $0.00 GLM; additive schema; zero UI | this record |

### GLM ledger — §P5-A

**Billable calls spent: 0. Billable tokens: 0. $0.00.** Free-tier calls: 0.
All evidence is harness output, git history, SQLite introspection, and live
HTTP probes.

### Next: P5-b (awaits user go)

Central "Usage & balance" view at the guest-session anchor; Context Usage
panel's "All AI surfaces" block swapped to `/api/usage/ledger`; the
in-memory ledger retired outright (per R2 the report will declare the
deletion of `recordGlobalUsage`'s UI path + `/api/usage/global`); the
unavailable-not-fabricated balance row (gateway headers verdict, proposal
§5.2); the Phase-5 discontinuity disclosure rendered from the persisted
`since`/retention fields.
