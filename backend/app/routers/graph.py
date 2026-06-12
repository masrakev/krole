from fastapi import APIRouter, HTTPException

from app.core.logging import get_logger
from app.schemas.graph import EntityChunk, GraphResponse, RebuildSummary
from app.services import graph_extractor, graph_store, vectorstore
from app.services.vectorstore import VectorStoreError

logger = get_logger(__name__)
router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("", response_model=GraphResponse)
async def get_graph(doc_id: str | None = None) -> GraphResponse:
    """Renvoie le graphe (optionnellement restreint à un document)."""
    data = await graph_store.get_graph(doc_id)
    return GraphResponse(**data)


@router.post("/rebuild", response_model=RebuildSummary)
async def rebuild_graph() -> RebuildSummary:
    """(Re)construit le graphe pour TOUS les documents indexés (séquentiel)."""
    try:
        docs = await vectorstore.list_documents()
    except VectorStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    logger.info("Graphe : reconstruction complète sur %d document(s)…", len(docs))
    await graph_store.clear_all()

    total_chunks = 0
    for n, doc in enumerate(docs, start=1):
        doc_id, doc_name = doc["doc_id"], doc["name"]
        try:
            chunks = await vectorstore.get_all_chunks({"doc_id": doc_id})
        except VectorStoreError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        logger.info("Graphe : document %d/%d — '%s'", n, len(docs), doc_name)
        result = await graph_extractor.extract_doc(doc_id, doc_name, chunks)
        total_chunks += result["chunks"]

    stats = await graph_store.stats()
    logger.info(
        "Graphe : reconstruction terminée (%d nœuds, %d arêtes).",
        stats["nodes"],
        stats["edges"],
    )
    return RebuildSummary(
        documents=len(docs),
        nodes=stats["nodes"],
        edges=stats["edges"],
        chunks=total_chunks,
    )


@router.get("/entity/{node_id}/chunks", response_model=list[EntityChunk])
async def get_entity_chunks(node_id: str) -> list[EntityChunk]:
    """Liste les chunks qui mentionnent une entité (avec texte + nom de doc)."""
    rows = await graph_store.get_entity_chunks(node_id)
    if not rows:
        return []

    try:
        docs = await vectorstore.list_documents()
        names = {d["doc_id"]: d["name"] for d in docs}
        # Texte des chunks, récupéré par document depuis Chroma.
        texts: dict[str, str] = {}
        for did in {r["doc_id"] for r in rows}:
            for c in await vectorstore.get_all_chunks({"doc_id": did}):
                texts[c["id"]] = c["text"]
    except VectorStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return [
        EntityChunk(
            doc_id=r["doc_id"],
            doc_name=names.get(r["doc_id"], ""),
            page=r["page"],
            chunk_id=r["chunk_id"],
            text=texts.get(r["chunk_id"], ""),
        )
        for r in rows
    ]
