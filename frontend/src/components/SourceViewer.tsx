import { FileText, Loader2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page } from "react-pdf";
import "../lib/pdf"; // configure le worker pdf.js (effet de bord)
import { isWithinChunk, normalize, segmentText } from "../lib/highlight";
import { getDocumentFileUrl } from "../queries/documents";
import { useChatStore } from "../store/chat";
import type { Source } from "../lib/sse";

type Kind = "pdf" | "text";

function kindOf(name: string): Kind {
  return name.toLowerCase().endsWith(".pdf") ? "pdf" : "text";
}

/** Les types textuels dont on sait récupérer le contenu brut côté client. */
function isFetchableText(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith(".txt") || n.endsWith(".md");
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Mesure réactive de la largeur d'un élément (pour dimensionner la page PDF). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// --- Lecteur PDF -----------------------------------------------------------

function PdfSource({ source }: { source: Source }) {
  const { t } = useTranslation();
  const [containerRef, width] = useWidth<HTMLDivElement>();
  const [numPages, setNumPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileUrl = useMemo(() => getDocumentFileUrl(source.doc_id), [source.doc_id]);
  const normChunk = useMemo(() => normalize(source.text), [source.text]);

  // Surligne chaque item du calque texte appartenant au passage cité.
  const customTextRenderer = useMemo(
    () =>
      ({ str }: { str: string }) =>
        isWithinChunk(str, normChunk)
          ? `<mark class="krole-pdfmark">${escapeHtml(str)}</mark>`
          : escapeHtml(str),
    [normChunk],
  );

  // Une fois le calque texte rendu, amène le premier surlignage au centre.
  const onTextLayer = () => {
    requestAnimationFrame(() => {
      const mark = containerRef.current?.querySelector(".krole-pdfmark");
      mark?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const pageWidth = Math.max(280, width - 32);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto bg-canvas p-4">
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        onLoadError={(e) => setError(e.message)}
        loading={
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-faint">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("source.loadingPdf")}
          </div>
        }
        error={
          <div className="py-10 text-center text-sm text-fg-muted">
            {t("source.pdfFailed")}
          </div>
        }
      >
        {!error && numPages != null && (
          <div className="mx-auto w-fit overflow-hidden rounded-lg border border-hairline">
            <Page
              pageNumber={Math.min(Math.max(1, source.page), numPages)}
              width={pageWidth}
              customTextRenderer={customTextRenderer}
              onRenderTextLayerSuccess={onTextLayer}
              renderAnnotationLayer={false}
            />
          </div>
        )}
      </Document>
      {numPages != null && (
        <p className="mt-3 text-center font-mono text-xs text-fg-faint">
          {t("source.pageOf", {
            page: Math.min(Math.max(1, source.page), numPages),
            total: numPages,
          })}
        </p>
      )}
    </div>
  );
}

// --- Lecteur texte (txt / md / docx / repli) -------------------------------

function TextSource({ source }: { source: Source }) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState<string | null>(null);
  const [loading, setLoading] = useState(isFetchableText(source.doc_name));

  // Récupère le fichier brut pour les formats texte lisibles (txt/md).
  useEffect(() => {
    if (!isFetchableText(source.doc_name)) {
      setFull(source.text);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(getDocumentFileUrl(source.doc_id))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => !cancelled && setFull(t))
      .catch(() => !cancelled && setFull(source.text)) // repli : le chunk seul
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [source.doc_id, source.doc_name, source.text]);

  const segments = useMemo(() => {
    if (full == null) return null;
    return segmentText(full, source.text) ?? [{ text: full, mark: false }];
  }, [full, source.text]);

  // Amène le premier surlignage au centre.
  useLayoutEffect(() => {
    if (!segments) return;
    requestAnimationFrame(() => {
      const mark = scrollRef.current?.querySelector(".krole-mark");
      mark?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [segments]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-canvas p-5">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-faint">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("source.loading")}
        </div>
      ) : (
        <article className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-fg-muted">
          {segments?.map((seg, i) =>
            seg.mark ? (
              <mark key={i} className="krole-mark">
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </article>
      )}
    </div>
  );
}

// --- Drawer ----------------------------------------------------------------

export function SourceViewer() {
  const { t } = useTranslation();
  const selected = useChatStore((s) => s.selectedSource);
  const close = useChatStore((s) => s.closeSource);
  const open = selected != null;

  // Conserve la dernière source pendant l'animation de fermeture.
  const [shown, setShown] = useState<Source | null>(selected);
  useEffect(() => {
    if (selected) setShown(selected);
  }, [selected]);

  // Échap ferme le drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const kind = shown ? kindOf(shown.doc_name) : "text";

  return (
    <>
      {/* Voile (scopé au conteneur, pas position:fixed) */}
      <div
        onClick={close}
        aria-hidden
        className={`absolute inset-0 z-10 bg-black/50 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Tiroir */}
      <aside
        role="dialog"
        aria-label={t("source.preview")}
        onTransitionEnd={() => {
          if (!open) setShown(null);
        }}
        className={`absolute right-0 top-0 z-20 flex h-full w-full max-w-[480px] flex-col border-l border-hairline bg-canvas transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <FileText className="h-4 w-4 shrink-0 text-fg-faint" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">
              {shown?.doc_name ?? ""}
            </p>
            {shown && kind === "pdf" && (
              <p className="font-mono text-xs text-fg-faint">
                {t("source.page", { page: shown.page })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("common.close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1">
          {shown &&
            (kind === "pdf" ? (
              <PdfSource source={shown} />
            ) : (
              <TextSource source={shown} />
            ))}
        </div>
      </aside>
    </>
  );
}
