import asyncio

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EmbeddingError(RuntimeError):
    """Levée quand la génération d'embeddings échoue (Ollama injoignable, etc.)."""


async def _embed_one(
    client: httpx.AsyncClient, url: str, model: str, text: str
) -> list[float]:
    response = await client.post(url, json={"model": model, "prompt": text})
    response.raise_for_status()
    data = response.json()
    embedding = data.get("embedding")
    if not embedding:
        raise EmbeddingError("Réponse d'embedding vide depuis Ollama.")
    return embedding


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Génère les embeddings d'une liste de textes via Ollama (bge-m3).

    Traitement par lots concurrents (embed_concurrency) avec log de progression.
    Lève EmbeddingError si Ollama est injoignable.
    """
    if not texts:
        return []

    settings = get_settings()
    url = f"{settings.ollama_base_url.rstrip('/')}/api/embeddings"
    model = settings.embed_model
    semaphore = asyncio.Semaphore(settings.embed_concurrency)
    total = len(texts)
    done = 0
    embeddings: list[list[float]] = [None] * total  # type: ignore[list-item]

    logger.info("Embedding de %d chunk(s) avec '%s'…", total, model)

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:

            async def worker(index: int, text: str) -> None:
                nonlocal done
                async with semaphore:
                    embeddings[index] = await _embed_one(client, url, model, text)
                    done += 1
                    if done % 20 == 0 or done == total:
                        logger.info("Embeddings : %d/%d", done, total)

            await asyncio.gather(
                *(worker(i, t) for i, t in enumerate(texts))
            )
    except httpx.HTTPError as exc:
        logger.error("Échec des embeddings via Ollama : %s", exc)
        raise EmbeddingError("Ollama est injoignable pour les embeddings.") from exc

    return embeddings
