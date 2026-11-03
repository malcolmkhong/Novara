"use client";

// ---------------------------------------------------------------------------
// Memory tab (Phase 4 — live). The story bible read back:
//
//   - Story memory: items sedimented by Review → Settle (facts, character
//     states, foreshadow ledger), searchable and filterable by category.
//   - Story so far: recent chapter digests the AI chains continuity from.
//   - Ledger · 账本: plan-level truth the author curates by hand — storylines,
//     timeline, character arcs (Phase 7 P1). Read into every AI writing context.
//   - Doctor checks: deterministic integrity scans over the real tables.
//
// The same sediment layer is scored and injected into AI drafting (and the
// Phase 3 agent snapshot) by src/lib/novara/memory.ts.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenText,
  Brain,
  CheckCircle2,
  Loader2,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Trash2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  addLedgerRow,
  deleteLedgerRow,
  getLedger,
  getNovelMemory,
  updateLedgerRow,
  type LedgerKind,
} from "@/lib/novara/api";
import type {
  DoctorCheck,
  MemoryCategory,
  MemoryItem,
} from "@/lib/novara/agent-types";
import type {
  CharacterArcDTO,
  LedgerView,
  NovelMeta,
  StorylineDTO,
  StorylineStatus,
  TimelineEntryDTO,
} from "@/lib/novara/types";
import { ConfirmDialog } from "./ui-bits";

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  world_rule: "World rule",
  character_state: "Character state",
  relationship: "Relationship",
  story_fact: "Story fact",
  open_loop: "Open loop",
  decision: "Decision",
  style: "Style",
  dialogue: "Dialogue",
  inspiration: "Inspiration",
};

const CATEGORY_ORDER: (MemoryCategory | "all")[] = [
  "all",
  "open_loop",
  "decision",
  "character_state",
  "relationship",
  "world_rule",
  "style",
  "dialogue",
  "story_fact",
  "inspiration",
];

const LOOP_STATUS_META: Record<
  "open" | "advanced" | "paid",
  { label: string; className: string }
