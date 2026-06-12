import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.logging import get_logger, setup_logging
from app.routers import chat, config, documents, eval, graph, health, rag, voice
from app.services import reranker, retrieval, stt, tts
from app.services.llm.factory import get_llm_provider

settings = get_settings()
setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pré-construit l'index BM25 en cache (évite de le reconstruire par requête).
    await retrieval.warmup()
    # Ne précharge le reranker QUE s'il est activé : en profil démo il reste
    # déchargé (~2,3 Go de RAM libérés pour la génération). 1er boot = télé-
    # chargement (lent), boots suivants = chargement depuis le volume /models.
    if settings.rerank_enabled:
        await reranker.warmup()
    # Mode vocal : précharge Whisper (STT) et la voix Piper (TTS) depuis /models
    # pour que la 1re transcription/synthèse ne soit pas « à froid ». Un échec
    # (réseau, modèle absent) n'empêche pas le reste de l'API de démarrer.
    try:
        await stt.warmup()
    except Exception:  # noqa: BLE001
        logger.exception("Préchargement Whisper (STT) échoué — voix dégradée")
    try:
        await tts.warmup()
    except Exception:  # noqa: BLE001
        logger.exception("Préchargement Piper (TTS) échoué — voix dégradée")
    # Sélectionne (et valide) le fournisseur de génération dès le démarrage : si
    # un cloud est demandé avec une clé/modèle invalide, le repli sur Mistral
    # local est décidé et journalisé au boot, pas au milieu de la 1re réponse.
    # En thread car validate() fait un appel réseau (ne pas bloquer la boucle).
    try:
        await asyncio.to_thread(get_llm_provider)
    except Exception:  # noqa: BLE001
        logger.exception("Sélection du fournisseur LLM au démarrage échouée")
    yield


app = FastAPI(title="RAG Local API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(config.router)
app.include_router(chat.router)
app.include_router(documents.router)
app.include_router(rag.router)
app.include_router(graph.router)
app.include_router(voice.router)
app.include_router(eval.router)
