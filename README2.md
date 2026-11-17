# Novara AI

Novara is an **AI novel-writing studio** for long-form fiction authors. A novel is not a
text file: it is a set of structured records in Postgres — chapters, story bible, outline,
ledgers, and a persistent memory layer. A five-role AI agent team (**Atlas, Sage, Prism,
Nova, Forge**) reads that state, plans work, writes prose, reviews it, projects what it
learned into memory, and exports the result. The author keeps the final say: every write
either lands in the database immediately or pauses at an approval gate the author
resolves by hand.

**The problem it solves.** Generic AI chat forgets a story between sessions — by chapter
10 it has lost the protagonist's eye color, the planted foreshadowing, and the promises
made to the reader. Novara's differentiator is structural memory: every finalized chapter
projects its facts, character states, and foreshadows into the database inside the same
transaction that makes it canon, and every later draft retrieves that memory. Continuity
is enforced by gates, not by the author re-reading everything.

**Current state: a preview build.** Google sign-in works. The payment gateway is **not
implemented**; the plans page is display-only. See §12 for the full list of gaps and
not-yet-developed areas.

This document is written for both developers and AI agents: what the system is, every
API it exposes, and how to build it from zero. `AGENTS.md` holds the rules an AI agent
must follow when changing the code; when code and docs disagree, the code wins — fix the
docs in the same change.

---

## 1. Product overview

| Question | Answer |
|---|---|
| What is it? | An AI writing studio where a five-agent team plans, drafts, reviews, and delivers a novel under the author's approval |
| Who is it for? | Authors of long-form fiction (web novels, series, genre fiction) who need consistency across dozens of chapters |
| Core value | Persistent story memory + per-chapter continuity gates + an approval-controlled AI team |
| What ships today | One Next.js app with two faces: a marketing site and the writer workbench, behind a single page route |
| Where does it run? | Cloud Run (`asia-southeast1`) against a Neon Postgres database |
| Business model today | Free daily credit allowance; subscription plans exist as display configuration only — no checkout, no subscription state |

### 1.1 User-visible features

| Feature | What the user gets | Entry point |
|---|---|---|
| Google sign-in | Firebase Auth, ID token verified server-side on every API call | `src/lib/firebase/client.ts` |
| Novel creation wizard | AI Q&A that generates the novel concept section by section (premise, characters, world, outline…) | `src/components/novara/writer/create-wizard.tsx` → `POST /api/ai/wizard` |
| Writer workbench | Three-column studio: asset rail, conversation pane, document pane | `#/writer` → `workbench-shell.tsx` |
| Chapter editor | The only editable document; prose edits with explicit overwrite confirmation | `chapter-editor.tsx` |
| Story bible & outline | Characters, world entries/groups, volumes, outline beats — read-only projections in the document pane; written by the agent team or the API | `doc-tree.ts` / `doc-markdown.ts` |
| Agent team runs | Goal-driven runs with live event stream, task board, approval cards, model & permission-mode picker | conversation pane → `/api/agent/runs*` |
| Story memory | Chapter digests, facts, character states, foreshadows; scored recall feeds every draft; doctor reports gaps | memory documents + `doctor_scan` |
| Ledgers | Storyline, timeline, character arcs, promises, clues — forward-only loop transitions | ledger documents |
| Lifecycle & versions | draft/final canon lock, reopen with archived versions, chapter history (max 30 snapshots) | `lifecycle.ts`, `versions.ts` |
| AI draft assist | On-demand prose drafting outside a full run | `POST /api/ai/draft` |
| Export & import | Markdown manuscript, full JSON backup (v2, includes memory), backup import | `import-export.tsx` |
| Credits & usage | Credit meter, usage panel, ledger, invoices, statement | `usage-panel.tsx` → `/api/usage/*` |
| Plans page | Free / Creator / Studio packaging, **display only** (`PAYMENT_GATEWAY_STATUS.developed = false`) | `#/plans`, `src/config/subscription-plans.ts` |
| Marketing pages | Product, about, terms, privacy | hash routes `#/product`, `#/about`, `#/terms`, `#/privacy` |

---

## 2. Stack

| Layer | Choice | Where |
|---|---|---|
| Framework | Next.js 16.1 (App Router, `output: "standalone"`) | `next.config.ts:4` |
| UI | React 19, Tailwind v4, shadcn/ui (Radix) | `src/app/globals.css`, `src/components/ui/` |
| Client state | Zustand 5 (persisted UI preferences) | `src/hooks/use-writer-store.ts` |
| Database | Postgres (Neon) via Prisma 6.11 | `prisma/schema.prisma` |
| Auth | Firebase Auth, Google sign-in, ID token verified server-side (jose + Google JWKS) | `src/lib/firebase/client.ts`, `src/middleware.ts` |
| AI | Provider router over 5 adapters: gemini (Vertex ADC), deepseek, minimax, openai, anthropic | `src/lib/ai/router.ts`, `src/lib/ai/providers/` |
| Streaming | Server-Sent Events over the agent run | `src/app/api/agent/runs/[id]/events/route.ts` |
| Markdown | `react-markdown` (one parser, used everywhere) | `src/components/novara/writer/markdown-document.tsx` |
| Package manager / runtime | bun (scripts, container), Node 20+ | `Dockerfile`, `package.json` |

`bun` is the package manager and the container base (`oven/bun:1.3`).

---

## 3. How the system works

### 3.1 The spine: contract → commit → projection → doctor

