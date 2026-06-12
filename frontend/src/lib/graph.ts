import { API_BASE } from "./api";

export type EntityType =
  | "person"
  | "org"
  | "place"
  | "date"
  | "concept"
  | "other";

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  count: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface EntityChunk {
  doc_id: string;
  doc_name: string;
  page: number;
  chunk_id: string;
  text: string;
}

export interface RebuildSummary {
  documents: number;
  nodes: number;
  edges: number;
  chunks: number;
}

async function errText(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    /* corps non-JSON */
  }
  return `Erreur ${res.status}`;
}

/** Récupère le graphe (optionnellement restreint à un document). */
export async function fetchGraph(docId?: string | null): Promise<GraphData> {
  const url = new URL(`${API_BASE}/api/graph`);
  if (docId) url.searchParams.set("doc_id", docId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(await errText(res));
  return res.json();
}

/** Chunks qui mentionnent une entité (avec texte + nom de document). */
export async function fetchEntityChunks(nodeId: string): Promise<EntityChunk[]> {
  const res = await fetch(
    `${API_BASE}/api/graph/entity/${encodeURIComponent(nodeId)}/chunks`,
  );
  if (!res.ok) throw new Error(await errText(res));
  return res.json();
}

/** (Re)construit le graphe pour tous les documents indexés. Lent sur CPU. */
export async function rebuildGraph(): Promise<RebuildSummary> {
  const res = await fetch(`${API_BASE}/api/graph/rebuild`, { method: "POST" });
  if (!res.ok) throw new Error(await errText(res));
  return res.json();
}
