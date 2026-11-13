# AGENTS.md — working guide for AI agents in this repository

This file tells you how the code actually works today and what you must not break. It is
written against the current implementation, not against an earlier design. When the code
and this file disagree, the code wins — fix this file in the same change.

The product summary lives in `README.md`. Keep the two consistent.

---

## 1. What this project is

Novara is an AI novel-writing studio: a Next.js 16 app (one page route, hash-routed) over
Postgres/Neon via Prisma, with Firebase Auth and a five-role agent team (Atlas, Sage,
Prism, Nova, Forge) that plans, writes, reviews, projects memory and exports a novel.

The spine of the system is:

```
contract → CHAPTER_COMMIT → derived projections (state, index, summary, memory) → doctor
```

The commit is the only way to make canon, and the commit is where the projection is
written. The original port dropped the commit and made settling an optional tool call;
that was restored — a chapter cannot be final without its memory projection.

---

## 2. Non-negotiable integrity rules

These are enforced in code. Do not "simplify" them away.

1. **Final is immutable canon.** A `final` asset cannot be edited: every update/delete
   route for an authored entity answers `409 {"error":"asset_finalized","kind","id","reopen"}`.
   The one way back is a `reopen`, which downgrades the asset to `draft` and archives the
   old version into `AssetVersion`. The rule lives in `src/lib/novara/lifecycle.ts`
   (`finalizedRefusal`, `moveAsset`) and is applied at the route layer — for the chapters,
   the contract, `Character`, `WorldEntry`, `OutlineBeat`, `Volume`, `ChapterPack` and the
   five ledgers. Every reopen and every finalize writes an `AssetTransition` row.
   A reopen changes **nothing** in memory; only a finalize updates it.
2. **The projection rides along with the commit.** `finalize_chapter` runs the AI
   extraction **outside** the transaction and then, **inside one transaction**, flips
   `Chapter.status` to `final` and calls `writeSedimentProjection`
   (`src/lib/agent/runtime.ts:3112-3139`). If the extraction fails, the chapter stays a
   draft. Never split the status flip from the projection.
3. **One review writer.** `src/lib/novara/review.ts` is the only module that writes
   `ChapterReview`. A critical-severity issue is blocking; the finalize gate uses the
   persisted `blockingCount` of the latest review (`evaluateFinalize`, `evaluateSettle`
   in `src/lib/novara/qc.ts:30-88`).
4. **Overwriting prose is explicit.** Replacing non-empty prose requires
   `overwrite: true` (`assessOverwrite`, `src/lib/novara/write-gate.ts:23`). The same
   check pauses the agent even in `full_access` mode.
5. **Word counts are computed server-side.** `countWords` / `chineseWordCount`
   (`src/lib/novara/words.ts:9,31`). Never trust a client-supplied count.
6. **Counters are verified, not believed.** The model's `run-report` numbers are compared
   with counters rebuilt from the persisted event log (`deriveMeasuredFromEvents`,
   `src/lib/agent/runtime.ts:870-925`; `auditReport`, `src/lib/novara/qc.ts:128-144`).
   Mismatches become blocking issues in the final report. Do not add a path where a
   model's claim becomes a fact.
7. **Every provider call is metered.** All AI calls go through `src/lib/ai/chat.ts`,
   which takes a credit hold (`beginCharge`) and settles it against measured usage.
   `bun scripts/check-credit-coverage.ts` fails the build if a provider call can happen
   without a charge path.
8. **Ownership fails closed.** The Prisma extension in `src/lib/db.ts:367-373` filters
   every query by the caller's identity and throws for any model without an ownership
   rule: `ownership: model "<x>" has no ownership rule — refusing to run unfiltered.`
   Do not hand-write `where` filters to "replace" it, and do not add a model to
   `UNFILTERED_MODELS`.
9. **One page route.** `/` is the only user-visible route (`src/app/page.tsx`).
   Everything else is an API route under `src/app/api/**`. No new page routes, no server
   actions — use an API route with `parseBody` + zod + `jsonError`.
10. **No AI SDK in the client.** The browser may call Novara's own `/api/*` endpoints;
    provider SDKs and keys stay server-side.

---

## 3. Architecture map

