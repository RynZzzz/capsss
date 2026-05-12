from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks, Form
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session
from app.db.connection import get_db
from app.config.config import settings
from app.services.ETL.data_profiler import DataProfiler
from app.db import crud
import os, uuid, io, logging, json, re, shutil, tempfile
from pathlib import Path
import pandas as pd
from app.routes.profiler_cache import get_profiler, set_profiler, remove_profiler, bytes_to_df
from app.services.file_parser import get_merge_ranges
import numpy as np
from typing import Dict, Any

logger = logging.getLogger("uvicorn.error")

# In-memory profiling status: session_id → {ready, profile, error, ...}
# Acts as a fast cache; DB is the persistent source of truth.
_profile_status: Dict[str, Any] = {}

# ---------------------------------------------------------------------------
# Chunked upload staging
# ---------------------------------------------------------------------------
# For very large files the frontend slices them into chunks; each chunk lands
# here via /upload/chunk, then /upload/complete reassembles them.
# App Platform allows up to 100 MiB request bodies, so the per-chunk cap is
# set to 90 MiB with comfortable headroom.
_CHUNK_STAGING_DIR = Path(tempfile.gettempdir()) / "cleanlogic_chunks"
_CHUNK_STAGING_DIR.mkdir(parents=True, exist_ok=True)
# Per-chunk size cap (90 MiB — well within App Platform's 100 MiB limit)
_MAX_CHUNK_BYTES = 90 * 1024 * 1024
# Defensive cap on number of chunks per upload (1024 × 90 MiB ≈ 90 GiB ceiling)
_MAX_CHUNKS = 1024


def _chunk_dir_for(upload_id: str) -> Path:
    """Return per-upload staging dir, sanitizing upload_id to prevent path
    traversal. Accepts UUID-like strings; rejects anything else."""
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "", upload_id or "")[:64]
    if not safe:
        raise HTTPException(400, "Invalid upload_id")
    return _CHUNK_STAGING_DIR / safe


def _run_full_task(session_id: str, content: bytes, filename: str, file_id: int) -> None:
    """Parse file, profile data, and update DB — all in a background thread."""
    from app.db.connection import SessionLocal
    from sqlalchemy import text as sql_text
    from app.routes.project import _df_cache
    db = SessionLocal()
    try:
        df = bytes_to_df(content, filename)

        # Pre-warm the df cache so the first getProject call returns instantly
        # instead of re-parsing the file from DB on the cold start.
        _df_cache.put(session_id, df, [])

        profiler = DataProfiler(df)
        set_profiler(session_id, profiler)

        profile_data = profiler.profile()

        db.execute(
            sql_text(
                "UPDATE files SET row_count = :r, column_count = :c WHERE session_id = :sid"
            ),
            {"r": int(len(df)), "c": int(len(df.columns)), "sid": session_id},
        )
        crud.save_column_profiles(db, file_id, profile_data["columns"])
        db.commit()

        merged_cells: list = []
        has_merges = False
        try:
            if filename.lower().endswith((".xlsx", ".xls")):
                merged_cells = get_merge_ranges(content)
                has_merges = bool(merged_cells)
        except Exception:
            pass

        # Persist status to DB so polling survives server restarts
        crud.save_profile_status(
            db, file_id,
            ready=True,
            merged_cells=merged_cells,
            has_merges=has_merges,
        )

        _profile_status[session_id] = {
            "ready": True,
            "profile": profile_data,
            "error": None,
            "merged_cells": merged_cells,
            "has_merges": has_merges,
        }
        logger.info("Background task complete for session %s", session_id)
    except Exception as exc:
        logger.error("Background task failed for %s: %s", session_id, exc)
        try:
            crud.save_profile_status(db, file_id, ready=True, error=str(exc))
        except Exception:
            pass
        _profile_status[session_id] = {"ready": True, "profile": None, "error": str(exc)}
    finally:
        db.close()


