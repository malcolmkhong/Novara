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

---

## §P5-B — Failed-call accounting + ledger retirement + central view (evidence embedded)

**Date: 2026-11-05 (UTC). Approval state: P5-a ACCEPTED; P5-b executed per
the user's four requirements (failed-call accounting, outright deletion,
anchor census, panel regression invariants). Sextet + P5-b harness green.
$0.00 GLM billable — one anomaly investigated and resolved (below).**

### Requirement 1 — FAILED-CALL ACCOUNTING (Policy F, pinned)

Decision (user's menu: rowless-with-documentation OR zero-token failed rows
— **both**, split by what our boundary observed):

- **F1 — one row per HTTP ATTEMPT after send.** A retry inside glmChat's
  loop writes one row per attempt, not one per logical call. `measured`
  (tokens as billed) when the provider returned a usage object; `failed`
  (zero tokens + `errorKind`) when the attempt ended with NO completion
  payload at our boundary (timeout / transport drop / 429 / 5xx / mid-flight
  abort). An ultimately-failed call leaves ONLY failed rows (F2).
- **F3 — pre-send failures record NOTHING** (SDK init, abort before send):
  the provider was never reached, so there is no provider event to account.
- **F4 — completion payload received WITHOUT a usage object records
  NOTHING** (streaming without a usage chunk, stripped usage, empty content):
  token counts are unknowable, and a 0-token row would understate. This is
  the P4 measured-only rule, unchanged, now scoped precisely.
- **Zero tokens on `failed` rows mean UNKNOWN, never "0 billed"** — whether
  the provider billed a timed-out/429'd attempt is unobservable at our
  boundary (same verdict family as the P3 cache investigation: no billing
  API). The `status` column makes the distinction machine-readable so Σ
  tokens is never misread as complete truth over failed attempts.
- **Schema (additive):** `UsageCall.status String @default("measured")` +
  `UsageCall.errorKind String?` (`timeout | rate-limit | server-error |
  network | aborted | unknown`). Policy F documented in schema + store +
  `usage-shapes.ts` comments.
- **Billed-truth completeness FIX found by re-audit:** extraction now runs
  BEFORE the empty-content check in `glmChat`, so a completion that returned
  usage but empty content lands its billed row (pre-P5-b this call leaked
  from every ledger). The streaming writer route preserves the same ordering.
- **Surfaces that cannot observe failures:** after P5-b, NONE at the
  chokepoints — every send site (glmChat; glmJson; streamGlmProse; detect ×2;
  wizard; generate; ai-team glmText) wraps the send with per-attempt
  recording under its own scope (wizard failures keep the session
  correlationId and retro-tag like successes). Residual blind spots,
  documented: (1) process death mid-call (OPS-2 sandbox reaping) — nothing
  can record; (2) F4 no-usage completions; (3) F3 pre-send failures.
- **Reconciliation (§4.5) extended:** AgentEvent usage events exist only for
  SUCCESSFUL turns — the run feed is a transcript, the ledger is the billing
  view. Books agree on the measured subset; failed rows are the exactly-zero
  complement with kinds. Evidence: harness RB below.

**LATENT P5-A DEFECT FOUND AND FIXED:** both `detect` routes called
`recordUsageCall` with NO import (verified against the committed P5-a tree,
`git show HEAD:src/app/api/detect/ai/route.ts`). The route never compiled
since P5-a (Next compiles lazily; lint has no type resolution) so nothing
surfaced. P5-b's chokepoint rework fixed the imports; disclosed here per the
no-silent-fixes rule.

### Requirement 2 — IN-MEMORY LEDGER: DELETED OUTRIGHT

- `src/lib/usage/ledger.ts` — DELETED. `/api/usage/global/route.ts` —
  DELETED (live probe: HTTP 404). `recordGlobalUsage` removed from all 11
  chokepoints. NO debug layer, NO dual feed (user ruling).
- `extractRealUsage` + `RealUsage` + all ledger read-shape types moved to
  the new client-safe `src/lib/usage/usage-shapes.ts` (zero imports — the
  panel and central view consume types from it, never from the db-side
  store).
- The discontinuity renders from the PERSISTED `since`: the panel's swapped
  block shows "Tracking began Nov 5, 2026 · earlier calls were not
  recorded · history is permanent"; the central view states "persisted
  tracking began with Phase 5; calls before it were never recorded (no
  backfill)" when empty. Nothing pretends history.

### Requirement 3 — ANCHOR VISIBILITY CENSUS (agent-browser, pre- AND post-swap)

| surface | badge | spend-producing | evidence |
|---|---|---|---|
| `#/` home (marketing) | ABSENT | no | navbar buttons: Login/none — snapshot |
| `#/product` (+ all marketing routes, shared Navbar) | ABSENT | no | eval: "BADGE ABSENT \| navbar buttons: Login" |
| `#/writer` dashboard | PRESENT | yes (wizard/studio-init entries) | eval: "BADGE PRESENT — header: AI Writer" |
| `#/writer` workspace (novel open) | PRESENT | yes (agent/draft/review/sediment/studio-write) | eval: "BADGE PRESENT in workspace" |
| CreateWizard dialog open | PRESENT | yes | eval: "BADGE PRESENT with wizard open (dialogs=1)" |

Verdict: the Guest-session badge is present on EVERY surface that produces
spend; marketing routes carry no badge and produce zero GLM spend. The
detector/generate surfaces are API-only today (their UI components are
orphaned — `AiDetectorPanel`/`HallucinationPanel` mounted nowhere), so no
reachable-path requirement arises from them. **Census PASSES — anchor
unchanged**, now a keyboard-focusable button (`aria-label="Guest session —
usage and balance"`) that OPENS the central view. Re-verified after the
swap: identical matrix.

