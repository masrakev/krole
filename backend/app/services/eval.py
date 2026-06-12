"""Évaluation RAGAS 100 % locale.

Le juge LLM est Mistral via Ollama (langchain-ollama) et les embeddings sont
bge-m3 via Ollama — AUCUN appel OpenAI. Pour chaque question du jeu de test, on
exécute le VRAI pipeline RAG (réponse + contextes récupérés), puis on calcule
faithfulness / answer_relevancy / context_precision / context_recall.

La progression est diffusée à des abonnés (SSE) et le dernier résultat est mis
en cache sur disque (/data) pour s'afficher sans relancer.
"""

import asyncio
import json
import math
import threading
import time
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# RAGAS exécute nest_asyncio.apply() à l'import, ce qui échoue sous uvloop
# (la boucle d'uvicorn). On confine donc TOUT RAGAS (import + scoring) dans un
# thread dédié faisant tourner une boucle asyncio standard, patchable.
_worker_loop: asyncio.AbstractEventLoop | None = None
_worker_lock = threading.Lock()
_worker_metrics = None


def _ensure_worker() -> asyncio.AbstractEventLoop:
    global _worker_loop
    if _worker_loop is not None:
        return _worker_loop
    with _worker_lock:
        if _worker_loop is None:
            # SelectorEventLoop EXPLICITE : asyncio.new_event_loop() suivrait la
            # policy globale (uvloop, posée par uvicorn[standard]) que
            # nest_asyncio ne sait pas patcher. On veut une boucle standard.
            loop = asyncio.SelectorEventLoop()
            threading.Thread(
                target=_worker_main, args=(loop,), daemon=True, name="ragas-worker"
            ).start()
            _worker_loop = loop
    return _worker_loop


def _worker_main(loop: asyncio.AbstractEventLoop) -> None:
    asyncio.set_event_loop(loop)
    loop.run_forever()

METRIC_NAMES = (
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
)

# --- État partagé du run (singleton module) --------------------------------
_state: dict = {
    "status": "idle",  # idle | running | done | error
    "progress": {"done": 0, "total": 0, "question": None},
    "result": None,  # dernier résultat complet (per_question + aggregate)
    "error": None,
}
_start_lock = asyncio.Lock()
_subscribers: set[asyncio.Queue] = set()
_result_loaded = False


# --- Jeu de test -----------------------------------------------------------
def load_dataset() -> list[dict]:
    """Charge eval/dataset.json (éditable). Liste de {question, ground_truth}."""
    path = Path(get_settings().eval_dataset_path)
    if not path.exists():
        logger.warning("Jeu de test introuvable : %s", path)
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# --- Cache disque ----------------------------------------------------------
def _load_cached_result() -> None:
    global _result_loaded
    if _result_loaded:
        return
    _result_loaded = True
    path = Path(get_settings().eval_result_path)
    if path.exists():
        try:
            with open(path, encoding="utf-8") as f:
                _state["result"] = json.load(f)
            if _state["status"] == "idle":
                _state["status"] = "done"
            logger.info("Résultat d'évaluation chargé depuis le cache : %s", path)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Cache d'évaluation illisible : %s", exc)