```
src/
  app/
    page.tsx                 the only page route → <NovaraApp/>
    api/                     44 route files (see §7)
    globals.css              Tailwind v4 theme tokens
  components/
    novara/                  marketing pages, navbar/footer, settings, user menu
      writer/                rail (asset-tree), document tree, document pane,
                             conversation pane, composer, task board, chapter editor
    ui/                      shadcn/ui primitives
  hooks/                     use-writer-store (persisted UI state), use-agent-run
                             (SSE), use-credits, use-hash-route
  lib/
    agent/
      runtime.ts             the orchestrator: leases, roles, tool loop, gates, report
      tool-protocol.ts       tool catalogue + wire formats
      snapshot.ts            loadStorySnapshot: the state a task sees
      snapshot-slice.ts      slicing for large contexts
      context-meter.ts       context budget accounting
      wire.ts / messages.ts  provider wire formats, message persistence, lease constants
    ai/
      chat.ts                THE choke point: semaphore, credit hold, retry
      router.ts              provider selection
      providers/*.ts         gemini (Vertex ADC), deepseek, minimax, openai, anthropic
      writing.ts             prose-draft helpers
    novara/                  the domain layer (see below)
      qc.ts                  pure gates: evaluateFinalize/Settle/Repair, auditReport
      review.ts              the only writer of ChapterReview
      sediment.ts            extractSediment + writeSedimentProjection
      sediment-windows.ts    overlapping extraction windows
      memory.ts              scoring, retrieval, buildMemoryView, buildMemorySyncReport
      open-loops.ts          forward-only promise/clue transitions
      write-gate.ts          overwrite gate
      lifecycle.ts           the draft/final rule: reopen, finalize, transition log
      asset-gate.ts          AssetVersion snapshots for canon assets
      versions.ts            ChapterVersion snapshots (max 30 per chapter)
      doc-tree.ts / doc-markdown.ts   the document tree model and its renderers
      content.ts             loads agent/ (cards, skills, budgets)
      api.ts / api-helpers.ts / schemas.ts / types.ts   client + server contracts
      export.ts / backup-schema.ts / import helpers
      words.ts / models.ts / settings.ts / wizard-parse.ts / quota.ts
    credits/                 charge.ts (holds, settles, caps), ledger.ts
    usage/                   pricing.ts, usage-store.ts, retention.ts, usage-shapes.ts
    db.ts                    Prisma client + ownership extension + identity helpers
  middleware.ts              Firebase token verification for every API route
agent/                       the prompt content layer
  system/{atlas,sage,prism,nova,forge}.md    role cards
  skills/**                  11 skill files
  config/{team,skills,budgets}.yaml
prisma/schema.prisma         40 Postgres models
scripts/                     checks, proofs, backfills, standalone assembly
deploy/                      legacy VM deployment scripts (SQLite-era; unmaintained)
```

---

## 4. Data model in one page

`prisma/schema.prisma` — Postgres, 40 models, no JSON columns (JSON is a `String`), no
enums (statuses are `String` fields with inline comments).

| Area | Models |
|---|---|
| Identity | `User` (Firebase subject; the app never writes it) |
| Body | `Novel` · `Chapter` (`draft` / `final`) · `ChapterVersion` · `ChapterReview` |
| Bible | `Character` · `WorldGroup` · `WorldEntry` |
| Outline | `Volume` · `OutlineBeat` |
| Contract | `NovelContract` (+ `Novel.conceptSnapshot`) |
| Ledgers | `Storyline` · `TimelineEntry` · `CharacterArc` · `StoryPromise` · `StoryClue` |
| Memory | `ChapterDigest` · `StoryFact` · `CharacterState` · `Foreshadow` |
| Draft area | `ChapterPack` (`material` / `prep`) |
| Agent | `AgentRun` · `AgentTask` · `AgentEvent` · `AgentMessage` · `ContextSummary` · `SkillInvocation` |
| Immutable layer | `AssetVersion` · `AssetTransition` (every reopen/finalize) |
| Usage/credits | `UsageCall` · `UsageProvenance` · `UsageDaily` · `UsageInvoice` · `CreditAccount` · `CreditLedger` |
| Legacy | `TeamAgent` · `TeamConversation` · `TeamMessage` · `TeamTask` · `TeamTaskLog` · `TeamTurnLog` — no route, UI or runtime code uses them |

Ownership rules, in the order the extension applies them (`src/lib/db.ts`):

1. a model with a scalar `userId` → filtered by `userId`;
2. a model with a scalar `novelId` → filtered by the caller's owned novel ids;
3. indirect models (`AgentTask`, `AgentEvent`, `AgentMessage`, `ContextSummary`,
   `SkillInvocation`, `TeamMessage`, `TeamTaskLog`) → filtered through their run;
4. `UNFILTERED_MODELS = ["User", "TeamAgent"]` are exempt;
5. anything else → **fail closed**.

Creates are stamped with the caller's `userId` and require an identity. Scripts and
background jobs use `withUser(uid, isAdmin, fn)`.

