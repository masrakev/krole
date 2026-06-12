import { create } from "zustand";
import { synthesizeSpeech } from "../lib/api";

interface VoiceState {
  /** Lecture vocale des réponses activée (OFF par défaut). */
  ttsEnabled: boolean;
  /** Vrai pendant la synthèse OU la lecture audio en cours. */
  speaking: boolean;
  toggleTts: () => void;
  /** Synthétise puis lit `text`. Coupe toute lecture précédente. */
  speak: (text: string) => Promise<void>;
  /** Interrompt la lecture / synthèse en cours. */
  stopSpeaking: () => void;
}

// Refs au niveau module : l'élément audio et le contrôleur d'abandon ne font
// pas partie du rendu, on les garde hors du state.
let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let controller: AbortController | null = null;

function cleanup(): void {
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = "";
    audio = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  ttsEnabled: false,
  speaking: false,

  toggleTts: () => {
    const next = !get().ttsEnabled;
    // Désactiver coupe immédiatement une éventuelle lecture en cours.
    if (!next) get().stopSpeaking();
    set({ ttsEnabled: next });
  },

  speak: async (text: string) => {
    const value = text.trim();
    if (!value) return;

    get().stopSpeaking();
    controller = new AbortController();
    set({ speaking: true });

    try {
      const blob = await synthesizeSpeech(value, controller.signal);
      // Abandonné pendant la synthèse : ne pas démarrer la lecture.
      if (controller.signal.aborted) return;
      audioUrl = URL.createObjectURL(blob);
      audio = new Audio(audioUrl);
      audio.onended = () => {
        cleanup();
        set({ speaking: false });
      };
      audio.onerror = () => {
        cleanup();
        set({ speaking: false });
      };
      await audio.play();
    } catch {
      // Erreur réseau OU abandon volontaire : on retombe en état muet.
      cleanup();
      set({ speaking: false });
    }
  },

  stopSpeaking: () => {
    controller?.abort();
    controller = null;
    cleanup();
    set({ speaking: false });
  },
}));
