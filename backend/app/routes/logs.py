"""
Preprocessing audit log endpoints.

POST /api/logs/preprocessing
  Receives one or more log entries from the frontend after each step is applied.
  - Low-risk ops  → template-based reason (no AI call)
  - Medium/high   → 1-sentence AI-generated reason
  Stores each entry in preprocessing_logs with file_id + user_id resolved from
  the session record.

GET /api/logs/preprocessing/{session_id}
  Returns all log entries for a session, ordered by applied_at.
"""

from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from app.db.connection import get_db
from app.db import crud
import logging
import json

router = APIRouter(prefix="/api/logs", tags=["Logs"])
logger = logging.getLogger("uvicorn.error")

# ---------------------------------------------------------------------------
# Preprocessing logs cache (keyed by session_id)
# ---------------------------------------------------------------------------

_logs_store: OrderedDict = OrderedDict()
_logs_lock = Lock()
_LOGS_MAX = 50


def _logs_get(session_id: str):
    with _logs_lock:
        if session_id not in _logs_store:
            return None
        _logs_store.move_to_end(session_id)
        return _logs_store[session_id]


def _logs_put(session_id: str, value) -> None:
    with _logs_lock:
        if session_id in _logs_store:
            _logs_store.move_to_end(session_id)
        _logs_store[session_id] = value
        if len(_logs_store) > _LOGS_MAX:
            _logs_store.popitem(last=False)


def _logs_invalidate(session_id: str) -> None:
    with _logs_lock:
        _logs_store.pop(session_id, None)


def invalidate_logs_cache(session_id: str) -> None:
    """Public entry point — call this from any route that deletes logs."""
    _logs_invalidate(session_id)


# ---------------------------------------------------------------------------
# Risk / issue defaults per operation type
# ---------------------------------------------------------------------------

_DEFAULT_RISK: Dict[str, str] = {
    "impute": "low",
    "fill_nulls": "low",
    "trim_whitespace": "low",
    "lowercase": "low",
    "uppercase": "low",
    "normalize_case": "low",
    "type_conversion": "low",
    "convert_type": "low",
    "normalize_date": "low",
    "validate_regex": "low",
    "type_inconsistency": "low",
    "deduplicate": "medium",
    "outlier": "medium",
    "cap_outliers": "medium",
    "remove_outliers": "high",
    "duplicates": "medium",
    "drop_column": "high",
    "delete_rows": "high",
    "cell_update": "low",
    "add_column": "low",
    "add_rows": "low",
}

_DEFAULT_ISSUE: Dict[str, str] = {
    "impute": "missing_values",
    "fill_nulls": "missing_values",
    "drop_nulls": "missing_values",
    "outlier": "outliers",
    "cap_outliers": "outliers",
    "remove_outliers": "outliers",
    "duplicates": "duplicates",
    "deduplicate": "duplicates",
    "type_conversion": "type_mismatch",
    "convert_type": "type_mismatch",
    "type_inconsistency": "type_inconsistencies",
    "normalize_case": "type_inconsistencies",
    "trim_whitespace": "format",
    "lowercase": "format",
    "uppercase": "format",
    "normalize_date": "date_format",
    "validate_regex": "format",
    "drop_column": "user_action",
    "delete_rows": "user_action",
    "cell_update": "user_action",
    "add_column": "user_action",
    "add_rows": "user_action",
}


# ---------------------------------------------------------------------------
# Template-based reasoning (low-risk — no AI needed)
# ---------------------------------------------------------------------------

def _apply_template(operation: str, column_name: str, parameters: dict) -> Optional[str]:
    op = operation.lower()
    params = parameters or {}
    method = params.get("strategy") or params.get("method") or ""
    target_type = params.get("target_type") or params.get("new_type") or params.get("targetType") or ""
    target_format = params.get("target_format") or "YYYY-MM-DD"

    if op in ("impute", "fill_nulls"):
        return f"Impute missing values in {column_name} using {method or 'default'} to avoid gaps in analysis"
    if op == "drop_nulls":
        return f"Remove rows with missing values in {column_name} to ensure data integrity"
    if op == "trim_whitespace":
        return f"Remove leading/trailing whitespace in {column_name} for consistency"
    if op in ("lowercase", "uppercase", "normalize_case", "type_inconsistency"):
        return f"Standardize text in {column_name} for consistent formatting"
    if op in ("type_conversion", "convert_type"):
        return f"Convert {column_name} to {target_type or 'target type'} to ensure correct data type"
    if op == "normalize_date":
        return f"Normalize dates in {column_name} to {target_format}"
    if op == "validate_regex":
        pattern = params.get("pattern_type") or "standard format"
        return f"Validate {column_name} entries against {pattern} pattern for data integrity"
    if op == "cell_update":
        return f"User manually edited a value in {column_name} for data correction"
    if op == "add_column":
        col_type = params.get("column_type", "text")
        return f"User added a new {col_type} column '{column_name}' to the dataset"
    if op == "add_rows":
        row_count = params.get("row_count", 1)
        return f"User added {row_count} new row{'s' if row_count != 1 else ''} to the dataset"
    if op == "drop_column":
        return f"User removed column '{column_name}' from the dataset"
    return None


