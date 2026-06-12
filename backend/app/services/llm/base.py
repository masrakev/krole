from abc import ABC, abstractmethod
from collections.abc import AsyncIterator


class LLMProviderError(RuntimeError):
    """Levée quand le fournisseur LLM est injoignable ou répond en erreur."""


class LLMProvider(ABC):
    """Interface d'un fournisseur LLM pour l'étape de GÉNÉRATION uniquement.

    Les embeddings (bge-m3) et le reranker restent locaux quel que soit le
    fournisseur : seule la rédaction de la réponse est interchangeable.
    """

    # Identifiant court exposé à l'UI ("mistral" | "gemini" | "claude").
    name: str
    # Nom du modèle effectivement appelé.
    model: str
    # True si l'inférence reste sur la machine (récit souveraineté).
    is_local: bool

    @abstractmethod
    def chat_stream(
        self,
        messages: list[dict[str, str]],
        options: dict | None = None,
        stats: dict | None = None,
    ) -> AsyncIterator[str]:
        """Streame la réponse token par token.

        `options` porte des réglages d'inférence Ollama (num_predict, num_ctx) :
        ce sont des contraintes de latence CPU locales, les fournisseurs cloud
        les ignorent. `stats` est rempli en fin de flux quand le fournisseur
        expose des métriques (seul Ollama le fait).
        """

    def validate(self) -> bool:
        """Indique si le fournisseur est utilisable (clé + modèle joignables).

        Par défaut True : les fournisseurs LOCAUX sont toujours disponibles.
        Les fournisseurs cloud surchargent pour vérifier la clé/le modèle d'un
        appel léger, afin que le repli local soit décidé AVANT le streaming —
        sinon une clé invalide n'échouerait qu'au milieu de la réponse.
        """
        return True

    async def generate(
        self, messages: list[dict[str, str]], options: dict | None = None
    ) -> str:
        """Réponse complète (non streamée) : concatène le flux par défaut."""
        parts: list[str] = []
        async for token in self.chat_stream(messages, options=options):
            parts.append(token)
        return "".join(parts)
