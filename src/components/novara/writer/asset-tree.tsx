"use client";

// ---------------------------------------------------------------------------
// Novara AI — Workbench left rail: novel header + asset tree.
//
// The tree is not just navigation: nodes carry LIVE agent badges (D1) bound
// via AgentTask.artifactType/artifactLabel, so the author can see which asset
// the team is touching right now — the "章新区 · 工作中" pattern from the
// workbench reference design.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  BookOpen,
  Brain,
  FileSearch,
  FolderTree,
  Globe2,
  Hand,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { AgentTask, AgentTaskStatus } from "@/lib/novara/agent-types";
import type { ArtifactTabId } from "@/config/writer";
import type { NovelDetail } from "@/lib/novara/types";
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

interface AssetTreeProps {
  detail: NovelDetail;
  /** Live agent tasks (may be empty — no active run). */
  tasks: AgentTask[];
  selectedChapterId: string | null;
  onOpenChapter: (chapterId: string) => void;
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
  onOpenChapter,
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

  const totalWords = detail.chapters.reduce((s, c) => s + c.wordCount, 0);
  const pct = novel.targetWords
    ? Math.min(100, Math.round((totalWords / novel.targetWords) * 100))
    : 0;

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
        <ul className="space-y-0.5">
          {/* Chapters — expandable list of chapter rows */}
          <li>
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left text-sm font-medium"
                onClick={() => onOpenArtifactTab("draft")}
              >
                Chapters
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({detail.chapters.length})
                </span>
              </button>
              <BadgeIcons badges={badges.get("group:chapters")} />
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
            </div>
            {detail.chapters.length > 0 && (
              <ul className="ml-3 border-l pl-2">
                {detail.chapters.map((ch) => {
                  const chapterBadges = badges.get(`chapter:${ch.index}`);
                  return (
                    <li key={ch.id}>
                      <button
                        type="button"
                        onClick={() => onOpenChapter(ch.id)}
                        aria-current={ch.id === selectedChapterId ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          ch.id === selectedChapterId
                            ? "bg-accent"
                            : "hover:bg-accent/60"
                        )}
                      >
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {String(ch.index).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {ch.title}
                        </span>
                        {ch.status !== "draft" && (
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              ch.status === "final" ? "bg-emerald-600" : "bg-amber-500"
                            )}
                            aria-label={ch.status}
                          />
                        )}
                        <BadgeIcons badges={chapterBadges} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>

          <TreeGroup
            icon={<ListTree className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            label="Outline"
            count={detail.outlineBeats.length}
            badges={badges.get("group:outline")}
            onClick={() => onOpenArtifactTab("outline")}
          />
          <TreeGroup
            icon={<Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            label="Characters"
            count={detail.characters.length}
            badges={badges.get("group:characters")}
            onClick={() => onOpenArtifactTab("bible")}
          />
          <TreeGroup
            icon={<Globe2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            label="World"
            count={detail.worldEntries.length}
            badges={badges.get("group:world")}
            onClick={() => onOpenArtifactTab("bible")}
          />
          <TreeGroup
            icon={<FileSearch className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            label="Review"
            onClick={() => onOpenArtifactTab("review")}
          />
          <TreeGroup
            icon={<Brain className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            label="Memory"
            onClick={() => onOpenArtifactTab("memory")}
          />
          <TreeGroup
            icon={<ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            label="QC"
            onClick={() => onOpenArtifactTab("qc")}
          />
        </ul>

        <p className="mt-4 flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">
          <FolderTree className="h-3 w-3 shrink-0" aria-hidden="true" />
          Spinning icons show where the team is working right now.
        </p>
      </nav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group row (single-click → artifact tab)
// ---------------------------------------------------------------------------

function TreeGroup({
  icon,
  label,
  count,
  badges,
  phaseTag,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  badges?: NodeBadge[];
  phaseTag?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
      >
        {icon}
        <span className="min-w-0 flex-1 text-sm font-medium">
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
    </li>
  );
}