def sanitize_data(obj):
    """Recursively convert Numpy/Pandas types to standard Python types."""
    if isinstance(obj, dict):
        return {k: sanitize_data(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple, set)):
        return [sanitize_data(v) for v in obj]
    elif isinstance(obj, (np.integer, pd.Int64Dtype)):
        return int(obj)
    elif isinstance(obj, (np.floating, pd.Float64Dtype)):
        return float(obj)
    elif isinstance(obj, (np.ndarray, pd.Series)):
        return sanitize_data(obj.tolist())
    elif pd.isna(obj):
        return None
    return obj


def _reconstruct_profile_from_db(session_id: str, db: Session) -> Dict[str, Any]:
    """Rebuild a profile dict from saved column_profiles when in-memory cache is gone."""
    from sqlalchemy import text as sql_text

    file_row = db.execute(
        sql_text(
            "SELECT id, row_count, column_count FROM files WHERE session_id = :sid LIMIT 1"
        ),
        {"sid": session_id},
    ).mappings().first()
    if not file_row:
        return None

    profiles = db.execute(
        sql_text("SELECT * FROM column_profiles WHERE file_id = :fid ORDER BY id"),
        {"fid": file_row["id"]},
    ).mappings().all()

    columns = []
    type_dist: Dict[str, int] = {}
    total_missing = total_outliers = total_inconsistencies = 0

    for p in profiles:
        col_type = p["column_type"]
        type_dist[col_type] = type_dist.get(col_type, 0) + 1
        total_missing       += p["missing_count"] or 0
        total_outliers      += p["outlier_count"] or 0
        total_inconsistencies += p["type_inconsistency_count"] or 0

        col_dict: Dict[str, Any] = {
            "name":                      p["column_name"],
            "type":                      col_type,
            "total_count":               p["total_count"],
            "non_null_count":            p["non_null_count"],
            "missing_count":             p["missing_count"],
            "missing_indices":           p["missing_indices"] or [],
            "unique_count":              p["unique_count"],
            "completeness":              p["completeness_pct"],
            "outlier_count":             p["outlier_count"],
            "outlier_indices":           p["outlier_indices"] or [],
            "outlier_method":            p["outlier_method"],
            "type_inconsistency_count":  p["type_inconsistency_count"],
            "type_inconsistency_indices": p["type_inconsistency_indices"] or [],
            "has_more_missing":          False,
            "has_more_outliers":         False,
            "has_more_inconsistencies":  False,
        }
        if col_type in ("Integer", "Decimal"):
            col_dict.update({
                "mean": p["mean"], "median": p["median"], "std": p["std_dev"],
                "min":  p["min_value"], "max": p["max_value"],
                "q1":   p["q1"], "q3": p["q3"],
            })
        if col_type in ("Text", "Alphanumeric", "Mixed"):
            col_dict.update({"top_value": p["top_value"], "top_freq": p["top_freq"]})
        columns.append(col_dict)

    cols_with_issues = sum(
        1 for p in profiles
        if (p["missing_count"] or 0) > 0
        or (p["outlier_count"] or 0) > 0
        or (p["type_inconsistency_count"] or 0) > 0
    )

    return {
        "metadata": {
            "total_rows":    file_row["row_count"] or 0,
            "total_columns": file_row["column_count"] or 0,
            "memory_usage":  0,
            "shape":         [file_row["row_count"] or 0, file_row["column_count"] or 0],
        },
        "columns": columns,
        "type_distribution": type_dist,
        "issues_summary": {
            "total_issues":       total_missing + total_outliers + total_inconsistencies,
            "missing":            total_missing,
            "outliers":           total_outliers,
            "type_inconsistencies": total_inconsistencies,
            "columns_with_issues":  cols_with_issues,
        },
        "data": [],  # preview rows not available without re-parsing
    }


router = APIRouter()


