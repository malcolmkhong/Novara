"use client";

// ---------------------------------------------------------------------------
// Novara AI — Workbench left rail: novel header + asset tree.
//
// The tree is not just navigation: nodes carry LIVE agent badges (D1) bound
// via AgentTask.artifactType/artifactLabel, so the author can see which asset
// the team is touching right now — the "章新区 · 工作中" pattern from the
// workbench reference design.
//
// Phase 9 repository structure (DSH-style zones, rendered top → bottom):
//   世界书   — dynamic 世界书 groups (one sub-group per WorldGroupDTO, ordered)
//              + 未分组 (ungrouped entries; agent world_entry fallback badge)
//              + 人物档案 (characters); canon-locked (status "final") files
//              carry a Lock icon
//   作品契约 — single document row → contract tab ("已写入"/"未写入")
//   大纲     — 故事骨架 (unsorted beats) + 卷规划 (per-volume beats) + 章摘要
//   定稿     — zero-padded final-chapter files (hidden until one exists)
//   本书记忆 — expandable group → 索引/决策/对话/文风/灵感 sub-rows → memory
//              tab (writes the store's memory deep-link focus first)
//   构想     — single document row → contract tab ("已快照"/"未快照")
//   账本     — expandable group → 故事线/时间线/人物弧线/承诺/线索 sub-rows
//              with live counts → ledger tab (writes ledger focus first)
//   草稿区   — 草稿 (draft chapters, expandable into 稿N version rows) +
//              材料包 + 定稿准备 (packs) + 审核
//
// File-explorer semantics: groups AND sub-groups are expandable/collapsible
// via the chevron OR by clicking the group label; their children are
// clickable "files" that open in the right artifact pane. A search box
// filters the tree by file label while the query is active (groups with
// matches render force-expanded); clearing it restores the exact previous
// expand/collapse state.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  Brain,
  ChevronRight,
  FileSearch,
  FolderTree,
  Globe2,
  Hand,
  Lightbulb,
  ListTree,
  Loader2,
  Lock,
  NotebookPen,
  PenLine,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { AgentTask, AgentTaskStatus } from "@/lib/novara/agent-types";
import type { ArtifactTabId } from "@/config/writer";
import type {
  ChapterDTO,
  ChapterPackDTO,
  ChapterPackKind,
  ChapterVersionSummaryDTO,
  NovelDetail,
  OutlineBeatDTO,
  VolumeDTO,
  WorldEntryDTO,
  WorldGroupDTO,
} from "@/lib/novara/types";
import { formatWordCount } from "@/lib/novara/words";
import { cn } from "@/lib/utils";
import { useWriterStore } from "@/hooks/use-writer-store";

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

export function buildTreeBadges(
  tasks: AgentTask[],
  /** Existing chapter indexes, so badges fall back to the 草稿 group header
   * when the task targets a chapter that is not in the tree yet. */
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
    switch (task.artifactType) {
      case "chapter": {
        const idx = chapterIndexFromLabel(task.artifactLabel);
        push(
          idx != null && existingChapterIndexes.includes(idx)
            ? `chapter:${idx}`
            : "group:drafts",
          badge
        );
        break;
      }
      case "character":
        push(
          task.artifactId ? `character:${task.artifactId}` : "group:world.characters",
          badge
        );
        break;
      case "world_entry":
        // Entries without an artifact yet fall back to the 未分组 sub-group.
        push(
          task.artifactId ? `world:${task.artifactId}` : "group:world.ungrouped",
          badge
        );
        break;
      case "outline_beat":
        push(task.artifactId ? `beat:${task.artifactId}` : "group:outline", badge);
        break;
      default:
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

/** Static expandable group/sub-group keys (dynamic rows use prefixed keys:
 * volume plans "volume:<id>", 世界书 groups "world.group.<groupId>", draft
 * chapter versions "chapter.v.<chapterId>"). */
type ExpandableKey =
  | "world"
  | "world.ungrouped"
  | "world.characters"
  | "outline"
  | "outline.skeleton"
  | "outline.volumes"
  | "canon"
  | "memory"
  | "ledger"
  | "workspace"
  | "workspace.drafts"
  | "workspace.material"
  | "workspace.prep";

const EXPANDABLE_KEYS: readonly ExpandableKey[] = [
  "world",
  "world.ungrouped",
  "world.characters",
  "outline",
  "outline.skeleton",
  "outline.volumes",
  "canon",
  "memory",
  "ledger",
  "workspace",
  "workspace.drafts",
  "workspace.material",
  "workspace.prep",
];

const VOLUME_KEY_PREFIX = "volume:";
const WORLD_GROUP_KEY_PREFIX = "world.group.";
const CHAPTER_VERSION_KEY_PREFIX = "chapter.v.";

/** The 草稿区 workspace (and its draft chapters) starts open — the primary
 * asset; everything else starts collapsed to keep the rail scannable. */
const DEFAULT_EXPANDED: Readonly<Record<string, boolean>> = {
  workspace: true,
  "workspace.drafts": true,
};

/** localStorage key so a novel's tree state survives remounts and reloads. */
function expandStateKey(novelId: string) {
  return `novara:tree-expanded:${novelId}`;
}

function loadExpandState(novelId: string): Record<string, boolean> {
  const base: Record<string, boolean> = { ...DEFAULT_EXPANDED };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(expandStateKey(novelId));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      const known =
        (EXPANDABLE_KEYS as readonly string[]).includes(key) ||
        key.startsWith(VOLUME_KEY_PREFIX) ||
        key.startsWith(WORLD_GROUP_KEY_PREFIX) ||
        key.startsWith(CHAPTER_VERSION_KEY_PREFIX);
      if (known && typeof value === "boolean") {
        base[key] = value;
      }
    }
    return base;
  } catch {
    return base;
  }
}

