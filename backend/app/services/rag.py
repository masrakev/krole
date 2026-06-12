import time
from collections.abc import AsyncIterator

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services import reranker, retrieval
from app.services.llm.factory import get_llm_provider
from app.services.query_rewriter import rewrite_query

logger = get_logger(__name__)

GUARDRAIL_MESSAGE = (
    "Je ne peux pas répondre à partir des documents fournis."
)

# Longueur max d'un extrait renvoyé dans l'event `retrieval` (UX, pas le texte complet).
_SNIPPET_LEN = 240


def _build_context(blocks_in: list[dict], char_cap: int) -> str:
    """Construit les blocs de contexte numérotés [1]..[k].

    Chaque bloc est tronqué à `char_cap` caractères : sur CPU, l'évaluation du
    prompt domine la latence, donc on borne la taille du contexte injecté.
    """
    blocks = []
    for i, c in enumerate(blocks_in, start=1):
        header = f"[{i}] {c['doc_name']} (p.{c['page']})"
        text = c["text"][:char_cap]
        blocks.append(f"{header}\n{text}")
    return "\n\n".join(blocks)


def _aligned_num_ctx(messages: list[dict], num_predict: int, ceiling: int) -> int:
    """Plus petite puissance de 2 couvrant (prompt estimé + génération).

    Évite de sur-allouer num_ctx (2048) quand le prompt fait ~700 tokens :
    chaque token du contexte alloué pèse sur l'évaluation CPU. Estimation
    grossière ~3,5 caractères/token, plus une marge.
    """
    prompt_chars = sum(len(m["content"]) for m in messages)
    need = int(prompt_chars / 3.5) + num_predict + 64
    size = 512
    while size < need:
        size *= 2
    return min(ceiling, size)


