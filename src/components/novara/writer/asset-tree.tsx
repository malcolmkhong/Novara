"use client";

// ---------------------------------------------------------------------------
// Novara AI — Workbench left rail: novel header + asset tree.
//
// The tree is not just navigation: nodes carry LIVE agent badges (D1) bound
// via AgentTask.artifactType/artifactLabel, so the author can see which asset
// the team is touching right now — the "章新区 · 工作中" pattern from the
// workbench reference design.
//
// File-explorer semantics: groups (Chapters/Outline/Characters/World) are
// expandable/collapsible via the chevron OR by clicking the group label;
// their children are clickable "files" that open in the right artifact pane.
// A search box filters the tree by file label while the query is active;
// clearing it restores the exact previous expand/collapse state.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  BookOpen,
  Brain,
  ChevronRight,
  FileSearch,
  FolderTree,
  Globe2,
  Hand,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { AgentTask, AgentTaskStatus } from "@/lib/novara/agent-types";
import type { ArtifactTabId } from "@/config/writer";
import type { NovelDetail, VolumeDTO } from "@/lib/novara/types";
import { formatWordCount } from "@/lib/novara/words";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Badge binding: live tasks → tree node keys
// ---------------------------------------------------------------------------

interface NodeBadge {
  taskKey: string;
  status: Extract<AgentTaskStatus, "in_progress" | "needs_approval">;
}

type BadgeMap = Map<string, NodeBadge[]>;

