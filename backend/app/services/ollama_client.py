import json
from collections.abc import AsyncIterator

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class OllamaUnreachableError(RuntimeError):
    """Levée quand Ollama est injoignable ou répond en erreur."""


class OllamaClient:
    """Client async minimal vers Ollama (LLM + embeddings)."""

    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.mistral_model
        self._settings = settings

    def _merge_options(self, options: dict | None) -> dict:
        """Options d'inférence par défaut (CPU) + surcharges de l'appelant.

        num_thread/num_ctx sont appliqués à CHAQUE appel : sans eux Ollama
        sous-utilise les cœurs et alloue un contexte par défaut plus large.
        L'appelant (p. ex. num_predict) a la priorité.
        """
        merged = {
            "num_thread": self._settings.num_thread,
            "num_ctx": self._settings.num_ctx,
        }
        if options:
            merged.update(options)
        return merged

    async def generate(
        self,
        messages: list[dict[str, str]],
        fmt: str | None = None,
        options: dict | None = None,
        timeout: float = 120.0,
    ) -> str:
        """Appelle /api/chat sans streaming et renvoie le texte complet.

        Utilisé par la réécriture de requête et l'extraction du graphe.
        `fmt="json"` force une sortie JSON valide ; `options` passe les
        paramètres d'inférence (p. ex. {"temperature": 0}).
        Lève OllamaUnreachableError si Ollama est injoignable.
        """
        payload: dict = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "keep_alive": self._settings.keep_alive,
            "options": self._merge_options(options),
        }
        if fmt:
            payload["format"] = fmt
        url = f"{self.base_url}/api/chat"
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            logger.error("Ollama injoignable (generate): %s", exc)
            raise OllamaUnreachableError("Ollama est injoignable.") from exc
        return data.get("message", {}).get("content", "")

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        options: dict | None = None,
        stats: dict | None = None,
    ) -> AsyncIterator[str]:
        """Appelle /api/chat en streaming et yield les tokens un par un.

        `messages` est une liste de dicts {role, content}. `options` passe les
        paramètres d'inférence Ollama (p. ex. {"num_predict": 512}).
        Si `stats` est fourni, il est rempli à la fin avec les métriques du
        chunk final (prompt_eval_count, prompt_eval_duration, eval_count,
        eval_duration — durées en nanosecondes).
        Lève OllamaUnreachableError si Ollama est injoignable.
        """
        payload: dict = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "keep_alive": self._settings.keep_alive,
            "options": self._merge_options(options),
        }
        url = f"{self.base_url}/api/chat"

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("POST", url, json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            logger.warning("Ligne JSON Ollama illisible: %r", line)
                            continue

                        if data.get("error"):
                            raise OllamaUnreachableError(data["error"])

                        token = data.get("message", {}).get("content", "")
                        if token:
                            yield token

                        if data.get("done"):
                            if stats is not None:
                                for key in (
                                    "prompt_eval_count",
                                    "prompt_eval_duration",
                                    "eval_count",
                                    "eval_duration",
                                ):
                                    if key in data:
                                        stats[key] = data[key]
                            break
        except httpx.HTTPStatusError as exc:
            logger.error("Ollama a répondu en erreur HTTP: %s", exc)
            raise OllamaUnreachableError(
                f"Ollama a répondu avec le statut {exc.response.status_code}."
            ) from exc
        except httpx.HTTPError as exc:
            logger.error("Ollama injoignable: %s", exc)
            raise OllamaUnreachableError("Ollama est injoignable.") from exc
