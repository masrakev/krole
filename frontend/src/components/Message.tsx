import { useTranslation } from "react-i18next";
import type { UiMessage } from "../store/chat";
import { useChatStore } from "../store/chat";
import type { Source } from "../lib/sse";
import { useAppConfig } from "../queries/config";
import { providerDisplayName } from "./ProviderBadge";
import { SourcesList } from "./SourcesList";

interface MessageProps {
  message: UiMessage;
  /** Affiche un curseur clignotant pendant le streaming. */
  streaming?: boolean;
}

/** Badge cliquable pour une citation [n] inline → ouvre la source. */
function CitationBadge({ n, source }: { n: number; source?: Source }) {
  const { t } = useTranslation();
  const openSource = useChatStore((s) => s.openSource);
  return (
    <button
      type="button"
      title={
        source ? `${source.doc_name} · p.${source.page}` : t("chat.citationSource", { n })
      }
      disabled={!source}
      onClick={() => source && openSource(source)}
      className="mx-px inline-flex h-[14px] min-w-[14px] translate-y-[-3px] items-center justify-center rounded border border-hairline px-0.5 align-baseline font-mono text-[9px] leading-none text-fg-muted transition hover:border-hairline-strong hover:text-fg disabled:cursor-default disabled:opacity-50"
    >
      {n}
    </button>
  );
}

/** Rend le texte en transformant les marqueurs [n] en badges cliquables. */
function renderContent(text: string, sources?: Source[]) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const n = Number(match[1]);
      return <CitationBadge key={i} n={n} source={sources?.[n - 1]} />;
    }
    return <span key={i}>{part}</span>;
  });
}

function ModeBadge({ mode }: { mode: "rag" | "plain" }) {
  const { t } = useTranslation();
  // Nom du moteur de génération actif : le badge reste honnête quand la
  // génération passe par un cloud (Gemini/Claude) au lieu de Mistral local.
  const { data: appConfig } = useAppConfig();
  const name = providerDisplayName(appConfig?.llm_provider ?? "mistral");
  return (
    <span className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          mode === "rag" ? "bg-fg-muted" : "border border-hairline-strong"
        }`}
      />
      {mode === "rag"
        ? t("chat.modeRag", { name })
        : t("chat.modePlain", { name })}
    </span>
  );
}

export function Message({ message, streaming = false }: MessageProps) {
  const isUser = message.role === "user";

  // Message utilisateur : discret, aligné à droite, petite bulle à filet.
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg border border-hairline bg-surface px-3.5 py-2 text-[15px] leading-relaxed text-fg">
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>
      </div>
    );
  }

  // Message assistant : pleine largeur, style document (pas de grosse bulle).
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-2">
        <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" />
      </div>
      <div className="min-w-0 flex-1">
        {message.mode && <ModeBadge mode={message.mode} />}
        <div
          className={`text-[15px] leading-relaxed ${
            message.error ? "text-fg-muted" : "text-fg"
          }`}
        >
          <div className="whitespace-pre-wrap break-words">
            {renderContent(message.content, message.sources)}
            {streaming && (
              <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse rounded-sm bg-fg-muted align-middle" />
            )}
          </div>

          {message.sources && message.sources.length > 0 && (
            <SourcesList sources={message.sources} />
          )}
        </div>
      </div>
    </div>
  );
}
