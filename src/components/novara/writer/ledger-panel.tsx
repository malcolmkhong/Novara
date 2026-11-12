"use client";

// ---------------------------------------------------------------------------
// Novara AI — Ledger tab (Phase 8). The five 账本 ledgers moved OUT of the
// Memory tab into their own information zone:
//
//   故事线 storylines · 时间线 timeline · 人物弧线 character arcs  (Phase 7 P1)
//   承诺 promises · 线索 clues                                    (Phase 8)
//
// Plan-level truth the author curates by hand — unlike the sediment memory,
// these rows are written directly and read into every AI writing context.
// Extracted from the former memory-panel LedgerCard and extended with the
// promise/clue ledger kinds (账本/承诺.md + 账本/线索.md analogs).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useWriterStore } from "@/hooks/use-writer-store";
import { cn } from "@/lib/utils";
import {
  addLedgerRow,
  deleteLedgerRow,
  getLedger,
  updateLedgerRow,
  type LedgerKind,
} from "@/lib/novara/api";
import type {
  CharacterArcDTO,
  ClueStatus,
  PromiseStatus,
  StorylineDTO,
  StorylineStatus,
  TimelineEntryDTO,
} from "@/lib/novara/types";
import { CanonLockButton } from "./bible-panels";
import { ConfirmDialog } from "./ui-bits";

const SCROLL_LIST =
  "max-h-[320px] overflow-y-auto pr-1 nice-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

const STORYLINE_STATUS_META: Record<
  StorylineStatus,
  { label: string; className: string }
