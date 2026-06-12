from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.core.logging import get_logger
from app.schemas.voice import SpeakRequest, TranscribeResponse
from app.services import stt, tts

logger = get_logger(__name__)
router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...)) -> TranscribeResponse:
    """Transcrit un clip audio (webm/ogg/wav) en texte via Whisper."""
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Fichier audio vide.")
    try:
        text = await stt.transcribe(data, audio.filename)
    except Exception as exc:  # noqa: BLE001 — surface une erreur lisible au front
        logger.exception("Échec de la transcription")
        raise HTTPException(
            status_code=500, detail=f"Transcription impossible : {exc}"
        ) from exc
    return TranscribeResponse(text=text)


@router.post("/speak")
async def speak(request: SpeakRequest) -> Response:
    """Lit un texte à voix haute via Piper et renvoie un flux audio/wav."""
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texte vide.")
    try:
        wav = await tts.synthesize(text)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de la synthèse vocale")
        raise HTTPException(
            status_code=500, detail=f"Synthèse vocale impossible : {exc}"
        ) from exc
    return Response(content=wav, media_type="audio/wav")
