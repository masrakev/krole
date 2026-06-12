import { AlertCircle, Loader2, RefreshCw, Share2, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ForceGraph2DRaw from "react-force-graph-2d";
import type { EntityChunk, GraphEdge, GraphNode } from "../lib/graph";
import type { Source } from "../lib/sse";
import { useDocuments } from "../queries/documents";
import { useEntityChunks, useGraph, useRebuildGraph } from "../queries/graph";
import { useChatStore } from "../store/chat";
import { useThemeStore } from "../store/theme";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = ForceGraph2DRaw as unknown as any;

type FGNode = GraphNode & { x?: number; y?: number };
type FGLink = GraphEdge;

// Couleurs par type — DÉSATURÉES (teintes sourdes) pour rester cohérent avec
// le thème monochrome.
const TYPE_COLORS: Record<string, string> = {
  person: "#9ca3af",
  org: "#84938c",
  place: "#9c9079",
  date: "#7f8a96",
  concept: "#8f86a1",
  other: "#6b6b6b",
};
const TYPE_IDS = ["person", "org", "place", "date", "concept", "other"] as const;
const TYPE_KEY: Record<string, string> = {
  person: "graph.typePerson",
  org: "graph.typeOrg",
  place: "graph.typePlace",
  date: "graph.typeDate",
  concept: "graph.typeConcept",
  other: "graph.typeOther",
};

const colorFor = (type: string) => TYPE_COLORS[type] ?? TYPE_COLORS.other;
const radius = (count: number) => 4 + Math.sqrt(Math.max(count, 1)) * 2;

/** Mesure réactive (largeur + hauteur) du conteneur du canvas. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight }),
    );
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function Legend() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {TYPE_IDS.map((type) => (
        <span
          key={type}
          className="flex items-center gap-1.5 font-mono text-[11px] text-fg-faint"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: colorFor(type) }}
          />
          {t(TYPE_KEY[type])}
        </span>
      ))}
    </div>
  );
}

/** Panneau latéral : chunks mentionnant l'entité sélectionnée. */
function NodePanel({
  node,
  onClose,
}: {
  node: { id: string; label: string; type: string; count: number };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: chunks, isLoading, isError } = useEntityChunks(node.id);
  const openSource = useChatStore((s) => s.openSource);

  return (
    <aside className="flex w-[320px] max-w-[80vw] shrink-0 flex-col overflow-hidden border-l border-hairline bg-canvas">
      <header className="flex items-start gap-2 border-b border-hairline px-4 py-3">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: colorFor(node.type) }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg" title={node.label}>
            {node.label}
          </p>
          <p className="font-mono text-[11px] text-fg-faint">
            {t(TYPE_KEY[node.type] ?? "graph.typeOther")} ·{" "}
            {t("graph.mentions", { count: node.count })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center gap-2 px-1 py-3 text-sm text-fg-faint">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : isError ? (
          <p className="px-1 py-3 text-sm text-fg-muted">{t("graph.loadFailed")}</p>
        ) : !chunks || chunks.length === 0 ? (
          <p className="px-1 py-3 text-sm text-fg-faint">{t("graph.noExcerpt")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {chunks.map((c: EntityChunk) => {
              const source: Source = {
                id: c.chunk_id,
                doc_id: c.doc_id,
                doc_name: c.doc_name,
                page: c.page,
                text: c.text,
              };
              return (
                <li key={c.chunk_id}>
                  <button
                    type="button"
                    onClick={() => openSource(source)}
                    className="group w-full rounded-lg border border-hairline bg-surface p-2.5 text-left transition-colors hover:border-hairline-strong"
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-xs text-fg-muted">
                      <span className="truncate" title={c.doc_name}>
                        {c.doc_name}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-fg-faint">
                        p.{c.page}
                      </span>
                    </div>
                    <p className="line-clamp-3 break-words text-xs leading-relaxed text-fg-faint group-hover:text-fg-muted">
                      {c.text}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

export function GraphView() {
  const { t } = useTranslation();
  const [docId, setDocId] = useState<string | null>(null);
  const [selected, setSelected] = useState<FGNode | null>(null);
  const [sizeRef, size] = useSize<HTMLDivElement>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const theme = useThemeStore((s) => s.theme);

  const paint =
    theme === "dark"
      ? { label: "rgba(250,250,250,0.72)", link: "rgba(255,255,255,0.12)", stroke: "#FAFAFA" }
      : { label: "rgba(10,10,10,0.72)", link: "rgba(0,0,0,0.14)", stroke: "#0A0A0A" };

  const { data: docs } = useDocuments();
  const rebuild = useRebuildGraph();
  const rebuilding = rebuild.isPending;
  const { data, isLoading, isError, error } = useGraph(docId, {
    refetchInterval: rebuilding ? 2500 : false,
  });

  const graphData = useMemo(
    () => ({
      nodes: (data?.nodes ?? []).map((n) => ({ ...n })),
      links: (data?.edges ?? []).map((e) => ({ ...e })),
    }),
    [data],
  );

  const drawNode = (node: FGNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const r = radius(node.count);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = colorFor(node.type);
    ctx.fill();
    if (selected?.id === node.id) {
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = paint.stroke;
      ctx.stroke();
    }
    if (scale > 1 || node.count > 1) {
      const fontSize = Math.max(10 / scale, 2.5);
      ctx.font = `${fontSize}px "Geist Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = paint.label;
      ctx.fillText(node.label, x, y + r + 1);
    }
  };

  const paintPointer = (
    node: FGNode,
    color: string,
    ctx: CanvasRenderingContext2D,
  ) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius(node.count), 0, 2 * Math.PI);
    ctx.fill();
  };

  const nodeCount = graphData.nodes.length;
  const showOverlay = nodeCount === 0;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-4 py-3">
        <select
          value={docId ?? ""}
          onChange={(e) => {
            setDocId(e.target.value || null);
            setSelected(null);
          }}
          className="max-w-[220px] shrink rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-xs text-fg transition-colors focus:border-hairline-strong focus:outline-none"
        >
          <option value="">{t("graph.allDocuments")}</option>
          {docs?.map((d) => (
            <option key={d.doc_id} value={d.doc_id}>
              {d.name}
            </option>
          ))}
        </select>

        <Legend />

        <div className="ml-auto flex items-center gap-3">
          {nodeCount > 0 && (
            <span className="font-mono text-[11px] text-fg-faint">
              {t("graph.entitiesRelations", {
                entities: nodeCount,
                relations: graphData.links.length,
              })}
            </span>
          )}
          <button
            type="button"
            onClick={() => rebuild.mutate()}
            disabled={rebuilding}
            className="flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-hairline-strong hover:text-fg disabled:opacity-60"
          >
            {rebuilding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("graph.rebuild")}
          </button>
        </div>
      </div>

      {/* Bandeau de progression (graphe déjà partiellement peuplé) */}
      {rebuilding && nodeCount > 0 && (
        <div className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-1.5 font-mono text-[11px] text-fg-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("graph.buildingCount", { count: nodeCount })}
        </div>
      )}

      {/* Corps : canvas + panneau latéral */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div ref={sizeRef} className="relative min-w-0 flex-1 overflow-hidden">
          {size.w > 0 && nodeCount > 0 && (
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              backgroundColor="rgba(0,0,0,0)"
              graphData={graphData}
              nodeId="id"
              nodeRelSize={4}
              nodeCanvasObject={drawNode}
              nodePointerAreaPaint={paintPointer}
              onNodeClick={(node: FGNode) => setSelected(node)}
              onBackgroundClick={() => setSelected(null)}
              linkColor={() => paint.link}
              linkWidth={(l: FGLink) => Math.min(1 + (l.weight ?? 1) * 0.25, 3)}
              linkDirectionalArrowLength={3}
              linkDirectionalArrowRelPos={1}
              linkLabel={(l: FGLink) => l.label}
              cooldownTicks={120}
              onEngineStop={() => fgRef.current?.zoomToFit?.(400, 60)}
            />
          )}

          {showOverlay && (
            <div className="absolute inset-0 grid place-items-center p-6">
              {rebuilding ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
                  <p className="text-sm font-medium text-fg">{t("graph.building")}</p>
                  <p className="max-w-xs text-xs text-fg-faint">
                    {t("graph.buildingHint")}
                  </p>
                </div>
              ) : isLoading ? (
                <div className="flex items-center gap-2 text-sm text-fg-faint">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("graph.loading")}
                </div>
              ) : isError ? (
                <div className="flex items-start gap-2 rounded-lg border border-hairline-strong bg-surface px-4 py-3 text-sm text-fg-muted">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {error instanceof Error
                      ? error.message
                      : t("sidebar.backendUnreachable")}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-muted">
                    <Share2 className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium text-fg">
                    {docId ? t("graph.emptyDoc") : t("graph.emptyAll")}
                  </p>
                  <p className="max-w-xs text-xs text-fg-faint">{t("graph.emptyHint")}</p>
                  <button
                    type="button"
                    onClick={() => rebuild.mutate()}
                    className="mt-1 flex items-center gap-2 rounded-lg bg-fg px-3.5 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90"
                  >
                    <Share2 className="h-4 w-4" /> {t("graph.build")}
                  </button>
                  {rebuild.isError && (
                    <p className="text-xs text-fg-muted">
                      {rebuild.error instanceof Error
                        ? rebuild.error.message
                        : t("graph.buildFailed")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {selected && <NodePanel node={selected} onClose={() => setSelected(null)} />}
      </div>
    </section>
  );
}
