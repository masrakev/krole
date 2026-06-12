import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.chat import ChatRequest
from app.services.llm.base import LLMProviderError
from app.services.llm.factory import get_llm_provider
from app.services.ollama_client import OllamaUnreachableError

logger = get_logger(__name__)
router = APIRouter(prefix="/api", tags=["chat"])


def _build_messages(request: ChatRequest) -> list[dict[str, str]]:
    """Injecte le prompt système par défaut en tête s'il n'y en a pas déjà un."""
    settings = get_settings()
    messages = [m.model_dump() for m in request.messages]
    if not messages or messages[0]["role"] != "system":
        messages.insert(0, {"role": "system", "content": settings.system_prompt})
    return messages


def _sse(data: str) -> str:
    return f"data: {data}\n\n"


@router.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    """Relaie la réponse du LLM actif (LLM_PROVIDER) en SSE, token par token."""
    provider = get_llm_provider()
    messages = _build_messages(request)
    stream = provider.chat_stream(messages)

    # Amorce le flux pour détecter une erreur de connexion avant de répondre 200.
    try:
        first = await stream.__anext__()
    except (OllamaUnreachableError, LLMProviderError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StopAsyncIteration:
        first = None

    async def event_stream() -> AsyncIterator[str]:
        if first is not None:
            yield _sse(json.dumps({"token": first}))
        try:
            async for token in stream:
                yield _sse(json.dumps({"token": token}))
        except (OllamaUnreachableError, LLMProviderError) as exc:
            logger.error("Flux LLM (%s) interrompu: %s", provider.name, exc)
            yield _sse(json.dumps({"error": str(exc)}))
        yield _sse("[DONE]")

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
