import { create } from "zustand";

/** Vue principale active (le chat n'est jamais démonté côté logique métier). */
export type AppView = "chat" | "graph" | "eval";

interface ViewState {
  view: AppView;
  setView: (view: AppView) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  view: "chat",
  setView: (view) => set({ view }),
}));
