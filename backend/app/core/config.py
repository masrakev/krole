from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Ollama (LLM + embeddings runtime)
    ollama_base_url: str = "http://ollama:11434"

    # Chroma (vector store)
    chroma_host: str = "chroma"
    chroma_port: int = 8000

    # Models
    mistral_model: str = "mistral"
    embed_model: str = "bge-m3"

    # Fournisseur LLM — étape de GÉNÉRATION uniquement (mistral | gemini | claude).
    # Local-first : le choix est EXPLICITE — la présence d'une clé ne bascule
    # JAMAIS le moteur toute seule. Cloud choisi mais clé absente → avertissement
    # et repli sur Mistral local. Embeddings (bge-m3) et reranker restent locaux
    # dans tous les cas.
    llm_provider: str = "mistral"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    claude_model: str = "claude-opus-4-8"
    # Plafond de génération côté cloud. num_predict/num_ctx sont des réglages de
    # latence CPU propres à Ollama : les fournisseurs cloud les ignorent.
    cloud_max_tokens: int = 1024

    # Chat
    system_prompt: str = "Tu es un assistant utile et concis."

    # Inférence Ollama (CPU-only, 16 Go RAM) — appliqués à CHAQUE appel chat.
    # num_thread = nb de cœurs PHYSIQUES de la machine : Ollama sous-utilise les
    # cœurs par défaut (génération ~1 tok/s anormalement lente). num_ctx borné
    # pour limiter l'empreinte mémoire. keep_alive maintient le modèle chargé en
    # RAM entre les requêtes (évite un rechargement de plusieurs secondes).
    num_thread: int = 8
    num_ctx: int = 2048
    keep_alive: str = "30m"

    # Ingestion / vector store
    collection_name: str = "documents"
    upload_dir: str = "/data/uploads"
    # Graphe de connaissances (SQLite, sur le volume → survit aux redémarrages).
    graph_db_path: str = "/data/graph.db"
    max_upload_mb: int = 50
    chunk_size: int = 800
    chunk_overlap: int = 100
    embed_concurrency: int = 4

    # RAG
    # Candidats récupérés avant rerank (vector + BM25). Tenu bas (8) car le
    # cross-encoder de reranking tourne sur CPU : chaque paire query/candidat y
    # coûte cher. Le rerank ne s'exécute QUE sur ces k candidats.
    # Surchargeable via la variable d'env K_CANDIDATES.
    k_candidates: int = 8
    top_k: int = 4  # blocs candidats gardés après rerank (affichés en sources)
    # Blocs réellement injectés dans le prompt de génération. Distinct de top_k :
    # sur CPU, l'évaluation du prompt domine la latence (~15 tok/s), donc on
    # n'envoie que les 3 meilleurs au modèle.
    context_k: int = 3
    # Plafond de caractères par bloc injecté. 3 blocs × 500 + système + question
    # reste bien sous ~800 tokens de prompt.
    context_char_cap: int = 500
    # Longueur max de génération (tokens). Borne le temps de génération CPU.
    # 96 = réponses courtes et ancrées (le gros du temps warm était ici).
    num_predict: int = 96
    rrf_k: int = 60  # constante de la Reciprocal Rank Fusion
    # Rerank cross-encoder : désactivé par défaut (profil démo). Économise ~20 s
    # par requête ET libère ~2,3 Go de RAM (moins de pression mémoire sur la
    # génération). Réactivable via RERANK_ENABLED=true.
    rerank_enabled: bool = False
    rerank_model: str = "BAAI/bge-reranker-v2-m3"
    rerank_threshold: float = 0.3  # score min (normalisé 0-1) pour répondre
    rewrite_max_history: int = 6  # nb de messages d'historique pour la réécriture
    # Une requête réécrite est courte : on borne fort la génération (32 tokens).
    rewrite_num_predict: int = 32
    # Prompt système minimal : chaque token système est ré-évalué sur CPU à
    # chaque requête, donc on le garde court.
    rag_system_prompt: str = (
        "Réponds de façon concise, dans la langue de la question, uniquement à "
        "partir du contexte. Cite chaque source par son numéro entre crochets, "
        "ex. [1]. Si la réponse n'est pas dans le contexte, dis que tu ne sais pas."
    )

    # Évaluation RAGAS — 100 % LOCAL : juge = Mistral via Ollama, embeddings
    # = bge-m3 via Ollama. AUCUN appel OpenAI.
    eval_dataset_path: str = "eval/dataset.json"
    # Cache du dernier run (volume /data → survit aux redémarrages).
    eval_result_path: str = "/data/eval_result.json"
    eval_judge_model: str = "mistral"
    # Le juge RAGAS émet du JSON court (verdicts) : 256 tokens suffisent et
    # accélèrent nettement chaque appel sur CPU.
    eval_judge_num_predict: int = 256
    eval_num_ctx: int = 4096
    # Délai max par métrique et par question (CPU lent) : au-delà, on l'ignore.
    # Généreux car la fidélité enchaîne plusieurs appels LLM séquentiels.
    eval_metric_timeout: float = 300.0

    # Voice (100 % local) — modèles mis en cache dans le volume /models.
    models_dir: str = "/models"
    # faster-whisper (STT). small = bon compromis qualité/RAM (~0,5 Go) et gère
    # le français. int8 sur CPU pour rester léger à côté de Mistral.
    stt_model: str = "small"
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"
    # Langue forcée (code ISO, ex. "fr") ; vide = détection automatique.
    stt_language: str = ""
    # Piper (TTS) — voix française téléchargée une fois dans /models/piper.
    tts_voice: str = "fr_FR-siwis-medium"
    tts_voice_url: str = (
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
        "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx"
    )

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]

    # Logging
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
