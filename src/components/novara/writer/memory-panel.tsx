"use client";

// ---------------------------------------------------------------------------
// Memory tab (Phase 8 — slimmed): 本书记忆 novel memory + Doctor checks.
//
//   - Story memory: items sedimented by Review → Settle (facts, character
//     states, foreshadow loops, decision/style/dialogue/inspiration notes),
//     searchable and filterable by category.
//   - Doctor checks: deterministic integrity scans over the real tables.
//
// Ledger lives in the dedicated Ledger tab (Phase 8); chapter digests live in
// the Outline tab's 章摘要 section.
//
// The same sediment layer is scored and injected into AI drafting (and the
// agent snapshot) by src/lib/novara/memory.ts.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  Stethoscope,
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
import { getNovelMemory } from "@/lib/novara/api";
import type { DoctorCheck, MemoryCategory } from "@/lib/novara/agent-types";
import type { NovelMeta } from "@/lib/novara/types";

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
