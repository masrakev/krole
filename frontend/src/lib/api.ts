// Client HTTP du backend. L'URL de base vient de l'env Vite ; fallback localhost.
export const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export interface DocumentOut {
  doc_id: string;
  name: string;
  pages: number;
  chunks: number;
  created_at: string;
}

/** Fournisseur de génération ACTIF côté backend (après repli éventuel). */
export interface AppConfig {
  llm_provider: string;
  llm_model: string;
  llm_local: boolean;
}

export async function getAppConfig(): Promise<AppConfig> {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Extrait un message d'erreur lisible d'une réponse FastAPI ({detail}). */
async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) return body.detail[0].msg;
  } catch {
    /* corps non-JSON */
  }
  return `Erreur ${res.status} (${res.statusText || "requête échouée"})`;
}

export async function listDocuments(): Promise<DocumentOut[]> {
  const res = await fetch(`${API_BASE}/api/documents`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function uploadDocuments(files: File[]): Promise<DocumentOut[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const res = await fetch(`${API_BASE}/api/documents`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/documents/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Envoie un clip audio au backend (Whisper) et renvoie la transcription. */
export async function transcribeAudio(
  blob: Blob,
  filename = "recording.webm",
): Promise<string> {
  const form = new FormData();
  form.append("audio", blob, filename);
  const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return typeof data?.text === "string" ? data.text : "";
}

/** Demande au backend (Piper) de lire un texte ; renvoie un Blob audio/wav. */
export async function synthesizeSpeech(
  text: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/voice/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.blob();
}