A chapter only becomes canon through one transaction, and that transaction also writes
the chapter's memory projection:

```
author goal
  → Atlas plans (Task 0 impact assessment when a chapter is pinned)
  → Sage writes prose  → create_chapter / update_chapter  → approval gate → DB commit + ChapterVersion
  → Prism reviews      → review_chapter  → ChapterReview (critical issues are blocking)
  → Prism finalizes    → finalize_chapter
        └─ ONE transaction: Chapter.status = "final"  +  memory projection
                            (ChapterDigest · StoryFact · CharacterState · Foreshadow · loop ledger)
  → memory retrieval feeds the next draft (scored recall, budgeted prompt block)
  → doctor_scan reports gaps (undigested chapters, stale loops, unknown cast)
  → Forge exports the manuscript (markdown) or a full backup (JSON)
```

The projection is not a request the model may forget: `finalize_chapter` extracts the
sediment **outside** the transaction and then flips the status and writes the projection
**inside one transaction** (`src/lib/agent/runtime.ts:3112-3139`). If the extraction
fails, the chapter stays `draft` — it can never be final with unprojected memory.

### 3.2 Gates

| Gate | Rule | Enforced in |
|---|---|---|
| E2 finalize | latest `ChapterReview.blockingCount === 0` and non-empty prose | `src/lib/novara/qc.ts:30-58` (`evaluateFinalize`) |
| E2 settle | same review precondition | `src/lib/novara/qc.ts:61-88` (`evaluateSettle`) |
| Repair budget | ≤ 2 review→repair cycles per chapter, then escalate to the author | `src/lib/novara/qc.ts:96-120` (`evaluateRepair`) |
| Overwrite | replacing non-empty prose requires explicit `overwrite: true` | `src/lib/novara/write-gate.ts:23-33` |
| Final lock | a `final` asset cannot be edited: every update/delete route answers `409 {"error":"asset_finalized","kind","id","reopen"}`; only a `reopen` makes it editable again | `src/lib/novara/lifecycle.ts` (`finalizedRefusal`), the route layer |
| Asset canon | non-body assets (`Character`, `WorldEntry`, `OutlineBeat`, `Volume`, `ChapterPack`, 5 ledgers, contract) carry the same two-value status; reopening archives the old version into `AssetVersion` and writes an `AssetTransition` row | `src/lib/novara/lifecycle.ts` (`moveAsset`), `src/lib/novara/asset-gate.ts` |
| Approval | in `approval` mode every write pauses for the author; replacing non-empty prose pauses even in `full_access` | `src/lib/agent/runtime.ts:3494-3582` |
| Honesty | the model's `run-report` counters are compared against counters rebuilt from the event log; mismatches become blocking issues in the final report | `src/lib/novara/qc.ts:128-144`, `src/lib/agent/runtime.ts:2276` |

---

## 4. The writer workbench

One route (`src/app/page.tsx` → `src/components/novara/novara-app.tsx`) renders either the
marketing site or the studio; the switch is hash routing (`src/hooks/use-hash-route.ts`:
`#/`, `#/product`, `#/plans`, `#/about`, `#/terms`, `#/privacy`, `#/writer`).

The studio (`src/components/novara/writer/workbench-shell.tsx`) has three columns:

- **Left rail** (`asset-tree.tsx`) — novel identity, a `Write | Book` mode switch, one
  search line (English + Chinese aliases), and either the run list (Write) or the
  document tree (Book).
- **Conversation** (`conversation-pane.tsx`) — run history, the run summary with a
  reported-vs-verified report card, the event stream, the approval card, the `Chat | Board`
  segmented control, the composer (pins, model picker, permission mode, slash commands)
  and the credit/context meter.
- **Document pane** (`doc-pane.tsx`) — open documents as tabs, a `Document | Markdown`
  toggle, copy, fullscreen. Every document is a **read-only projection** of data that
  already exists in the detail payload; the chapter document is the only exception and
  keeps the editable `ChapterEditor`.

Below `xl` the rail becomes a bottom switcher (Conversation / Assets / Documents) and the
document pane moves into a Sheet.

**Creation wizard.** New novels are created through `create-wizard.tsx`, which calls
`POST /api/ai/wizard` one section at a time (zod enum of sections). A parsed field may
never be silently dropped (`src/lib/novara/wizard-parse.ts`). The wizard's sessionId is
echoed back on novel creation (`src/app/api/novels/route.ts`).

### 4.1 The document tree

`src/lib/novara/doc-tree.ts` builds a pure tree of two row kinds only:

- **folder** — id `f:<name>`, expands;
- **document** — id `<DocKind>:<ref>`, opens; `DocKind` is one of 19 kinds
  (contract, concept, skeleton, beat, digests, world_entry, character, chapter,
  memory_index, memory_category, the five ledger kinds, run, review, pack, world_group).

`src/lib/novara/doc-markdown.ts` holds one pure markdown renderer per kind
(`DOC_RENDERERS`); `src/components/novara/writer/doc-tree-panel.tsx` renders the rows and
filters them by search. `bun scripts/check-doc-tree.ts` asserts that ids are unique, that
every document has a renderer, and that no folder is empty without a badge.

---

## 5. The agent team

Registry: `agent/config/team.yaml`. Role cards: `agent/system/{atlas,sage,prism,nova,forge}.md`.
Skills: `agent/config/skills.yaml` → `agent/skills/**` (11 skills). The loader is
`src/lib/novara/content.ts`: it validates the YAML with zod, eagerly reads every card and
skill body, and builds each prompt as *role card + skills*, capped at
`prompt.systemPromptCapChars` (8000).