### Requirement 4 — PANEL REGRESSION INVARIANTS (same data, pre vs post)

Fixture: `scripts/p5b-fixture-up.ts` — run `p5b-panel-run` + three
`kind="usage"` events on the scratch novel (turn-3 billed 6400/out 300; run
Σ prompt 15600/out 660/billed 16260). ZERO GLM — rows written directly.
Captured via agent-browser snapshots, verbatim:

| block | PRE-swap | POST-swap | verdict |
|---|---|---|---|
| THIS-CALL | Context Usage · GLM-4.6 · 6.1K / 200.0K · 3.0% · measured · output 300 · billed 6.4K · sections 1.1K/18.0% · 750/12.3% · 400/6.6% · 1.7K/27.9% · 2.1K/35.2% · MCP 0 | IDENTICAL byte-for-byte | ✅ invariant holds |
| THIS-RUN | Run total 3 calls · 16.3K · prompt 15.6K · output 660 · All calls measured from provider usage. | IDENTICAL | ✅ invariant holds |
| ALL AI SURFACES | "server process · since restart" + "No measured AI calls yet…" (in-memory empty after restart — the lie P5-b removes) | "this account · persisted ledger" + "Tracking began Nov 5, 2026 · earlier calls were not recorded · history is permanent" + surface rows + Σ + retention | ✅ only this block changed source |

Screenshots: `agent-ctx/p5b-evidence-panel-preswap.png`,
`p5b-evidence-panel-postswap.png`. The THIS-CALL/THIS-RUN code paths were
not touched by the swap (git diff scope: Layer-3 fetch + types only).

### Central "Usage & balance" view (proposal §5)