/** 本书记忆 tree sub-rows (Phase 9): key is the store's memory deep-link
 * focus value ("all" | MemoryCategory), label is the Chinese sub-row name. */
const MEMORY_TREE_ROWS: readonly { key: string; label: string }[] = [
  { key: "all", label: "索引" },
  { key: "decision", label: "决策" },
  { key: "dialogue", label: "对话" },
  { key: "style", label: "文风" },
  { key: "inspiration", label: "灵感" },
];

interface AssetTreeProps {
  detail: NovelDetail;
  /** Live agent tasks (may be empty — no active run). */
  tasks: AgentTask[];
  selectedChapterId: string | null;
  selectedBeatId: string | null;
  selectedCharacterId: string | null;
  selectedWorldId: string | null;
  /** Active volume row in 卷规划 — highlighted like a file. */
  selectedVolumeId?: string | null;
  /** Open chapter pack, key shape `${kind}:${chapterIndex}` (e.g. "material:9"). */
  selectedPackKey?: string | null;
  onOpenChapter: (chapterId: string) => void;
  onOpenBeat: (beatId: string) => void;
  onOpenCharacter: (characterId: string) => void;
  onOpenWorld: (worldId: string) => void;
  /** Opens the volume's plan document in the Outline artifact view. */
  onOpenVolume: (volumeId: string) => void;
  /** Opens a chapter pack document in the Packs artifact view. */
  onOpenPack: (kind: ChapterPackKind, chapterIndex: number) => void;
  /** Requests a new chapter pack of the given kind. */
  onAddPack: (kind: ChapterPackKind) => void;
  /** Opens a finalized chapter (canon read view). */
  onOpenCanonChapter: (chapterId: string) => void;
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
  selectedPackKey,
  onOpenChapter,
  onOpenBeat,
  onOpenCharacter,
  onOpenWorld,
  onOpenVolume,
  onOpenPack,
  onAddPack,
  onOpenCanonChapter,
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
  // Deep-link focus writers (Phase 9): memory/ledger tree sub-rows preselect
  // the target tab's category/kind before opening it.
  const setMemoryFocus = useWriterStore((s) => s.setMemoryFocus);
  const setLedgerKind = useWriterStore((s) => s.setLedgerKind);

  // Collapse state (file-explorer style). The 草稿区 workspace starts open —
  // the primary asset; the rest start collapsed. The state persists per novel
  // in localStorage so the explorer "stays as you left it" across remounts.
  const [expanded, setExpandedState] = useState<Record<string, boolean>>(
    () => loadExpandState(novel.id)
  );
  const isExpanded = (key: string): boolean =>
    expanded[key] ?? DEFAULT_EXPANDED[key] ?? false;
  const setExpanded = (next: Record<string, boolean>) => {
    setExpandedState(next);
    try {
      window.localStorage.setItem(expandStateKey(novel.id), JSON.stringify(next));
    } catch {
      // Storage may be unavailable (private mode) — state still works in-memory.
    }
  };
  const toggle = (key: string) =>
    setExpanded({ ...expanded, [key]: !isExpanded(key) });

  // Search — a derived view on top of the tree. While a query is active the
  // groups render force-expanded, but `expanded` itself is never written, so
  // clearing the query restores the exact previous expand/collapse state.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const matchesQuery = (text: string) => text.toLowerCase().includes(q);

  // Beat entries keep their original positional index so "NN" prefixes stay
  // stable no matter how beats are grouped.
  const beatEntries = detail.outlineBeats.map((beat, index) => ({ beat, index }));
  const unsortedBeats = beatEntries.filter(({ beat }) => beat.volumeId === null);
  const beatsByVolume = new Map<string, { beat: OutlineBeatDTO; index: number }[]>();
  for (const entry of beatEntries) {
    if (entry.beat.volumeId) {
      const list = beatsByVolume.get(entry.beat.volumeId) ?? [];
      list.push(entry);
      beatsByVolume.set(entry.beat.volumeId, list);
    }
  }
  const sortedVolumes = [...detail.volumes].sort((a, b) => a.index - b.index);