| Role | Job | Tools it may call |
|---|---|---|
| **Atlas** | leader — reads state, plans, dispatches orders, verifies outcomes, writes the final report | read tools + `doctor_scan` |
| **Sage** | writer — drafts and repairs prose | read tools, `doctor_scan`, `create_chapter`, `update_chapter`, `update_outline_beat`, `update_ledger`, `reopen_asset`, `finalize_asset`, `finish` |
| **Nova** | researcher — read-only answers with evidence | read tools only |
| **Prism** | analyst — reviews and certifies | read tools, `doctor_scan`, `review_chapter`, `finalize_chapter`, `settle_chapter`, `update_ledger`, `reopen_asset`, `finalize_asset`, `finish` |
| **Forge** | engineer — hygiene and export | read tools, `doctor_scan`, `export_markdown`, `finish` |

Tools are defined in `src/lib/agent/tool-protocol.ts` and executed in
`src/lib/agent/runtime.ts` (`executeTool`, `runtime.ts:2849`), where a role gate
(`toolAllowedFor`, `runtime.ts:1367`) rejects a call before it has any effect. The full
catalogue (18): `read_novel`, `read_chapter`, `read_outline`, `read_foreshadows`,
`read_promises`, `memory_query`, `doctor_scan`, `update_ledger`, `review_chapter`,
`finalize_chapter`, `settle_chapter`, `export_markdown`, `create_chapter`,
`update_chapter`, `update_outline_beat`, `reopen_asset`, `finalize_asset`, `finish`.

`settle_chapter` is idempotent and stays callable but is **not** load-bearing —
`finalize_chapter` already settles. An agent `reopen_asset` must carry a reason; the
runtime turns it into a visible chat line so an unlock is never silent.

### 5.1 Run lifecycle

1. `POST /api/agent/runs` — validates the goal (3–2000 chars), the mode
   (`approval | full_access`), the model and the thinking level, checks the credit
   balance, then starts the executor out of band (`src/app/api/agent/runs/route.ts:65-113`).
2. The executor claims a **lease** on the run (`leaseOwner` + `leaseEpoch`, renewed every
   10 s — `LEASE_RENEW_MS` in `src/lib/agent/messages.ts:48`) so a second executor can
   never double-write; losing the lease aborts the run without further DB writes
   (`src/lib/agent/runtime.ts:1244-1308`).
3. Atlas plans and emits ` ```team-delegate ` orders; each order becomes an `AgentTask`
   and is executed **sequentially** (`runtime.ts:2071-2129`).
4. A member runs a bounded tool loop (≤ 3 turns, ≤ 3 actions per turn) and must end with
   a ` ```run-report ` block (`agent/skills/shared/output-contract.md`).
5. Writes pause for approval; the approve handler **commits in code** (`decideApproval`,
   `runtime.ts:617-733`), re-checks the final lock at commit time, and the paused
   executor re-verifies the DB instead of trusting the handler.
6. After the write, the runtime verifies it in the database and runs up to 2 repair
   rounds (`runtime.ts:2654-2712`); a task without a verified write is `failed`.
7. The final report compares the model's claimed counters with counters rebuilt from the
   event log (`deriveMeasuredFromEvents`, `runtime.ts:870-925`) and lists every mismatch as
   a blocking issue.

### 5.2 Budgets

Every runtime limit lives in `agent/config/budgets.yaml` (schema + fallback defaults in
`src/lib/novara/content.ts:50-198`): `maxTurns: 3`, `leaderMaxTurns: 22`,
`planMaxTasks: 44`, `chapterContextChars: 24000`, `repairRounds: 2`,
`sedimentWindowChars: 4000` with `sedimentWindowOverlapChars: 800`,
`memory.topK: 14` with `contextBudgetChars: 2600`, `qc.approvalWaitMs: 1800000`,
`prompt.systemPromptCapChars: 8000`. The lease-renewal interval is the exception (code
constant, see above). The file degrades to defaults when invalid; `team.yaml` and
`skills.yaml` are fail-fast.

---

## 6. Data model

`prisma/schema.prisma` — Postgres, **41 models**, no JSON columns (JSON is stored as a
`String`), no enums (statuses are `String` fields with inline comments).

| Area | Models |
|---|---|
| Identity | `User` (auth subject; never written by the app) |
| Novel body | `Novel` · `Chapter` (`draft` / `final`) · `ChapterVersion` · `ChapterReview` |
| Bible | `Character` · `WorldGroup` · `WorldEntry` |
| Outline | `Volume` · `OutlineBeat` |
| Contract | `NovelContract` (+ `Novel.conceptSnapshot`) |
| Ledgers | `Storyline` · `TimelineEntry` · `CharacterArc` · `StoryPromise` · `StoryClue` |
| Memory projection | `ChapterDigest` · `StoryFact` (9 categories) · `CharacterState` · `Foreshadow` |
| Draft area | `ChapterPack` (`material` / `prep`, keyed by chapter index) |
| Agent | `AgentRun` · `AgentTask` · `AgentEvent` · `AgentMessage` · `ContextSummary` · `SkillInvocation` |
| Immutable layer | `AssetVersion` · `AssetTransition` (every reopen/finalize is logged) |
| Usage & credits | `UsageCall` · `UsageProvenance` · `UsageDaily` · `UsageInvoice` · `CreditAccount` · `CreditLedger` |
| Legacy | `TeamAgent` · `TeamConversation` · `TeamMessage` · `TeamTask` · `TeamTaskLog` · `TeamTurnLog` (no route or UI uses them) |

