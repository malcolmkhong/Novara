# Phase 5 Proposal — Persisted Usage Ledger, Per-Novel Attribution, Central Usage View

**Status: READ-ONLY — no code shipped, awaiting approval.** Date: 2026-11-05.
This proposal folds in the user ruling of 2026-11-05 (§0) and the two facts
registered in `agent-ctx/risk-register.md` (OPS-1, OPS-2). Rules honored:
additive-only, zero new deps, zero business-logic changes outside the ledger's
own surface, **zero GLM spend for this proposal** — every citation below is an
already-produced artifact embedded verbatim in the phase records.

---

## §0 The ruling this proposal implements (user, 2026-11-05 — restated verbatim)

1. **Every novel has its OWN usage ledger** — per-novel totals must exist and
   be complete for post-creation attribution.
2. **Global usage is tracked SEPARATELY at the account/profile level**, NOT
   mixed into individual novels.
3. **Users see overall usage AND remaining credit balance in ONE central
   location.**

Concrete requirements: record-time `novelId` tagging where the surface can
know it; wizard/team/generate surfaces that culminate in creating a novel
attach that session's consumption to the created novel (**retro-tagging via a
provenance link created at run/novel creation**); anything with no resulting
novel stays in the global account ledger only. A **persisted** ledger
(survives process restart — the current in-memory ledger does not) with
scopes: **per-call / per-run / per-member-task / per-novel / global-account**.
Central account-level view in a settings/profile-type location — this IS
Phase 5's own deliverable scope (the "no unrelated UI changes" constraint
still forbids touching anything else). Existing Context Usage panel
extensions per the original metrics matrix remain in scope. Cache columns per
the P3 stop condition. Pricing placement + ESTIMATE-vs-ACTUAL honesty rules +
invoice reconciliation (the one user-supplied invoice row flagged as a
user-input dependency). The two enabled-by-default decisions are sequenced as
a SEPARATE approval gate (§7).

---

## §1 Evidence base (all pre-existing; zero new probes spent)

| # | Fact | Source |
|---|---|---|
| 1 | Current ledger is **in-memory on globalThis**: per-process (survives dev hot reload, resets on restart — stated in the panel), per-SURFACE totals only (calls/prompt/completion/total), **no model field, no novel field, no persistence** | `src/lib/usage/ledger.ts` (header comment + `LedgerState`); phase4-stages.md §Phase 5 heads-up #1 |
| 2 | **Agent-run per-call usage already persists** — `AgentEvent(kind="usage")` rows with full `ContextUsage` payload (`real` billed tokens + section split + P2-d `conversationSub`), emitted per GLM call via `emitUsageEvent` (fire-and-forget, telemetry failure never breaks the run) — but ONLY for the agent surface, and cascade-deleted with the run | `src/lib/agent/runtime.ts` lines 575–593, 1747, 2439; `prisma/schema.prisma` AgentEvent |
| 3 | Chokepoint census — every GLM call flows through `glmChat` (surfaces: `agent`, `draft`, `review`, `sediment`) or one of 5 direct-SDK sites (`studio` ×2 incl. streaming, `detect` ×2, `wizard`, `generate`, `ai-team`), all calling `recordGlobalUsage(surface, extractRealUsage(...))` | grep census 2026-11-05: `runtime.ts` ×2, `api/ai/draft`, `novara/ai-json.ts` (→ `novara/review.ts`), `novara/sediment.ts`, `novel/glm.ts` ×2, `api/detect/*` ×2, `api/ai/wizard`, `api/generate`, `ai-team/server.ts` |
| 4 | **No $ conversion code exists**; ledger records provider-billed counts keyed by REQUEST-side model selection; response `model` echo is cosmetic (`"glm-4-plus"` constant label, unread) | phase3-stages.md §P3-A-2 (c)+(d) |
| 5 | Gateway rate-limit headers observed live (P3-a): `x-ratelimit-limit-daily: 300`, `limit-qps: 2`, `remaining-daily: 170`, `remaining-qps: 1`, `reset: 1793883620`, `user-10min-limit: 30`, `user-10min-remaining: 27`, **`user-daily-remaining: 370`** | phase3-stages.md §P3-A header JSON (verbatim) |
| 6 | Same header budgets across requested models; `user-daily-remaining` moved with consumption (370 glm-4.6 call vs 364 flash call) — a consumption counter, not a tier signal | phase3-stages.md §P3-A-2 (b) |
| 7 | Cache fields: **ABSENT at our boundary on both pathways** (SDK + raw HTTP), both tiers — usage is exactly 3 fields; SDK is verbatim passthrough; gateway is a normalizing proxy | phase3-stages.md §P3-A R1–R4 (stop condition TRIGGERED) |
| 8 | Pricing facts: GLM-4.6 input $0.60/1M, cached input $0.11/1M, output $2.20/1M; GLM-4.5-Flash free; storage limited-time free | phase3-proposal.md F2 (docs fetched live 2026-11-05) |
| 9 | DB is pristine (1 novel / 0 runs / 0 messages) — **no backfill exists or is needed**; the persisted ledger starts empty at deploy | phase4-stages.md header (2026-11-05) |
| 10 | **The ai-team surface is DORMANT**: `TeamAgent`/`TeamConversation`/`TeamMessage`/`TeamTask*` models are absent from `schema.prisma` AND the generated Prisma client; live probe today: `GET /api/team/agents` → 500 `{"success":false,"error":"Failed to load the AI team."}` (dev.log line confirms). The panel is mounted (`novel-workspace.tsx` line 365) but its backend cannot load | Fresh observation 2026-11-05 (curl + dev.log); grep of `prisma/schema.prisma` + `node_modules/.prisma/client/index.d.ts` |
| 11 | The old studio init (`POST /api/novel`) runs its GLM calls (`studio` surface) and creates the novel **in the SAME request handler** — a server-side correlation id can bridge init→creation with zero client changes | `src/app/api/novel/route.ts` lines 72–156 |
| 12 | The wizard flow creates the novel on a LATER request (client POSTs `/api/novels`) — retro-tagging needs a client-generated session id on both ends | `src/app/api/novels/route.ts` POST; `api/ai/wizard/route.ts` (stateless, no novelId) |

