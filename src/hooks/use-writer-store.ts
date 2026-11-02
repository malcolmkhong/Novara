"use client";

// ---------------------------------------------------------------------------
// Novara AI — writer UI state (zustand).
// Holds cross-component UI state that outlives tab switches: the active
// workspace tab per novel and the last execution mode the author chose.
// Domain data stays in component state + API; this store is UI-only.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { AgentRunMode } from "@/lib/novara/agent-types";
import type { WriterTabId } from "@/config/writer";

interface WriterState {
  /** Active workspace tab per novel id (restored when switching novels). */
  activeTabByNovel: Record<string, WriterTabId>;
  /** Last execution mode chosen by the author (defaults to approval, D2). */
  lastMode: AgentRunMode;
  setActiveTab: (novelId: string, tab: WriterTabId) => void;
  setLastMode: (mode: AgentRunMode) => void;
}

export const useWriterStore = create<WriterState>((set) => ({
  activeTabByNovel: {},
  lastMode: "approval",
  setActiveTab: (novelId, tab) =>
    set((s) => ({ activeTabByNovel: { ...s.activeTabByNovel, [novelId]: tab } })),
  setLastMode: (mode) => set({ lastMode: mode }),
}));
