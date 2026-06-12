import i18n from "../i18n";
import { API_BASE } from "./api";

// --- Types des messages échangés -----------------------------------------
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// --- Types des données portées par chaque event SSE ----------------------
export interface RewriteData {
  query: string;
}

export interface RetrievalCandidate {
  doc_name: string;
  page: number;
  score: number;
  snippet: string;
}

export interface RetrievalData {
  candidates: RetrievalCandidate[];
  /** Latences (optionnelles, rétro-compatibles). */
  rewrite_ms?: number;
  retrieval_ms?: number;
}

export interface RerankItem {
  id: string;
  doc_name: string;
  page: number;
  score: number;
}

export interface RerankData {
  top: RerankItem[];
  rerank_ms?: number;
}

/** Un chunk récupéré avec tous ses scores intermédiaires (mode debug). */
export interface DebugChunk {
  chunk_id: string;
  doc_name: string;
  page: number;
  snippet: string;
  used: boolean;
  vector_rank: number | null;
  vector_distance: number | null;
  bm25_rank: number | null;
  bm25_score: number | null;
  rrf_score: number | null;
  rerank_score: number | null;
}

export interface DebugData {
  prompt: { system: string; user: string; full: string };
  chunks: DebugChunk[];
  tokens: { prompt_tokens: number; completion_tokens: number; num_ctx: number };
}

/** Fournisseur ayant rédigé la réponse (porté par l'event done). */
export interface ProviderInfo {
  name: string;
  model: string;
  local: boolean;
}

export interface DoneData {
  generation_ms?: number;
  /** Moteur de génération effectivement utilisé pour CETTE réponse. */
  provider?: ProviderInfo;
  /** Présent uniquement en mode debug. */
  debug?: DebugData;
}

export interface Source {
  id: string;
  doc_id: string;
  doc_name: string;
  page: number;
  text: string;
}

// --- Handlers typés dispatchés par le parser -----------------------------
export interface RagHandlers {
  onRewrite?: (data: RewriteData) => void;
  onRetrieval?: (data: RetrievalData) => void;
  onRerank?: (data: RerankData) => void;
  onToken?: (text: string) => void;
  onSources?: (sources: Source[]) => void;
  onDone?: (data: DoneData) => void;
  onError?: (detail: string) => void;
  /** Appelé dès que des octets arrivent (event, token OU heartbeat de
   *  commentaire). Sert à réarmer le watchdog d'inactivité : tant que le flux
   *  envoie quoi que ce soit, on ne considère jamais le serveur comme muet. */
  onData?: () => void;
}

/** Aiguille un bloc SSE parsé ({event, data}) vers le bon handler. */
function dispatch(event: string, payload: unknown, handlers: RagHandlers): void {
  const data = (payload ?? {}) as Record<string, unknown>;
  switch (event) {
    case "rewrite":
      handlers.onRewrite?.(data as unknown as RewriteData);
      break;
    case "retrieval":
      handlers.onRetrieval?.(data as unknown as RetrievalData);
      break;
    case "rerank":
      handlers.onRerank?.(data as unknown as RerankData);
      break;
    case "token":
      handlers.onToken?.(String(data.text ?? ""));
      break;
    case "sources":
      handlers.onSources?.((data.sources ?? []) as Source[]);
      break;
    case "error":
      handlers.onError?.(String(data.detail ?? i18n.t("chat.errEngine")));
      break;
    case "done":
      handlers.onDone?.(data as unknown as DoneData);
      break;
    default:
      break;
  }
}

/** Parse un bloc SSE brut (séparé par une ligne vide) en {event, data}. */
function parseBlock(raw: string, handlers: RagHandlers): void {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue; // commentaire / heartbeat
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }

  if (dataLines.length === 0) return;

  const dataStr = dataLines.join("\n");
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(dataStr);
  } catch {
    parsed = { text: dataStr };
  }
  dispatch(event, parsed, handlers);
}

/**
 * POST /api/rag/chat puis lit le flux text/event-stream via ReadableStream.
 * (On n'utilise PAS EventSource : il ne sait faire que du GET.)
 */
export async function streamRagChat(
  messages: ChatMessage[],
  handlers: RagHandlers,
  signal?: AbortSignal,
  debug = false,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/rag/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, debug }),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = `Erreur ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* corps non-JSON */
    }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // Toute donnée reçue (même un heartbeat de commentaire) réarme l'inactivité.
    if (value && value.length) handlers.onData?.();
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (block.trim()) parseBlock(block, handlers);
    }
  }

  // Vidange d'un éventuel dernier bloc sans séparateur final.
  if (buffer.trim()) parseBlock(buffer, handlers);
}

export interface PlainHandlers {
  onToken?: (text: string) => void;
  onError?: (detail: string) => void;
  onData?: () => void;
}

/**
 * POST /api/chat (Mistral seul, SANS récupération) puis lit le flux SSE.
 * Format simple : `data: {"token": …}`, `data: {"error": …}`, `data: [DONE]`.
 */
export async function streamPlainChat(
  messages: ChatMessage[],
  handlers: PlainHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = `Erreur ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* corps non-JSON */
    }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleBlock = (raw: string) => {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).replace(/^ /, "");
      if (payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload);
        if (obj.error) handlers.onError?.(String(obj.error));
        else if (obj.token) handlers.onToken?.(String(obj.token));
      } catch {
        /* ignore */
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) handlers.onData?.();
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (block.trim()) handleBlock(block);
    }
  }
  if (buffer.trim()) handleBlock(buffer);
}
