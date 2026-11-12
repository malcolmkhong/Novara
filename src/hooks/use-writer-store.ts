"use client";

// ---------------------------------------------------------------------------
// Novara AI — writer UI state (zustand).
// Holds cross-pane UI state that survives pane switches and novel switches in
// the Workbench shell: the center view (chat/board), the selected chapter, the
// open document tabs of the right pane, the last execution mode the author
// chose, and the Phase 9 deep-link focus (preselected memory category /
// ledger kind) that the document tree writes before opening a document.
// Domain data stays in component state + API; this store is UI-only.
//
// P1 persistence: the per-novel run-mode preference (lastModeByNovel) is the
// one piece of durable UI state — it survives reloads via localStorage. The
// store uses skipHydration and is rehydrated manually from the client root
// (writer-app) after mount, so the first client render always matches SSR.
// STEP 65 adds two more durable per-novel slices: the model selection and the
// rail mode (Write | Book).
// STEP 76 — the artifact-tab model and the per-asset selection slices are
// GONE: the right pane now shows DOCUMENTS (read-only projections), and the
// selected chapter is the only asset selection that is still read (the
// chapter editor). The open/active/view-mode document tabs replaced them.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AgentRunMode, PinnedRef } from "@/lib/novara/agent-types";
import type { ModelSelection } from "@/lib/novara/models";
import type { CenterView, RailMode } from "@/config/writer";

/** STEP 76 — the two views a document can be shown in (the pane's toggle). */
export type DocViewMode = "document" | "markdown";

interface WriterState {
  /** Center pane view per novel id (chat flow vs Todos board). */
  centerViewByNovel: Record<string, CenterView>;
  /** Selected chapter per novel id (the open document in the right pane). */
  selectedChapterByNovel: Record<string, string | null>;
  /**
   * Pinned context refs per novel id (Phase 8 Pin-to-Chat) — shown as chips
   * in the conversation composer and resolved server-side at run start.
   */
  pinnedByNovel: Record<string, PinnedRef[]>;
  /** Deep-link focus (Phase 9): memory category focus ("all" | MemoryCategory | null) per novel. */
  memoryFocusByNovel: Record<string, string | null>;
  /** Deep-link focus: ledger kind focus ("storyline" | "timeline" | "arc" | "promise" | "clue" | null) per novel. */
  ledgerKindByNovel: Record<string, string | null>;
  /**
   * Last execution mode chosen by the author per novel id (D2 default:
   * approval). Persisted to localStorage (P1) so the composer restores the
   * preference across reloads, scoped to the novel it was chosen for.
   */
  lastModeByNovel: Record<string, AgentRunMode>;
  /**
   * P2 — last model registry selection per novel id (model + thinking
   * level). Persisted alongside the run-mode preference so the composer's
   * model picker restores across reloads, scoped to the novel.
   */
  lastModelByNovel: Record<string, ModelSelection>;
  /**
   * STEP 65 — the rail's mode per novel id: "write" (this novel's agent
   * runs) or "book" (the asset tree). Persisted so the rail keeps the
   * author's choice across reloads and novel switches. Default: "book".
   */
  railModeByNovel: Record<string, RailMode>;
  /**
   * STEP 76 — the open document tabs of the right pane, per novel id, in the
   * order the author opened them. A document id is "<DocKind>:<ref>" (see
   * `src/lib/novara/doc-tree.ts`).
   */
  openDocsByNovel: Record<string, string[]>;
  /** STEP 76 — the active document tab of the right pane, per novel id. */
  activeDocByNovel: Record<string, string | null>;
  /**
   * STEP 76 — the view mode of every open document, per novel id. "document"
   * renders the projection, "markdown" shows the raw source.
   */
  docViewByNovel: Record<string, Record<string, DocViewMode>>;
  /** STEP 76 — the left rail collapsed, per novel id. */
  railCollapsedByNovel: Record<string, boolean>;
  setCenterView: (novelId: string, view: CenterView) => void;
  selectChapter: (novelId: string, chapterId: string | null) => void;
  togglePin: (novelId: string, ref: PinnedRef) => void;
  clearPins: (novelId: string) => void;
  /** Deep-link focus (Phase 9): preselect a memory category, null clears. */
  setMemoryFocus: (novelId: string, category: string | null) => void;
  /** Deep-link focus (Phase 9): preselect a ledger kind, null clears. */
  setLedgerKind: (novelId: string, kind: string | null) => void;
  setLastMode: (novelId: string, mode: AgentRunMode) => void;
  setLastModel: (novelId: string, selection: ModelSelection) => void;
  /** STEP 65 — switch the rail between the run list ("write") and the asset
   * tree ("book") for one novel. */
  setRailMode: (novelId: string, mode: RailMode) => void;
  /** STEP 76 — open a document in the right pane (activates it). */
  openDoc: (novelId: string, docId: string) => void;
  /** STEP 76 — close a document tab; the active tab falls back to its left
   * neighbour. */
  closeDoc: (novelId: string, docId: string) => void;
  /** STEP 76 — activate an already open document tab. */
  activateDoc: (novelId: string, docId: string) => void;
  /** STEP 76 — switch one document between the document and the markdown view. */
  setDocView: (novelId: string, docId: string, mode: DocViewMode) => void;
  /** STEP 76 — collapse or expand the left rail. */
  setRailCollapsed: (novelId: string, collapsed: boolean) => void;
}

