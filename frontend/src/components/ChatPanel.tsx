import { Fragment, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore, type Phase, type UiMessage } from "../store/chat";
import { InvestigationPanel } from "./InvestigationPanel";
import { Logo } from "./Logo";
import { Message } from "./Message";
import { MessageInput } from "./MessageInput";

/** Pastille « assistant » discrète, monochrome. */
function AssistantDot() {
  return (
    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-2">
      <span className="h-1.5 w-1.5 rounded-full bg-fg-muted" />
    </div>
  );
}

/**
 * Indicateur d'étapes du pipeline AVANT l'arrivée des tokens.
 * Marque l'étape EN COURS de sorte qu'aucune ne se fige silencieusement.
 */
function StageIndicator({ message }: { message: UiMessage }) {
  const { t } = useTranslation();
  const phase = useChatStore((s) => s.phase);
  const n = message.investigation?.candidates.length;

  // Mode « Mistral seul » : pas d'étapes RAG, simple indicateur de génération.
  if (message.mode === "plain") {
    return (
      <div className="flex gap-3">
        <AssistantDot />
        <div className="flex items-center gap-2 pt-1 font-mono text-xs text-fg-faint">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-fg-muted" />
          {t("chat.stageGenerating")}…
        </div>
      </div>
    );
  }

  const order: Phase[] = ["rewrite", "retrieval", "rerank", "generating"];
  const labels: Record<string, string> = {
    rewrite: t("chat.stageRewrite"),
    retrieval: n ? t("chat.stageRetrievalN", { count: n }) : t("chat.stageRetrieval"),
    rerank: t("chat.stageRerank"),
    generating: t("chat.stageGenerating"),
  };

  const activeIdx = order.indexOf(phase);
  const visible = order.slice(0, activeIdx === -1 ? 0 : activeIdx + 1);

  return (
    <div className="flex gap-3">
      <AssistantDot />
      <div className="flex items-center gap-2 pt-1 font-mono text-xs text-fg-faint">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-fg-muted" />
        <span>
          {visible.length === 0
            ? t("chat.stageAnalyse")
            : visible.map((step, i) => {
                const active = i === visible.length - 1;
                return (
                  <Fragment key={step}>
                    {i > 0 && <span className="text-fg-faint/60"> · </span>}
                    <span className={active ? "text-fg-muted" : "text-fg-faint/70"}>
                      {labels[step]}
                      {active && "…"}
                    </span>
                  </Fragment>
                );
              })}
        </span>
      </div>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const examples = t("chat.examples", { returnObjects: true }) as string[];
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Logo className="mb-5 scale-110" />
      <p className="max-w-sm text-[15px] text-fg-muted">{t("chat.tagline")}</p>
      <div className="mt-7 flex max-w-lg flex-wrap justify-center gap-2">
        {examples.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => void sendMessage(q)}
            className="rounded-lg border border-hairline px-3.5 py-2 text-[13px] text-fg-muted transition-colors hover:border-hairline-strong hover:text-fg"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Vrai si l'investigation porte des données affichables. */
function hasInvestigation(message: UiMessage): boolean {
  const inv = message.investigation;
  return (
    !!inv &&
    message.role === "assistant" &&
    (inv.candidates.length > 0 || inv.top.length > 0)
  );
}

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingId = useChatStore((s) => s.streamingId);
  const stop = useChatStore((s) => s.stop);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll vers le bas à chaque nouveau token / message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  // Coupe tout flux en cours si le panneau est démonté.
  useEffect(() => stop, [stop]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex-1 overflow-y-auto px-4 py-8">
        {messages.length === 0 && !isStreaming ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex max-w-[720px] flex-col gap-7">
            {messages.map((message) => {
              const isStreamingMsg = message.id === streamingId;
              // Message assistant en cours et encore vide : on montre les étapes.
              if (isStreamingMsg && message.content.length === 0) {
                return <StageIndicator key={message.id} message={message} />;
              }
              return (
                <div key={message.id} className="flex flex-col gap-2.5">
                  <Message message={message} streaming={isStreamingMsg} />
                  {hasInvestigation(message) && (
                    <div className="pl-9">
                      <InvestigationPanel investigation={message.investigation!} />
                    </div>
                  )}
                </div>
              );
            })}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <MessageInput />
    </section>
  );
}
