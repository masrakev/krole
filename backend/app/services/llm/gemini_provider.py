import json
from collections.abc import AsyncIterator

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.llm.base import LLMProvider, LLMProviderError

logger = get_logger(__name__)

_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GeminiProvider(LLMProvider):
    """Génération via l'API Gemini (cloud).

    Seule la rédaction de la réponse part vers Google : la question et les
    extraits de contexte injectés dans le prompt. Embeddings, recherche et
    reranking restent locaux.
    """

    name = "gemini"
    is_local = False

    def __init__(self) -> None:
        settings = get_settings()
        self.model = settings.gemini_model
        self._api_key = settings.gemini_api_key
        self._max_tokens = settings.cloud_max_tokens

    def validate(self) -> bool:
        """Vérifie clé + modèle d'un GET léger (aucune génération, aucun coût).

        200 → utilisable. 400/401/403 (clé refusée) ou 404 (modèle inconnu) →
        repli local définitif après avertissement. Erreur réseau → on GARDE le
        cloud (hoquet transitoire) ; l'erreur éventuelle sera gérée par requête.
        """
        url = f"{_BASE_URL}/models/{self.model}"
        try:
            resp = httpx.get(
                url, headers={"x-goog-api-key": self._api_key}, timeout=8.0
            )
        except httpx.HTTPError as exc:
            logger.warning("Validation Gemini impossible (réseau) : %s", exc)
            return True
        if resp.status_code == 200:
            return True
        logger.error(
            "Validation Gemini : HTTP %d — clé ou modèle refusé(e).",
            resp.status_code,
        )
        return False

    def _build_payload(self, messages: list[dict[str, str]]) -> dict:
        """Convertit les messages {role, content} au format Gemini.

        Gemini sépare l'instruction système (`systemInstruction`) des tours de
        conversation (`contents`, rôles user/model).
        """
        system_parts = [m["content"] for m in messages if m["role"] == "system"]
        contents = [
            {
                "role": "model" if m["role"] == "assistant" else "user",
                "parts": [{"text": m["content"]}],
            }
            for m in messages
            if m["role"] in ("user", "assistant")
        ]
        payload: dict = {
            "contents": contents,
            "generationConfig": {"maxOutputTokens": self._max_tokens},
        }
        if system_parts:
            payload["systemInstruction"] = {
                "parts": [{"text": "\n\n".join(system_parts)}]
            }
        return payload

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        options: dict | None = None,
        stats: dict | None = None,
    ) -> AsyncIterator[str]:
        # `options` (num_predict/num_ctx) sont des réglages CPU Ollama : ignorés.
        url = f"{_BASE_URL}/models/{self.model}:streamGenerateContent"
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, read=None)
            ) as client:
                async with client.stream(
                    "POST",
                    url,
                    params={"alt": "sse"},
                    headers={"x-goog-api-key": self._api_key},
                    json=self._build_payload(messages),
                ) as response:
                    if response.status_code >= 400:
                        body = (await response.aread()).decode(errors="replace")
                        logger.error(
                            "Gemini HTTP %d : %s", response.status_code, body[:500]
                        )
                        raise LLMProviderError(
                            f"L'API Gemini a répondu avec le statut "
                            f"{response.status_code}."
                        )
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line[len("data:") :].strip()
                        if not raw or raw == "[DONE]":
                            continue
                        try:
                            data = json.loads(raw)
                        except json.JSONDecodeError:
                            logger.warning("Ligne SSE Gemini illisible: %r", raw[:200])
                            continue
                        for candidate in data.get("candidates", []):
                            for part in candidate.get("content", {}).get("parts", []):
                                text = part.get("text", "")
                                if text:
                                    yield text
        except httpx.HTTPError as exc:
            logger.error("Gemini injoignable : %s", exc)
            raise LLMProviderError("L'API Gemini est injoignable.") from exc