---

## 5. The agent runtime

`src/lib/agent/runtime.ts` (3582 lines) is the orchestrator. The content layer lives in
`agent/` and is loaded by `src/lib/novara/content.ts`.

### 5.1 Roles and tools

`MEMBER_TOOLS` (`runtime.ts:1355-1361`) is the allow-list; `toolAllowedFor`
(`runtime.ts:1367`) rejects a call **before** it has any effect, so the gate cannot be
bypassed by a prompt.

| Role | Tools |
|---|---|
| **atlas** | `read_novel`, `read_chapter`, `read_outline`, `read_foreshadows`, `read_promises`, `memory_query`, `doctor_scan` |
| **sage** | the read tools, `doctor_scan`, `create_chapter`, `update_chapter`, `update_outline_beat`, `update_ledger`, `reopen_asset`, `finalize_asset`, `finish` |
| **nova** | the read tools only |
| **prism** | the read tools, `doctor_scan`, `review_chapter`, `finalize_chapter`, `settle_chapter`, `update_ledger`, `reopen_asset`, `finalize_asset`, `finish` |
| **forge** | the read tools, `doctor_scan`, `export_markdown`, `finish` |

Full tool catalogue (18): `read_novel`, `read_chapter`, `read_outline`,
`read_foreshadows`, `read_promises`, `memory_query`, `doctor_scan`, `update_ledger`,
`review_chapter`, `finalize_chapter`, `settle_chapter`, `export_markdown`,
`create_chapter`, `update_chapter`, `update_outline_beat`, `reopen_asset`,
`finalize_asset`, `finish`.

`reopen_asset` / `finalize_asset` move a canon asset between `draft` and `final`
through `src/lib/novara/lifecycle.ts`. A reopen by the agent **must** carry a reason —
the runtime turns it into a visible chat line, so an unlock is never silent.

`settle_chapter` is idempotent and stays callable, but it is **not** load-bearing:
`finalize_chapter` already settles. The Atlas skill card still mentions `settle_chapter`
— that text is stale.

### 5.2 Run lifecycle

1. `POST /api/agent/runs` — validates the goal (3–2000 chars), the mode
   (`approval | full_access`), the model and the thinking level, checks the credit
   balance, and starts the executor out of band.
2. **Lease**: the executor claims `leaseOwner` + `leaseEpoch` and renews it every 10 s;
   losing the lease aborts the run without further writes (`runtime.ts:1244-1308`).
3. Atlas plans, emits ` ```team-delegate ` orders; each order becomes an `AgentTask`
   executed **sequentially**.
4. Each member runs a bounded tool loop (≤ 3 turns, ≤ 3 actions per turn) and must end
   with a ` ```run-report ` block (`agent/skills/shared/output-contract.md`).
5. Writes pause for approval. `decideApproval` (`runtime.ts:617-733`) **commits in code**,
   re-checks the final lock at commit time and creates the `ChapterVersion`; the paused
   executor re-verifies the database instead of trusting the handler.
6. After the write: verify, then up to 2 repair rounds (`runtime.ts:2654-2712`). A task
   whose write cannot be verified is `failed`.
7. The final report compares claimed vs measured counters and lists mismatches as
   blocking issues.

SSE: `GET /api/agent/runs/[id]/events` — a snapshot every 1200 ms, a heartbeat every 15 s. The browser opens it with `fetch()` + a bearer token (not `EventSource`) and falls back to 2 s polling (`src/lib/novara/agent-client.ts:143`).

### 5.3 Budgets

Runtime limits live in `agent/config/budgets.yaml` (schema and fallbacks in
`src/lib/novara/content.ts:50-198`); the lease-renewal interval is the exception — `LEASE_RENEW_MS = 10_000` in `src/lib/agent/messages.ts:48`. Values: `maxTurns: 3`, `leaderMaxTurns: 22`,
`planMaxTasks: 44`, `chapterContextChars: 24000`, `repairRounds: 2`,
`sedimentWindowChars: 4000` with `sedimentWindowOverlapChars: 800`,
`memory.topK: 14` with `contextBudgetChars: 2600`, `qc.approvalWaitMs: 1800000`,
`prompt.systemPromptCapChars: 8000`. `team.yaml` and `skills.yaml` are fail-fast;
`budgets.yaml` degrades to defaults. A few declared keys are never read
(`ai.routeMaxDuration`, `ai.chapterTailChars`, `ai.snapshotFactsLimit`,
`client.fallbackPollMs`) — do not rely on them.

---

## 6. Coding conventions

