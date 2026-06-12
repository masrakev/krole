import asyncio
from functools import lru_cache

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class VectorStoreError(RuntimeError):
    """Levée quand Chroma est injoignable ou répond en erreur."""


@lru_cache
def _collection():
    """Client Chroma + collection 'documents', créés une seule fois (sync)."""
    settings = get_settings()
    client = chromadb.HttpClient(
        host=settings.chroma_host,
        port=settings.chroma_port,
        settings=ChromaSettings(anonymized_telemetry=False),
    )
    return client.get_or_create_collection(
        name=settings.collection_name,
        metadata={"hnsw:space": "cosine"},
    )


# --- Opérations synchrones (exécutées dans un thread) ---------------------


def _add_chunks(chunks: list[dict], embeddings: list[list[float]]) -> None:
    collection = _collection()
    collection.add(
        ids=[c["id"] for c in chunks],
        embeddings=embeddings,
        documents=[c["text"] for c in chunks],
        metadatas=[c["metadata"] for c in chunks],
    )


def _query(embedding: list[float], k: int, filters: dict | None) -> dict:
    collection = _collection()
    return collection.query(
        query_embeddings=[embedding],
        n_results=k,
        where=filters or None,
        include=["documents", "metadatas", "distances"],
    )


def _list_documents() -> list[dict]:
    collection = _collection()
    result = collection.get(include=["metadatas"])
    docs: dict[str, dict] = {}
    for meta in result.get("metadatas") or []:
        doc_id = meta["doc_id"]
        entry = docs.setdefault(
            doc_id,
            {
                "doc_id": doc_id,
                "name": meta.get("doc_name", ""),
                "pages": 0,
                "chunks": 0,
                "created_at": meta.get("created_at", ""),
            },
        )
        entry["chunks"] += 1
        entry["pages"] = max(entry["pages"], int(meta.get("page", 0)))
    return list(docs.values())


def _get_all_chunks(filters: dict | None) -> list[dict]:
    collection = _collection()
    result = collection.get(where=filters or None, include=["documents", "metadatas"])
    ids = result.get("ids") or []
    documents = result.get("documents") or []
    metadatas = result.get("metadatas") or []
    return [
        {"id": i, "text": t, "metadata": m}
        for i, t, m in zip(ids, documents, metadatas)
    ]


def _delete_document(doc_id: str) -> None:
    collection = _collection()
    collection.delete(where={"doc_id": doc_id})


# --- API async ------------------------------------------------------------


async def _run(func, *args):
    try:
        return await asyncio.to_thread(func, *args)
    except VectorStoreError:
        raise
    except Exception as exc:  # noqa: BLE001 — on remonte une erreur claire
        logger.error("Erreur Chroma : %s", exc)
        raise VectorStoreError("Le vector store (Chroma) est injoignable.") from exc


async def add_chunks(chunks: list[dict], embeddings: list[list[float]]) -> None:
    if not chunks:
        return
    await _run(_add_chunks, chunks, embeddings)


async def query(embedding: list[float], k: int = 5, filters: dict | None = None) -> dict:
    return await _run(_query, embedding, k, filters)


async def list_documents() -> list[dict]:
    return await _run(_list_documents)


async def get_all_chunks(filters: dict | None = None) -> list[dict]:
    """Renvoie tous les chunks (id, text, metadata), pour l'index BM25."""
    return await _run(_get_all_chunks, filters)


async def delete_document(doc_id: str) -> None:
    await _run(_delete_document, doc_id)
