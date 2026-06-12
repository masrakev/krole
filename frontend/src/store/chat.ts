import { create } from "zustand";
import {
  streamPlainChat,
  streamRagChat,
  type ChatMessage,
  type DebugData,
  type RerankItem,
  type RetrievalCandidate,
  type Source,
} from "../lib/sse";
import i18n from "../i18n";
import { useSettingsStore } from "./settings";
import { useVoiceStore } from "./voice";

/** Retire les marqueurs de citation [n] pour une lecture vocale plus naturelle. */
const stripCitations = (text: string): string =>
  text.replace(/\[\d+\]/g, "").replace(/\s{2,}/g, " ").trim();

/** Latences par étape du pipeline (ms), telles que rapportées par le backend. */
export interface Timings {
  rewrite_ms?: number;
  retrieval_ms?: number;
  rerank_ms?: number;
  generation_ms?: number;
}

/** Données de « raisonnement visible » ayant produit une réponse assistant. */
export interface Investigation {
  /** Question d'origine de l'utilisateur. */
  original: string;
  /** Requête reformulée par le backend. */
  rewrite?: string;
  /** Candidats récupérés (avant rerank). */
  candidates: RetrievalCandidate[];
  /** Top-k conservés après reclassement. */
  top: RerankItem[];
  timings: Timings;
  /** Données de debug (mode développeur) : prompt, chunks scorés, tokens. */
  debug?: DebugData;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  investigation?: Investigation;
  error?: boolean;
  /** Mode ayant produit la réponse : RAG complet ou Mistral seul. */
  mode?: "rag" | "plain";
}

export type Phase =
  | "idle"
  | "rewrite"
  | "retrieval"
  | "rerank"
  | "generating"
  | "answering";

interface ChatState {
  messages: UiMessage[];
  isStreaming: boolean;
  /** Id du message assistant en cours de streaming (null hors streaming). */
  streamingId: string | null;
  /** Étape en cours du pipeline. */
  phase: Phase;
  error: string | null;
  /** Source ouverte dans le SourceViewer (null = fermé). */
  selectedSource: Source | null;
  sendMessage: (text: string) => Promise<void>;
  openSource: (source: Source) => void;
  closeSource: () => void;
  /** Interrompt le stream en cours (démontage, arrêt manuel). */
  stop: () => void;
  reset: () => void;
}

const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

// Watchdog d'INACTIVITÉ : on n'abandonne que si AUCUNE donnée (event, token ou
// heartbeat) n'arrive pendant ce délai de vrai silence. Le minuteur est réarmé
// à chaque octet reçu — une fois que les étapes/tokens circulent, le flux ne
// peut donc jamais expirer en cours de route, même si la génération CPU est lente.
const IDLE_TIMEOUT_MS = 45_000;

// Refs au niveau module : accessibles par stop() et par le watchdog.
let controller: AbortController | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;

