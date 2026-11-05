# Phase 3 — Stage Execution Record (evidence embedded)

**Date: 2026-11-05 (UTC). Evidence discipline: every token table, probe response, and
harness output below is embedded VERBATIM in this file at the moment it was
produced — /tmp logs and DB rows are treated as losable.**

Approval state: P3-a approved + executed; P3-c approved + executed; **P3-b
CHALLENGED — argument recorded in §P3-B, AWAITING USER RULING. No wire-format
code touched.**

---

## §P3-A — Raw-HTTP probe (executed 2026-11-05, script `scripts/p3-a-raw-http-probe.ts`)

**Approved questions:** (Q1) does a ≥500-token identical prefix across two
sequential calls surface cache-usage fields? (Q2) is a gateway stripping fields
the SDK view lacks?

### Pathway facts (secrets masked)

```json
{
  "baseUrl": "https://internal-api.z.ai/v1",
  "apiKey": "Z.ai…(len 4)",
  "chatId": "chat…(len 41)",
  "userId": "79d4…(len 36)",
  "token": "eyJh…(len 243)",
  "sdkExtraHeaders": ["X-Z-AI-From: Z"]
}
```

```json
{
  "prefixChars": 6363,
  "prefixSha256": "8e73521f227a8e99",
  "prefixRolePosition": "messages[0].role=system (position 0 — the cache-eligible head)"
}
```

Method: capture-only fetch wrapper around the SDK call (SDK receives the
untouched body; raw response cloned before parse) + a byte-faithful raw-HTTP
replication of the SDK request (same URL, same header set, same `thinking:
disabled` normalization). Dress rehearsal on glm-4.5-flash (FREE) before any
billable spend.

### Dress rehearsal — glm-4.5-flash (FREE tier), verbatim

```
sdk-flash status=200 latency=562ms
sdk-flash RAW BODY (verbatim):
{"choices":[{"finish_reason":"stop","index":0,"message":{"content":"ALPHA-FLASH","role":"assistant"}}],"created":1793883618,"id":"20261105210018c01a7887001d4320","model":"glm-4-plus","object":"chat.completion","request_id":"20261105210018c01a7887001d4320","usage":{"completion_tokens":5,"prompt_tokens":1325,"total_tokens":1330}}
sdk-flash PASSTHROUGH (raw body deep-equals SDK object): true
raw-flash status=200 latency=397ms
raw-flash BODY (verbatim):
{"choices":[{"finish_reason":"stop","index":0,"message":{"content":"BRAVO-FLASH","role":"assistant"}}],"created":1793883619,"id":"2026110521001895fa8f94e52643e7","model":"glm-4-plus","object":"chat.completion","request_id":"2026110521001895fa8f94e52643e7","usage":{"completion_tokens":6,"prompt_tokens":1326,"total_tokens":1332}}
STRIP TEST flash tier: usage keys SDK-path=["completion_tokens","prompt_tokens","total_tokens"] raw-path=["completion_tokens","prompt_tokens","total_tokens"]
STRIP TEST flash tier verdict: {"onlyInSdkView":[],"onlyInRawView":[]}
```

### THE ONE paid experiment — glm-4.6, two sequential calls, identical prefix

Token table (billed truth from `usage`):

| call | pathway | latency | prompt_tokens | completion_tokens | total_tokens | billed cost |
|------|---------|---------|--------------|-------------------|--------------|-------------|
| 1 (prefix + "Echo: ALPHA", 13:00:19Z) | SDK + capture | 396 ms | 1,323 | 3 | 1,326 | ≈ $0.0008 |
| 2 (prefix + "Echo: BRAVO", 13:00:24Z, 5s later) | raw HTTP | 401 ms | 1,324 | 4 | 1,328 | ≈ $0.0008 |

Verbatim bodies:

