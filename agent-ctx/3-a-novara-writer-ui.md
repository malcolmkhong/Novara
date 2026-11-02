# Task 3-a — Novara AI Writer UI foundation (4 presentational components)

Agent: 3-a (writer UI) · Status: COMPLETED · Lint: PASS · tsc (my files): PASS

## Files created (new only; nothing modified)
- `src/components/novara/writer/task-board.tsx` — `TaskBoard({ tasks, runStatus })`. Card w/ ClipboardList + "Todos" + count Badge. Rows sorted by `order`; status icon map (Circle / Loader2+spin / PauseCircle amber-600 / CheckCircle2 emerald-600 / XCircle rose-600 / Ban), mono `key`, title, `detail` line-clamp-2, outline artifact Badge at row end; row highlight via `TASK_STATUS_META[status].rowClass`. Parallel rows get `ml-4 border-l-2 pl-3` + per-status rail color; rail turns amber for any group containing a `needs_approval` sibling. `runStatus === "awaiting_approval"` renders amber Hand banner. Empty state handled.
- `src/components/novara/writer/activity-stream.tsx` — `ActivityStream({ events, className })`. Card w/ Activity icon + count; ScrollArea `max-h-72`, events sorted oldest→newest, bottom-anchor ref + useEffect `scrollIntoView({block:"nearest"})`; per-kind icon map, error kind rose-600, right-aligned HH:MM:SS `<time>` (hour12:false, invalid date → "--:--:--"), rows `border-b last:border-0 py-1.5`; `role="log" aria-live="polite"`; empty state; className merged onto Card via cn().
- `src/components/novara/writer/approval-dialog.tsx` — `ApprovalDialog({ request, onApprove, onReject, busy })`. Controlled `open={request !== null}`, `onOpenChange={() => {}}` (gate cannot be dismissed; passed `showCloseButton={false}` to hide the dead X). Title + amber ShieldCheck, "Will write to" section (targetLabel font-medium + `~N words` outline Badge when wordCount != null), summary as DialogDescription (text-sm muted), amber Info note, footer outline Reject + default Approve (Loader2 when busy). Body guarded `request && …` for null safety.
- `src/components/novara/writer/mode-switch.tsx` — `ModeSwitch({ mode, onChange, disabled })`. `inline-flex rounded-lg border p-1 gap-1` group, ghost size-sm Buttons; selected `bg-primary text-primary-foreground` (+ hover pin overrides so ghost hover can't unselect the tint), unselected `text-muted-foreground hover:bg-accent`; aria-pressed; per-mode 11px hint line. No blue/indigo anywhere.

## Verification
- `bun run lint` → clean, zero output. `bunx tsc --noEmit` → no errors originating in my 4 files. dev.log compiled cleanly.
- All lucide icon names probed against installed lucide-react (PauseCircle/CheckCircle2/XCircle/AlertTriangle aliases confirmed exported).

## Notes for next agents
- Parents render `ApprovalDialog` with the `pendingApproval` from `AgentRunDetail`; wire onApprove/onReject + busy state there.
- `TaskBoard`/`ActivityStream` are pure presentational — feed from `AgentRunDetail.tasks` / `.events`; both sort defensively so API ordering is not trusted.
- Tailwind-merge caveat honored: CardHeader needs explicit `flex` class to override its default `grid`.
