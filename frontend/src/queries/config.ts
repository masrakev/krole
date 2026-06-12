import { useQuery } from "@tanstack/react-query";
import { getAppConfig, type AppConfig } from "../lib/api";

/** Config backend (fournisseur LLM actif) — figée pour la durée de la session. */
export function useAppConfig() {
  return useQuery<AppConfig>({
    queryKey: ["app-config"],
    queryFn: getAppConfig,
    staleTime: Infinity,
  });
}
