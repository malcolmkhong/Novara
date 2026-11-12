"use client";

// ---------------------------------------------------------------------------
// Novara AI — live task badges for the rail.
//
// A task that is running (or waiting for the author's approval) is bound to
// the asset it touches. The rail shows that binding as a small icon on the
// row.
//
// STEP 76 moved these helpers out of `asset-tree.tsx` so the document tree
// renderer (`doc-tree-panel.tsx`) and the rail share ONE implementation
// instead of importing from each other (which would be a cycle).
// ---------------------------------------------------------------------------

import { Hand, Loader2 } from "lucide-react";
import type { AgentTask, AgentTaskStatus } from "@/lib/novara/agent-types";

export interface NodeBadge {
  taskKey: string;
  status: Extract<AgentTaskStatus, "in_progress" | "needs_approval">;
}

export type BadgeMap = Map<string, NodeBadge[]>;

/** Chapter label like "Chapter 3" → numeric index (best effort). */
function chapterIndexFromLabel(label: string | null): number | null {
  if (!label) return null;
  const m = label.match(/chapter\s+(\d+)/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Bind the live tasks to tree node keys.
 *
 * The keys are stable identities of the ASSET, not of the row: a chapter is
 * "chapter:<index>", a character "character:<id>", a world entry "world:<id>"
 * and a beat "beat:<id>". A task whose asset is not in the tree yet falls
 * back to the group key of its zone ("group:drafts", "group:outline", …).
 */
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

/** The icons of one row's badges — a spinner or a raised hand. */
export function BadgeIcons({ badges }: { badges: NodeBadge[] | undefined }) {
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
