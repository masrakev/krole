"""Extraction d'un graphe de connaissances depuis les chunks via Mistral (Ollama).

Pour chaque chunk on demande au LLM des entités + relations en JSON STRICT, on
parse défensivement (jamais d'exception qui casse l'ingestion), puis on fusionne
dans le store SQLite (`graph_store`).
"""

import json
from collections.abc import Awaitable, Callable

from app.core.logging import get_logger
from app.services import graph_store
from app.services.graph_store import ALLOWED_TYPES
from app.services.ollama_client import OllamaClient, OllamaUnreachableError

logger = get_logger(__name__)

_SYSTEM = (
    "Tu es un extracteur d'entités et de relations pour un graphe de "
    "connaissances. Tu réponds UNIQUEMENT par un objet JSON valide, sans aucun "
    "texte autour ni balise de code."
)

_INSTRUCTIONS = (
    "Extrais les entités et relations du TEXTE ci-dessous.\n"
    "Types d'entités autorisés : person, org, place, date, concept, other.\n"
    "Réponds STRICTEMENT au format JSON suivant :\n"
    '{"entities":[{"name":"...","type":"..."}],'
    '"relations":[{"source":"...","target":"...","label":"..."}]}\n'
    "- name : forme courte et canonique de l'entité.\n"
    "- relations : source et target DOIVENT être des noms figurant dans entities ; "
    "label est un verbe ou une relation courte.\n"
    "- N'invente rien ; reste fidèle au texte. Garde les noms dans la langue du texte.\n"
    "- Si aucune entité, réponds {\"entities\":[],\"relations\":[]}.\n\n"
    "TEXTE :\n"
)


def _strip_fences(raw: str) -> str:
    """Retire d'éventuelles balises de code et isole le premier objet JSON."""
    text = raw.strip()
    if text.startswith("```"):
        # Retire ```json ... ``` ou ``` ... ```
        text = text.split("```", 2)[-1] if text.count("```") >= 2 else text.strip("`")
        text = text.strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    return text


def parse_extraction(raw: str) -> tuple[list[dict], list[dict]]:
    """Parse défensif de la sortie LLM → (entities, relations). Jamais d'exception."""
    if not raw or not raw.strip():
        return [], []
    try:
        data = json.loads(_strip_fences(raw))
    except (json.JSONDecodeError, ValueError):
        logger.warning("Extraction : JSON illisible, chunk ignoré.")
        return [], []
    if not isinstance(data, dict):
        return [], []

    entities: list[dict] = []
    for ent in data.get("entities") or []:
        if not isinstance(ent, dict):
            continue
        name = str(ent.get("name", "")).strip()
        if not name:
            continue
        type_ = str(ent.get("type", "other")).strip().lower()
        entities.append({"name": name, "type": type_ if type_ in ALLOWED_TYPES else "other"})

    relations: list[dict] = []
    for rel in data.get("relations") or []:
        if not isinstance(rel, dict):
            continue
        source = str(rel.get("source", "")).strip()
        target = str(rel.get("target", "")).strip()
        label = str(rel.get("label", "")).strip()
        if source and target:
            relations.append({"source": source, "target": target, "label": label})

    return entities, relations


async def extract_chunk(text: str) -> tuple[list[dict], list[dict]]:
    """Extrait entités + relations d'un seul chunk via Mistral (sortie JSON)."""
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _INSTRUCTIONS + text},
    ]
    client = OllamaClient()
    raw = await client.generate(messages, fmt="json", options={"temperature": 0})
    return parse_extraction(raw)


async def extract_doc(
    doc_id: str,
    doc_name: str,
    chunks: list[dict],
    progress: Callable[[int, int], Awaitable[None]] | None = None,
) -> dict:
    """Extrait et persiste le graphe d'un document (séquentiel, tolérant aux erreurs).

    `chunks` : liste de {id, text, metadata{page,...}} (format Chroma / chunking).
    Retourne un petit récapitulatif {chunks, processed}.
    """
    total = len(chunks)
    processed = 0
    logger.info("Graphe : extraction de '%s' (%d chunk(s))…", doc_name, total)

    for i, chunk in enumerate(chunks, start=1):
        chunk_id = chunk.get("id", "")
        page = int((chunk.get("metadata") or {}).get("page", 0))
        text = chunk.get("text", "")
        if not text.strip() or not chunk_id:
            continue
        try:
            entities, relations = await extract_chunk(text)
            await graph_store.add_chunk_extraction(
                doc_id, chunk_id, page, entities, relations
            )
            processed += 1
        except OllamaUnreachableError as exc:
            logger.warning("Graphe : Ollama injoignable sur un chunk (%s) — passé.", exc)
        except Exception:  # noqa: BLE001 — ne JAMAIS casser le pipeline d'ingestion
            logger.exception("Graphe : échec d'extraction d'un chunk — passé.")

        if i % 5 == 0 or i == total:
            logger.info("Graphe '%s' : %d/%d chunk(s)", doc_name, i, total)
        if progress is not None:
            await progress(i, total)

    logger.info("Graphe : '%s' terminé (%d/%d traités).", doc_name, processed, total)
    return {"chunks": total, "processed": processed}
