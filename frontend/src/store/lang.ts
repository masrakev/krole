import { create } from "zustand";
import i18n, { initialLang, persistLang, type Lang } from "../i18n";

interface LangState {
  lang: Lang;
  toggleLang: () => void;
}

export const useLangStore = create<LangState>((set, get) => ({
  lang: initialLang(),
  toggleLang: () => {
    const next: Lang = get().lang === "fr" ? "en" : "fr";
    i18n.changeLanguage(next);
    persistLang(next);
    set({ lang: next });
  },
}));
