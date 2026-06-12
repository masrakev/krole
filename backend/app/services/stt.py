import asyncio
import tempfile
import threading
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_model = None
_lock = threading.Lock()


def _get_model():
    """Charge le modèle Whisper une seule fois (chargement paresseux + thread-safe).

    Le premier démarrage télécharge les poids depuis HuggingFace dans le volume
    /models ; les suivants les rechargent du disque en quelques secondes, sans
    re-téléchargement (download_root = /models).
    """
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from faster_whisper import WhisperModel

                settings = get_settings()
                logger.info(
                    "Chargement de Whisper '%s' (%s/%s)…",
                    settings.stt_model,
                    settings.stt_device,
                    settings.stt_compute_type,
                )
                _model = WhisperModel(
                    settings.stt_model,
                    device=settings.stt_device,
                    compute_type=settings.stt_compute_type,
                    download_root=settings.models_dir,
                )
                logger.info("Whisper prêt.")
    return _model


def _transcribe_sync(data: bytes, suffix: str) -> str:
    model = _get_model()
    settings = get_settings()
    # faster-whisper décode l'audio via PyAV (ffmpeg embarqué) : webm/ogg/wav
    # sont gérés tels quels. On écrit un fichier temporaire (le flux MediaRecorder
    # peut manquer de métadonnées de durée, peu fiable à lire depuis un buffer).
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        segments, info = model.transcribe(
            path,
            beam_size=1,  # CPU : faisceau minimal pour la latence
            language=settings.stt_language or None,  # vide => détection auto
            vad_filter=True,  # coupe les silences (clips courts)
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        logger.info(
            "Transcription (%s, %.1fs) : %d caractères",
            info.language,
            info.duration,
            len(text),
        )
        return text
    finally:
        Path(path).unlink(missing_ok=True)


async def warmup() -> None:
    """Précharge Whisper au démarrage (hors boucle d'événements)."""
    await asyncio.to_thread(_get_model)


async def transcribe(data: bytes, filename: str | None = None) -> str:
    """Transcrit un clip audio (octets bruts) en texte."""
    suffix = Path(filename or "").suffix or ".webm"
    return await asyncio.to_thread(_transcribe_sync, data, suffix)
