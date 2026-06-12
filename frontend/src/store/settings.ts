import { create } from "zustand";

interface SettingsState {
  /** RAG activé (ON = pipeline complet, OFF = Mistral seul sans contexte). */
  ragEnabled: boolean;
  /** Mode développeur : expose prompt, chunks scorés et token counts. */
  debugEnabled: boolean;
  toggleRag: () => void;
  toggleDebug: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ragEnabled: true,
  debugEnabled: false,
  toggleRag: () => set((s) => ({ ragEnabled: !s.ragEnabled })),
  toggleDebug: () => set((s) => ({ debugEnabled: !s.debugEnabled })),
}));