  // 世界书 second-level groups (Phase 9): one sub-group per WorldGroupDTO,
  // ordered, plus an 未分组 bucket for entries with groupId === null.
  const sortedWorldGroups = [...detail.worldGroups].sort((a, b) => a.order - b.order);
  const worldEntriesInGroup = (groupId: string) =>
    detail.worldEntries.filter((w) => w.groupId === groupId);
  const ungroupedWorldEntries = detail.worldEntries.filter(
    (w) => w.groupId === null
  );

  // 稿N draft versions grouped per chapter — chapters with versions render as
  // expandable rows whose children are the 稿N version files.
  const versionsByChapter = new Map<string, ChapterVersionSummaryDTO[]>();
  for (const version of detail.versions) {
    const list = versionsByChapter.get(version.chapterId) ?? [];
    list.push(version);
    versionsByChapter.set(version.chapterId, list);
  }
  for (const list of versionsByChapter.values()) {
    list.sort((a, b) => a.draftNo - b.draftNo);
  }

  const materialPacks = detail.packs
    .filter((p) => p.kind === "material")
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
  const prepPacks = detail.packs
    .filter((p) => p.kind === "prep")
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
  const finalChapters = detail.chapters.filter((ch) => ch.status === "final");
  const canonLabel = (ch: ChapterDTO) =>
    `${String(ch.index).padStart(4, "0")}-${ch.title}`;

  // Search filtering — file rows match by label; matching a zone/group name
  // (世界书/未分组/故事骨架/…) surfaces that zone's whole contents. Ledger and
  // memory sub-row labels and 稿N version rows participate in the same logic.
  const chapterVersionEntries = (ch: ChapterDTO) => {
    const all = versionsByChapter.get(ch.id) ?? [];
    if (!searching) return all;
    return matchesQuery(ch.title) || matchesQuery("草稿") || matchesQuery("草稿区")
      ? all
      : all.filter((v) => matchesQuery(`稿${v.draftNo}`));
  };
  const visibleChapters = searching
    ? detail.chapters.filter(
        (ch) =>
          matchesQuery(ch.title) ||
          matchesQuery("草稿") ||
          matchesQuery("草稿区") ||
          (versionsByChapter.get(ch.id) ?? []).some((v) =>
            matchesQuery(`稿${v.draftNo}`)
          )
      )
    : detail.chapters;
  const visibleUnsortedBeats = searching
    ? unsortedBeats.filter(
        ({ beat }) =>
          matchesQuery(beat.title) || matchesQuery("故事骨架") || matchesQuery("大纲")
      )
    : unsortedBeats;
  const volumeMatchesQuery = (v: VolumeDTO) =>
    matchesQuery(v.title) ||
    matchesQuery("卷规划") ||
    matchesQuery("大纲") ||
    (beatsByVolume.get(v.id) ?? []).some(({ beat }) => matchesQuery(beat.title));
  const visibleVolumes = searching
    ? sortedVolumes.filter((v) => volumeMatchesQuery(v))
    : sortedVolumes;
  const volumeBeatEntries = (v: VolumeDTO) => {
    const all = beatsByVolume.get(v.id) ?? [];
    if (!searching) return all;
    return matchesQuery(v.title) || matchesQuery("卷规划") || matchesQuery("大纲")
      ? all
      : all.filter(({ beat }) => matchesQuery(beat.title));
  };
  const visibleCharacters = searching
    ? detail.characters.filter(
        (c) =>
          matchesQuery(c.name) || matchesQuery("人物档案") || matchesQuery("世界书")
      )
    : detail.characters;
  // World entries surface per group: a group-name hit exposes the whole group,
  // otherwise entries match by title (matching the group label itself too).
  const worldGroupMatchesQuery = (g: WorldGroupDTO) =>
    matchesQuery(g.name) || matchesQuery("世界书");
  const worldGroupVisibleEntries = (g: WorldGroupDTO): WorldEntryDTO[] => {
    const entries = worldEntriesInGroup(g.id);
    if (!searching) return entries;
    return worldGroupMatchesQuery(g)
      ? entries
      : entries.filter((w) => matchesQuery(w.title));
  };
  const visibleUngroupedWorld = searching
    ? matchesQuery("未分组") || matchesQuery("世界书")
      ? ungroupedWorldEntries
      : ungroupedWorldEntries.filter((w) => matchesQuery(w.title))
    : ungroupedWorldEntries;
  const visibleWorld = searching
    ? [
        ...sortedWorldGroups.flatMap((g) => worldGroupVisibleEntries(g)),
        ...visibleUngroupedWorld,
      ]
    : detail.worldEntries;
  const visibleMaterial = searching
    ? materialPacks.filter(
        (p) =>
          matchesQuery(p.title) || matchesQuery("材料包") || matchesQuery("草稿区")
      )
    : materialPacks;
  const visiblePrep = searching
    ? prepPacks.filter(
        (p) =>
          matchesQuery(p.title) || matchesQuery("定稿准备") || matchesQuery("草稿区")
      )
    : prepPacks;
  const visibleFinals = searching
    ? finalChapters.filter(
        (ch) => matchesQuery(canonLabel(ch)) || matchesQuery("定稿")
      )
    : finalChapters;