> = {
  open: { label: "open", className: "border-amber-300 bg-amber-50 text-amber-700" },
  advanced: { label: "advanced", className: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  paid: { label: "paid", className: "text-muted-foreground" },
};

const CHECK_META: Record<
  DoctorCheck["status"],
  { icon: LucideIcon; className: string }
> = {
  pass: { icon: CheckCircle2, className: "text-emerald-600" },
  warn: { icon: AlertTriangle, className: "text-amber-600" },
  fail: { icon: XCircle, className: "text-rose-600" },
};

const SCROLL_LIST = "max-h-[380px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

// ---- Ledger · 账本 (Phase 7 P1) --------------------------------------------
// Author-curated plan truth (storylines / timeline / arcs) — unlike the
// sediment memory above, these rows are written by hand and read into every
// AI writing context.

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

const LEDGER_FORM_META: Record<
  LedgerKind,
  {
    primary: { placeholder: string; label: string };
    secondary: { placeholder: string; label: string; required: boolean };
  }
> = {
  storyline: {
    primary: { placeholder: "Storyline name", label: "Storyline name" },
    secondary: {
      placeholder: "Summary (optional)",
      label: "Storyline summary (optional)",
      required: false,
    },
  },
  timeline: {
    primary: { placeholder: "Event label", label: "Timeline event label" },
    secondary: {
      placeholder: "Detail (optional)",
      label: "Timeline event detail (optional)",
      required: false,
    },
  },
  arc: {
    primary: { placeholder: "Character name", label: "Character name" },
    secondary: { placeholder: "Stage note", label: "Arc stage note", required: true },
  },
};

/** Shared inline add/edit form fields — one row per ledger kind. */
interface LedgerFormFields {
  primary: string;
  secondary: string;
  chapter: string;
}

/** Exactly one inline form can be open at a time. */
type LedgerFormState =
  | ({ kind: LedgerKind; mode: "add"; id: null } & LedgerFormFields)
  | ({ kind: LedgerKind; mode: "edit"; id: string } & LedgerFormFields)
  | null;

export function MemoryPanel({ novel }: { novel: NovelMeta }) {
  const [view, setView] = useState<Awaited<ReturnType<typeof getNovelMemory>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MemoryCategory | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setView(await getNovelMemory(novel.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [novel.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<MemoryCategory, number>();
    for (const item of view?.items ?? []) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return counts;
  }, [view]);

  const filtered = useMemo(() => {
    const items = view?.items ?? [];
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (q && !item.content.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [view, query, category]);

  const hasMemory =
    view !== null &&
    view.stats.facts +
      view.stats.states +
      view.stats.loopsOpen +
      view.stats.loopsAdvanced +
      view.stats.loopFacts >
      0;

  return (
    <div className="space-y-4">
      {/* Live pipeline banner */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
      >
        <Brain className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Story memory is written by <span className="font-medium">Review → Settle</span>{" "}
          after each chapter, and retrieved automatically into AI drafting so new
          prose cannot contradict established canon. This view is the bible read
          back — nothing here is mock data.
        </p>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <span>Could not load memory: {error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {loading && !view && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading memory">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {view && (
        <>
          {/* Counters */}
          <div className="flex flex-wrap gap-1.5" aria-label="Memory counters">
            <StatBadge label="facts" value={view.stats.facts} />
            <StatBadge label="states" value={view.stats.states} />
            <StatBadge
              label="open loops"
              value={view.stats.loopsOpen + view.stats.loopsAdvanced + view.stats.loopFacts}
            />
            <StatBadge label="paid" value={view.stats.loopsPaid} />
            <StatBadge label="digests" value={view.stats.digests} />
            <StatBadge label="chapters" value={view.stats.chapters} />
            <span className="ml-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void load()}
                disabled={loading}
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Refresh
              </Button>
            </span>
          </div>

          {!hasMemory && (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm font-medium">No memory yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Write a chapter, run Review, then Settle it — the extracted facts,
                character states and foreshadowing will appear here and start
                feeding every AI draft.
              </p>
            </div>
          )}

          <div className="grid gap-4">
            {/* Story memory */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Brain className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="font-display text-base">Story memory</CardTitle>
                </div>
                <CardDescription>
                  What the AI learned from settled chapters.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {hasMemory && (
                  <>
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search memory…"
                        aria-label="Search memory items"
                        className="h-8 pl-8 text-sm"
                      />
                    </div>

                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
                      {CATEGORY_ORDER.map((c) => {
                        const count =
                          c === "all"
                            ? view.items.length
                            : categoryCounts.get(c) ?? 0;
                        const active = category === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setCategory(c)}
                            aria-pressed={active}
                            className={cn(
                              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                              active
                                ? "border-primary bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-secondary"
                            )}
                          >
                            {c === "all" ? "All" : CATEGORY_LABELS[c]} · {count}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {filtered.length > 0 ? (
                  <ul className={SCROLL_LIST} aria-label="Memory items">
                    {filtered.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-start gap-2 border-b py-2 last:border-0"
                      >
                        <Badge
                          variant="outline"
                          className="mt-0.5 shrink-0 text-[11px] text-muted-foreground"
                        >
                          {CATEGORY_LABELS[item.category]}
                        </Badge>
                        {item.category === "open_loop" && item.status && (
                          <Badge
                            variant="outline"
                            className={cn("mt-0.5 shrink-0 text-[11px]", LOOP_STATUS_META[item.status].className)}
                          >
                            {LOOP_STATUS_META[item.status].label}
                          </Badge>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm">{item.content}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {item.sourceChapter != null ? `since ch. ${item.sourceChapter}` : "source unknown"}
                            {item.lastSeenChapter != null &&
                              item.lastSeenChapter !== item.sourceChapter &&
                              ` · last seen ch. ${item.lastSeenChapter}`}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  hasMemory && (
                    <p className="py-2 text-sm text-muted-foreground">
                      No memory items match this filter.
                    </p>
                  )
                )}
              </CardContent>
            </Card>

            {/* Story so far */}
            {view.digests.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <BookOpenText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <CardTitle className="font-display text-base">Story so far</CardTitle>
                  </div>
                  <CardDescription>
                    Chapter digests the AI chains continuity from.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className={SCROLL_LIST} aria-label="Chapter digests">
                    {view.digests.map((d) => (
                      <li key={d.chapterIndex} className="border-b py-2 last:border-0">
                        <p className="text-sm font-medium">
                          Ch. {d.chapterIndex} — {d.title}
                        </p>
                        <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">
                          {d.summary}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Ledger · 账本 (Phase 7 P1) — author-curated plan-level truth */}
            <LedgerCard novelId={novel.id} />

            {/* Doctor checks */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="font-display text-base">Doctor checks</CardTitle>
                </div>
                <CardDescription>
                  Deterministic integrity scans over the live memory tables.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul aria-label="Doctor checks">
                  {view.doctor.map((check) => {
                    const meta = CHECK_META[check.status];
                    const Icon = meta.icon;
                    return (
                      <li
                        key={check.id}
                        className="flex items-start gap-2 border-b py-2 last:border-0"
                      >
                        <Icon
                          className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`}
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{check.name}</p>
                          <p className="text-xs text-muted-foreground">{check.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <Badge variant="secondary" className="text-[11px] font-normal">
      {value} {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Ledger · 账本 card — three author-curated tables (故事线 / 时间线 / 人物弧线).
// Deliberately independent state from the memory view: a ledger fetch failure
// shows an inline retry row here and never blocks the sediment memory above.
// ---------------------------------------------------------------------------

function LedgerCard({ novelId }: { novelId: string }) {
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<LedgerFormState>(null);
  const [deleting, setDeleting] = useState<{
    kind: LedgerKind;
    id: string;
    label: string;
  } | null>(null);

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
        return true;
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Unknown error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const patchForm = useCallback((patch: Partial<LedgerFormFields>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const openAdd = useCallback((kind: LedgerKind) => {
    setForm({ kind, mode: "add", id: null, primary: "", secondary: "", chapter: "" });
  }, []);

  const openEditTimeline = useCallback((row: TimelineEntryDTO) => {
    setForm({
      kind: "timeline",
      mode: "edit",
      id: row.id,
      primary: row.label,
      secondary: row.detail,
      chapter: row.chapterIndex != null ? String(row.chapterIndex) : "",
    });
  }, []);

  const openEditArc = useCallback((row: CharacterArcDTO) => {
    setForm({
      kind: "arc",
      mode: "edit",
      id: row.id,
      primary: row.characterName,
      secondary: row.note,
      chapter: row.chapterIndex != null ? String(row.chapterIndex) : "",
    });
  }, []);

  const submitForm = useCallback(async () => {
    if (!form) return;
    const target = form;
    const primary = target.primary.trim();
    const secondary = target.secondary.trim();
    const chapterRaw = target.chapter.trim();
    const chapter = chapterRaw === "" ? null : Number(chapterRaw);
    const ok = await mutate(async () => {
      if (target.kind === "storyline") {
        if (target.mode === "add") {
          await addLedgerRow(novelId, "storyline", {
            name: primary,
            summary: secondary || undefined,
          });
        } else {
          await updateLedgerRow("storyline", target.id, {
            name: primary,
            summary: secondary,
          });
        }
      } else if (target.kind === "timeline") {
        const data = { label: primary, detail: secondary, chapterIndex: chapter };
        if (target.mode === "add") {
          await addLedgerRow(novelId, "timeline", data);
        } else {
          await updateLedgerRow("timeline", target.id, data);
        }
      } else {
        const data = { characterName: primary, note: secondary, chapterIndex: chapter };
        if (target.mode === "add") {
          await addLedgerRow(novelId, "arc", data);
        } else {
          await updateLedgerRow("arc", target.id, data);
        }
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
    // Group stages by character, preserving the API's arc order.
    const groups = new Map<string, CharacterArcDTO[]>();
    for (const arc of [...(ledger?.arcs ?? [])].sort((a, b) => a.order - b.order)) {
      const stages = groups.get(arc.characterName);
      if (stages) stages.push(arc);
      else groups.set(arc.characterName, [arc]);
    }
    return Array.from(groups.entries()).map(([name, stages]) => ({ name, stages }));
  }, [ledger]);

  const ledgerEmpty =
    storylines.length === 0 && timeline.length === 0 && arcGroups.length === 0;

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
        <div className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="font-display text-base">Ledger · 账本</CardTitle>
        </div>
        <CardDescription>
          Plan-level truth you curate: storylines, timeline, character arcs — read
          into every AI writing context.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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

            {ledgerEmpty && (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm font-medium">No ledger entries yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Storylines, timeline events and character arcs you record here
                  travel into every AI writing context.
                </p>
              </div>
            )}

            <div className="divide-y">
              {/* Storylines · 故事线 */}
              <section aria-label="Storylines" className="space-y-2 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Storylines · 故事线
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs"
                    onClick={() => openAdd("storyline")}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add storyline
                  </Button>
                </div>

                {form?.kind === "storyline" && form.mode === "add" && formEl}

                {storylines.length > 0 ? (
                  <ul className={SCROLL_LIST} aria-label="Storylines">
                    {storylines.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-start gap-2 border-b py-2 last:border-0"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-8 shrink-0 px-2 text-[11px]",
                            STORYLINE_STATUS_META[row.status].className
                          )}
                          onClick={() => cycleStatus(row)}
                          disabled={busy}
                          aria-label={`Storyline “${row.name}” is ${row.status} — click to mark ${STORYLINE_CYCLE[row.status]}`}
                          title={`Click to mark ${STORYLINE_CYCLE[row.status]}`}
                        >
                          {STORYLINE_STATUS_META[row.status].label}
                        </Button>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{row.name}</p>
                          {row.summary && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {row.summary}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 hover:text-destructive"
                          aria-label={`Delete storyline ${row.name}`}
                          onClick={() =>
                            setDeleting({ kind: "storyline", id: row.id, label: row.name })
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No storylines yet — add the plotlines you are tracking.
                  </p>
                )}
              </section>

              {/* Timeline · 时间线 */}
              <section aria-label="Timeline" className="space-y-2 py-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Timeline · 时间线
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs"
                    onClick={() => openAdd("timeline")}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add event
                  </Button>
                </div>

                {form?.kind === "timeline" && form.mode === "add" && formEl}

                {timeline.length > 0 ? (
                  <ul className={SCROLL_LIST} aria-label="Timeline events">
                    {timeline.map((row) =>
                      form?.kind === "timeline" &&
                      form.mode === "edit" &&
                      form.id === row.id ? (
                        <li key={row.id} className="border-b py-2 last:border-0">
                          {formEl}
                        </li>
                      ) : (
                        <li
                          key={row.id}
                          className="flex items-start gap-2 border-b py-2 last:border-0"
                        >
                          <span className="mt-1 w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                            {row.order}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-sm font-medium">{row.label}</p>
                              {row.chapterIndex != null && (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 text-[11px] text-muted-foreground"
                                >
                                  ch. {row.chapterIndex}
                                </Badge>
                              )}
                            </div>
                            {row.detail && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {row.detail}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Edit timeline event ${row.label}`}
                              onClick={() => openEditTimeline(row)}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:text-destructive"
                              aria-label={`Delete timeline event ${row.label}`}
                              onClick={() =>
                                setDeleting({ kind: "timeline", id: row.id, label: row.label })
                              }
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
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

              {/* Character arcs · 人物弧线 */}
              <section aria-label="Character arcs" className="space-y-2 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Character arcs · 人物弧线
                  </h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 px-2 text-xs"
                    onClick={() => openAdd("arc")}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add stage
                  </Button>
                </div>

                {form?.kind === "arc" && form.mode === "add" && formEl}

                {arcGroups.length > 0 ? (
                  <ul className={cn(SCROLL_LIST, "space-y-3")} aria-label="Character arcs">
                    {arcGroups.map((group) => (
                      <li key={group.name} className="border-b pb-2 last:border-0">
                        <p className="text-sm font-medium">{group.name}</p>
                        <ul className="mt-1" aria-label={`Arc stages for ${group.name}`}>
                          {group.stages.map((stage, index) =>
                            form?.kind === "arc" &&
                            form.mode === "edit" &&
                            form.id === stage.id ? (
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
                                      <Badge
                                        variant="outline"
                                        className="shrink-0 text-[11px] text-muted-foreground"
                                      >
                                        ch. {stage.chapterIndex}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label={`Edit arc stage for ${stage.characterName}`}
                                    onClick={() => openEditArc(stage)}
                                  >
                                    <Pencil className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 hover:text-destructive"
                                    aria-label={`Delete arc stage for ${stage.characterName}`}
                                    onClick={() =>
                                      setDeleting({
                                        kind: "arc",
                                        id: stage.id,
                                        label: stage.characterName,
                                      })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                                  </Button>
                                </div>
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
              : "Delete arc stage?"
        }
        description={
          deleting?.kind === "arc"
            ? `This stage for “${deleting.label}” will be removed from the ledger.`
            : `“${deleting?.label ?? ""}” will be removed from the ledger.`
        }
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

/** Inline add/edit form shared by all three ledger sections. */
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
  const meta = LEDGER_FORM_META[kind];
  const chapterRaw = fields.chapter.trim();
  const chapter = chapterRaw === "" ? null : Number(chapterRaw);
  const chapterValid =
    chapter === null || (Number.isInteger(chapter) && chapter >= 1);
  const canSubmit =
    fields.primary.trim().length > 0 &&
    (!meta.secondary.required || fields.secondary.trim().length > 0) &&
    chapterValid &&
    !busy;

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
          placeholder={meta.primary.placeholder}
          aria-label={meta.primary.label}
          className="h-8 flex-1 text-sm"
        />
        {kind !== "storyline" && (
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
      <Input
        value={fields.secondary}
        onChange={(e) => onFieldsChange({ secondary: e.target.value })}
        placeholder={meta.secondary.placeholder}
        aria-label={meta.secondary.label}
        className="h-8 text-sm"
      />
      <div className="flex items-center justify-end gap-1.5">
        {!chapterValid && (
          <p className="mr-auto text-[11px] text-rose-600">
            Chapter must be a whole number ≥ 1.
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 text-xs"
          onClick={onCancel}
        >
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