- **TypeScript, strict.** The build is the type gate: `next.config.ts` deliberately has
  no `typescript.ignoreBuildErrors`. Run `npx tsc --noEmit` before you claim done.
- **Styling**: Tailwind v4 utility classes, `cn()` from `src/lib/utils.ts` for
  conditional classes, shadcn/ui primitives from `src/components/ui/`. No CSS-in-JS, no
  new component library.
- **API routes**: `parseBody` + a zod schema + `jsonError`; ownership comes from the
  Prisma extension; canon checks call the gate helpers (`write-gate.ts`, `lifecycle.ts`)
  instead of testing `status` inline.
- **Database**: use `db` from `src/lib/db.ts`; interactive transactions with
  `db.$transaction(async (tx) => …)`; call `await warmIdentity()` **before** opening an
  interactive transaction (see §9).
- **AI**: one call site — `src/lib/ai/chat.ts`. It needs an identity for the credit
  ledger, enforces the provider allowlist and retries with backoff. Provider adapters
  live in `src/lib/ai/providers/`; the model registry is
  `src/lib/ai/providers/registry.ts` + `src/lib/novara/models.ts`.
- **Comments and reports in English.** The `agent/` content layer is English (Chinese
  appears only inside quoted example prose).
- **Files**: UTF-8, CRLF in the working tree (`core.autocrlf=true`). Never round-trip a
  source file through PowerShell `Get-Content`/`WriteAllLines` without `-Encoding UTF8` —
  that silently corrupts every non-ASCII character. Use the editor tools.

---

## 7. Task recipes

### Add a schema field

1. Edit `prisma/schema.prisma` (additive only; never drop a column).
2. `bun run db:generate`, then `bun run db:push` (or a migration when `DIRECT_URL` is
   available: `bun run db:migrate:new`).
3. Update `src/lib/novara/types.ts` and `src/lib/novara/schemas.ts` (zod) and the
   backup schema if the field must survive an export.
4. Re-check ownership: a new model needs an ownership rule, otherwise every query on it
   throws. `bun run db:check:ownership`.

### Add an API route

Follow `src/app/api/novels/[id]/route.ts`: `parseBody` + zod + `jsonError`; read through
`db` (ownership is automatic); never expose a `userId` from the client; if the route
mutates canon, call `src/lib/novara/lifecycle.ts` (`finalizedRefusal` / `moveAsset`) —
never write the canon column yourself.

### Add a row to the document tree

The tree has exactly two row kinds: a folder (`id: f:<name>`) and a document
(`id: <DocKind>:<ref>`).

1. Add the row in `src/lib/novara/doc-tree.ts` (`buildDocTree`).
2. Register the renderer in `src/lib/novara/doc-markdown.ts` (`DOC_RENDERERS`) — a
   document without a renderer is a bug the tree check catches.
3. Run `bun scripts/check-doc-tree.ts` (unique ids, renderer per document, no
   unexplained empty folder).

### Add a wizard section

`src/app/api/ai/wizard` (zod enum) → `src/lib/novara/api.ts` (`WizardSection`) → the
wizard UI in `src/components/novara/writer/create-wizard.tsx`. A parsed field may not be
silently dropped (`src/lib/novara/wizard-parse.ts`).

### Add or change an agent tool

1. Declare it in `src/lib/agent/tool-protocol.ts`.
2. Implement it in `executeTool` (`src/lib/agent/runtime.ts:2849`) and add it to the
   role allow-lists in `MEMBER_TOOLS` — a tool no role may call is dead.
3. If it writes, it must respect the write gate, the canon lock and the credit path.
4. If it changes a counter, update `Measured` **and** `deriveMeasuredFromEvents` so the
   audit can rebuild it from the event log.

### Change agent behaviour

Change the content layer (`agent/system/*.md`, `agent/skills/**`), not the runtime. Magic
numbers belong in `agent/config/budgets.yaml`.

### Add a check

Put it in `scripts/` as a `*.ts` script that exits non-zero on failure, and wire it into
`package.json` if it must run in CI. The Cloud Build lint step (`cloudbuild.run.yaml`) is
the only gate that blocks a deploy today.

---

## 8. Commands

```bash
bun run dev                  # dev server on :3000
bun run lint                 # eslint . — must be green before a commit
npx tsc --noEmit             # type check (the build also type-checks)
bun run db:generate          # prisma generate
bun run db:push              # prisma db push (additive)
bun run db:check:ownership   # every model has exactly one ownership rule
bun run check:credits        # every provider call has a charge path
bun scripts/check-doc-tree.ts # document-tree invariants
bun run verify:auth          # authFetch: token attach, 401 refresh, signed-out
```