export const useWriterStore = create<WriterState>()(
  persist(
    (set) => ({
  centerViewByNovel: {},
  selectedChapterByNovel: {},
  pinnedByNovel: {},
  memoryFocusByNovel: {},
  ledgerKindByNovel: {},
  lastModeByNovel: {},
  lastModelByNovel: {},
  railModeByNovel: {},
  openDocsByNovel: {},
  activeDocByNovel: {},
  docViewByNovel: {},
  railCollapsedByNovel: {},
  setCenterView: (novelId, view) =>
    set((s) => ({ centerViewByNovel: { ...s.centerViewByNovel, [novelId]: view } })),
  selectChapter: (novelId, chapterId) =>
    set((s) => ({
      selectedChapterByNovel: { ...s.selectedChapterByNovel, [novelId]: chapterId },
    })),
  togglePin: (novelId, ref) =>
    set((s) => {
      const current = s.pinnedByNovel[novelId] ?? [];
      const exists = current.some((p) => p.type === ref.type && p.id === ref.id);
      const next = exists
        ? current.filter((p) => !(p.type === ref.type && p.id === ref.id))
        : [...current, ref].slice(-12);
      return { pinnedByNovel: { ...s.pinnedByNovel, [novelId]: next } };
    }),
  clearPins: (novelId) =>
    set((s) => ({ pinnedByNovel: { ...s.pinnedByNovel, [novelId]: [] } })),
  setMemoryFocus: (novelId, category) =>
    set((s) => ({
      memoryFocusByNovel: { ...s.memoryFocusByNovel, [novelId]: category },
    })),
  setLedgerKind: (novelId, kind) =>
    set((s) => ({
      ledgerKindByNovel: { ...s.ledgerKindByNovel, [novelId]: kind },
    })),
  setLastMode: (novelId, mode) =>
    set((s) => ({
      lastModeByNovel: { ...s.lastModeByNovel, [novelId]: mode },
    })),
  setLastModel: (novelId, selection) =>
    set((s) => ({
      lastModelByNovel: { ...s.lastModelByNovel, [novelId]: selection },
    })),
  setRailMode: (novelId, mode) =>
    set((s) => ({
      railModeByNovel: { ...s.railModeByNovel, [novelId]: mode },
    })),
  openDoc: (novelId, docId) =>
    set((s) => {
      const open = s.openDocsByNovel[novelId] ?? [];
      return {
        openDocsByNovel: {
          ...s.openDocsByNovel,
          [novelId]: open.includes(docId) ? open : [...open, docId],
        },
        activeDocByNovel: { ...s.activeDocByNovel, [novelId]: docId },
      };
    }),
  closeDoc: (novelId, docId) =>
    set((s) => {
      const open = s.openDocsByNovel[novelId] ?? [];
      const at = open.indexOf(docId);
      if (at < 0) return {};
      const next = open.filter((id) => id !== docId);
      const active = s.activeDocByNovel[novelId];
      // Closing the active tab activates its LEFT neighbour; closing a
      // background tab leaves the active one alone.
      const nextActive =
        active === docId
          ? next.length === 0
            ? null
            : next[Math.max(0, at - 1)]
          : active ?? null;
      return {
        openDocsByNovel: { ...s.openDocsByNovel, [novelId]: next },
        activeDocByNovel: { ...s.activeDocByNovel, [novelId]: nextActive },
      };
    }),
  activateDoc: (novelId, docId) =>
    set((s) => ({ activeDocByNovel: { ...s.activeDocByNovel, [novelId]: docId } })),
  setDocView: (novelId, docId, mode) =>
    set((s) => ({
      docViewByNovel: {
        ...s.docViewByNovel,
        [novelId]: { ...(s.docViewByNovel[novelId] ?? {}), [docId]: mode },
      },
    })),
  setRailCollapsed: (novelId, collapsed) =>
    set((s) => ({
      railCollapsedByNovel: { ...s.railCollapsedByNovel, [novelId]: collapsed },
    })),
    }),
    {
      name: "novara-writer-ui",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Durable UI state: the per-novel run-mode AND model preferences, plus
      // the per-novel rail mode (STEP 65: Write | Book).
      // Every other slice is intentionally session-scoped.
      partialize: (s) => ({
        lastModeByNovel: s.lastModeByNovel,
        lastModelByNovel: s.lastModelByNovel,
        railModeByNovel: s.railModeByNovel,
      }),
      // Rehydrated manually from the client root after mount — keeps the
      // first client render identical to SSR (no hydration mismatch).
      skipHydration: true,
    }
  )
);
