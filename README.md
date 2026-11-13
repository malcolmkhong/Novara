# Novara AI

Novara is an AI novel-writing studio. The database is the source of truth: a novel is a
set of structured records (chapters, bible, outline, ledgers, memory), and a five-role
agent team (Atlas, Sage, Prism, Nova, Forge) reads that state, plans work, writes prose,
reviews it, projects what it learned into memory, and exports the result. The author
keeps the final say: every write either lands in the database immediately or pauses at
an approval gate the author resolves by hand.

The product ships as one Next.js application with two faces — a marketing site and the
writer workbench — behind a single page route, and it runs on Cloud Run against a Neon
Postgres database.

Current state: a preview build. Google sign-in works; payment is not implemented.

---

## 1. Stack

| Layer | Choice | Where |
|---|---|---|
| Framework | Next.js 16.1 (App Router, `output: "standalone"`) | `next.config.ts:4` |
| UI | React 19, Tailwind v4, shadcn/ui (Radix) | `src/app/globals.css`, `src/components/ui/` |
| Client state | Zustand 5 (persisted UI preferences) | `src/hooks/use-writer-store.ts` |
| Database | Postgres (Neon) via Prisma 6.11 | `prisma/schema.prisma:11-15` |
| Auth | Firebase Auth, Google sign-in, ID token verified server-side | `src/lib/firebase/client.ts`, `src/middleware.ts` |
| AI | ZAI-compatible router over 5 provider adapters | `src/lib/ai/router.ts`, `src/lib/ai/providers/` |
| Streaming | Server-Sent Events over the agent run | `src/app/api/agent/runs/[id]/events/route.ts` |
| Markdown | `react-markdown` (one parser, used everywhere) | `src/components/novara/writer/markdown-document.tsx` |
| Package manager / runtime | bun (scripts, container), Node 20+ | `Dockerfile`, `package.json` |

`bun` is the package manager and the container base (`oven/bun:1.3`).

---

## 2. What the system does

### 2.1 The spine: contract → commit → projection → doctor

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

### 2.2 Gates

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

## 3. The writer workbench

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

### 3.1 The document tree

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

## 4. The agent team

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
catalogue: `read_novel`, `read_chapter`, `read_outline`, `read_foreshadows`,
`read_promises`, `memory_query`, `doctor_scan`, `update_ledger`, `review_chapter`,
`finalize_chapter`, `settle_chapter`, `export_markdown`, `create_chapter`,
`update_chapter`, `update_outline_beat`, `reopen_asset`, `finalize_asset`, `finish`.

### 4.1 Run lifecycle

1. `POST /api/agent/runs` — validates the goal (3–2000 chars), the mode
   (`approval | full_access`), the model and the thinking level, checks the credit
   balance, then starts the executor out of band (`src/app/api/agent/runs/route.ts:65-113`).
2. The executor claims a **lease** on the run (`leaseOwner` + `leaseEpoch`, renewed every
   10 s) so a second executor can never double-write; losing the lease aborts the run
   without further DB writes (`src/lib/agent/runtime.ts:1244-1308`).
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

Other run endpoints: `GET /api/agent/runs/[id]` (detail),
`GET /api/agent/runs/[id]/events` (SSE snapshot stream, 1200 ms interval, 15 s heartbeat — the browser opens it with `fetch()` + a bearer token, not `EventSource`, and falls back to 2 s polling if the stream dies, see `src/lib/novara/agent-client.ts:143`),
`POST .../approve`, `POST .../cancel`, `POST .../mode` (flips the mode for the next gate),
`POST .../resume` (crash recovery; a spent turn budget is reconciled from the DB with
zero AI calls).

### 4.2 Magic numbers

Every runtime limit lives in `agent/config/budgets.yaml` (schema + fallback defaults in
`src/lib/novara/content.ts:50-198`), e.g. `maxTurns: 3`, `leaderMaxTurns: 22`,
`planMaxTasks: 44`, `chapterContextChars: 24000`, `repairRounds: 2`,
`sedimentWindowChars: 4000` with `sedimentWindowOverlapChars: 800`,
`memory.topK: 14` with `contextBudgetChars: 2600`, `qc.approvalWaitMs: 1800000`.
The file degrades to defaults when invalid; `team.yaml` and `skills.yaml` are fail-fast.

---

## 5. Data model

`prisma/schema.prisma` — Postgres, 40 models, no JSON columns (JSON is stored as a
`String`).

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

### 5.1 Ownership

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
script or background job uses `withUser(uid, isAdmin, fn)`.

### 5.2 Memory projection (sediment)

`src/lib/novara/sediment.ts` extracts structured lines from a chapter with the model
(`SUMMARY` / `FACT` / `STATE` / `PLANT` / `ADVANCE` / `PAID`) and writes four tables:

| Table | Write rule |
|---|---|
| `ChapterDigest` | upsert by `chapterId` |
| `CharacterState` | delete + recreate per `chapterIndex` |
| `StoryFact` | dedupe on (novelId, category, content); near-duplicates (similarity ≥ 0.45) are merged and the losers retired; rot-prone categories are reinforced instead of duplicated |
| `Foreshadow` | dedupe on (content, plantChapter) |

