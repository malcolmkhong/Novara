# Phase 3 Proposal — Provider Cache Capability & Wire Evolution

**Status: READ-ONLY — no code shipped, awaiting approval.** Date: 2026-11-05.
Rules honored: additive-only, zero new deps, no business-logic/UI changes, GLM
discipline (probe spend disclosed: 2 calls, 2,654 tok ≈ $0.001 on glm-4.6).

---

## §1 Findings first — capability facts (docs + live probes), with citations

### F1. The provider offers IMPLICIT prefix caching only — no explicit cache API

- Official docs: **"Automatic Cache Recognition: Implicit caching that
  intelligently identifies repeated context content without manual
  configuration"** — docs.z.ai, Context Caching
  (https://docs.z.ai/guides/capabilities/cache, fetched live 2026-11-05).
  BigModel CN doc identical (自动缓存识别：隐式缓存 —
  https://docs.bigmodel.cn/cn/guide/capabilities/cache).
- The current docs index (both portals, /llms.txt) lists NO explicit
  cache-create/cache-reference API — no `cache_id`, no cache-control request
  fields, nothing to opt into or tune. The cache is server-side and automatic.
- Mechanics the docs disclose: repeated prefixes are auto-cached; hits require
  a long-enough common prefix (CN doc: 建议 500 Token 以上 — ≥ ~500 tokens);
  cache population is **asynchronous** ("首次请求后稍等片刻再发起后续请求效果更好").

### F2. Billing: cached input is real money — 82% off list for GLM-4.6

- z.ai pricing (https://docs.z.ai/guides/overview/pricing, fetched live):
  **GLM-4.6 — Input $0.60 / 1M; Cached Input $0.11 / 1M; Cached Input Storage
  Limited-time Free; Output $2.20 / 1M.** Cached-input = ~18% of list input.
  GLM-4.5-Flash is free across all columns. BigModel CN prices the hit
  separately per model with cache storage 限时免费 (limited-time free) and the
  generic cache doc says hits bill at "usually 50% of standard price" — the
  per-model table is the binding number.
- Billing model: `调用费用 = 未命中缓存的输入费用 + 缓存命中费用 + 输出费用 +
  缓存存储费用` (pricing page). **Storage is currently free** — a limited-time
  promotion; a future storage price is a real (if small) carry cost per cached
  token-hour.

### F3. The usage fields the provider documents vs what OUR pathway returns — MISMATCH

- Documented: "Detailed display of cached token counts in response field
  **`usage.prompt_tokens_details.cached_tokens`**" (both portals, same page).
- **Live probe (our exact stack pathway — z-ai-web-dev-sdk →
  `zai.chat.completions.create`, glm-4.6, non-streaming, thinking disabled; 2
  calls, identical ~1,323-token system prefix, 3s apart; script:
  `scripts/p3-usage-probe.ts`):**
  ```
  call 1 usage: { completion_tokens: 3,  prompt_tokens: 1323, total_tokens: 1326 }
  call 2 usage: { completion_tokens: 4,  prompt_tokens: 1324, total_tokens: 1328 }
  ```
  **`prompt_tokens_details` / `cached_tokens` is ABSENT on our pathway.** The
  provider may be caching (and discounting) server-side — we literally cannot
  see it. `prompt_tokens` totals are consistent with OpenAI-compatible
  semantics (cached tokens would be a subset of prompt_tokens, so our P4
  reconciliation and meter anchors are unaffected either way).

### F4. Prefix stability IS billable-relevant for this stack — and our wire is already shaped for it

- The wire's first two messages are byte-stable per conversation
  (`system_note` role card ~1.8K + goal envelope), and the role card is shared
  per-agent across runs — the exact "stable head, variable tail" shape the
  docs recommend ("把稳定不变的说明…放在系统提示词前部，把多变的问题放在用户消息中").
- **Compaction synergy (P2 guarantee, no new work):** the projection never
  touches messages[0..1] — a compaction rewire preserves the entire stable
  prefix up to the first changed message, so a compacted wire keeps caching
  everything before the projection block. The monotone cost guard (§2.3.1)
  and the cache discount point the same direction: both make the stable head
  the cheap part.
- Concurrency caveat: multi-member runs interleave different conversations
  through one gateway — cross-conversation prefix sharing is plausible (same
  role-card bytes) but cache residency/eviction policy is undisclosed; treat
  hit rates as unmeasurable until F3 is resolved.

### F5. System-token cache discounts

- No separate "system token discount" exists — the single mechanism is
  prefix-position-based (any stable leading tokens, system or otherwise, hit
  the same discounted rate). Our v1 system-note-on-wire already sits at
  position 0; the Phase-3 `contextSpec="v2"` flip (native system message)
  keeps it at position 0 — caching is indifferent to v1/v2.

## §2 Verdict + the minimal Phase 3 design (provider-specific)

**The provider DOES offer something actionable — but not observability.** The
honest split:

1. **We keep (zero code):** the wire already maximizes implicit cache hits —
   stable system head first, stable envelope second, variable tail after.
   This is a stated Phase 2 invariant, not new work. The guard + projection
   preserve it under compaction.
2. **We cannot track cache economics today:** `cached_tokens` does not reach
   our SDK pathway (F3). The "we only track cached-token fields" fallback is
   therefore **blocked at the provider boundary**, not by our design. Meter
   changes for cache accounting would be dead code until the field arrives.
3. **Phase 3 implementation scope (on approval) — small and additive:**
   - **P3-a probe upgrade:** ONE raw-HTTP call path (no new deps — `fetch` with
     the SDK's credentials) to test whether the endpoint returns
     `prompt_tokens_details.cached_tokens` outside the SDK's normalization.
     Outcome A: field present ⇒ wire the meter to record it (one optional
     `real.cachedTokens` subfield + panel-free telemetry, mirroring §7).
     Outcome B: absent ⇒ record the negative finding in the design doc and
     stop; no meter changes.
   - **P3-b contextSpec flip:** the already-planned `"v1"→"v2"` system-delivery
     flip (design doc §1) — unaffected by caching (F5), unchanged scope.
   - **P3-c optional, cheap:** a stable-prefix audit assertion in the harness
     (first two wire messages byte-stable across a compaction cycle) — one
     assertion, keeps the caching property pinned as the wire evolves.
4. **Explicitly NOT in scope:** any cache-warming machinery, prefix-format
     gymnastics, or storage-fee tracking (storage is $0 today; the pricing
     page is the watchdog).

**Stop condition honored:** if the raw-HTTP probe (P3-a) also returns no
cache fields, Phase 3's cache work ends at "tracked fields: none available —
provider caches invisibly; our only lever (prefix stability) is already
shipped and harness-pinned."

## §3 Cost of the proposed Phase 3

- GLM: ≤ 3 additional minimal calls (raw-HTTP probe ×2 + one margin call),
  each ≤ ~1.5K input tokens on glm-4.6 — total ≤ ~5K tok ≈ $0.002. Everything
  else zero-GLM.
- Code: ≤ 2 files touched (`context-meter.ts` + one probe script), all
  additive optional fields; no deps; no UI.