`usage-balance-badge.tsx` mounted at the badge anchor in `writer-app.tsx`
header (both dashboard and workspace states). Renders, from
`/api/usage/ledger` only: the **Balance: unavailable** row (unavailable-not-
fabricated — the gateway exposes call-count quotas, no billing API; verbatim
from the §5.2 verdict), **Account usage** (Σ calls with failed-attempts
disclosed separately as "(incl. N failed · 0 tokens)", Σ tokens, in/out, by-
surface and by-novel splits in a `nice-scroll` max-h-40 list, deleted novels
as "(deleted novel)"), and the **discontinuity + retention** disclosure from
the persisted `since`/`retention` fields. Loading, error ("Usage ledger
could not be loaded — nothing is shown rather than showing stale numbers")
and honest-empty states all implemented. Screenshots:
`p5b-evidence-central-empty.png`, `p5b-evidence-central-populated.png`.

### New account aggregate (additive)

`AccountUsageSnapshot.failedCalls` — COUNT(status="failed") so UIs can
disclose that call counts include attempts with no completion payload.

### scripts/verify-p5-b.ts — full run output (ZERO GLM: all model-call shapes run against a mocked z-ai-web-dev-sdk via bun mock.module — no packet leaves the process)

Two harness defects were caught and fixed BY the harness before the green
run (both in my fixture authoring, never in shipped behavior):
(1) the FD expectation assumed one row — the probe proved glmChat's
pre-existing loop retries EVERY error instantly (backoff is transient-only;
P4 semantics, unchanged) and each attempt returned usage, so THREE measured
rows IS the correct per-attempt billed truth; the harness now pins that;
(2) the novel-fixture `void db.usageCall.create(...)` writes never executed
— root cause: Prisma Client v6 promises are LAZY, a bare `void promise`
(with no `.then`/`.catch`/`await`) never dispatches the query; every shipped
path is safe because `recordUsageCall`/`recordProvenanceLink` always attach
`.catch`. Fixture writes now attach `.catch` too.

```
P5B: [PASS] SC status + errorKind columns exist on UsageCall (additive — Policy F) — status,errorKind
P5B: [PASS] FA retry shape: transient-429-then-success ⇒ TWO rows for ONE logical call (F1 per-attempt) — 2 attempts, HTTP calls=2
P5B: [PASS] FA attempt-1 = failed row (0 tokens, errorKind rate-limit), attempt-2 = measured (billed truth) — a1=failed/rate-limit/0 a2=measured/150
P5B: [PASS] FB ultimately-failed call: 3 attempts (budget retries=2) ⇒ 3 failed rows, 0 measured, caller gets the error (F2) — 3 failed rows, threw="429 Too Many Requests — still slammed"
P5B: [PASS] FC completion WITHOUT usage object ⇒ rowless (F4 — tokens unknowable, never 0-claimed) — rows=0
P5B: [PASS] FD empty content WITH usage ⇒ billed row PER ATTEMPT (3 instant retries × 77 tok measured) even though the call errors — 3 measured rows (77 tok each), threw="The AI returned an empty respons"
P5B: [PASS] FE SDK-init failure (never reached the provider) ⇒ NO row (F3) — rows=0
P5B: [PASS] FF timeout on every attempt ⇒ 3 failed rows with errorKind=timeout, caller gets the timeout — 3 timeout rows, threw="p5b FF timed out after 0.06s"
P5B: [PASS] RB books agree over a failed/retried shape: Σ measured rows == provider-truth usage (150 + 77×3) — measured=4 Σ=381/381
P5B: [PASS] RB every failed row is 0-token with an errorKind; failed attempts never masquerade as usage — failed=7, all 0-token+kind
P5B: [PASS] RB failed attempts have NO AgentEvent counterpart (run feed = transcript; ledger = billing view) — 0 events for p5b-verify attempts
P5B: [PASS] RT fixture precondition: 4 novel-scope rows + 1 provenance link landed (fire-and-forget awaited) — 4 rows + 1 link
P5B: [PASS] RT /api/usage/ledger 200 — persisted snapshot with since/retention/failedCalls — since=2026-11-05 failedCalls=8
P5B: [PASS] RT snapshot.failedCalls == COUNT(status='failed') in the table (failed attempts disclosed, not hidden) — snapshot=8 db=8
P5B: [PASS] RT /api/usage/global is RETIRED (404) — no dual feed survives (Ruling 2) — status=404
P5B: [PASS] RT per-novel: total.calls == direct + linked (4 = 2 direct incl failed + 2 linked), total.Σ == 660 — direct=2(550) linked=2(110) total=4(660)
P5B: [PASS] RT retention disclosure travels on BOTH ledger routes — identical disclosure string on /api/usage/ledger and /api/novels/[id]/usage
P5B: [PASS] RT deleted novel ⇒ orphan renders on the ACCOUNT route (deleted:true, calls kept) — calls=2 Σ=550
P5B: [PASS] RT deleted novel ⇒ per-novel route 404s (documented: orphan history lives on the account route) — status=404
P5B: [PASS] SP in-memory ledger fully deleted: file gone, /api/usage/global gone, zero imports (no debug layer) — deleted outright (Ruling 2)
P5B: [PASS] SP panel Layer-3 fetches /api/usage/ledger; central view mounted at the writer-app badge anchor — panel swap + central view pin
P5B: [PASS] SP glmChat keeps the dual-feed source pin (emitUsageEvent in runtime + recordUsageCall in glm) and records failed attempts — runtime.ts + glm.ts
P5B: [PASS] RS fixture rows readable via a SECOND freshly constructed PrismaClient (persist beyond process memory) — db2 rows=15/15
P5B: [PASS] Cleanup: fixture rows fully removed, DB back to pre-run shape — calls=0 links=0 novels=2/2
P5B: ALL CHECKS PASSED (24 checks)
```

### Regression SEXTET + P5-b harness (measured 2026-11-05, after all P5-b changes)

| harness | checks | result |
|---------|--------|--------|
| verify-stage-a.ts | 17 | ALL CHECKS PASSED |
| verify-p2-a.ts | 13 | ALL CHECKS PASSED |
| verify-p2-b.ts | 35 | ALL CHECKS PASSED |
| verify-p2-c.ts | 46 | ALL CHECKS PASSED |
| verify-p4.ts | 38 | ALL CHECKS PASSED |
| verify-p5.ts | 24 (S5 updated: retirement proof) | ALL CHECKS PASSED |
| **verify-p5-b.ts** | **24 (NEW — "6+1")** | **ALL CHECKS PASSED** |

- `bun run lint` — clean (one finding during development — sync setState in
  the central view effect — fixed by moving the reset into the open-change
  handler; final run: no findings).
- Dev server: restarted ONCE after `db:push` (the running process held the
  pre-push Prisma client without `status`/`errorKind` — expected consequence
  of additive client generation, same as P5-a). Post-restart probes:
  `GET /api/usage/ledger → 200` (with `failedCalls` + retention),
  `GET /api/usage/global → 404`.
- Post-cleanup DB state: UsageCall rows = 0, panel fixture run deleted
  (events 0, runs 0) — the ledger's honest empty state IS the shipped
  initial state.

### $0.00 GLM ledger — §P5-B, including an investigated anomaly

**Billable calls spent: 0. Billable tokens: 0. $0.00.** All six mocked
scenarios (FA–FF) ran against a mocked SDK in-process; the probe that
verified the FD shape returned in milliseconds with mocked data, proving no
network path. ANOMALY, disclosed for completeness: one earlier probe run
(`p5b-probe-fd.ts`) hung for 60s and was killed before printing anything;
the identical probe re-run completed instantly under the mock, and the
instrumented re-run showed the mock factory + fake client handling every
call (no real request was observable). I cannot PROVE a negative for the
killed run — if a single request had escaped to the gateway it would have
been one empty-prompt completion at most; no usage/billing evidence of it
exists at our boundary (and per Policy F4/F3 no row would exist either way).
All harness-side evidence (instant mocked returns, no SDK config in the
harness process env) indicates the mock was active throughout.

### Requirement-to-code map

| Requirement | Implementation | Proof |
|---|---|---|
| 1 — failed-call accounting | Policy F in schema/`usage-shapes.ts`/`usage-store.ts`; per-attempt recording in glmChat, glmJson, streamGlmProse, detect ×2, wizard, generate, ai-team | FA–FF + RB + SC (verify-p5-b) |
| 2 — delete outright | ledger.ts + /api/usage/global deleted; zero imports; single-source swap | SP + RT-404 + panel/browser evidence |
| 3 — anchor census | badge verified on all spend surfaces (pre & post); central view mounted there | census matrix + central-view screenshots |
| 4 — panel invariants | THIS-CALL/THIS-RUN byte-identical pre/post on the same fixture; only Layer-3 source changed | fixture + verbatim captures + screenshots |
| 6+1 | sextet green + verify-p5-b 24 checks | table above |

### Next: P5-c (awaits user go)

Pricing module (`src/lib/usage/pricing.ts`, ESTIMATE-labeled, §6),
per-model split, the §6 invoice paste-slot, and the P5-d enablement gate
remain. Slicing-first stays a working assumption only.

---

## §P5-C — Pricing module + per-model split + invoice reconciliation (evidence embedded)

**Date: 2026-11-06 (UTC). Approval state: P5-b ACCEPTED (user, 2026-11-06) with
three closers (OPS-3 zero-spend check, detect-route retrospective, P5-c
requirements). Sextet + P5-b harness + NEW P5-c harness green. Lint clean.
$0.00 GLM — zero billable, zero free-tier calls; the pricing sources were
fetched LIVE from the public docs via plain HTTP (no model calls).**

### Closers executed BEFORE P5-c code

**1. OPS-3 anomaly closure — recorded NOT DIFFABLE, zero calls spent.**
Observable counters exist and were captured pre-incident (phase3-stages.md
§P3-A, verbatim: `user-daily-remaining: 370`, `remaining-daily: 170`, response
date `2026-11-05 13:00:19 GMT`, `x-ratelimit-reset: 1793883620` =
**2026-11-05 13:00:20 UTC**). The killed probe's window (bounded by commits
`3124dbf` 22:57:26 → `7efabab` 23:56:21 UTC) fell in the NEXT daily window
(Nov 5 13:00:20 → Nov 6 13:00:20 UTC), whose baseline was never observed; the
P4-B live-fire (embedded before that record's 21:10:59 UTC commit) consumed
the same window before the incident. A live re-read cannot reconstruct a
baseline that never existed, and the window closed 2026-11-06 13:00:20 UTC.
Full entry: risk-register.md OPS-3. Bounded worst case stands (≤1 unrecorded
empty-prompt completion); mock-first is now the standing rule for all future
probes.

**2. Detect-route retrospective (for the P5-c report, two sentences).**
Git dates: the missing-import defect was introduced by the P5-a chokepoint
commit `3124dbf` (2026-11-05 22:57:26 UTC — both detect routes gained
`recordUsageCall(...)` without importing it, alongside the still-present
`recordGlobalUsage`) and fixed by the P5-b commit `7efabab` (2026-11-05
23:56:21 UTC) — a 59-minute window. No real detect call occurred in that
window: the surviving dev.log contains zero `/api/detect` requests (binary-
safe scan, 0 matches), the detect UI panels are mounted nowhere (P5-b
census), and the UsageCall table has held zero detect rows ever (census
2026-11-06) — with the honest caveat that the defect's failure mode
(ReferenceError at the record line, which executes only AFTER a completed GLM
response) would have left no row even if a call had happened, so the log +
orphaned-UI evidence, not the ledger, is what answers this.

**3. Pricing sources fetched LIVE (2026-11-06, HTTP 200, plain curl — $0.00
GLM, no model involved).**

```
curl https://docs.z.ai/guides/overview/pricing      → 200 (162,439 bytes)
curl https://docs.z.ai/guides/llm/glm-4.6           → 200 (357,846 bytes)
curl https://docs.z.ai/guides/llm/glm-4-flash       → 404 (no such docs page)
parsed <thead>: Model | Input | Cached Input | Cached Input Storage | Output
parsed rows (Prices per 1M tokens):
  GLM-4.6     | $0.6 | $0.11 | Limited-time Free | $2.2
  GLM-4.5-Air | $0.2 | $0.03 | Limited-time Free | $1.1
  GLM-4.5-Flash / GLM-4.7-Flash | Free (all columns)
  NO glm-4-flash row, NO glm-4-long row on the fetched page
```

### Files touched

| file | change |
|---|---|
| `src/lib/usage/pricing.ts` | NEW — versioned static table (`2026-11-06.1`) keyed by request-side modelId; header carries sourceUrl + fetchedAt + the parsed rows verbatim; `priceForModelId` (gateway-default → UNPRICED by construction; unlisted ids → UNPRICED, never $0); `estimateUpperBoundUsd`; FOUR money formatters that permanently carry their labels |
| `src/lib/usage/usage-shapes.ts` | additive: `LedgerModelUsage` (calls / failedCalls separately / tokens / priced / unpricedReason / estimatedUsd-null-when-unpriced / pricing provenance), `AccountEstimate` (upperBound:true, Σ over priced groups, unpricedGroups count), `models` + `estimate` on `AccountUsageSnapshot`; `InvoiceEntry` + `InvoiceSnapshot` |
| `src/lib/usage/usage-store.ts` | `accountUsageSnapshot` gains TWO groupBys (modelId all + modelId failed) and prices each group from the static table; unpriced groups counted and EXCLUDED, never zeroed |
| `prisma/schema.prisma` | additive `UsageInvoice` (actualUsd USER text verbatim · periodLabel · estimatedUsd OUR capture · trackedRows · sinceAtSave · pricingVersion; plain strings, no FK, permanent retention family) — db:push clean |
| `src/app/api/usage/invoice/route.ts` | NEW — GET (entries latest-first, cap 20 + provenance) / POST (strict zod: `^\$?\d{1,7}(\.\d{1,2})?$`, non-negative, period required; captures OUR estimate at save; returns delta = display math) |
| `src/components/novara/writer/usage-balance-badge.tsx` | central view ONLY: account ESTIMATE line, "By model · ESTIMATE (upper bound)" block with per-model failed counts + unpriced rows, invoice paste-slot + recorded-comparison list; **zero raw currency glyphs in the file** — every money string flows through the labeled pricing formatters |
| `scripts/verify-p5-c.ts` | NEW harness — 30 checks (PR/DB/RT/SP/RS), ZERO GLM structural (never imports the SDK) |
| `agent-ctx/risk-register.md` | OPS-3 filed (NOT DIFFABLE + standing mock-first rule) |

Panel (`context-usage-panel.tsx`): **UNTOUCHED** — no pricing import, no
currency glyph (harness-pinned); THIS-CALL/THIS-RUN invariant holds by
construction, ALL-AI-SURFACES block unchanged from P5-b.

### Browser verification (agent-browser, golden path, evidence verbatim)

Fixture rows up (4 × `p5c-browser`, written directly — no model calls);
`#/writer` → badge clicked → central view:

```
4 calls (incl. 1 failed · 0 tokens)   Σ 17.8K tok   in 16.5K · out 1.3K
$0.0112 ESTIMATE (upper bound) | 1 model group unpriced (excluded)
BY MODEL · ESTIMATE (UPPER BOUND)
  glm-4.6                        ×3 (1 failed · 0 tok)  16.0K  $0.0112 EST
  gateway default (no model field)  ×1                  1.8K   unpriced model
  "Measured tokens × sourced price table (2026-11-06.1); the cached-input
   discount is invisible to us, so every figure is an upper bound. Unpriced
   rows have NO sourced price — shown, never guessed."
```

Paste-slot golden path (through the REAL UI): period "Nov 2026
(browser-verify)" + figure "0.05" →

```
Recorded for Nov 2026 (browser-verify): $0.05 — your figure (as pasted) ·
  +$0.0388 vs our ESTIMATE          [0.05 − 0.0112 = 0.0388, exact]
Recorded comparisons (1): … our side: $0.0112 ESTIMATE (upper bound)
  at save: 4 tracked rows · prices 2026-11-06.1
```

Screenshot: `agent-ctx/p5c-evidence-central-p5c.png`. Console: clean
(HMR/Fast-Refresh only); dev.log error sweep: none. Empty-input submit in the
real UI correctly shows the guard message. Cleanup: 4 fixture rows + 1
browser-created invoice entry deleted; shipped initial state re-verified
(calls=0, invoices=0).

**UI defect found and fixed BY browser verification:** the P5-c additions
made the popover 766px tall against a 577px viewport — the Record button was
outside the viewport and unclickable. Fixed by capping + scrolling the
popover body (`max-h-[calc(100vh-4rem)] overflow-y-auto`); re-verified
clickable, harness SP pins re-run green (they read the badge source).

### scripts/verify-p5-c.ts — full run output (ZERO GLM: never imports the SDK)

```
P5C: [PASS] PR glm-4.6 priced from the fetched table — 0.6 in / 2.2 out, cached 0.11 present-never-applied — v2026-11-06.1 fetched 2026-11-06
P5C: [PASS] PR glm-4.6 row carries sourceUrl + fetchedAt (reproducible to a dated doc snapshot) — https://docs.z.ai/guides/overview/pricing
P5C: [PASS] PR glm-4.5-air priced — 0.2 in / 1.1 out (fetched 2026-11-06) — priced
P5C: [PASS] PR fixture math exact: glm-4.6 (1M in, 0.5M out) = 1.70; glm-4.5-air (2M in, 1M out) = 1.50 — a=1.7 b=1.5
P5C: [PASS] PR gateway-default rows are UNPRICED by construction (never priced by guess) — reason=gateway-default
P5C: [PASS] PR glm-4-flash + glm-4-long have NO row on the fetched docs (verified 2026-11-06; flash docs page 404s) → UNPRICED, never $0 — flash=unlisted-model long=unlisted-model
P5C: [PASS] PR unknown future modelId → UNPRICED (unlisted-model), never guessed — reason=unlisted-model
P5C: [PASS] PR formatEstimateUsd ALWAYS renders the full ESTIMATE (upper bound) label — e.g. $0.0051 ESTIMATE (upper bound) | $1234.56 ESTIMATE (upper bound)
P5C: [PASS] PR compact per-row formatter still carries the EST label (no bare $ anywhere) — e.g. $0.0051 EST
P5C: [PASS] PR pasted-figure formatter always marks it as the USER's input — e.g. $12.34 — your figure (as pasted)
P5C: [PASS] PR delta formatter always frames the gap against OUR ESTIMATE — e.g. +$0.0049 vs our ESTIMATE
P5C: [PASS] PR pricing version + source pinned: versioned table, dated docs URL — v2026-11-06.1
P5C: [PASS] DB per-model split: glm-4.6 = 3 calls (2 measured + 1 failed), tokens ONLY from measured rows — calls=3 failed=1 tok=4500
P5C: [PASS] DB failed COUNT shows separately next to the model's cost; failed rows contribute 0 tokens by definition — in/out=3000/1500 (failed row: 0/0)
P5C: [PASS] DB glm-4.6 estimate == measured tokens x listed price (upper bound) — 0.0051
P5C: [PASS] DB gateway-default group: UNPRICED (reason gateway-default), estimatedUsd NULL — never $0-by-guess — reason=gateway-default est=null
P5C: [PASS] DB glm-4-flash group: UNPRICED (no sourced row on the fetched docs), estimatedUsd NULL — reason=unlisted-model est=null
P5C: [PASS] DB account estimate = Σ over PRICED groups only; unpriced groups counted, excluded, never zeroed — usd=0.0051 unpricedGroups=2
P5C: [PASS] RS fixture rows readable via a SECOND freshly constructed PrismaClient (persist beyond process memory) — db2 rows=5/5
P5C: [PASS] RT /api/usage/ledger 200 with the P5-c models + estimate blocks — status=200 models=3 est=0.0051
P5C: [PASS] RT route estimate matches the store's math on the same rows — route=0.0051 store=0.0051
P5C: [PASS] RT invoice POST 201: pasted figure stored VERBATIM next to OUR captured ESTIMATE — actual=0.01 est=0.0051 rows=5
P5C: [PASS] RT delta = actual − our ESTIMATE (display math, labeled on the client) — delta=0.0049
P5C: [PASS] RT invoice GET lists the entry (latest first) with the pricing provenance — total=1
P5C: [PASS] RT strict validation: junk figure, negative figure, empty period → ALL 400 (nothing coerced, nothing guessed) — 400/400/400
P5C: [PASS] SP central view: ZERO raw currency glyphs — every money string flows through the labeled pricing formatters — glyphs=0
P5C: [PASS] SP panel untouched by P5-c: no pricing import, no currency glyph (THIS-CALL/THIS-RUN invariant holds by construction) — pricing-import=false glyphs=0
P5C: [PASS] SP pricing file header carries the fetched docs URL + date + both priced rows verbatim — header provenance pinned
P5C: [PASS] SP panel Layer-3 still fetches the persisted ledger (P5-b swap intact) — source pin re-asserted
P5C: [PASS] Cleanup: fixture rows fully removed, DB back to pre-run shape — calls 0->0 (deleted 5), invoices 0->0 (deleted 1)
P5C: ALL CHECKS PASSED (30 checks)
```

### Regression EIGHTH-set + ship health (measured 2026-11-06, after ALL P5-c changes incl. the popover fix)

| harness | checks | result |
|---------|--------|--------|
| verify-stage-a.ts | 17 | ALL CHECKS PASSED |
| verify-p2-a.ts | 13 | ALL CHECKS PASSED |
| verify-p2-b.ts | 35 | ALL CHECKS PASSED |
| verify-p2-c.ts | 46 | ALL CHECKS PASSED |
| verify-p4.ts | 38 | ALL CHECKS PASSED |
| verify-p5.ts | 24 | ALL CHECKS PASSED |
| verify-p5-b.ts | 24 | ALL CHECKS PASSED |
| **verify-p5-c.ts** | **30 (NEW)** | **ALL CHECKS PASSED (twice: pre- and post-fix)** |

- `bun run lint` — clean (no findings).
- Dev server: restarted ONCE after `db:push` (running process held the
  pre-push Prisma client without `UsageInvoice` — expected consequence of
  additive client generation, same as P5-a/b). Post-restart probes:
  `GET / → 200`; `GET /api/usage/ledger → 200` with `models` + `estimate`
  (honest empty: usd 0, unpricedGroups 0); `GET /api/usage/invoice → 200`
  (empty entries + provenance).
- Post-cleanup DB state: UsageCall 0, UsageInvoice 0 — the honest empty
  state IS the shipped initial state.

### $0.00 GLM ledger — §P5-C

**Billable calls spent: 0. Billable tokens: 0. Free-tier calls: 0. $0.00.**
The pricing sources came from two plain HTTP fetches of the public docs
(no model calls); every harness check is pure arithmetic, direct fixture
writes, local HTTP, or source reads; the verify-p5-c harness never imports
the SDK at all (structural zero-GLM). OPS-3 closure spent zero calls.

### Next: P5-d (gate doc delivered with this stage; awaits user ruling)

The enablement-gate document (`agent-ctx/phase5-gate-p5d.md`) ships DOCS-ONLY
with this stage per §7: per-feature enablement packs, validation protocol,
dashboard columns, rollback — recommended order slicing-first — and NO config
change, NO code. Nothing flips without the user's ruling at that gate. The
Phase 1–5 final close-out (`agent-ctx/phase1-5-closeout.md` supersedes the
phase1-2 record's scope) ships alongside it.

---

## §P5-E — Slicing enablement (Ruling R-1): production flip + free-flash validation (evidence embedded)

**Date: 2026-11-06 (UTC). Approval state: P5-c ACCEPTED (user, 2026-11-06);
R-1 ruled slicing ON with this exact protocol (flip → free-flash validation on
the hardened rig → real-wire dashboard evidence → one-flip rollback
documented); R-2 (retention/rollup/purge/export → P5-f) and R-3 (TEAM-1
read-only plan → P5-g) sequenced after. Eighth-set green. Lint clean.
$0.00 GLM billable; 20 free-tier glm-4-flash calls total (6+6+8 across three
attempts — every one disclosed below).**

### The production flip (the ruling, executed)

`contextSlicing.enabled` is now **TRUE at rest in BOTH places** — this is the
first optimization that changes model-visible bytes:

- `agent/config/budgets.yaml` — `contextSlicing.enabled: true`, comment
  rewritten to carry the ruling citation (R-1 of 2026-11-06), the validation
  pointer (this section), and the rollback contract. `contextCompaction`
  section UNTOUCHED (still `enabled: false`).
- `src/lib/novara/content.ts` — `DEFAULT_BUDGETS.contextSlicing.enabled: true`
  (the degrade-gracefully fallback must not disagree with the operative yaml;
  a corrupt-yaml fallback to `false` would silently roll the feature back).
  Schema doc comment updated.

Consequence handled: budgets are memoized per process (`content.ts` load
cache), so the running dev server held the pre-flip state until **one
restart** (documented here as part of enablement; post-restart
`GET / → 200`).

### Harness pins moved to the ruled state (three files)

| harness | old pin | new pin |
|---|---|---|
| verify-p4 S8 | `contextSlicing.enabled === false` at rest | `=== true` (yaml window + parsed), compaction still false |
| verify-p5 S7 | "both features inert" | compaction false AND slicing true |
| verify-p2-c CF | NO `enabled: true` anywhere in yaml | exactly ONE live `enabled: true`, inside the `contextSlicing` section (anchored match; the compaction probe pack stays banned) |

The verify-p2-c tightening caught a real bug in its own first draft: the
unanchored `indexOf("  enabled: true")` matched inside the P2-c probe-pack
COMMENT (`#   enabled: true, …` — three leading spaces contain the two-space
substring). Fixed to an anchored `search(/^  enabled: true/m)`. All three
harnesses re-run green immediately (38 + 24 + 46).

### The rig (P5-e hardened, OPS-2 pattern)

- `scripts/p5e-live-probe.ts` — controller: preflights the RULED at-rest
  state (slicing true / compaction false — **no probe-pack surgery and no
  restore; the flip IS the product**), seeds the P4 representative fixture
  dims (same as P4-A1 for comparability), persists the pre-run state file
  `/tmp/p5e-live-state.json` BEFORE any model call (including the structured
  snapshot data and the yaml at-rest text), creates the glm-4-flash
  full_access run with the **verbatim P4-B attempt-#4 tightened goal**
  (OPS-1), spawns the DETACHED executor (reuses the run-agnostic
  `scripts/p4-live-exec.ts` — claim-lease-then-execute), polls ≤9 min.
- `scripts/p5e-live-evidence.ts` — standalone evidence + cleanup pass
  (reconstructable after a controller reap): leader envelope BYTE-IDENTITY;
  **member wire snapshot blocks BYTE-EXACT vs `buildMemberSnapshotSlice`
  recomputed from the persisted pre-run snapshot data + the ACTUAL task rows**
  (the strongest possible assertion — the live wire must equal the shipped
  deterministic function, map + A2 guard + starvation floor together);
  per-wire section table; metered novel-section drop; artifact counters ==
  DB truth; **§4.5/gate-§3.3 ledger cross-check** (UsageCall rows ==
  usage-event real triples row-for-row, attribution pinned, Policy-F failed
  rows zero-token and counted separately, glm-4-flash UNPRICED pin);
  transcript gapless; cleanup deletes run+scratch novel, asserts the yaml is
  STILL byte-equal to the at-rest text (**the flip stays — no restore in
  this stage**), and discloses surviving ledger rows.
- One extraction detail fixed after attempt #1 (below): the envelope block
  cut carries ONE trailing separator newline before the next envelope
  section, so the byte comparison trims it (P4's pass only counted within
  the block, so the artifact never surfaced there).

### Attempt history (all three disclosed; verbatim logs in agent-ctx/)

**Attempt #1 — 20/25 checks.** Both tasks executed and verified (sage write
landed, ch13 wordCount=482 in DB); ALL slicing evidence green (leader
byte-identical; bulk absent; guard intact; floor present; novel-section drop
at metered truth). TWO failures, both non-slicing:
1. The **closing leader call (call #7) never returned** — signature: two
   60s gateway timeouts + retry backoff (~2.5 min), then the run-level error
   path. Executor self-resolved at 8.5 min.
2. **One UsageCall persist was lost** to a sqlite `Socket timeout`
   (fire-and-forget; verbatim: `[usage-ledger] persist failed (call not lost
   from the panel, missing from account ledger) … Socket timeout`). The
   §3.3 cross-check reconciled the MEASURED books 6/6 — the lost row was the
   dead closing call's F1 failed-row persist. The dual-book design detected
   and bounded the loss exactly as built for.
3. Run stuck at `status=running` (lease released → the failure flip's
   lease-scoped updateMany matched 0 rows; error message swallowed) →
   registered as **OPS-4** (below); controller killed, standalone evidence
   pass ran clean from the state file — **the OPS-2 hardened architecture
   absorbed a controller kill in production form**.

**Attempt #2 — 23/25 checks.** Member wires now **BYTE-EXACT 2/2** after the
trimEnd extraction fix. Same closing-call signature (6 measured calls, tasks
done+verified, closing call dead, one F1-persist lost, stuck at running).

**Attempt #3 — 25/25 ALL CHECKS PASSED.** Run `cmw4oah560059n9lkb9ym5q7q`
COMPLETED (status=completed; the closing call landed at ~3.5 min — gateway
healthy; attempts #1/#2's wall was transient gateway/infra, NOT slicing:
the closing leader wire is transcript-assembled and byte-identical under
slicing on/off, and the leader envelope byte-identity check passed in all
three attempts). Verbatim result tail:

```
P5E-LIVE: [PASS] E(iii) member artifacts DB-correct — counters == DB truth — verified.chaptersWritten=1 · DB chapters=13 (12 seeded + 1 written at index 13) · ch13.wordCount=572 · verified.words=572
P5E-LIVE: [PASS] E(iii) read-only task produced no DB mutations — reviews=0 finalizes=0 exports=0
P5E-LIVE: [PASS] E-L1 every ledger row for the run carries the run's attribution (surface=agent, modelId=glm-4-flash, novelId set) — rows=8 · surfaces=agent · models=glm-4-flash
P5E-LIVE: [PASS] E-L2 measured UsageCall rows == usage-event real triples ROW-FOR-ROW (sorted; the two books agree) — events=8 rows=8 · equal=true
P5E-LIVE: [PASS] E-L3 failed rows (Policy F), if any, contribute ZERO tokens and are counted separately — failed=0/8 rows (clean run — no failed attempts)
P5E-LIVE: [PASS] E-L4 P5-c honesty: glm-4-flash renders UNPRICED (unlisted-model) — never $0-by-assumption, excluded from the account estimate — priced=false reason=unlisted-model · run rows (8) all UNPRICED in the central view
P5E-LIVE: LEDGER — 8 rows (measured 8, failed 0) · Σprompt=143268 Σcompletion=1058 tok · modelId=glm-4-flash (FREE tier; UNPRICED in our table)
P5E-LIVE: ALL CHECKS PASSED (25 checks)
```

Full logs: `agent-ctx/p5e-live-attempt1-evidence.log.txt`,
`agent-ctx/p5e-live-attempt2-full.log.txt`, `agent-ctx/p5e-live-attempt3-full.log.txt`.

### Slicing evidence from REAL enabled wires (attempt #3, metered truth)

Full snapshot at run start: **25,887 chars ≈ 19,453 tok (est) · 40 beats ·
30 ledger entries**. Leader wire: BYTE-IDENTICAL to the pre-P4 construction
(27,204 chars, full section set 40/30/≥20). Member wires:

| wire | chars | tok (est) | vs full | ledger | beats | timeline | roster |
|---|---|---|---|---|---|---|---|
| Task 1 sage:chapter | 15,051 | ≈10,869 | **−44.0% chars** | 5/30 | 4/40 | 8/20 | **12/12 (guard)** |
| Task 2 nova:chapter | 21,218 | ≈15,653 | −18.1% chars | 30/30 | 4/40 | 20/20 | 12/12 |

- **Novel-section drop at metered truth** (usage events, sections.novel):
  atlas turns 19,567/19,574/19,581 — sage member calls 10,944/10,913 —
  nova member calls 15,561/15,528/15,655. Every member call's metered novel
  section sits FAR below the full-snapshot estimate; the leader's stays at
  full. This is the dashboard-visible column-level signature of slicing.
- **Guard INTACT**: the sage brief references "chapter 13"; the map's
  recentChapters bound (keep=10) would have trimmed the roster to 10 — the
  wire carries **12/12**, restored WHOLE by the A2 chapter-index guard. The
  same guard leaves nova's 30/30 ledger and 20/20 timeline whole (no
  foreshadow/timeline bound on that shape) — shape-scoped slicing proven on
  one fixture in one run.
- **Bulk PHYSICALLY ABSENT**: sage wire carries UNIQ-F{1..5} only (bounded
  recentForeshadows window); beats window = 12..15 (near-target) on both
  wires; UNIQ-B40 (beat 40) absent from both member wires while present on
  the leader's.
- **Structural floor intact**: NOVEL/SYNOPSIS/PROGRESS/NEXT CHAPTER/CAST/
  STORY CONTRACT markers present on every wire; byte-exact recompute covers
  the rest (memory, arcs, storylines, world).

### Dashboard evidence (central view, real persisted rows — screenshot)

`agent-ctx/p5e-evidence-central-sliced-runs.png` (+ scrolled variant). The
Usage & balance popover renders the 20 surviving free-flash rows verbatim:

- **Account usage: 20 calls · Σ 352.5K tok (in 349.3K · out 3.2K)**
- **$0 ESTIMATE (upper bound)** with "1 model group unpriced (excluded)" —
  the P5-c rule rendering honestly: the estimate sums PRICED groups only.
- **BY MODEL · ESTIMATE (UPPER BOUND): glm-4-flash ×20 352.5K — "unpriced
  model"** (per-model split delivered by P5-c, now carrying REAL enabled-run
  rows).
