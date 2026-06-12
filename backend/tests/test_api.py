"""Tests d'API — health, documents, et un smoke test RAG/chat.

Tous les appels modèle/LLM (Ollama, Chroma, Whisper, Piper, RAGAS) sont MOCKÉS :
la CI tourne sans Ollama ni modèles téléchargés. Le TestClient est instancié
SANS gestionnaire de contexte, donc le lifespan (warmup des modèles) n'est pas
déclenché.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_list_documents_mocked():
    docs = [
        {
            "doc_id": "d1",
            "name": "spark.pdf",
            "pages": 23,
            "chunks": 36,
            "created_at": "2026-01-01T00:00:00+00:00",
        }
    ]
    with patch(
        "app.routers.documents.vectorstore.list_documents",
        new=AsyncMock(return_value=docs),
    ):
        res = client.get("/api/documents")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["doc_id"] == "d1"
    assert body[0]["chunks"] == 36


def test_rag_chat_smoke_mocked():
    """Le pipeline RAG complet est remplacé par un générateur factice."""

    async def fake_run_rag(messages, debug=False):
        yield "rewrite", {"query": "spark"}
        yield "retrieval", {"candidates": []}
        yield "token", {"text": "Spark "}
        yield "token", {"text": "est un moteur de calcul distribué."}
        yield "sources", {
            "sources": [
                {
                    "id": "c1",
                    "doc_id": "d1",
                    "doc_name": "spark.pdf",
                    "page": 1,
                    "text": "Apache Spark…",
                }
            ]
        }
        yield "done", {"generation_ms": 5}

    with patch("app.routers.rag.run_rag", new=fake_run_rag):
        res = client.post(
            "/api/rag/chat",
            json={"messages": [{"role": "user", "content": "qu'est-ce que Spark ?"}]},
        )
        assert res.status_code == 200
        body = res.text

    assert "event: token" in body
    assert "Spark" in body
    assert "event: sources" in body
    assert "event: done" in body


def test_plain_chat_smoke_mocked():
    """Chat sans RAG : on mocke OllamaClient.chat_stream."""

    async def fake_chat_stream(messages, options=None, stats=None):
        for token in ["Bonjour", " le", " monde"]:
            yield token

    with patch("app.routers.chat.OllamaClient") as mock_client:
        instance = MagicMock()
        instance.chat_stream = fake_chat_stream
        mock_client.return_value = instance
        res = client.post(
            "/api/chat",
            json={"messages": [{"role": "user", "content": "salut"}]},
        )
        assert res.status_code == 200
        body = res.text

    assert "Bonjour" in body
    assert "[DONE]" in body


def test_rag_chat_rejects_empty_messages():
    res = client.post("/api/rag/chat", json={"messages": []})
    assert res.status_code == 422  # validation Pydantic (min_length=1)
