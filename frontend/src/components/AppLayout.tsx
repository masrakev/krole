import { useViewStore } from "../store/view";
import { ChatPanel } from "./ChatPanel";
import { DocumentSidebar } from "./DocumentSidebar";
import { EvalView } from "./EvalView";
import { GraphView } from "./GraphView";
import { SourceViewer } from "./SourceViewer";

/** Coquille : sidebar à gauche, panneau principal (Chat ou Graphe) à droite. */
export function AppLayout() {
  const view = useViewStore((s) => s.view);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-canvas text-fg md:flex-row">
      <DocumentSidebar />

      {/* Chat : jamais démonté (préserve le streaming en cours) — masqué en vue Graphe. */}
      <div className={`min-h-0 min-w-0 flex-1 ${view === "chat" ? "flex" : "hidden"}`}>
        <ChatPanel />
      </div>

      {view === "graph" && (
        <div className="flex min-h-0 min-w-0 flex-1">
          <GraphView />
        </div>
      )}

      {view === "eval" && (
        <div className="flex min-h-0 min-w-0 flex-1">
          <EvalView />
        </div>
      )}

      {/* Tiroir d'aperçu des sources : superposé, partagé par les deux vues. */}
      <SourceViewer />
    </div>
  );
}