  // Single document rows (作品契约/章摘要/构想/审核) — matched by their
  // Chinese label or an English alias.
  const contractMatch = matchesQuery("作品契约") || matchesQuery("contract");
  const digestMatch = matchesQuery("章摘要") || matchesQuery("digest");
  const memoryMatch = matchesQuery("本书记忆") || matchesQuery("memory");
  const conceptMatch = matchesQuery("构想") || matchesQuery("concept");
  const ledgerMatch = matchesQuery("账本") || matchesQuery("ledger");
  const reviewMatch = matchesQuery("审核") || matchesQuery("review");

  // 账本 sub-rows — live counts from the five ledgers (Phase 9). Clicking a
  // row writes the ledger deep-link focus, then opens the ledger tab.
  const ledgerRows: { kind: string; label: string; count: number }[] = [
    { kind: "storyline", label: "故事线", count: detail.ledger.storylines.length },
    { kind: "timeline", label: "时间线", count: detail.ledger.timeline.length },
    { kind: "arc", label: "人物弧线", count: detail.ledger.arcs.length },
    { kind: "promise", label: "承诺", count: detail.ledger.promises.length },
    { kind: "clue", label: "线索", count: detail.ledger.clues.length },
  ];

  // Zone matches: the group label (本书记忆/账本) OR any of its sub-row labels.
  const memoryZoneMatch =
    memoryMatch || MEMORY_TREE_ROWS.some((row) => matchesQuery(row.label));
  const ledgerZoneMatch =
    ledgerMatch || ledgerRows.some((row) => matchesQuery(row.label));

  const anyMatch =
    visibleChapters.length > 0 ||
    visibleUnsortedBeats.length > 0 ||
    visibleVolumes.length > 0 ||
    visibleCharacters.length > 0 ||
    visibleWorld.length > 0 ||
    visibleMaterial.length > 0 ||
    visiblePrep.length > 0 ||
    visibleFinals.length > 0 ||
    contractMatch ||
    digestMatch ||
    memoryZoneMatch ||
    conceptMatch ||
    ledgerZoneMatch ||
    reviewMatch;

  const totalWords = detail.chapters.reduce((s, c) => s + c.wordCount, 0);
  const pct = novel.targetWords
    ? Math.min(100, Math.round((totalWords / novel.targetWords) * 100))
    : 0;

  const novelBadges = badges.get("novel");

  // Shared row renderers -----------------------------------------------------

  /** Leading Lock glyph for canon-locked (status "final") asset files. */
  const canonLockIcon = (locked: boolean): React.ReactNode =>
    locked ? (
      <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    ) : undefined;

  const renderWorldFile = (w: WorldEntryDTO) => (
    <TreeFile
      key={w.id}
      label={w.title}
      icon={canonLockIcon(w.status === "final")}
      selected={w.id === selectedWorldId}
      onClick={() => onOpenWorld(w.id)}
      badges={badges.get(`world:${w.id}`)}
    />
  );

  const renderBeatFile = ({ beat, index }: { beat: OutlineBeatDTO; index: number }) => (
    <TreeFile
      key={beat.id}
      label={beat.title}
      prefix={String(index + 1).padStart(2, "0")}
      icon={canonLockIcon(beat.status === "final")}
      selected={beat.id === selectedBeatId}
      onClick={() => onOpenBeat(beat.id)}
      badges={badges.get(`beat:${beat.id}`)}
    />
  );