async def run_rag(
    messages: list[dict[str, str]], debug: bool = False
) -> AsyncIterator[tuple[str, dict]]:
    """Pipeline RAG complet, en générateur d'étapes (event, data).

    Events émis dans l'ordre : rewrite, retrieval, rerank, token*, sources, done.
    En cas de garde-fou : token (message) puis done (sans sources).
    Si `debug`, l'event `done` porte un sous-dict `debug` : prompt assemblé,
    chunks récupérés avec tous leurs scores (vector/BM25/RRF/rerank), token counts.
    """
    settings = get_settings()
    pipeline_start = time.perf_counter()

    # Dernière question utilisateur + historique précédent.
    user_messages = [m for m in messages if m.get("role") == "user"]
    question = user_messages[-1]["content"] if user_messages else ""
    history = messages[:-1] if messages else []

    # --- 1. Réécriture de la requête ---------------------------------------
    # On ne réécrit QUE s'il y a un historique à désambiguïser (pronoms, sujet
    # implicite). Sans historique, la réécriture n'apporte rien et coûte un appel
    # LLM lent sur CPU (10–70 s) : on saute pour réduire le temps jusqu'au 1er token.
    # En profil démo (rerank désactivé), on saute la réécriture dans tous les cas :
    # priorité au temps de réponse.
    t0 = time.perf_counter()
    do_rewrite = bool(history) and settings.rerank_enabled
    if do_rewrite:
        rewritten = await rewrite_query(question, history)
    else:
        rewritten = question
    rewrite_ms = round((time.perf_counter() - t0) * 1000)
    logger.info(
        "Étape rewrite : %d ms%s", rewrite_ms, "" if do_rewrite else " (sautée)"
    )
    yield "rewrite", {"query": rewritten}

    # --- 2. Recherche hybride ---------------------------------------------
    t0 = time.perf_counter()
    candidates = await retrieval.hybrid_search(
        rewritten, k_candidates=settings.k_candidates, debug=debug
    )
    retrieval_ms = round((time.perf_counter() - t0) * 1000)
    logger.info("Étape retrieval : %d ms", retrieval_ms)
    # ms portés sur l'event (champs optionnels, rétro-compatibles).
    yield "retrieval", {
        "rewrite_ms": rewrite_ms,
        "retrieval_ms": retrieval_ms,
        "candidates": [
            {
                "doc_name": c["doc_name"],
                "page": c["page"],
                "score": round(c["score"], 6),
                "snippet": c["text"][:_SNIPPET_LEN],
            }
            for c in candidates
        ],
    }

    # --- 3. Rerank ---------------------------------------------------------
    # Profil démo (rerank désactivé) : on garde directement les top_k candidats
    # de la fusion RRF. Économise ~20 s/requête + ~2,3 Go de RAM. Le garde-fou,
    # qui s'appuie sur le score normalisé du cross-encoder, est alors inactif.
    t0 = time.perf_counter()
    if settings.rerank_enabled:
        top = await reranker.rerank(rewritten, candidates, top_k=settings.top_k)
    else:
        top = candidates[: settings.top_k]
    rerank_ms = round((time.perf_counter() - t0) * 1000)
    logger.info(
        "Étape rerank : %d ms%s", rerank_ms, "" if settings.rerank_enabled else " (sautée)"
    )
    # En debug, on mémorise le score de rerank par chunk (None si rerank désactivé).
    if debug and settings.rerank_enabled:
        rerank_scores = {c["chunk_id"]: round(c["score"], 6) for c in top}
        for c in candidates:
            if "debug" in c:
                c["debug"]["rerank_score"] = rerank_scores.get(c["chunk_id"])
    elif debug:
        for c in candidates:
            if "debug" in c:
                c["debug"]["rerank_score"] = None
    yield "rerank", {
        "rerank_ms": rerank_ms,
        "top": [
            {
                "id": c["chunk_id"],
                "doc_name": c["doc_name"],
                "page": c["page"],
                "score": round(c["score"], 6),
            }
            for c in top
        ],
    }

    # --- 4. Garde-fou (uniquement si le rerank fournit un score fiable) ----
    if settings.rerank_enabled:
        best = top[0]["score"] if top else 0.0
        if not top or best < settings.rerank_threshold:
            logger.info(
                "Garde-fou déclenché (meilleur score=%.4f < seuil=%.4f)",
                best,
                settings.rerank_threshold,
            )
            yield "token", {"text": GUARDRAIL_MESSAGE}
            total_ms = round((time.perf_counter() - pipeline_start) * 1000)
            logger.info(
                "Pipeline (garde-fou) : rewrite=%dms retrieval=%dms rerank=%dms "
                "generation=0ms total=%dms",
                rewrite_ms,
                retrieval_ms,
                rerank_ms,
                total_ms,
            )
            yield "done", {"generation_ms": 0}
            return
    elif not top:
        # Sans rerank, le seul garde-fou est l'absence totale de candidat.
        yield "token", {"text": GUARDRAIL_MESSAGE}
        total_ms = round((time.perf_counter() - pipeline_start) * 1000)
        logger.info(
            "Pipeline (garde-fou) : rewrite=%dms retrieval=%dms rerank=%dms "
            "generation=0ms total=%dms",
            rewrite_ms,
            retrieval_ms,
            rerank_ms,
            total_ms,
        )
        yield "done", {"generation_ms": 0}
        return

    # --- 5. Construction du prompt ----------------------------------------
    # On n'injecte QUE les context_k meilleurs blocs (pas les top_k candidats) :
    # les citations [n] et les sources renvoyées portent sur ces blocs.
    context_chunks = top[: settings.context_k]
    context = _build_context(context_chunks, settings.context_char_cap)
    user_prompt = (
        f"Contexte:\n{context}\n\n"
        f"Question: {question}\n\n"
        "Réponds en citant les sources avec [n]."
    )
    gen_messages = [
        {"role": "system", "content": settings.rag_system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    # --- 6. Génération en streaming ---------------------------------------
    # Le fournisseur est choisi par LLM_PROVIDER (mistral local par défaut).
    # num_predict/num_ctx sont des réglages CPU Ollama : les fournisseurs cloud
    # les ignorent. Le 1er token est relayé dès son émission (yield immédiat).
    num_ctx = _aligned_num_ctx(gen_messages, settings.num_predict, settings.num_ctx)
    provider = get_llm_provider()
    stats: dict = {}
    t0 = time.perf_counter()
    async for token in provider.chat_stream(
        gen_messages,
        options={"num_predict": settings.num_predict, "num_ctx": num_ctx},
        stats=stats,
    ):
        yield "token", {"text": token}
    generation_ms = round((time.perf_counter() - t0) * 1000)

    # Métriques réelles rapportées par Ollama (durées en ns → ms). Les
    # fournisseurs cloud n'en exposent pas : stats reste vide, compteurs à 0.
    prompt_tokens = stats.get("prompt_eval_count", 0)
    prompt_eval_ms = round(stats.get("prompt_eval_duration", 0) / 1e6)
    eval_tokens = stats.get("eval_count", 0)
    eval_ms = round(stats.get("eval_duration", 0) / 1e6)
    logger.info(
        "Génération (%s/%s) : prompt_tokens=%d prompt_eval=%dms generation=%dms "
        "(num_ctx=%d, gen_tokens=%d, gen=%dms)",
        provider.name,
        provider.model,
        prompt_tokens,
        prompt_eval_ms,
        generation_ms,
        num_ctx,
        eval_tokens,
        eval_ms,
    )
    total_ms = round((time.perf_counter() - pipeline_start) * 1000)
    logger.info(
        "Pipeline : rewrite=%dms retrieval=%dms rerank=%dms generation=%dms "
        "total=%dms",
        rewrite_ms,
        retrieval_ms,
        rerank_ms,
        generation_ms,
        total_ms,
    )

    # --- Sources (texte complet des blocs cités) --------------------------
    yield "sources", {
        "sources": [
            {
                "id": c["chunk_id"],
                "doc_id": c["doc_id"],
                "doc_name": c["doc_name"],
                "page": c["page"],
                "text": c["text"],
            }
            for c in context_chunks
        ]
    }

    # Fournisseur actif porté sur l'event done : l'UI peut afficher honnêtement
    # quel moteur a rédigé la réponse (local vs cloud).
    done_data: dict = {
        "generation_ms": generation_ms,
        "provider": {
            "name": provider.name,
            "model": provider.model,
            "local": provider.is_local,
        },
    }
    if debug:
        used_ids = {c["chunk_id"] for c in context_chunks}
        done_data["debug"] = {
            "prompt": {
                "system": settings.rag_system_prompt,
                "user": user_prompt,
                "full": f"[system]\n{settings.rag_system_prompt}\n\n[user]\n{user_prompt}",
            },
            "chunks": [
                {
                    "chunk_id": c["chunk_id"],
                    "doc_name": c["doc_name"],
                    "page": c["page"],
                    "snippet": c["text"][:_SNIPPET_LEN],
                    "used": c["chunk_id"] in used_ids,
                    **c.get("debug", {}),
                }
                for c in candidates
            ],
            "tokens": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": eval_tokens,
                "num_ctx": num_ctx,
            },
        }
    yield "done", done_data
