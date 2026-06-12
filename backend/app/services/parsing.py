import io
from pathlib import Path

from app.core.logging import get_logger

logger = get_logger(__name__)

# Extensions supportées (en minuscules, point inclus).
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}


class UnsupportedFormatError(ValueError):
    """Levée quand le format de fichier n'est pas pris en charge."""


def _parse_pdf(data: bytes) -> list[tuple[int, str]]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages: list[tuple[int, str]] = []
    for index, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            pages.append((index, text))
    return pages


def _parse_docx(data: bytes) -> list[tuple[int, str]]:
    from docx import Document

    document = Document(io.BytesIO(data))
    # DOCX n'expose pas de pagination fiable : tout le corps est rattaché à la page 1.
    text = "\n".join(p.text for p in document.paragraphs if p.text.strip()).strip()
    return [(1, text)] if text else []


def _parse_text(data: bytes) -> list[tuple[int, str]]:
    text = data.decode("utf-8", errors="replace").strip()
    return [(1, text)] if text else []


def parse_document(filename: str, data: bytes) -> list[tuple[int, str]]:
    """Extrait le texte d'un fichier en conservant le numéro de page.

    Retourne une liste de (page, texte). Lève UnsupportedFormatError si
    l'extension n'est pas supportée.
    """
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        pages = _parse_pdf(data)
    elif ext == ".docx":
        pages = _parse_docx(data)
    elif ext in {".txt", ".md"}:
        pages = _parse_text(data)
    else:
        raise UnsupportedFormatError(f"Format non supporté : {ext or 'inconnu'}")

    logger.info("Parsing '%s' : %d page(s) avec texte", filename, len(pages))
    return pages