- **BY NOVEL: three "(deleted novel)" groups ×8 / ×6 / ×6** — the three
  attempts' rows, orphaned by the probe cleanup exactly as the P5-b
  retention proof specified ("rows survive novel deletion").
- Honesty footnote renders verbatim: "Measured tokens × sourced price table
  (2026-11-06.1); the cached-input discount is invisible to us, so every
  figure is an upper bound. Unpriced rows have NO sourced price — shown,
  never guessed."

### §3.3 ledger cross-check (gate protocol item 3) — status

Attempt #3: 8/8 measured rows == 8 usage-event triples, sorted comparison
equal; attribution surface=agent / modelId=glm-4-flash / novelId set on
every row; zero failed rows. Attempts #1/#2: measured books reconciled 6/6
each; ONE F1 failed-row persist per attempt was lost to the transient sqlite
socket timeout (bounded: zero-token rows, and the calls they describe
themselves produced no completion payload). Net ledger truth for the whole
stage: 20 measured rows, 2 lost zero-token failed-row persists (disclosed,
detected by the cross-check design).

### Rollback contract (documented per the ruling — NOT executed)

One flip of `contextSlicing.enabled` back to `false` in
`agent/config/budgets.yaml` (+ the matching `DEFAULT_BUDGETS` fallback in
`content.ts`), then one dev-server restart (memoized budgets). No data
migration, no schema coupling — the ledger stores request-side modelId +
tokens and is indifferent to wire shape. A rollback stage re-runs the
eighth-set and re-probes the panel/central view (gate doc §4 verbatim).

