"use client";

// ---------------------------------------------------------------------------
// Novara AI — STEP 76: the document tree (the left rail's book mode).
//
// RULE 1: every row is a FOLDER (expands) or a DOCUMENT (opens). There is no
// third row type, and a folder's expand key is its own id.
//
// The tree itself is built by `buildDocTree` (src/lib/novara/doc-tree.ts) —
// this file only renders it. The search line filters the tree in place
// (folder names included) and keeps the Chinese alias of every row, so
// "Final" and "定稿" both find the same row (STEP 65.6a).
// ---------------------------------------------------------------------------

import { ChevronRight, FileText } from "lucide-react";
import type { DocNode, Node } from "@/lib/novara/doc-tree";
import type { PinnedRefType } from "@/lib/novara/agent-types";
import { cn } from "@/lib/utils";
import { BadgeIcons, type BadgeMap, type NodeBadge } from "./tree-badges";
import { PinButton } from "./ui-bits";

/** The pin target of a document row, or null when the row cannot be pinned. */
function pinTargetFor(node: DocNode): { type: PinnedRefType; id: string; label: string } | null {
  switch (node.doc) {
    case "chapter":
      return { type: "chapter", id: node.ref, label: node.label };
    case "contract":
      return { type: "contract", id: node.ref, label: node.label };
    case "concept":
      return { type: "concept", id: node.ref, label: node.label };
    case "character":
      return { type: "character", id: node.ref, label: node.label };
    case "world_entry":
      return { type: "world_entry", id: node.ref, label: node.label };
    case "beat":
      return { type: "outline_beat", id: node.ref, label: node.label };
    case "pack":
      return { type: "pack", id: node.ref, label: node.label };
    default:
      return null;
  }
}

/** A row matches when the English OR the Chinese label contains the query. */
function labelMatches(node: Node, query: string): boolean {
  if (!query) return true;
  const en = node.label.toLowerCase();
  const zh = (node.zh ?? "").toLowerCase();
  return en.includes(query) || zh.includes(query);
}

/**
 * Filter the tree by the search query. A folder that matches keeps ALL of its
 * children; a folder that only matches through its children keeps just those.
 */
function filterTree(nodes: Node[], query: string): Node[] {
  if (!query) return nodes;
  const out: Node[] = [];
  for (const node of nodes) {
    if (node.kind === "doc") {
      if (labelMatches(node, query)) out.push(node);
      continue;
    }
    if (labelMatches(node, query)) {
      out.push(node);
      continue;
    }
    const children = filterTree(node.children, query);
    if (children.length > 0) out.push({ ...node, children });
  }
  return out;
}

export interface DocTreePanelProps {
  novelId: string;
  /** The tree — `buildDocTree(detail, runs, reviews)`. */
  nodes: Node[];
  /** The search line's query (lowercased by the caller). */
  query: string;
  /** The expanded state, keyed by node id. */
  expanded: Record<string, boolean>;
  /** Expand or collapse a folder. */
  onToggle: (id: string) => void;
  /** Open a document row. */
  onOpenDoc: (node: DocNode) => void;
  /** The open document — highlighted. */
  activeDocId?: string | null;
  /** Live task badges. */
  badges?: BadgeMap;
  /** The badge keys of one node (asset identities, not row identities). */
  badgeKeysFor?: (node: Node) => string[];
  className?: string;
}

export function DocTreePanel({
  novelId,
  nodes,
  query,
  expanded,
  onToggle,
  onOpenDoc,
  activeDocId,
  badges,
  badgeKeysFor,
  className,
}: DocTreePanelProps) {
  const q = query.trim().toLowerCase();
  const visible = filterTree(nodes, q);
  const searching = q.length > 0;

  const badgesOf = (node: Node) => {
    if (!badges || !badgeKeysFor) return undefined;
    const list = badgeKeysFor(node)
      .map((key) => badges.get(key))
      .filter((b): b is NonNullable<typeof b> => Boolean(b) && b!.length > 0)
      .flat();
    return list.length > 0 ? list : undefined;
  };

  if (visible.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground">
        {searching ? "No files match your search." : "This novel has no documents yet."}
      </p>
    );
  }

  return (
    <ul className={cn("space-y-0.5", className)}>
      {visible.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          novelId={novelId}
          query={q}
          searching={searching}
          expanded={expanded}
          onToggle={onToggle}
          onOpenDoc={onOpenDoc}
          activeDocId={activeDocId}
          badgesOf={badgesOf}
          badgeKeysFor={badgeKeysFor}
        />
      ))}
    </ul>
  );
}

interface TreeRowProps {
  node: Node;
  novelId: string;
  query: string;
  searching: boolean;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onOpenDoc: (node: DocNode) => void;
  activeDocId?: string | null;
  badgesOf: (node: Node) => NodeBadge[] | undefined;
  badgeKeysFor?: (node: Node) => string[];
  depth?: number;
}

function TreeRow({
  node,
  novelId,
  query,
  searching,
  expanded,
  onToggle,
  onOpenDoc,
  activeDocId,
  badgesOf,
  badgeKeysFor,
  depth = 0,
}: TreeRowProps) {
  if (node.kind === "folder") {
    const open = searching ? true : expanded[node.id] === true;
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          aria-expanded={open}
          className="flex h-[30px] w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
          style={depth > 0 ? { paddingLeft: `${8 + depth * 12}px` } : undefined}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
            aria-hidden="true"
          />
          <span className="truncate">{node.label}</span>
          {badgesOf(node) && <BadgeIcons badges={badgesOf(node)} />}
          {node.badge && (
            <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">
              {node.badge}
            </span>
          )}
        </button>
        {open && node.children.length > 0 && (
          <ul className="space-y-0.5">
            {node.children.map((child) => (
              <TreeRow
                key={child.id}
                node={child}
                novelId={novelId}
                query={query}
                searching={searching}
                expanded={expanded}
                onToggle={onToggle}
                onOpenDoc={onOpenDoc}
                activeDocId={activeDocId}
                badgesOf={badgesOf}
                badgeKeysFor={badgeKeysFor}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const pin = pinTargetFor(node);
  const active = activeDocId === node.id;
  const badges = badgesOf(node);

  return (
    <li className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => onOpenDoc(node)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex h-[30px] min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors hover:bg-muted/60",
          active && "bg-muted text-foreground"
        )}
        style={depth > 0 ? { paddingLeft: `${8 + depth * 12}px` } : undefined}
      >
        <FileText
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="truncate">{node.label}</span>
        {node.meta && (
          <span className="shrink-0 text-[10px] text-muted-foreground">{node.meta}</span>
        )}
        {node.badge && (
          <span className="ml-auto shrink-0 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">
            {node.badge}
          </span>
        )}
        {badges && <BadgeIcons badges={badges} />}
      </button>
      {pin && (
        <PinButton
          novelId={novelId}
          target={pin}
          label=""
          className="h-6 w-6 shrink-0 px-0"
        />
      )}
    </li>
  );
}
