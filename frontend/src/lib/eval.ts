import { API_BASE } from "./api";

export type MetricName =
  | "faithfulness"
  | "answer_relevancy"
  | "context_precision"
  | "context_recall";

export const METRIC_NAMES: MetricName[] = [
  "faithfulness",
  "answer_relevancy",
  "context_precision",
  "context_recall",
];

export type Scores = Record<MetricName, number | null>;

export interface EvalRow {
  question: string;
  ground_truth: string;
  answer: string;
  contexts: string[];
  scores: Scores;
}

export interface EvalResult {
  per_question: EvalRow[];
  aggregate: Scores;
  count: number;
  completed_at: number;
}

export type EvalRunStatus = "idle" | "running" | "done" | "error";

export interface EvalStatus {
  status: EvalRunStatus;
  progress: { done: number; total: number; question: string | null };
  result: EvalResult | null;
  error: string | null;
}

export interface DatasetItem {
  question: string;
  ground_truth: string;
}

export async function fetchEvalDataset(): Promise<DatasetItem[]> {
  const res = await fetch(`${API_BASE}/api/eval/dataset`);
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

export async function fetchEvalStatus(): Promise<EvalStatus> {
  const res = await fetch(`${API_BASE}/api/eval/status`);
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

export interface EvalHandlers {
  onStart?: (total: number) => void;
  onProgress?: (done: number, total: number, question: string | null) => void;
  onRow?: (index: number, row: EvalRow) => void;
  onStatus?: (status: EvalStatus) => void;
  onDone?: (result: EvalResult) => void;
  onError?: (detail: string) => void;
  onData?: () => void;
}

/** POST /api/eval/run : lance l'évaluation et lit la progression en SSE. */
export async function runEval(
  handlers: EvalHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/eval/run`, {
    method: "POST",
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Erreur ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (event: string, data: Record<string, unknown>) => {
    switch (event) {
      case "start":
        handlers.onStart?.(Number(data.total ?? 0));
        break;
      case "progress":
        handlers.onProgress?.(
          Number(data.done ?? 0),
          Number(data.total ?? 0),
          (data.question as string | null) ?? null,
        );
        break;
      case "row":
        handlers.onRow?.(Number(data.index ?? 0), data.row as unknown as EvalRow);
        break;
      case "status":
        handlers.onStatus?.(data as unknown as EvalStatus);
        break;
      case "done":
        handlers.onDone?.(data.result as unknown as EvalResult);
        break;
      case "error":
        handlers.onError?.(String(data.detail ?? "Erreur d'évaluation."));
        break;
      default:
        break;
    }
  };

  const parseBlock = (raw: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:"))
        dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) return;
    try {
      dispatch(event, JSON.parse(dataLines.join("\n")));
    } catch {
      /* ignore */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) handlers.onData?.();
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (block.trim()) parseBlock(block);
    }
  }
  if (buffer.trim()) parseBlock(buffer);
}
