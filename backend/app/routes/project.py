# routes/project.py
#
# Delta-based dictionary approach for Applied Steps.
# Each cleaning action is stored as a step dict in sessions.applied_steps.
# On every mutation the backend replays the full chain from original_file_binary
# so the working file_binary always reflects the current step list.

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import pandas as pd
import numpy as np
from io import BytesIO
import asyncio, gzip, hashlib, json, logging, threading
from collections import OrderedDict
from threading import Lock

_log = logging.getLogger(__name__)


# ──────────────────────────── IN-MEMORY DF CACHE ─────────────────────────────
# Avoids re-deserializing file_binary from the DB on every get_project call.
# Keyed by session_id; validated by a fingerprint of the current step list.
# LRU eviction keeps at most _DF_CACHE_MAX sessions in memory at once.

_DF_CACHE_MAX = 15

class _DFCache:
    def __init__(self, maxsize: int = _DF_CACHE_MAX):
        self._store: OrderedDict = OrderedDict()        # session_id → {df, fp}
        self._step_store: OrderedDict = OrderedDict()   # (session_id, step_index) → {df, prefix_fp}
        self._maxsize = maxsize
        self._step_maxsize = maxsize * 8
        self._lock = Lock()

    def _fp(self, steps: List[Dict]) -> str:
        return hashlib.md5(
            json.dumps(steps, sort_keys=True, default=str).encode()
        ).hexdigest()

    # ── current state (used by get_project) ───────────────────────────────────

    def put(self, session_id: str, df: pd.DataFrame, steps: List[Dict]) -> None:
        fp = self._fp(steps)
        with self._lock:
            self._store.pop(session_id, None)
            if len(self._store) >= self._maxsize:
                self._store.popitem(last=False)
            self._store[session_id] = {"df": df.copy(), "fp": fp}

    def get(self, session_id: str, steps: List[Dict]) -> Optional[pd.DataFrame]:
        fp = self._fp(steps)
        with self._lock:
            entry = self._store.get(session_id)
            if entry and entry["fp"] == fp:
                self._store.move_to_end(session_id)
                return entry["df"].copy()
        return None

    # ── step previews (used by preview_at_step) ───────────────────────────────
    # Keyed by prefix of steps up to step_index so adding steps at the end
    # does NOT invalidate earlier previews.

    def put_step(self, session_id: str, step_index: int, df: pd.DataFrame, steps_prefix: List[Dict]) -> None:
        key = (session_id, step_index)
        fp = self._fp(steps_prefix)
        with self._lock:
            self._step_store.pop(key, None)
            if len(self._step_store) >= self._step_maxsize:
                self._step_store.popitem(last=False)
            self._step_store[key] = {"df": df.copy(), "fp": fp}

    def get_step(self, session_id: str, step_index: int, steps_prefix: List[Dict]) -> Optional[pd.DataFrame]:
        key = (session_id, step_index)
        fp = self._fp(steps_prefix)
        with self._lock:
            entry = self._step_store.get(key)
            if entry and entry["fp"] == fp:
                self._step_store.move_to_end(key)
                return entry["df"].copy()
        return None

    def invalidate(self, session_id: str) -> None:
        with self._lock:
            self._store.pop(session_id, None)
            to_del = [k for k in self._step_store if k[0] == session_id]
            for k in to_del:
                del self._step_store[k]


_df_cache = _DFCache()

# ── Background save tracking ──────────────────────────────────────────────────
# One daemon thread per session; a new save request is skipped if one is
# already running for that session (the user can press Save again to flush).
_save_threads: Dict[str, threading.Thread] = {}
_save_lock = Lock()


from app.db.connection import get_db
from app.db import crud
from app.db.crud import invalidate_session_caches
from app.routes.profiler_cache import bytes_to_df, set_profiler, remove_profiler
from app.routes.logs import invalidate_logs_cache
from app.services.ETL.data_profiler import DataProfiler
from app.services.ETL.Cleaning import (
    handle_missing_values,
    handle_outliers,
    handle_duplicates,
    handle_type_inconsistencies,
    MissingValueConfig,
    OutlierConfig,
    DuplicateConfig,
    TypeInconsistencyConfig,
)
from app.utils.helpers import sanitize_data

router = APIRouter(prefix="/api/project", tags=["Project"])


# ──────────────────────────── MODELS ─────────────────────────────────────────

class StepRequest(BaseModel):
    step: Dict[str, Any]
    user_id: Optional[str] = None
    file_id: Optional[int] = None


class StepUpdateRequest(BaseModel):
    step: Dict[str, Any]


