# routers/profiling.py
# Routes: get profile, column details, column values

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Optional
from math import ceil
import pandas as pd
import numpy as np
import re
from pydantic import BaseModel
from app.utils.helpers import sanitize_data
from app.db.connection import get_db
from app.routes.profiler_cache import get_profiler, set_profiler
from app.db import crud
from app.services.file_parser import get_merge_ranges
from app.services.ETL.data_profiler import DataProfiler

router = APIRouter(prefix="/api", tags=["Profiling"])


class SyncProfilerRequest(BaseModel):
    data: list[dict]
    columns: list[str]


@router.get("/profile/{session_id}")
async def get_profile(
    session_id: str,
    rows: int = 50,
    db: Session = Depends(get_db),
):
    import traceback, logging
    _log = logging.getLogger("uvicorn.error")
    try:
        profiler = get_profiler(session_id, db)
        return JSONResponse(
            {"success": True, "profile": profiler.profile(preview_rows=rows)}
        )
    except HTTPException:
        raise
    except Exception as exc:
        _log.error("get_profile %s failed: %s\n%s", session_id, exc, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/sync-profiler/{session_id}")
async def sync_profiler_snapshot(
    session_id: str,
    request: SyncProfilerRequest,
    db: Session = Depends(get_db),
):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="Session not found")
    columns = [str(col) for col in (request.columns or [])]
    if not columns:
        raise HTTPException(status_code=400, detail="Columns are required")

    normalized_rows = []
    explicit_indices = []
    has_explicit_index = False
    for row in request.data or []:
        normalized = {}
        for col in columns:
            cell = row.get(col)
            if isinstance(cell, dict):
                normalized[col] = cell.get("value", cell.get("display_value"))
            else:
                normalized[col] = cell
        normalized_rows.append(normalized)
        idx_value = row.get("_index")
        if idx_value is not None:
            has_explicit_index = True
            explicit_indices.append(idx_value)
        else:
            explicit_indices.append(None)

    df = pd.DataFrame(normalized_rows, columns=columns)
    if has_explicit_index and len(explicit_indices) == len(df):
        safe_index = []
        for i, value in enumerate(explicit_indices):
            if value is None:
                safe_index.append(i)
                continue
            try:
                safe_index.append(int(value))
            except Exception:
                safe_index.append(value)
        df.index = safe_index

    profiler = DataProfiler(df)
    set_profiler(session_id, profiler)
    return JSONResponse(
        sanitize_data(
            {
                "success": True,
                "session_id": session_id,
                "rows": int(len(df)),
                "columns": columns,
            }
        )
    )


