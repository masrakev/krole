import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchEvalStatus,
  runEval,
  METRIC_NAMES,
  type EvalResult,
  type EvalRow,
  type EvalRunStatus,
  type MetricName,
  type Scores,
} from "../lib/eval";

const METRIC_KEY: Record<MetricName, string> = {
  faithfulness: "eval.mFaithfulness",
  answer_relevancy: "eval.mAnswerRelevancy",
  context_precision: "eval.mContextPrecision",
  context_recall: "eval.mContextRecall",
};

function pct(v: number | null): string {
  return v == null ? "N/A" : `${Math.round(v * 100)}%`;
}

function MetricCard({ label, value }: { label: string; value: number | null }) {
  const w = value == null ? 0 : Math.round(value * 100);
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-3xl font-medium tabular-nums text-fg">
        {pct(value)}
      </p>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-fg transition-all"
          style={{ width: `${w}%` }}
        />
      </div>
    </div>
  );
}

/** Histogramme comparatif monochrome des 4 métriques agrégées. */
function BarChart({
  aggregate,
  label,
  title,
}: {
  aggregate: Scores;
  label: (n: MetricName) => string;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        {title}
      </p>
      <div className="flex h-32 items-end justify-around gap-3">
        {METRIC_NAMES.map((name) => {
          const v = aggregate[name];
          return (
            <div key={name} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="font-mono text-[11px] tabular-nums text-fg-muted">
                {pct(v)}
              </span>
              <div className="flex h-full w-full items-end">
                <div
                  className="w-full rounded-t bg-fg-muted transition-all"
                  style={{ height: `${v == null ? 0 : Math.max(2, v * 100)}%` }}
                />
              </div>
              <span className="text-center font-mono text-[9px] uppercase tracking-wide text-fg-faint">
                {label(name)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoreCell({ value }: { value: number | null }) {
  return (
    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-fg-muted">
      {pct(value)}
    </td>
  );
}

function QuestionRow({ row, index }: { row: EvalRow; index: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="cursor-pointer border-t border-hairline transition-colors hover:bg-surface"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-2 py-2.5 text-fg-faint">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </td>
        <td className="px-2 py-2.5 text-[13px] text-fg">
          <span className="mr-1.5 font-mono text-fg-faint">{index + 1}.</span>
          {row.question}
        </td>
        {METRIC_NAMES.map((name) => (
          <ScoreCell key={name} value={row.scores[name]} />
        ))}
      </tr>
      {open && (
        <tr className="border-t border-hairline bg-canvas">
          <td />
          <td colSpan={5} className="space-y-3 px-2 py-3 text-xs">
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                {t("eval.generated")}
              </p>
              <p className="whitespace-pre-wrap text-fg-muted">{row.answer || "—"}</p>
            </div>
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                {t("eval.reference")}
              </p>
              <p className="whitespace-pre-wrap text-fg">{row.ground_truth || "—"}</p>
            </div>
            {row.contexts.length > 0 && (
              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                  {t("eval.contexts")} · {row.contexts.length}
                </p>
                <ul className="space-y-1">
                  {row.contexts.map((c, i) => (
                    <li
                      key={i}
                      className="rounded border border-hairline bg-surface px-2 py-1 text-fg-muted"
                    >
                      {c.length > 280 ? `${c.slice(0, 280)}…` : c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function EvalView() {
  const { t } = useTranslation();
  const label = (n: MetricName) => t(METRIC_KEY[n]);
  const [status, setStatus] = useState<EvalRunStatus>("idle");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    question: string | null;
  }>({ done: 0, total: 0, question: null });
  const [result, setResult] = useState<EvalResult | null>(null);
  const [liveRows, setLiveRows] = useState<EvalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const follow = () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setLiveRows([]);
    setStatus("running");
    runEval(
      {
        onStart: (total) => {
          setProgress({ done: 0, total, question: null });
          setLiveRows([]);
        },
        onStatus: (s) => {
          setStatus(s.status);
          setProgress(s.progress);
          if (s.result) setResult(s.result);
        },
        onProgress: (done, total, question) => {
          setStatus("running");
          setProgress({ done, total, question });
        },
        onRow: (_index, row) => setLiveRows((r) => [...r, row]),
        onDone: (res) => {
          setResult(res);
          setStatus("done");
          setProgress((p) => ({ done: p.total, total: p.total, question: null }));
        },
        onError: (d) => {
          setError(d);
          setStatus("error");
        },
      },
      controller.signal,
    ).catch((e) => {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : t("eval.failed"));
        setStatus("error");
      }
    });
  };

  // Chargement initial : état + dernier résultat en cache ; suit un run en cours.
  useEffect(() => {
    let active = true;
    fetchEvalStatus()
      .then((s) => {
        if (!active) return;
        setStatus(s.status);
        setProgress(s.progress);
        setResult(s.result);
        setError(s.error);
        if (s.status === "running") follow();
      })
      .catch(() => {});
    return () => {
      active = false;
      controllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = status === "running";
  const aggregate = result?.aggregate;
  const tableRows = running && liveRows.length ? liveRows : result?.per_question ?? [];
  const progressPct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* En-tête + lancement */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-medium tracking-tight text-fg">
                {t("eval.title")}
              </h2>
              <p className="mt-1.5 max-w-xl text-sm text-fg-muted">
                {t("eval.description")}
              </p>
            </div>
            <button
              type="button"
              onClick={follow}
              disabled={running}
              className="flex shrink-0 items-center gap-2 rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-canvas transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {running ? t("eval.running") : t("eval.run")}
            </button>
          </div>

          {/* Avertissement CPU */}
          <div className="flex items-start gap-2 rounded-lg border border-hairline bg-surface px-4 py-3 text-xs text-fg-muted">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-fg-faint" />
            <span>
              {t("eval.warningPre")}
              <span className="text-fg">{t("eval.warningEmph")}</span>
              {t("eval.warningPost")}
            </span>
          </div>

          {/* Barre de progression */}
          {running && (
            <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
              <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-fg-muted">
                <span>
                  {progress.done} / {progress.total || "…"}
                </span>
                <span className="tabular-nums">{progressPct}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-fg transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {progress.question && (
                <p className="mt-2 truncate text-xs text-fg-faint">
                  {t("eval.inProgress", { question: progress.question })}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-hairline-strong bg-surface px-4 py-3 text-sm text-fg-muted">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Cartes agrégées + histogramme */}
          {aggregate && (
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="grid grid-cols-2 gap-3 lg:col-span-2">
                {METRIC_NAMES.map((name) => (
                  <MetricCard key={name} label={label(name)} value={aggregate[name]} />
                ))}
              </div>
              <BarChart aggregate={aggregate} label={label} title={t("eval.comparative")} />
            </div>
          )}

          {/* Tableau par question */}
          {tableRows.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-hairline">
              <table className="w-full text-sm">
                <thead className="bg-surface font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                  <tr>
                    <th className="w-8 px-2 py-2.5" />
                    <th className="px-2 py-2.5 text-left font-medium">
                      {t("eval.question")}
                    </th>
                    {METRIC_NAMES.map((name) => (
                      <th key={name} className="px-2 py-2.5 text-right font-medium">
                        {label(name)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-canvas">
                  {tableRows.map((row, i) => (
                    <QuestionRow key={i} row={row} index={i} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !running && (
              <p className="rounded-lg border border-dashed border-hairline px-4 py-10 text-center text-sm text-fg-faint">
                {t("eval.empty")}
              </p>
            )
          )}
        </div>
      </div>
    </section>
  );
}