# ──────────────────────────── REPLAY ENGINE ──────────────────────────────────

def _df_to_bytes(df: pd.DataFrame, filename: str) -> bytes:
    buf = BytesIO()
    df.to_csv(buf, index=False)  # always CSV internally; format at export time
    return gzip.compress(buf.getvalue(), compresslevel=1)  # level 1: fast, ~5-6x smaller


def _restore_dtypes(df: pd.DataFrame, original_dtypes: Dict[str, Any]) -> pd.DataFrame:
    """
    After a cleaning step, coerce columns that degraded back to their original
    numeric dtype.  Text columns are intentionally left alone.
    Handles two cases:
      1. numeric → object  (e.g. fillna with mixed types)
      2. integer → float   (e.g. .loc assignment with float bound)
    """
    existing = set(df.columns)
    for col, orig_dtype in original_dtypes.items():
        if col not in existing:
            continue
        try:
            current_dtype = df[col].dtype
        except KeyError:
            continue
        if current_dtype == orig_dtype:
            continue

        # Case 1: was numeric, now object — try to coerce back to numeric
        if pd.api.types.is_object_dtype(current_dtype) and pd.api.types.is_numeric_dtype(orig_dtype):
            try:
                coerced = pd.to_numeric(df[col], errors="coerce")
                if coerced.isna().all():
                    continue
                if pd.api.types.is_integer_dtype(orig_dtype):
                    df[col] = coerced.round().astype("Int64")
                else:
                    df[col] = coerced
            except Exception:
                pass

        # Case 2: was integer, now float — restore to nullable integer when safe
        elif pd.api.types.is_integer_dtype(orig_dtype) and pd.api.types.is_float_dtype(current_dtype):
            try:
                coerced = pd.to_numeric(df[col], errors="coerce")
                if not coerced.isna().all():
                    df[col] = coerced.round().astype("Int64")
            except Exception:
                pass
    return df


def _coerce_cell_value(value, dtype):
    """Coerce a JSON-decoded cell value to match the target column dtype."""
    is_empty = value is None or value == ""
    # Nullable integer (Int8/Int16/Int32/Int64/UInt*) — use pd.NA for empty
    if pd.api.types.is_integer_dtype(dtype):
        if is_empty:
            return pd.NA if pd.api.types.is_extension_array_dtype(dtype) else None
        try:
            return int(float(str(value)))
        except (ValueError, TypeError):
            return pd.NA if pd.api.types.is_extension_array_dtype(dtype) else None
    # Float
    if pd.api.types.is_float_dtype(dtype):
        if is_empty:
            return float("nan")
        try:
            return float(str(value))
        except (ValueError, TypeError):
            return float("nan")
    # Boolean
    if pd.api.types.is_bool_dtype(dtype):
        if is_empty:
            return pd.NA if pd.api.types.is_extension_array_dtype(dtype) else None
        return str(value).strip().lower() in ("true", "1", "yes")
    # Datetime
    if pd.api.types.is_datetime64_any_dtype(dtype):
        if is_empty:
            return pd.NaT
        try:
            return pd.Timestamp(value)
        except Exception:
            return pd.NaT
    # Text / object — keep as-is; empty string stays empty string
    return value