@router.get("/preview/{session_id}")
async def get_preview_rows(
    session_id: str,
    limit: int = 20,
    offset: int = 0,
    search: Optional[str] = None,
    errors_only: bool = False,
    filter_type: Optional[str] = None,  # "missing" | "outlier" | "type_inconsistency" | "all"
    db: Session = Depends(get_db),
):
    profiler = get_profiler(session_id, db)
    df = profiler.df
    columns = list(df.columns)
    query = (search or "").strip().lower()

    effective_filter = filter_type or ("all" if errors_only else None)

    if effective_filter:
        # Fast path: build issue index set directly from profiler's cached sets —
        # O(total_issues) instead of O(total_rows) Python loop.
        issue_indices: set = set()
        for col in columns:
            if effective_filter in ("missing", "all"):
                issue_indices.update(profiler._missing_sets.get(col, set()))
            if effective_filter in ("outlier", "all"):
                issue_indices.update(profiler._outlier_sets.get(col, set()))
            if effective_filter in ("type_inconsistency", "all"):
                issue_indices.update(profiler._type_inconsistency_sets.get(col, set()))

        # Apply optional search filter on the reduced index set
        if query:
            filtered = []
            for idx in sorted(issue_indices):
                for col in columns:
                    val = df.at[idx, col]
                    if not pd.isna(val) and query in str(val).lower():
                        filtered.append(idx)
                        break
            sorted_indices = filtered
        else:
            sorted_indices = sorted(issue_indices)

        total = len(sorted_indices)
        page_indices = sorted_indices[offset: offset + limit]
        rows = []
        for idx in page_indices:
            row_data = {"_index": int(idx)}
            for col in columns:
                value = df.at[idx, col]
                issues = profiler._get_cell_issues(int(idx), col)
                row_data[col] = {
                    "value": None if pd.isna(value) else value,
                    "display_value": profiler._format_display_value(value),
                    "issues": [{"type": issue.issue_type.value, **issue.details} for issue in issues],
                }
            rows.append(row_data)

        return JSONResponse(sanitize_data({
            "success": True,
            "columns": columns,
            "rows": rows,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }))

    # Normal (unfiltered) path — sequential scan with optional search
    indices = list(df.index)

    def row_matches(idx):
        if not query:
            return True
        for col in columns:
            val = df.at[idx, col]
            if not pd.isna(val) and query in str(val).lower():
                return True
        return False

    matched = 0
    rows = []
    for idx in indices:
        if not row_matches(idx):
            continue
        if matched >= offset and len(rows) < limit:
            row_data = {"_index": int(idx)}
            for col in columns:
                value = df.at[idx, col]
                issues = profiler._get_cell_issues(int(idx), col)
                row_data[col] = {
                    "value": None if pd.isna(value) else value,
                    "display_value": profiler._format_display_value(value),
                    "issues": [{"type": issue.issue_type.value, **issue.details} for issue in issues],
                }
            rows.append(row_data)
        matched += 1

    return JSONResponse(sanitize_data({
        "success": True,
        "columns": columns,
        "rows": rows,
        "total": matched,
        "limit": limit,
        "offset": offset,
        "has_more": offset + limit < matched,
    }))


@router.get("/table-data")
async def get_table_data(
    sessionId: str,
    page: int = 1,
    limit: int = 50,
    errors_only: bool = False,
    filter_type: Optional[str] = None,  # "missing" | "outlier" | "type_inconsistency" | "all"
    db: Session = Depends(get_db),
):
    profiler = get_profiler(sessionId, db)
    df = profiler.df
    columns = list(df.columns)

    # Build per-column issue index sets once for O(1) lookup per cell
    issue_sets = {}
    for col in columns:
        stats = profiler._column_stats_cache.get(col)
        if stats:
            issue_sets[col] = {
                "missing":      set(stats.missing_indices),
                "outlier":      set(stats.outlier_indices),
                "inconsistency": set(stats.type_inconsistency_indices),
                "outlier_method": stats.outlier_method,
                "data_type":    stats.data_type.value,
            }

    def get_cell(idx, col, value):
        s = issue_sets.get(col, {})
        cell_issues = []
        if idx in s.get("missing", set()):
            cell_issues.append({"type": "missing"})
        if idx in s.get("outlier", set()):
            cell_issues.append({"type": "outlier", "method": s.get("outlier_method")})
        if idx in s.get("inconsistency", set()):
            cell_issues.append({"type": "type_inconsistency", "expected_type": s.get("data_type")})
        return {
            "value":         None if pd.isna(value) else value,
            "display_value": "Empty" if pd.isna(value) else str(value),
            "issues":        cell_issues,
        }

    # Determine effective filter — filter_type takes precedence over errors_only
    effective_filter = filter_type or ("all" if errors_only else None)

    if effective_filter:
        # Fast path: collect issue indices from already-built issue_sets (O(total_issues))
        issue_indices: set = set()
        for s in issue_sets.values():
            if effective_filter in ("missing", "all"):
                issue_indices.update(s.get("missing", set()))
            if effective_filter in ("outlier", "all"):
                issue_indices.update(s.get("outlier", set()))
            if effective_filter in ("type_inconsistency", "all"):
                issue_indices.update(s.get("inconsistency", set()))
        all_indices = sorted(issue_indices)
    else:
        all_indices = list(df.index)

    total = len(all_indices)
    safe_limit = max(1, int(limit))
    total_pages = max(1, ceil(total / safe_limit)) if total else 1
    safe_page = max(1, min(int(page), total_pages))
    start = (safe_page - 1) * safe_limit
    end = start + safe_limit
    page_indices = all_indices[start:end]

    rows = []
    for idx in page_indices:
        int_idx = int(idx) if isinstance(idx, (int, np.integer)) else idx
        row_dict = {
            "id":     int_idx,
            "_index": int_idx,
        }
        for col in columns:
            row_dict[col] = get_cell(int_idx, col, df.at[idx, col])
        rows.append(row_dict)

    return JSONResponse(
        sanitize_data(
            {
                "data":       rows,
                "columns":    columns,
                "total":      total,
                "page":       safe_page,
                "totalPages": total_pages,
                "errors_only": errors_only,
            }
        )
    )


