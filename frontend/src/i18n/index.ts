import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { fr } from "./fr";

export const LANGS = ["fr", "en"] as const;
export type Lang = (typeof LANGS)[number];

const STORAGE_KEY = "krole-lang";

export function initialLang(): Lang {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") return saved;
  }
  return "fr"; // français par défaut
}

export function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* stockage indisponible : on ignore */
  }
}

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: initialLang(),
  fallbackLng: "fr",
  interpolation: { escapeValue: false },
});

export default i18n;