# ---------------------------------------------------------------------------
# AI-generated reasoning (medium / high risk)
# ---------------------------------------------------------------------------

async def _generate_reason(operation: str, column_name: str, parameters: dict, original_issue: str) -> str:
    from app.routes.ai import _ai_generate

    param_str = json.dumps(parameters or {})
    prompt = (
        "You are a Data Preprocessing Log Reasoning Assistant.\n"
        "Generate a 1-2 sentence concise human-readable reason for the following preprocessing operation.\n"
        "Be specific about why this operation was applied based on the detected issue.\n"
        "Return ONLY the reason text — no JSON, no markdown, no preamble.\n\n"
        f"Column: {column_name}\n"
        f"Operation: {operation}\n"
        f"Parameters: {param_str}\n"
        f"Detected issue: {original_issue or 'data quality issue'}\n"
    )
    try:
        text_out, _ = _ai_generate(prompt)
        if text_out and text_out.strip():
            return text_out.strip()[:500]
    except Exception:
        logger.exception("Log reasoning AI call failed for op=%s col=%s", operation, column_name)

    return f"Applied {operation} on {column_name} to address detected {original_issue or 'data quality issues'}."


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class LogEntry(BaseModel):
    column_name: str
    operation: str
    parameters: Dict[str, Any] = {}
    confidence: Optional[float] = None
    risk_level: Optional[str] = None
    original_issue: Optional[str] = None
    reason: Optional[str] = None
    user: Optional[str] = None


class AddLogsRequest(BaseModel):
    session_id: str
    logs: List[LogEntry]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/preprocessing")
async def add_preprocessing_logs(request: AddLogsRequest, db: Session = Depends(get_db)):
    session_id = request.session_id

    _logs_invalidate(session_id)

    file_id: Optional[int] = None
    user_id: Optional[int] = None
    try:
        session_rec = crud.get_session_record(db, session_id)
        if session_rec:
            file_id = session_rec.file_id
            if session_rec.user_id:
                try:
                    user_id = int(session_rec.user_id)
                except (ValueError, TypeError):
                    user_id = None
    except Exception:
        logger.exception("Could not resolve session record for logging: %s", session_id)

    created_ids: List[int] = []

    for entry in request.logs:
        op = entry.operation.lower()
        risk_level = entry.risk_level or _DEFAULT_RISK.get(op, "medium")
        original_issue = entry.original_issue or _DEFAULT_ISSUE.get(op, "")

        reason = entry.reason
        if not reason:
            if risk_level == "low":
                reason = _apply_template(entry.operation, entry.column_name, entry.parameters)
            if not reason:
                reason = await _generate_reason(
                    entry.operation, entry.column_name, entry.parameters, original_issue
                )

        log = crud.create_preprocessing_log(
            db,
            session_id=session_id,
            file_id=file_id,
            user_id=user_id,
            column_name=entry.column_name,
            operation=entry.operation,
            parameters=entry.parameters,
            confidence=entry.confidence,
            risk_level=risk_level,
            original_issue=original_issue,
            reason=reason,
            user=entry.user,
        )
        created_ids.append(log.id)

    return {"success": True, "created": len(created_ids)}


@router.get("/preprocessing/{session_id}")
async def get_preprocessing_logs(session_id: str, db: Session = Depends(get_db)):
    cached = _logs_get(session_id)
    if cached is not None:
        return {"success": True, "logs": cached}

    logs = crud.get_preprocessing_logs(db, session_id)
    result = [
        {
            "id": log.id,
            "session_id": log.session_id,
            "file_id": log.file_id,
            "user_id": log.user_id,
            "column_name": log.column_name,
            "operation": log.operation,
            "parameters": log.parameters,
            "applied_at": log.applied_at.isoformat() if log.applied_at else None,
            "confidence": log.confidence,
            "risk_level": log.risk_level,
            "original_issue": log.original_issue,
            "reason": log.reason,
            "user": log.user,
        }
        for log in logs
    ]
    _logs_put(session_id, result)
    return {"success": True, "logs": result}
