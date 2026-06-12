import asyncio
import threading

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_reranker = None
_lock = threading.Lock()


def _get_reranker():
    """Charge le cross-encoder une seule fois (téléchargé depuis HuggingFace).

    Import et chargement paresseux : le modèle (~600 Mo) n'est tiré qu'au
    premier appel de rerank, pas au démarrage de l'app.
    """
    global _reranker
    if _reranker is None:
        with _lock:
            if _reranker is None:
                from FlagEmbedding import FlagReranker

                settings = get_settings()
                logger.info("Chargement du reranker '%s'…", settings.rerank_model)
                # use_fp16=False : le conteneur tourne sur CPU (fp16 y est instable).
                _reranker = FlagReranker(settings.rerank_model, use_fp16=False)
                logger.info("Reranker prêt.")
    return _reranker


def _compute_scores(query: str, candidates: list[dict]) -> list[float]:
    reranker = _get_reranker()
    pairs = [[query, c["text"]] for c in candidates]
    scores = reranker.compute_score(pairs, normalize=True)
    # compute_score renvoie un float si une seule paire.
    if isinstance(scores, (int, float)):
        return [float(scores)]
    return [float(s) for s in scores]


async def warmup() -> None:
    """Précharge le reranker au démarrage (depuis le cache disque /models).

    Le premier démarrage télécharge le modèle dans le volume models_cache ;
    les démarrages suivants le rechargent du disque en quelques secondes, sans
    re-téléchargement. Exécuté hors de la boucle d'événements pour ne pas la
    bloquer pendant le chargement.
    """
    await asyncio.to_thread(_get_reranker)


async def rerank(query: str, candidates: list[dict], top_k: int = 4) -> list[dict]:
    """Réordonne les candidats avec le cross-encoder, garde les top_k.

    Chaque candidat retourné reçoit un champ `score` = score de rerank (0-1).
    """
    if not candidates:
        return []

    scores = await asyncio.to_thread(_compute_scores, query, candidates)

    reranked = []
    for cand, score in zip(candidates, scores):
        item = dict(cand)
        item["score"] = score
        reranked.append(item)

    reranked.sort(key=lambda c: c["score"], reverse=True)
    top = reranked[:top_k]
    logger.info(
        "Rerank : %d candidats -> top %d (meilleur score=%.4f)",
        len(candidates),
        len(top),
        top[0]["score"] if top else 0.0,
    )
    return top
