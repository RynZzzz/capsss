# routers/_profiler_cache.py
#
# Shared in-memory profiler cache with pickle disk fallback.
# All routers import get_profiler / set_profiler / remove_profiler from here
# so there is one single Dict, not one per file.

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text
from typing import Dict
import gzip, os, pickle, tempfile

from app.services.file_parser import read_csv, read_excel
from app.services.ETL.data_profiler import DataProfiler

# ── In-memory cache: session_id → DataProfiler ───────────────────────────────
_profilers: Dict[str, DataProfiler] = {}

# ── Disk pickle cache — survives server restarts ──────────────────────────────
_PICKLE_DIR = os.path.join(tempfile.gettempdir(), "cleanlogic_df_cache")
os.makedirs(_PICKLE_DIR, exist_ok=True)


def _pickle_path(session_id: str) -> str:
    return os.path.join(_PICKLE_DIR, f"{session_id}.pkl")


def set_profiler(session_id: str, profiler: DataProfiler) -> None:
    _profilers[session_id] = profiler
    try:
        with open(_pickle_path(session_id), "wb") as f:
            pickle.dump(profiler.df, f, protocol=pickle.HIGHEST_PROTOCOL)
    except Exception:
        pass  # disk cache is best-effort


def remove_profiler(session_id: str) -> None:
    _profilers.pop(session_id, None)
    try:
        os.remove(_pickle_path(session_id))
    except Exception:
        pass


def bytes_to_df(file_binary: bytes, filename: str):
    """Parse raw bytes into a DataFrame. Tries both CSV and Excel regardless of extension."""
    if not file_binary:
        raise ValueError("file_binary is empty or None")
    # Auto-detect gzip compression (magic bytes 1f 8b) — written by _df_to_bytes.
    # Original uploaded files are stored uncompressed so this handles both cases.
    if file_binary[:2] == b"\x1f\x8b":
        file_binary = gzip.decompress(file_binary)

    errors = []
    if filename.lower().endswith(".csv"):
        order = [read_csv, read_excel]
    else:
        order = [read_excel, read_csv]

    for parser in order:
        try:
            return parser(file_binary)
        except Exception as exc:
            errors.append(f"{parser.__name__}: {exc}")

    raise ValueError(
        f"Could not parse '{filename}' as CSV or Excel. "
        f"Errors: {'; '.join(errors)}"
    )


def get_profiler(session_id: str, db: Session) -> DataProfiler:
    """
    Return the cached profiler for this session.
    1. In-memory cache (fastest)
    2. Disk pickle cache (fast — avoids DB round trip and file re-parse)
    3. DB file binary re-parse (slowest fallback)
    """
    if session_id in _profilers:
        return _profilers[session_id]

    # Try disk pickle before hitting DB
    pkl = _pickle_path(session_id)
    if os.path.exists(pkl):
        try:
            with open(pkl, "rb") as f:
                df = pickle.load(f)
            profiler = DataProfiler(df)
            _profilers[session_id] = profiler
            return profiler
        except Exception:
            pass  # corrupted pickle — fall through to DB

    # Full DB fallback: fetch binary and re-parse
    row = db.execute(
        sql_text(
            "SELECT file_name, file_binary, original_file_binary "
            "FROM files WHERE session_id = :sid LIMIT 1"
        ),
        {"sid": session_id},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    file_name = row["file_name"] or ""
    df = None
    last_error = None
    for binary in [row["file_binary"], row["original_file_binary"]]:
        if not binary:
            continue
        try:
            df = bytes_to_df(bytes(binary), file_name)
            break
        except Exception as exc:
            last_error = exc

    if df is None:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Could not parse stored file for session {session_id}. "
                f"Please re-upload your file. ({last_error})"
            ),
        )

    try:
        profiler = DataProfiler(df)
        _profilers[session_id] = profiler
        # Refresh disk cache
        try:
            with open(pkl, "wb") as f:
                pickle.dump(df, f, protocol=pickle.HIGHEST_PROTOCOL)
        except Exception:
            pass
        return profiler
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to rebuild profiler for session {session_id}: {exc}",
        )
