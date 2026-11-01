"use client";

import { create } from "zustand";

export type TeamTab = "chat" | "team" | "tasks";
/** Which view the floating side panel shows. */
export type SidePanelTab = "workspace" | "library";

interface TeamUiState {
  open: boolean;
  tab: TeamTab;
  /** Agent key shown in the main panel chat ("leader" initially). */
  chatAgentKey: string;
  /** Agent keys with an open pop-out chat window. */
  popouts: string[];
  /** Floating side panel (book library / workspace overview). */
  sidePanelOpen: boolean;
  sidePanelTab: SidePanelTab;
  /** Draft text injected by side-panel tree clicks, consumed by the composer. */
  composerDraft: string;
  /** Bumped on every injection so effects re-run for identical text. */
  composerNonce: number;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setTab: (tab: TeamTab) => void;
  setChatAgent: (key: string) => void;
  openPopout: (key: string) => void;
  closePopout: (key: string) => void;
  setSidePanelOpen: (open: boolean) => void;
  setSidePanelTab: (tab: SidePanelTab) => void;
  /** Append a reference (e.g. 《书名》第3章「标题」) to the chat composer. */
  appendToComposer: (text: string) => void;
  clearComposerDraft: () => void;
}

export const useTeamUi = create<TeamUiState>((set) => ({
  open: false,
  tab: "chat",
  chatAgentKey: "leader",
  popouts: [],
  sidePanelOpen: false,
  sidePanelTab: "library",
  composerDraft: "",
  composerNonce: 0,
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setOpen: (open) => set({ open }),
  setTab: (tab) => set({ tab }),
  setChatAgent: (chatAgentKey) => set({ chatAgentKey }),
  openPopout: (key) =>
    set((state) => ({
      popouts: state.popouts.includes(key) ? state.popouts : [...state.popouts, key],
    })),
  closePopout: (key) =>
    set((state) => ({ popouts: state.popouts.filter((k) => k !== key) })),
  setSidePanelOpen: (sidePanelOpen) => set({ sidePanelOpen }),
  setSidePanelTab: (sidePanelTab) => set({ sidePanelTab }),
  appendToComposer: (text) =>
    set((state) => ({
      composerDraft: text,
      composerNonce: state.composerNonce + 1,
    })),
  clearComposerDraft: () => set({ composerDraft: "" }),
}));