async def _save_and_profile(
    content: bytes,
    filename: str,
    user_id: int,
    db: Session,
    background_tasks: BackgroundTasks,
) -> JSONResponse:
    """Shared pipeline used by both /upload (single POST) and /upload/complete
    (chunked). Persists the file binary, kicks off async profiling, returns
    the standard upload response payload."""
    if len(content) > settings.MAX_FILE_SIZE:
        raise HTTPException(400, f"File exceeds {settings.MAX_FILE_SIZE // 1024 // 1024}MB limit")

    session_id = str(uuid.uuid4())
    _profile_status[session_id] = {"ready": False, "profile": None, "error": None}
    try:
        file_ext = os.path.splitext(filename)[1].lstrip(".").upper()
        file_record = crud.save_file(
            db=db,
            user_id=user_id,
            file_name=filename,
            file_type=file_ext,
            file_binary=content,
            session_id=session_id,
        )
        crud.create_preprocessing_job(db, file_id=file_record.id)
    except Exception as e:
        logger.error("DATABASE ERROR: %s", e)
        raise HTTPException(500, f"Database persistence failed: {str(e)}")

    background_tasks.add_task(_run_full_task, session_id, content, filename, file_record.id)

    return JSONResponse(content={
        "success": True,
        "session_id": session_id,
        "file_id": file_record.id,
        "filename": filename,
        "profiling": "pending",
    })


@router.post("/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: int = 1,
    db: Session = Depends(get_db),
):
    content = await file.read()
    return await _save_and_profile(content, file.filename, user_id, db, background_tasks)


@router.post("/upload/chunk")
async def upload_chunk_part(
    chunk: UploadFile = File(...),
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
):
    """Receive a single chunk of a chunked upload and persist it to a
    per-upload staging dir. /upload/complete assembles the final file."""
    if total_chunks <= 0 or total_chunks > _MAX_CHUNKS:
        raise HTTPException(400, f"total_chunks must be 1..{_MAX_CHUNKS}")
    if chunk_index < 0 or chunk_index >= total_chunks:
        raise HTTPException(400, "Invalid chunk_index")

    chunk_bytes = await chunk.read()
    if len(chunk_bytes) > _MAX_CHUNK_BYTES:
        raise HTTPException(
            413,
            f"Chunk exceeds {_MAX_CHUNK_BYTES // 1024 // 1024} MiB size limit",
        )

    chunk_dir = _chunk_dir_for(upload_id)
    chunk_dir.mkdir(parents=True, exist_ok=True)
    chunk_path = chunk_dir / f"{chunk_index:06d}.part"
    chunk_path.write_bytes(chunk_bytes)

    return JSONResponse({
        "success": True,
        "upload_id": upload_id,
        "chunk_index": chunk_index,
        "total_chunks": total_chunks,
        "received_bytes": len(chunk_bytes),
    })


@router.post("/upload/complete")
async def upload_complete(
    background_tasks: BackgroundTasks,
    upload_id: str = Form(...),
    filename: str = Form(...),
    total_chunks: int = Form(...),
    user_id: int = Form(1),
    db: Session = Depends(get_db),
):
    """Reassemble all chunks for upload_id, then run the same pipeline as
    /upload (DB persist + async profiling)."""
    chunk_dir = _chunk_dir_for(upload_id)
    if not chunk_dir.is_dir():
        raise HTTPException(404, "Upload not found or already finalized")

    parts = sorted(chunk_dir.glob("*.part"))
    if len(parts) != total_chunks:
        # Cleanup stale staging dir on mismatch so a retry starts fresh
        shutil.rmtree(chunk_dir, ignore_errors=True)
        raise HTTPException(
            400,
            f"Expected {total_chunks} chunks, found {len(parts)}",
        )

    # Concatenate chunks into a single bytes buffer. With MAX_FILE_SIZE
    # currently 200 MiB and 32 GiB instance memory, this is comfortably safe.
    buf = bytearray()
    for part in parts:
        buf.extend(part.read_bytes())
    content = bytes(buf)

    # Cleanup staging immediately — don't keep duplicates around
    shutil.rmtree(chunk_dir, ignore_errors=True)

    return await _save_and_profile(content, filename, user_id, db, background_tasks)