> = {
  active: { label: "active", className: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  dormant: { label: "dormant", className: "border-amber-300 bg-amber-50 text-amber-700" },
  resolved: { label: "resolved", className: "text-muted-foreground" },
};

const STORYLINE_CYCLE: Record<StorylineStatus, StorylineStatus> = {
  active: "dormant",
  dormant: "resolved",
  resolved: "active",
};

const PROMISE_STATUS_META: Record<PromiseStatus, { label: string; className: string }> = {
  open: { label: "open", className: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  advanced: { label: "advanced", className: "border-amber-300 bg-amber-50 text-amber-700" },
  fulfilled: { label: "fulfilled", className: "text-muted-foreground" },
  broken: { label: "broken", className: "border-rose-300 bg-rose-50 text-rose-700" },
};

const CLUE_STATUS_META: Record<ClueStatus, { label: string; className: string }> = {
  planted: { label: "planted", className: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  surfaced: { label: "surfaced", className: "border-amber-300 bg-amber-50 text-amber-700" },
  revealed: { label: "revealed", className: "text-muted-foreground" },
};

// ---------------------------------------------------------------------------
// Canon lock (定稿锁, Phase 9) — storyline/promise/clue carry `lock`;
// timeline/arc carry `status`. Shared with the bible panels.
// ---------------------------------------------------------------------------

const LEDGER_KINDS: LedgerKind[] = ["storyline", "timeline", "arc", "promise", "clue"];

/** Which canon field does this ledger kind use? */
function isLockKind(kind: LedgerKind): boolean {
  return kind === "storyline" || kind === "promise" || kind === "clue";
}

function rowLocked(kind: LedgerKind, row: { lock?: string; status?: string }): boolean {
  return (isLockKind(kind) ? row.lock : row.status) === "final";
}

const REOPEN_ARCHIVE_NOTE =
  "The original is archived to version history, then returned to draft so it can be edited again.";

/**
 * Inline add/edit form model. `chapter` covers timeline/arcs; `numA`/`numB`
 * cover the promise (made/due) and clue (plant/reveal) chapter pairs.
 */
interface LedgerFormFields {
  primary: string;
  secondary: string;
  chapter: string;
  status: string;
  numA: string;
  numB: string;
}

type LedgerFormState =
  | ({ kind: LedgerKind; mode: "add"; id: null } & LedgerFormFields)
  | ({ kind: LedgerKind; mode: "edit"; id: string } & LedgerFormFields);

const EMPTY_FIELDS: LedgerFormFields = {
  primary: "",
  secondary: "",
  chapter: "",
  status: "",
  numA: "",
  numB: "",
};

/** Ledger section tabs: 全部 keeps the stacked five-section view. */
type LedgerTab = LedgerKind | "all";

const LEDGER_TABS: { value: LedgerTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "storyline", label: "Storylines" },
  { value: "timeline", label: "Timeline" },
  { value: "arc", label: "Character arcs" },
  { value: "promise", label: "Promises" },
  { value: "clue", label: "Clues" },
];

// ---------------------------------------------------------------------------
// LedgerPanel
// ---------------------------------------------------------------------------

export function LedgerPanel({
  novelId,
  onRefresh,
}: {
  novelId: string;
  /**
   * STEP 65 — the shell's refresh(). Called after a successful write so the
   * rail's 账本 sub-counts (computed from the NovelDetail snapshot) pick the
   * new rows up instead of staying stale until an unrelated refresh.
   */
  onRefresh?: () => Promise<void>;
}) {
  const [ledger, setLedger] = useState<Awaited<ReturnType<typeof getLedger>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<LedgerFormState | null>(null);
  const [deleting, setDeleting] = useState<{
    kind: LedgerKind;
    id: string;
    label: string;
    locked?: boolean;
  } | null>(null);

  // Section tab (全部 keeps the stacked five-section view). The asset tree can
  // deep-link a kind by writing `ledgerKindByNovel[novelId]` in the writer
  // store — read defensively so this panel also typechecks before the store
  // task lands; the fields are consumed verbatim once they exist.
  const focusKind = useWriterStore((s) =>
    (s as { ledgerKindByNovel?: Record<string, string | null> }).ledgerKindByNovel?.[
      novelId
    ] ?? null
  );
  const setLedgerKind = useWriterStore((s) =>
    (
      s as { setLedgerKind?: (novelId: string, kind: string | null) => void }
    ).setLedgerKind
  );
  const [activeTab, setActiveTab] = useState<LedgerTab>("all");

  // Tree deep-link: preselect the focus kind on mount and re-apply on later
  // changes while the panel stays mounted.
  useEffect(() => {
    if (focusKind && (LEDGER_KINDS as string[]).includes(focusKind)) {
      setActiveTab(focusKind as LedgerKind);
    }
  }, [focusKind]);

  const selectTab = useCallback(
    (tab: LedgerTab) => {
      setActiveTab(tab);
      setLedgerKind?.(novelId, tab === "all" ? null : tab);
    },
    [novelId, setLedgerKind]
  );

  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLedger(await getLedger(novelId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs a mutation, then re-fetches so the view stays honest. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setActionError(null);
      try {
        await fn();
        await load();
        // STEP 65 — the rail's 账本 counts come from the NovelDetail
        // snapshot; without this the count stayed stale after a write.
        await onRefresh?.();
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setActionError(msg);
        toast({
          title: "Action failed",
          description: msg,
          variant: "destructive",
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, onRefresh, toast]
  );

  /**
   * Canon lock toggle for one ledger row. storyline/promise/clue canon rides
   * `lock`; timeline/arc rides `status` (see LedgerUpdatePatch).
   */
  const setRowLock = useCallback(
    async (kind: LedgerKind, id: string, final: boolean) => {
      await mutate(() => {
        if (kind === "storyline")
          return updateLedgerRow("storyline", id, final ? { lock: "final" } : { reopen: true });
        if (kind === "promise")
          return updateLedgerRow("promise", id, final ? { lock: "final" } : { reopen: true });
        if (kind === "clue")
          return updateLedgerRow("clue", id, final ? { lock: "final" } : { reopen: true });
        if (kind === "timeline")
          return updateLedgerRow("timeline", id, final ? { status: "final" } : { reopen: true });
        return updateLedgerRow("arc", id, final ? { status: "final" } : { reopen: true });
      });
    },
    [mutate]
  );

  const patchForm = useCallback((patch: Partial<LedgerFormFields>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const openAdd = useCallback((kind: LedgerKind) => {
    setForm({ kind, mode: "add", id: null, ...EMPTY_FIELDS });
  }, []);

  const openEdit = useCallback(
    (kind: LedgerKind, row: TimelineEntryDTO | CharacterArcDTO | StorylineDTO | { id: string; content?: string; status?: string; label?: string; detail?: string; characterName?: string; note?: string; chapterIndex?: number | null; madeChapter?: number | null; dueChapter?: number | null; plantChapter?: number | null; revealChapter?: number | null; name?: string; summary?: string }) => {
      const base: LedgerFormFields = { ...EMPTY_FIELDS };
      if (kind === "storyline") {
        const r = row as StorylineDTO;
        setForm({ kind, mode: "edit", id: r.id, ...base, primary: r.name, secondary: r.summary, status: r.status });
      } else if (kind === "timeline") {
        const r = row as TimelineEntryDTO;
        setForm({ kind, mode: "edit", id: r.id, ...base, primary: r.label, secondary: r.detail, chapter: r.chapterIndex != null ? String(r.chapterIndex) : "" });
      } else if (kind === "arc") {
        const r = row as CharacterArcDTO;
        setForm({ kind, mode: "edit", id: r.id, ...base, primary: r.characterName, secondary: r.note, chapter: r.chapterIndex != null ? String(r.chapterIndex) : "" });
      } else if (kind === "promise") {
        const r = row as { id: string; content: string; status: PromiseStatus; madeChapter: number | null; dueChapter: number | null };
        setForm({ kind, mode: "edit", id: r.id, ...base, primary: r.content, status: r.status, numA: r.madeChapter != null ? String(r.madeChapter) : "", numB: r.dueChapter != null ? String(r.dueChapter) : "" });
      } else {
        const r = row as { id: string; content: string; status: ClueStatus; plantChapter: number | null; revealChapter: number | null };
        setForm({ kind, mode: "edit", id: r.id, ...base, primary: r.content, status: r.status, numA: r.plantChapter != null ? String(r.plantChapter) : "", numB: r.revealChapter != null ? String(r.revealChapter) : "" });
      }
    },
    []
  );

  const submitForm = useCallback(async () => {
    if (!form) return;
    const target = form;
    const primary = target.primary.trim();
    const secondary = target.secondary.trim();
    const num = (raw: string) => {
      const t = raw.trim();
      return t === "" ? null : Number(t);
    };
    const chapter = num(target.chapter);
    const numA = num(target.numA);
    const numB = num(target.numB);
    const ok = await mutate(async () => {
      if (target.kind === "storyline") {
        if (target.mode === "add") {
          await addLedgerRow(novelId, "storyline", { name: primary, summary: secondary || undefined });
        } else {
          await updateLedgerRow("storyline", target.id, { name: primary, summary: secondary });
        }
      } else if (target.kind === "timeline") {
        const data = { label: primary, detail: secondary, chapterIndex: chapter };
        if (target.mode === "add") await addLedgerRow(novelId, "timeline", data);
        else await updateLedgerRow("timeline", target.id, data);
      } else if (target.kind === "arc") {
        const data = { characterName: primary, note: secondary, chapterIndex: chapter };
        if (target.mode === "add") await addLedgerRow(novelId, "arc", data);
        else await updateLedgerRow("arc", target.id, data);
      } else if (target.kind === "promise") {
        const data = {
          content: primary,
          ...(target.status ? { status: target.status as PromiseStatus } : {}),
          madeChapter: numA,
          dueChapter: numB,
        };
        if (target.mode === "add") await addLedgerRow(novelId, "promise", data);
        else await updateLedgerRow("promise", target.id, data);
      } else {
        const data = {
          content: primary,
          ...(target.status ? { status: target.status as ClueStatus } : {}),
          plantChapter: numA,
          revealChapter: numB,
        };
        if (target.mode === "add") await addLedgerRow(novelId, "clue", data);
        else await updateLedgerRow("clue", target.id, data);
      }
    });
    if (ok) setForm(null);
  }, [form, mutate, novelId]);

  const cycleStatus = useCallback(
    (row: StorylineDTO) => {
      void mutate(() =>
        updateLedgerRow("storyline", row.id, { status: STORYLINE_CYCLE[row.status] })
      );
    },
    [mutate]
  );

  const storylines = ledger?.storylines ?? [];
  const timeline = useMemo(
    () => [...(ledger?.timeline ?? [])].sort((a, b) => a.order - b.order),
    [ledger]
  );
  const arcGroups = useMemo(() => {
    const groups = new Map<string, CharacterArcDTO[]>();
    for (const arc of [...(ledger?.arcs ?? [])].sort((a, b) => a.order - b.order)) {
      const stages = groups.get(arc.characterName);
      if (stages) stages.push(arc);
      else groups.set(arc.characterName, [arc]);
    }
    return Array.from(groups.entries()).map(([name, stages]) => ({ name, stages }));
  }, [ledger]);
  const promises = ledger?.promises ?? [];
  const clues = ledger?.clues ?? [];

  const formEl = form ? (
    <LedgerRowForm
      kind={form.kind}
      mode={form.mode}
      fields={form}
      busy={busy}
      onFieldsChange={patchForm}
      onSubmit={() => void submitForm()}
      onCancel={() => setForm(null)}
    />
  ) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-base">Ledger</CardTitle>
        <CardDescription>
          Plan-level truth you curate — storylines, timeline, character arcs,
          promises and clues. Read into every AI writing context.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Ledger sections">
          {LEDGER_TABS.map((t) => (
            <Button
              key={t.value}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2.5 text-xs",
                activeTab === t.value && "bg-primary/10 font-medium text-primary"
              )}
              aria-pressed={activeTab === t.value}
              onClick={() => selectTab(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {loading && !ledger && (
          <div className="space-y-2" aria-busy="true" aria-label="Loading ledger">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        )}

        {ledger && (
          <>
            {error && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                <span>Could not load ledger: {error}</span>
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  Retry
                </Button>
              </div>
            )}

            {actionError && (
              <p role="alert" className="text-xs text-rose-600">
                Ledger action failed: {actionError}
              </p>
            )}

            <div className="divide-y">
              {/* Storylines · 故事线 */}
              {(activeTab === "all" || activeTab === "storyline") && (
              <section aria-label="Storylines" className="space-y-2 pb-4">
                <SectionHeader
                  title="Storylines"
                  addLabel="Add storyline"
                  onAdd={() => openAdd("storyline")}
                />
                {form?.kind === "storyline" && form.mode === "add" && formEl}
                {storylines.length > 0 ? (
                  <ul className={SCROLL_LIST} aria-label="Storylines">
                    {storylines.map((row) =>
                      form?.kind === "storyline" && form.mode === "edit" && form.id === row.id ? (
                        <li key={row.id} className="border-b py-2 last:border-0">
                          {formEl}
                        </li>
                      ) : (
                        <li key={row.id} className="flex items-start gap-2 border-b py-2 last:border-0">
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn("h-8 shrink-0 px-2 text-[11px]", STORYLINE_STATUS_META[row.status].className)}
                            onClick={() => cycleStatus(row)}
                            disabled={busy || rowLocked("storyline", row)}
                            aria-label={`Storyline “${row.name}” is ${row.status} — click to mark ${STORYLINE_CYCLE[row.status]}`}
                            title={rowLocked("storyline", row) ? "Locked — Unlock to change status" : `Click to mark ${STORYLINE_CYCLE[row.status]}`}
                          >
                            {STORYLINE_STATUS_META[row.status].label}
                          </Button>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{row.name}</p>
                            {row.summary && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{row.summary}</p>
                            )}
                          </div>
                          <CanonLockButton
                            locked={rowLocked("storyline", row)}
                            busy={busy}
                            onFinalize={() => void setRowLock("storyline", row.id, true)}
                            onReopen={() => void setRowLock("storyline", row.id, false)}
                          />
                          <RowActions
                            onEdit={() => openEdit("storyline", row)}
                            onDelete={() =>
                              setDeleting({
                                kind: "storyline",
                                id: row.id,
                                label: row.name,
                                locked: rowLocked("storyline", row),
                              })
                            }
                            editDisabled={rowLocked("storyline", row)}
                            editLabel={`Edit storyline ${row.name}`}
                            deleteLabel={`Delete storyline ${row.name}`}
                          />
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No storylines yet — add the plotlines you are tracking.
                  </p>
                )}
              </section>
              )}

              {/* Timeline · 时间线 */}
              {(activeTab === "all" || activeTab === "timeline") && (
              <section aria-label="Timeline" className="space-y-2 py-4">
                <SectionHeader
                  title="Timeline"
                  addLabel="Add event"
                  onAdd={() => openAdd("timeline")}
                />
                {form?.kind === "timeline" && form.mode === "add" && formEl}
                {timeline.length > 0 ? (
                  <ul className={SCROLL_LIST} aria-label="Timeline events">
                    {timeline.map((row) =>
                      form?.kind === "timeline" && form.mode === "edit" && form.id === row.id ? (
                        <li key={row.id} className="border-b py-2 last:border-0">
                          {formEl}
                        </li>
                      ) : (
                        <li key={row.id} className="flex items-start gap-2 border-b py-2 last:border-0">
                          <span className="mt-1 w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                            {row.order}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-sm font-medium">{row.label}</p>
                              {row.chapterIndex != null && (
                                <Badge variant="outline" className="shrink-0 text-[11px] text-muted-foreground">
                                  ch. {row.chapterIndex}
                                </Badge>
                              )}
                            </div>
                            {row.detail && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
                            )}
                          </div>
                          <CanonLockButton
                            locked={rowLocked("timeline", row)}
                            busy={busy}
                            onFinalize={() => void setRowLock("timeline", row.id, true)}
                            onReopen={() => void setRowLock("timeline", row.id, false)}
                          />
                          <RowActions
                            onEdit={() => openEdit("timeline", row)}
                            onDelete={() =>
                              setDeleting({
                                kind: "timeline",
                                id: row.id,
                                label: row.label,
                                locked: rowLocked("timeline", row),
                              })
                            }
                            editDisabled={rowLocked("timeline", row)}
                            editLabel={`Edit timeline event ${row.label}`}
                            deleteLabel={`Delete timeline event ${row.label}`}
                          />
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No timeline events yet — record the key beats in reading order.
                  </p>
                )}
              </section>
              )}

              {/* Character arcs · 人物弧线 */}
              {(activeTab === "all" || activeTab === "arc") && (
              <section aria-label="Character arcs" className="space-y-2 py-4">
                <SectionHeader
                  title="Character arcs"
                  addLabel="Add stage"
                  onAdd={() => openAdd("arc")}
                />
                {form?.kind === "arc" && form.mode === "add" && formEl}
                {arcGroups.length > 0 ? (
                  <ul className={cn(SCROLL_LIST, "space-y-3")} aria-label="Character arcs">
                    {arcGroups.map((group) => (
                      <li key={group.name} className="border-b pb-2 last:border-0">
                        <p className="text-sm font-medium">{group.name}</p>
                        <ul className="mt-1" aria-label={`Arc stages for ${group.name}`}>
                          {group.stages.map((stage, index) =>
                            form?.kind === "arc" && form.mode === "edit" && form.id === stage.id ? (
                              <li key={stage.id} className="py-1.5">
                                {formEl}
                              </li>
                            ) : (
                              <li key={stage.id} className="flex items-start gap-2 py-1.5">
                                <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">
                                  {index + 1}.
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <p className="text-sm">{stage.note}</p>
                                    {stage.chapterIndex != null && (
                                      <Badge variant="outline" className="shrink-0 text-[11px] text-muted-foreground">
                                        ch. {stage.chapterIndex}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <CanonLockButton
                                  locked={rowLocked("arc", stage)}
                                  busy={busy}
                                  onFinalize={() => void setRowLock("arc", stage.id, true)}
                                  onReopen={() => void setRowLock("arc", stage.id, false)}
                                />
                                <RowActions
                                  onEdit={() => openEdit("arc", stage)}
                                  onDelete={() =>
                                    setDeleting({
                                      kind: "arc",
                                      id: stage.id,
                                      label: stage.characterName,
                                      locked: rowLocked("arc", stage),
                                    })
                                  }
                                  editDisabled={rowLocked("arc", stage)}
                                  editLabel={`Edit arc stage for ${stage.characterName}`}
                                  deleteLabel={`Delete arc stage for ${stage.characterName}`}
                                />
                              </li>
                            )
                          )}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No character arc stages yet — capture how each character changes.
                  </p>
                )}
              </section>
              )}

              {/* Promises · 承诺 (Phase 8) */}
              {(activeTab === "all" || activeTab === "promise") && (
              <section aria-label="Promises" className="space-y-2 py-4">
                <SectionHeader
                  title="Promises"
                  addLabel="Add promise"
                  onAdd={() => openAdd("promise")}
                />
                <p className="text-[11px] text-muted-foreground">
                  Promises made to the reader (Ledger/Promises.md) — the agent checks
                  these before finalizing a chapter.
                </p>
                {form?.kind === "promise" && form.mode === "add" && formEl}
                {promises.length > 0 ? (
                  <ul className={SCROLL_LIST} aria-label="Promises">
                    {promises.map((row) =>
                      form?.kind === "promise" && form.mode === "edit" && form.id === row.id ? (
                        <li key={row.id} className="border-b py-2 last:border-0">
                          {formEl}
                        </li>
                      ) : (
                        <li key={row.id} className="flex items-start gap-2 border-b py-2 last:border-0">
                          <Badge
                            variant="outline"
                            className={cn("mt-0.5 shrink-0 text-[11px]", PROMISE_STATUS_META[row.status].className)}
                          >
                            {PROMISE_STATUS_META[row.status].label}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm">{row.content}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {row.madeChapter != null ? `made ch. ${row.madeChapter}` : "made —"}
                              {" · "}
                              {row.dueChapter != null ? `due ch. ${row.dueChapter}` : "due —"}
                            </p>
                          </div>
                          <RowActions
                            onEdit={() => openEdit("promise", row)}
                            onDelete={() => setDeleting({ kind: "promise", id: row.id, label: row.content })}
                            editLabel="Edit promise"
                            deleteLabel="Delete promise"
                          />
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No promises tracked yet — record what the book owes its reader.
                  </p>
                )}
              </section>
              )}

              {/* Clues · 线索 (Phase 8) */}
              {(activeTab === "all" || activeTab === "clue") && (
              <section aria-label="Clues" className="space-y-2 pt-4">
                <SectionHeader
                  title="Clues"
                  addLabel="Add clue"
                  onAdd={() => openAdd("clue")}
                />
                <p className="text-[11px] text-muted-foreground">
                  Clue and evidence threads (Ledger/Clues.md) — plant, surface, reveal.
                </p>
                {form?.kind === "clue" && form.mode === "add" && formEl}
                {clues.length > 0 ? (
                  <ul className={SCROLL_LIST} aria-label="Clues">
                    {clues.map((row) =>
                      form?.kind === "clue" && form.mode === "edit" && form.id === row.id ? (
                        <li key={row.id} className="border-b py-2 last:border-0">
                          {formEl}
                        </li>
                      ) : (
                        <li key={row.id} className="flex items-start gap-2 border-b py-2 last:border-0">
                          <Badge
                            variant="outline"
                            className={cn("mt-0.5 shrink-0 text-[11px]", CLUE_STATUS_META[row.status].className)}
                          >
                            {CLUE_STATUS_META[row.status].label}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm">{row.content}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {row.plantChapter != null ? `planted ch. ${row.plantChapter}` : "planted —"}
                              {" · "}
                              {row.revealChapter != null ? `revealed ch. ${row.revealChapter}` : "revealed —"}
                            </p>
                          </div>
                          <RowActions
                            onEdit={() => openEdit("clue", row)}
                            onDelete={() => setDeleting({ kind: "clue", id: row.id, label: row.content })}
                            editLabel="Edit clue"
                            deleteLabel="Delete clue"
                          />
                        </li>
                      )
                    )}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No clues tracked yet — record the threads your reader can follow.
                  </p>
                )}
              </section>
              )}
            </div>
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        busy={busy}
        title={
          deleting?.kind === "storyline"
            ? "Delete storyline?"
            : deleting?.kind === "timeline"
              ? "Delete timeline event?"
              : deleting?.kind === "arc"
                ? "Delete arc stage?"
                : deleting?.kind === "promise"
                  ? "Delete promise?"
                  : "Delete clue?"
        }
        description={`“${deleting?.label ?? ""}” will be removed from the ledger.`}
        onConfirm={async () => {
          if (!deleting) return;
          const target = deleting;
          await mutate(() => deleteLedgerRow(target.kind, target.id));
          setDeleting(null);
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  addLabel,
  onAdd,
}: {
  title: string;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {addLabel}
      </Button>
    </div>
  );
}

function RowActions({
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
  editDisabled = false,
}: {
  onEdit: () => void;
  onDelete: () => void;
  editLabel: string;
  deleteLabel: string;
  /** Canon-locked rows cannot be edited in place (reopen first). */
  editDisabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={editLabel}
        onClick={onEdit}
        disabled={editDisabled}
        title={editDisabled ? "Locked — Unlock to edit" : undefined}
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 hover:text-destructive"
        aria-label={deleteLabel}
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Inline add/edit form shared by all five ledger sections. */
function LedgerRowForm({
  kind,
  mode,
  fields,
  busy,
  onFieldsChange,
  onSubmit,
  onCancel,
}: {
  kind: LedgerKind;
  mode: "add" | "edit";
  fields: LedgerFormFields;
  busy: boolean;
  onFieldsChange: (patch: Partial<LedgerFormFields>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const num = (raw: string) => {
    const t = raw.trim();
    return t === "" ? null : Number(t);
  };
  const chapter = num(fields.chapter);
  const numA = num(fields.numA);
  const numB = num(fields.numB);
  const numsValid =
    [chapter, numA, numB].every((v) => v === null || (Number.isInteger(v) && (v as number) >= 1));
  const canSubmit =
    fields.primary.trim().length > 0 &&
    (kind !== "arc" || fields.secondary.trim().length > 0) &&
    numsValid &&
    !busy;

  const statusMeta =
    kind === "promise"
      ? (Object.keys(PROMISE_STATUS_META) as PromiseStatus[])
      : kind === "clue"
        ? (Object.keys(CLUE_STATUS_META) as ClueStatus[])
        : null;

  return (
    <form
      className="space-y-2 rounded-md border bg-muted/40 p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <div className="flex gap-2">
        <Input
          value={fields.primary}
          onChange={(e) => onFieldsChange({ primary: e.target.value })}
          placeholder={PRIMARY_PLACEHOLDER[kind]}
          aria-label={PRIMARY_LABEL[kind]}
          className="h-8 flex-1 text-sm"
        />
        {(kind === "timeline" || kind === "arc") && (
          <Input
            type="number"
            min={1}
            step={1}
            value={fields.chapter}
            onChange={(e) => onFieldsChange({ chapter: e.target.value })}
            placeholder="ch."
            aria-label="Chapter number (optional)"
            className="h-8 w-20 shrink-0 text-sm"
          />
        )}
      </div>
      {kind !== "promise" && kind !== "clue" && (
        <Input
          value={fields.secondary}
          onChange={(e) => onFieldsChange({ secondary: e.target.value })}
          placeholder={SECONDARY_PLACEHOLDER[kind]}
          aria-label={SECONDARY_LABEL[kind]}
          className="h-8 text-sm"
        />
      )}
      {statusMeta && (
        <div className="flex gap-2">
          <Select
            value={fields.status || undefined}
            onValueChange={(v) => onFieldsChange({ status: v })}
          >
            <SelectTrigger className="h-8 flex-1 text-sm" aria-label="Status">
              <SelectValue placeholder="Status (optional)" />
            </SelectTrigger>
            <SelectContent>
              {statusMeta.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            step={1}
            value={fields.numA}
            onChange={(e) => onFieldsChange({ numA: e.target.value })}
            placeholder={kind === "promise" ? "made ch." : "plant ch."}
            aria-label={kind === "promise" ? "Made in chapter (optional)" : "Planted in chapter (optional)"}
            className="h-8 w-24 shrink-0 text-sm"
          />
          <Input
            type="number"
            min={1}
            step={1}
            value={fields.numB}
            onChange={(e) => onFieldsChange({ numB: e.target.value })}
            placeholder={kind === "promise" ? "due ch." : "reveal ch."}
            aria-label={kind === "promise" ? "Due in chapter (optional)" : "Revealed in chapter (optional)"}
            className="h-8 w-24 shrink-0 text-sm"
          />
        </div>
      )}
      <div className="flex items-center justify-end gap-1.5">
        {!numsValid && (
          <p className="mr-auto text-[11px] text-rose-600">
            Chapter numbers must be whole numbers ≥ 1.
          </p>
        )}
        <Button type="button" variant="ghost" size="sm" className="h-8 px-2.5 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-8 px-3 text-xs" disabled={!canSubmit}>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            mode === "add" && <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {mode === "add" ? "Add" : "Save"}
        </Button>
      </div>
    </form>
  );
}

const PRIMARY_PLACEHOLDER: Record<LedgerKind, string> = {
  storyline: "Storyline name",
  timeline: "Event label",
  arc: "Character name",
  promise: "The promise made to the reader",
  clue: "The clue or evidence thread",
};

const PRIMARY_LABEL: Record<LedgerKind, string> = {
  storyline: "Storyline name",
  timeline: "Timeline event label",
  arc: "Character name",
  promise: "Promise content",
  clue: "Clue content",
};

const SECONDARY_PLACEHOLDER: Record<LedgerKind, string> = {
  storyline: "Summary (optional)",
  timeline: "Detail (optional)",
  arc: "Stage note",
  promise: "",
  clue: "",
};

const SECONDARY_LABEL: Record<LedgerKind, string> = {
  storyline: "Storyline summary (optional)",
  timeline: "Timeline event detail (optional)",
  arc: "Arc stage note",
  promise: "",
  clue: "",
};
