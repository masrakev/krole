import {
  Bug,
  ChevronRight,
  Hash,
  ListFilter,
  Search,
  Sparkles,
  Terminal,
  Timer,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DebugData } from "../lib/sse";
import type { Investigation, Timings } from "../store/chat";

/** Formate une durée en ms → « 820 ms » ou « 2.4 s ». */
function fmtMs(ms?: number): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function totalMs(t: Timings): number {
  return (
    (t.rewrite_ms ?? 0) +
    (t.retrieval_ms ?? 0) +
    (t.rerank_ms ?? 0) +
    (t.generation_ms ?? 0)
  );
}

/** Petite ligne libellé + valeur (valeur en mono). */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-fg-faint">{label}</span>
      <span className="font-mono tabular-nums text-fg-muted">{value}</span>
    </div>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
      {icon}
      {children}
    </div>
  );
}

function num(v: number | null | undefined, digits = 3): string {
  return v == null ? "—" : v.toFixed(digits);
}

function TokenChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-hairline px-2 py-0.5 font-mono text-[11px] text-fg-muted">
      <span className="text-fg-faint">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

/** Section « Debug développeur » : prompt assemblé, chunks scorés, tokens. */
function DebugSection({ debug }: { debug: DebugData }) {
  const { t } = useTranslation();
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <section className="border-t border-hairline pt-3">
      <SectionTitle icon={<Bug className="h-3 w-3" />}>{t("investigation.debug")}</SectionTitle>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Hash className="h-3 w-3 text-fg-faint" />
        <TokenChip label={t("investigation.tokPrompt")} value={debug.tokens.prompt_tokens} />
        <TokenChip
          label={t("investigation.tokResponse")}
          value={debug.tokens.completion_tokens}
        />
        <TokenChip label={t("investigation.tokCtx")} value={debug.tokens.num_ctx} />
      </div>

      <button
        type="button"
        onClick={() => setShowPrompt((v) => !v)}
        className="mb-2 flex items-center gap-1.5 font-mono text-[11px] text-fg-muted transition-colors hover:text-fg"
      >
        <Terminal className="h-3 w-3" />
        <ChevronRight
          className={`h-3 w-3 transition-transform ${showPrompt ? "rotate-90" : ""}`}
        />
        {t("investigation.prompt")}
      </button>
      {showPrompt && (
        <pre className="mb-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-hairline bg-canvas p-2.5 font-mono text-[11px] leading-relaxed text-fg-muted">
          {debug.prompt.full}
        </pre>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-fg-faint">
              <th className="px-1.5 py-1 text-left font-medium">
                {t("investigation.colSource")}
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                {t("investigation.colVec")}
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                {t("investigation.colBm25")}
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                {t("investigation.colRrf")}
              </th>
              <th className="px-1.5 py-1 text-right font-medium">
                {t("investigation.colRerank")}
              </th>
            </tr>
          </thead>
          <tbody>
            {debug.chunks.map((c) => (
              <tr
                key={c.chunk_id}
                className={`border-t border-hairline ${
                  c.used ? "text-fg" : "text-fg-faint"
                }`}
              >
                <td className="px-1.5 py-1">
                  <span className="flex items-center gap-1">
                    {c.used && (
                      <span
                        title={t("investigation.injected")}
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fg-muted"
                      />
                    )}
                    <span className="truncate" title={c.snippet}>
                      {c.doc_name} p.{c.page}
                    </span>
                  </span>
                </td>
                <td className="px-1.5 py-1 text-right tabular-nums">
                  {c.vector_rank ?? "—"}
                  <span className="text-fg-faint"> / </span>
                  {num(c.vector_distance)}
                </td>
                <td className="px-1.5 py-1 text-right tabular-nums">
                  {c.bm25_rank ?? "—"}
                  <span className="text-fg-faint"> / </span>
                  {num(c.bm25_score, 2)}
                </td>
                <td className="px-1.5 py-1 text-right tabular-nums">
                  {num(c.rrf_score, 4)}
                </td>
                <td className="px-1.5 py-1 text-right tabular-nums">
                  {num(c.rerank_score)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Panneau « Investigation » rattaché à chaque réponse assistant : montre le
 * raisonnement du pipeline (reformulation → recherche → reclassement) + latences.
 */
export function InvestigationPanel({
  investigation,
}: {
  investigation: Investigation;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { original, rewrite, candidates, top, timings } = investigation;

  const total = totalMs(timings);
  const summary = [
    t("investigation.candidates", { count: candidates.length }),
    top.length ? t("investigation.top", { count: top.length }) : null,
    total ? fmtMs(total) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-lg border border-hairline bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg-muted transition-colors hover:text-fg"
        aria-expanded={open}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-fg-faint transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
        <span className="font-medium text-fg">{t("investigation.title")}</span>
        <span className="truncate font-mono text-fg-faint">{summary}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-hairline px-4 py-3.5">
          {/* Reformulation */}
          <section>
            <SectionTitle icon={<Sparkles className="h-3 w-3" />}>
              {t("investigation.reformulation")}
            </SectionTitle>
            <div className="space-y-1.5 text-xs">
              <p className="text-fg-muted">
                <span className="text-fg-faint">{t("investigation.question")}</span>
                {original}
              </p>
              <p className="text-fg">
                <span className="text-fg-faint">{t("investigation.rewritten")}</span>
                {rewrite ?? "—"}
              </p>
            </div>
          </section>

          {/* Recherche */}
          <section className="border-t border-hairline pt-3">
            <SectionTitle icon={<Search className="h-3 w-3" />}>
              {t("investigation.search")} ·{" "}
              {t("investigation.candidates", { count: candidates.length })}
            </SectionTitle>
            <ul className="space-y-1">
              {candidates.map((c, i) => (
                <li
                  key={`${c.doc_name}-${c.page}-${i}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="w-4 shrink-0 text-right font-mono tabular-nums text-fg-faint">
                    {i + 1}
                  </span>
                  <span className="truncate text-fg-muted">{c.doc_name}</span>
                  <span className="shrink-0 font-mono text-fg-faint">p.{c.page}</span>
                  <span className="ml-auto shrink-0 font-mono tabular-nums text-fg-faint">
                    {c.score.toFixed(3)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Reclassement */}
          {top.length > 0 && (
            <section className="border-t border-hairline pt-3">
              <SectionTitle icon={<ListFilter className="h-3 w-3" />}>
                {t("investigation.rerank")} · {t("investigation.top", { count: top.length })}
              </SectionTitle>
              <ul className="space-y-1">
                {top.map((tp, i) => (
                  <li key={tp.id} className="flex items-center gap-2 text-xs">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-hairline font-mono text-[10px] text-fg-muted">
                      {i + 1}
                    </span>
                    <span className="truncate text-fg">{tp.doc_name}</span>
                    <span className="shrink-0 font-mono text-fg-faint">p.{tp.page}</span>
                    <span className="ml-auto shrink-0 font-mono tabular-nums text-fg-muted">
                      {tp.score.toFixed(3)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Latences */}
          <section className="border-t border-hairline pt-3">
            <SectionTitle icon={<Timer className="h-3 w-3" />}>
              {t("investigation.latencies")}
            </SectionTitle>
            <div className="space-y-1">
              <Stat label={t("investigation.latRewrite")} value={fmtMs(timings.rewrite_ms)} />
              <Stat
                label={t("investigation.latRetrieval")}
                value={fmtMs(timings.retrieval_ms)}
              />
              <Stat label={t("investigation.latRerank")} value={fmtMs(timings.rerank_ms)} />
              <Stat
                label={t("investigation.latGeneration")}
                value={fmtMs(timings.generation_ms)}
              />
              <div className="mt-1 border-t border-hairline pt-1">
                <Stat label={t("investigation.latTotal")} value={fmtMs(total)} />
              </div>
            </div>
          </section>

          {/* Debug développeur (mode debug uniquement) */}
          {investigation.debug && <DebugSection debug={investigation.debug} />}
        </div>
      )}
    </div>
  );
}