There is **no Subscription model** — plans are display configuration only (§12).

### 6.1 Ownership

`src/lib/db.ts` extends the Prisma client with a query hook that filters **every**
read and write by the caller's identity:

1. a model with a scalar `userId` → filtered by `userId`;
2. a model with a scalar `novelId` → filtered by the caller's novel ids;
3. indirect models (`AgentTask`, `AgentEvent`, `AgentMessage`, `ContextSummary`,
   `SkillInvocation`) → filtered through their run;
4. `User` and `TeamAgent` are exempt (`UNFILTERED_MODELS`);
5. **anything else fails closed** — the query throws
   `ownership: model "<x>" has no ownership rule — refusing to run unfiltered.`

Creates are stamped with the caller's `userId` and require a request identity. A run in a
script or background job uses `withUser(uid, isAdmin, fn)`. Call `await warmIdentity()`
**before** opening an interactive transaction (Neon pooler `connection_limit=1`; an empty
identity cache inside a transaction causes P2028). Never call the model inside a
transaction.

### 6.2 Memory projection (sediment)

`src/lib/novara/sediment.ts` extracts structured lines from a chapter with the model
(`SUMMARY` / `FACT` / `STATE` / `PLANT` / `ADVANCE` / `PAID`) and writes four tables:

| Table | Write rule |
|---|---|
| `ChapterDigest` | upsert by `chapterId` |
| `CharacterState` | delete + recreate per `chapterIndex` |
| `StoryFact` | a re-finalize **replaces** the chapter's own facts: every live fact with `sourceChapter === chapterIndex` is retired, then the chapter's own rows are reused (exact content, or a ≥ 0.45 near-duplicate) instead of inserted again; facts sourced from other chapters are untouched; on top of that facts dedupe on (novelId, category, content) and rot-prone categories are reinforced instead of duplicated |
| `Foreshadow` | dedupe on (content, plantChapter) |

Long chapters are extracted in overlapping, sentence-aligned windows
(`src/lib/novara/sediment-windows.ts`, 4000 chars with 800 chars of overlap) and merged
before the single projection. Promise/clue transitions are forward-only
(`src/lib/novara/open-loops.ts`).

Re-finalizing a chapter therefore **replaces** its facts instead of accumulating them. The
retirement sits inside the same transaction as the status flip
(`src/lib/novara/lifecycle.ts` → `writeSedimentProjection`), so a chapter can never be
final with its old facts retired and its new facts missing; the rows that the extraction
reproduces are un-retired and reused, so the live count does not grow. A reopen never
touches memory; only a finalize writes it.

### 6.3 Memory retrieval

`src/lib/novara/memory.ts` scores the settled pool —
`score = category weight × relevance × recency` — and renders a budgeted prompt block
("STORY MEMORY" + "STORY FAR"), capped at `topK` items and `contextBudgetChars`.
`buildMemoryView` also produces the deterministic doctor findings; `buildMemorySyncReport`
produces the per-chapter sync rows served by `GET /api/novels/[id]/memory/status`, together
with the pool health counters `liveFacts`, `retiredFacts`, `unlinkedFacts`, `duplicateRate`
(the share of live facts that are a ≥ 0.45 near-duplicate of another live fact, compared
within a category) and `factsPerFinalizedChapter`.

---

## 7. HTTP API — complete reference

**46 route files, 63 endpoints** under `src/app/api/**`. Every route except
`GET /api/health` requires a Firebase ID token: `src/middleware.ts` deletes any
client-supplied `x-novara-uid` / `x-novara-admin` headers, verifies the bearer token
against Google's securetoken JWKS (jose `jwtVerify`, audience = project id, issuer =
`https://securetoken.google.com/{pid}`), and re-injects the verified uid. Missing/invalid
token → `401 {"error":"unauthenticated"}`. There is no API-key or machine-credential path
(§12).

**Conventions.** Mutating routes use `parseBody` + a zod schema + `jsonError`
(`src/lib/novara/api-helpers.ts`); shared schemas live in `src/lib/novara/schemas.ts`;
the typed browser client is `src/lib/novara/api.ts`. Ownership comes from the Prisma
extension, never hand-written filters. Routes that change canon state call the gate
helpers (`write-gate.ts`, `lifecycle.ts`) instead of testing `status` inline.

**Common error shapes.**

| Status | Body | Meaning |
|---|---|---|
| 401 | `{"error":"unauthenticated"}` | missing/invalid Firebase token |
| 402 | `insufficient_credits` | credit balance cannot cover the hold |
| 409 | `{"error":"asset_finalized","kind","id","reopen"}` | asset is final; reopen first |
| 409 | `requiresOverwrite` | replacing non-empty prose needs `overwrite: true` |
| 429 | `globally_paused` | global daily credit cap reached (kill-switch) |

### 7.1 Infrastructure (2)

| Method & path | What it does |
|---|---|
| `GET /api` | Scaffold hello-world stub; no product function (removal candidate) |
| `GET /api/health` | **Public.** Liveness + DB probe: `{status, uptimeSeconds, release.commit, runtime, database}`; 200 when the DB answers, 503 when it does not |

### 7.2 Novels (5)

