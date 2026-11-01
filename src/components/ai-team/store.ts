"use client";

import { create } from "zustand";

export type TeamTab = "chat" | "team" | "tasks";

interface TeamUiState {
  open: boolean;
  tab: TeamTab;
  /** Agent key shown in the main panel chat ("leader" initially). */
  chatAgentKey: string;
  /** Agent keys with an open pop-out chat window. */
  popouts: string[];
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setTab: (tab: TeamTab) => void;
  setChatAgent: (key: string) => void;
  openPopout: (key: string) => void;
  closePopout: (key: string) => void;
}

export const useTeamUi = create<TeamUiState>((set) => ({
  open: false,
  tab: "chat",
  chatAgentKey: "leader",
  popouts: [],
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
}));