```
call-1 RAW BODY (verbatim):
{"choices":[{"finish_reason":"stop","index":0,"message":{"content":"ALPHA","role":"assistant"}}],"created":1793883619,"id":"20261105210019ec47304ea7d44ef7","model":"glm-4-plus","object":"chat.completion","request_id":"20261105210019ec47304ea7d44ef7","usage":{"completion_tokens":3,"prompt_tokens":1323,"total_tokens":1326}}
call-2 BODY (verbatim):
{"choices":[{"finish_reason":"stop","index":0,"message":{"content":"BRAVO","role":"assistant"}}],"created":1793883624,"id":"2026110521002316a088e1b41042c4","model":"glm-4-plus","object":"chat.completion","request_id":"2026110521002316a088e1b41042c4","usage":{"completion_tokens":4,"prompt_tokens":1324,"total_tokens":1328}}
```

Gateway response headers (call-1; call-2 identical in kind, ids differ) —
evidence the SDK faces a real gateway ("zai-ai-gateway" marker), with QPS 2 /
daily 300 rate limits:

```json
{"alt-svc":"h3=\":443\"; ma=3600","connection":"keep-alive","content-length":"323","content-type":"application/json; charset=UTF-8","date":"Thu, 05 Nov 2026 13:00:19 GMT","ga-traceid":"52c957343535bbdc110704d689b70e76","vary":"Origin, Access-Control-Request-Method, Access-Control-Request-Headers, …","x-log-id":"20261105210019ec47304ea7d44ef7","x-message-id":"zai-ai-gateway-2d115e8b-6c2c-4c63-8fca-ad7d23bfce0f","x-ratelimit-limit-daily":"300","x-ratelimit-limit-qps":"2","x-ratelimit-remaining-daily":"170","x-ratelimit-remaining-qps":"1","x-ratelimit-reset":"1793883620","x-ratelimit-user-10min-limit":"30","x-ratelimit-user-10min-remaining":"27","x-ratelimit-user-daily-remaining":"370","x-request-id":"2b7b8e3c-1824-463a-8829-8492b0f5f799","set-cookie":"acw_tc=…(HttpOnly, Max-Age=1800)"}
```

### Analysis output (verbatim)

```
SDK_PASSTHROUGH (raw body deep-equals SDK-returned object): true
SDK_USAGE_AS_RETURNED (verbatim): {"completion_tokens":3,"prompt_tokens":1323,"total_tokens":1326}
usage keys call-1 (SDK path): ["completion_tokens","prompt_tokens","total_tokens"]
usage keys call-2 (raw path): ["completion_tokens","prompt_tokens","total_tokens"]
usage diff (keys only in one call): {"onlyCall1":[],"onlyCall2":[]}
CACHE_FIELDS_PRESENT (any /cach/i key in either usage): false []
{
  "VERDICT_Q1_cache_fields": "ABSENT",
  "VERDICT_Q2_pathway": "SDK is a verbatim pass-through — any stripping happens at/behind the gateway, not in SDK code",
  "billableCallsSpent": 2,
  "freeCallsSpent": 2
}
```

### P3-a findings

- **R1 — Usage shape at our boundary is EXACTLY 3 fields.** Both pathways
  (SDK-observed and raw HTTP), both tiers, both sequential calls:
  `usage = {completion_tokens, prompt_tokens, total_tokens}`. No
  `prompt_tokens_details`, no `cached_tokens`, nothing matching /cach/i.
  `prompt_tokens` (1,323/1,324) matches the F3 proposal probe exactly — same
  corpus, same tokenizer truth.