### OPS-4 (NEW — registered, fix awaiting ruling; no code touched)

**Run-level failure flip is lease-scoped and fires AFTER lease release, so
any run-level error that surfaces post-release leaves the run stuck at
`status=running` forever (until the 15-min healer) and the error message is
never logged or emitted** (verbatim, both attempts:
`[agent-runtime] run <id>: failure flip skipped — lease no longer owned
(count=0)`). Pre-existing defect (not introduced by P5-e); it degraded
validation UX twice and swallowed the closing-call error text. Full entry in
risk-register.md. No repair in this stage — runtime error-handling is
outside the ruled P5-e surface.

### $0.00 GLM ledger — §P5-E

**Billable calls: 0. Billable tokens: 0. $0.00.** Free-tier glm-4-flash
calls: **20** (attempt #1: 6 · attempt #2: 6 · attempt #3: 8 — all
sanctioned by the gate's own validation protocol; the repeated attempts are
disclosed deviations from "one live-fire", each forced by transient
gateway/infra, none by slicing). All rows render UNPRICED in our table
(unlisted-model); real spend $0 by the free tier.

### Pending user input (not a blocker)

Invoice reconciliation paste-slot is LIVE and awaiting the account holder's
one console row (z.ai console, one closed-period USD total after Nov 5,
plus cached-discount applied yes/no). It is recorded verbatim against our
ESTIMATE when pasted; the gate's evidence protocol does not depend on it.

### Next: P5-f (R-2 — retention/rollup/purge/export), then P5-g (R-3 — TEAM-1 read-only plan)

P5-f builds the UsageDaily aggregate table + 90-day purge + 31-day display
boundary + CSV export, with the backdated-fixture harness. P5-g produces the
READ-ONLY TEAM-1 repair plan and waits for approval before any code. The
Phase 1–5 final close-out will be refreshed after P5-f/P5-g land.
