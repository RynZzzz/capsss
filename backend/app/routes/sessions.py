from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Any, Dict, List, Optional

from app.db.connection import get_db
from app.db import crud
from app.utils.helpers import sanitize_data
from app.services.file_parser import read_csv, read_excel

router = APIRouter(prefix="/api", tags=["Sessions"])


class StepsRequest(BaseModel):
    steps: List[Dict[str, Any]]
    user_id: Optional[str] = None
    file_id: Optional[int] = None
    allow_empty: bool = False


class ReplayRequest(BaseModel):
    step_index: int


class SessionSnapshotRequest(BaseModel):
    steps: Optional[List[Dict[str, Any]]] = None
    data: Optional[List[Dict[str, Any]]] = None
    columns: Optional[List[Dict[str, Any]]] = None
    rows: Optional[List[Dict[str, Any]]] = None
    applied_steps: Optional[List[Dict[str, Any]]] = None
    user_id: Optional[str] = None
    file_id: Optional[int] = None
    allow_empty: bool = False


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, db: Session = Depends(get_db)):
    record = crud.get_session_record(db, session_id)
    file_record = crud.get_file_by_session(db, session_id)
    file_id = file_record.id if file_record else None
    if not record:
        return JSONResponse({
            "success": True,
            "session_id": session_id,
            "applied_steps": [],
            "file_id": file_id,
        })
    return JSONResponse(
        sanitize_data(
            {
                "success": True,
                "session_id": record.id,
                "file_id": record.file_id or file_id,
                "applied_steps": record.applied_steps or [],
                "updated_at": record.updated_at.isoformat() if record.updated_at else None,
            }
        )
    )


@router.get("/sessions/by-file/{file_id}")
async def get_session_by_file(file_id: int, db: Session = Depends(get_db)):
    file_record = crud.get_file_by_id(db, file_id)
    if not file_record:
        return JSONResponse(
            {"success": True, "file_id": file_id, "session_id": None, "applied_steps": []}
        )
    record = crud.get_session_record(db, file_record.session_id or "")
    steps = []
    if record and record.applied_steps:
        steps = record.applied_steps
    else:
        job = crud.get_preprocessing_job(db, file_record.id)
        if job and job.change_log:
            steps = job.change_log
    return JSONResponse(
        sanitize_data(
            {
                "success": True,
                "file_id": file_record.id,
                "session_id": file_record.session_id,
                "applied_steps": steps or [],
            }
        )
    )


@router.post("/sessions/{session_id}/steps")
async def save_session_steps(
    session_id: str,
    request: StepsRequest,
    db: Session = Depends(get_db),
):
    incoming_steps = request.steps or []
    existing = crud.get_session_record(db, session_id)
    if len(incoming_steps) == 0 and not request.allow_empty:
        if existing and (existing.applied_steps or []):
            return JSONResponse(
                sanitize_data(
                    {
                        "success": True,
                        "session_id": existing.id,
                        "applied_steps": existing.applied_steps or [],
                        "preserved": True,
                    }
                )
            )
        return JSONResponse(
            sanitize_data(
                {
                    "success": True,
                    "session_id": session_id,
                    "applied_steps": [],
                    "preserved": True,
                }
            )
        )
    record = crud.upsert_session_steps(
        db=db,
        session_id=session_id,
        steps=incoming_steps,
        user_id=request.user_id,
        file_id=request.file_id,
    )
    file_record = crud.get_file_by_session(db, session_id)
    if file_record:
        job = crud.get_preprocessing_job(db, file_record.id)
        if job:
            job.change_log = sanitize_data(incoming_steps)
            db.commit()
    return JSONResponse(
        sanitize_data(
            {
                "success": True,
                "session_id": record.id,
                "applied_steps": record.applied_steps or [],
            }
        )
    )