def _apply_step(df: pd.DataFrame, step: Dict[str, Any]) -> pd.DataFrame:
    """Apply a single step dict to a DataFrame. Returns the transformed DataFrame."""
    step_type = step.get("type")
    payload = step.get("payload") or {}
    # Snapshot dtypes so we can restore numeric columns that cleaning upcasts to object
    original_dtypes = {col: df[col].dtype for col in df.columns}

    if step_type == "impute":
        strategy = payload.get("strategy", "mode")
        # Normalise frontend strategy names → MissingValueConfig.method literals
        _impute_map = {
            "remove_rows": "remove",
            "omit": "remove",
            "knn_impute": "knn",
        }
        strategy = _impute_map.get(strategy, strategy)
        columns = payload.get("columns") or ([step["column"]] if step.get("column") else [])
        options = payload.get("options") or {}
        # For fill-type strategies (forward_fill, constant, etc.) with no specified
        # columns, apply across the whole dataframe — this covers the "fill merged
        # cells" use-case where all columns should be filled.
        if not columns:
            fill_all = strategy in ("forward_fill", "backward_fill", "constant", "mode", "mean", "median")
            if fill_all:
                columns = list(df.columns)
            else:
                return df
        config = MissingValueConfig(method=strategy, columns=columns, **{
            k: v for k, v in options.items()
            if k in MissingValueConfig.model_fields
        })
        df, _ = handle_missing_values(df, config)

    elif step_type == "outlier":
        strategy = payload.get("strategy", "iqr_cap")
        columns = payload.get("columns") or ([step["column"]] if step.get("column") else [])
        if not columns:
            return df
        # strategy format: "{method}_{action}" e.g. "iqr_cap", "zscore_remove"
        # Special case: "isolation_forest" has no action suffix
        if strategy == "isolation_forest":
            method, action = "isolation_forest", "cap"
        else:
            parts = strategy.split("_", 1)
            method = parts[0] if len(parts) > 0 else "iqr"
            action = parts[1] if len(parts) > 1 else "cap"
        config = OutlierConfig(method=method, action=action, columns=columns)
        df, _ = handle_outliers(df, config)

    elif step_type == "duplicates":
        strategy = payload.get("strategy", "mark")
        columns = payload.get("columns")
        # map frontend strategy names to DuplicateConfig action
        action_map = {
            "mark": "mark_only",
            "remove": "remove_all",
            "keep_first": "keep_first",
            "keep_last": "keep_last",
            "mark_only": "mark_only",
            "remove_all": "remove_all",
        }
        action = action_map.get(strategy, "mark_only")
        config = DuplicateConfig(action=action, subset_columns=columns or None)
        df, _ = handle_duplicates(df, config)

    elif step_type == "type_inconsistency":
        columns = payload.get("columns") or ([step["column"]] if step.get("column") else [])
        if not columns:
            return df
        method = payload.get("method", "mode")
        if method == "remove":
            # Drop rows where any selected column has a type inconsistency.
            from app.services.ETL.data_profiler import DataProfiler as _DP
            _profiler = _DP(df)
            bad_indices: set = set()
            for col in columns:
                if col not in df.columns:
                    continue
                _, inconsistent_indices, _ = _profiler._detect_type_and_inconsistencies(df[col])
                bad_indices.update(inconsistent_indices)
            valid = [i for i in bad_indices if i in df.index]
            if valid:
                df = df.drop(index=valid).reset_index(drop=True)
        elif method in ("uppercase", "lowercase", "trim_whitespace", "normalize_case"):
            for col in columns:
                if col not in df.columns:
                    continue
                s = df[col].astype(str)
                if method == "uppercase":
                    df[col] = s.str.upper()
                else:
                    df[col] = s.str.lower()
        else:
            config_kwargs = {k: v for k, v in payload.items()
                            if k in TypeInconsistencyConfig.model_fields and k != "columns"}
            config = TypeInconsistencyConfig(columns=columns, **config_kwargs)
            df, _ = handle_type_inconsistencies(df, config)

    elif step_type == "type_conversion":
        column = payload.get("column") or step.get("column")
        target_type = payload.get("targetType") or step.get("edited_value")
        if column and target_type and column in df.columns:
            t = str(target_type).lower()
            try:
                if t in ("integer", "int"):
                    df[column] = pd.to_numeric(df[column], errors="coerce").round().astype("Int64")
                elif t in ("decimal", "float"):
                    df[column] = pd.to_numeric(df[column], errors="coerce")
                elif t in ("datetime", "date"):
                    df[column] = pd.to_datetime(df[column], errors="coerce")
                else:
                    df[column] = df[column].astype(str)
            except Exception:
                pass

    elif step_type == "text_transform":
        operation = payload.get("operation") or step.get("edited_value", "")
        columns = payload.get("columns") or ([step["column"]] if step.get("column") else [])
        for col in columns:
            if col not in df.columns:
                continue
            try:
                if operation == "uppercase":
                    df[col] = df[col].astype(str).str.upper()
                elif operation == "lowercase":
                    df[col] = df[col].astype(str).str.lower()
                elif operation == "trim":
                    df[col] = df[col].astype(str).str.strip()
                elif operation == "capitalize":
                    df[col] = df[col].astype(str).str.title()
                elif operation == "remove_special_chars":
                    df[col] = df[col].astype(str).str.replace(r"[^A-Za-z0-9\s]", "", regex=True)
                    # Cells that were entirely special chars are now "" or whitespace; treat as missing
                    df[col] = df[col].where(df[col].str.strip().ne(""), np.nan)
                elif operation == "replace_values":
                    replacements = payload.get("replacements", {})
                    if replacements:
                        for find_val, replace_val in replacements.items():
                            mask = df[col].astype(str).str.lower() == str(find_val).lower()
                            df[col] = df[col].where(~mask, replace_val)
                elif operation == "split_by_delimiter":
                    delimiter = payload.get("delimiter", "")
                    keep = payload.get("keep", "before")
                    if delimiter:
                        parts = df[col].astype(str).str.partition(delimiter)
                        if keep == "after":
                            # When delimiter not found, partition[1] is "" — fall back to original
                            df[col] = parts[2].where(parts[1] != "", parts[0])
                        else:
                            df[col] = parts[0]
            except Exception:
                pass

    elif step_type == "ignore_error":
        pass  # no-op: data unchanged, ignore flags are tracked on the frontend

    elif step_type == "rename_column":
        old_name = payload.get("oldName") or step.get("column")
        new_name = payload.get("newName") or step.get("edited_value")
        if old_name and new_name and old_name in df.columns and new_name not in df.columns:
            df = df.rename(columns={old_name: new_name})

    elif step_type == "duplicate_column":
        column = payload.get("column") or step.get("column")
        new_name = payload.get("newName") or step.get("edited_value")
        if column and new_name and column in df.columns and new_name not in df.columns:
            df[new_name] = df[column].copy()

    elif step_type == "merge_columns":
        columns = payload.get("columns", [])
        new_name = payload.get("newName") or step.get("edited_value")
        separator = payload.get("separator", " ")
        if len(columns) >= 2 and new_name:
            valid = [c for c in columns if c in df.columns]
            if len(valid) >= 2:
                df[new_name] = df[valid].apply(
                    lambda row: separator.join(str(v) for v in row if pd.notna(v) and str(v) != "nan"),
                    axis=1
                )

    elif step_type == "drop_column":
        col = payload.get("colName") or step.get("column")
        if col:
            df = df.drop(columns=[col], errors="ignore")

    elif step_type == "delete_rows":
        indices = []
        if step.get("row_index") is not None:
            indices = [step["row_index"]]
        elif payload.get("rowIndices"):
            indices = payload["rowIndices"]
        valid = [i for i in indices if i in df.index]
        if valid:
            df = df.drop(index=valid).reset_index(drop=True)

    elif step_type == "cell_edit":
        col = payload.get("column") or step.get("column")
        row_index = payload.get("row_index") if payload.get("row_index") is not None else step.get("row_index")
        new_value = payload.get("edited_value") if payload.get("edited_value") is not None else step.get("edited_value")
        if col and row_index is not None and col in df.columns and row_index in df.index:
            coerced = _coerce_cell_value(new_value, df[col].dtype)
            try:
                df.at[row_index, col] = coerced
            except Exception:
                # Last resort: cast column to object so any value is accepted
                df[col] = df[col].astype(object)
                df.at[row_index, col] = new_value

    elif step_type in ("add_rows", "Added Rows"):
        row_data = payload.get("row_data") or step.get("params", {}).get("row_data")
        if row_data:
            if isinstance(row_data, list):
                new_rows = [{c: r.get(c, "") for c in df.columns} for r in row_data]
            else:
                new_rows = [{c: row_data.get(c, "") for c in df.columns}]
            df = pd.concat([df, pd.DataFrame(new_rows)], ignore_index=True)

    elif step_type in ("add_column", "Added Column"):
        col = payload.get("column_name") or step.get("column")
        if col and col not in df.columns:
            df[col] = ""

    # Restore any numeric columns that cleaning ops silently upcasted to object
    df = _restore_dtypes(df, original_dtypes)
    return df


