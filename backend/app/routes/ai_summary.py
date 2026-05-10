from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.connection import get_db
from app.db import crud

router = APIRouter(prefix="/api/ai-summary", tags=["AI Summary"])

# ---------------------------------------------------------------------------
# AI summary cache (keyed by session_id)
# ---------------------------------------------------------------------------

_summary_store: OrderedDict = OrderedDict()
_summary_lock = Lock()
_SUMMARY_MAX = 50


def _summary_get(session_id: str):
    with _summary_lock:
        if session_id not in _summary_store:
            return None
        _summary_store.move_to_end(session_id)
        return _summary_store[session_id]


def _summary_put(session_id: str, value) -> None:
    with _summary_lock:
        if session_id in _summary_store:
            _summary_store.move_to_end(session_id)
        _summary_store[session_id] = value
        if len(_summary_store) > _SUMMARY_MAX:
            _summary_store.popitem(last=False)


def _summary_invalidate(session_id: str) -> None:
    with _summary_lock:
        _summary_store.pop(session_id, None)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class AiSummaryRequest(BaseModel):
    summary: str
    config: dict | None = None


@router.get("/{session_id}")
def get_ai_summary(session_id: str, db: Session = Depends(get_db)):
    cached = _summary_get(session_id)
    if cached is not None:
        return cached

    record = crud.get_ai_summary_by_session(db, session_id)
    if not record:
        result = {
            "success": False,
            "session_id": session_id,
            "summary": "",
            "config": {},
        }
    else:
        result = {
            "success": True,
            "session_id": record.session_id,
            "summary": record.summary,
            "config": record.config or {},
        }
    _summary_put(session_id, result)
    return result


@router.post("/{session_id}")
def save_ai_summary(
    session_id: str,
    request: AiSummaryRequest,
    db: Session = Depends(get_db),
):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    _summary_invalidate(session_id)

    record = crud.upsert_ai_summary(
        db=db,
        file_id=file_record.id,
        session_id=session_id,
        summary=request.summary,
        config=request.config or {},
    )
    return {
        "success": True,
        "session_id": record.session_id,
        "summary": record.summary,
        "config": record.config or {},
    }
