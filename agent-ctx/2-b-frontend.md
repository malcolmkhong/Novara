# Task 2-b — Frontend: TruthLab (AI Detector & Hallucination Detector)

Agent: 2-b (frontend) · Status: COMPLETED · Lint: PASS · tsc (my files): PASS

## Files created / modified
- `src/components/detector/types.ts` — shared API contracts (AIDetectResponse, HallucinationResponse, GenerateResponse, claim/signal/heuristics interfaces). No `any`.
- `src/components/detector/api.ts` — `postJSON<T>()` helper: relative URLs, guarded JSON parse, network/HTTP errors normalized to thrown `Error` (surfaces `error` field from non-2xx JSON).
- `src/components/detector/score-gauge.tsx` — client SVG circular gauge (stroke-dasharray, rounded linecap, -90° rotation), framer-motion spring counter + animated arc. Exports `scoreTint(value, kind)` shared by both panels. AI thresholds: <40 emerald / 40–64 amber / ≥65 red; Hallucination: <35 / 35–64 / ≥65. `role="img"` + aria-label ("AI likelihood N out of 100").
- `src/components/detector/fade-in.tsx` — client wrapper: fade + 8px rise, 0.25s easeOut, used inside TabsContent.
- `src/components/detector/ai-detector-panel.tsx` — input card (textarea + word/char counts, Clear, AI/Human static ~130-word samples, topic Input + "Generate with GLM" → `/api/generate {mode:'ai-essay'}`, Analyze → `/api/detect/ai`) + results column (Verdict card w/ gauge + verdict badge + GLM confidence + summary + divergence Alert when |aiScore−glmScore|≥25; Signals list w/ severity dots + badges, max-h-96 scroll; Sentence-level blocks w/ colored left border + tinted Progress + notes, max-h-96 scroll; Local heuristics 6-tile grid). Last result kept while editing. Loading: spinner button "Analyzing…" + "GLM is analyzing… (10–30s)".
- `src/components/detector/hallucination-panel.tsx` — RadioGroup mode (open-domain / grounded, selected card highlighted via `has-[[data-state=checked]]`), question Input + "Ask GLM" (`/api/generate {mode:'glm-answer'}`, disabled when empty, spinner), response textarea, conditional source textarea (grounded only), "Check for hallucinations" → `/api/detect/hallucination`. Results: Overview card (gauge + risk badge + summary + "Checked by GLM · mode") and Claims (n) card with per-claim status badge / explanation / confidence Progress, max-h-[520px] scroll; friendly note when 0 claims.
- `src/app/page.tsx` — rewritten: min-h-screen flex flex-col wrapper, main flex-1 with max-w-6xl container, header (ScanSearch icon tile bg-primary, H1 TruthLab, subtitle, outline Badge "Powered by GLM" w/ Zap), Tabs (defaultValue "ai", icon triggers, FadeIn content), sticky footer (mt-auto border-t, safe-area padding).
- `src/app/layout.tsx` — ONLY metadata title/description changed; everything else identical.

## Cross-cutting decisions
- Sticky footer: root `min-h-screen flex flex-col`, `main flex-1`, `footer mt-auto` + `pb-[max(1rem,env(safe-area-inset-bottom))]`.
- Colors: strict no-blue/indigo. emerald-500/600 (good/human/supported/low), amber-500 (mixed/warning/medium), red-500/600 (AI/contradicted/high), zinc via tokens (neutral/uncertain/info). Status badges use tinted `*-50/*-200` + `dark:*-950/*-900` classes so dark mode stays sane. Theme tokens (bg-background, text-muted-foreground, border, card) everywhere else.
- Scrollbars: Tailwind arbitrary-variant `[&::-webkit-scrollbar]` styling (no global CSS, no styled-jsx).
- Buttons: `h-11 sm:h-10` for primary CTAs; aria-labels on icon-only actions; Labels on all inputs.
- Toasts via existing `use-toast`: "Analysis failed" (destructive) for detect calls; "Generation failed" for /api/generate; inline destructive Alert additionally for detect failures.
- Did NOT touch src/app/api/**, globals.css, or any file outside my ownership.

## Verification
- `bun run lint` → clean. `bunx tsc --noEmit` → no errors in my files (remaining errors are in examples/, skills/, and src/app/api/detect/ai/route.ts owned by other agents).
- dev.log: GET / 200, compiled cleanly.

## Notes for next agents
- Backend (task 2-a?) must match contracts in `src/components/detector/types.ts` exactly; non-2xx should preferably return `{success:false,error}` JSON.
- If heuristic fields arrive as 0–1 fractions, tiles auto-render as % via `toPercent`.