- **R2 — The SDK hides NOTHING.** SDK source (`dist/index.js`
  `createChatCompletion`) ends in `return await response.json()` — verbatim —
  and the probe PROVED it live: raw body deep-equals the SDK-returned object on
  both tiers (`PASSTHROUGH: true`). The approved follow-up ("SDK-level
  response-capture or a thin fetch wrapper") is therefore **moot — nothing to
  extract**.
- **R3 — The gateway is a NORMALIZING proxy, not a transparent pipe.** It
  stamps its own ids (`x-message-id: zai-ai-gateway-…`), rate limits (QPS 2 /
  daily 300), and **rewrites the `model` field to `"glm-4-plus"` for BOTH
  requested models** (glm-4.6 and glm-4.5-flash requests both return
  `"model":"glm-4-plus"`). Whatever upstream returns, the gateway's normalized
  response contract — the only contract we can reach — carries 3 usage fields.
- **R4 — Caching may exist but is INVISIBLE and therefore untrackable.** The
  documented hit threshold (~500 tokens) is crossed by the prefix (~1,323
  tokens); latency showed no second-call drop (396→401 ms, weak signal). Even
  if the provider caches and discounts server-side, no field at our boundary
  ever reports it.

**Stop condition TRIGGERED (proposal §2):** Phase 3's cache tracking ends at
**"tracked fields: none available — provider caches invisibly; our only lever
(prefix stability) is already shipped and harness-pinned (see §P3-C)."** No
meter changes; the third approved billable call stays in reserve (no sweep).

**GLM ledger — P3-a stage:** 2 billable calls (2,654 billed tokens ≈ $0.0016)
+ 2 free flash calls (2,662 tokens, $0). **Phase 3 total to date** (incl. the
disclosed proposal probes): 4 billable calls, 5,308 billed tokens ≈ $0.003.

---

## §P3-B — The v1→v2 flip: case for/against (AWAITING USER RULING)

**What the flip is:** `contextSpec "v1" → "v2"` = deliver the system card as a
native `role:"system"` message at position 0. Today (v1) the system_note row
rides the wire with a non-system role — the shipped `WireMessage` role union is
`"assistant" | "user"` only, and the card sits at position 0 regardless (wire.ts
`assembleWire`, harness-proven).

### The case FOR

1. **Future-provider portability.** If Novara ever lands on a provider with
   role-keyed economics (explicit system-field discounts, cache APIs keyed to
   the system prompt), native delivery is the prerequisite. Concrete — but
   gated on a provider change that the project's own rules (fixed sandbox
   gateway, fixed SDK, no new deps) put out of scope today.
2. **Strict-provider compatibility.** Some providers reject a non-system
   opening message or require a system role. This gateway demonstrably tolerates
   v1 (every Phase 1–2 live run shipped on it). Zero risk today; nonzero only
   under a provider change. Same speculation as (1).
3. **Semantic cleanliness.** A native system message makes the wire
   self-describing and gives meter section attribution a literal "system"
   section. But §7 subfield attribution is already shipped, harness-pinned, and
   role-independent (computed from deterministic wire positions). Aesthetics.
4. **Now-vs-later cost.** Phase 3 is open and attention is on the wire; later,
   more code may depend on the shape. (Counter: the flip's cost is not the
   diff — it is the invariants, see below.)

### The case AGAINST

1. **Zero billable payoff — proven, not assumed.** F5 (docs: caching is
   prefix-position-based, indifferent to roles) plus today's P3-a R1: the
   provider exposes NO cache field at our boundary, so even a hypothetical
   billing delta from the flip would be unmeasurable on this stack. The flip's
   only quantifiable benefit cannot be observed.
2. **Zero functional payoff today.** v1 is the provider-proven shape of every
   shipped run. The flip resets that battle-testing to zero and buys nothing
   the wire cannot already do.
3. **Permanent dual-path maintenance.** Byte-identity for pre-flip runs
   (contextSpec is per-run; canonical transcripts are immutable history)
   requires keeping, FOREVER: `legacyReplay()` as the v1 reference implementation
   (already the P2-b byte-identity anchor), a contextSpec-conditional assembly
   branch (v1 replay vs v2 native system), the `WireMessage` role union widened
   to include `"system"` (type ripple through `finalizeWire`, the meter, and
   every wire consumer), and BOTH shapes harness-covered — every future wire
   invariant acquires a v1 twin and a v2 twin. One shape / one truth is traded
   for two of each.
