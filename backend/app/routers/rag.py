import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import suppress

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.schemas.chat import ChatRequest
from app.services.embeddings import EmbeddingError
from app.services.llm.base import LLMProviderError
from app.services.ollama_client import OllamaUnreachableError
from app.services.rag import run_rag
from app.services.vectorstore import VectorStoreError

logger = get_logger(__name__)
router = APIRouter(prefix="/api/rag", tags=["rag"])

# Intervalle de heartbeat : un octet est envoyé au moins toutes les N secondes,
# même pendant une étape lente et silencieuse (rewrite/rerank/1er token sur CPU).
# Garde le watchdog d'inactivité du client (≈45 s) toujours réarmé.
_HEARTBEAT_SECONDS = 10.0


def _sse(event: str, data: dict) -> str:
    """Formate un event SSE nommé."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def rag_chat(request: ChatRequest, debug: bool = False) -> StreamingResponse:
    """Pipeline RAG hybride en SSE (rewrite → retrieval → rerank → tokens → sources).

    Le mode debug s'active via le champ `debug` du corps OU le paramètre `?debug=1`.
    """
    messages = [m.model_dump() for m in request.messages]
    debug_on = debug or request.debug

    async def event_stream() -> AsyncIterator[str]:
        # Heartbeat initial : ouvre/flush la connexion immédiatement pour que le
        # client commence à lire tout de suite. Ignoré par le parser SSE.
        yield ": ready\n\n"

        # Le pipeline produit dans une file ; le consommateur insère un heartbeat
        # si rien n'arrive pendant _HEARTBEAT_SECONDS. Ainsi aucune étape lente
        # (p. ex. rewrite à 70 s sur CPU) ne provoque un silence > au délai client.
        queue: asyncio.Queue[tuple[str, str] | None] = asyncio.Queue()

        async def produce() -> None:
            try:
                async for event, data in run_rag(messages, debug=debug_on):
                    await queue.put(("sse", _sse(event, data)))
            except (
                OllamaUnreachableError,
                LLMProviderError,
                EmbeddingError,
                VectorStoreError,
            ) as exc:
                logger.error("Pipeline RAG interrompu : %s", exc)
                await queue.put(("sse", _sse("error", {"detail": str(exc)})))
                await queue.put(("sse", _sse("done", {})))
            except Exception:  # noqa: BLE001 — terminer proprement le flux SSE
                logger.exception("Erreur inattendue dans le pipeline RAG")
                await queue.put(
                    ("sse", _sse("error", {"detail": "Erreur interne du moteur RAG."}))
                )
                await queue.put(("sse", _sse("done", {})))
            finally:
                await queue.put(None)  # sentinelle de fin

        task = asyncio.create_task(produce())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(
                        queue.get(), timeout=_HEARTBEAT_SECONDS
                    )
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"  # silence prolongé → on maintient le flux
                    continue
                if item is None:
                    break
                yield item[1]
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
