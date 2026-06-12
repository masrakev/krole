from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.llm.base import LLMProviderError
from app.services.llm.factory import get_llm_provider
from app.services.ollama_client import OllamaUnreachableError

logger = get_logger(__name__)

_REWRITE_SYSTEM = (
    "Tu es un module de réécriture de requêtes pour un moteur de recherche "
    "documentaire. À partir de l'historique de conversation et de la dernière "
    "question, produis UNE seule requête de recherche autonome : résous les "
    "pronoms et références implicites, explicite le sujet, ajoute les termes "
    "clés utiles. RÈGLE ABSOLUE : rédige la requête réécrite dans EXACTEMENT la "
    "même langue que la question d'origine. Ne traduis JAMAIS (par exemple, une "
    "question en français doit donner une requête en français). Réponds "
    "UNIQUEMENT par la requête réécrite, sans guillemets, sans préfixe, sans "
    "explication."
)


def _format_history(history: list[dict[str, str]], max_history: int) -> str:
    recent = [m for m in history if m.get("role") in ("user", "assistant")]
    recent = recent[-max_history:]
    lines = []
    for m in recent:
        speaker = "Utilisateur" if m["role"] == "user" else "Assistant"
        lines.append(f"{speaker}: {m['content']}")
    return "\n".join(lines)


async def rewrite_query(question: str, history: list[dict[str, str]]) -> str:
    """Réécrit la question en requête de recherche autonome via le LLM actif.

    Résout les pronoms et enrichit la requête pour le retrieval. En cas
    d'échec (fournisseur injoignable), retourne la question d'origine en repli.
    """
    settings = get_settings()
    history_text = _format_history(history, settings.rewrite_max_history)

    user_content = (
        (f"Historique:\n{history_text}\n\n" if history_text else "")
        + f"Question: {question}\n\nRequête de recherche réécrite:"
    )
    messages = [
        {"role": "system", "content": _REWRITE_SYSTEM},
        {"role": "user", "content": user_content},
    ]

    try:
        provider = get_llm_provider()
        rewritten = (
            await provider.generate(
                messages, options={"num_predict": settings.rewrite_num_predict}
            )
        ).strip()
    except (OllamaUnreachableError, LLMProviderError) as exc:
        logger.warning("Réécriture indisponible (%s) — repli sur la question brute.", exc)
        return question

    if not rewritten:
        return question

    # Garde-fou : si le modèle bavarde, on garde la première ligne non vide.
    rewritten = next((ln.strip() for ln in rewritten.splitlines() if ln.strip()), question)
    logger.info("Requête réécrite : %r -> %r", question, rewritten)
    return rewritten
