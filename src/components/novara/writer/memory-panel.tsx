"use client";

// ---------------------------------------------------------------------------
// Memory tab (Phase 10 — 7-zone hub): the right pane's information hub.
//
// One switcher, seven zones in canonical order (default zone: 本书记忆):
//
//   世界书 World Bible · 作品契约 Story Contract · 大纲 Outline ·
//   账本 Story Ledger · 本书记忆 Novel Memory · 定稿 Canon · 草稿区 Drafts.
//
// Every summary zone carries live counts plus a primary button that jumps to
// the dedicated management tab (onOpenArtifactTab), so the hub is a true
// router into the deeper artifact views. 本书记忆 keeps the full Phase 8
// experience: searchable memory items, category filters (seeded from the
// writer store's memoryFocusByNovel) and Doctor integrity checks.
//
// The same sediment layer is scored and injected into AI drafting (and the
// agent snapshot) by src/lib/novara/memory.ts.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  Eye,
  GitBranch,
  Globe,
  Layers,
  ListTree,
  Loader2,
  Lock,
  NotebookText,
  PenLine,
  RefreshCw,
  ScrollText,
  Search,
  Stamp,
  Stethoscope,
  User,
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
import { getNovelMemory, type LedgerKind } from "@/lib/novara/api";
import type {
  DoctorCheck,
  MemoryCategory,
  NovelMemoryView,
} from "@/lib/novara/agent-types";
import type { NovelDetail } from "@/lib/novara/types";
import type { ArtifactTabId } from "@/config/writer";
import { useWriterStore } from "@/hooks/use-writer-store";

// ---------------------------------------------------------------------------
// Zone registry (canonical order — render order follows this list)
// ---------------------------------------------------------------------------

type MemoryZone =
  | "bible"
  | "contract"
  | "outline"
  | "ledger"
  | "novel-memory"
  | "canon"
  | "drafts";

const ZONES: { id: MemoryZone; label: string; caption: string; icon: LucideIcon }[] = [
  { id: "bible", label: "World book", caption: "World Bible", icon: Globe },
  { id: "contract", label: "Book contract", caption: "Story Contract", icon: ScrollText },
  { id: "outline", label: "Outline", caption: "Outline", icon: ListTree },
  { id: "ledger", label: "Ledger", caption: "Story Ledger", icon: NotebookText },
  { id: "novel-memory", label: "Memory", caption: "Novel Memory", icon: Brain },
  { id: "canon", label: "Final drafts", caption: "Canon", icon: Lock },
  { id: "drafts", label: "Drafts", caption: "Drafts", icon: PenLine },
];

// ---------------------------------------------------------------------------
// Memory categories (zh-first labels; English kept for title/tooltips)
// ---------------------------------------------------------------------------

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

