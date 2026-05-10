# routers/editing.py
# Routes: update cell, batch update cells, update column type

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db.connection import get_db
from app.config.config import (
    CellUpdateRequest,
    BatchCellUpdateRequest,
    ColumnTypeUpdateRequest,
    DeleteRowsRequest,
    DropColumnRequest,
)
from app.routes.profiler_cache import get_profiler
from app.db import crud
from app.utils.helpers import sanitize_data
router = APIRouter(prefix="/api", tags=["Editing"])


@router.put("/cell/{session_id}")
async def update_cell(
    session_id: str,
    request: CellUpdateRequest,
    db: Session = Depends(get_db),
):
    profiler    = get_profiler(session_id, db)
    file_record = crud.get_file_by_session(db, session_id)

    old_value = (
        profiler.df.at[request.row_idx, request.col_name]
        if request.col_name in profiler.df.columns
        else None
    )

    result = profiler.update_cell(request.row_idx, request.col_name, request.new_value)

    if file_record:
        crud.append_cell_edit(
            db, file_record.id,
            request.row_idx, request.col_name,
            old_value, request.new_value,
        )

    # Always invalidate and recompute — no conditional needed
    profiler._column_stats_cache.pop(request.col_name, None)
    profiler._issues_cache = []
    profiler._column_stats_cache[request.col_name] = profiler._profile_column(request.col_name)
    stats = profiler._column_stats_cache[request.col_name]  # always defined now

    response_payload = {
        "success":      True,
        "cell_info":    result,
        "column_stats": profiler._stats_to_dict(stats),
    }

    return JSONResponse(content=sanitize_data(response_payload))

@router.put("/cells/{session_id}/batch")
async def batch_update_cells(
    session_id: str,
    request: BatchCellUpdateRequest,
    db: Session = Depends(get_db),
):
    profiler    = get_profiler(session_id, db)
    file_record = crud.get_file_by_session(db, session_id)
    affected    = set()

    for upd in request.updates:
        old = (
            profiler.df.at[upd.row_idx, upd.col_name]
            if upd.col_name in profiler.df.columns
            else None
        )
        profiler.update_cell(upd.row_idx, upd.col_name, upd.new_value)
        affected.add(upd.col_name)

        if file_record:
            crud.append_cell_edit(
                db, file_record.id,
                upd.row_idx, upd.col_name,
                old, upd.new_value,
            )

    updated_columns = {
        col: profiler._stats_to_dict(profiler._column_stats_cache[col])
        for col in affected
        if col in profiler._column_stats_cache
    }
    return JSONResponse({
        "success":         True,
        "updated_count":   len(request.updates),
        "updated_columns": updated_columns,
    })


@router.put("/column/{session_id}/type")
async def update_column_type(
    session_id: str,
    request: ColumnTypeUpdateRequest,
    db: Session = Depends(get_db),
):
    profiler    = get_profiler(session_id, db)
    file_record = crud.get_file_by_session(db, session_id)

    result = profiler.update_column_type(
        request.col_name,
        request.new_type,
        dry_run=request.dry_run,
        allow_partial=request.allow_partial,
        preview_limit=request.preview_limit,
    )
    if not result["success"]:
        raise HTTPException(400, result["error"])

    if file_record:
        job = crud.get_preprocessing_job(db, file_record.id)
        if job:
            changes = dict(job.column_type_changes or {})
            changes[request.col_name] = request.new_type
            job.column_type_changes   = changes
            db.commit()

    return JSONResponse(content=sanitize_data(result))


@router.post("/rows/{session_id}/delete")
async def delete_rows(
    session_id: str,
    request: DeleteRowsRequest,
    db: Session = Depends(get_db),
):
    profiler = get_profiler(session_id, db)
    file_record = crud.get_file_by_session(db, session_id)

    row_indices = [int(i) for i in (request.row_indices or [])]
    if not row_indices:
        return JSONResponse({"success": True, "deleted": 0})

    rows_before = len(profiler.df)
    profiler.df = profiler.df.drop(index=row_indices, errors="ignore")
    deleted = rows_before - len(profiler.df)
    profiler._column_stats_cache = {}
    profiler._issues_cache = []
    profiler._changes_log.append({
        "type": "row_delete",
        "rows": row_indices,
    })

    if file_record:
        file_record.row_count = int(len(profiler.df))
        db.commit()

    return JSONResponse({"success": True, "deleted": int(deleted)})


@router.post("/column/{session_id}/drop")
async def drop_column(
    session_id: str,
    request: DropColumnRequest,
    db: Session = Depends(get_db),
):
    profiler = get_profiler(session_id, db)
    file_record = crud.get_file_by_session(db, session_id)

    col_name = request.col_name
    if col_name not in profiler.df.columns:
        raise HTTPException(404, "Column not found")

    profiler.df = profiler.df.drop(columns=[col_name])
    profiler._column_stats_cache = {}
    profiler._issues_cache = []
    profiler._changes_log.append({
        "type": "drop_column",
        "column": col_name,
    })

    if file_record:
        file_record.column_count = int(len(profiler.df.columns))
        db.commit()

    return JSONResponse({"success": True, "column": col_name})