Long chapters are extracted in overlapping, sentence-aligned windows
(`src/lib/novara/sediment-windows.ts`, 4000 chars with 800 chars of overlap) and merged
before the single projection. Promise/clue transitions are forward-only
(`src/lib/novara/open-loops.ts`).

### 5.3 Memory retrieval

`src/lib/novara/memory.ts` scores the settled pool —
`score = category weight × relevance × recency` — and renders a budgeted prompt block
("STORY MEMORY" + "STORY FAR"), capped at `topK` items and `contextBudgetChars`.
`buildMemoryView` also produces the deterministic doctor findings; `buildMemorySyncReport`
produces the per-chapter sync rows served by `GET /api/novels/[id]/memory/status`.

---

## 6. HTTP API

44 route files under `src/app/api/**`. Every route except `/api/health` is protected by
`src/middleware.ts`: it deletes any client-supplied `x-novara-uid` / `x-novara-admin`,
verifies the Firebase ID token against Google's JWKS, and re-injects the verified uid.

| Area | Routes |
|---|---|
| Novels | `GET/POST /api/novels`, `GET/PATCH/DELETE /api/novels/[id]` |
| Chapters | `POST /api/novels/[id]/chapters`, `GET/PATCH/DELETE /api/chapters/[id]`, `GET /api/chapters/[id]/versions`, `POST /api/chapters/[id]/review`, `POST /api/chapters/[id]/sediment` |
| Bible | `POST /api/novels/[id]/characters`, `.../world-entries`, `.../world-groups`, `.../outline-beats`, `.../volumes` + `PATCH/DELETE /api/{characters,world-entries,world-groups,outline-beats,volumes}/[id]` |
| Ledgers | `GET/POST /api/novels/[id]/ledger`, `PATCH/DELETE /api/ledger/[kind]/[id]` (kind ∈ storyline, timeline, arc, promise, clue) |
| Packs | `GET/POST /api/novels/[id]/packs`, `PATCH/DELETE /api/packs/[id]` |
| Memory | `GET /api/novels/[id]/memory`, `GET /api/novels/[id]/memory/status` |
| Agent | `GET/POST /api/agent/runs`, `GET /api/agent/runs/[id]`, `POST .../approve`, `.../cancel`, `.../mode`, `.../resume`, `GET .../events` (SSE), `GET /api/agent/qc/evals`, `GET /api/agent/context-estimate` |
| AI surfaces | `POST /api/ai/wizard`, `POST /api/ai/draft` |
| Import/export | `GET /api/novels/[id]/export` (JSON backup v2), `GET /api/novels/[id]/export/markdown`, `POST /api/import` |
| Usage | `GET /api/usage/credits`, `GET /api/usage/ledger`, `GET/POST /api/usage/invoice`, `GET /api/usage/statement`, `GET /api/novels/[id]/usage` |
| Infra | `GET /api/health` (public) |

Conventions: `parseBody` + a zod schema + `jsonError`; ownership comes from the Prisma
extension, not from hand-written filters; a route that changes canon state must call
the gate helpers rather than checking status inline.

---

## 7. Setup

```bash
bun install
cp .env.example .env        # then fill in the values below
bun run db:generate         # regenerate the Prisma client
bun run db:push             # push the schema (additive)
bun run dev                 # http://localhost:3000
```

Requirements: bun, Node 20+, a Postgres database (Neon or any Postgres), and a Firebase
project with Google sign-in enabled.

### 7.1 Environment variables

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
| `CREDITS_DAILY_FREE` | optional | daily credit allowance per user (default 20) |
| `CREDITS_GLOBAL_DAILY_CAP` | optional | global daily credit cap — above it every non-admin AI call is refused |
| `CREDITS_RESERVE_<SURFACE>` | optional | per-surface hold, e.g. `CREDITS_RESERVE_AGENT_TURN` |
| `GEMINI_WIRE_MODEL_FAST` / `..._PRO` | optional | wire model override |
| `<PROVIDER>_CONTEXT_WINDOW`, `_MAX_OUTPUT_TOKENS`, `_INPUT_USD_PER_1M`, `_OUTPUT_USD_PER_1M` | optional | registry overrides |

`.env.example` still contains notes about a Google-Sign-In implementation and a
`z.ai` gateway that the current code does not use — the table above is the real surface.

### 7.2 Credits

Every provider call is metered: `src/lib/ai/chat.ts` takes a hold (`beginCharge`),
calls the provider, then settles it against measured usage (`settleMeasured`). A call
without enough balance is refused with `402 insufficient_credits`; the global daily cap
produces `429 globally_paused`. Admins are never charged (`ADMIN_UIDS`).
`bun scripts/check-credit-coverage.ts` fails the build if a provider call can happen
without a charge path.

### 7.3 Usage retention

