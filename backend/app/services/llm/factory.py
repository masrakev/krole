from functools import lru_cache

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.llm.base import LLMProvider
from app.services.llm.mistral_provider import MistralProvider

logger = get_logger(__name__)


@lru_cache
def get_llm_provider() -> LLMProvider:
    """Fournisseur de GÉNÉRATION désigné par LLM_PROVIDER (défaut : mistral).

    Local-first : un fournisseur cloud n'est utilisé que s'il est demandé
    EXPLICITEMENT et que sa clé est présente. Clé absente → avertissement clair
    et repli sur Mistral local — jamais de crash, jamais de bascule silencieuse
    vers un autre cloud.
    """
    settings = get_settings()
    choice = settings.llm_provider.strip().lower()

    # Imports paresseux des fournisseurs cloud : le profil local (défaut) ne
    # doit jamais dépendre de leurs paquets (p. ex. anthropic non installé).
    if choice == "gemini":
        if settings.gemini_api_key:
            from app.services.llm.gemini_provider import GeminiProvider

            provider = GeminiProvider()
            # Validation AVANT tout streaming : une clé ou un modèle invalide
            # (401/403/404) bascule sur Mistral local APRÈS un avertissement
            # clair, au lieu d'échouer au milieu de la réponse. Un simple hoquet
            # réseau ne désactive PAS le cloud (cf. GeminiProvider.validate).
            if provider.validate():
                logger.info(
                    "Fournisseur LLM : Gemini (%s) — la GÉNÉRATION passe par le "
                    "cloud ; embeddings et reranker restent locaux.",
                    settings.gemini_model,
                )
                return provider
            logger.warning(
                "LLM_PROVIDER=gemini mais la clé/modèle Gemini est refusé(e) — "
                "repli sur Mistral local."
            )
        else:
            logger.warning(
                "LLM_PROVIDER=gemini mais GEMINI_API_KEY est vide — "
                "repli sur Mistral local."
            )
    elif choice == "claude":
        if settings.anthropic_api_key:
            from app.services.llm.claude_provider import ClaudeProvider

            logger.info(
                "Fournisseur LLM : Claude (%s) — la GÉNÉRATION passe par le cloud ; "
                "embeddings et reranker restent locaux.",
                settings.claude_model,
            )
            return ClaudeProvider()
        logger.warning(
            "LLM_PROVIDER=claude mais ANTHROPIC_API_KEY est vide — "
            "repli sur Mistral local."
        )
    elif choice != "mistral":
        logger.warning(
            "LLM_PROVIDER=%r inconnu (attendu : mistral | gemini | claude) — "
            "repli sur Mistral local.",
            settings.llm_provider,
        )

    return MistralProvider()