def _persist_result(result: dict) -> None:
    path = Path(get_settings().eval_result_path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Échec de l'écriture du cache d'évaluation : %s", exc)


def get_status() -> dict:
    """Instantané de l'état (pour le chargement initial et le polling)."""
    _load_cached_result()
    return {
        "status": _state["status"],
        "progress": _state["progress"],
        "result": _state["result"],
        "error": _state["error"],
    }


# --- Pub/sub de progression ------------------------------------------------
def subscribe(queue: asyncio.Queue) -> None:
    _subscribers.add(queue)


def unsubscribe(queue: asyncio.Queue) -> None:
    _subscribers.discard(queue)


async def _publish(event: dict) -> None:
    for q in list(_subscribers):
        await q.put(event)


# --- RAGAS (modèles locaux) ------------------------------------------------
def _build_metrics():
    """Instancie les 4 métriques RAGAS câblées sur les modèles LOCAUX (Ollama)."""
    from langchain_ollama import ChatOllama, OllamaEmbeddings
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import (
        Faithfulness,
        LLMContextPrecisionWithReference,
        LLMContextRecall,
        ResponseRelevancy,
    )

    settings = get_settings()
    llm = LangchainLLMWrapper(
        ChatOllama(
            model=settings.eval_judge_model,
            base_url=settings.ollama_base_url,
            temperature=0,
            num_predict=settings.eval_judge_num_predict,
            num_ctx=settings.eval_num_ctx,
            num_thread=settings.num_thread,
        )
    )
    embeddings = LangchainEmbeddingsWrapper(
        OllamaEmbeddings(model=settings.embed_model, base_url=settings.ollama_base_url)
    )
    return {
        "faithfulness": Faithfulness(llm=llm),
        "answer_relevancy": ResponseRelevancy(llm=llm, embeddings=embeddings),
        "context_precision": LLMContextPrecisionWithReference(llm=llm),
        "context_recall": LLMContextRecall(llm=llm),
    }


async def _run_pipeline(question: str) -> tuple[str, list[str]]:
    """Exécute le vrai pipeline RAG et renvoie (réponse, contextes injectés)."""
    from app.services.rag import run_rag

    answer_parts: list[str] = []
    contexts: list[str] = []
    async for event, data in run_rag([{"role": "user", "content": question}]):
        if event == "token":
            answer_parts.append(data.get("text", ""))
        elif event == "sources":
            contexts = [s["text"] for s in data.get("sources", [])]
    return "".join(answer_parts).strip(), contexts


def _clean_score(value) -> float | None:
    """Normalise un score : None si NaN/None, sinon arrondi."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else round(f, 4)


def _aggregate(rows: list[dict]) -> dict[str, float | None]:
    """Moyenne par métrique sur les scores non nuls."""
    agg: dict[str, float | None] = {}
    for name in METRIC_NAMES:
        vals = [r["scores"][name] for r in rows if r["scores"].get(name) is not None]
        agg[name] = round(sum(vals) / len(vals), 4) if vals else None
    return agg


async def _score_sample_coro(data: dict) -> dict[str, float | None]:
    """Coroutine exécutée DANS le thread worker (boucle asyncio standard).

    C'est ici, et seulement ici, que RAGAS est importé : sous une boucle
    patchable par nest_asyncio.
    """
    global _worker_metrics
    from ragas import SingleTurnSample

    if _worker_metrics is None:
        _worker_metrics = _build_metrics()

    sample = SingleTurnSample(
        user_input=data["user_input"],
        response=data["response"] or " ",
        retrieved_contexts=data["retrieved_contexts"] or [" "],
        reference=data["reference"],
    )
    settings = get_settings()
    scores: dict[str, float | None] = {}
    for name, metric in _worker_metrics.items():
        try:
            value = await asyncio.wait_for(
                metric.single_turn_ascore(sample),
                timeout=settings.eval_metric_timeout,
            )
            scores[name] = _clean_score(value)
        except Exception as exc:  # noqa: BLE001 — on saute la métrique, jamais crash
            logger.warning("Métrique '%s' ignorée (%s)", name, exc)
            scores[name] = None
    return scores


async def _score_sample(data: dict) -> dict[str, float | None]:
    """Soumet le scoring au thread worker et attend le résultat sans bloquer."""
    loop = _ensure_worker()
    future = asyncio.run_coroutine_threadsafe(_score_sample_coro(data), loop)
    return await asyncio.wrap_future(future)


async def _run(limit: int | None = None) -> None:
    """Boucle d'évaluation. Met à jour l'état + publie la progression.

    `limit` borne le nombre de questions (utile pour un test rapide) ; None = tout.
    """
    dataset = load_dataset()
    if limit is not None:
        dataset = dataset[:limit]
    total = len(dataset)
    _state.update(
        status="running",
        progress={"done": 0, "total": total, "question": None},
        error=None,
    )
    await _publish({"type": "start", "total": total})

    try:
        rows: list[dict] = []
        for i, item in enumerate(dataset):
            question = item["question"]
            ground_truth = item.get("ground_truth", "")
            _state["progress"] = {"done": i, "total": total, "question": question}
            await _publish(
                {"type": "progress", "done": i, "total": total, "question": question}
            )

            answer, contexts = await _run_pipeline(question)
            scores = await _score_sample(
                {
                    "user_input": question,
                    "response": answer,
                    "retrieved_contexts": contexts,
                    "reference": ground_truth,
                }
            )
            row = {
                "question": question,
                "ground_truth": ground_truth,
                "answer": answer,
                "contexts": contexts,
                "scores": scores,
            }
            rows.append(row)
            logger.info("Éval Q%d/%d : %s", i + 1, total, scores)
            await _publish({"type": "row", "index": i, "row": row})

        result = {
            "per_question": rows,
            "aggregate": _aggregate(rows),
            "count": len(rows),
            "completed_at": time.time(),
        }
        _state.update(
            status="done",
            result=result,
            progress={"done": total, "total": total, "question": None},
        )
        _persist_result(result)
        await _publish({"type": "done", "result": result})
        logger.info("Évaluation terminée : %s", result["aggregate"])
    except Exception as exc:  # noqa: BLE001
        logger.exception("Run d'évaluation interrompu")
        _state.update(status="error", error=str(exc))
        await _publish({"type": "error", "detail": str(exc)})


async def ensure_running(limit: int | None = None) -> bool:
    """Démarre un run en tâche de fond s'il n'y en a pas déjà un.

    Renvoie True si un run a été démarré, False s'il tournait déjà.
    """
    async with _start_lock:
        if _state["status"] == "running":
            return False
        # Tâche détachée : survit à la déconnexion du client SSE.
        asyncio.create_task(_run(limit))
        return True
