from collections.abc import AsyncIterator

import anthropic

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.llm.base import LLMProvider, LLMProviderError

logger = get_logger(__name__)


class ClaudeProvider(LLMProvider):
    """Génération via l'API Anthropic (cloud), SDK officiel en streaming.

    Seule la rédaction de la réponse part vers Anthropic : la question et les
    extraits de contexte injectés dans le prompt. Embeddings, recherche et
    reranking restent locaux.
    """

    name = "claude"
    is_local = False

    def __init__(self) -> None:
        settings = get_settings()
        self.model = settings.claude_model
        self._max_tokens = settings.cloud_max_tokens
        self._client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        options: dict | None = None,
        stats: dict | None = None,
    ) -> AsyncIterator[str]:
        # `options` (num_predict/num_ctx) sont des réglages CPU Ollama : ignorés.
        # L'API Messages sépare le prompt système des tours user/assistant.
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        chat = [
            {"role": m["role"], "content": m["content"]}
            for m in messages
            if m["role"] in ("user", "assistant")
        ]
        kwargs: dict = {}
        if system:
            kwargs["system"] = system
        try:
            async with self._client.messages.stream(
                model=self.model,
                max_tokens=self._max_tokens,
                messages=chat,
                **kwargs,
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except anthropic.APIError as exc:
            logger.error("API Anthropic en erreur : %s", exc)
            raise LLMProviderError(
                "L'API Claude (Anthropic) est injoignable ou a répondu en erreur."
            ) from exc