@router.get("/merge-cells/{session_id}")
async def get_merged_cells(
    session_id: str,
    db: Session = Depends(get_db),
):
    """
    Return merged cell ranges for the original Excel file, if any.
    For CSV or other formats, returns an empty list.
    """
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")
    filename = file_record.file_name or ""
    if not (filename.lower().endswith(".xlsx") or filename.lower().endswith(".xls")):
        return JSONResponse({"success": True, "merged_ranges": []})
    try:
        ranges = get_merge_ranges(file_record.file_binary)
        return JSONResponse({"success": True, "merged_ranges": ranges})
    except Exception as e:
        # Non-fatal: return empty to avoid blocking
        return JSONResponse({"success": True, "merged_ranges": [], "error": str(e)})

@router.get("/column/{session_id}/{col_name:path}/values")
async def get_column_values(
    session_id: str,
    col_name:   str,
    value_key:  Optional[str] = None,
    issue_type: Optional[str] = None,
    limit:      int = 100,
    offset:     int = 0,
    db: Session = Depends(get_db),
):
    profiler = get_profiler(session_id, db)
    if col_name not in profiler.df.columns:
        raise HTTPException(404, "Column not found")
    stats = profiler._column_stats_cache.get(col_name) or profiler._profile_column(col_name)
    profiler._column_stats_cache[col_name] = stats

    def build_row(idx):
        val = profiler.df.at[idx, col_name]
        return {
            "index":         int(idx),
            "value":         None if pd.isna(val) else val,
            "display_value": profiler._format_display_value(val),
            "issues":        [
                {"type": i.issue_type.value, **i.details}
                for i in profiler._get_cell_issues(idx, col_name)
            ],
        }

    # ── Filter by issue type ──────────────────────────────────────────────────
    if issue_type:
        index_map = {
            "missing":            stats.missing_indices,
            "outlier":            stats.outlier_indices,
            "type_inconsistency": stats.type_inconsistency_indices,
        }
        if issue_type not in index_map:
            raise HTTPException(400, "Invalid issue_type")
        idxs = index_map[issue_type]
        page = idxs[offset: offset + limit]
        return JSONResponse(sanitize_data({
            "success":    True,
            "issue_type": issue_type,
            "total":      len(idxs),
            "limit":      limit,
            "offset":     offset,
            "values":     [build_row(i) for i in page],
            "has_more":   offset + limit < len(idxs),
        }))

    # ── Filter by specific value ──────────────────────────────────────────────
    if value_key:
        idxs = stats.value_indices.get(value_key, [])
        page = idxs[offset: offset + limit]
        return JSONResponse(sanitize_data({
            "success":   True,
            "value_key": value_key,
            "total":     len(idxs),
            "limit":     limit,
            "offset":    offset,
            "values":    [build_row(i) for i in page],
            "has_more":  offset + limit < len(idxs),
        }))

    # ── All unique values summary ─────────────────────────────────────────────
    items = list(stats.value_counts.items())[offset: offset + limit]
    denom = stats.total_count or 0
    return JSONResponse(sanitize_data({
        "success":      True,
        "total_unique": stats.unique_count,
        "limit":        limit,
        "offset":       offset,
        "value_counts": [
            {"value": k, "count": v, "percentage": round((v / denom) * 100, 2) if denom else 0}
            for k, v in items
        ],
        "has_more":  offset + limit < stats.unique_count,
        "top_value": stats.top_value,
        "top_freq":  stats.top_freq,
    }))


