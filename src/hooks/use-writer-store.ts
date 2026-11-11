"use client";

// ---------------------------------------------------------------------------
// Novara AI — writer UI state (zustand).
// Holds cross-pane UI state that survives pane switches and novel switches in
// the Workbench shell: the center view (chat/board), the active artifact tab,
// the selected chapter, the last execution mode the author chose, and the
// Phase 9 deep-link focus (preselected memory category / ledger kind) that
// asset-tree rows write before opening their artifact tab.
// Domain data stays in component state + API; this store is UI-only.
//
// P1 persistence: the per-novel run-mode preference (lastModeByNovel) is the
// one piece of durable UI state — it survives reloads via localStorage. The
// store uses skipHydration and is rehydrated manually from the client root
// (writer-app) after mount, so the first client render always matches SSR.
// STEP 65 adds two more durable per-novel slices: the model selection and the
// rail mode (Write | Book).
// ---------------------------------------------------------------------------

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AgentRunMode, PinnedRef } from "@/lib/novara/agent-types";
import type { ModelSelection } from "@/lib/novara/models";
import type { ArtifactTabId, CenterView, RailMode } from "@/config/writer";

interface WriterState {
  /** Center pane view per novel id (chat flow vs Todos board). */
  centerViewByNovel: Record<string, CenterView>;
  /** Active right-pane artifact tab per novel id. */
  artifactTabByNovel: Record<string, ArtifactTabId>;
  /** Selected chapter per novel id (opened in the Draft artifact view). */
  selectedChapterByNovel: Record<string, string | null>;
  /** Tree-opened outline beat per novel id (focused card in the Outline view). */
  selectedBeatByNovel: Record<string, string | null>;
  /** Tree-opened character per novel id (focused card in the Bible view). */
  selectedCharacterByNovel: Record<string, string | null>;
  /** Tree-opened world entry per novel id (focused card in the Bible view). */
  selectedWorldByNovel: Record<string, string | null>;
  /** Tree-opened volume per novel id (focused plan in the Outline view). */
  selectedVolumeByNovel: Record<string, string | null>;
  /**
   * Tree-opened chapter pack per novel id (focused document in the Packs
   * view). Key shape: `${kind}:${chapterIndex}` (e.g. "material:9").
   */
  selectedPackKeyByNovel: Record<string, string | null>;
  /**
   * Pinned context refs per novel id (Phase 8 Pin-to-Chat) — shown as chips
   * in the conversation composer and resolved server-side at run start.
   */
  pinnedByNovel: Record<string, PinnedRef[]>;
  /** Deep-link focus (Phase 9): memory tab preselected category ("all" | MemoryCategory | null) per novel. */
  memoryFocusByNovel: Record<string, string | null>;
  /** Deep-link focus: ledger tab preselected kind ("storyline" | "timeline" | "arc" | "promise" | "clue" | null) per novel. */
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
  setCenterView: (novelId: string, view: CenterView) => void;
  setArtifactTab: (novelId: string, tab: ArtifactTabId) => void;
  selectChapter: (novelId: string, chapterId: string | null) => void;
  selectBeat: (novelId: string, beatId: string | null) => void;
  selectCharacter: (novelId: string, characterId: string | null) => void;
  selectWorld: (novelId: string, worldId: string | null) => void;
  selectVolume: (novelId: string, volumeId: string | null) => void;
  selectPack: (novelId: string, key: string | null) => void;
  togglePin: (novelId: string, ref: PinnedRef) => void;
  clearPins: (novelId: string) => void;
  /** Deep-link focus (Phase 9): preselect a memory tab category, null clears. */
  setMemoryFocus: (novelId: string, category: string | null) => void;
  /** Deep-link focus (Phase 9): preselect a ledger tab kind, null clears. */
  setLedgerKind: (novelId: string, kind: string | null) => void;
  setLastMode: (novelId: string, mode: AgentRunMode) => void;
  setLastModel: (novelId: string, selection: ModelSelection) => void;
  /** STEP 65 — switch the rail between the run list ("write") and the asset
   * tree ("book") for one novel. */
  setRailMode: (novelId: string, mode: RailMode) => void;
}

export const useWriterStore = create<WriterState>()(
  persist(
    (set) => ({
  centerViewByNovel: {},
  artifactTabByNovel: {},
  selectedChapterByNovel: {},
  selectedBeatByNovel: {},
  selectedCharacterByNovel: {},
  selectedWorldByNovel: {},
  selectedVolumeByNovel: {},
  selectedPackKeyByNovel: {},
  pinnedByNovel: {},
  memoryFocusByNovel: {},
  ledgerKindByNovel: {},
  lastModeByNovel: {},
  lastModelByNovel: {},
  railModeByNovel: {},
  setCenterView: (novelId, view) =>
    set((s) => ({ centerViewByNovel: { ...s.centerViewByNovel, [novelId]: view } })),
  setArtifactTab: (novelId, tab) =>
    set((s) => ({ artifactTabByNovel: { ...s.artifactTabByNovel, [novelId]: tab } })),
  selectChapter: (novelId, chapterId) =>
    set((s) => ({
      selectedChapterByNovel: { ...s.selectedChapterByNovel, [novelId]: chapterId },
    })),
  selectBeat: (novelId, beatId) =>
    set((s) => ({
      selectedBeatByNovel: { ...s.selectedBeatByNovel, [novelId]: beatId },
    })),
  selectCharacter: (novelId, characterId) =>
    set((s) => ({
      selectedCharacterByNovel: { ...s.selectedCharacterByNovel, [novelId]: characterId },
    })),
  selectWorld: (novelId, worldId) =>
    set((s) => ({
      selectedWorldByNovel: { ...s.selectedWorldByNovel, [novelId]: worldId },
    })),
  selectVolume: (novelId, volumeId) =>
    set((s) => ({
      selectedVolumeByNovel: { ...s.selectedVolumeByNovel, [novelId]: volumeId },
    })),
  selectPack: (novelId, key) =>
    set((s) => ({
      selectedPackKeyByNovel: { ...s.selectedPackKeyByNovel, [novelId]: key },
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
