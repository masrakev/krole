import asyncio
import io
import threading
import wave
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_voice = None
_lock = threading.Lock()


def _voice_paths(settings) -> tuple[Path, Path]:
    base = Path(settings.models_dir) / "piper"
    onnx = base / f"{settings.tts_voice}.onnx"
    config = base / f"{settings.tts_voice}.onnx.json"
    return onnx, config


def _download_voice(settings) -> tuple[Path, Path]:
    """Télécharge la voix Piper (.onnx + .onnx.json) une seule fois dans /models.

    Les fichiers déjà présents ne sont pas re-téléchargés.
    """
    onnx, config = _voice_paths(settings)
    onnx.parent.mkdir(parents=True, exist_ok=True)
    targets = [
        (onnx, settings.tts_voice_url),
        (config, settings.tts_voice_url + ".json"),
    ]
    for path, url in targets:
        if path.exists() and path.stat().st_size > 0:
            continue
        logger.info("Téléchargement de la voix Piper : %s", url)
        with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as resp:
            resp.raise_for_status()
            with open(path, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
    return onnx, config


def _get_voice():
    """Charge la voix Piper une seule fois (chargement paresseux + thread-safe)."""
    global _voice
    if _voice is None:
        with _lock:
            if _voice is None:
                from piper.voice import PiperVoice

                settings = get_settings()
                onnx, config = _download_voice(settings)
                logger.info("Chargement de la voix Piper '%s'…", settings.tts_voice)
                _voice = PiperVoice.load(str(onnx), config_path=str(config))
                logger.info("Piper prêt.")
    return _voice


def _synthesize_sync(text: str) -> bytes:
    voice = _get_voice()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize(text, wav_file)
    return buf.getvalue()


async def warmup() -> None:
    """Précharge la voix Piper au démarrage (télécharge si absente)."""
    await asyncio.to_thread(_get_voice)


async def synthesize(text: str) -> bytes:
    """Synthétise `text` en parole et renvoie les octets d'un WAV."""
    return await asyncio.to_thread(_synthesize_sync, text)
