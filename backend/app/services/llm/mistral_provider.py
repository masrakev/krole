from collections.abc import AsyncIterator

from app.services.llm.base import LLMProvider
from app.services.ollama_client import OllamaClient


class MistralProvider(LLMProvider):
    """Génération 100 % locale via Ollama (Mistral) — le défaut souverain."""

    name = "mistral"
    is_local = True

    def __init__(self) -> None:
        self._client = OllamaClient()
        self.model = self._client.model

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        options: dict | None = None,
        stats: dict | None = None,
    ) -> AsyncIterator[str]:
        async for token in self._client.chat_stream(
            messages, options=options, stats=stats
        ):
            yield token

    async def generate(
        self, messages: list[dict[str, str]], options: dict | None = None
    ) -> str:
        # Appel non streamé natif d'Ollama (un seul aller-retour HTTP).
        return await self._client.generate(messages, options=options)