function clearWatchdog(): void {
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingId: null,
  phase: "idle",
  error: null,
  selectedSource: null,

  sendMessage: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || get().isStreaming) return;

    // Coupe tout flux résiduel avant d'en démarrer un nouveau.
    controller?.abort();
    clearWatchdog();

    const { ragEnabled, debugEnabled } = useSettingsStore.getState();

    const userMsg: UiMessage = { id: uid(), role: "user", content: trimmed };
    const assistantId = uid();
    // Placeholder assistant : on y streamera tokens ET données d'investigation.
    // En mode « Mistral seul » (RAG off), pas d'investigation ni de sources.
    const assistantMsg: UiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      mode: ragEnabled ? "rag" : "plain",
      investigation: ragEnabled
        ? { original: trimmed, candidates: [], top: [], timings: {} }
        : undefined,
    };

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      isStreaming: true,
      streamingId: assistantId,
      phase: ragEnabled ? "rewrite" : "generating",
      error: null,
    }));

    // Historique envoyé au backend : on exclut le placeholder vide.
    const apiMessages: ChatMessage[] = get()
      .messages.filter((m) => m.id !== assistantId)
      .map(({ role, content }) => ({ role, content }));

    let collectedSources: Source[] = [];
    let timedOut = false;

    // Met à jour l'investigation du message en cours.
    const patchInv = (
      patch: Partial<Investigation>,
      timings?: Partial<Timings>,
    ) =>
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId && m.investigation
            ? {
                ...m,
                investigation: {
                  ...m.investigation,
                  ...patch,
                  timings: { ...m.investigation.timings, ...(timings ?? {}) },
                },
              }
            : m,
        ),
      }));

    const advance = (next: Phase) =>
      set((s) => (s.phase === "answering" ? {} : { phase: next }));

    // (Ré)arme le watchdog d'inactivité ; appelé à chaque donnée reçue.
    const armWatchdog = () => {
      clearWatchdog();
      watchdog = setTimeout(() => {
        timedOut = true;
        controller?.abort();
      }, IDLE_TIMEOUT_MS);
    };

    const appendToken = (t: string) =>
      set((s) => ({
        phase: "answering",
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + t } : m,
        ),
      }));

    controller = new AbortController();
    armWatchdog();

    try {
      if (ragEnabled) {
        await streamRagChat(
          apiMessages,
          {
            // Toute donnée reçue (event, token ou heartbeat) réarme l'inactivité.
            onData: () => armWatchdog(),
            onRewrite: (d) => {
              patchInv({ rewrite: d.query });
              advance("retrieval");
            },
            onRetrieval: (d) => {
              patchInv(
                { candidates: d.candidates },
                { rewrite_ms: d.rewrite_ms, retrieval_ms: d.retrieval_ms },
              );
              advance("rerank");
            },
            onRerank: (d) => {
              patchInv({ top: d.top }, { rerank_ms: d.rerank_ms });
              advance("generating");
            },
            onToken: (t) => appendToken(t),
            onSources: (src) => {
              collectedSources = src;
            },
            onDone: (d) => {
              clearWatchdog();
              if (d.generation_ms != null)
                patchInv({}, { generation_ms: d.generation_ms });
              if (d.debug) patchInv({ debug: d.debug });
            },
            onError: (detail) => set({ error: detail }),
          },
          controller.signal,
          debugEnabled,
        );
      } else {
        // Mode « Mistral seul » : pas de récupération, pas de sources.
        await streamPlainChat(
          apiMessages,
          {
            onData: () => armWatchdog(),
            onToken: (t) => appendToken(t),
            onError: (detail) => set({ error: detail }),
          },
          controller.signal,
        );
      }
    } catch (e) {
      if (timedOut) {
        set({ error: i18n.t("chat.errIdle") });
      } else if (e instanceof DOMException && e.name === "AbortError") {
        // Abandon volontaire (stop / nouveau message / démontage) : pas d'erreur.
      } else {
        set({
          error: e instanceof Error ? e.message : i18n.t("chat.errConnection"),
        });
      }
    } finally {
      clearWatchdog();
      controller = null;
      set((s) => {
        const err = s.error;
        const messages = s.messages.map((m) => {
          if (m.id !== assistantId) return m;
          const body = m.content.trim();
          if (err) {
            const content = body ? `${m.content}\n\n— ${err}` : err;
            return { ...m, content, error: true };
          }
          if (!body) {
            return {
              ...m,
              content: i18n.t("chat.noAnswer"),
              error: true,
            };
          }
          return {
            ...m,
            sources: collectedSources.length ? collectedSources : m.sources,
          };
        });
        return {
          messages,
          isStreaming: false,
          streamingId: null,
          phase: "idle",
        };
      });

      // Lecture vocale de la réponse terminée, si le mode TTS est activé.
      const finalMsg = get().messages.find((m) => m.id === assistantId);
      const voice = useVoiceStore.getState();
      if (
        voice.ttsEnabled &&
        finalMsg &&
        !finalMsg.error &&
        finalMsg.content.trim()
      ) {
        void voice.speak(stripCitations(finalMsg.content));
      }
    }
  },

  openSource: (source) => set({ selectedSource: source }),
  closeSource: () => set({ selectedSource: null }),

  stop: () => {
    clearWatchdog();
    controller?.abort();
  },

  reset: () => {
    clearWatchdog();
    controller?.abort();
    controller = null;
    set({
      messages: [],
      isStreaming: false,
      streamingId: null,
      phase: "idle",
      error: null,
      selectedSource: null,
    });
  },
}));