def replay_steps(original_bytes: bytes, filename: str, steps: List[Dict]) -> pd.DataFrame:
    """Load original file and replay all steps in order."""
    import logging
    _log = logging.getLogger(__name__)
    df = bytes_to_df(original_bytes, filename)
    for i, step in enumerate(steps):
        try:
            df = _apply_step(df, step)
        except Exception as exc:
            _log.warning("replay_steps: step %d (%s) failed: %s", i, step.get("type"), exc)
    return df


def _commit_replay(
    db: Session,
    session_id: str,
    steps: List[Dict],
    file_record,
    user_id: Optional[str] = None,
):
    """Replay steps, persist file_binary + session, rebuild profiler cache.
    Also materialises a snapshot for every step index so preview-step
    and page reloads can serve cached binaries without replaying.
    """
    original_bytes = file_record.original_file_binary or file_record.file_binary
    filename = file_record.file_name

    # Replay incrementally, saving a snapshot after each step.
    # This is the same work replay_steps() does, just captured per-step.
    import logging
    _log = logging.getLogger(__name__)

    df = bytes_to_df(original_bytes, filename)

    # Snapshot for "source" state (step_index = -1)
    try:
        crud.save_step_snapshot(db, session_id, -1, original_bytes)
    except Exception as exc:
        _log.warning("snapshot -1 failed: %s", exc)

    for i, step in enumerate(steps):
        try:
            df = _apply_step(df, step)
        except Exception as exc:
            _log.warning("_commit_replay: step %d (%s) failed: %s", i, step.get("type"), exc)
        _df_cache.put_step(session_id, i, df, steps[: i + 1])
        try:
            snap_bytes = _df_to_bytes(df, filename)
            crud.save_step_snapshot(db, session_id, i, snap_bytes)
        except Exception as exc:
            _log.warning("snapshot %d failed: %s", i, exc)

    # Purge any snapshots that are now past the end of the list
    crud.delete_step_snapshots_from(db, session_id, len(steps))

    # Persist the cleaned working copy via raw SQL so the update lands even when
    # file_record is a detached ORM object returned from the in-memory cache.
    cleaned_bytes = _df_to_bytes(df, filename)
    db.execute(
        sql_text(
            "UPDATE files SET file_binary = :binary, row_count = :rows, "
            "column_count = :cols WHERE session_id = :sid"
        ),
        {
            "binary": cleaned_bytes,
            "rows": int(len(df)),
            "cols": int(len(df.columns)),
            "sid": session_id,
        },
    )
    db.commit()
    # Keep the in-memory object consistent for same-request reads.
    file_record.file_binary = cleaned_bytes
    file_record.row_count = int(len(df))
    file_record.column_count = int(len(df.columns))
    invalidate_session_caches(session_id)

    # Rebuild profiler cache from the fresh DataFrame
    remove_profiler(session_id)
    profiler = DataProfiler(df)
    set_profiler(session_id, profiler)

    # Persist the step list in sessions table
    crud.upsert_session_steps(
        db,
        session_id=session_id,
        user_id=user_id,
        file_id=file_record.id,
        steps=steps,
    )

    _df_cache.put(session_id, df, steps)
    return df, profiler