| Method & path | What it does |
|---|---|
| `GET /api/novels` | List the caller's novels |
| `POST /api/novels` | Create a novel (wizard sessionId echoed back when present) |
| `GET /api/novels/[id]` | Full detail payload: novel + chapters (with prose) + bible + outline + contract + ledgers + packs. This is the single read source for the document pane's projections |
| `PATCH /api/novels/[id]` | Update novel metadata; the contract is updated embedded in this route (no separate contract endpoint) |
| `DELETE /api/novels/[id]` | Delete a novel |

### 7.3 Chapters (6)

| Method & path | What it does |
|---|---|
| `POST /api/novels/[id]/chapters` | Create a chapter |
| `PATCH /api/chapters/[id]` | Update title/prose. Replacing non-empty prose requires `overwrite: true`; a final chapter answers 409 |
| `DELETE /api/chapters/[id]` | Delete a chapter; a final chapter answers 409 |
| `GET /api/chapters/[id]/versions` | Chapter version history (max 30 snapshots per chapter) |
| `POST /api/chapters/[id]/review` | Write a `ChapterReview` (append-only). The agent runtime is the intended writer; the gate always reads the latest review |
| `POST /api/chapters/[id]/sediment` | Run the memory projection manually. The intended path is `finalize_chapter`, which projects inside the finalize transaction |

Note: there is **no** `GET /api/chapters/[id]` — chapter prose is read through
`GET /api/novels/[id]`. Word counts are always computed server-side
(`src/lib/novara/words.ts`); client-supplied counts are never trusted.

### 7.4 Bible & outline (17)

All item routes enforce the canon lock (409 when final). Collection routes create;
item routes update/delete.

| Method & path | What it does |
|---|---|
| `POST /api/novels/[id]/characters` | Create a character card |
| `PATCH /api/characters/[id]` | Update a character card |
| `DELETE /api/characters/[id]` | Delete a character card |
| `POST /api/novels/[id]/world-entries` | Create a world entry |
| `PATCH /api/world-entries/[id]` | Update a world entry |
| `DELETE /api/world-entries/[id]` | Delete a world entry |
| `GET /api/novels/[id]/world-groups` | List world groups |
| `POST /api/novels/[id]/world-groups` | Create a world group |
| `PATCH /api/world-groups/[id]` | Update a world group |
| `DELETE /api/world-groups/[id]` | Delete a world group |
| `POST /api/novels/[id]/outline-beats` | Create an outline beat |
| `PATCH /api/outline-beats/[id]` | Update an outline beat |
| `DELETE /api/outline-beats/[id]` | Delete an outline beat |
| `GET /api/novels/[id]/volumes` | List volumes |
| `POST /api/novels/[id]/volumes` | Create a volume |
| `PATCH /api/volumes/[id]` | Update a volume |
| `DELETE /api/volumes/[id]` | Delete a volume |

### 7.5 Ledgers (5)

`kind ∈ storyline, timeline, arc, promise, clue`. The create body is a zod discriminated
union on kind (`schemas.ts`).

| Method & path | What it does |
|---|---|
| `GET /api/novels/[id]/ledger` | Read all five ledger kinds |
| `POST /api/novels/[id]/ledger` | Add a ledger row of the given kind |
| `PATCH /api/ledger/[kind]/[id]` | Update a ledger row |
| `DELETE /api/ledger/[kind]/[id]` | Delete a ledger row |
| `POST /api/ledger/[kind]/[id]/[move]` | Reopen/finalize a ledger row through the lifecycle gate |

### 7.6 Chapter packs (4)

| Method & path | What it does |
|---|---|
| `GET /api/novels/[id]/packs` | List material/prep packs |
| `POST /api/novels/[id]/packs` | Idempotent upsert keyed by chapter index + pack type |
| `PATCH /api/packs/[id]` | Update a pack |
| `DELETE /api/packs/[id]` | Delete a pack |

### 7.7 Asset lifecycle (1)

| Method & path | What it does |
|---|---|
| `POST /api/novels/[id]/[kind]/[assetId]/[move]` | Reopen/finalize any of 7 canon asset kinds through `lifecycle.ts`. Idempotent; every move writes an `AssetTransition`; reopen archives the old version into `AssetVersion`. A reopen never touches memory |

### 7.8 Memory (2, read-only)

| Method & path | What it does |
|---|---|
| `GET /api/novels/[id]/memory` | The memory view: digests, facts, character states, foreshadows + deterministic doctor findings |
| `GET /api/novels/[id]/memory/status` | Pool health counters + per-chapter sync rows (`buildMemorySyncReport`) |

### 7.9 Agent runs (10)

The full run lifecycle is drivable over plain HTTP — no UI-only step.

| Method & path | What it does |
|---|---|
| `POST /api/agent/runs` | Start a run: goal (3–2000 chars), mode (`approval \| full_access`), model, thinking level. Checks credits first: 402 `insufficient_credits`, 429 `globally_paused`. Executor starts out of band (`maxDuration = 90`) |
| `GET /api/agent/runs` | List runs; filters `novelId`, `active \| latest`; `limit` clamped 1–50 |
| `GET /api/agent/runs/[id]` | Run detail: tasks, events, messages, final report (claimed vs measured counters) |
| `GET /api/agent/runs/[id]/events` | SSE snapshot stream (1200 ms interval, 15 s heartbeat). The browser opens it with `fetch()` + bearer token (not `EventSource`) and falls back to 2 s polling (`agent-client.ts:143`) |
| `POST /api/agent/runs/[id]/approve` | Resolve a paused write: `{taskId, decision}`. The handler commits in code, re-checks the final lock, creates the `ChapterVersion`; the paused executor re-verifies the DB |
| `POST /api/agent/runs/[id]/cancel` | Cancel a running run |
| `POST /api/agent/runs/[id]/mode` | Flip approval mode for the next gate |
| `POST /api/agent/runs/[id]/resume` | Crash recovery; a spent turn budget is reconciled from the DB with zero AI calls |
| `GET /api/agent/context-estimate` | Pre-flight context/credit estimate for a planned run |
| `GET /api/agent/qc/evals` | QC evaluation results |

