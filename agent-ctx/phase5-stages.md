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
