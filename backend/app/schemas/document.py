from pydantic import BaseModel


class DocumentOut(BaseModel):
    doc_id: str
    name: str
    pages: int
    chunks: int
    created_at: str