### 7.10 AI surfaces (2)

Both are metered provider calls (credit hold → settle).

| Method & path | What it does |
|---|---|
| `POST /api/ai/wizard` | Generate one creation-wizard section (zod enum of sections); parsed fields validated by `wizard-parse.ts`, never silently dropped |
| `POST /api/ai/draft` | On-demand prose draft assist |

### 7.11 Import / export (3)

| Method & path | What it does |
|---|---|
| `GET /api/novels/[id]/export` | Full JSON backup, schema v2, includes the memory layer |
| `GET /api/novels/[id]/export/markdown` | The manuscript as Markdown |
| `POST /api/import` | Validate a backup and rebuild it as a new novel; all ids regenerated. Integrity validation currently checks only `integrity.chapterCount` and `totalWords` (§12) |

### 7.12 Usage & credits (6)

| Method & path | What it does |
|---|---|
| `GET /api/usage/credits` | Credit balance; admins report unlimited |
| `GET /api/usage/ledger` | Credit ledger entries (period filter) |
| `GET /api/usage/invoice` | Invoice list (fixed cap 20) |
| `POST /api/usage/invoice` | Create an invoice from measured usage |
| `GET /api/usage/statement` | Aggregated usage statement |
| `GET /api/novels/[id]/usage` | Per-novel usage totals |

---

## 8. Setup — building the project from zero

### 8.1 Prerequisites

- **bun** (package manager and script runtime; container base `oven/bun:1.3`)
- **Node 20+**
- A **Postgres** database — Neon recommended (pooled + direct connection strings), any
  Postgres works
- A **Firebase project** with Google sign-in enabled
- At least one **AI provider credential** (see the env table below)

### 8.2 Steps

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env        # then fill in the values in §8.3

# 3. Generate the Prisma client and push the schema (additive)
bun run db:generate
bun run db:push

# 4. Run
bun run dev                 # http://localhost:3000
```

Firebase side (one-time, in the Firebase console):

1. Create a project; note the project id → `NEXT_PUBLIC_FIREBASE_PROJECT_ID`.
2. Authentication → Sign-in method → enable **Google**.
3. Project settings → add a **Web app**; copy the config values into the
   `NEXT_PUBLIC_FIREBASE_*` variables.
4. Authentication → Settings → Authorized domains: add `localhost` and your deployed
   host.

Database side: create the Neon database (or any Postgres), copy the **pooled** URL into
`DATABASE_URL` and the **direct** (non-pooled) URL into `DIRECT_URL`. Prisma declares
both; migrations (`db:migrate:new`) need the direct URL.

**The middleware rejects every API call when `NEXT_PUBLIC_FIREBASE_PROJECT_ID` is
missing** — the app will not function without it.

### 8.3 Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | pooled Postgres connection |
| `DIRECT_URL` | yes | direct (non-pooled) connection — Prisma declares both |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | yes | the middleware rejects every API call without it |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `..._AUTH_DOMAIN`, `..._APP_ID` | yes for sign-in | Firebase web config (public identifiers) |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `..._MESSAGING_SENDER_ID`, `..._MEASUREMENT_ID` | optional | Firebase web config |
| `NEXT_PUBLIC_AI_PROVIDERS_ENABLED` | optional | comma-separated provider allowlist (e.g. `gemini`); without it the allowlist falls back to "provider has a credential" |
| `ADMIN_UIDS` | optional | comma-separated Firebase uids that are admins (unlimited credits, unfiltered reads) |
| `GIT_SHA` | optional | the commit reported by `/api/health` |
| `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_CLOUD_PROJECT` / `GCP_PROJECT_ID` | for gemini | ADC credentials for the Vertex endpoint |
| `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | per provider | provider credentials |
| `CREDITS_DAILY_FREE` | optional | daily credit allowance per user (code default 20) |
| `CREDITS_GLOBAL_DAILY_CAP` | optional | global daily credit cap — above it every non-admin AI call is refused (code default 500) |
| `CREDITS_RESERVE_<SURFACE>` | optional | per-surface hold, e.g. `CREDITS_RESERVE_AGENT_TURN` |
| `GEMINI_WIRE_MODEL_FAST` / `..._PRO` | optional | wire model override |
| `<PROVIDER>_CONTEXT_WINDOW`, `_MAX_OUTPUT_TOKENS`, `_INPUT_USD_PER_1M`, `_OUTPUT_USD_PER_1M` | optional | registry overrides |

`.env.example` still contains notes about a Google-Sign-In implementation and a `z.ai`
gateway that the current code does not use — the table above is the real surface. It also
ships `CREDITS_DAILY_FREE=60` / `CREDITS_GLOBAL_DAILY_CAP=2000`, which override the code
defaults once copied to `.env`.

### 8.4 Credits — how metering works

The anchor rule: **1 credit = $0.001 of measured AI cost**
(`CREDITS_USD_PER_CREDIT`, `src/lib/credits/charge.ts`).

