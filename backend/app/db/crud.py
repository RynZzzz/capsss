# backend/database/crud.py

from sqlalchemy.orm import Session
from sqlalchemy import desc, text
from datetime import datetime
from typing import Optional, List, Dict, Any
import io
import numpy as np
import json
from types import SimpleNamespace
from collections import OrderedDict
from threading import Lock

from app.utils.helpers import sanitize_data


# ─────────────────────────── RECORD CACHE ────────────────────────────────────
# Caches get_file_by_session and get_session_record — called on every request
# across all routes. Avoids repeated DB round trips for the same session.

class _RecordCache:
    def __init__(self, maxsize: int):
        self._store: OrderedDict = OrderedDict()
        self._maxsize = maxsize
        self._lock = Lock()

    def get(self, key: str):
        with self._lock:
            val = self._store.get(key)
            if val is not None:
                self._store.move_to_end(key)
            return val

    def put(self, key: str, value) -> None:
        with self._lock:
            self._store.pop(key, None)
            if len(self._store) >= self._maxsize:
                self._store.popitem(last=False)
            self._store[key] = value

    def invalidate(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)


_file_cache    = _RecordCache(maxsize=25)   # FileTable records keyed by session_id
_session_cache = _RecordCache(maxsize=50)   # session records keyed by session_id


def invalidate_session_caches(session_id: str) -> None:
    """Call this whenever a session's file binary or step list changes."""
    _session_cache.invalidate(session_id)
from app.db.models import (
    User, Accounts, FileTable, ColumnProfile, PreprocessingJob,
    Visualization, TrainedModel, AiSummary,
    SessionRecord, StepSnapshot, PreprocessingLog,
    FileTypeEnum, AuthProviderEnum, MissingHandlingEnum, OutlierMethodEnum,
    OutlierActionEnum, ColumnTypeEnum, ChartTypeEnum,
    MLModelTypeEnum, PreprocessingStatusEnum
)


# ─────────────────────────────── USERS ──────────────────────────────────────

def create_user(db: Session, username: str, email: str) -> User:
    user = User(username=username, email=email)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(User.email == email).first()



# ─────────────────────────────── ACCOUNTS ────────────────────────────────────

def create_account(
    db: Session,
    user_id: int,
    provider: str,
    provider_id: str,
    access_token: str = None,
    refresh_token: str = None,
    token_expiry=None,
) -> Accounts:
    """Link an OAuth provider account to a user."""
    account = Accounts(
        user_id       = user_id,
        provider      = AuthProviderEnum(provider),
        provider_id   = provider_id,
        access_token  = access_token,
        refresh_token = refresh_token,
        token_expiry  = token_expiry,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def get_account_by_provider(
    db: Session, provider: str, provider_id: str
) -> Optional[Accounts]:
    """Look up an account by provider + provider_id (used during OAuth callback)."""
    return (
        db.query(Accounts)
        .filter(
            Accounts.provider    == AuthProviderEnum(provider),
            Accounts.provider_id == provider_id,
        )
        .first()
    )


def get_accounts_by_user(db: Session, user_id: int) -> List[Accounts]:
    """Return all linked OAuth accounts for a user."""
    return db.query(Accounts).filter(Accounts.user_id == user_id).all()


def get_local_account_by_email(db: Session, email: str) -> Optional[Accounts]:
    """Find a LOCAL provider account by email (stored as provider_id)."""
    return (
        db.query(Accounts)
        .filter(
            Accounts.provider == AuthProviderEnum.LOCAL,
            Accounts.provider_id == email,
        )
        .first()
    )


def create_local_user(
    db: Session, username: str, email: str, password_hash: str
) -> User:
    """Create a new user with a LOCAL password account."""
    user = User(username=username, email=email)
    db.add(user)
    db.flush()  # get user.id before committing

    account = Accounts(
        user_id=user.id,
        provider=AuthProviderEnum.LOCAL,
        provider_id=email,
        password_hash=password_hash,
    )
    db.add(account)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).first()


