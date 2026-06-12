import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchEntityChunks,
  fetchGraph,
  rebuildGraph,
  type EntityChunk,
  type GraphData,
} from "../lib/graph";

export function useGraph(
  docId: string | null,
  options?: { refetchInterval?: number | false },
) {
  return useQuery<GraphData>({
    queryKey: ["graph", docId ?? "all"],
    queryFn: () => fetchGraph(docId),
    staleTime: 60_000,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useEntityChunks(nodeId: string | null) {
  return useQuery<EntityChunk[]>({
    queryKey: ["entity-chunks", nodeId],
    queryFn: () => fetchEntityChunks(nodeId as string),
    enabled: !!nodeId,
  });
}

export function useRebuildGraph() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rebuildGraph,
    // `onSettled` (et pas seulement `onSuccess`) : la reconstruction est une
    // requête très longue sur CPU ; si la connexion lâche avant la réponse, le
    // graphe a malgré tout été persisté (commits par chunk). On rafraîchit donc
    // dans tous les cas pour afficher le graphe construit plutôt qu'une erreur.
    onSettled: () => qc.invalidateQueries({ queryKey: ["graph"] }),
  });
}
