"use client";

// ---------------------------------------------------------------------------
// Novara AI — writer UI state (zustand).
// Holds cross-pane UI state that survives pane switches and novel switches in
// the Workbench shell: the center view (chat/board), the active artifact tab,
// the selected chapter, and the last execution mode the author chose.
// Domain data stays in component state + API; this store is UI-only.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { AgentRunMode, PinnedRef } from "@/lib/novara/agent-types";
import type { ArtifactTabId, CenterView } from "@/config/writer";

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
  /** Last execution mode chosen by the author (defaults to approval, D2). */
  lastMode: AgentRunMode;
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
  setLastMode: (mode: AgentRunMode) => void;
}

export const useWriterStore = create<WriterState>((set) => ({
  centerViewByNovel: {},
  artifactTabByNovel: {},
  selectedChapterByNovel: {},
  selectedBeatByNovel: {},
  selectedCharacterByNovel: {},
  selectedWorldByNovel: {},
  selectedVolumeByNovel: {},
  selectedPackKeyByNovel: {},
  pinnedByNovel: {},
  lastMode: "approval",
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
  setLastMode: (mode) => set({ lastMode: mode }),
}));