Run only the checks the project defines, once each, at the end of a change.

---

## 9. Edge cases that bite

- **P2028 "Transaction already closed"** — the identity cache is empty when the
  transaction starts, so the first query inside it uses a pooled connection that Neon
  (pooler `connection_limit=1`) cannot serve concurrently. Call `await warmIdentity()`
  **before** `db.$transaction`.
- **Never call the model inside a transaction.** The sediment extraction is the classic
  case: extract first (outside), then write (inside). An interactive transaction has a
  5 s default timeout and holds a pooled connection.
- **The middleware deletes client headers.** `x-novara-uid` and `x-novara-admin` sent by
  a browser are stripped; the verified Firebase uid is injected instead. A route that
  trusts those headers is a security hole.
- **Creates need an identity.** A create outside a request (script, cron) has no
  `userId` to stamp — wrap it in `withUser(uid, isAdmin, fn)`.
- **`finish` is in the role allow-lists** even though the Atlas comment says writes are
  Sage-only; the allow-list is the source of truth.
- **The mock agent never runs**: `src/lib/novara/agent-client.ts` keeps it as a rollback
  adapter, but `AGENT_BACKEND` is the hard-coded constant `"live"`, so the mock path is
  never exercised.
- **The dark palette is unreachable** — nothing adds the `dark` class and
  `src/components/ui/sonner.tsx` (the only `next-themes` consumer) is never imported.
- **`deploy/` and `cloudbuild.yaml` are the legacy SQLite-era path**
  (`DATABASE_URL=file:/data/custom.db`, `sqlite3 .backup`) and contradict the Postgres
  schema. The live path is `cloudbuild.run.yaml` → Cloud Run `novara`
  (`asia-southeast1`). Do not copy the legacy scripts' database assumptions.
- **The import path validates only `integrity.chapterCount` and `totalWords`** — a
  hand-edited backup with a correct integrity block is not detected.
- **`ChapterReview` is append-only**; the gates always read the latest review for a
  chapter.
- **Memory projection write rules are not symmetric**: digests upsert by chapter,
  character states are replaced per chapter index, facts dedupe on
  (novelId, category, content) and only move `lastSeenChapter`, foreshadows dedupe on
  (content, plantChapter). A "changed" fact becomes a new row; there is no supersede
  field.
- **A reopen never touches memory.** `moveAsset` only archives the old version, flips
  the status and writes the transition row. A finalize is the only move that writes
  memory: a chapter finalize projects it (the extraction runs outside the transaction),
  a canon finalize retires the facts that name it by `(category, subject)`.
- **A re-finalize REPLACES a chapter's facts, it does not accumulate them.** The
  projection retires every live fact whose `sourceChapter` is that chapter and reuses the
  chapter's own rows (exact content, or a ≥ 0.45 near-duplicate) instead of inserting new
  ones — the retirement runs inside the finalize transaction, next to the status flip.
  Facts sourced from other chapters are never touched by it.
- **Some `src/lib/novara/api.ts` helpers and API routes have no UI caller** (the manual
  editors for characters, world entries, beats, volumes, ledger rows and packs lost
  their entry point when the artifact pane became the document pane). Before deleting
  such a helper, grep for it; before adding a UI for it, remember the document tree's
  "read-only projection" rule.

---

## 10. Where the truth lives

| Question | Source of truth |
|---|---|
| What a role may do | `MEMBER_TOOLS` in `src/lib/agent/runtime.ts` |
| What the model is told | `agent/system/*.md`, `agent/skills/**`, loaded by `src/lib/novara/content.ts` |
| What the numbers are | `agent/config/budgets.yaml` + the fallbacks in `content.ts` |
| Whether a chapter may be finalized | `src/lib/novara/qc.ts` + the persisted `ChapterReview` |
| Whether an asset may be edited | `src/lib/novara/lifecycle.ts` (the `draft` / `final` rule) |
| How memory is written | `src/lib/novara/sediment.ts` |
| How healthy the memory pool is | `GET /api/novels/[id]/memory/status` (the counters in `src/lib/novara/memory.ts`) |
| How memory is recalled | `src/lib/novara/memory.ts` |
| Who may read what | `src/lib/db.ts` (the ownership extension) |
| What the database contains | `prisma/schema.prisma` |
| How it is deployed | `cloudbuild.run.yaml`, `Dockerfile` |
| How it looks and works | `README.md` + the UI code under `src/components/novara/` |

Do not create additional Markdown files for notes; `README.md` and `AGENTS.md` are the
documentation of record.