/** Chapter label like "Chapter 3" → numeric index (best effort). */
function chapterIndexFromLabel(label: string | null): number | null {
  if (!label) return null;
  const m = label.match(/chapter\s+(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

function artifactGroupKey(
  artifactType: NonNullable<AgentTask["artifactType"]>
): string | null {
  switch (artifactType) {
    case "chapter":
      return "group:chapters";
    case "outline_beat":
      return "group:outline";
    case "world_entry":
      return "group:world";
    case "character":
      return "group:characters";
    default:
      return null;
  }
}

export function buildTreeBadges(
  tasks: AgentTask[],
  /** Existing chapter indexes, so badges fall back to the group header when
   * the task targets a chapter that is not in the tree yet. */
  existingChapterIndexes: number[] = []
): BadgeMap {
  const map: BadgeMap = new Map();
  const push = (key: string, badge: NodeBadge) => {
    const list = map.get(key) ?? [];
    list.push(badge);
    map.set(key, list);
  };
  for (const task of tasks) {
    if (task.status !== "in_progress" && task.status !== "needs_approval") {
      continue;
    }
    const badge: NodeBadge = { taskKey: task.key, status: task.status };
    if (task.artifactType === "chapter") {
      const idx = chapterIndexFromLabel(task.artifactLabel);
      const exists = idx != null && existingChapterIndexes.includes(idx);
      push(exists ? `chapter:${idx}` : "group:chapters", badge);
    } else if (task.artifactType) {
      push(artifactGroupKey(task.artifactType) ?? "novel", badge);
    } else {
      push("novel", badge);
    }
  }
  return map;
}

function BadgeIcons({ badges }: { badges: NodeBadge[] | undefined }) {
  if (!badges || badges.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1" aria-live="polite">
      {badges.map((b) =>
        b.status === "in_progress" ? (
          <Loader2
            key={b.taskKey}
            className="h-3.5 w-3.5 animate-spin text-primary"
            aria-label={`${b.taskKey} working on this asset`}
            role="img"
          />
        ) : (
          <Hand
            key={b.taskKey}
            className="h-3.5 w-3.5 text-amber-600"
            aria-label={`${b.taskKey} waiting for approval on this asset`}
            role="img"
          />
        )
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AssetTree
// ---------------------------------------------------------------------------

type ExpandableGroupKey = "chapters" | "outline" | "characters" | "world";

const DEFAULT_EXPANDED: Record<ExpandableGroupKey, boolean> = {
  chapters: true,
  outline: false,
  characters: false,
  world: false,
};

/** localStorage key so a novel's tree state survives remounts and reloads. */
function expandStateKey(novelId: string) {
  return `novara:tree-expanded:${novelId}`;
}

function loadExpandState(novelId: string): Record<ExpandableGroupKey, boolean> {
  if (typeof window === "undefined") return DEFAULT_EXPANDED;
  try {
    const raw = window.localStorage.getItem(expandStateKey(novelId));
    if (!raw) return DEFAULT_EXPANDED;
    const parsed = JSON.parse(raw) as Partial<Record<ExpandableGroupKey, unknown>>;
    return {
      chapters: typeof parsed.chapters === "boolean" ? parsed.chapters : DEFAULT_EXPANDED.chapters,
      outline: typeof parsed.outline === "boolean" ? parsed.outline : DEFAULT_EXPANDED.outline,
      characters: typeof parsed.characters === "boolean" ? parsed.characters : DEFAULT_EXPANDED.characters,
      world: typeof parsed.world === "boolean" ? parsed.world : DEFAULT_EXPANDED.world,
    };
  } catch {
    return DEFAULT_EXPANDED;
  }
}

interface AssetTreeProps {
  detail: NovelDetail;
  /** Live agent tasks (may be empty — no active run). */
  tasks: AgentTask[];
  selectedChapterId: string | null;
  selectedBeatId: string | null;
  selectedCharacterId: string | null;
  selectedWorldId: string | null;
  /** Active volume row in the Outline group (P1) — highlighted like a file. */
  selectedVolumeId?: string | null;
  onOpenChapter: (chapterId: string) => void;
  onOpenBeat: (beatId: string) => void;
  onOpenCharacter: (characterId: string) => void;
  onOpenWorld: (worldId: string) => void;
  /** Opens the volume's plan document in the Outline artifact view. */
  onOpenVolume: (volumeId: string) => void;
  onOpenArtifactTab: (tab: ArtifactTabId) => void;
  onAddChapter: () => Promise<void>;
  onEditDetails: () => void;
  onExport: () => void;
  onDelete: () => void;
  /** Adding chapter in flight (button spinner). */
  addingChapter?: boolean;
}

export function AssetTree({
  detail,
  tasks,
  selectedChapterId,
  selectedBeatId,
  selectedCharacterId,
  selectedWorldId,
  selectedVolumeId,
  onOpenChapter,
  onOpenBeat,
  onOpenCharacter,
  onOpenWorld,
  onOpenVolume,
  onOpenArtifactTab,
  onAddChapter,
  onEditDetails,
  onExport,
  onDelete,
  addingChapter = false,
}: AssetTreeProps) {
  const { novel } = detail;
  const badges = buildTreeBadges(
    tasks,
    detail.chapters.map((c) => c.index)
  );

  // Collapse state (file-explorer style). Chapters start open — the primary
  // asset; the rest start collapsed to keep the rail scannable. The state
  // persists per novel in localStorage so the explorer "stays as you left it"
  // across remounts and reloads.
  const [expanded, setExpandedState] = useState<Record<ExpandableGroupKey, boolean>>(
    () => loadExpandState(novel.id)
  );
  const setExpanded = (next: Record<ExpandableGroupKey, boolean>) => {
    setExpandedState(next);
    try {
      window.localStorage.setItem(expandStateKey(novel.id), JSON.stringify(next));
    } catch {
      // Storage may be unavailable (private mode) — state still works in-memory.
    }
  };
  const toggle = (key: ExpandableGroupKey) =>
    setExpanded({ ...expanded, [key]: !expanded[key] });

  // Search — a derived view on top of the tree. While a query is active the
  // groups render force-expanded, but `expanded` itself is never written, so
  // clearing the query restores the exact previous expand/collapse state.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const matchesQuery = (text: string) => text.toLowerCase().includes(q);
  const visibleChapters = searching
    ? detail.chapters.filter((ch) => matchesQuery(ch.title))
    : detail.chapters;
  // Beats keep their original positional index so "NN" prefixes stay stable.
  const beatEntries = detail.outlineBeats.map((beat, index) => ({ beat, index }));
  const visibleBeats = searching
    ? beatEntries.filter(({ beat }) => matchesQuery(beat.title))
    : beatEntries;
  const visibleCharacters = searching
    ? detail.characters.filter((c) => matchesQuery(c.name))
    : detail.characters;
  const visibleWorld = searching
    ? detail.worldEntries.filter((w) => matchesQuery(w.title))
    : detail.worldEntries;
  const visibleVolumes = searching
    ? detail.volumes.filter((v) => matchesQuery(v.title))
    : detail.volumes;
  const anyMatch =
    visibleChapters.length > 0 ||
    visibleBeats.length > 0 ||
    visibleCharacters.length > 0 ||
    visibleWorld.length > 0 ||
    visibleVolumes.length > 0 ||
    matchesQuery("Review") ||
    matchesQuery("Memory") ||
    matchesQuery("QC");

  const totalWords = detail.chapters.reduce((s, c) => s + c.wordCount, 0);
  const pct = novel.targetWords
    ? Math.min(100, Math.round((totalWords / novel.targetWords) * 100))
    : 0;

  // Live beat counts per volume for the Outline group's volume sub-headers.
  const beatCountByVolume = new Map<string, number>();
  for (const b of detail.outlineBeats) {
    if (b.volumeId) {
      beatCountByVolume.set(b.volumeId, (beatCountByVolume.get(b.volumeId) ?? 0) + 1);
    }
  }

  const novelBadges = badges.get("novel");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Novel header */}
      <div className="border-b p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 font-display text-base font-bold leading-tight">
            {novel.title}
          </h2>
          {novelBadges && <BadgeIcons badges={novelBadges} />}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {novel.genre && <Badge variant="outline">{novel.genre}</Badge>}
          <Badge variant="outline" className="text-muted-foreground">
            {novel.status}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {formatWordCount(totalWords)} / {formatWordCount(novel.targetWords)} words
        </p>
        <Progress value={pct} className="mt-1.5 h-1" aria-label={`${pct}% of target length`} />
        <div className="mt-3 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onEditDetails}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Details
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onExport}
          >
            <Upload className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
            Export
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </Button>
        </div>
      </div>

      {/* Tree */}
      <nav
        aria-label="Novel assets"
        className="nice-scroll min-h-0 flex-1 overflow-y-auto p-2"
      >
        {/* Search — filters the tree below while the query is active. */}
        <div className="relative mb-2">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search assets"
            placeholder="Search files…"
            className="h-8 bg-background pl-8 pr-8"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <ul className="space-y-0.5">
          {/* While searching, matching groups render force-expanded with no
              toggle, so the `expanded` map is never mutated by a search. */}
          {/* Chapters — expandable, children open the Draft editor */}
          {(!searching || visibleChapters.length > 0) && (
            <TreeGroup
              icon={<BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="Chapters"
              count={detail.chapters.length}
              badges={badges.get("group:chapters")}
              expanded={searching ? true : expanded.chapters}
              onToggle={searching ? undefined : () => toggle("chapters")}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => void onAddChapter()}
                  disabled={addingChapter}
                  aria-label="Add chapter"
                >
                  {addingChapter ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </Button>
              }
            >
              {visibleChapters.map((ch) => {
                const chapterBadges = badges.get(`chapter:${ch.index}`);
                return (
                  <TreeFile
                    key={ch.id}
                    label={ch.title}
                    prefix={String(ch.index).padStart(2, "0")}
                    selected={ch.id === selectedChapterId}
                    onClick={() => onOpenChapter(ch.id)}
                    badges={chapterBadges}
                    trailing={
                      ch.status !== "draft" ? (
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            ch.status === "final" ? "bg-emerald-600" : "bg-amber-500"
                          )}
                          aria-label={ch.status}
                        />
                      ) : undefined
                    }
                  />
                );
              })}
            </TreeGroup>
          )}

          {/* Outline — expandable, children open the focused beat */}
          {(!searching || visibleBeats.length > 0 || visibleVolumes.length > 0) && (
            <TreeGroup
              icon={<ListTree className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="Outline"
              count={detail.outlineBeats.length}
              badges={badges.get("group:outline")}
              expanded={searching ? true : expanded.outline}
              onToggle={searching ? undefined : () => toggle("outline")}
            >
              {/* Volume sub-headers (P1) — clickable rows open the volume plan.
                  Beats stay listed below so their positional prefixes never shuffle. */}
              {detail.volumes.length > 0 &&
                visibleVolumes.map((v) => (
                  <TreeVolumeRow
                    key={v.id}
                    volume={v}
                    count={beatCountByVolume.get(v.id) ?? 0}
                    selected={v.id === selectedVolumeId}
                    onClick={() => onOpenVolume(v.id)}
                  />
                ))}
              {visibleBeats.map(({ beat, index }) => (
                <TreeFile
                  key={beat.id}
                  label={beat.title}
                  prefix={String(index + 1).padStart(2, "0")}
                  selected={beat.id === selectedBeatId}
                  onClick={() => onOpenBeat(beat.id)}
                  badges={badges.get(`beat:${beat.id}`)}
                />
              ))}
            </TreeGroup>
          )}

          {/* Characters — expandable, children open the focused card */}
          {(!searching || visibleCharacters.length > 0) && (
            <TreeGroup
              icon={<Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="Characters"
              count={detail.characters.length}
              badges={badges.get("group:characters")}
              expanded={searching ? true : expanded.characters}
              onToggle={searching ? undefined : () => toggle("characters")}
            >
              {visibleCharacters.map((c) => (
                <TreeFile
                  key={c.id}
                  label={c.name}
                  selected={c.id === selectedCharacterId}
                  onClick={() => onOpenCharacter(c.id)}
                  badges={badges.get(`character:${c.id}`)}
                  trailing={
                    c.role ? (
                      <span className="max-w-24 shrink-0 truncate text-[10px] text-muted-foreground">
                        {c.role}
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </TreeGroup>
          )}

          {/* World — expandable, children open the focused entry */}
          {(!searching || visibleWorld.length > 0) && (
            <TreeGroup
              icon={<Globe2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="World"
              count={detail.worldEntries.length}
              badges={badges.get("group:world")}
              expanded={searching ? true : expanded.world}
              onToggle={searching ? undefined : () => toggle("world")}
            >
              {visibleWorld.map((w) => (
                <TreeFile
                  key={w.id}
                  label={w.title}
                  selected={w.id === selectedWorldId}
                  onClick={() => onOpenWorld(w.id)}
                  badges={badges.get(`world:${w.id}`)}
                />
              ))}
            </TreeGroup>
          )}

          {/* Tool views — not files, plain links */}
          {(!searching || matchesQuery("Review")) && (
            <TreeGroup
              icon={<FileSearch className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="Review"
              onOpen={() => onOpenArtifactTab("review")}
            />
          )}
          {(!searching || matchesQuery("Memory")) && (
            <TreeGroup
              icon={<Brain className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="Memory"
              onOpen={() => onOpenArtifactTab("memory")}
            />
          )}
          {(!searching || matchesQuery("QC")) && (
            <TreeGroup
              icon={<ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="QC"
              onOpen={() => onOpenArtifactTab("qc")}
            />
          )}
        </ul>

        {searching && !anyMatch && (
          <p className="mt-4 px-2 text-center text-xs text-muted-foreground">
            No files match your search.
          </p>
        )}

        <p className="mt-4 flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">
          <FolderTree className="h-3 w-3 shrink-0" aria-hidden="true" />
          Spinning icons show where the team is working right now.
        </p>
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group row — expandable groups toggle collapse via chevron or label click;
// plain rows (Review/Memory/QC) open their artifact view when clicked
// ---------------------------------------------------------------------------

function TreeGroup({
  icon,
  label,
  count,
  badges,
  phaseTag,
  onOpen,
  expanded,
  onToggle,
  action,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  badges?: NodeBadge[];
  phaseTag?: string;
  /** Label click for plain (non-expandable) rows — opens the artifact view. */
  onOpen?: () => void;
  /** Presence of onToggle makes the group expandable: both the chevron and
   * the label toggle collapse; the label never opens the artifact view. */
  expanded?: boolean;
  onToggle?: () => void;
  /** Extra trailing control (e.g. the chapter add button). */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const expandable = typeof expanded === "boolean" && !!onToggle;
  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md pr-1 transition-colors",
          "hover:bg-accent/60"
        )}
      >
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${label} — expand or collapse`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("h-5 w-5 transition-transform", expanded && "rotate-90")}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="h-7 w-7 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={expandable ? onToggle : onOpen}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {label}
            {typeof count === "number" && (
              <span className="ml-1.5 text-xs text-muted-foreground">({count})</span>
            )}
            {phaseTag && (
              <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                {phaseTag}
              </span>
            )}
          </span>
          <BadgeIcons badges={badges} />
        </button>
        {action}
      </div>
      {expandable && expanded && children != null && (
        <ul className="ml-3 border-l pl-2">{children}</ul>
      )}
      {!expandable && children != null && <ul className="ml-3 border-l pl-2">{children}</ul>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// File row — a clickable child asset (chapter / beat / character / world)
// ---------------------------------------------------------------------------

function TreeFile({
  label,
  prefix,
  selected,
  onClick,
  badges,
  trailing,
}: {
  label: string;
  /** Mono index prefix, e.g. "03". */
  prefix?: string;
  selected?: boolean;
  onClick: () => void;
  badges?: NodeBadge[];
  trailing?: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          selected ? "bg-accent" : "hover:bg-accent/60"
        )}
      >
        {prefix && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {prefix}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        {trailing}
        <BadgeIcons badges={badges} />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Volume sub-row — a volume header inside the Outline group (P1). Slightly
// smaller than a file row: mono "V01" prefix, medium-weight title, beat count.
// ---------------------------------------------------------------------------

function TreeVolumeRow({
  volume,
  count,
  selected,
  onClick,
}: {
  volume: VolumeDTO;
  count: number;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          selected ? "bg-accent" : "hover:bg-accent/60"
        )}
      >
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          V{String(volume.index).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {volume.title}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">({count})</span>
      </button>
    </li>
  );
}