4. **Re-validation cost.** Byte-identity quartet re-anchoring, §7 meter
   attribution re-proof, and a live-fire run to re-prove a new wire head against
   the real gateway — all to move the same bytes into a different role field.

### Recommendation

**Defer the v1→v2 flip out of Phase 3 entirely.** The honest answer to "what
concrete future capability does native-system delivery unlock?" is: **none that
exists on this provider** — no explicit cache API (F1), position-based caching
(F5), no cache fields to track (P3-a R1). What it unlocks is tidiness plus
optionality on a hypothetical provider migration the project rules exclude. The
cost, by contrast, is concrete and permanent (dual assembly branches, doubled
harness surface, a wider wire type, re-validation of the most battle-tested
invariant in the codebase).

**RULING (user, 2026-11-05): DEFER — approved.** v1 stays the one and only
wire shape; the flip is recorded as **consciously declined** with three
concrete revisit triggers:
1. **Strictness signal** — the gateway starts rejecting the v1 head shape
   (non-system opening message).
2. **Billing signal** — the provider ships role-keyed cache discounts or an
   explicit cache API.
3. **Functional signal** — a real debugging/attribution need is blocked on
   role semantics.

Until one fires, no wire-format work touches the role union.

**PHASE 3 CLOSED** (user, 2026-11-05): P3-a negative finding pinned (§P3-A R1–R4,
stop condition honored), P3-c shipped (§P3-C), P3-b declined with triggers
(above). Phase 3 total GLM spend: 4 billable calls, 5,308 billed tokens ≈
$0.003 — "well-spent" per reviewer.

---

## §P3-C — Stable-prefix harness assertion (executed 2026-11-05, zero GLM)