def _commit_replay_from(
    db: Session,
    session_id: str,
    steps: List[Dict],
    file_record,
    from_index: int = 0,
    user_id: Optional[str] = None,
):
    """Optimised replay for delete/update: starts from an existing checkpoint at
    from_index-1 instead of replaying all steps from the original file.

    Snapshots 0..from_index-1 are still valid and are left untouched.
    Only snapshots from_index..len(steps)-1 are rewritten.
    Falls back to _commit_replay if no usable checkpoint is found.
    """
    filename = file_record.file_name

    df = None
    if from_index > 0:
        # Try in-memory step cache first (fingerprint of steps[:from_index] is unchanged)
        df = _df_cache.get_step(session_id, from_index - 1, steps[:from_index])
        if df is not None:
            df = df.copy()
        else:
            snap = crud.get_step_snapshot(db, session_id, from_index - 1)
            if snap is not None:
                df = bytes_to_df(snap, filename)

    if df is None:
        # No checkpoint found — fall back to full replay
        return _commit_replay(db, session_id, steps, file_record, user_id)

    for i, step in enumerate(steps[from_index:], start=from_index):
        try:
            df = _apply_step(df, step)
        except Exception as exc:
            _log.warning("_commit_replay_from: step %d (%s) failed: %s", i, step.get("type"), exc)
        _df_cache.put_step(session_id, i, df, steps[: i + 1])
        try:
            snap_bytes = _df_to_bytes(df, filename)
            crud.save_step_snapshot(db, session_id, i, snap_bytes)
        except Exception as exc:
            _log.warning("snapshot %d failed: %s", i, exc)

    crud.delete_step_snapshots_from(db, session_id, len(steps))

    cleaned_bytes = _df_to_bytes(df, filename)
    db.execute(
        sql_text(
            "UPDATE files SET file_binary = :binary, row_count = :rows, "
            "column_count = :cols WHERE session_id = :sid"
        ),
        {
            "binary": cleaned_bytes,
            "rows": int(len(df)),
            "cols": int(len(df.columns)),
            "sid": session_id,
        },
    )
    db.commit()
    file_record.file_binary = cleaned_bytes
    file_record.row_count = int(len(df))
    file_record.column_count = int(len(df.columns))
    invalidate_session_caches(session_id)

    remove_profiler(session_id)
    profiler = DataProfiler(df)
    set_profiler(session_id, profiler)

    crud.upsert_session_steps(
        db,
        session_id=session_id,
        user_id=user_id,
        file_id=file_record.id,
        steps=steps,
    )

    _df_cache.put(session_id, df, steps)
    return df, profiler