@router.get("/suggest/{session_id}/{col_name:path}")
async def get_cell_suggestion(
    session_id: str,
    col_name: str,
    row_idx: int,
    db: Session = Depends(get_db),
):
    profiler = get_profiler(session_id, db)
    if col_name not in profiler.df.columns:
        raise HTTPException(404, "Column not found")
    df = profiler.df
    if row_idx not in df.index:
        raise HTTPException(404, "Row not found")

    stats = profiler._column_stats_cache.get(col_name) or profiler._profile_column(col_name)
    profiler._column_stats_cache[col_name] = stats
    value = df.at[row_idx, col_name]
    issues = profiler._get_cell_issues(row_idx, col_name)
    issue_types = [i.issue_type.value for i in issues]

    def clean_numeric(val):
        if pd.isna(val):
            return np.nan
        text = str(val).strip()
        cleaned = re.sub(r"[^\d\.\-\+]", "", text)
        if cleaned == "":
            return np.nan
        sign = ""
        if cleaned[0] in "+-":
            sign = cleaned[0]
            cleaned = cleaned[1:]
        cleaned = cleaned.replace("+", "").replace("-", "")
        if cleaned.count(".") > 1:
            parts = cleaned.split(".")
            cleaned = parts[0] + "." + "".join(parts[1:])
        cleaned = sign + cleaned
        if cleaned in {"", "+", "-", ".", "+.", "-."}:
            return np.nan
        return cleaned

    def numeric_series(series):
        return pd.to_numeric(series, errors="coerce")

    def build_histogram(series, current_value):
        numeric_data = numeric_series(series).dropna()
        if len(numeric_data) < 2:
            return None
        counts, edges = np.histogram(numeric_data, bins=10)
        bins = []
        for i in range(len(counts)):
            bins.append({
                "min": float(edges[i]),
                "max": float(edges[i + 1]),
                "count": int(counts[i]),
            })
        value_bin = None
        try:
            current = float(numeric_series(pd.Series([current_value])).iloc[0])
            idx = int(np.digitize([current], edges, right=False)[0] - 1)
            if 0 <= idx < len(counts):
                value_bin = idx
        except Exception:
            value_bin = None
        return {"bins": bins, "value_bin": value_bin}

    suggested = None
    reason = ""
    xai_reason = ""
    confidence = 50
    primary_type = stats.data_type.value if stats else "Mixed"
    numeric_primary = primary_type in ["Integer", "Decimal"]
    histogram = build_histogram(df[col_name], value) if numeric_primary else None

    if "missing" in issue_types:
        if numeric_primary:
            med = stats.median
            mean = stats.mean
            suggested = med if med is not None else mean
            reason = "Filled missing with median/mean"
            xai_reason = "Missing value detected; using median/mean preserves the numeric distribution."
            confidence = 85
        else:
            suggested = stats.top_value if stats.top_value is not None else None
            reason = "Filled missing with most frequent value"
            xai_reason = "Missing value detected; using the most frequent category preserves typical values."
            confidence = 75
    elif "type_inconsistency" in issue_types:
        if numeric_primary:
            cleaned = clean_numeric(value)
            if cleaned is not None and not pd.isna(cleaned):
                suggested = float(cleaned) if "." in str(cleaned) else int(float(cleaned))
                reason = "Removed non-numeric characters"
                xai_reason = "Type mismatch: non-numeric characters removed to match numeric type."
                confidence = 80
            else:
                med = stats.median
                mean = stats.mean
                suggested = med if med is not None else mean
                reason = "Replaced with median/mean"
                xai_reason = "Type mismatch: value replaced with a central tendency to fit numeric type."
                confidence = 70
        else:
            suggested = stats.top_value if stats.top_value is not None else None
            reason = "Replaced with most frequent value"
            xai_reason = "Type mismatch: replaced with the most frequent category to align with dominant type."
            confidence = 68
    elif "outlier" in issue_types and numeric_primary:
        series = numeric_series(df[col_name]).dropna()
        if len(series) >= 3:
            q1 = series.quantile(0.25)
            q3 = series.quantile(0.75)
            iqr = q3 - q1
            lower = q1 - 1.5 * iqr
            upper = q3 + 1.5 * iqr
            # Use the actual max/min of non-outlier values as the cap target so
            # the suggestion never exceeds the real data range (e.g. 1-5).
            outlier_mask_col = (series < lower) | (series > upper)
            non_outliers = series[~outlier_mask_col]
            if len(non_outliers) > 0:
                lower = non_outliers.min()
                upper = non_outliers.max()
            try:
                current = float(numeric_series(pd.Series([value])).iloc[0])
            except Exception:
                current = None
            if current is not None and not pd.isna(current):
                suggested = min(max(current, lower), upper)
                reason = "Clamped to IQR bounds"
                if stats.std and stats.mean is not None:
                    z = abs((current - stats.mean) / stats.std) if stats.std else None
                    if z is not None:
                        xai_reason = f"Statistical Outlier: Value is {z:.2f} standard deviations from the mean."
                if not xai_reason:
                    xai_reason = "Statistical Outlier detected using IQR bounds."
                confidence = 62
        if suggested is None:
            suggested = stats.median if stats.median is not None else stats.mean
            reason = "Replaced with median/mean"
            xai_reason = "Outlier detected; replaced with a robust central value."
            confidence = 60

    return JSONResponse(sanitize_data({
        "success": True,
        "row_idx": int(row_idx),
        "col_name": col_name,
        "issue_type": issue_types[0] if issue_types else None,
        "original_value": None if pd.isna(value) else value,
        "suggested_value": suggested,
        "reason": reason,
        "xai_reason": xai_reason,
        "confidence": int(confidence),
        "histogram": histogram,
        "primary_type": primary_type,
    }))


