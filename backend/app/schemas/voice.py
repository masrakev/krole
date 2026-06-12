from pydantic import BaseModel, Field


class TranscribeResponse(BaseModel):
    """Résultat d'une transcription audio -> texte (Whisper)."""

    text: str


class SpeakRequest(BaseModel):
    """Texte à lire à voix haute (Piper)."""

    text: str = Field(..., min_length=1)