@router.post("/sessions/{session_id}/replay")
async def replay_session_to_step(
    session_id: str,
    request: ReplayRequest,
    db: Session = Depends(get_db),
):
    """
    Replay all steps from the original file up to (and including) step_index.
    Returns the data state at that point — this is how Power BI Applied Steps
    time-travel works: always derived from source, never from a stored snapshot.
    """
    record = crud.get_session_record(db, session_id)
    if not record:
        raise HTTPException(status_code=404, detail="Session not found")

    file_record = crud.get_file_by_session(db, session_id)
    if not file_record or not file_record.file_binary:
        raise HTTPException(status_code=404, detail="Original file not found")

    # Load the original file into a DataFrame
    file_type = str(file_record.file_type.value).lower()
    try:
        if file_type in ("xlsx", "xls"):
            df = read_excel(bytes(file_record.file_binary))
        elif file_type == "csv":
            df = read_csv(bytes(file_record.file_binary))
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_type}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load original file: {str(e)}")

    # Apply steps 0..step_index in order
    steps = (record.applied_steps or [])[: request.step_index + 1]
    for step in steps:
        step_type = step.get("type", "")
        params = step.get("params", {})

        if step_type in ("source", "Source"):
            pass  # original data — no-op

        elif step_type in ("cell_edit", "Changed Value", "Changed Values"):
            col = params.get("column")
            row_idx = params.get("row_index")
            val = params.get("edited_value")
            if col and row_idx is not None and col in df.columns:
                try:
                    df.at[int(row_idx), col] = val
                except Exception:
                    pass

        elif step_type in ("drop_column", "Removed Columns"):
            col = params.get("column")
            if col and col in df.columns:
                df = df.drop(columns=[col])

        elif step_type in ("delete_rows", "Removed Rows"):
            indices = params.get("row_indices", [])
            if isinstance(params.get("row_index"), int):
                indices = [params["row_index"]]
            if indices:
                drop = [i for i in indices if i in df.index]
                if drop:
                    df = df.drop(index=drop).reset_index(drop=True)

        elif step_type in ("Renamed Columns",):
            col = params.get("column")
            new_name = params.get("edited_value")
            if col and new_name and col in df.columns:
                df = df.rename(columns={col: new_name})

        elif step_type in ("Added Column",):
            col = params.get("column")
            if col and col not in df.columns:
                df[col] = ""

        elif step_type in ("Added Rows",):
            row_data = params.get("row_data", {})
            if row_data:
                import pandas as pd
                if isinstance(row_data, list):
                    new_rows = [{c: r.get(c, "") for c in df.columns} for r in row_data]
                else:
                    new_rows = [{c: row_data.get(c, "") for c in df.columns}]
                df = pd.concat([df, pd.DataFrame(new_rows)], ignore_index=True)

        elif step_type in ("type_conversion",):
            import pandas as pd
            payload = step.get("payload", {})
            col = params.get("column") or payload.get("column") or step.get("column")
            target_type = (
                params.get("targetType") or params.get("target_type")
                or payload.get("targetType") or payload.get("target_type")
                or step.get("edited_value")
            )
            if col and target_type and col in df.columns:
                try:
                    t = str(target_type).lower()
                    if t in ("integer", "int"):
                        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
                    elif t in ("decimal", "float"):
                        df[col] = pd.to_numeric(df[col], errors="coerce")
                    elif t in ("text", "string", "str"):
                        df[col] = df[col].astype(str)
                    elif t in ("datetime", "date"):
                        df[col] = pd.to_datetime(df[col], errors="coerce")
                except Exception:
                    pass

    preview = df.head(200).fillna("").astype(str)
    return JSONResponse(sanitize_data({
        "success": True,
        "step_index": request.step_index,
        "data": preview.to_dict(orient="records"),
        "columns": df.columns.tolist(),
        "total_rows": len(df),
        "total_cols": len(df.columns),
    }))


@router.post("/sessions/{session_id}")
async def save_session_snapshot(
    session_id: str,
    request: SessionSnapshotRequest,
    db: Session = Depends(get_db),
):
    snapshot_steps = (
        request.applied_steps if request.applied_steps is not None else request.steps
    )
    if snapshot_steps == [] and not request.allow_empty:
        snapshot_steps = None
    record = crud.upsert_session_snapshot(
        db=db,
        session_id=session_id,
        steps=snapshot_steps,
        data=request.rows or request.data,
        columns=request.columns,
        user_id=request.user_id,
        file_id=request.file_id,
    )
    return JSONResponse(
        sanitize_data(
            {
                "success": True,
                "session_id": record.id,
                "applied_steps": record.applied_steps or [],
                "rows": getattr(record, "data", None) or [],
                "data": getattr(record, "data", None) or [],
                "columns": getattr(record, "columns", None) or [],
            }
        )
    )
