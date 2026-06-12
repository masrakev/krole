import {
  ArrowUp,
  Bug,
  Database,
  DatabaseZap,
  Loader2,
  Mic,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { transcribeAudio } from "../lib/api";
import { useAppConfig } from "../queries/config";
import { useChatStore } from "../store/chat";
import { useSettingsStore } from "../store/settings";
import { useVoiceStore } from "../store/voice";
import { ProviderBadge, providerDisplayName } from "./ProviderBadge";

export function MessageInput() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- Mode vocal : enregistrement micro -> transcription Whisper ---------
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // --- TTS : lecture vocale des réponses ----------------------------------
  const ttsEnabled = useVoiceStore((s) => s.ttsEnabled);
  const speaking = useVoiceStore((s) => s.speaking);
  const toggleTts = useVoiceStore((s) => s.toggleTts);
  const stopSpeaking = useVoiceStore((s) => s.stopSpeaking);

  // --- Mode RAG / Debug ----------------------------------------------------
  const ragEnabled = useSettingsStore((s) => s.ragEnabled);
  const debugEnabled = useSettingsStore((s) => s.debugEnabled);
  const toggleRag = useSettingsStore((s) => s.toggleRag);
  const toggleDebug = useSettingsStore((s) => s.toggleDebug);

  // Nom du moteur actif (pour le libellé honnête de la bascule « X seul »).
  const { data: appConfig } = useAppConfig();
  const llmName = providerDisplayName(appConfig?.llm_provider ?? "mistral");

  const submit = () => {
    const value = text.trim();
    if (!value || isStreaming) return;
    setText("");
    void sendMessage(value);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    setVoiceError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError(t("input.micUnsupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        releaseStream();
        setRecording(false);
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) return;
        const ext = type.includes("ogg") ? "ogg" : "webm";
        setTranscribing(true);
        try {
          const transcript = await transcribeAudio(blob, `recording.${ext}`);
          if (transcript) {
            // Ne PAS auto-envoyer : on remplit l'input pour relecture.
            setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
            textareaRef.current?.focus();
          } else {
            setVoiceError(t("input.noSpeech"));
          }
        } catch (err) {
          setVoiceError(err instanceof Error ? err.message : t("input.transcribeFailed"));
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      releaseStream();
      setVoiceError(t("input.micDenied"));
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  };

  const toggleMic = () => (recording ? stopRecording() : void startRecording());

  const iconBtn =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  const placeholder = recording
    ? t("chat.placeholderRecording")
    : transcribing
      ? t("chat.placeholderTranscribing")
      : isStreaming
        ? t("chat.placeholderGenerating")
        : t("chat.placeholder");

  return (
    <div className="border-t border-hairline bg-canvas px-4 py-4">
      <div className="mx-auto max-w-[720px]">
        {/* Barre de bascules : RAG (avec/sans contexte) + mode debug. */}
        <div className="mb-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleRag}
            aria-pressed={ragEnabled}
            title={
              ragEnabled
                ? t("input.ragTitleOn")
                : t("input.ragTitleOff", { name: llmName })
            }
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              ragEnabled
                ? "border-hairline-strong bg-surface-2 text-fg"
                : "border-hairline text-fg-muted hover:text-fg"
            }`}
          >
            {ragEnabled ? (
              <DatabaseZap className="h-3.5 w-3.5" />
            ) : (
              <Database className="h-3.5 w-3.5" />
            )}
            {ragEnabled ? t("input.ragOn") : t("input.ragOff", { name: llmName })}
          </button>

          <button
            type="button"
            onClick={toggleDebug}
            aria-pressed={debugEnabled}
            title={t("input.debugTitle")}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              debugEnabled
                ? "border-hairline-strong bg-surface-2 text-fg"
                : "border-hairline text-fg-muted hover:text-fg"
            }`}
          >
            <Bug className="h-3.5 w-3.5" />
            {t("input.debug")}
          </button>

          <ProviderBadge />

          {speaking && (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-fg-muted">
              <Volume2 className="h-3.5 w-3.5 animate-pulse" />
              {t("input.speaking")}
              <button
                type="button"
                onClick={stopSpeaking}
                className="ml-1 inline-flex items-center gap-1 rounded border border-hairline px-1.5 py-0.5 text-fg-muted transition-colors hover:border-hairline-strong hover:text-fg"
              >
                <Square className="h-3 w-3" />
                {t("input.stop")}
              </button>
            </span>
          )}
        </div>

        {voiceError && (
          <div className="mb-2 font-mono text-[11px] text-fg-muted">{voiceError}</div>
        )}

        {/* Champ + actions, dans un conteneur à filet unique. */}
        <div className="flex items-end gap-2 rounded-lg border border-hairline bg-surface px-2 py-1.5 transition-colors focus-within:border-hairline-strong">
          {/* TTS */}
          <button
            type="button"
            onClick={toggleTts}
            aria-pressed={ttsEnabled}
            aria-label={ttsEnabled ? t("input.ttsDisable") : t("input.ttsEnable")}
            title={ttsEnabled ? t("input.ttsStateOn") : t("input.ttsStateOff")}
            className={`${iconBtn} ${
              ttsEnabled
                ? "border-hairline-strong bg-surface-2 text-fg"
                : "border-transparent text-fg-faint hover:text-fg"
            }`}
          >
            {ttsEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onInput={onInput}
            disabled={isStreaming}
            placeholder={placeholder}
            className="max-h-40 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-[15px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-0 disabled:opacity-60"
          />

          {/* Micro */}
          <button
            type="button"
            onClick={toggleMic}
            disabled={transcribing || isStreaming}
            aria-label={recording ? t("input.micStop") : t("input.micRecord")}
            title={recording ? t("input.micStop") : t("input.micRecord")}
            className={`${iconBtn} ${
              recording
                ? "animate-pulse border-hairline-strong bg-surface-2 text-fg"
                : "border-transparent text-fg-faint hover:text-fg"
            }`}
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : recording ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>

          {/* Envoi */}
          <button
            type="button"
            onClick={submit}
            disabled={isStreaming || !text.trim()}
            aria-label={t("input.send")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-fg text-canvas transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
