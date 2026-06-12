/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // Tokens sémantiques pilotés par des variables CSS (voir index.css).
      // Monochrome, near-black, hairlines. Réutilisés dans toute l'UI.
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",
        fg: "var(--fg)",
        "fg-muted": "var(--fg-muted)",
        "fg-faint": "var(--fg-faint)",
        // Accent unique et retenu (anneau de focus, bouton d'envoi).
        accent: "var(--accent)",
      },
      fontFamily: {
        sans: [
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