  /** Status-dot + word-count trailing for draft chapter rows (shared by the
   * plain file row and the expandable 稿N node). */
  const chapterTrailing = (ch: ChapterDTO) => (
    <>
      {ch.wordCount > 0 && (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {formatWordCount(ch.wordCount)}
        </span>
      )}
      {ch.status !== "draft" && (
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            ch.status === "final" ? "bg-emerald-600" : "bg-amber-500"
          )}
          aria-label={ch.status}
        />
      )}
    </>
  );

  const renderChapterFile = (ch: ChapterDTO) => (
    <TreeFile
      key={ch.id}
      label={ch.title}
      prefix={String(ch.index).padStart(2, "0")}
      selected={ch.id === selectedChapterId}
      onClick={() => onOpenChapter(ch.id)}
      badges={badges.get(`chapter:${ch.index}`)}
      trailing={chapterTrailing(ch)}
    />
  );

  /** Draft chapter row: plain file when versionless, otherwise an expandable
   * node listing 稿N version files (children open the chapter's draft view,
   * which hosts the version history). */
  const renderChapterRow = (ch: ChapterDTO) => {
    const versions = chapterVersionEntries(ch);
    if (versions.length === 0) return renderChapterFile(ch);
    return (
      <TreeChapterNode
        key={ch.id}
        index={ch.index}
        label={ch.title}
        count={(versionsByChapter.get(ch.id) ?? []).length}
        selected={ch.id === selectedChapterId}
        expanded={searching ? true : isExpanded(`${CHAPTER_VERSION_KEY_PREFIX}${ch.id}`)}
        onToggle={
          searching
            ? undefined
            : () => toggle(`${CHAPTER_VERSION_KEY_PREFIX}${ch.id}`)
        }
        onOpen={() => onOpenChapter(ch.id)}
        badges={badges.get(`chapter:${ch.index}`)}
        trailing={chapterTrailing(ch)}
      >
        {versions.map((v) => (
          <TreeFile
            key={v.id}
            label={`稿${v.draftNo}`}
            onClick={() => onOpenChapter(ch.id)}
            trailing={
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {formatWordCount(v.wordCount)}
                {v.createdBy === "agent" ? " AI" : ""}
              </span>
            }
          />
        ))}
      </TreeChapterNode>
    );
  };

  const renderPackFile = (kind: ChapterPackKind) => (pack: ChapterPackDTO) => (
    <TreeFile
      key={pack.id}
      label={pack.title}
      selected={selectedPackKey === `${kind}:${pack.chapterIndex}`}
      onClick={() => onOpenPack(kind, pack.chapterIndex)}
      trailing={
        <span className="shrink-0 text-[10px] text-muted-foreground">
          第{pack.chapterIndex}章
        </span>
      }
    />
  );

  const addChapterButton = (
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
  );

  const addPackButton = (kind: ChapterPackKind, label: string) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0"
      onClick={() => onAddPack(kind)}
      aria-label={label}
    >
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  );

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

          {/* 世界书 — dynamic world groups + 未分组 + character files */}
          {(!searching || visibleWorld.length > 0 || visibleCharacters.length > 0) && (
            <TreeGroup
              icon={<Globe2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="世界书"
              count={detail.worldEntries.length + detail.characters.length}
              expanded={searching ? true : isExpanded("world")}
              onToggle={searching ? undefined : () => toggle("world")}
            >
              {/* One sub-group per 世界书 group, in defined order. A group-name
                  hit while searching exposes the whole group; otherwise its
                  entries match by title. Empty groups render when idle. */}
              {sortedWorldGroups.map((g) => {
                const entries = worldGroupVisibleEntries(g);
                const expandKey = `${WORLD_GROUP_KEY_PREFIX}${g.id}`;
                if (searching && entries.length === 0) return null;
                return (
                  <TreeSubGroup
                    key={g.id}
                    label={g.name}
                    count={worldEntriesInGroup(g.id).length}
                    expanded={searching ? true : isExpanded(expandKey)}
                    onToggle={searching ? undefined : () => toggle(expandKey)}
                  >
                    {entries.length > 0 ? (
                      entries.map(renderWorldFile)
                    ) : (
                      !searching && <TreeEmptyRow />
                    )}
                  </TreeSubGroup>
                );
              })}
              {/* 未分组 — ungrouped entries; hidden entirely until one exists
                  (also hosts the agent world_entry fallback badge). */}
              {ungroupedWorldEntries.length > 0 &&
                (!searching || visibleUngroupedWorld.length > 0) && (
                  <TreeSubGroup
                    label="未分组"
                    count={ungroupedWorldEntries.length}
                    badges={badges.get("group:world.ungrouped")}
                    expanded={searching ? true : isExpanded("world.ungrouped")}
                    onToggle={searching ? undefined : () => toggle("world.ungrouped")}
                  >
                    {visibleUngroupedWorld.map(renderWorldFile)}
                  </TreeSubGroup>
                )}
              {(!searching || visibleCharacters.length > 0) && (
                <TreeSubGroup
                  label="人物档案"
                  count={detail.characters.length}
                  expanded={searching ? true : isExpanded("world.characters")}
                  onToggle={searching ? undefined : () => toggle("world.characters")}
                >
                  {visibleCharacters.length > 0 ? (
                    visibleCharacters.map((c) => (
                      <TreeFile
                        key={c.id}
                        label={c.name}
                        icon={canonLockIcon(c.status === "final")}
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
                    ))
                  ) : (
                    !searching && <TreeEmptyRow />
                  )}
                </TreeSubGroup>
              )}
            </TreeGroup>
          )}

          {/* 作品契约 — single document row → contract tab */}
          {(!searching || contractMatch) && (
            <TreeDocRow
              icon={<ScrollText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="作品契约"
              subtitle={detail.contract ? "已写入" : "未写入"}
              onClick={() => onOpenArtifactTab("contract")}
            />
          )}

          {/* 大纲 — story skeleton + volume plans + chapter digests */}
          {(!searching ||
            visibleUnsortedBeats.length > 0 ||
            visibleVolumes.length > 0 ||
            digestMatch) && (
            <TreeGroup
              icon={<ListTree className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="大纲"
              count={detail.outlineBeats.length}
              badges={badges.get("group:outline")}
              expanded={searching ? true : isExpanded("outline")}
              onToggle={searching ? undefined : () => toggle("outline")}
            >
              {(!searching || visibleUnsortedBeats.length > 0) && (
                <TreeSubGroup
                  label="故事骨架"
                  count={unsortedBeats.length}
                  expanded={searching ? true : isExpanded("outline.skeleton")}
                  onToggle={searching ? undefined : () => toggle("outline.skeleton")}
                >
                  {visibleUnsortedBeats.length > 0 ? (
                    visibleUnsortedBeats.map(renderBeatFile)
                  ) : (
                    !searching && <TreeEmptyRow />
                  )}
                </TreeSubGroup>
              )}
              {(!searching || visibleVolumes.length > 0) && (
                <TreeSubGroup
                  label="卷规划"
                  count={detail.volumes.length}
                  expanded={searching ? true : isExpanded("outline.volumes")}
                  onToggle={searching ? undefined : () => toggle("outline.volumes")}
                >
                  {visibleVolumes.length > 0 ? (
                    visibleVolumes.map((v) => {
                      const beats = volumeBeatEntries(v);
                      return (
                        <TreeVolumeNode
                          key={v.id}
                          volume={v}
                          count={(beatsByVolume.get(v.id) ?? []).length}
                          icon={canonLockIcon(v.status === "final")}
                          selected={v.id === selectedVolumeId}
                          expanded={searching ? true : isExpanded(`volume:${v.id}`)}
                          onToggle={
                            searching ? undefined : () => toggle(`volume:${v.id}`)
                          }
                          onOpen={() => onOpenVolume(v.id)}
                        >
                          {beats.length > 0 ? (
                            beats.map(renderBeatFile)
                          ) : (
                            !searching && <TreeEmptyRow />
                          )}
                        </TreeVolumeNode>
                      );
                    })
                  ) : (
                    !searching && <TreeEmptyRow />
                  )}
                </TreeSubGroup>
              )}
              {(!searching || digestMatch) && (
                <TreeDocRow
                  icon={<NotebookPen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  label="章摘要"
                  onClick={() => onOpenArtifactTab("outline")}
                />
              )}
            </TreeGroup>
          )}

          {/* 定稿 — zero-padded final chapter files (hidden while empty) */}
          {finalChapters.length > 0 &&
            (!searching || visibleFinals.length > 0) && (
              <TreeGroup
                icon={<Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                label="定稿"
                count={finalChapters.length}
                expanded={searching ? true : isExpanded("canon")}
                onToggle={searching ? undefined : () => toggle("canon")}
              >
                {visibleFinals.map((ch) => (
                  <TreeFile
                    key={ch.id}
                    label={canonLabel(ch)}
                    icon={
                      <Lock
                        className="h-3 w-3 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    }
                    muted
                    selected={ch.id === selectedChapterId}
                    onClick={() => onOpenCanonChapter(ch.id)}
                  />
                ))}
              </TreeGroup>
            )}

          {/* 本书记忆 — expandable group: 索引/决策/对话/文风/灵感 sub-rows.
              Clicking a row writes the store's memory deep-link focus, then
              opens the memory tab with that category preselected. */}
          {(!searching || memoryZoneMatch) && (
            <TreeGroup
              icon={<Brain className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="本书记忆"
              expanded={searching ? true : isExpanded("memory")}
              onToggle={searching ? undefined : () => toggle("memory")}
            >
              {MEMORY_TREE_ROWS.filter(
                (row) => !searching || memoryMatch || matchesQuery(row.label)
              ).map((row) => (
                <TreeFile
                  key={row.key}
                  label={row.label}
                  onClick={() => {
                    setMemoryFocus(novel.id, row.key);
                    onOpenArtifactTab("memory");
                  }}
                />
              ))}
            </TreeGroup>
          )}

          {/* 构想 — single document row → contract tab (hosts 契约 + 快照) */}
          {(!searching || conceptMatch) && (
            <TreeDocRow
              icon={<Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="构想"
              subtitle={novel.conceptSnapshot ? "已快照" : "未快照"}
              onClick={() => onOpenArtifactTab("contract")}
            />
          )}

          {/* 账本 — expandable group: 故事线/时间线/人物弧线/承诺/线索 sub-rows
              with live counts. Clicking writes the ledger deep-link focus,
              then opens the ledger tab with that kind preselected. */}
          {(!searching || ledgerZoneMatch) && (
            <TreeGroup
              icon={<NotebookPen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              label="账本"
              expanded={searching ? true : isExpanded("ledger")}
              onToggle={searching ? undefined : () => toggle("ledger")}
            >
              {ledgerRows.filter(
                (row) => !searching || ledgerMatch || matchesQuery(row.label)
              ).map((row) => (
                <TreeFile
                  key={row.kind}
                  label={row.label}
                  onClick={() => {
                    setLedgerKind(novel.id, row.kind);
                    onOpenArtifactTab("ledger");
                  }}
                  trailing={
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {row.count}
                    </span>
                  }
                />
              ))}
            </TreeGroup>
          )}

          {/* 草稿区 — drafts + packs + review */}
          <TreeGroup
            icon={<PenLine className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            label="草稿区"
            expanded={searching ? true : isExpanded("workspace")}
            onToggle={searching ? undefined : () => toggle("workspace")}
          >
            {(!searching || visibleChapters.length > 0) && (
              <TreeSubGroup
                label="草稿"
                count={detail.chapters.length}
                badges={badges.get("group:drafts")}
                expanded={searching ? true : isExpanded("workspace.drafts")}
                onToggle={searching ? undefined : () => toggle("workspace.drafts")}
                action={addChapterButton}
              >
                {visibleChapters.length > 0 ? (
                  visibleChapters.map(renderChapterRow)
                ) : (
                  !searching && <TreeEmptyRow />
                )}
              </TreeSubGroup>
            )}
            {(!searching || visibleMaterial.length > 0) && (
              <TreeSubGroup
                label="材料包"
                count={materialPacks.length}
                expanded={searching ? true : isExpanded("workspace.material")}
                onToggle={searching ? undefined : () => toggle("workspace.material")}
                action={addPackButton("material", "Add material pack")}
              >
                {visibleMaterial.length > 0 ? (
                  visibleMaterial.map(renderPackFile("material"))
                ) : (
                  !searching && <TreeEmptyRow />
                )}
              </TreeSubGroup>
            )}
            {(!searching || visiblePrep.length > 0) && (
              <TreeSubGroup
                label="定稿准备"
                count={prepPacks.length}
                expanded={searching ? true : isExpanded("workspace.prep")}
                onToggle={searching ? undefined : () => toggle("workspace.prep")}
                action={addPackButton("prep", "Add prep pack")}
              >
                {visiblePrep.length > 0 ? (
                  visiblePrep.map(renderPackFile("prep"))
                ) : (
                  !searching && <TreeEmptyRow />
                )}
              </TreeSubGroup>
            )}
            {(!searching || reviewMatch) && (
              <TreeDocRow
                icon={<FileSearch className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                label="审核"
                onClick={() => onOpenArtifactTab("review")}
              />
            )}
          </TreeGroup>
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
// Group row — expandable groups toggle collapse via chevron or label click
// ---------------------------------------------------------------------------

function TreeGroup({
  icon,
  label,
  count,
  badges,
  expanded,
  onToggle,
  action,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  badges?: NodeBadge[];
  /** Presence of onToggle makes the group expandable: both the chevron and
   * the label toggle collapse. While searching, onToggle is omitted and
   * expanded is forced true (never written back to state). */
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
          "flex min-h-10 items-center gap-1 rounded-md pr-1 transition-colors",
          "hover:bg-accent/60"
        )}
      >
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${label} — expand or collapse`}
            className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("h-5 w-5 transition-transform", expanded && "rotate-90")}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="h-8 w-7 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={expandable ? onToggle : undefined}
          aria-expanded={expandable ? expanded : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {label}
            {typeof count === "number" && (
              <span className="ml-1.5 text-xs text-muted-foreground">({count})</span>
            )}
          </span>
          <BadgeIcons badges={badges} />
        </button>
        {action}
      </div>
      {expanded && children != null && <ul className="ml-3 border-l pl-2">{children}</ul>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Sub-group row — nested one level inside a group: small caps label, its own
// chevron collapse, and optional trailing action (e.g. "+" add buttons).
// ---------------------------------------------------------------------------

function TreeSubGroup({
  label,
  count,
  badges,
  expanded,
  onToggle,
  action,
  children,
}: {
  label: string;
  count?: number;
  badges?: NodeBadge[];
  expanded?: boolean;
  onToggle?: () => void;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const expandable = typeof expanded === "boolean" && !!onToggle;
  return (
    <li>
      <div
        className={cn(
          "flex min-h-10 items-center gap-1 rounded-md pr-1 transition-colors",
          "hover:bg-accent/60"
        )}
      >
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${label} — expand or collapse`}
            className="flex h-8 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="h-8 w-6 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={expandable ? onToggle : undefined}
          aria-expanded={expandable ? expanded : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
            {typeof count === "number" && (
              <span className="ml-1.5">({count})</span>
            )}
          </span>
          <BadgeIcons badges={badges} />
        </button>
        {action}
      </div>
      {expanded && children != null && <ul className="ml-2 border-l pl-1.5">{children}</ul>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Document row — a single clickable file that opens an artifact view
// (作品契约 / 章摘要 / 构想 / 审核)
// ---------------------------------------------------------------------------

function TreeDocRow({
  icon,
  label,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** Small trailing status text, e.g. "已写入" / "未快照". */
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          "hover:bg-accent/60"
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        {subtitle && (
          <span className="shrink-0 text-[10px] text-muted-foreground">{subtitle}</span>
        )}
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// File row — a clickable child asset (chapter / beat / character / world /
// pack / canon file)
// ---------------------------------------------------------------------------

function TreeFile({
  label,
  prefix,
  icon,
  selected,
  muted,
  onClick,
  badges,
  trailing,
}: {
  label: string;
  /** Mono index prefix, e.g. "03". */
  prefix?: string;
  /** Optional leading glyph (e.g. the Lock on 定稿 files). */
  icon?: React.ReactNode;
  selected?: boolean;
  /** Dimmed label styling (定稿 rows are read-only archive files). */
  muted?: boolean;
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
          "flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
          selected ? "bg-accent" : "hover:bg-accent/60"
        )}
      >
        {icon}
        {prefix && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {prefix}
          </span>
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            muted && "text-muted-foreground"
          )}
        >
          {label}
        </span>
        {trailing}
        <BadgeIcons badges={badges} />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Volume node — a volume row inside 卷规划 (P1). Clicking the row opens the
// volume plan document; the chevron collapses its beat files.
// ---------------------------------------------------------------------------

function TreeVolumeNode({
  volume,
  count,
  selected,
  expanded,
  onToggle,
  onOpen,
  icon,
  children,
}: {
  volume: VolumeDTO;
  count: number;
  selected?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  /** Optional leading glyph (e.g. the canon Lock on final volumes). */
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const expandable = typeof expanded === "boolean" && !!onToggle;
  return (
    <li>
      <div
        className={cn(
          "flex min-h-10 items-center gap-1 rounded-md pr-1 transition-colors",
          selected ? "bg-accent" : "hover:bg-accent/60"
        )}
      >
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${volume.title} — expand or collapse beats`}
            className="flex h-8 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="h-8 w-6 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={onOpen}
          aria-current={selected ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          {icon}
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            V{String(volume.index).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {volume.title}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">({count})</span>
        </button>
      </div>
      {expanded && children != null && <ul className="ml-3 border-l pl-2">{children}</ul>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Chapter node — a draft chapter row inside 草稿 that owns 稿N version files
// (Phase 9). Modeled after TreeVolumeNode: the chevron collapses the version
// list, clicking the row opens the chapter. Chapters without versions render
// as plain TreeFile rows instead.
// ---------------------------------------------------------------------------

function TreeChapterNode({
  index,
  label,
  count,
  selected,
  expanded,
  onToggle,
  onOpen,
  badges,
  trailing,
  children,
}: {
  index: number;
  label: string;
  /** Number of 稿N versions under this chapter. */
  count: number;
  selected?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  badges?: NodeBadge[];
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const expandable = typeof expanded === "boolean" && !!onToggle;
  return (
    <li>
      <div
        className={cn(
          "flex min-h-10 items-center gap-1 rounded-md pr-1 transition-colors",
          selected ? "bg-accent" : "hover:bg-accent/60"
        )}
      >
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${label} — expand or collapse draft versions`}
            className="flex h-8 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="h-8 w-6 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={onOpen}
          aria-current={selected ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {String(index).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">({count})</span>
          {trailing}
          <BadgeIcons badges={badges} />
        </button>
      </div>
      {expanded && children != null && <ul className="ml-3 border-l pl-2">{children}</ul>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Empty row — muted placeholder shown when an expanded group has no children
// (the 定稿 group hides entirely instead).
// ---------------------------------------------------------------------------

function TreeEmptyRow() {
  return (
    <li
      className="px-2 py-1.5 text-xs text-muted-foreground"
      aria-label="empty"
    >
      empty
    </li>
  );
}
