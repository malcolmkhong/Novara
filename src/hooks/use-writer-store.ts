"use client";

// ---------------------------------------------------------------------------
// Novara AI — writer UI state (zustand).
// Holds cross-pane UI state that survives pane switches and novel switches in
// the Workbench shell: the center view (chat/board), the active artifact tab,
// the selected chapter, and the last execution mode the author chose.
// Domain data stays in component state + API; this store is UI-only.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { AgentRunMode } from "@/lib/novara/agent-types";
import type { ArtifactTabId, CenterView } from "@/config/writer";

interface WriterState {
  /** Center pane view per novel id (chat flow vs Todos board). */
  centerViewByNovel: Record<string, CenterView>;
  /** Active right-pane artifact tab per novel id. */
  artifactTabByNovel: Record<string, ArtifactTabId>;
  /** Selected chapter per novel id (opened in the Draft artifact view). */
  selectedChapterByNovel: Record<string, string | null>;
  /** Last execution mode chosen by the author (defaults to approval, D2). */
  lastMode: AgentRunMode;
  setCenterView: (novelId: string, view: CenterView) => void;
  setArtifactTab: (novelId: string, tab: ArtifactTabId) => void;
  selectChapter: (novelId: string, chapterId: string | null) => void;
  setLastMode: (mode: AgentRunMode) => void;
}

export const useWriterStore = create<WriterState>((set) => ({
  centerViewByNovel: {},
  artifactTabByNovel: {},
  selectedChapterByNovel: {},
  lastMode: "approval",
  setCenterView: (novelId, view) =>
    set((s) => ({ centerViewByNovel: { ...s.centerViewByNovel, [novelId]: view } })),
  setArtifactTab: (novelId, tab) =>
    set((s) => ({ artifactTabByNovel: { ...s.artifactTabByNovel, [novelId]: tab } })),
  selectChapter: (novelId, chapterId) =>
    set((s) => ({
      selectedChapterByNovel: { ...s.selectedChapterByNovel, [novelId]: chapterId },
    })),
  setLastMode: (mode) => set({ lastMode: mode }),
}));