---

## §2 Metrics matrix — full cell mapping (restated self-contained; no surviving artifact holds the original)

Scopes and how each is computed from the persisted per-call rows:
**per-call** = one row · **per-run** = Σ by `runId` · **per-member-task** = Σ
by `taskId` · **per-novel** = Σ by direct `novelId` **+** Σ via provenance
join · **global-account** = Σ all rows (novel-tagged or not — never
double-counted: a row is either direct-tagged, provenance-linked, or
global-only).

| surface | chokepoint | novelId at record time? | run/task ids at record time? | per-novel attribution | notes |
|---|---|---|---|---|---|
| agent — leader turns | `glmChat` (`runtime.ts` :1744) | YES (via `runId` → `AgentRun.novelId`) | YES (runId; convId="leader") | **direct** (record-time tag or join) | per-call `usage` events already persisted (§1 #2) — ledger row is the cross-surface twin |
| agent — member task turns | `glmChat` (`runtime.ts` :2436) | YES (same) | YES (runId + taskId + conversationId) | **direct** | the only surface with per-member-task scope available at record time |
| draft | `glmChat` (`api/ai/draft`) | YES (route loads the novel) | no run | **direct** | chapter-editor drafting; per-call row only |
| review | `glmChat` (`ai-json.ts` → `review.ts`) | YES (chapter/novel review routes) | no run | **direct** | `chatJson` structural retries each make a NEW measured call — each retry is its own row (honest: retries are real spend) |
| sediment | `glmChat` (`sediment.ts` :215) | YES (novelId param) | no run | **direct** | per-call row only |
| studio — init (pre-creation) | direct SDK (`novel/glm.ts` `glmJson`) | **NO at call time — YES within the same request** (novel created later in-handler, §1 #11) | no run | **server-side correlation → provenance link written in-handler at `db.novel.create`** | zero client changes needed |
| studio — novel-scoped (plan/review/sediment/write) | direct SDK (`glmJson`, `streamGlmProse`) | YES (`[id]` routes) | no run | **direct** | `streamGlmProse` records usage at stream end (already measured-only) |
| wizard | direct SDK (`api/ai/wizard`) | **NO** (stateless, pre-novel) | no run | **provenance link** (client-generated wizard session id passed on every section call AND on the create call; link written at novel creation) | abandoned sessions stay global-only — correct per ruling |
| detect (×2) | direct SDK (`api/detect/*`) | NEVER (standalone detector tool, never culminates in a novel) | — | **none — global-only** | stays in the account ledger only |
| generate | direct SDK (`api/generate`) | NEVER (AI-detector sample generation) | — | **none — global-only** | same |
| ai-team | direct SDK (`ai-team/server.ts`) | N/A — **DORMANT** (§1 #10: backend tables absent from schema; panel errors 500) | teamConversation sessionKey exists in code but the tables do not | **none today** | recorded honestly as dormant; revive-or-retire is an explicit ruling question (§9) — if revived, same provenance-link pattern via sessionKey |

Record-time rule (the ruling, made mechanical): **a surface that knows its
novel at call time tags the row directly; a surface that learns the novel
later writes a provenance link at the moment of creation; a surface that
never produces a novel never claims one.**

---

## §3 Cache columns per the P3 stop condition: NONE — and why

The P3 stop condition TRIGGERED on evidence (§1 #7): usage at our boundary is
exactly `{completion_tokens, prompt_tokens, total_tokens}` on both pathways;
the SDK is verbatim passthrough; the gateway normalizes whatever upstream
returns. The provider may cache and discount server-side — **we literally
cannot see it**.

Therefore the persisted ledger ships **zero cache columns**. A
`cachedTokens` column today would be dead code by construction (the same
verdict P3 reached for meter changes), and a fabricated "estimated cache
savings" column would violate the honesty rules. The ledger v1 records a
single per-surface status constant — **"cache visibility: none (P3-a R1/R4)"**
— in the schema comment, so the absence is documented, not accidental.

**Revisit trigger (pinned):** the day `usage.prompt_tokens_details.cached_tokens`
appears at our boundary (any pathway), Phase 5's schema gains ONE optional
column via additive migration, with the reconcile rule "cached ⊆ prompt"
(P3 F3) — gated on the same evidence discipline (live probe before code).

The only cache lever that exists — prefix stability — is already shipped and
harness-pinned (P3-C: wire head byte-identical across every compaction cycle,
46 checks green). No new work.

---

## §4 Persisted ledger schema proposal (additive)

### 4.1 `UsageCall` — one row per MEASURED GLM call, all surfaces

```
model UsageCall {
  id             String   @id @default(cuid())
  // surface tag exactly as today: agent | draft | review | sediment |
  // studio | wizard | detect | generate | ai-team
  surface        String
  // REQUEST-side registry model id (the pricing key; P3-A-2 verdict) —
  // NOT the response echo (which the gateway rewrites to "glm-4-plus")
  modelId        String   @default("glm-4.6")
  // measured provider truth (the honesty rule: null usage = NO row —
  // never guessed, never padded; estimates live in usage events, not here)
  promptTokens     Int
  completionTokens Int
  totalTokens      Int
  // scope links — nullable; exactly the matrix in §2
  runId          String?   // agent surface
  taskId         String?   // agent member conversations
  conversationId String?   // "leader" | taskId
  novelId        String?   // record-time tag where §2 says YES
  correlationId  String?   // request/session correlation for retro-tagging
  createdAt      DateTime @default(now())

  @@index([novelId, createdAt])
  @@index([runId])
  @@index([surface, createdAt])
  @@index([correlationId])
}
```

**Deliberate deviation from the cascade convention — flagged for the
ruling:** `novelId`/`runId` here are **plain string columns, NO Prisma
relation, NO cascade**. The ledger is account-level telemetry, not
novel-owned data: deleting a novel must NOT erase historical spend from the
account view (the account ledger is immutable history). Per-novel views join
by id and render orphaned totals under a "(deleted novel)" label. This
mirrors how the provider's own invoice does not shrink when a project is
deleted. (The agent surface's rich per-call `usage` EVENTS keep their
existing cascade with the run — they are the panel's data, not the ledger's.)

### 4.2 `UsageProvenance` — the retro-tag link (created at run/novel creation)

```
model UsageProvenance {
  id            String   @id @default(cuid())
  // correlation id: server-generated request id (studio-init) or
  // client-generated session id (wizard; team sessionKey if ever revived)
  correlationId String
  // which surface produced the calls being linked
  surface       String
  // set at the moment of novel creation (the ruling's provenance link)
  novelId       String   // plain string — same no-cascade rationale
  createdAt     DateTime @default(now())

  @@unique([correlationId, novelId])
  @@index([novelId])
}
```

Per-novel totals = `Σ UsageCall where novelId = N` **∪** `Σ UsageCall where
correlationId IN (provenance rows with novelId = N)`. The unique index makes
link creation idempotent (a retried create cannot double-link).

### 4.3 Correlation plumbing (the only call-site changes)

- **Server-side (studio-init):** generate a `correlationId` at handler start
  of `POST /api/novel`, thread it through `glmJson`'s ledger call, write the
  provenance link inside the same handler right after `db.novel.create`
  (§1 #11). Zero client changes.
- **Client-session (wizard):** the wizard client generates a session id when
  the wizard opens, sends it as an OPTIONAL additive body field on every
  `/api/ai/wizard` call, and on the final `/api/novels` create; the create
  handler writes the link. Abandoned wizard sessions leave unlinked rows —
  they remain in the global account ledger only (exactly the ruling's rule).
- **Chokepoint instrumentation:** `glmChat` gains an optional
  `ledger?: { runId?, taskId?, conversationId?, novelId?, correlationId? }`
  passthrough; the 5 direct-SDK sites pass the same shape. Persistence is
  fire-and-forget (`void db.usageCall.create(...).catch(() => undefined)`) —
  a ledger failure must never break a model call, mirroring
  `emitUsageEvent`'s discipline.

### 4.4 What happens to the in-memory ledger

`ledger.ts`'s in-memory rollup and `GET /api/usage/global` are **superseded**
in the stage that ships the persisted ledger: the panel's "All AI surfaces"
block switches to the persisted source (same surface-rollup response shape,
now restart-surviving). The in-memory layer's one honest caveat — "resets
when the server restarts, stated in the panel, not hidden" — dies with it.
This is the ledger's own modernization (Phase 5's deliverable), not an
unrelated change; the panel's rendering otherwise stays as-is.

### 4.5 Reconciliation invariant (harness-asserted, zero GLM)

The agent surface is double-recorded by design: per-call `usage` events (rich
panel payload) AND `UsageCall` rows (cross-surface ledger) describe the SAME
measured calls. `scripts/verify-p5.ts` (new; quintet → sextet) asserts on a
fixture run that the two books agree row-for-row on
prompt/completion/total tokens, and that per-novel/per-run/global sums from
`UsageCall` match the event-derived sums. Estimates never enter `UsageCall`
(measured-only rule); the panel keeps rendering estimated-only events with
its existing honest "estimated" label.

---

## §5 Central account view — placement, contents, and the balance verdict

### 5.1 Placement (in-scope per the ruling)

The writer app's header currently has exactly one account-like element: the
**"Guest session"** badge (writer-app.tsx :156–168, tooltip explains accounts
arrive later). The central view ships as **"Usage & balance"** anchored
there — a popover/dialog (settings/profile-type location) containing:

1. **Overall usage** — all-time and per-period (month selector) totals:
   calls, Σ prompt, Σ completion, Σ total tokens (persisted; survives
   restart), per-surface breakdown (the §2 surfaces).
2. **Per-novel breakdown** — per-novel totals incl. retro-tagged
   wizard/init consumption, "(deleted novel)" for orphans; links into each
   novel's workspace.
3. **Remaining balance row** — see §5.2.
4. **$ figures** — only if §6's pricing module is approved in the same
   gate; every figure labeled ESTIMATE with its pricing version.

The existing Context Usage panel keeps its three layers; its "All AI
surfaces" block swaps to the persisted source (§4.4). No other UI is touched
(the original constraint stands for everything else).

### 5.2 Remaining balance — the gateway headers are NOT a feasible source (investigated read-only, per instruction)

**Verdict: NOT feasible as a "remaining credit balance" data source. The
balance display becomes explicitly unavailable-not-fabricated.** Four
independent reasons, all evidence-cited:

1. **Wrong currency.** The headers are CALL-COUNT quotas, not tokens or
   money: `limit-daily: 300` (calls/day), `user-10min-limit: 30`, `limit-qps:
   2` (§1 #5). A credit balance in the plans' terms (words/month, $) cannot
   be expressed in calls/day — the units do not convert without fabricating
   an average call cost.
2. **Two undocumented daily counters.** `x-ratelimit-remaining-daily: 170`
   vs `x-ratelimit-user-daily-remaining: 370` on the same response — two
   different pools/windows whose semantics the docs do not define (§1 #5).
   Displaying either as "your balance" would be a guess wearing a number.
3. **Observable only by spending.** The headers ride successful
   chat-completion responses; there is no polling endpoint — every "balance
   check" costs a real GLM call and burns QPS. `x-ratelimit-reset:
   1793883620` on call-1 is a QPS-window boundary, not a daily reset time.
4. **No billing/usage-query API exists at our boundary** (§P3-A-2: none cited
   in the docs; gateway config unreachable) — and the plan metadata in
   `subscription-plans.ts` is display-only ("nothing here grants, stores or
   fakes a subscription state"), so a words-based remaining figure cannot be
   honestly computed either.

**Ship shape:** the balance row renders
`Unavailable — the gateway exposes call-count rate limits, not a credit
balance; no usage-query API exists at our boundary (P3-a evidence).` with the
two live counter values shown as what they are (rate-limit state, clearly
labeled). A REAL balance plugs in later behind the same row when either (a)
the provider ships a billing API, or (b) the account holder pastes the
console figure (the same user-input dependency as §6's invoice row). Nothing
is fabricated in the meantime — the project's honesty rules forbid it.

---

## §6 Pricing placement + ESTIMATE-vs-ACTUAL honesty + invoice reconciliation

### 6.1 Placement — ONE module

`src/lib/usage/pricing.ts` (new): a versioned table keyed by **request-side
modelId** (the API contract's routing selector and the docs' pricing key —
P3-A-2 verdict; the response echo is display-and-dead). Rows from the
fetched-live docs (§1 #8): GLM-4.6 input $0.60/1M · output $2.20/1M ·
cached-input $0.11/1M **present but NEVER applied** (unobservable — §3);
GLM-4.5-Flash $0. Constants carry `sourceUrl` + `fetchedAt` + `pricingVersion`
so any displayed $ is reproducible to a dated doc snapshot. Storage fee:
$0 today, watchdog noted (P3 F2).

### 6.2 Honesty rules (binding)

1. Every $ figure = **measured tokens × listed price**, computed from
   `UsageCall` rows only (never estimates), labeled **ESTIMATE** — always,
   not just pre-reconciliation, because the cached-input discount (potentially
   the dominant real-world reduction on stable-prefix workloads) is invisible
   to us; our ESTIMATE is an UPPER bound by construction.
2. No per-call cached discount, no gateway-echo-derived tiering, no
   hand-adjusted factors. Retries are real rows and real money (honest).
3. A $ column that cannot honestly compute (missing pricing row for an
   unknown modelId) renders "unpriced model", never $0.

### 6.3 Invoice reconciliation — the user-input dependency, flagged

The invoice-tier residual (does the provider tier a request at the requested
model's row, given the echo rewrite? — §P3-A-2 verdict "genuinely ambiguous")
is discharged by exactly one act: **the account holder pulls one real
bill/dashboard row from the provider console** and it is recorded as a
reconciliation entry (period, invoice total, our ESTIMATE for the same
period, delta, note). No code can discharge this; it is a USER-INPUT
DEPENDENCY and ships as an explicit prompt in the central view's reconciliation
slot ("paste the console figure for period X"). Sequence: ESTIMATE-labeled $
may ship in P5-c; reconciliation lands when the author supplies the row; the
entry then displays alongside the ESTIMATE (which stays labeled — rule 1 is
permanent). This matches the P3 pin: *"$ attribution … when it arrives
(Phase 5), must first reconcile against the provider's invoice side."*

---

## §7 Sequencing: the two enablement gates (SEPARATE approval — not bundled)

Both shipped features stay **inert through all of Phase 5**:
`contextCompaction.enabled=false` (P2) and `contextSlicing.enabled=false`
(P4-A4) are untouched by ledger work; verify-p4's S8 assertions keep holding.

**Phase 5's last deliverable (P5-d) is a separate enablement-gate document**
— its own approval, explicitly not part of the ledger approval — presenting,
per feature:

| | Compaction (`contextCompaction`) | Slicing (`contextSlicing`) |
|---|---|---|
| Enablement pack (measured) | P2-d: 79.1% Σprompt reduction (real-transcript counterfactual, final chain head); guard G1 feed-heavy ⇒ SKIP / G2 ⇒ PROCEED; slack 256; re-compaction baseline = current-wire (P2-d closure) | P4: per-shape savings table (sage:chapter −47.5% … forge:chapter −83.5%, estimator basis, CJK billed ~1.4×); A1 live-fire −44.0%/−19.6% billed-truth confirmed; floor byte-identity all 20 shapes |
| Validation protocol | One free-flash live-fire via the P4 hardened rig (OPS-2 mandatory: detached executor + state file + standalone evidence pass), tightened goals (OPS-1), then dashboard evidence | Same rig; per-shape `sections.novel` deltas on real enabled wires |
| Dashboard columns that prove real-enabled behavior | `conversationSub.compacted > 0` on live wires; Σprompt before/after at billed truth; guard SKIP telemetry counts | per-shape member-wire sizes + per-run totals vs the enabled:false baseline in the ledger |
| Rollback | one config flip to `false` | one config flip to `false` |

**Why the ledger must land first:** the cost dashboard's value for these
gates is measuring REAL enabled behavior (per-call persisted rows +
conversationSub + sections), not inert config. The gate document states the
recommended order — **slicing first** (bigger, better-bounded savings;
leader byte-identity live-proven; per-shape attribution straightforward),
compaction second (wire-shape change; validated by its own conversationSub
evidence) — and the user rules at that gate. Nothing flips without it.

---

## §8 Staged plan (each stage: evidence embedded at production time; quintet + lint green; ZERO billable GLM throughout)

- **P5-a — persisted ledger core (zero GLM).** Schema: `UsageCall` +
  `UsageProvenance` (additive `db:push`; no existing table touched).
  Chokepoint plumbing per §4.3; provenance writes at both creation seams
  (server-side studio-init; client-session wizard). `GET /api/usage/ledger`
  (account shape) + `GET /api/novels/[id]/usage` (per-novel shape incl.
  provenance join). New `scripts/verify-p5.ts`: scope-sum invariants, the
  §4.5 double-book reconciliation, measured-only rule (null usage ⇒ no row),
  link idempotence, restart-survival (rows persist across a simulated
  process boundary). Sextet green.
- **P5-b — central view + panel source swap (zero GLM).** "Usage & balance"
  at the guest-session anchor (§5.1); Context Usage panel "All AI surfaces"
  → persisted source (§4.4); in-memory ledger retired. Browser-verified:
  panel renders, view shows totals, per-novel breakdown, unavailable-not-
  fabricated balance row.
- **P5-c — pricing module + reconciliation slot (zero GLM).** §6 module +
  ESTIMATE labels in the central view; reconciliation entry point (waits on
  the author's console figure — user-input dependency, not a blocker for the
  stage).
- **P5-d — enablement gate presentation (docs only).** §7's document;
  no config change, no code.

Cost of the proposed Phase 5: **$0.00 GLM** (all validation is harness +
browser; the one free-tier live-fire in §7 belongs to the enablement GATE,
post-approval, not to the ledger stages).

---

## §9 Explicit ruling questions bundled with the approval

1. **No-cascade ledger** (§4.1): account ledger survives novel deletion;
   orphaned totals labeled "(deleted novel)" — approved?
2. **Retire the in-memory ledger** in P5-b once the persisted source is live
   (§4.4) — approved?
3. **ai-team dormant surface** (§1 #10): leave recorded-as-dormant (this
   proposal's assumption; ledger keeps the surface tag for revival), or
   schedule a revive-or-retire decision? Its backend tables are absent from
   the schema today — the panel 500s; this is a PRE-EXISTING defect, outside
   Phase 5 scope either way.
4. **Per-novel in-workspace usage panel** (a usage cell in the novel
   dashboard) — the data ships in P5-a; the in-workspace DISPLAY is optional
   and only proceeds if the ruling wants it (default: central view only, per
   the ruling's "ONE central location").
