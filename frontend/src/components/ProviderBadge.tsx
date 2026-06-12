import { Cloud, Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppConfig } from "../queries/config";

/** Nom d'affichage du fournisseur de génération ("mistral" → "Mistral"). */
export function providerDisplayName(provider: string): string {
  const names: Record<string, string> = {
    mistral: "Mistral",
    gemini: "Gemini",
    claude: "Claude",
  };
  return names[provider] ?? provider;
}

/**
 * Indicateur honnête du moteur de génération actif : « Local · Mistral » ou le
 * nom du cloud (Gemini / Claude). Central pour le récit souveraineté de la
 * démo — on voit toujours quel moteur a rédigé la réponse.
 */
export function ProviderBadge() {
  const { t } = useTranslation();
  const { data } = useAppConfig();
  if (!data) return null;

  const name = providerDisplayName(data.llm_provider);
  const label = data.llm_local ? t("input.providerLocal", { name }) : name;
  const title = data.llm_local
    ? t("input.providerTitleLocal", { model: data.llm_model })
    : t("input.providerTitleCloud", { name, model: data.llm_model });

  return (
    <span
      title={title}
      className="ml-auto flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted"
    >
      {data.llm_local ? (
        <Cpu className="h-3.5 w-3.5" />
      ) : (
        <Cloud className="h-3.5 w-3.5" />
      )}
      {label}
    </span>
  );
}
