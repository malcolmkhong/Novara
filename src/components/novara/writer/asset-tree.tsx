"use client";

// ---------------------------------------------------------------------------
// Novara AI — STEP 76: the left rail.
//
// The rail keeps its chrome (the novel's identity, the Write|Book switch, ONE
// search line) and renders the DOCUMENT TREE in Book mode — every row is a
// folder or a document (RULE 1). The tree itself is built by `buildDocTree`
// (src/lib/novara/doc-tree.ts); this file only renders it.
//
// The search line filters the tree by row label (folder names included) while
// the query is active (matching folders render force-expanded); clearing it
// restores the exact previous expand/collapse state.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type {
  AgentRun,
  AgentTask,
} from "@/lib/novara/agent-types";
import { RUN_STATUS_META } from "@/config/writer";
import { relativeTime, type DocNode, type Node } from "@/lib/novara/doc-tree";
import type { NovelDetail } from "@/lib/novara/types";
import { formatWordCount } from "@/lib/novara/words";
import { cn } from "@/lib/utils";
import { useWriterStore } from "@/hooks/use-writer-store";
import { DocTreePanel } from "./doc-tree-panel";
import { BadgeIcons, buildTreeBadges } from "./tree-badges";
import { IconTooltip, Spinner, ToggleButton } from "@/components/novara/primitives";
import { TEXT_CAPTION } from "@/components/novara/styles";

// ---------------------------------------------------------------------------
// Collapse state (file-explorer style). Persisted per novel in localStorage
// so the explorer "stays as you left it" across remounts. STEP 76: the keys
// are the tree's own folder ids ("f:<name>").
// ---------------------------------------------------------------------------

/** The folders that start open. The Runs folder stays closed (A2). */
const DEFAULT_EXPANDED: Record<string, boolean> = {
  "f:outline": true,
  "f:chapters": true,
};

function expandStateKey(novelId: string): string {
  return `novara:tree-expanded:${novelId}`;
}

