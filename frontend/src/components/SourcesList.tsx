import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Source } from "../lib/sse";
import { useChatStore } from "../store/chat";

interface SourcesListProps {
  sources: Source[];
}

/** Liste des sources sous une réponse assistant — ouvre le lecteur au clic. */
export function SourcesList({ sources }: SourcesListProps) {
  const { t } = useTranslation();
  const openSource = useChatStore((s) => s.openSource);
  if (sources.length === 0) return null;

  return (
    <div className="mt-4 border-t border-hairline pt-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        {t("chat.sources")}
      </p>
      <ul className="flex flex-col gap-1">
        {sources.map((source, i) => (
          <li key={source.id}>
            <button
              type="button"
              title={source.text}
              onClick={() => openSource(source)}
              className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-fg-muted transition-colors hover:bg-surface hover:text-fg"
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-hairline font-mono text-[10px] text-fg-muted">
                {i + 1}
              </span>
              <FileText className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
              <span className="truncate">{source.doc_name}</span>
              <span className="shrink-0 font-mono text-fg-faint">p.{source.page}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