def update_account_tokens(
    db: Session,
    account_id: int,
    access_token: str = None,
    refresh_token: str = None,
    token_expiry=None,
) -> Optional[Accounts]:
    """Refresh stored OAuth tokens after a token-renewal cycle."""
    account = db.query(Accounts).filter(Accounts.id == account_id).first()
    if not account:
        return None
    if access_token  is not None: account.access_token  = access_token
    if refresh_token is not None: account.refresh_token = refresh_token
    if token_expiry  is not None: account.token_expiry  = token_expiry
    db.commit()
    db.refresh(account)
    return account


def delete_account(db: Session, account_id: int) -> bool:
    """Unlink a single OAuth provider from a user."""
    account = db.query(Accounts).filter(Accounts.id == account_id).first()
    if not account:
        return False
    db.delete(account)
    db.commit()
    return True


# ─────────────────────────────── FILES ──────────────────────────────────────

def save_file(
    db: Session,
    user_id: int,
    file_name: str,
    file_type: str,
    file_binary: bytes,
    session_id: str,
    row_count: int = None,
    column_count: int = None,
) -> FileTable:
    """Persist an uploaded file's binary to the database.

    original_file_binary is set via a server-side UPDATE (no extra client packet)
    so the INSERT only carries one BLOB copy instead of two, keeping the packet
    size under max_allowed_packet even for large files.
    """
    file_record = FileTable(
        user_id              = user_id,
        file_name            = file_name,
        file_type            = FileTypeEnum(file_type.lower().lstrip(".")),
        file_size            = len(file_binary),
        file_binary          = file_binary,
        original_file_binary = None,          # filled server-side below
        session_id           = session_id,
        row_count            = row_count,
        column_count         = column_count,
    )
    db.add(file_record)
    db.flush()   # assign the primary key without committing

    # Server-side copy: MySQL duplicates the BLOB internally; no large packet sent
    db.execute(
        text("UPDATE files SET original_file_binary = file_binary WHERE id = :id"),
        {"id": file_record.id},
    )
    db.commit()
    db.refresh(file_record)
    return file_record


def get_file_by_id(db: Session, file_id: int) -> Optional[FileTable]:
    return db.query(FileTable).filter(FileTable.id == file_id).first()


def get_file_by_session(db: Session, session_id: str) -> Optional[FileTable]:
    # Always query fresh — cached ORM objects become detached after the request
    # that created them ends, causing DetachedInstanceError when SQLAlchemy tries
    # to lazy-load BLOB columns (file_binary / original_file_binary) in a new session.
    return db.query(FileTable).filter(FileTable.session_id == session_id).first()


def get_user_files(db: Session, user_id: int) -> List[FileTable]:
    from sqlalchemy.orm import load_only
    return (
        db.query(FileTable)
        .options(load_only(
            FileTable.id,
            FileTable.file_name,
            FileTable.file_type,
            FileTable.file_size,
            FileTable.row_count,
            FileTable.column_count,
            FileTable.session_id,
            FileTable.created_at,
        ))
        .filter(FileTable.user_id == user_id)
        .order_by(desc(FileTable.created_at))
        .all()
    )


def delete_file(db: Session, file_id: int) -> bool:
    record = get_file_by_id(db, file_id)
    if not record:
        return False
    if record.session_id:
        invalidate_session_caches(record.session_id)
        db.query(SessionRecord).filter(SessionRecord.id == record.session_id).delete(synchronize_session=False)
    db.delete(record)
    db.commit()
    return True


