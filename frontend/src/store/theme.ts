import { create } from "zustand";

export type Theme = "dark" | "light";

const STORAGE_KEY = "krole-theme";

function initialTheme(): Theme {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  }
  return "dark"; // sombre par défaut
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const theme = initialTheme();
  if (typeof document !== "undefined") apply(theme);
  return {
    theme,
    toggleTheme: () => {
      const next: Theme = get().theme === "dark" ? "light" : "dark";
      apply(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* stockage indisponible : on ignore */
      }
      set({ theme: next });
    },
  };
});