One assertion added to `scripts/verify-p2-c.ts` (approved scope): the FIRST TWO
wire messages — the per-agent system card + the goal envelope, the cache-eligible
stable head (proposal F4) — must be byte-identical before and after EVERY
compaction cycle exercised in the harness (the three M2 matrix cuts + the
guard's g-normal cycle). Harness state: static check sites 37 → **38**; runtime
checks 45 → **46**.

Verbatim output lines:

```
P2-C: [PASS] P3-C wire head stable across compaction — [system card][envelope] byte-identical in every cycle — mx-reply=stable, mx-feed=stable, mx-marker=stable, g-normal=stable
P2-C: ALL CHECKS PASSED (46 checks)
```

### Regression quartet (measured 2026-11-05, runtime PASS/FAIL line counts)

| harness | runtime checks | result |
|---------|---------------|--------|
| verify-stage-a.ts | 17 | ALL CHECKS PASSED |
| verify-p2-a.ts | 13 | ALL CHECKS PASSED |
| verify-p2-b.ts | 35 | ALL CHECKS PASSED |
| verify-p2-c.ts | 46 (incl. P3-C) | ALL CHECKS PASSED |

**Labelled correction (re-derive-and-label):** an intermediate session summary
claimed the close-out remembered verify-p2-b as "39". The close-out artifact
itself (`phase1-2-closeout.md` §2, row 7) reads **"17 / 13 / 35 / 45 — all
green"** — it agrees exactly with today's measured quartet. The "39" figure
appears in NO surviving artifact; it was an artifact of context compaction in
the intermediate summary, not of the project record. Today's measured numbers
stand uncorrected: 17 / 13 / 35 / 46 (P3-C added one assertion to p2-c).

### Ship health

- `bun run lint` — clean (no findings).
- Dev server (`:3000`) — healthy post-harness (200s on `/api/agent/runs`, no
  errors in dev.log).
- Files touched this stage: `scripts/p3-a-raw-http-probe.ts` (new, probe),
  `scripts/verify-p2-c.ts` (+32 lines, one assertion), `agent-ctx/phase3-stages.md`
  (this file), one status line in `agent-ctx/phase3-proposal.md`. No app code,
  no wire format, no deps, no UI.

---

## §P3-A-2 — Billing attribution check (R3 loose end; executed 2026-11-05, zero billable GLM)

**Question:** the gateway rewrites response `model` to `"glm-4-plus"` for BOTH
requested models (R3). Our ledger/usage events attribute by the REQUEST-side
modelId from the registry. Does billing follow the requested model (registry
pricing correct), or could the rewrite mean tokens are billed at a tier
different from what we record?

### Evidence (embedded at production time)

**(a) The echo is a CONSTANT label — 3rd live observation.** Requested
glm-4.5-flash (free tier, the approved single call), response verbatim:
```
{"choices":[{"finish_reason":"stop","index":0,"message":{"content":"BILLING-CHECK","role":"assistant"}}],"created":1793885277,"id":"20261105212756cec6dd2549324db8","model":"glm-4-plus","object":"chat.completion","request_id":"20261105212756cec6dd2549324db8","usage":{"completion_tokens":5,"prompt_tokens":24,"total_tokens":29}}
```
`response model echo for requested glm-4.5-flash: glm-4-plus` — same constant
label as both glm-4.6 calls earlier today. The echo carries ZERO model identity.

**(b) Gateway rate-limit budgets are IDENTICAL across requested models** (flash
today vs glm-4.6 today, from the recorded header sets):
```
x-ratelimit-limit-daily:        flash=300 | glm-4.6=300 | SAME
x-ratelimit-limit-qps:          flash=2   | glm-4.6=2   | SAME
x-ratelimit-user-10min-limit:   flash=30  | glm-4.6=30  | SAME
x-ratelimit-user-daily-remaining: flash=364 | glm-4.6=370 | DIFFERENT (consumption counter, not a tier signal)
```
No observable per-model differentiation exists in any response header.

**(c) NO code path reads the echo field** (grep, this day): `glmChat`
(`src/lib/novara/glm.ts`) reads `choices[0].message.content` only;
`extractRealUsage` (`src/lib/usage/ledger.ts`) reads only
`usage.{prompt_tokens, completion_tokens, total_tokens}`; the meter's
`modelId` comes from the REQUEST-side selection passed at construction
(`createContextMeter({ modelId: params.model.selection.modelId … })`); the
global ledger records per-SURFACE token totals (calls/prompt/completion/total)
and stores NO model field at all. The `model` echo is display-and-dead.

**(d) NO $-conversion code exists.** There is no pricing table, no cost
computation anywhere in `src` (grep `price|billing|costPerM|inputCost` → one
comment only). Every $ figure in project reports is hand-computed from the
docs' per-requested-model price rows (proposal §F2 citations).

### Verdict

- **The echo field is COSMETIC — evidence (a)+(c).** Nothing in the product
  reads or displays it; token records are the provider's billed counts keyed
  by the request-side selection (what we sent), which is the API contract's
  routing selector and the docs' pricing key. Registry-side attribution is
  correct under the documented contract.
- **The invoice-tier residual is genuinely ambiguous — evidence (b)+(d) — and
  is flagged as a PHASE 5 DEPENDENCY.** Whether the provider's invoice tiers a
  given request at the requested model's price row is NOT observable from
  inside this sandbox: no billing/usage-query API is cited in the docs, the
  gateway's config is unreachable, and its headers expose a shared user quota
  with no per-model split. This has ZERO product surface today (no $ display
  exists to be wrong) — but Phase 5's cost-display credibility requires
  reconciling one real invoice/dashboard row against request-side attribution
  before any $ number is shown to the author.
- **Pinned note (the approved harness/doc pin, doc-note form chosen — there is
  no pricing code for a harness to assert):** this section IS the pin. The
  invariant it states: *our ledger records measured provider tokens keyed by
  request-side selection; the response model echo is unread; $ attribution
  does not exist in code today and, when it arrives (Phase 5), must first
  reconcile against the provider's invoice side.*

Probe cost: 1 free flash call (24+5 tok, $0). Billable calls spent on this
check: **0**.