/** Read the persisted collapse state. Only known folder ids are kept. */
function loadExpandState(novelId: string): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(expandStateKey(novelId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("f:") && typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

interface AssetTreeProps {
  detail: NovelDetail;
  /** Live agent tasks (may be empty — no active run). */
  tasks: AgentTask[];
  /** This novel's agent runs (the Write-mode list). */
  runs: AgentRun[];
  /** The run list is still loading. */
  runsLoading: boolean;
  /** The document tree (Book mode). */
  tree: Node[];
  /** Open a document row. */
  onOpenDoc: (node: DocNode) => void;
  onAddChapter: () => Promise<void>;
  onEditDetails: () => void;
  onExport: () => void;
  onDelete: () => void;
  /** Adding chapter in flight (button spinner). */
  addingChapter?: boolean;
  /**
   * STEP 65 — the rail's Write mode. Clicking a run row loads it through the
   * SAME path the conversation pane's history switcher uses (viewRun), so no
   * second loader exists.
   */
  onOpenRun: (runId: string) => void;
  /** The run currently shown in the centre column — highlighted in the list. */
  currentRunId?: string | null;
  /** STEP 65 — the rail's gear button opens the settings dialog. */
  onOpenSettings: () => void;
}

export function AssetTree({
  detail,
  tasks,
  runs,
  runsLoading,
  tree,
  onOpenDoc,
  onAddChapter,
  onEditDetails,
  onExport,
  onDelete,
  addingChapter = false,
  onOpenRun,
  currentRunId = null,
  onOpenSettings,
}: AssetTreeProps) {
  const { novel } = detail;
  const badges = buildTreeBadges(
    tasks,
    detail.chapters.map((c) => c.index)
  );

  // STEP 65 — the rail has TWO modes instead of eight peers: "write" (this
  // novel's agent runs) and "book" (the document tree). The choice is per novel
  // and persisted in the writer store; the default on first load is "book".
  const mode = useWriterStore((s) => s.railModeByNovel[novel.id] ?? "book");
  const setRailMode = useWriterStore((s) => s.setRailMode);
  // The document the pane has open — the tree highlights it.
  const activeDocId = useWriterStore((s) => s.activeDocByNovel[novel.id] ?? null);

  // Collapse state (file-explorer style), persisted per novel.
  const [expanded, setExpandedState] = useState<Record<string, boolean>>(() =>
    loadExpandState(novel.id)
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
  // folders render force-expanded, but `expanded` itself is never written, so
  // clearing the query restores the exact previous expand/collapse state.
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const totalWords = detail.chapters.reduce((s, c) => s + c.wordCount, 0);
  const pct = novel.targetWords
    ? Math.min(100, Math.round((totalWords / novel.targetWords) * 100))
    : 0;

  // The search line filters the run list in Write mode (the tree filter lives
  // in the tree panel itself).
  const visibleRuns = q
    ? runs.filter((run) => run.goal.toLowerCase().includes(q))
    : runs;

  const novelBadges = badges.get("novel");

  // Live task badges, keyed by the node's asset identity (not its row id).
  const chapterIndexById = new Map(detail.chapters.map((c) => [c.id, c.index]));
  const badgeKeysFor = (node: Node): string[] => {
    if (node.kind === "folder") {
      if (node.id === "f:chapters") return ["group:drafts"];
      if (node.id === "f:characters") return ["group:world.characters"];
      if (node.id === "f:world.ungrouped") return ["group:world.ungrouped"];
      if (node.id === "f:outline") return ["group:outline"];
      return [];
    }
    switch (node.doc) {
      case "chapter": {
        const index = chapterIndexById.get(node.ref);
        return index === undefined ? [] : [`chapter:${index}`];
      }
      case "character":
        return [`character:${node.ref}`];
      case "world_entry":
        return [`world:${node.ref}`];
      case "beat":
        return [`beat:${node.ref}`];
      default:
        return [];
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* TOP BLOCK — the novel's identity. The three actions that used to sit
          here as full-width buttons moved into ONE overflow menu on the title
          row (same handlers, same confirmations).
          The block is exactly the shared workbench band height, so its bottom
          border lands on the same horizontal line as the chat header and the
          document pane header. */}
      <div className="min-h-[var(--workbench-head-h,112px)] overflow-hidden border-b px-3 pb-2 pt-3">
        <div className="flex items-center gap-1.5">
          <h2 className="min-w-0 flex-1 truncate font-display text-sm font-semibold leading-tight">
            {novel.title}
          </h2>
          {novelBadges && <BadgeIcons badges={novelBadges} />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 p-0"
                aria-label="Novel actions"
                title="Novel actions"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={onEditDetails}>
                <Pencil className="size-3.5" aria-hidden="true" />
                Details
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onExport}>
                <Upload className="size-3.5 rotate-180" aria-hidden="true" />
                Export
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-1.5 flex flex-nowrap items-center gap-1.5 overflow-hidden">
          {novel.genre && <Badge variant="outline">{novel.genre}</Badge>}
          <Badge variant="outline" className="text-muted-foreground">
            {novel.status}
          </Badge>
        </div>
        <p className={cn("mt-1.5", TEXT_CAPTION)}>
          {formatWordCount(totalWords)} / {formatWordCount(novel.targetWords)} words
        </p>
        <Progress value={pct} className="mt-1 h-1" aria-label={`${pct}% of target length`} />
      </div>

      {/* SEGMENTED MODE CONTROL — Write (this novel's runs) | Book (the tree).
          50/50 split, 32px tall, 4px inset, 13px labels. */}
      <div className="px-2 py-2">
        <div
          role="group"
          aria-label="Rail mode"
          className="grid h-8 grid-cols-2 gap-1 rounded-md bg-muted/50 p-1"
        >
          {(
            [
              { id: "write" as const, label: "Write" },
              { id: "book" as const, label: "Book" },
            ] as const
          ).map(({ id, label }) => (
            <ToggleButton
              key={id}
              onClick={() => setRailMode(novel.id, id)}
              pressed={mode === id}
              baseClassName="rounded-sm text-small transition-colors"
              activeClassName="bg-background font-medium text-foreground shadow-sm"
              inactiveClassName="text-muted-foreground hover:text-foreground"
            >
              {label}
            </ToggleButton>
          ))}
        </div>
      </div>

      {/* ONE SEARCH LINE — [magnifier | Search] + [gear] + [+]. 32px tall,
          borderless, on the rail's header line (the grammar's "tiny icons on
          the section-header line"). In Book mode it filters the tree; in
          Write mode it filters the run list. */}
      <div className="flex h-8 shrink-0 items-center gap-1 px-2 pb-2">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            className="pointer-events-none absolute left-1 size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search assets"
            placeholder="Search"
            className="h-8 border-0 bg-transparent pl-6 pr-6 text-small shadow-none focus-visible:ring-0"
          />
          {query.length > 0 && (
            <IconTooltip label="Clear search">
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-0 flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </IconTooltip>
          )}
        </div>
        {/* Gear — the settings dialog (the same action as the user-menu row). */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 p-0"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="size-4" aria-hidden="true" />
        </Button>
        {/* "+" — the tree's existing asset-creation action: add a chapter
            (the same handler as the 草稿 group's "+", same spinner). */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 p-0"
          onClick={() => void onAddChapter()}
          disabled={addingChapter}
          aria-label="Add chapter"
          title="Add chapter"
        >
          {addingChapter ? (
            <Spinner size="lg" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      {/* The scroll area — the document tree (Book) or the run list (Write). */}
      <nav
        aria-label={mode === "book" ? "Novel assets" : "Novel runs"}
        className="nice-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {mode === "write" ? (
          <ul className="space-y-0.5">
            {runsLoading && runs.length === 0 ? (
              <li className="px-2 py-1.5 text-small text-muted-foreground">
                Loading runs…
              </li>
            ) : visibleRuns.length === 0 ? (
              <li className="px-2 py-1.5 text-small text-muted-foreground">
                {q ? "No runs match your search." : "No runs yet for this novel."}
              </li>
            ) : (
              visibleRuns.map((run) => (
                <TreeFile
                  key={run.id}
                  label={run.goal}
                  selected={run.id === currentRunId}
                  onClick={() => onOpenRun(run.id)}
                  trailing={
                    <span className={cn("flex shrink-0 items-center gap-1.5", TEXT_CAPTION)}>
                      <span>{RUN_STATUS_META[run.status]?.label ?? run.status}</span>
                      <span className="tabular-nums">{relativeTime(run.createdAt)}</span>
                    </span>
                  }
                />
              ))
            )}
          </ul>
        ) : (
          <DocTreePanel
            novelId={novel.id}
            nodes={tree}
            query={q}
            expanded={{ ...DEFAULT_EXPANDED, ...expanded }}
            onToggle={toggle}
            onOpenDoc={onOpenDoc}
            activeDocId={activeDocId}
            badges={badges}
            badgeKeysFor={badgeKeysFor}
          />
        )}
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// File row — a clickable row (the run list).
// ---------------------------------------------------------------------------

function TreeFile({
  label,
  selected,
  onClick,
  trailing,
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex h-[30px] w-full items-center gap-1.5 rounded-md px-2 text-left transition-colors",
          selected ? "bg-accent" : "hover:bg-accent/50"
        )}
      >
        <span className="min-w-0 flex-1 truncate text-small">{label}</span>
        {trailing}
      </button>
    </li>
  );
}
