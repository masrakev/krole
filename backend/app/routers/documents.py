import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.document import DocumentOut
from app.services import (
    embeddings,
    graph_extractor,
    graph_store,
    retrieval,
    vectorstore,
)
from app.services.chunking import chunk_pages
from app.services.embeddings import EmbeddingError
from app.services.parsing import (
    SUPPORTED_EXTENSIONS,
    UnsupportedFormatError,
    parse_document,
)
from app.services.vectorstore import VectorStoreError

logger = get_logger(__name__)
router = APIRouter(prefix="/api/documents", tags=["documents"])

# Content-types explicites (mimetypes ne connaît pas toujours .md).
_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
}


def _save_source(doc_id: str, filename: str, data: bytes) -> None:
    """Persiste le fichier source dans le volume uploads (pour le viewer plus tard)."""
    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(filename).suffix.lower()
    (upload_dir / f"{doc_id}{ext}").write_bytes(data)


@router.post("", response_model=list[DocumentOut])
async def upload_documents(
    files: list[UploadFile], background_tasks: BackgroundTasks
) -> list[DocumentOut]:
    """Upload multi-fichiers → parse → chunk → embed → store.

    L'extraction du graphe de connaissances est lancée en tâche de fond (lente
    sur CPU) : la réponse d'upload n'attend pas qu'elle se termine.
    """
    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    results: list[DocumentOut] = []

    for file in files:
        ext = Path(file.filename or "").suffix.lower()
        if ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{file.filename}' : format non supporté. "
                    f"Acceptés : {', '.join(sorted(SUPPORTED_EXTENSIONS))}."
                ),
            )

        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail=f"'{file.filename}' est vide.")
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"'{file.filename}' dépasse {settings.max_upload_mb} Mo.",
            )

        doc_id = str(uuid.uuid4())
        doc_name = file.filename or doc_id
        created_at = datetime.now(timezone.utc).isoformat()

        try:
            pages = parse_document(doc_name, data)
        except UnsupportedFormatError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if not pages:
            raise HTTPException(
                status_code=422,
                detail=f"Aucun texte exploitable dans '{doc_name}'.",
            )

        chunks = chunk_pages(doc_id, doc_name, pages, created_at)
        if not chunks:
            raise HTTPException(
                status_code=422,
                detail=f"Aucun chunk généré pour '{doc_name}'.",
            )

        try:
            vectors = await embeddings.embed_texts([c["text"] for c in chunks])
            await vectorstore.add_chunks(chunks, vectors)
        except EmbeddingError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except VectorStoreError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        # Les chunks ont changé : l'index BM25 en cache doit être reconstruit.
        retrieval.invalidate()

        _save_source(doc_id, doc_name, data)
        n_pages = max(p for p, _ in pages)
        logger.info(
            "Indexé '%s' (doc_id=%s) : %d page(s), %d chunk(s)",
            doc_name,
            doc_id,
            n_pages,
            len(chunks),
        )
        # Extraction du graphe en arrière-plan (ne bloque pas la réponse).
        background_tasks.add_task(
            graph_extractor.extract_doc, doc_id, doc_name, chunks
        )
        results.append(
            DocumentOut(
                doc_id=doc_id,
                name=doc_name,
                pages=n_pages,
                chunks=len(chunks),
                created_at=created_at,
            )
        )

    return results


@router.get("", response_model=list[DocumentOut])
async def list_documents() -> list[DocumentOut]:
    """Liste les documents indexés (nom, pages, nb de chunks)."""
    try:
        docs = await vectorstore.list_documents()
    except VectorStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return [DocumentOut(**d) for d in docs]


@router.get("/{doc_id}/file")
async def get_document_file(doc_id: str) -> FileResponse:
    """Sert le fichier source original (pour le viewer) depuis le volume uploads."""
    settings = get_settings()
    upload_dir = Path(settings.upload_dir).resolve()
    matches = sorted(upload_dir.glob(f"{doc_id}.*"))
    # Confine la résolution au dossier uploads (anti path-traversal).
    path = next(
        (p for p in matches if p.resolve().parent == upload_dir and p.is_file()),
        None,
    )
    if path is None:
        raise HTTPException(status_code=404, detail="Fichier source introuvable.")

    media_type = (
        _CONTENT_TYPES.get(path.suffix.lower())
        or mimetypes.guess_type(path.name)[0]
        or "application/octet-stream"
    )
    return FileResponse(
        path,
        media_type=media_type,
        filename=path.name,
        content_disposition_type="inline",
    )


@router.delete("/{doc_id}", status_code=204)
async def delete_document(doc_id: str) -> None:
    """Supprime un document et tous ses chunks."""
    try:
        await vectorstore.delete_document(doc_id)
    except VectorStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Les chunks ont changé : l'index BM25 en cache doit être reconstruit.
    retrieval.invalidate()

    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    for path in upload_dir.glob(f"{doc_id}.*"):
        path.unlink(missing_ok=True)
    # Retire aussi la contribution du document au graphe.
    await graph_store.remove_doc(doc_id)
    logger.info("Supprimé doc_id=%s", doc_id)
