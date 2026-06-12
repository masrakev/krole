from pydantic import BaseModel


class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    count: int


class GraphEdge(BaseModel):
    source: str
    target: str
    label: str
    weight: int


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class EntityChunk(BaseModel):
    doc_id: str
    doc_name: str
    page: int
    chunk_id: str
    text: str


class RebuildSummary(BaseModel):
    documents: int
    nodes: int
    edges: int
    chunks: int
