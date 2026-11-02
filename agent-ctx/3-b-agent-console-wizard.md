# Task 3-b — Agent Console + Create Wizard (work record)

Agent: task 3-b (Novara AI Writer UI foundation)

## Files created
1. `src/components/novara/writer/agent-console.tsx`
   - `AgentConsole({ novel }: { novel: NovelMeta })` — runtime view for the AI Team tab.
   - Consumes `useAgentRun(novel.id)` + `useWriterStore` (lastMode/setLastMode).
   - Amber honesty banner when `AGENT_BACKEND === "mock"` (uses `AGENT_BACKEND_LABEL`).
   - Goal composer with ModeSwitch (local mode initialized from `lastMode`, synced to store) + "Run team" (Sparkles, disabled < 3 chars or submitting); destructive toast "Could not start run" on error; textarea cleared on success.
   - Finished runs ("Last run" card: goal + status badge) stay visible above the composer; Final report card (reported → verified per key, emerald check when all match, rose AlertTriangle list for blockingIssues, mock note).
   - Active run header: goal quote, RUN_STATUS_META badge, mode chip (ShieldCheck Approval / Zap Full access), inline ModeSwitch (disabled while awaiting_approval, wired to `run.setMode`), Cancel run (aria-label) with toast on error.
   - Grid `lg:grid-cols-[1fr_340px]`: TaskBoard(tasks, runStatus) | ActivityStream(events).
   - Approval gate: amber PauseCircle inline notice above grid + ApprovalDialog(request, onApprove, onReject, busy=approving local state).
2. `src/components/novara/writer/create-wizard.tsx`
   - `CreateWizard({ open, onOpenChange, onFinish })`, 4-step stepper (Concept / Story foundation / World & cast / Outline), emerald check done, primary ring current.
   - "Generate (mock)" per step: 900 ms delay, Loader2 spinner, canned templates in the demo universe (convenience store where customers trade years of life; Mara the night clerk); templates incorporate already-typed text; fields editable after fill.
   - Footer Back/Next (per-step main-field validation) / "Create novel" assembles `CreateNovelInput` (title derived from premise/logline ≤ 60 chars, fallback "Untitled novel"; synopsis = premise + characters + beats; targetWords 100000) → awaits `onFinish`; true closes + resets (also resets on open), false stays open.
   - Muted note: "Mock generation — wiring the real GLM pipeline is Phase 2."

## Integration notes
- Sibling imports resolved and verified against actual signatures: TaskBoard({tasks, runStatus}), ActivityStream({events, className?}), ApprovalDialog({request, onApprove, onReject, busy?}), ModeSwitch({mode, onChange, disabled?}).
- Lint: `bun run lint` clean (zero errors/warnings project-wide).
- Deviations: final-report note uses `text-muted-foreground` (spec's "text-muted-footer" is not a real Tailwind class); ApprovalDialog reject toast titled "Could not record rejection"; CreateWizard catches `onFinish` rejections with a destructive toast defensively.
