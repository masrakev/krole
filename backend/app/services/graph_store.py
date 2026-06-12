"""Persistance du graphe de connaissances dans SQLite (sur le volume `/data`).

Schéma :
- nodes(id, label, type, count)            — entités canoniques
- edges(source_id, target_id, label, weight) — relations agrégées
- node_chunks(node_id, doc_id, chunk_id, page) — provenance (quels chunks mentionnent l'entité)

Toutes les écritures/lectures SQLite sont synchrones et exécutées dans un thread
(`asyncio.to_thread`) pour ne pas bloquer la boucle async, comme le client Chroma.
"""

import asyncio
import os
import sqlite3
from contextlib import closing

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

ALLOWED_TYPES = {"person", "org", "place", "date", "concept", "other"}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS nodes (
    id    TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    type  TEXT NOT NULL DEFAULT 'other',
    count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    label     TEXT NOT NULL,
    weight    INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (source_id, target_id, label)
);
CREATE TABLE IF NOT EXISTS node_chunks (
    node_id  TEXT NOT NULL,
    doc_id   TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    page     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (node_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS ix_node_chunks_node ON node_chunks(node_id);
CREATE INDEX IF NOT EXISTS ix_node_chunks_doc  ON node_chunks(doc_id);
"""


def canonical_key(name: str) -> str:
    """Clé canonique d'une entité : minuscule, sans espaces superflus."""
    return " ".join(name.strip().lower().split())


def _normalize_type(value: str) -> str:
    t = (value or "").strip().lower()
    return t if t in ALLOWED_TYPES else "other"


def _connect() -> sqlite3.Connection:
    settings = get_settings()
    path = settings.graph_db_path
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    conn = sqlite3.connect(path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=10000;")
    conn.executescript(_SCHEMA)
    return conn


# --- Écritures -------------------------------------------------------------


def _upsert_node(conn: sqlite3.Connection, key: str, label: str, type_: str) -> None:
    # Le label est conservé tel qu'observé la première fois ; le type peut être
    # précisé si l'on passe de 'other' à un type plus spécifique.
    conn.execute(
        """
        INSERT INTO nodes (id, label, type, count) VALUES (?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
            type = CASE
                WHEN nodes.type = 'other' AND excluded.type != 'other'
                THEN excluded.type ELSE nodes.type END
        """,
        (key, label, type_),
    )


def _add_chunk_extraction(
    doc_id: str,
    chunk_id: str,
    page: int,
    entities: list[dict],
    relations: list[dict],
) -> None:
    """Fusionne l'extraction d'UN chunk dans le graphe (transaction atomique)."""
    with closing(_connect()) as conn, conn:
        # Entités locales à ce chunk : clé canonique -> (label, type).
        local: dict[str, tuple[str, str]] = {}
        for ent in entities:
            name = str(ent.get("name", "")).strip()
            key = canonical_key(name)
            if not key:
                continue
            local[key] = (name, _normalize_type(str(ent.get("type", "other"))))

        for key, (label, type_) in local.items():
            _upsert_node(conn, key, label, type_)
            cur = conn.execute(
                "INSERT OR IGNORE INTO node_chunks (node_id, doc_id, chunk_id, page) "
                "VALUES (?, ?, ?, ?)",
                (key, doc_id, chunk_id, int(page)),
            )
            # Compte = nombre de chunks distincts mentionnant l'entité.
            if cur.rowcount == 1:
                conn.execute(
                    "UPDATE nodes SET count = count + 1 WHERE id = ?", (key,)
                )

        # Relations : uniquement entre entités présentes dans CE chunk.
        for rel in relations:
            sc = canonical_key(str(rel.get("source", "")))
            tc = canonical_key(str(rel.get("target", "")))
            label = str(rel.get("label", "")).strip() or "lié à"
            if sc and tc and sc != tc and sc in local and tc in local:
                conn.execute(
                    """
                    INSERT INTO edges (source_id, target_id, label, weight)
                    VALUES (?, ?, ?, 1)
                    ON CONFLICT(source_id, target_id, label)
                    DO UPDATE SET weight = weight + 1
                    """,
                    (sc, tc, label[:80]),
                )


def _clear_all() -> None:
    with closing(_connect()) as conn, conn:
        conn.execute("DELETE FROM edges")
        conn.execute("DELETE FROM node_chunks")
        conn.execute("DELETE FROM nodes")


def _remove_doc(doc_id: str) -> None:
    """Retire la contribution d'un document (au moment d'une suppression)."""
    with closing(_connect()) as conn, conn:
        affected = [
            r["node_id"]
            for r in conn.execute(
                "SELECT DISTINCT node_id FROM node_chunks WHERE doc_id = ?", (doc_id,)
            )
        ]
        conn.execute("DELETE FROM node_chunks WHERE doc_id = ?", (doc_id,))
        for node_id in affected:
            conn.execute(
                "UPDATE nodes SET count = "
                "(SELECT COUNT(*) FROM node_chunks WHERE node_id = ?) WHERE id = ?",
                (node_id, node_id),
            )
        conn.execute("DELETE FROM nodes WHERE count = 0")
        # Élague les arêtes devenues orphelines.
        conn.execute(
            "DELETE FROM edges WHERE source_id NOT IN (SELECT id FROM nodes) "
            "OR target_id NOT IN (SELECT id FROM nodes)"
        )


# --- Lectures --------------------------------------------------------------


def _get_graph(doc_id: str | None) -> dict:
    with closing(_connect()) as conn:
        if doc_id:
            node_rows = conn.execute(
                "SELECT n.id, n.label, n.type, n.count FROM nodes n "
                "WHERE n.id IN (SELECT node_id FROM node_chunks WHERE doc_id = ?) "
                "ORDER BY n.count DESC",
                (doc_id,),
            ).fetchall()
        else:
            node_rows = conn.execute(
                "SELECT id, label, type, count FROM nodes ORDER BY count DESC"
            ).fetchall()

        ids = {r["id"] for r in node_rows}
        nodes = [
            {"id": r["id"], "label": r["label"], "type": r["type"], "count": r["count"]}
            for r in node_rows
        ]

        # Arêtes dont les DEUX extrémités font partie de l'ensemble de nœuds.
        edges = [
            {
                "source": r["source_id"],
                "target": r["target_id"],
                "label": r["label"],
                "weight": r["weight"],
            }
            for r in conn.execute(
                "SELECT source_id, target_id, label, weight FROM edges"
            ).fetchall()
            if r["source_id"] in ids and r["target_id"] in ids
        ]
    return {"nodes": nodes, "edges": edges}


def _get_entity_chunks(node_id: str) -> list[dict]:
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT doc_id, chunk_id, page FROM node_chunks WHERE node_id = ? "
            "ORDER BY doc_id, page",
            (node_id,),
        ).fetchall()
    return [
        {"doc_id": r["doc_id"], "chunk_id": r["chunk_id"], "page": r["page"]}
        for r in rows
    ]


def _stats() -> dict:
    with closing(_connect()) as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM nodes").fetchone()["c"]
        e = conn.execute("SELECT COUNT(*) AS c FROM edges").fetchone()["c"]
    return {"nodes": n, "edges": e}


# --- API async -------------------------------------------------------------


def _init() -> None:
    with closing(_connect()):
        pass


async def init_db() -> None:
    await asyncio.to_thread(_init)


async def add_chunk_extraction(
    doc_id: str, chunk_id: str, page: int, entities: list[dict], relations: list[dict]
) -> None:
    await asyncio.to_thread(
        _add_chunk_extraction, doc_id, chunk_id, page, entities, relations
    )


async def clear_all() -> None:
    await asyncio.to_thread(_clear_all)


async def remove_doc(doc_id: str) -> None:
    await asyncio.to_thread(_remove_doc, doc_id)


async def get_graph(doc_id: str | None = None) -> dict:
    return await asyncio.to_thread(_get_graph, doc_id)


async def get_entity_chunks(node_id: str) -> list[dict]:
    return await asyncio.to_thread(_get_entity_chunks, node_id)


async def stats() -> dict:
    return await asyncio.to_thread(_stats)