const CATEGORY_LABELS_EN: Record<MemoryCategory, string> = {
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

const MEMORY_CATEGORY_SET: ReadonlySet<string> = new Set(
  Object.keys(CATEGORY_LABELS)
);

/** Type guard for store-seeded category filters ("all" | MemoryCategory | null). */
function isMemoryCategory(value: string): value is MemoryCategory {
  return MEMORY_CATEGORY_SET.has(value);
}

const LOOP_STATUS_META: Record<
  "open" | "advanced" | "paid",
  { label: string; title: string; className: string }
> = {
  open: { label: "Planted", title: "open", className: "border-amber-300 bg-amber-50 text-amber-700" },
  advanced: { label: "Advanced", title: "advanced", className: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  paid: { label: "Paid off", title: "paid", className: "text-muted-foreground" },
};

const CHECK_META: Record<
  DoctorCheck["status"],
  { icon: LucideIcon; className: string }
> = {
  pass: { icon: CheckCircle2, className: "text-emerald-600" },
  warn: { icon: AlertTriangle, className: "text-amber-600" },
  fail: { icon: XCircle, className: "text-rose-600" },
};

// Lifecycle chip palettes — emerald/amber accents only; settled states stay muted.
const CHIP_EMERALD = "border-emerald-300 bg-emerald-50 text-emerald-700";
const CHIP_AMBER = "border-amber-300 bg-amber-50 text-amber-700";
const CHIP_MUTED = "text-muted-foreground";

const SCROLL_LIST =
  "max-h-[380px] overflow-y-auto pr-1 nice-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";
const SCROLL_SHORT = "max-h-40 overflow-y-auto pr-1 nice-scroll";

/** `0001-标题` style chapter label used across the canon zone. */
function zeroPad4(index: number): string {
  return String(index).padStart(4, "0");
}

/** Group rows by a string key and count them. */
function tally<T>(rows: T[], statusOf: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = statusOf(row);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// MemoryPanel — the 7-zone hub
// ---------------------------------------------------------------------------

export function MemoryPanel({
  detail,
  onOpenArtifactTab,
}: {
  detail: NovelDetail;
  onOpenArtifactTab: (tab: ArtifactTabId) => void;
}) {
  const novelId = detail.novel.id;

  const [zone, setZone] = useState<MemoryZone>("novel-memory");
  const [view, setView] = useState<NovelMemoryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setView(await getNovelMemory(novelId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalWords = useMemo(
    () => detail.chapters.reduce((sum, c) => sum + c.wordCount, 0),
    [detail.chapters]
  );

  return (
    <div className="space-y-3">
      {/* Zone switcher — canonical 7-zone order; 本书记忆 is the default zone */}
      <div
        role="tablist"
        aria-label="Memory hub zones"
        className="flex flex-wrap gap-1.5"
      >
        {ZONES.map((z) => {
          const Icon = z.icon;
          const active = zone === z.id;
          return (
            <button
              key={z.id}
              id={`memory-hub-tab-${z.id}`}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls="memory-hub-panel"
              onClick={() => setZone(z.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                active
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {z.label}
              <span className={cn("text-[10px]", active ? "text-white/70" : "opacity-60")}>
                {z.caption}
              </span>
            </button>
          );
        })}
      </div>

      {/* Slim always-visible totals strip */}
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground"
        aria-label="Totals"
      >
        <span className="inline-flex items-center gap-1">
          <PenLine className="h-3 w-3" aria-hidden="true" />
          <span className="font-medium text-foreground/80">{totalWords.toLocaleString()}</span> words
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <span className="font-medium text-foreground/80">{detail.chapters.length}</span> chapters
        </span>
        <span aria-hidden="true">·</span>
        <span>
          <span className="font-medium text-foreground/80">
            {view ? view.items.length.toLocaleString() : loading ? "…" : error ? "—" : "0"}
          </span>
          memories
        </span>
        <span className="ml-auto hidden items-center gap-1 sm:inline-flex">
          <Brain className="h-3 w-3" aria-hidden="true" />
          Memory hub
        </span>
      </div>

      {/* Active zone */}
      <div
        id="memory-hub-panel"
        role="tabpanel"
        aria-labelledby={`memory-hub-tab-${zone}`}
        tabIndex={0}
        className="space-y-3 focus-visible:outline-none"
      >
        {zone === "bible" && (
          <WorldBibleZone detail={detail} onOpenArtifactTab={onOpenArtifactTab} />
        )}
        {zone === "contract" && (
          <ContractZone
            contract={detail.contract}
            contractStatus={detail.contractStatus}
            onOpenArtifactTab={onOpenArtifactTab}
          />
        )}
        {zone === "outline" && (
          <OutlineZone
            beats={detail.outlineBeats}
            volumes={detail.volumes}
            digests={detail.digests}
            onOpenArtifactTab={onOpenArtifactTab}
          />
        )}
        {zone === "ledger" && (
          <LedgerZone
            novelId={novelId}
            ledger={detail.ledger}
            onOpenArtifactTab={onOpenArtifactTab}
          />
        )}
        {zone === "novel-memory" && (
          <NovelMemoryZone
            novelId={novelId}
            view={view}
            loading={loading}
            error={error}
            onRefresh={() => void load()}
          />
        )}
        {zone === "canon" && (
          <CanonZone chapters={detail.chapters} onOpenArtifactTab={onOpenArtifactTab} />
        )}
        {zone === "drafts" && (
          <DraftWorkspaceZone
            chapters={detail.chapters}
            packs={detail.packs}
            onOpenArtifactTab={onOpenArtifactTab}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared zone bits
// ---------------------------------------------------------------------------

function ZoneHeading({
  icon: Icon,
  title,
  caption,
}: {
  icon: LucideIcon;
  title: string;
  caption: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <CardTitle className="font-display text-base">{title}</CardTitle>
      <span className="text-[11px] font-normal text-muted-foreground">{caption}</span>
    </div>
  );
}

function CountBadge({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
      {value} {label}
    </Badge>
  );
}

function OpenTabButton({
  label,
  tab,
  onOpen,
  icon: Icon = ArrowRight,
}: {
  label: string;
  tab: ArtifactTabId;
  onOpen: (tab: ArtifactTabId) => void;
  icon?: LucideIcon;
}) {
  return (
    <Button size="sm" className="gap-1.5" onClick={() => onOpen(tab)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Zone 1 — 世界书 World Bible
// ---------------------------------------------------------------------------

function WorldBibleZone({
  detail,
  onOpenArtifactTab,
}: {
  detail: NovelDetail;
  onOpenArtifactTab: (tab: ArtifactTabId) => void;
}) {
  const entries = detail.worldEntries;
  const groups = detail.worldGroups;
  const groupedCount = entries.filter((e) => e.groupId != null).length;
  const ungroupedCount = entries.length - groupedCount;
  const groupRows = groups.map((g) => ({
    id: g.id,
    name: g.name,
    count: entries.filter((e) => e.groupId === g.id).length,
  }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <ZoneHeading icon={Globe} title="World book" caption="World Bible" />
        <CardDescription>
          Characters, places, factions and world rules — the setting library injected into AI writing context.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <CountBadge label="Characters" value={detail.characters.length} />
          <CountBadge label="World entries" value={entries.length} />
          <CountBadge label="Group" value={groups.length} />
          <CountBadge label="Ungrouped" value={ungroupedCount} />
        </div>

        {groupRows.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">
              Groups · entries per group
            </p>
            <ul className={SCROLL_SHORT} aria-label="World book groups">
              {groupRows.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center gap-2 border-b py-1.5 text-sm last:border-0"
                >
                  <Layers className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 truncate">{g.name}</span>
                  <Badge variant="secondary" className="ml-auto shrink-0 text-[11px] font-normal">
                    {g.count} entries
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ungroupedCount > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {ungroupedCount} ungrouped entries ({groupedCount} in groups) shown at the World book top level.
          </p>
        )}

        {entries.length === 0 && detail.characters.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            World book is empty — open the manager to add characters and settings.
          </p>
        )}

        <div className="flex justify-end">
          <OpenTabButton label="Open World book manager" tab="bible" onOpen={onOpenArtifactTab} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Zone 2 — 作品契约 Story Contract
// ---------------------------------------------------------------------------

function ContractZone({
  contract,
  contractStatus,
  onOpenArtifactTab,
}: {
  contract: string | null;
  contractStatus: "draft" | "final";
  onOpenArtifactTab: (tab: ArtifactTabId) => void;
}) {
  const written = contract != null;
  const finalized = written && contractStatus === "final";

  return (
    <Card>
      <CardHeader className="pb-3">
        <ZoneHeading icon={ScrollText} title="Book contract" caption="Story Contract" />
        <CardDescription>
          The promises this book makes to its reader: genre expectations, audience, style commitment and hard taboos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {written ? (
            finalized ? (
              <Badge variant="outline" className={cn("gap-1 text-[11px]", CHIP_EMERALD)}>
                <Lock className="h-3 w-3" aria-hidden="true" />
                Locked
              </Badge>
            ) : (
              <Badge variant="outline" className={cn("text-[11px]", CHIP_AMBER)}>
                Draft
              </Badge>
            )
          ) : (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              Empty
            </Badge>
          )}
        </div>

        {written && contract && (
          <div
            className="nice-scroll max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2.5 text-xs leading-5"
            aria-label="Contract preview"
          >
            {contract.length > 400 ? `${contract.slice(0, 400)}…` : contract}
          </div>
        )}

        {!written && (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No contract yet — write genre expectations, audience and hard taboos first; it enters every AI writing context.
          </p>
        )}

        <p
          className={cn(
            "flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px]",
            finalized
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          )}
        >
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {finalized
            ? "Finalized contract = Immutable Canon. Changes require the reopen flow and archive the original automatically."
            : "The contract is injected into every AI writing context; finalizing locks it as Immutable Canon."}
        </p>

        <div className="flex justify-end">
          <OpenTabButton label="Open contract" tab="contract" onOpen={onOpenArtifactTab} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Zone 3 — 大纲 Outline
// ---------------------------------------------------------------------------

function OutlineZone({
  beats,
  volumes,
  digests,
  onOpenArtifactTab,
}: {
  beats: NovelDetail["outlineBeats"];
  volumes: NovelDetail["volumes"];
  digests: NovelDetail["digests"];
  onOpenArtifactTab: (tab: ArtifactTabId) => void;
}) {
  const volumeRows = volumes.map((v) => ({
    id: v.id,
    index: v.index,
    title: v.title,
    beats: beats.filter((b) => b.volumeId === v.id).length,
  }));
  const unsortedBeats = beats.filter((b) => b.volumeId == null).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <ZoneHeading icon={ListTree} title="Outline" caption="Outline" />
        <CardDescription>Volumes, story beats and chapter digests — the chapter-by-chapter roadmap.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <CountBadge label="Story beats" value={beats.length} />
          <CountBadge label="Volumes" value={volumes.length} />
          <CountBadge label="Chapter digests" value={digests.length} />
        </div>

        {volumeRows.length > 0 ? (
          <ul className={SCROLL_SHORT} aria-label="Volume list">
            {volumeRows.map((v) => (
              <li
                key={v.id}
                className="flex items-center gap-2 border-b py-1.5 text-sm last:border-0"
              >
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  Vol. {v.index}
                </span>
                <span className="min-w-0 truncate">{v.title}</span>
                <Badge variant="secondary" className="ml-auto shrink-0 text-[11px] font-normal">
                  {v.beats} beats
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No volumes yet — open the Outline to add volumes and story beats.
          </p>
        )}

        {unsortedBeats > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {unsortedBeats} beats are not in a volume.
          </p>
        )}

        <div className="flex justify-end">
          <OpenTabButton label="Open Outline" tab="outline" onOpen={onOpenArtifactTab} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Zone 4 — 账本 Story Ledger
// ---------------------------------------------------------------------------

interface LedgerRowDef {
  kind: LedgerKind;
  icon: LucideIcon;
  label: string;
  caption: string;
  total: number;
  chips: { label: string; count: number; className: string }[];
}

function LedgerZone({
  novelId,
  ledger,
  onOpenArtifactTab,
}: {
  novelId: string;
  ledger: NovelDetail["ledger"];
  onOpenArtifactTab: (tab: ArtifactTabId) => void;
}) {
  const setLedgerKind = useWriterStore((s) => s.setLedgerKind);

  const viewKind = useCallback(
    (kind: LedgerKind) => {
      setLedgerKind(novelId, kind);
      onOpenArtifactTab("ledger");
    },
    [novelId, onOpenArtifactTab, setLedgerKind]
  );

  const storylineTally = tally(ledger.storylines, (s) => s.status);
  const promiseTally = tally(ledger.promises, (p) => p.status);
  const clueTally = tally(ledger.clues, (c) => c.status);

  const rows: LedgerRowDef[] = [
    {
      kind: "storyline",
      icon: GitBranch,
      label: "Storylines",
      caption: "Storylines",
      total: ledger.storylines.length,
      chips: [
        { label: "Active", count: storylineTally.active ?? 0, className: CHIP_EMERALD },
        { label: "Dormant", count: storylineTally.dormant ?? 0, className: CHIP_AMBER },
        { label: "Resolved", count: storylineTally.resolved ?? 0, className: CHIP_MUTED },
      ],
    },
    {
      kind: "timeline",
      icon: Clock,
      label: "Timeline",
      caption: "Timeline",
      total: ledger.timeline.length,
      chips: [],
    },
    {
      kind: "arc",
      icon: User,
      label: "Character arcs",
      caption: "Character arcs",
      total: ledger.arcs.length,
      chips: [],
    },
    {
      kind: "promise",
      icon: Stamp,
      label: "Promises",
      caption: "Promises",
      total: ledger.promises.length,
      chips: [
        { label: "Open", count: promiseTally.open ?? 0, className: CHIP_AMBER },
        { label: "Fulfilled", count: promiseTally.fulfilled ?? 0, className: CHIP_EMERALD },
        { label: "Broken", count: promiseTally.broken ?? 0, className: CHIP_MUTED },
      ],
    },
    {
      kind: "clue",
      icon: Eye,
      label: "Clues",
      caption: "Clues",
      total: ledger.clues.length,
      chips: [
        { label: "Planted", count: clueTally.planted ?? 0, className: CHIP_AMBER },
        { label: "Surfaced", count: clueTally.surfaced ?? 0, className: CHIP_EMERALD },
        { label: "Revealed", count: clueTally.revealed ?? 0, className: CHIP_MUTED },
      ],
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <ZoneHeading icon={NotebookText} title="Ledger" caption="Story Ledger" />
        <CardDescription>
          Five ledgers track the causal loop of storylines, time, arcs, promises and clues.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul aria-label="Ledger rows">
          {rows.map((row) => (
            <LedgerRow key={row.kind} {...row} onView={viewKind} />
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            "View" opens the matching ledger view.
          </p>
          <OpenTabButton label="Open Ledger" tab="ledger" onOpen={onOpenArtifactTab} />
        </div>
      </CardContent>
    </Card>
  );
}

function LedgerRow({
  kind,
  icon: Icon,
  label,
  caption,
  total,
  chips,
  onView,
}: LedgerRowDef & { onView: (kind: LedgerKind) => void }) {
  return (
    <li className="flex flex-wrap items-start gap-2 border-b py-2 last:border-0">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-medium">{label}</span>
          <span className="ml-1.5 text-[11px] text-muted-foreground">{caption}</span>
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {total === 0 ? (
            <span className="text-[11px] text-muted-foreground">No records</span>
          ) : (
            chips
              .filter((c) => c.count > 0)
              .map((c) => (
                <Badge
                  key={c.label}
                  variant="outline"
                  className={cn("text-[11px] font-normal", c.className)}
                >
                  {c.label} {c.count}
                </Badge>
              ))
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge variant="secondary" className="text-[11px] font-normal">
          {total}
        </Badge>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => onView(kind)}
        >
          View
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Zone 5 — 本书记忆 Novel Memory (full Phase 8 view, preserved)
// ---------------------------------------------------------------------------

function NovelMemoryZone({
  novelId,
  view,
  loading,
  error,
  onRefresh,
}: {
  novelId: string;
  view: NovelMemoryView | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  // Category filter is seeded from the writer store (asset tree can pre-focus
  // a category); afterwards it is managed locally like any filter state.
  const storeFocus = useWriterStore((s) => s.memoryFocusByNovel[novelId] ?? "all");
  const [category, setCategory] = useState<MemoryCategory | "all">(() =>
    isMemoryCategory(storeFocus) ? storeFocus : "all"
  );

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
    <div className="space-y-3">
      {/* One-line pipeline banner */}
      <div
        role="note"
        className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900"
      >
        <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p>
          Memory is settled by <span className="font-medium">Review → Settle</span>{" "}
          and injected into AI drafts automatically — this is a read-back view, not simulated data.
        </p>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <span>Failed to load memory: {error}</span>
          <Button size="sm" variant="outline" onClick={onRefresh}>
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
          <div className="flex flex-wrap gap-1.5" aria-label="Memory counts">
            <StatBadge label="Facts" value={view.stats.facts} />
            <StatBadge label="States" value={view.stats.states} />
            <StatBadge
              label="Open loops"
              value={view.stats.loopsOpen + view.stats.loopsAdvanced + view.stats.loopFacts}
            />
            <StatBadge label="Paid off" value={view.stats.loopsPaid} />
            <StatBadge label="Chapters" value={view.stats.chapters} />
            <span className="ml-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={onRefresh}
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
                Write a chapter, run Review, then Settle — extracted facts, character states and loops appear here,
                and are injected into every AI draft from then on.
              </p>
            </div>
          )}

          <div className="grid gap-3">
            {/* Story memory */}
            <Card>
              <CardHeader className="pb-3">
                <ZoneHeading icon={Brain} title="Memory items" caption="Story memory" />
                <CardDescription>Everything the AI learned from settled chapters.</CardDescription>
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

                    <div
                      className="flex flex-wrap gap-1.5"
                      role="group"
                      aria-label="Filter by category"
                    >
                      {CATEGORY_ORDER.map((c) => {
                        const count =
                          c === "all" ? view.items.length : categoryCounts.get(c) ?? 0;
                        const active = category === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setCategory(c)}
                            aria-pressed={active}
                            title={c === "all" ? "All" : CATEGORY_LABELS_EN[c]}
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
                          title={CATEGORY_LABELS_EN[item.category]}
                          className="mt-0.5 shrink-0 text-[11px] text-muted-foreground"
                        >
                          {CATEGORY_LABELS[item.category]}
                        </Badge>
                        {item.category === "open_loop" && item.status && (
                          <Badge
                            variant="outline"
                            title={LOOP_STATUS_META[item.status].title}
                            className={cn(
                              "mt-0.5 shrink-0 text-[11px]",
                              LOOP_STATUS_META[item.status].className
                            )}
                          >
                            {LOOP_STATUS_META[item.status].label}
                          </Badge>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm">{item.content}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {item.sourceChapter != null
                              ? `From Ch ${item.sourceChapter}`
                              : "Unknown source chapter"}
                            {item.lastSeenChapter != null &&
                              item.lastSeenChapter !== item.sourceChapter &&
                              ` · last seen in Ch ${item.lastSeenChapter}`}
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
                <ZoneHeading icon={Stethoscope} title="Doctor checks" caption="Doctor checks" />
                <CardDescription>A deterministic integrity scan of the real memory tables.</CardDescription>
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

// ---------------------------------------------------------------------------
// Zone 6 — 定稿 Canon
// ---------------------------------------------------------------------------

function CanonZone({
  chapters,
  onOpenArtifactTab,
}: {
  chapters: NovelDetail["chapters"];
  onOpenArtifactTab: (tab: ArtifactTabId) => void;
}) {
  const finals = useMemo(
    () =>
      chapters
        .filter((c) => c.status === "final")
        .sort((a, b) => a.index - b.index),
    [chapters]
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <ZoneHeading icon={Lock} title="Final drafts" caption="Canon" />
        <CardDescription>Immutable Canon — the locked final text.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <CountBadge label="Finalized chapters" value={finals.length} />
          <CountBadge label="All chapters" value={chapters.length} />
        </div>

        {finals.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No finalized chapters — run Finalize after Review passes.
          </p>
        ) : (
          <ul className={SCROLL_SHORT} aria-label="Finalized chapters">
            {finals.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-2 border-b py-1.5 font-mono text-xs last:border-0"
              >
                <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {zeroPad4(c.index)}-{c.title}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {c.wordCount.toLocaleString()} words
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Final drafts = Immutable Canon. Changes require the reopen flow and archive the original automatically.
        </p>

        <div className="flex justify-end">
          <OpenTabButton label="Open Final drafts" tab="canon" onOpen={onOpenArtifactTab} />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Zone 7 — 草稿区 Draft Workspace
// ---------------------------------------------------------------------------

function DraftWorkspaceZone({
  chapters,
  packs,
  onOpenArtifactTab,
}: {
  chapters: NovelDetail["chapters"];
  packs: NovelDetail["packs"];
  onOpenArtifactTab: (tab: ArtifactTabId) => void;
}) {
  const draftCount = chapters.filter((c) => c.status === "draft").length;
  const revisedCount = chapters.filter((c) => c.status === "revised").length;
  const materialCount = packs.filter((p) => p.kind === "material").length;
  const prepCount = packs.filter((p) => p.kind === "prep").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <ZoneHeading icon={PenLine} title="Drafts" caption="Draft Workspace" />
        <CardDescription>The active workspace — chapter drafts and two kinds of packs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <CountBadge label="Draft chapters" value={draftCount} />
          <CountBadge label="Revised chapters" value={revisedCount} />
          <CountBadge label="Materials" value={materialCount} />
          <CountBadge label="Final prep packs" value={prepCount} />
        </div>

        {chapters.length === 0 && packs.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            The workspace is empty — create a chapter to start writing, or generate a Materials pack first.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <OpenTabButton
            label="Open editor"
            tab="draft"
            onOpen={onOpenArtifactTab}
            icon={PenLine}
          />
          <OpenTabButton
            label="Open Materials"
            tab="packs"
            onOpen={onOpenArtifactTab}
            icon={Layers}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stat badge
// ---------------------------------------------------------------------------

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <Badge variant="secondary" className="text-[11px] font-normal">
      {value} {label}
    </Badge>
  );
}
