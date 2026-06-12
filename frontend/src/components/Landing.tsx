import {
  ArrowRight,
  BarChart3,
  Mic,
  Moon,
  Quote,
  Share2,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useThemeStore } from "../store/theme";
import { useLangStore } from "../store/lang";
import { Logo } from "./Logo";

function HeaderControls() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const lang = useLangStore((s) => s.lang);
  const toggleLang = useLangStore((s) => s.toggleLang);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggleLang}
        aria-label={t("nav.switchLanguage")}
        className="flex h-8 items-center rounded-md px-2 font-mono text-xs uppercase text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {lang}
      </button>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? t("nav.themeToLight") : t("nav.themeToDark")}
        className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  desc,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-5 transition-colors hover:border-hairline-strong">
      <Icon className="h-5 w-5 text-fg-muted" />
      <h3 className="mt-3 text-[15px] font-medium text-fg">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{desc}</p>
    </div>
  );
}

export function Landing() {
  const { t } = useTranslation();

  const features = [
    {
      icon: ShieldCheck,
      title: t("landing.features.localTitle"),
      desc: t("landing.features.localDesc"),
    },
    {
      icon: Quote,
      title: t("landing.features.citationsTitle"),
      desc: t("landing.features.citationsDesc"),
    },
    {
      icon: Share2,
      title: t("landing.features.graphTitle"),
      desc: t("landing.features.graphDesc"),
    },
    {
      icon: Mic,
      title: t("landing.features.voiceTitle"),
      desc: t("landing.features.voiceDesc"),
    },
    {
      icon: BarChart3,
      title: t("landing.features.evalTitle"),
      desc: t("landing.features.evalDesc"),
    },
  ];

  return (
    <div className="min-h-screen overflow-y-auto bg-canvas text-fg">
      {/* En-tête */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <HeaderControls />
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pb-16 pt-16 text-center sm:pt-24">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" />
          {t("landing.footer")}
        </p>
        <h1 className="text-4xl font-medium leading-tight tracking-tight text-fg sm:text-5xl">
          {t("landing.tagline")}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-fg-muted">
          {t("landing.intro")}
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            to="/app"
            className="group inline-flex items-center gap-2 rounded-lg bg-fg px-5 py-3 text-sm font-medium text-canvas transition-colors hover:opacity-90"
          >
            {t("landing.cta")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* Valeur */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="mb-6 text-center font-mono text-[11px] uppercase tracking-wider text-fg-faint">
          {t("landing.sectionTitle")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Feature key={f.title} icon={f.icon} title={f.title} desc={f.desc} />
          ))}
          {/* CTA secondaire dans la grille pour équilibrer la dernière colonne */}
          <Link
            to="/app"
            className="flex flex-col items-start justify-between rounded-lg border border-hairline bg-surface-2 p-5 transition-colors hover:border-hairline-strong"
          >
            <Logo showWordmark={false} />
            <span className="mt-3 inline-flex items-center gap-2 text-[15px] font-medium text-fg">
              {t("landing.openApp")}
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5 font-mono text-[11px] uppercase tracking-wider text-fg-faint">
          <span>{t("common.appName")}</span>
          <span>{t("landing.footer")}</span>
        </div>
      </footer>
    </div>
  );
}