- USD cost = measured tokens × the model's listed price
  (`src/lib/usage/pricing.ts`, `estimateUpperBoundUsd`). Prices come from
  `src/lib/ai/providers/registry.ts`; the cached-input discount is never applied, so the
  figure is an **upper bound** and every rendered dollar string carries an ESTIMATE label.
  A model without a price row renders UNPRICED — never guessed, never $0.
- Credits = `max(1, ceil(usd / 0.001))`; zero measured usage = 0 credits.
- Every provider call goes through `src/lib/ai/chat.ts`: `beginCharge` takes a
  conservative per-surface hold, the call runs, `settleMeasured` replaces the hold with
  the measured cost (surplus refunded). Soft surfaces cap the hold at the balance
  (a funded user is never refused); hard surfaces refuse with `402 insufficient_credits`.
- The global daily cap produces `429 globally_paused`. Admins (`ADMIN_UIDS`) are never
  charged and bypass the kill-switch.
- `bun scripts/check-credit-coverage.ts` fails the build if a provider call can happen
  without a charge path.

### 8.5 Usage retention

`UsageCall` detail rows are kept 90 days and then deleted; their totals survive as
`UsageDaily` buckets forever (`src/lib/usage/retention.ts`). Sweep with
`bun scripts/purge-usage.ts` (not wired to a package.json script).

---

## 9. Commands

```bash
bun run dev              # dev server on :3000
bun run dev:log          # dev server + dev.log
bun run lint             # eslint . (must be green before a commit)
bun run build            # next build  (postbuild assembles the standalone output)
bun run start            # production server from .next/standalone
bun run db:generate      # prisma generate
bun run db:push          # prisma db push (additive)
bun run db:migrate:new   # create + apply a migration (needs DIRECT_URL)
bun run db:check:ownership   # every model has exactly one ownership rule
bun run check:credits        # every provider call has a charge path
bun run verify:auth          # authFetch: token attach, 401 refresh, signed-out
bun run db:prove:ownership   # live multi-user isolation proof (needs a DB)
bun run db:prove:credits     # live credit-concurrency proof (needs a DB)
bun run check:leaks          # credential material in the repo or in git history
bun run check:leaks:site --url https://host   # the same scan against a deployed site
```

Additional checks:

```bash
bun scripts/check-doc-tree.ts         # document-tree invariants (not wired to package.json)
bun scripts/check-editor-roundtrip.ts # markdown byte-roundtrip (uses scripts/fixtures/)
bun run verify:gate                   # approval timeout/reject -> paused -> resumable (audit H2/H3)
```

The historical phase harnesses (verify-stage-a, verify-p2-*, verify-p5-*, p4-*, p5*-*,
stage-b-*) were removed on 2026-11-18 (recycle bin) — one-off development-phase
artifacts, several orphaned or stale. `scripts/` now holds only permanent checks and
build/ops tooling.

Type checking is part of the build: `next.config.ts` deliberately omits the
`typescript.ignoreBuildErrors` escape hatch, so a type error fails `next build`. Run
`npx tsc --noEmit` before claiming a change is done. Run only the checks the project
defines, once each, at the end of a change.

---

## 10. Deployment

**Live path — Cloud Run** (`cloudbuild.run.yaml`, triggered on push to `main`):

1. `lint` — `bun install` + `bun run lint`; a lint error fails the build before any image
   is built (this is the only gate that blocks a deploy today);
2. `build` — docker build of `Dockerfile` (Next standalone output, `agent/` and
   `prisma/schema.prisma` copied in, `GIT_SHA` baked in);
3. `push` — to Artifact Registry;
4. `deploy` — `gcloud run deploy novara --region=asia-southeast1 --allow-unauthenticated`
   (port 3000, concurrency 80, max 3 instances; `NODE_ENV=production`).

Because the service is publicly reachable, **all access control lives in the application
middleware** (§7). The service answers `GET /api/health` with `{status, uptimeSeconds,
release.commit, runtime, database}` — 200 when the database answers, 503 when it does not.

**Legacy path — a VM pipeline** (`cloudbuild.yaml`, `deploy/cloudbuild.v2.yaml`,
`deploy/vm-*.sh`, `deploy/db-backup.sh`, `deploy/Caddyfile.production`) still exists in the
repository, but every script in it is written for SQLite (`DATABASE_URL=file:/data/custom.db`,
`sqlite3 .backup`) while the schema is Postgres. Treat that path as unmaintained until it
is ported; do not copy its database assumptions into new work.

---

## 11. Repository map

```
src/
  app/                      # one page route + the API surface + globals.css
    page.tsx                # the only user-visible route
    api/                    # 46 route files / 63 endpoints (§7)
    globals.css             # Tailwind v4 theme tokens
  components/
    novara/                 # marketing pages, navbar, footer, writer workspace
      writer/               # rail, document tree, document pane, conversation,
                            # composer, chapter editor, creation wizard
    ui/                     # shadcn/ui primitives
  config/                   # subscription-plans.ts (display-only plan metadata)
  hooks/                    # use-writer-store, use-agent-run, use-credits, use-hash-route
  lib/
    agent/                  # runtime, tool protocol, snapshot, wire, context meter
    ai/                     # router, chat choke point, provider adapters, registry
    novara/                 # domain: qc, review, sediment, memory, gates, doc tree…
    credits/ usage/         # credit ledger, usage store, pricing, retention
    auth/ firebase/         # admin whitelist, Firebase client
    db.ts                   # Prisma client + ownership extension
  middleware.ts             # Firebase token verification for every API route
agent/                      # prompt content layer: system cards, skills, budgets
  system/ skills/ config/
prisma/schema.prisma        # 41 Postgres models
scripts/                    # checks, proofs, backfills, standalone assembly
deploy/                     # VM deployment scripts (SQLite-era; unmaintained)
auditskills/                # payment-security-audit.md (audit standard, not code)
```