def _commit_add_step(
    db: Session,
    session_id: str,
    new_step: Dict,
    steps: List[Dict],
    file_record,
    user_id: Optional[str] = None,
):
    """Fast incremental path for appending a single step.

    Instead of replaying all N steps from original_file_binary, we apply
    only the new step to file_binary (which already reflects all prior steps).
    This reduces the work from O(N) to O(1) per append.

    Only the new snapshot is written to DB — existing snapshots are still valid.
    """
    import logging
    _log = logging.getLogger(__name__)

    filename = file_record.file_name

    # Fast path: in-memory df cache keyed by step fingerprint.
    # On a cache miss (server restart, LRU eviction) replay from original_file_binary
    # so all previous steps are correctly applied before adding the new one.
    steps_before = steps[:-1]
    df = _df_cache.get(session_id, steps_before)
    if df is None:
        original_bytes = file_record.original_file_binary or file_record.file_binary
        if steps_before:
            try:
                df = replay_steps(original_bytes, filename, steps_before)
            except Exception as exc:
                _log.warning("_commit_add_step: replay fallback failed: %s", exc)
                df = bytes_to_df(original_bytes, filename)
        else:
            df = bytes_to_df(original_bytes, filename)

    try:
        df = _apply_step(df, new_step)
    except Exception as exc:
        _log.warning("_commit_add_step: step (%s) failed: %s", new_step.get("type"), exc)

    new_index = len(steps) - 1  # steps already includes the new step

    # Only write lightweight counts — the expensive file_binary blob write is
    # deferred until the user explicitly saves (POST /{session_id}/save).
    # Cold-start cache misses fall back to replay_steps(original + steps).
    db.execute(
        sql_text(
            "UPDATE files SET row_count = :rows, column_count = :cols "
            "WHERE session_id = :sid"
        ),
        {"rows": int(len(df)), "cols": int(len(df.columns)), "sid": session_id},
    )
    db.commit()
    file_record.row_count = int(len(df))
    file_record.column_count = int(len(df.columns))
    invalidate_session_caches(session_id)

    crud.upsert_session_steps(
        db,
        session_id=session_id,
        user_id=user_id,
        file_id=file_record.id,
        steps=steps,
    )

    _df_cache.put(session_id, df, steps)
    _df_cache.put_step(session_id, new_index, df, steps)
    return df, None


def _preview_rows(df: pd.DataFrame, limit: int = 100) -> List[Dict]:
    preview = df.head(limit).copy()
    preview.insert(0, "_index", range(len(preview)))
    return sanitize_data(preview.to_dict(orient="records"))


def _preview_rows_with_issues(df: pd.DataFrame, profiler, limit: int = 100) -> List[Dict]:
    """Like _preview_rows but annotates each cell with live issue data from profiler."""
    if profiler is None:
        return _preview_rows(df, limit)
    rows = []
    for i, (idx, row_ser) in enumerate(df.head(limit).iterrows()):
        if i >= limit:
            break
        row_data = {"_index": int(idx)}
        for col in df.columns:
            value = row_ser[col]
            try:
                issues = profiler._get_cell_issues(int(idx), col)
                row_data[col] = {
                    "value": None if pd.isna(value) else value,
                    "display_value": profiler._format_display_value(value),
                    "issues": [{"type": iss.issue_type.value, **iss.details} for iss in issues],
                }
            except Exception:
                row_data[col] = {"value": None if pd.isna(value) else value, "display_value": str(value), "issues": []}
        rows.append(row_data)
    return sanitize_data(rows)


# ──────────────────────────── ENDPOINTS ──────────────────────────────────────

@router.get("/{session_id}")
async def get_project(session_id: str, db: Session = Depends(get_db)):
    """
    Return the current step list and a data preview.
    No replay needed — file_binary is always up-to-date after mutations.
    """
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    session = crud.get_session_record(db, session_id)
    steps = session.applied_steps if session else []

    df = _df_cache.get(session_id, steps)
    if df is None:
        # file_binary may be stale (deferred writes). Always replay from
        # original + steps so the user sees the correct current state.
        orig = file_record.original_file_binary
        if orig:
            try:
                df = replay_steps(bytes(orig), file_record.file_name, steps)
                _df_cache.put(session_id, df, steps)
            except Exception:
                df = None
        if df is None:
            try:
                df = bytes_to_df(file_record.file_binary, file_record.file_name)
            except Exception:
                raise HTTPException(422, "Could not parse stored file — please re-upload.")
    columns = list(df.columns)

    return JSONResponse(sanitize_data({
        "success": True,
        "session_id": session_id,
        "file_id": file_record.id,
        "steps": steps,
        "columns": columns,
        "data": _preview_rows(df),
        "total_rows": int(len(df)),
        "total_columns": int(len(columns)),
    }))