@router.get("/column/{session_id}/{col_name:path}")
async def get_column_details(
    session_id: str,
    col_name: str,
    db: Session = Depends(get_db),
):
    profiler = get_profiler(session_id, db)

    if col_name not in profiler.df.columns:
        raise HTTPException(status_code=404, detail="Column not found")

    # 1. Get/Cache the stats
    if col_name not in profiler._column_stats_cache:
        profiler._column_stats_cache[col_name] = profiler._profile_column(col_name)
    stats = profiler._column_stats_cache[col_name]

    # 2. Convert to dictionary and handle value counts
    data = profiler._stats_to_dict(stats)

    # For numeric columns the profiler intentionally skips value_counts (performance).
    # Compute it on demand here so the frontend can draw histograms.
    col_series = profiler.df[col_name]
    is_numeric_col = (
        pd.api.types.is_integer_dtype(col_series.dtype)
        or pd.api.types.is_float_dtype(col_series.dtype)
    )
    if is_numeric_col and not stats.value_counts:
        vc = col_series.dropna().value_counts().head(100)
        data["value_counts"] = {str(k): int(v) for k, v in vc.items()}
        data["has_more_values"] = int(col_series.nunique()) > 100
    else:
        data["value_counts"] = dict(list(stats.value_counts.items())[:100])
        data["has_more_values"] = len(stats.value_counts) > 100

    # 3. CRITICAL: Sanitize the final dictionary to strip int64/float64/NaN
    # Ensure sanitize_data is imported from your helpers/utils
    clean_data = sanitize_data(data)

    return JSONResponse({"success": True, "column_stats": clean_data})