`UsageCall` detail rows are kept 90 days and then deleted; their totals survive as
`UsageDaily` buckets forever (`src/lib/usage/retention.ts`). Sweep with
`bun scripts/purge-usage.ts` (not wired to a package.json script).

---

## 8. Commands

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
```

Additional checks (not wired to `package.json`):

```bash
bun scripts/check-doc-tree.ts   # document-tree invariants
bun scripts/verify-stage-a.ts    # lease / fencing / sequencing
bun scripts/verify-p2-a.ts       # compaction groundwork (inert by design)
bun scripts/verify-p2-b.ts       # context compaction wire equivalence
bun scripts/verify-p2-c.ts       # compaction markers and idempotence
bun scripts/verify-p5-e1.ts      # guarded failure flip / lease fencing
bun scripts/verify-p5-f.ts       # usage retention, rollup, purge, CSV statement
```

Type checking is part of the build: `next.config.ts` deliberately omits the
`typescript.ignoreBuildErrors` escape hatch, so a type error fails `next build`.

---

## 9. Deployment

**Live path — Cloud Run** (`cloudbuild.run.yaml`, triggered on push to `main`):

1. `lint` — `bun install` + `bun run lint`; a lint error fails the build before any image
   is built;
2. `build` — docker build of `Dockerfile` (Next standalone output, `agent/` and
   `prisma/schema.prisma` copied in, `GIT_SHA` baked in);
3. `push` — to Artifact Registry;
4. `deploy` — `gcloud run deploy novara --region=asia-southeast1 --allow-unauthenticated`.

The service answers `GET /api/health` with `{status, uptimeSeconds, release.commit,
runtime, database}` — 200 when the database answers, 503 when it does not.

**Legacy path — a VM pipeline** (`cloudbuild.yaml`, `deploy/cloudbuild.v2.yaml`,
`deploy/vm-*.sh`, `deploy/db-backup.sh`, `deploy/Caddyfile.production`) still exists in the
repository, but every script in it is written for SQLite (`DATABASE_URL=file:/data/custom.db`,
`sqlite3 .backup`) while the schema is Postgres. Treat that path as unmaintained until it
is ported; do not copy its database assumptions into new work.

---

## 10. Known gaps in the current implementation

These are facts about the code, not a roadmap:

- The mock agent (`src/lib/novara/mock-agent.ts`) exists as a rollback adapter inside
  `src/lib/novara/agent-client.ts`, but `AGENT_BACKEND` is the hard-coded constant `"live"`, so the mock path never executes; the "Mock runtime" banner in the composer can never
  appear.
- The dark palette in `src/app/globals.css` is unreachable: no code adds the `dark`
  class, and the only `next-themes` consumer (`src/components/ui/sonner.tsx`) is never
  imported.
- The `Team*` models still exist in the schema but no route, UI or runtime code uses them.
- `prisma/db/custom.db` and the SQLite-shaped deploy scripts are leftovers from the
  pre-Postgres schema.
- Several `src/lib/novara/api.ts` client helpers and API routes have no caller in the UI
  (the manual editors for characters, world entries, beats, volumes, ledger rows and packs
  lost their entry point when the artifact pane was replaced by the document pane).
- `ai.routeMaxDuration`, `ai.chapterTailChars`, `ai.snapshotFactsLimit` and
  `client.fallbackPollMs` are declared in `budgets.yaml` but never read.
- `.env.example` still carries Chinese comments and a stale z.ai / Google-Sign-In note,
  and it ships `CREDITS_DAILY_FREE=60` / `CREDITS_GLOBAL_DAILY_CAP=2000`, which override
  the code defaults of 20 / 500 (`src/lib/credits/ledger.ts:86,91`) once the file is
  copied to `.env`.
- `agent/config/budgets.yaml` carries mojibake in its comments; `agent/skills/atlas/task-decomposition.md`
  still tells Atlas to call `settle_chapter` although `finalize_chapter` already settles.

---

## 11. Repository map

```
src/
  app/                      # one page route + the API surface + globals.css
    page.tsx                # the only user-visible route
    api/                    # 44 route files
    globals.css             # Tailwind v4 theme tokens
  components/
    novara/                 # marketing pages, navbar, footer, writer workspace
      writer/               # rail, document tree, document pane, conversation, composer
    ui/                     # shadcn/ui primitives
  hooks/                    # use-writer-store, use-agent-run, use-credits, use-hash-route
  lib/
    agent/                  # runtime, tool protocol, snapshot, wire, context meter
    ai/                     # router, chat choke point, provider adapters, registry
    novara/                 # domain: qc, review, sediment, memory, gates, doc tree…
    credits/ usage/         # credit ledger, usage store, pricing, retention
    db.ts                   # Prisma client + ownership extension
    middleware.ts → src/middleware.ts
agent/                      # prompt content layer: system cards, skills, budgets
  system/ skills/ config/
prisma/schema.prisma        # 40 Postgres models
scripts/                    # checks, proofs, backfills, standalone assembly
deploy/                     # VM deployment scripts (SQLite-era; unmaintained)
```

See `AGENTS.md` for the rules an AI agent must follow when changing this code.
