import { useTranslation } from "react-i18next";
import { useViewStore, type AppView } from "../store/view";

/** Bascule segmentée minimale Chat / Graphe / Éval (filet + remplissage discret). */
export function ViewSwitch() {
  const { t } = useTranslation();
  const view = useViewStore((s) => s.view);
  const setView = useViewStore((s) => s.setView);

  const tabs: { key: AppView; label: string }[] = [
    { key: "chat", label: t("nav.chat") },
    { key: "graph", label: t("nav.graph") },
    { key: "eval", label: t("nav.eval") },
  ];

  return (
    <div className="flex w-full rounded-lg border border-hairline p-0.5">
      {tabs.map(({ key, label }) => {
        const active = view === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-pressed={active}
            className={`flex-1 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
              active ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