@router.post("/{session_id}/save")
async def save_session(session_id: str, db: Session = Depends(get_db)):
    """Persist the current in-memory DataFrame to file_binary in the DB.

    The HTTP response returns immediately — the actual serialisation and write
    happen on a daemon thread so the caller is never blocked.
    """
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    session = crud.get_session_record(db, session_id)
    steps = session.applied_steps if session else []

    df = _df_cache.get(session_id, steps)
    if df is None:
        return JSONResponse({"status": "nothing_to_save"})

    filename = file_record.file_name or ""

    with _save_lock:
        existing = _save_threads.get(session_id)
        if existing and existing.is_alive():
            return JSONResponse({"status": "in_progress"})

        def _do_save():
            from app.db.connection import SessionLocal
            save_db = SessionLocal()
            try:
                new_bytes = _df_to_bytes(df, filename)
                save_db.execute(
                    sql_text("UPDATE files SET file_binary = :b WHERE session_id = :sid"),
                    {"b": new_bytes, "sid": session_id},
                )
                save_db.commit()
                _log.info("save complete for session %s", session_id)
            except Exception as exc:
                _log.warning("background save failed for %s: %s", session_id, exc)
                try:
                    save_db.rollback()
                except Exception:
                    pass
            finally:
                save_db.close()

        t = threading.Thread(target=_do_save, daemon=True)
        _save_threads[session_id] = t
        t.start()

    return JSONResponse({"status": "saving"})


@router.post("/{session_id}/step")
async def add_step(
    session_id: str,
    body: StepRequest,
    db: Session = Depends(get_db),
):
    """
    Append a step using the fast incremental path (O(1) instead of O(N)).
    Only the new step is applied to file_binary; existing snapshots are untouched.
    """
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    session = crud.get_session_record(db, session_id)
    steps = list(session.applied_steps) if session and session.applied_steps else []
    steps.append(body.step)

    df, _ = _commit_add_step(db, session_id, body.step, steps, file_record, body.user_id)

    # Profile synchronously in a thread-pool worker so the updated issue indices
    # are ready before this response is sent.  run_in_executor keeps the event
    # loop free for other requests while the CPU-bound work runs in a thread.
    fresh_profiler = None
    loop = asyncio.get_event_loop()
    def _do_profile():
        nonlocal fresh_profiler
        try:
            p = DataProfiler(df.copy())
            p.profile()
            remove_profiler(session_id)
            set_profiler(session_id, p)
            fresh_profiler = p
        except Exception as exc:
            _log.warning("add_step: profiling failed for %s: %s", session_id, exc)
    await loop.run_in_executor(None, _do_profile)

    return JSONResponse(sanitize_data({
        "success": True,
        "steps": steps,
        "columns": list(df.columns),
        "data": _preview_rows_with_issues(df, fresh_profiler),
        "total_rows": int(len(df)),
    }))


@router.delete("/{session_id}/steps")
async def clear_all_steps(
    session_id: str,
    db: Session = Depends(get_db),
):
    """Remove all steps, clear preprocessing logs, and restore the original file state."""
    _log = logging.getLogger(__name__)

    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    # ── Phase 1: Clear step list and logs unconditionally (raw SQL) ───────────
    # This runs before replay so steps are wiped even if file restoration fails.
    session_record = crud.get_session_record(db, session_id)
    crud.upsert_session_steps(
        db,
        session_id=session_id,
        user_id=session_record.user_id if session_record else None,
        file_id=file_record.id,
        steps=[],
    )
    crud.delete_preprocessing_logs(db, session_id)
    invalidate_logs_cache(session_id)

    # ── Phase 2: Restore original file state (best-effort) ───────────────────
    try:
        df, _ = _commit_replay(db, session_id, [], file_record)
    except Exception as exc:
        _log.error("clear_all_steps: replay failed (steps already cleared in DB): %s", exc)
        # Fall back to reading whatever binary is stored — data may look
        # processed but step list is already empty in the DB.
        try:
            raw = file_record.original_file_binary or file_record.file_binary
            df = bytes_to_df(raw, file_record.file_name)
        except Exception:
            raise HTTPException(
                500,
                "Applied steps were cleared but the original file could not be parsed. "
                "Please re-upload your file.",
            )

    return JSONResponse(sanitize_data({
        "success": True,
        "steps": [],
        "columns": list(df.columns),
        "data": _preview_rows(df),
        "total_rows": int(len(df)),
    }))


