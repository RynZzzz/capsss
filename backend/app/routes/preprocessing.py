# routers/preprocessing.py
# Routes: save changes, reset changes, get changes log, save/get preprocessing config

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import io

from app.db.connection import get_db
from app.config.config import PreprocessingConfigRequest, RecipeRequest
from app.routes.profiler_cache import get_profiler, set_profiler, bytes_to_df
from app.services.ETL.data_profiler import DataProfiler
from app.db import crud
from app.utils.helpers import sanitize_data

router = APIRouter(prefix="/api", tags=["Preprocessing"])


@router.post("/preprocessing/{session_id}")
async def save_preprocessing_config(
    session_id: str,
    config: PreprocessingConfigRequest,
    db: Session = Depends(get_db),
):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    job = crud.get_preprocessing_job(db, file_record.id)

    if job:
        job.missing_handling          = config.missing_handling
        job.missing_constant_value    = config.missing_constant_value
        job.outlier_method            = config.outlier_method
        job.outlier_action            = config.outlier_action
        job.outlier_param             = config.outlier_param
        job.column_missing_overrides  = config.column_missing_overrides
        job.column_outlier_overrides  = config.column_outlier_overrides
        job.column_type_changes       = config.column_type_changes
        job.status                    = "pending"
        db.commit()
        db.refresh(job)
    else:
        job = crud.create_preprocessing_job(
            db                       = db,
            file_id                  = file_record.id,
            missing_handling         = config.missing_handling,
            outlier_method           = config.outlier_method,
            outlier_action           = config.outlier_action,
            outlier_param            = config.outlier_param,
            column_missing_overrides = config.column_missing_overrides,
            column_outlier_overrides = config.column_outlier_overrides,
            column_type_changes      = config.column_type_changes,
        )

    return JSONResponse({"success": True, "job_id": job.id})


@router.post("/recipe/{session_id}")
async def save_recipe(
    session_id: str,
    request: RecipeRequest,
    db: Session = Depends(get_db),
):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    job = crud.get_preprocessing_job(db, file_record.id)
    if job:
        job.change_log = request.steps or []
        db.commit()
        db.refresh(job)
    else:
        job = crud.create_preprocessing_job(db, file_record.id)
        job.change_log = request.steps or []
        db.commit()
        db.refresh(job)

    return JSONResponse({"success": True, "steps": job.change_log or []})


@router.get("/recipe/{session_id}")
async def get_recipe(
    session_id: str,
    db: Session = Depends(get_db),
):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    job = crud.get_preprocessing_job(db, file_record.id)
    steps = job.change_log if job and job.change_log else []
    return JSONResponse({"success": True, "steps": steps})


@router.get("/preprocessing/{session_id}")
async def get_preprocessing_config(session_id: str, db: Session = Depends(get_db)):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    job = crud.get_preprocessing_job(db, file_record.id)
    if not job:
        return JSONResponse({"success": True, "config": None})

    return JSONResponse({
        "success": True,
        "config": {
            "job_id":                   job.id,
            "missing_handling":         job.missing_handling.value,
            "missing_constant_value":   job.missing_constant_value,
            "outlier_method":           job.outlier_method.value,
            "outlier_action":           job.outlier_action.value,
            "outlier_param":            job.outlier_param,
            "column_missing_overrides": job.column_missing_overrides,
            "column_outlier_overrides": job.column_outlier_overrides,
            "column_type_changes":      job.column_type_changes,
            "status":                   job.status.value,
            "cell_edits_count":         len(job.cell_edits or []),
        },
    })


@router.post("/save/{session_id}")
async def save_changes(session_id: str, db: Session = Depends(get_db)):
    profiler    = get_profiler(session_id, db)
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    result = profiler.save_changes()

    buf = io.BytesIO()
    if file_record.file_name.endswith(".csv"):
        profiler.df.to_csv(buf, index=False)
    else:
        profiler.df.to_excel(buf, index=False)
    buf.seek(0)
    cleaned_bytes = buf.read()

    new_profile = profiler.profile()

    file_record.file_binary = cleaned_bytes
    file_record.row_count = len(profiler.df)
    file_record.column_count = len(profiler.df.columns)
    db.commit()

    job = crud.get_preprocessing_job(db, file_record.id)
    if job:
        crud.update_preprocessing_job(
            db                  = db,
            job_id              = job.id,
            status              = "completed",
            cleaned_row_count   = len(profiler.df),
            cleaned_col_count   = len(profiler.df.columns),
            change_log          = profiler.get_changes_log(),
        )

    crud.save_column_profiles(db, file_record.id, new_profile["columns"])

    return JSONResponse(sanitize_data({**result, "profile": new_profile}))


@router.post("/reset/{session_id}")
async def reset_changes(session_id: str, db: Session = Depends(get_db)):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    # Use the immutable original binary. Fall back to current file_binary for
    # sessions created before this column was added.
    original_bytes = file_record.original_file_binary or file_record.file_binary

    # Rebuild a fresh profiler from the true original data
    df = bytes_to_df(original_bytes, file_record.file_name)
    profiler = DataProfiler(df)
    set_profiler(session_id, profiler)

    # Restore the working copy so subsequent apply_cleaning calls start clean
    file_record.file_binary = original_bytes
    file_record.row_count = len(df)
    file_record.column_count = len(df.columns)
    db.commit()

    profile_data = profiler.profile()
    crud.save_column_profiles(db, file_record.id, profile_data["columns"])

    return JSONResponse(sanitize_data({"success": True, "message": "Changes reset", "profile": profile_data}))


@router.get("/changes/{session_id}")
async def get_changes_log(session_id: str, db: Session = Depends(get_db)):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    job = crud.get_preprocessing_job(db, file_record.id)
    if job and job.change_log:
        changes = job.change_log
        source = "preprocessing_job"
    else:
        profiler = get_profiler(session_id, db)
        changes = profiler.get_changes_log()
        source = "profiler"

    return JSONResponse({
        "success":       True,
        "changes_count": len(changes),
        "changes":       changes,
        "source":        source,
        "job_id":        job.id if job else None,
        "status":        job.status.value if job else None,
        "completed_at":  job.completed_at.isoformat() if job and job.completed_at else None,
    })
