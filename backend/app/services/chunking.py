from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.config import get_settings


def _splitter() -> RecursiveCharacterTextSplitter:
    settings = get_settings()
    return RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        # Découpe en priorité sur les paragraphes, puis lignes, phrases, mots.
        separators=["\n\n", "\n", ". ", " ", ""],
    )


def chunk_pages(
    doc_id: str,
    doc_name: str,
    pages: list[tuple[int, str]],
    created_at: str,
) -> list[dict]:
    """Découpe les pages en chunks avec leurs métadonnées.

    Chaque chunk : {id, text, metadata: {doc_id, doc_name, page, chunk_id, created_at}}.
    `chunk_id` est un index global croissant sur l'ensemble du document.
    """
    splitter = _splitter()
    chunks: list[dict] = []
    chunk_id = 0

    for page, text in pages:
        for piece in splitter.split_text(text):
            piece = piece.strip()
            if not piece:
                continue
            chunks.append(
                {
                    "id": f"{doc_id}:{chunk_id}",
                    "text": piece,
                    "metadata": {
                        "doc_id": doc_id,
                        "doc_name": doc_name,
                        "page": page,
                        "chunk_id": chunk_id,
                        "created_at": created_at,
                    },
                }
            )
            chunk_id += 1

    return chunks