@router.delete("/{session_id}/step/{step_index}")
async def delete_step(
    session_id: str,
    step_index: int,
    db: Session = Depends(get_db),
):
    """
    Remove step at step_index, replay remaining chain from original, persist.
    This is the Power BI model: deleting from the middle re-runs the whole chain.
    """
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    session = crud.get_session_record(db, session_id)
    steps = list(session.applied_steps) if session and session.applied_steps else []

    if step_index < 0 or step_index >= len(steps):
        raise HTTPException(400, f"Step index {step_index} out of range")

    steps.pop(step_index)
    df, _ = _commit_replay_from(db, session_id, steps, file_record, from_index=step_index)
    # Clear logs so the log page stays in sync with the updated step list.
    # The frontend regenerates logs for all remaining steps after this call.
    crud.delete_preprocessing_logs(db, session_id)
    invalidate_logs_cache(session_id)

    fresh_profiler = None
    loop = asyncio.get_event_loop()
    def _do_profile_del():
        nonlocal fresh_profiler
        try:
            p = DataProfiler(df.copy())
            p.profile()
            remove_profiler(session_id)
            set_profiler(session_id, p)
            fresh_profiler = p
        except Exception as exc:
            _log.warning("delete_step: profiling failed for %s: %s", session_id, exc)
    await loop.run_in_executor(None, _do_profile_del)

    return JSONResponse(sanitize_data({
        "success": True,
        "steps": steps,
        "columns": list(df.columns),
        "data": _preview_rows_with_issues(df, fresh_profiler),
        "total_rows": int(len(df)),
    }))


@router.patch("/{session_id}/step/{step_index}")
async def update_step(
    session_id: str,
    step_index: int,
    body: StepUpdateRequest,
    db: Session = Depends(get_db),
):
    """
    Replace step at step_index with new step dict, replay chain, persist.
    """
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    session = crud.get_session_record(db, session_id)
    steps = list(session.applied_steps) if session and session.applied_steps else []

    if step_index < 0 or step_index >= len(steps):
        raise HTTPException(400, f"Step index {step_index} out of range")

    steps[step_index] = body.step
    df, _ = _commit_replay(db, session_id, steps, file_record)

    fresh_profiler = None
    loop = asyncio.get_event_loop()
    def _do_profile_upd():
        nonlocal fresh_profiler
        try:
            p = DataProfiler(df.copy())
            p.profile()
            remove_profiler(session_id)
            set_profiler(session_id, p)
            fresh_profiler = p
        except Exception as exc:
            _log.warning("update_step: profiling failed for %s: %s", session_id, exc)
    await loop.run_in_executor(None, _do_profile_upd)

    return JSONResponse(sanitize_data({
        "success": True,
        "steps": steps,
        "columns": list(df.columns),
        "data": _preview_rows_with_issues(df, fresh_profiler),
        "total_rows": int(len(df)),
    }))


@router.post("/{session_id}/preview-step/{step_index}")
async def preview_at_step(
    session_id: str,
    step_index: int,
    db: Session = Depends(get_db),
):
    """
    Preview-only: replay steps 0..step_index without persisting.
    Used when clicking a step in the Applied Steps panel.
    step_index = -1 returns the original file state.
    """
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    session = crud.get_session_record(db, session_id)
    all_steps = list(session.applied_steps) if session and session.applied_steps else []

    steps_prefix = [] if step_index < 0 else all_steps[: step_index + 1]

    # 1. Memory cache — fastest path, no DB or deserialization
    df = _df_cache.get_step(session_id, step_index, steps_prefix)

    if df is None:
        # 2. DB snapshot cache — avoids replay but still deserializes binary
        cached = crud.get_step_snapshot(db, session_id, step_index)
        if cached:
            df = bytes_to_df(cached, file_record.file_name)
        else:
            # 3. Full replay — slowest, only on cold start
            original_bytes = file_record.original_file_binary or file_record.file_binary
            if step_index < 0:
                df = bytes_to_df(original_bytes, file_record.file_name)
            else:
                df = replay_steps(original_bytes, file_record.file_name, steps_prefix)

        # Warm the memory cache for next click
        _df_cache.put_step(session_id, step_index, df, steps_prefix)

    return JSONResponse(sanitize_data({
        "success": True,
        "columns": list(df.columns),
        "data": _preview_rows(df),
        "total_rows": int(len(df)),
    }))