def delete_user_files(db: Session, user_id: int) -> int:
    # Delete all session records for this user's files first (FK is SET NULL, not CASCADE)
    session_ids = [
        f.session_id
        for f in db.query(FileTable.session_id).filter(FileTable.user_id == user_id).all()
        if f.session_id
    ]
    if session_ids:
        db.query(SessionRecord).filter(SessionRecord.id.in_(session_ids)).delete(synchronize_session=False)
    deleted = (
        db.query(FileTable)
        .filter(FileTable.user_id == user_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(deleted or 0)


def get_session_record(db: Session, session_id: str) -> Optional[Any]:
    cached = _session_cache.get(session_id)
    if cached is not None:
        return cached
    row = db.execute(
        text(
            "SELECT id, user_id, file_id, applied_steps, updated_at FROM sessions WHERE id = :id LIMIT 1"
        ),
        {"id": session_id},
    ).mappings().first()
    if not row:
        return None
    applied_steps = row.get("applied_steps")
    if isinstance(applied_steps, str):
        try:
            applied_steps = json.loads(applied_steps)
        except Exception:
            applied_steps = []
    record = SimpleNamespace(
        id=row.get("id"),
        user_id=row.get("user_id"),
        file_id=row.get("file_id"),
        applied_steps=applied_steps or [],
        updated_at=row.get("updated_at"),
    )
    _session_cache.put(session_id, record)
    return record


def upsert_session_steps(
    db: Session,
    session_id: str,
    steps: List[Dict[str, Any]],
    user_id: Optional[str] = None,
    file_id: Optional[int] = None,
) -> Any:
    db.execute(
        text(
            """
            INSERT INTO sessions (id, user_id, file_id, applied_steps, updated_at)
            VALUES (:id, :user_id, :file_id, :applied_steps, NOW())
            ON DUPLICATE KEY UPDATE
              applied_steps = VALUES(applied_steps),
              user_id = COALESCE(VALUES(user_id), user_id),
              file_id = COALESCE(VALUES(file_id), file_id),
              updated_at = NOW()
            """
        ),
        {
            "id": session_id,
            "user_id": user_id,
            "file_id": file_id,
            "applied_steps": json.dumps(steps or []),
        },
    )
    db.commit()
    _session_cache.invalidate(session_id)   # force fresh read on next request
    return get_session_record(db, session_id)


def upsert_session_snapshot(
    db: Session,
    session_id: str,
    steps: Optional[List[Dict[str, Any]]] = None,
    data: Optional[List[Dict[str, Any]]] = None,
    columns: Optional[List[Dict[str, Any]]] = None,
    user_id: Optional[str] = None,
    file_id: Optional[int] = None,
) -> Any:
    if steps is None:
        existing = get_session_record(db, session_id)
        if existing:
            return existing
    return upsert_session_steps(
        db=db,
        session_id=session_id,
        steps=steps or [],
        user_id=user_id,
        file_id=file_id,
    )


# ──────────────────────────── STEP SNAPSHOTS ─────────────────────────────────

_SNAPSHOT_EXPIRY_DAYS = 1  # delete ALL snapshots for sessions inactive this long

def save_step_snapshot(
    db: Session,
    session_id: str,
    step_index: int,
    file_binary: bytes,
) -> None:
    """Upsert the materialized file binary for session_id at step_index.
    Periodically evicts snapshots for sessions inactive beyond _SNAPSHOT_EXPIRY_DAYS."""
    db.execute(
        text(
            """
            INSERT INTO step_snapshots (session_id, step_index, file_binary, created_at)
            VALUES (:session_id, :step_index, :file_binary, NOW())
            ON DUPLICATE KEY UPDATE
              file_binary = VALUES(file_binary),
              created_at  = NOW()
            """
        ),
        {
            "session_id": session_id,
            "step_index": step_index,
            "file_binary": file_binary,
        },
    )
    # Evict entire sessions that have had no snapshot activity for _SNAPSHOT_EXPIRY_DAYS.
    # This preserves ALL snapshots for active sessions (full undo history intact)
    # while reclaiming disk from abandoned sessions.
    db.execute(
        text(
            """
            DELETE FROM step_snapshots
            WHERE session_id IN (
                SELECT session_id FROM (
                    SELECT session_id
                    FROM step_snapshots
                    GROUP BY session_id
                    HAVING MAX(created_at) < NOW() - INTERVAL :days DAY
                ) AS expired
            )
            """
        ),
        {"days": _SNAPSHOT_EXPIRY_DAYS},
    )
    db.commit()


def get_step_snapshot(
    db: Session,
    session_id: str,
    step_index: int,
) -> Optional[bytes]:
    """Return the stored file binary for this step, or None if not yet cached."""
    row = db.execute(
        text(
            "SELECT file_binary FROM step_snapshots "
            "WHERE session_id = :sid AND step_index = :idx LIMIT 1"
        ),
        {"sid": session_id, "idx": step_index},
    ).first()
    return row[0] if row else None


def delete_step_snapshots_from(
    db: Session,
    session_id: str,
    from_index: int,
) -> None:
    """Delete all snapshots at step_index >= from_index (used after delete/update step)."""
    db.execute(
        text(
            "DELETE FROM step_snapshots "
            "WHERE session_id = :sid AND step_index >= :idx"
        ),
        {"sid": session_id, "idx": from_index},
    )
    db.commit()


# ──────────────────────────── COLUMN PROFILES ────────────────────────────────

def save_column_profiles(
    db: Session,
    file_id: int,
    profiles: List[Dict[str, Any]],
) -> List[ColumnProfile]:
    """
    Replace all column profiles for a file.
    Called after upload and after cleaning.
    """
    # Delete existing profiles
    db.query(ColumnProfile).filter(ColumnProfile.file_id == file_id).delete()
    db.commit()

    records = []
    for p in profiles:
        record = ColumnProfile(
            file_id    = file_id,
            column_name = p["name"],
            column_type = ColumnTypeEnum(p["type"]),
            total_count    = p.get("total_count", 0),
            non_null_count = p.get("non_null_count", 0),
            missing_count  = p.get("missing_count", 0),
            unique_count   = p.get("unique_count", 0),
            completeness_pct = p.get("completeness", 100.0),

            # Numeric
            mean       = p.get("mean"),
            median     = p.get("median"),
            std_dev    = p.get("std"),
            min_value  = p.get("min"),
            max_value  = p.get("max"),
            q1         = p.get("q1"),
            q3         = p.get("q3"),

            # Text
            top_value = p.get("top_value"),
            top_freq  = p.get("top_freq"),

            # Quality
            outlier_count            = p.get("outlier_count", 0),
            outlier_method           = p.get("outlier_method"),
            type_inconsistency_count = p.get("type_inconsistency_count", 0),

            # Indices (store max 500 per column to keep rows small)
            missing_indices            = p.get("missing_indices", [])[:500],
            outlier_indices            = p.get("outlier_indices", [])[:500],
            type_inconsistency_indices = p.get("type_inconsistency_indices", [])[:500],

            # Distribution
            value_distribution = p.get("value_counts", {}),
        )
        db.add(record)
        records.append(record)

    db.commit()
    for r in records:
        db.refresh(r)
    return records


def get_column_profiles(db: Session, file_id: int) -> List[ColumnProfile]:
    return db.query(ColumnProfile).filter(ColumnProfile.file_id == file_id).all()


# ──────────────────────────── PREPROCESSING ──────────────────────────────────

def create_preprocessing_job(
    db: Session,
    file_id: int,
    missing_handling: str = "omit",
    outlier_method: str = "iqr",
    outlier_action: str = "remove",
    outlier_param: float = 1.5,
    column_missing_overrides: Dict = None,
    column_outlier_overrides: Dict = None,
    column_type_changes: Dict = None,
) -> PreprocessingJob:
    job = PreprocessingJob(
        file_id                  = file_id,
        missing_handling         = MissingHandlingEnum(missing_handling),
        outlier_method           = OutlierMethodEnum(outlier_method),
        outlier_action           = OutlierActionEnum(outlier_action),
        outlier_param            = outlier_param,
        column_missing_overrides = column_missing_overrides or {},
        column_outlier_overrides = column_outlier_overrides or {},
        column_type_changes      = column_type_changes or {},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_preprocessing_job(db: Session, file_id: int) -> Optional[PreprocessingJob]:
    """Get the latest preprocessing job for a file."""
    return (
        db.query(PreprocessingJob)
        .filter(PreprocessingJob.file_id == file_id)
        .order_by(desc(PreprocessingJob.created_at))
        .first()
    )


def update_preprocessing_job(
    db: Session,
    job_id: int,
    status: str,
    cleaned_file_binary: bytes = None,
    cleaned_row_count: int = None,
    cleaned_col_count: int = None,
    error_message: str = None,
    change_log: List = None,
) -> Optional[PreprocessingJob]:
    job = db.query(PreprocessingJob).filter(PreprocessingJob.id == job_id).first()
    if not job:
        return None

    # Accept both enum values and case-insensitive raw strings
    if isinstance(status, PreprocessingStatusEnum):
        job.status = status
    else:
        # Normalize common lowercase inputs like "completed"
        normalized = str(status).strip().lower()
        mapping = {
            "pending": PreprocessingStatusEnum.PENDING,
            "running": PreprocessingStatusEnum.RUNNING,
            "completed": PreprocessingStatusEnum.COMPLETED,
            "failed": PreprocessingStatusEnum.FAILED,
        }
        job.status = mapping.get(normalized, PreprocessingStatusEnum.PENDING)

    if cleaned_file_binary is not None:
        job.cleaned_file_binary = cleaned_file_binary
    if cleaned_row_count is not None:
        job.cleaned_row_count = cleaned_row_count
    if cleaned_col_count is not None:
        job.cleaned_col_count = cleaned_col_count
    if error_message is not None:
        job.error_message = error_message
    if change_log is not None:
        job.change_log = sanitize_data(change_log)
    if status == "completed":
        job.completed_at = datetime.utcnow()

    db.commit()
    db.refresh(job)
    return job


def append_cell_edit(
    db: Session,
    file_id: int,
    row_idx: int,
    col_name: str,
    old_value: Any,
    new_value: Any,
) -> Optional[PreprocessingJob]:
    """Append a cell edit to the active preprocessing job's edit log."""
    job = get_preprocessing_job(db, file_id)
    if not job:
        return None
    def _json_safe(value: Any):
        if isinstance(value, np.generic):
            return value.item()
        if isinstance(value, np.ndarray):
            return value.tolist()
        return value

    edits = list(job.cell_edits or [])
    edits.append({
        "row_idx":   int(row_idx) if isinstance(row_idx, np.generic) else row_idx,
        "col_name":  col_name,
        "old_value": _json_safe(old_value),
        "new_value": _json_safe(new_value),
        "timestamp": datetime.utcnow().isoformat(),
    })
    job.cell_edits = edits
    db.commit()
    db.refresh(job)
    return job


# ──────────────────────────── VISUALIZATIONS ─────────────────────────────────

def save_visualization(
    db: Session,
    file_id: int,
    chart_type: str,
    chart_config: Dict,
    chart_title: str = None,
    x_column: str = None,
    y_column: str = None,
    group_by: str = None,
    image_binary: bytes = None,
    image_format: str = None,
    chart_metadata: Dict = None,
) -> Visualization:
    """
    Save a chart to the database.

    Two complementary storage approaches:
      1. chart_config  – JSON spec (Recharts / Chart.js) for the frontend to render
      2. image_binary  – PNG/SVG bytes for static export / PDF

    Both are optional; typically you'll use at least one.
    """
    viz = Visualization(
        file_id       = file_id,
        chart_type    = ChartTypeEnum(chart_type),
        chart_title   = chart_title,
        x_column      = x_column,
        y_column      = y_column,
        group_by      = group_by,
        chart_config  = chart_config,
        image_binary  = image_binary,
        image_format  = image_format,
        chart_metadata = chart_metadata or {},
    )
    db.add(viz)
    db.commit()
    db.refresh(viz)
    return viz


def get_visualizations(db: Session, file_id: int) -> List[Visualization]:
    return (
        db.query(Visualization)
        .filter(Visualization.file_id == file_id)
        .order_by(desc(Visualization.created_at))
        .all()
    )


def get_visualization_by_id(db: Session, viz_id: int) -> Optional[Visualization]:
    return db.query(Visualization).filter(Visualization.id == viz_id).first()


def delete_visualization(db: Session, viz_id: int) -> bool:
    viz = get_visualization_by_id(db, viz_id)
    if not viz:
        return False
    db.delete(viz)
    db.commit()
    return True


# ──────────────────────────── ML MODELS ──────────────────────────────────────

def save_trained_model(
    db: Session,
    user_id: int,
    model_name: str,
    model_type: str,
    model_binary: bytes,
    metrics: Dict = None,
    hyperparameters: Dict = None,
    feature_names: List[str] = None,
    feature_importance: Dict = None,
    target_column: str = None,
    training_row_count: int = None,
    training_col_count: int = None,
    training_time_seconds: float = None,
    training_samples: int = None,
    test_samples: int = None,
    description: str = None,
    visibility: str = "private",
    tags: List[str] = None,
    created_by: str = None,
    file_id: int = None,
) -> TrainedModel:
    m = metrics or {}
    try:
        mt = MLModelTypeEnum(model_type)           # lookup by value e.g. "XGBoost"
    except ValueError:
        try:
            mt = MLModelTypeEnum[model_type]       # lookup by name  e.g. "XGBOOST"
        except KeyError:
            mt = MLModelTypeEnum.GRADIENT_BOOSTING
    model = TrainedModel(
        user_id               = user_id,
        file_id               = file_id,
        model_name            = model_name,
        model_type            = mt,
        model_binary          = model_binary,
        model_size            = len(model_binary),
        training_config       = hyperparameters or {},
        metrics               = m,
        feature_columns       = feature_names or [],
        target_column         = target_column,
        training_row_count    = training_row_count,
        training_col_count    = training_col_count,
        description           = description,
        # flat metric columns
        accuracy              = m.get("accuracy"),
        mae                   = m.get("mae"),
        r2_score              = m.get("r2"),
        precision_score       = m.get("precision"),
        recall_score          = m.get("recall"),
        f1_score              = m.get("f1"),
        rmse                  = m.get("rmse"),
        training_time_seconds = training_time_seconds,
        training_samples      = training_samples,
        test_samples          = test_samples,
        # sharing
        visibility            = visibility,
        tags                  = tags or [],
        created_by            = created_by,
        times_used            = 0,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


def get_model_by_id(db: Session, model_id: int) -> Optional[TrainedModel]:
    return db.query(TrainedModel).filter(TrainedModel.id == model_id).first()


def get_user_models(db: Session, user_id: int) -> List[TrainedModel]:
    return (
        db.query(TrainedModel)
        .filter(TrainedModel.user_id == user_id, TrainedModel.is_active == True)
        .order_by(desc(TrainedModel.created_at))
        .all()
    )


def list_models(
    db: Session,
    user_id: int,
    scope: str = "my",          # "my" | "public" | "all"
    model_type: str = None,
    sort_by: str = "date",       # "accuracy" | "date" | "times_used"
) -> List[TrainedModel]:
    q = db.query(TrainedModel).filter(TrainedModel.is_active == True)
    if scope == "my":
        q = q.filter(TrainedModel.user_id == user_id)
    elif scope == "public":
        q = q.filter(TrainedModel.visibility == "public")
    else:
        q = q.filter(
            (TrainedModel.user_id == user_id) | (TrainedModel.visibility == "public")
        )
    if model_type:
        try:
            q = q.filter(TrainedModel.model_type == MLModelTypeEnum(model_type))
        except ValueError:
            pass
    if sort_by == "accuracy":
        q = q.order_by(desc(TrainedModel.accuracy))
    elif sort_by == "times_used":
        q = q.order_by(desc(TrainedModel.times_used))
    else:
        q = q.order_by(desc(TrainedModel.created_at))
    return q.all()


def increment_model_usage(db: Session, model_id: int) -> None:
    db.execute(
        text(
            "UPDATE trained_models SET times_used = times_used + 1, "
            "last_used_at = NOW() WHERE id = :id"
        ),
        {"id": model_id},
    )
    db.commit()


def delete_trained_model(db: Session, model_id: int, user_id: int) -> bool:
    model = db.query(TrainedModel).filter(
        TrainedModel.id == model_id,
        TrainedModel.user_id == user_id,
    ).first()
    if not model:
        return False
    model.is_active = False
    db.commit()
    return True


def delete_model(db: Session, model_id: int) -> bool:
    model = get_model_by_id(db, model_id)
    if not model:
        return False
    model.is_active = False  # soft delete
    db.commit()
    return True


# ──────────────────────────── AI SUMMARIES ───────────────────────────────────

def get_ai_summary_by_session(db: Session, session_id: str) -> Optional[AiSummary]:
    return db.query(AiSummary).filter(AiSummary.session_id == session_id).first()


def upsert_ai_summary(
    db: Session,
    file_id: int,
    session_id: str,
    summary: str,
    config: Dict = None,
) -> AiSummary:
    record = get_ai_summary_by_session(db, session_id)
    if record:
        record.summary = summary
        record.config = config or {}
        db.commit()
        db.refresh(record)
        return record
    record = AiSummary(
        file_id=file_id,
        session_id=session_id,
        summary=summary,
        config=config or {},
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


# ──────────────────────────── PREPROCESSING LOGS ────────────────────────────

def create_preprocessing_log(
    db: Session,
    session_id: str,
    column_name: str,
    operation: str,
    parameters: Optional[Dict[str, Any]] = None,
    file_id: Optional[int] = None,
    user_id: Optional[int] = None,
    confidence: Optional[float] = None,
    risk_level: Optional[str] = None,
    original_issue: Optional[str] = None,
    reason: Optional[str] = None,
    user: Optional[str] = None,
) -> PreprocessingLog:
    log = PreprocessingLog(
        session_id=session_id,
        file_id=file_id,
        user_id=user_id,
        column_name=column_name,
        operation=operation,
        parameters=parameters or {},
        confidence=confidence,
        risk_level=risk_level,
        original_issue=original_issue,
        reason=reason,
        user=user,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def get_preprocessing_logs(db: Session, session_id: str) -> List[PreprocessingLog]:
    return (
        db.query(PreprocessingLog)
        .filter(PreprocessingLog.session_id == session_id)
        .order_by(PreprocessingLog.applied_at)
        .all()
    )


def delete_preprocessing_logs(db: Session, session_id: str) -> int:
    """Delete all preprocessing logs for a session. Returns deleted row count."""
    deleted = (
        db.query(PreprocessingLog)
        .filter(PreprocessingLog.session_id == session_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


# ──────────────────────────── PROFILE STATUS ─────────────────────────────────

def save_profile_status(
    db: Session,
    file_id: int,
    ready: bool,
    error: str = None,
    merged_cells: list = None,
    has_merges: bool = False,
) -> None:
    """Persist profiling completion status onto the preprocessing_jobs row so
    the polling endpoint survives server restarts."""
    db.execute(
        text(
            "UPDATE preprocessing_jobs "
            "SET profiling_ready = :ready, profiling_error = :error, "
            "    merged_cells_json = :merged, has_merges = :hm "
            "WHERE file_id = :fid "
            "ORDER BY created_at DESC LIMIT 1"
        ),
        {
            "ready":  int(ready),
            "error":  error,
            "merged": json.dumps(merged_cells or []),
            "hm":     int(has_merges),
            "fid":    file_id,
        },
    )
    db.commit()


def get_profile_status_from_db(db: Session, session_id: str) -> Optional[dict]:
    """Return the persisted profiling status for a session, or None if not found."""
    row = db.execute(
        text(
            "SELECT pj.profiling_ready, pj.profiling_error, "
            "       pj.merged_cells_json, pj.has_merges "
            "FROM preprocessing_jobs pj "
            "JOIN files f ON f.id = pj.file_id "
            "WHERE f.session_id = :sid "
            "ORDER BY pj.created_at DESC LIMIT 1"
        ),
        {"sid": session_id},
    ).mappings().first()
    return dict(row) if row else None