@router.get("/api/profile-status/{session_id}")
async def get_profile_status(session_id: str, db: Session = Depends(get_db)):
    """Poll after upload to know when profiling is done."""
    # Fast path: in-memory cache (most requests hit this)
    status = _profile_status.get(session_id)
    if status is not None:
        if not status["ready"]:
            return JSONResponse({"ready": False, "found": True})
        if status["error"]:
            raise HTTPException(500, f"Profiling failed: {status['error']}")
        return JSONResponse(sanitize_data({
            "ready": True,
            "profile": status["profile"],
            "merged_cells": status.get("merged_cells", []),
            "has_merges": status.get("has_merges", False),
        }))

    # DB fallback — handles server restarts where in-memory dict was wiped
    db_status = crud.get_profile_status_from_db(db, session_id)
    if db_status is None:
        return JSONResponse({"ready": False, "found": False})
    if not db_status["profiling_ready"]:
        return JSONResponse({"ready": False, "found": True})
    if db_status["profiling_error"]:
        raise HTTPException(500, f"Profiling failed: {db_status['profiling_error']}")

    profile = _reconstruct_profile_from_db(session_id, db)
    if profile is None:
        raise HTTPException(500, "Could not reconstruct profile — please re-upload the file.")

    merged_cells = db_status.get("merged_cells_json") or []
    if isinstance(merged_cells, str):
        try:
            merged_cells = json.loads(merged_cells)
        except Exception:
            merged_cells = []

    return JSONResponse(sanitize_data({
        "ready": True,
        "profile": profile,
        "merged_cells": merged_cells,
        "has_merges": bool(db_status.get("has_merges", False)),
    }))


@router.get("/files")
async def list_files(user_id: int = 1, db: Session = Depends(get_db)):
    files = crud.get_user_files(db, user_id)
    return JSONResponse({
        "success": True,
        "files": [
            {
                "id":           f.id,
                "file_name":    f.file_name,
                "file_type":    f.file_type.value,
                "file_size":    f.file_size,
                "row_count":    f.row_count,
                "column_count": f.column_count,
                "session_id":   f.session_id,
                "created_at":   f.created_at.isoformat(),
            }
            for f in files
        ],
    })


@router.delete("/file/{file_id}")
async def delete_file(file_id: int, db: Session = Depends(get_db)):
    fr = crud.get_file_by_id(db, file_id)
    if fr:
        remove_profiler(fr.session_id)
    if not crud.delete_file(db, file_id):
        raise HTTPException(404, "File not found")
    return JSONResponse({"success": True})


@router.delete("/files")
async def delete_all_files(user_id: int = 1, db: Session = Depends(get_db)):
    files = crud.get_user_files(db, user_id)
    for f in files:
        remove_profiler(f.session_id)
    deleted = crud.delete_user_files(db, user_id)
    return JSONResponse({"success": True, "deleted": deleted})


@router.get("/export/{session_id}")
async def export_cleaned_file(
    session_id: str,
    format: str = "xlsx",
    db: Session = Depends(get_db),
):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    job = crud.get_preprocessing_job(db, file_record.id)

    if job and job.cleaned_file_binary:
        raw = job.cleaned_file_binary
    else:
        profiler = get_profiler(session_id, db)
        buf = io.BytesIO()
        profiler.df.to_csv(buf, index=False) if format == "csv" else profiler.df.to_excel(buf, index=False)
        buf.seek(0)
        raw = buf.read()

    media_type = (
        "text/csv"
        if format == "csv"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    fname = f"{os.path.splitext(file_record.file_name)[0]}_cleaned.{format}"
    return Response(
        content=raw,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
