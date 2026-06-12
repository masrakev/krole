from fastapi import APIRouter

from app.services.llm.factory import get_llm_provider

router = APIRouter(prefix="/api", tags=["config"])


@router.get("/config")
async def get_config() -> dict:
    """Expose le fournisseur de génération ACTIF (après repli éventuel).

    Sert au front pour afficher honnêtement quel moteur rédige les réponses
    (récit souveraineté) : « Local · Mistral » ou le nom du cloud choisi.
    """
    provider = get_llm_provider()
    return {
        "llm_provider": provider.name,
        "llm_model": provider.model,
        "llm_local": provider.is_local,
    }
