import asyncio
import re
from collections import defaultdict

from rank_bm25 import BM25Okapi

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services import vectorstore
from app.services.embeddings import embed_texts

logger = get_logger(__name__)

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


# --- Index BM25 + table de métadonnées, mis en cache en mémoire ------------
# Construire l'index BM25 (et re-télécharger TOUS les chunks depuis Chroma) à
# chaque requête coûtait plusieurs secondes. On le construit UNE fois (démarrage
# ou 1re requête), puis on le réutilise. Invalidé à chaque upload/suppression.
_bm25: BM25Okapi | None = None
_bm25_ids: list[str] = []
_records: dict[str, dict] = {}
_built = False
_lock = asyncio.Lock()


def invalidate() -> None:
    """Marque l'index BM25 comme périmé (après ingestion ou suppression)."""
    global _bm25, _bm25_ids, _records, _built
    _bm25 = None
    _bm25_ids = []
    _records = {}
    _built = False
    logger.info("Index BM25 invalidé (sera reconstruit à la prochaine requête).")


async def _ensure_index() -> None:
    """Construit l'index BM25 + la table de métadonnées s'ils sont périmés."""
    global _bm25, _bm25_ids, _records, _built
    if _built:
        return
    async with _lock:
        if _built:  # un autre coroutine l'a construit pendant l'attente du verrou
            return
        all_chunks = await vectorstore.get_all_chunks(None)
        _records = {c["id"]: c for c in all_chunks}
        _bm25_ids = list(_records.keys())
        _bm25 = (
            BM25Okapi([_tokenize(_records[i]["text"]) for i in _bm25_ids])
            if _bm25_ids
            else None
        )
        _built = True
        logger.info("Index BM25 construit : %d chunk(s) en cache.", len(_bm25_ids))


async def warmup() -> None:
    """Pré-construit l'index BM25 au démarrage (best-effort)."""
    try:
        await _ensure_index()
    except Exception as exc:  # noqa: BLE001 — ne bloque pas le démarrage
        logger.warning("Pré-construction de l'index BM25 ignorée : %s", exc)


def _bm25_ranking_cached(query: str, k: int) -> list[str]:
    if _bm25 is None:
        return []
    scores = _bm25.get_scores(_tokenize(query))
    ranked = sorted(range(len(_bm25_ids)), key=lambda i: scores[i], reverse=True)
    return [_bm25_ids[i] for i in ranked[:k]]


def _vector_ranking(res: dict, k: int) -> list[str]:
    """Extrait la liste ordonnée d'ids depuis le résultat Chroma."""
    id_lists = res.get("ids") or [[]]
    return list(id_lists[0])[:k]


def _bm25_ranking(query: str, chunks: list[dict], k: int) -> list[str]:
    if not chunks:
        return []
    corpus = [_tokenize(c["text"]) for c in chunks]
    bm25 = BM25Okapi(corpus)
    scores = bm25.get_scores(_tokenize(query))
    ranked = sorted(range(len(chunks)), key=lambda i: scores[i], reverse=True)
    return [chunks[i]["id"] for i in ranked[:k]]


def _rrf_fuse(rankings: list[list[str]], rrf_k: int) -> dict[str, float]:
    """Reciprocal Rank Fusion : agrège plusieurs classements par id."""
    fused: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, cid in enumerate(ranking):
            fused[cid] += 1.0 / (rrf_k + rank + 1)
    return fused


def _bm25_scores_cached(query: str) -> dict[str, float]:
    """Scores BM25 bruts par id (chemin caché). Vide si index absent."""
    if _bm25 is None:
        return {}
    scores = _bm25.get_scores(_tokenize(query))
    return {_bm25_ids[i]: float(scores[i]) for i in range(len(_bm25_ids))}


def _bm25_scores(query: str, chunks: list[dict]) -> dict[str, float]:
    """Scores BM25 bruts par id (chemin filtré)."""
    if not chunks:
        return {}
    bm25 = BM25Okapi([_tokenize(c["text"]) for c in chunks])
    scores = bm25.get_scores(_tokenize(query))
    return {chunks[i]["id"]: float(scores[i]) for i in range(len(chunks))}


async def hybrid_search(
    query: str,
    k_candidates: int = 20,
    filters: dict | None = None,
    debug: bool = False,
) -> list[dict]:
    """Recherche hybride : vectorielle (bge-m3) + BM25, fusionnées par RRF.

    Retourne une liste de candidats triés :
    {chunk_id, doc_id, doc_name, page, text, score}.
    Si `debug`, chaque candidat porte aussi un sous-dict `debug` avec les rangs
    et scores intermédiaires (vector_rank, vector_distance, bm25_rank,
    bm25_score, rrf_score).
    """
    settings = get_settings()

    # 1. BM25 + table de métadonnées.
    #    Chemin chaud (pas de filtre) : index BM25 en cache, réutilisé tel quel.
    #    Chemin filtré (rare) : (re)construit à la volée sur le sous-ensemble.
    if filters is None:
        await _ensure_index()
        records = _records
        if not records:
            return []
        bm25_ranking = _bm25_ranking_cached(query, k_candidates)
        bm25_scores = _bm25_scores_cached(query) if debug else {}
    else:
        all_chunks = await vectorstore.get_all_chunks(filters)
        if not all_chunks:
            return []
        records = {c["id"]: c for c in all_chunks}
        bm25_ranking = _bm25_ranking(query, all_chunks, k_candidates)
        bm25_scores = _bm25_scores(query, all_chunks) if debug else {}

    # 2. Recherche vectorielle top-N (chemin bge-m3 chaud via Ollama).
    embedding = (await embed_texts([query]))[0]
    vec_res = await vectorstore.query(embedding, k=k_candidates, filters=filters)
    vector_ranking = _vector_ranking(vec_res, k_candidates)

    # Cartes de debug (rang/score par id) construites uniquement si demandé.
    vector_rank = {cid: r for r, cid in enumerate(vector_ranking)}
    bm25_rank = {cid: r for r, cid in enumerate(bm25_ranking)}
    vector_dist: dict[str, float] = {}
    if debug:
        ids0 = (vec_res.get("ids") or [[]])[0]
        dists0 = (vec_res.get("distances") or [[]])[0]
        vector_dist = {cid: float(d) for cid, d in zip(ids0, dists0)}

    # 4. Fusion RRF des deux classements.
    fused = _rrf_fuse([vector_ranking, bm25_ranking], settings.rrf_k)
    ranked_ids = sorted(fused, key=lambda cid: fused[cid], reverse=True)[:k_candidates]

    candidates: list[dict] = []
    for cid in ranked_ids:
        rec = records.get(cid)
        if rec is None:
            continue
        meta = rec["metadata"]
        candidate = {
            "chunk_id": cid,
            "doc_id": meta.get("doc_id", ""),
            "doc_name": meta.get("doc_name", ""),
            "page": int(meta.get("page", 0)),
            "text": rec["text"],
            "score": fused[cid],
        }
        if debug:
            candidate["debug"] = {
                "vector_rank": vector_rank.get(cid),
                "vector_distance": (
                    round(vector_dist[cid], 6) if cid in vector_dist else None
                ),
                "bm25_rank": bm25_rank.get(cid),
                "bm25_score": (
                    round(bm25_scores[cid], 4) if cid in bm25_scores else None
                ),
                "rrf_score": round(fused[cid], 6),
            }
        candidates.append(candidate)

    logger.info(
        "Hybrid search : %d candidats (vector=%d, bm25=%d, fusionnés=%d)",
        len(candidates),
        len(vector_ranking),
        len(bm25_ranking),
        len(ranked_ids),
    )
    return candidates