Design documents at the repository root (proposals, **not implemented** — the code
remains the source of truth): `API开发者开放分类.md` (API openness classification),
`定价体系设计.md` (token→credit→plan mechanics), `定价方案重设计.md` (value-based tier
packaging), `套餐与功能总方案.md` (five-tier plan + feature master plan).

See `AGENTS.md` for the rules an AI agent must follow when changing this code.

---

## 12. Known gaps and not-yet-developed areas

These are facts about the current state, not a roadmap. Grouped by area; nothing here is
implemented unless explicitly marked.

### 12.1 Payments & subscriptions — not developed

- **No payment gateway.** No checkout, no webhook endpoint, no provider SDK anywhere in
  the codebase. `PAYMENT_GATEWAY_STATUS.developed = false`
  (`src/config/subscription-plans.ts`).
- **Plans are display-only.** Free / Creator ($19) / Studio ($49) exist as metadata for
  the plans page; nothing grants, stores, or fakes a subscription state. There is no
  `Subscription` model.
- **No entitlement enforcement.** Plan limits (project counts, core-vs-full agent team,
  export formats, continuity checks) exist only in display copy — no code path enforces
  them.
- **No credit packs / top-ups.** Credits come only from the daily free allowance; there
  is no purchase endpoint and no monthly plan allowance.
- The audit standard for the future gateway lives in
  `auditskills/payment-security-audit.md` (OWASP webhook / gateway / API security).

### 12.2 External developer access — not ready

- **Firebase user tokens are the only credential.** No API keys, PATs, service-account
  tokens, or token-issuance endpoint; an external system cannot obtain a machine
  identity today.
- No OpenAPI/Swagger spec, no third-party API documentation beyond §7.
- No API versioning (`/api/v1`), no request-level rate limiting (credits are a cost gate,
  not an abuse gate), no CORS configuration, no webhooks, no `Idempotency-Key` support.
- `ADMIN_UIDS` is a static env whitelist: an admin can read across all tenants and is
  never charged; there is no per-integration scoping or revocation.

### 12.3 API surface gaps

- **No single-item GET for sub-resources** (chapters, characters, world entries, beats,
  volumes): reads go through the novel detail payload. In particular
  `GET /api/chapters/[id]` does **not** exist.
- `GET /api` is a hello-world scaffold stub.
- ~20 routes have no UI caller (the manual editors for characters, world entries/groups,
  beats, volumes, ledger rows and packs lost their entry point when the artifact pane
  became the document pane; also `chapters/[id]/review`, `chapters/[id]/sediment`,
  `memory/status`, `agent/qc/evals`). They are functional but orphaned.
- Three routes deviate from the `parseBody` + zod convention: `usage/invoice` POST
  hand-rolls `req.json()`, `agent/runs/[id]/resume` parses without zod, and the two
  `[move]` routes use hand-written enum guards.
- Import integrity validation checks only `integrity.chapterCount` and `totalWords` — a
  hand-edited backup with a correct integrity block is not detected.
- Pagination exists only on agent runs (limit 1–50) and invoices (cap 20); novel/chapter
  lists are unpaginated.

### 12.4 Code-level known facts

- The mock agent (`src/lib/novara/mock-agent.ts`) exists as a rollback adapter inside
  `src/lib/novara/agent-client.ts`, but `AGENT_BACKEND` is the hard-coded constant
  `"live"`, so the mock path never executes; the "Mock runtime" banner in the composer
  can never appear.
- The dark palette in `src/app/globals.css` is unreachable: no code adds the `dark`
  class, and the only `next-themes` consumer (`src/components/ui/sonner.tsx`) is never
  imported.
- The `Team*` models still exist in the schema but no route, UI or runtime code uses them.
- `prisma/db/custom.db` and the SQLite-shaped deploy scripts are leftovers from the
  pre-Postgres schema.
- `ai.routeMaxDuration`, `ai.chapterTailChars`, `ai.snapshotFactsLimit` and
  `client.fallbackPollMs` are declared in `budgets.yaml` but never read.
- `.env.example` still carries Chinese comments and a stale z.ai / Google-Sign-In note,
  and ships `CREDITS_DAILY_FREE=60` / `CREDITS_GLOBAL_DAILY_CAP=2000`, overriding the
  code defaults of 20 / 500 (`src/lib/credits/ledger.ts:86,91`) once copied to `.env`.
- `agent/config/budgets.yaml` carries mojibake in its comments;
  `agent/skills/atlas/task-decomposition.md` still tells Atlas to call `settle_chapter`
  although `finalize_chapter` already settles.
- Model prices in `src/lib/ai/providers/registry.ts` are seeded defaults labelled
  UNVERIFIED — they have not been checked against provider pricing pages. Any
  cost/margin computation built on them is an estimate until verified.

### 12.5 Repository hygiene

- A Google OAuth client-secret JSON file and `.env` sit in the working tree root. Verify
  they are excluded from git (`.gitignore`) and never committed; run
  `bun run check:leaks` to scan the repo and its history.
