import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.services import eval as eval_service

logger = get_logger(__name__)
router = APIRouter(prefix="/api/eval", tags=["eval"])

_HEARTBEAT_SECONDS = 10.0


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/dataset")
async def get_dataset() -> list[dict]:
    """Renvoie le jeu de test (questions + réponses de référence)."""
    return eval_service.load_dataset()


@router.get("/status")
async def get_status() -> dict:
    """État courant + dernier résultat en cache (chargement initial / polling)."""
    return eval_service.get_status()


@router.post("/run")
async def run_eval(limit: int | None = None) -> StreamingResponse:
    """Lance l'évaluation (si pas déjà en cours) et diffuse la progression en SSE.

    Le run tourne en tâche de fond : se déconnecter du flux ne l'interrompt pas
    (le résultat reste récupérable via GET /status). `?limit=N` borne le nombre
    de questions (test rapide).
    """

    async def event_stream() -> AsyncIterator[str]:
        queue: asyncio.Queue[dict] = asyncio.Queue()
        eval_service.subscribe(queue)
        try:
            yield ": ready\n\n"
            started = await eval_service.ensure_running(limit)
            if not started:
                # Un run est déjà en cours : on renvoie l'instantané actuel d'abord.
                yield _sse("status", eval_service.get_status())
            while True:
                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=_HEARTBEAT_SECONDS
                    )
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield _sse(event.get("type", "message"), event)
                if event.get("type") in ("done", "error"):
                    break
        finally:
            eval_service.unsubscribe(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
