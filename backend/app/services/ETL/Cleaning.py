# backend/routers/cleaning.py

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any, Literal, Tuple
from pydantic import BaseModel, Field
from concurrent.futures import ThreadPoolExecutor
import pandas as pd
import numpy as np
from io import BytesIO
import re

from app.db.connection import get_db
from app.db import crud
from app.routes.profiler_cache import get_profiler, remove_profiler, set_profiler
from app.services.ETL.data_profiler import DataProfiler
from app.utils.helpers import sanitize_data

router = APIRouter(prefix="/api/cleaning", tags=["Cleaning"])

_MAX_WORKERS = 8  # cap for parallel column cleaning threads


# ─────────────────────────── REQUEST MODELS ──────────────────────────────────

class MissingValueConfig(BaseModel):
    """Configuration for handling missing values"""
    method: Literal["mean", "median", "mode", "knn", "remove", "forward_fill", "backward_fill", "constant"]
    columns: List[str] = Field(default_factory=list)
    constant_value: Optional[Any] = None
    knn_neighbors: int = 5


class DuplicateConfig(BaseModel):
    """Configuration for handling duplicates"""
    action: Literal["remove_all", "keep_first", "keep_last", "mark_only"]
    subset_columns: Optional[List[str]] = None


class OutlierConfig(BaseModel):
    """Configuration for handling outliers"""
    method: Literal["iqr", "zscore", "knn", "isolation_forest", "none"]
    action: Literal["remove", "cap", "winsorize", "ignore"]
    columns: List[str] = Field(default_factory=list)
    iqr_multiplier: float = 1.5
    zscore_threshold: float = 3.0
    contamination: float = 0.1
    knn_neighbors: int = 20


class TypeInconsistencyConfig(BaseModel):
    """Configuration for handling type inconsistencies"""
    method: Literal["mean", "median", "mode"] = "mode"
    columns: List[str] = Field(default_factory=list)
    numeric_only: bool = False
    numeric_cleanup: bool = False
    text_cleanup: bool = False
    text_regex: Optional[str] = None
    text_replacement: Optional[str] = ""


class CleaningRequest(BaseModel):
    """Complete cleaning configuration"""
    session_id: str
    missing_value_config: Optional[MissingValueConfig] = None
    duplicate_config: Optional[DuplicateConfig] = None
    outlier_config: Optional[OutlierConfig] = None
    type_inconsistency_config: Optional[TypeInconsistencyConfig] = None
    apply_immediately: bool = False


# ─────────────────────────── HELPER FUNCTIONS ─────────────────────────────────

def _normalize_missing_tokens(series: pd.Series) -> pd.Series:
    if not (pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series)):
        return series
    lowered = series.astype(str).str.strip().str.lower()
    missing_tokens = {"", "na", "nan", "null", "none", "n/a", "-", "--"}
    return series.where(~lowered.isin(missing_tokens), np.nan)


def _numeric_like_ratio(series: pd.Series) -> float:
    non_null = series.notna().sum()
    if non_null == 0:
        return 0.0
    numeric_series = pd.to_numeric(series, errors="coerce")
    return float(numeric_series.notna().sum() / non_null)


def _coerce_object_to_numeric(series: pd.Series) -> pd.Series:
    """
    If an object-dtype series is actually numeric (≥90 % of non-null values
    parse as numbers), convert it to an appropriate numeric dtype.
    Whole-number columns become nullable Int64; fractional columns stay float64.
    Non-numeric object columns are returned unchanged.
    """
    if not pd.api.types.is_object_dtype(series):
        return series
    non_null_count = series.notna().sum()
    if non_null_count == 0:
        return series
    numeric = pd.to_numeric(series, errors="coerce")
    if numeric.notna().sum() / non_null_count < 0.9:
        return series  # Genuinely text-like — leave it alone
    valid = numeric.dropna()
    if len(valid) > 0 and (valid % 1 == 0).all():
        return numeric.round().astype("Int64")
    return numeric


# ─────────────────────────── MISSING VALUES ──────────────────────────────────

def _missing_col_worker(
    col_series: pd.Series,
    col: str,
    config: MissingValueConfig,
) -> Tuple[str, Optional[pd.Series], Optional[Dict]]:
    """
    Fill missing values in one column (fill methods only — not remove/knn).
    Returns (col_name, filled_series, change_info) or (col_name, None, None).
    Each worker receives its own copy of the series so writes are thread-safe.
    """
    series = _normalize_missing_tokens(col_series)
    missing_count = series.isna().sum()
    if missing_count == 0:
        return col, series, None

    if config.method == "mean":
        numeric_ratio = _numeric_like_ratio(series)
        if numeric_ratio >= 0.6:
            numeric_series = pd.to_numeric(series, errors="coerce")
            fill_value = numeric_series.mean()
            series = numeric_series.fillna(fill_value)
            return col, series, {
                "column": col, "action": "fill_mean",
                "rows_affected": int(missing_count),
                "fill_value": float(fill_value) if not pd.isna(fill_value) else None,
            }

    elif config.method == "median":
        numeric_ratio = _numeric_like_ratio(series)
        if numeric_ratio >= 0.6:
            numeric_series = pd.to_numeric(series, errors="coerce")
            fill_value = numeric_series.median()
            series = numeric_series.fillna(fill_value)
            return col, series, {
                "column": col, "action": "fill_median",
                "rows_affected": int(missing_count),
                "fill_value": float(fill_value) if not pd.isna(fill_value) else None,
            }

    elif config.method == "mode":
        mode_values = series.mode()
        if len(mode_values) > 0:
            fill_value = mode_values[0]
            series = series.fillna(fill_value)
            series = _coerce_object_to_numeric(series)
            return col, series, {
                "column": col, "action": "fill_mode",
                "rows_affected": int(missing_count),
                "fill_value": str(fill_value),
            }

    elif config.method == "forward_fill":
        series = series.ffill()
        series = _coerce_object_to_numeric(series)
        return col, series, {
            "column": col, "action": "forward_fill",
            "rows_affected": int(missing_count),
        }

    elif config.method == "backward_fill":
        series = series.bfill()
        series = _coerce_object_to_numeric(series)
        return col, series, {
            "column": col, "action": "backward_fill",
            "rows_affected": int(missing_count),
        }

    elif config.method == "constant":
        if config.constant_value is not None:
            series = series.fillna(config.constant_value)
            series = _coerce_object_to_numeric(series)
            return col, series, {
                "column": col, "action": "fill_constant",
                "rows_affected": int(missing_count),
                "fill_value": str(config.constant_value),
            }

    return col, None, None


def handle_missing_values(df: pd.DataFrame, config: MissingValueConfig) -> tuple[pd.DataFrame, List[Dict]]:
    """Handle missing values based on configuration"""
    changes = []
    df_copy = df.copy()
    target_columns = config.columns if config.columns else df_copy.columns.tolist()

    # knn: operates across all numeric columns simultaneously — run once, not per column
    if config.method == "knn":
        # Normalize missing tokens across all target columns first
        for col in target_columns:
            if col in df_copy.columns:
                df_copy[col] = _normalize_missing_tokens(df_copy[col])

        # Numeric-like columns used as KNN features
        numeric_like = [c for c in df_copy.columns if _numeric_like_ratio(df_copy[c]) >= 0.6]

        # Only impute target columns that are numeric-like and have missing values
        cols_to_impute = [
            c for c in target_columns
            if c in df_copy.columns and c in numeric_like and df_copy[c].isna().any()
        ]

        if not cols_to_impute:
            return df_copy, changes

        missing_before = {c: int(df_copy[c].isna().sum()) for c in cols_to_impute}

        try:
            from sklearn.impute import KNNImputer
            numeric_df = df_copy[numeric_like].apply(
                lambda s: pd.to_numeric(s, errors="coerce")
            )
            # Clamp k so it never exceeds available samples (avoids sklearn ValueError)
            k = max(1, min(config.knn_neighbors, len(numeric_df) - 1))
            imputer = KNNImputer(n_neighbors=k)
            df_copy[numeric_like] = imputer.fit_transform(numeric_df)
            for col in cols_to_impute:
                changes.append({
                    "column": col,
                    "action": "knn_impute",
                    "rows_affected": missing_before[col],
                    "n_neighbors": k,
                })
        except Exception as exc:
            for col in cols_to_impute:
                changes.append({
                    "column": col,
                    "action": "knn_impute_failed",
                    "error": str(exc),
                })
        return df_copy, changes

    # remove: each column may drop different rows — must stay sequential
    if config.method == "remove":
        for col in target_columns:
            if col not in df_copy.columns:
                continue
            df_copy[col] = _normalize_missing_tokens(df_copy[col])
            missing_count = df_copy[col].isna().sum()
            if missing_count == 0:
                continue
            original_missing = df_copy[col].isna()
            rows_before = len(df_copy)
            df_copy = df_copy[~original_missing]
            rows_removed = rows_before - len(df_copy)
            changes.append({
                "column": col,
                "action": "remove_rows",
                "rows_affected": int(rows_removed)
            })
        df_copy = df_copy.reset_index(drop=True)
        return df_copy, changes

    # Fill methods: each column is independent — parallelize across columns
    valid_cols = [c for c in target_columns if c in df_copy.columns]
    n_workers = min(_MAX_WORKERS, len(valid_cols))

    if n_workers <= 1:
        for col in valid_cols:
            _, series, info = _missing_col_worker(df_copy[col].copy(), col, config)
            if series is not None:
                df_copy[col] = series
            if info is not None:
                changes.append(info)
    else:
        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            futures = [
                (col, pool.submit(_missing_col_worker, df_copy[col].copy(), col, config))
                for col in valid_cols
            ]
        for col, future in futures:
            try:
                _, series, info = future.result()
                if series is not None:
                    df_copy[col] = series
                if info is not None:
                    changes.append(info)
            except Exception:
                pass

    return df_copy, changes


# ─────────────────────────── DUPLICATES ──────────────────────────────────────

def handle_duplicates(df: pd.DataFrame, config: DuplicateConfig) -> tuple[pd.DataFrame, Dict]:
    """Handle duplicate rows"""
    df_copy = df.copy()

    if config.subset_columns:
        duplicates_mask = df_copy.duplicated(subset=config.subset_columns, keep=False)
    else:
        duplicates_mask = df_copy.duplicated(keep=False)

    duplicate_count = duplicates_mask.sum()

    change_info = {
        "total_duplicates": int(duplicate_count),
        "action": config.action,
        "rows_affected": 0
    }

    if config.action == "remove_all":
        rows_before = len(df_copy)
        if config.subset_columns:
            df_copy = df_copy.drop_duplicates(subset=config.subset_columns, keep=False)
        else:
            df_copy = df_copy.drop_duplicates(keep=False)
        change_info["rows_affected"] = int(rows_before - len(df_copy))

    elif config.action == "keep_first":
        rows_before = len(df_copy)
        if config.subset_columns:
            df_copy = df_copy.drop_duplicates(subset=config.subset_columns, keep='first')
        else:
            df_copy = df_copy.drop_duplicates(keep='first')
        change_info["rows_affected"] = int(rows_before - len(df_copy))

    elif config.action == "keep_last":
        rows_before = len(df_copy)
        if config.subset_columns:
            df_copy = df_copy.drop_duplicates(subset=config.subset_columns, keep='last')
        else:
            df_copy = df_copy.drop_duplicates(keep='last')
        change_info["rows_affected"] = int(rows_before - len(df_copy))

    elif config.action == "mark_only":
        df_copy['_is_duplicate'] = duplicates_mask
        change_info["note"] = "Duplicates marked with '_is_duplicate' column"

    return df_copy, change_info


# ─────────────────────────── OUTLIERS ────────────────────────────────────────

def _restore_int(series: pd.Series) -> pd.Series:
    """Round and restore a float series back to nullable Int64."""
    try:
        coerced = pd.to_numeric(series, errors="coerce")
        if coerced.isna().all():
            return series
        return coerced.round().astype("Int64")
    except Exception:
        return series


def _outlier_col_worker(
    col_series: pd.Series,
    col: str,
    orig_dtype: Any,
    config: OutlierConfig,
) -> Tuple[str, Optional[pd.Series], Optional[Dict]]:
    """
    Detect outliers and apply cap/winsorize/ignore for one column.
    NOT used for remove action (row drops must stay sequential).
    Returns (col_name, result_series, change_info) or (col_name, None, None) on skip.
    Each worker receives its own copy of the series so writes are thread-safe.
    """
    numeric_series = pd.to_numeric(col_series, errors="coerce")
    numeric_mask = numeric_series.notna()

    if numeric_mask.sum() == 0:
        return col, None, None

    outlier_mask = pd.Series(False, index=col_series.index)
    change_info: Dict[str, Any] = {}
    lower_bound = upper_bound = mean = std = None

    # ── Detection ────────────────────────────────────────────────────────────

    if config.method == "iqr":
        values = numeric_series[numeric_mask]
        if len(values) < 3:
            return col, col_series, {"column": col, "method": "iqr", "outliers_found": 0}
        Q1 = values.quantile(0.25)
        Q3 = values.quantile(0.75)
        IQR = Q3 - Q1
        lower_bound = Q1 - config.iqr_multiplier * IQR
        upper_bound = Q3 + config.iqr_multiplier * IQR
        outlier_mask = (numeric_series < lower_bound) | (numeric_series > upper_bound)
        change_info = {
            "column": col, "method": "iqr",
            "lower_bound": float(lower_bound), "upper_bound": float(upper_bound),
            "outliers_found": int(outlier_mask.sum()),
        }

    elif config.method == "zscore":
        values = numeric_series[numeric_mask]
        mean = values.mean()
        std = values.std()
        if std > 0:
            z_scores = np.abs((numeric_series - mean) / std)
            outlier_mask = z_scores > config.zscore_threshold
        change_info = {
            "column": col, "method": "zscore",
            "threshold": config.zscore_threshold,
            "outliers_found": int(outlier_mask.sum()),
            "mean": float(mean) if pd.notna(mean) else None,
            "std": float(std) if pd.notna(std) else None,
        }

    elif config.method == "isolation_forest":
        try:
            from sklearn.ensemble import IsolationForest
            iso_forest = IsolationForest(contamination=config.contamination, random_state=42)
            values = numeric_series[numeric_mask]
            predictions = iso_forest.fit_predict(values.values.reshape(-1, 1))
            outlier_mask.loc[values.index] = predictions == -1
            change_info = {
                "column": col, "method": "isolation_forest",
                "outliers_found": int(outlier_mask.sum()),
                "contamination": float(config.contamination),
            }
        except ImportError:
            return col, None, None

    elif config.method == "knn":
        try:
            from sklearn.neighbors import LocalOutlierFactor
            values = numeric_series[numeric_mask]
            if len(values) < 3:
                return col, col_series, {
                    "column": col, "method": "knn", "outliers_found": 0,
                    "n_neighbors": int(config.knn_neighbors),
                }
            neighbors = min(max(2, int(config.knn_neighbors)), len(values) - 1)
            lof = LocalOutlierFactor(n_neighbors=neighbors, contamination=config.contamination)
            predictions = lof.fit_predict(values.values.reshape(-1, 1))
            outlier_mask.loc[values.index] = predictions == -1
            change_info = {
                "column": col, "method": "knn",
                "outliers_found": int(outlier_mask.sum()),
                "n_neighbors": int(neighbors),
                "contamination": float(config.contamination),
            }
        except ImportError:
            return col, None, None

    # ── Action ───────────────────────────────────────────────────────────────

    result_series = col_series.copy()

    if config.action == "cap" and config.method == "iqr":
        non_outlier_values = numeric_series[~outlier_mask & numeric_mask]
        cap_upper = non_outlier_values.max() if len(non_outlier_values) > 0 else upper_bound
        cap_lower = non_outlier_values.min() if len(non_outlier_values) > 0 else lower_bound
        result_series.loc[outlier_mask & (numeric_series < lower_bound)] = cap_lower
        result_series.loc[outlier_mask & (numeric_series > upper_bound)] = cap_upper
        if pd.api.types.is_integer_dtype(orig_dtype):
            result_series = _restore_int(result_series)
        result_series = _coerce_object_to_numeric(result_series)
        change_info.update({
            "action": "cap",
            "lower_bound": float(cap_lower), "upper_bound": float(cap_upper),
            "values_capped": int(outlier_mask.sum()),
        })

    elif config.action == "cap" and config.method == "zscore":
        if std is not None and std > 0:
            lb = mean - config.zscore_threshold * std
            ub = mean + config.zscore_threshold * std
            result_series.loc[outlier_mask & (numeric_series < lb)] = lb
            result_series.loc[outlier_mask & (numeric_series > ub)] = ub
            if pd.api.types.is_integer_dtype(orig_dtype):
                result_series = _restore_int(result_series)
            result_series = _coerce_object_to_numeric(result_series)
            change_info.update({
                "action": "cap",
                "lower_bound": float(lb), "upper_bound": float(ub),
                "values_capped": int(outlier_mask.sum()),
            })

    elif config.action == "cap" and config.method in ("isolation_forest", "knn"):
        values = numeric_series[numeric_mask]
        lb = values.quantile(0.05)
        ub = values.quantile(0.95)
        result_series.loc[outlier_mask & (numeric_series < lb)] = lb
        result_series.loc[outlier_mask & (numeric_series > ub)] = ub
        if pd.api.types.is_integer_dtype(orig_dtype):
            result_series = _restore_int(result_series)
        result_series = _coerce_object_to_numeric(result_series)
        change_info.update({
            "action": "cap",
            "lower_bound": float(lb), "upper_bound": float(ub),
            "values_capped": int(outlier_mask.sum()),
        })

    elif config.action == "winsorize":
        values = numeric_series[numeric_mask]
        Q1 = values.quantile(0.25)
        Q3 = values.quantile(0.75)
        IQR = Q3 - Q1
        lb = Q1 - config.iqr_multiplier * IQR
        ub = Q3 + config.iqr_multiplier * IQR
        result_series.loc[numeric_series < lb] = lb
        result_series.loc[numeric_series > ub] = ub
        if pd.api.types.is_integer_dtype(orig_dtype):
            result_series = _restore_int(result_series)
        result_series = _coerce_object_to_numeric(result_series)
        change_info.update({
            "action": "winsorize",
            "lower_bound": float(lb), "upper_bound": float(ub),
            "values_adjusted": int(outlier_mask.sum()),
        })

    elif config.action == "ignore":
        change_info["action"] = "ignore"
        return col, col_series, change_info

    return col, result_series, change_info


def handle_outliers(df: pd.DataFrame, config: OutlierConfig) -> tuple[pd.DataFrame, List[Dict]]:
    """Handle outliers based on configuration"""
    changes = []
    df_copy = df.copy()

    if config.method == "none":
        return df_copy, changes

    target_columns = config.columns if config.columns else df_copy.select_dtypes(include=[np.number]).columns.tolist()
    valid_cols = [c for c in target_columns if c in df_copy.columns]

    if config.action == "remove":
        # Row removal changes the DataFrame index — must stay sequential.
        for col in valid_cols:
            numeric_series = pd.to_numeric(df_copy[col], errors="coerce")
            numeric_mask = numeric_series.notna()
            if numeric_mask.sum() == 0:
                continue

            outlier_mask = pd.Series(False, index=df_copy.index)

            if config.method == "iqr":
                values = numeric_series[numeric_mask]
                if len(values) < 3:
                    changes.append({"column": col, "method": "iqr", "outliers_found": 0})
                    continue
                Q1 = values.quantile(0.25)
                Q3 = values.quantile(0.75)
                IQR = Q3 - Q1
                lower_bound = Q1 - config.iqr_multiplier * IQR
                upper_bound = Q3 + config.iqr_multiplier * IQR
                outlier_mask = (numeric_series < lower_bound) | (numeric_series > upper_bound)
                change_info = {
                    "column": col, "method": "iqr",
                    "lower_bound": float(lower_bound), "upper_bound": float(upper_bound),
                    "outliers_found": int(outlier_mask.sum()),
                }

            elif config.method == "zscore":
                values = numeric_series[numeric_mask]
                mean = values.mean()
                std = values.std()
                if std > 0:
                    z_scores = np.abs((numeric_series - mean) / std)
                    outlier_mask = z_scores > config.zscore_threshold
                change_info = {
                    "column": col, "method": "zscore",
                    "threshold": config.zscore_threshold,
                    "outliers_found": int(outlier_mask.sum()),
                    "mean": float(mean) if pd.notna(mean) else None,
                    "std": float(std) if pd.notna(std) else None,
                }

            elif config.method == "isolation_forest":
                try:
                    from sklearn.ensemble import IsolationForest
                    iso_forest = IsolationForest(contamination=config.contamination, random_state=42)
                    values = numeric_series[numeric_mask]
                    predictions = iso_forest.fit_predict(values.values.reshape(-1, 1))
                    outlier_mask.loc[values.index] = predictions == -1
                    change_info = {
                        "column": col, "method": "isolation_forest",
                        "outliers_found": int(outlier_mask.sum()),
                        "contamination": float(config.contamination),
                    }
                except ImportError:
                    continue

            elif config.method == "knn":
                try:
                    from sklearn.neighbors import LocalOutlierFactor
                    values = numeric_series[numeric_mask]
                    if len(values) < 3:
                        changes.append({"column": col, "method": "knn", "outliers_found": 0, "n_neighbors": int(config.knn_neighbors)})
                        continue
                    neighbors = min(max(2, int(config.knn_neighbors)), len(values) - 1)
                    lof = LocalOutlierFactor(n_neighbors=neighbors, contamination=config.contamination)
                    predictions = lof.fit_predict(values.values.reshape(-1, 1))
                    outlier_mask.loc[values.index] = predictions == -1
                    change_info = {
                        "column": col, "method": "knn",
                        "outliers_found": int(outlier_mask.sum()),
                        "n_neighbors": int(neighbors),
                        "contamination": float(config.contamination),
                    }
                except ImportError:
                    continue
            else:
                continue

            rows_before = len(df_copy)
            df_copy = df_copy[~outlier_mask]
            change_info["action"] = "remove"
            change_info["rows_removed"] = int(rows_before - len(df_copy))
            changes.append(change_info)

        df_copy = df_copy.reset_index(drop=True)

    else:
        # cap / winsorize / ignore: value replacement only — parallelize across columns
        n_workers = min(_MAX_WORKERS, len(valid_cols))
        if n_workers <= 1:
            for col in valid_cols:
                _, series, info = _outlier_col_worker(
                    df_copy[col].copy(), col, df_copy[col].dtype, config
                )
                if series is not None:
                    df_copy[col] = series
                if info is not None:
                    changes.append(info)
        else:
            with ThreadPoolExecutor(max_workers=n_workers) as pool:
                futures = [
                    (col, pool.submit(
                        _outlier_col_worker,
                        df_copy[col].copy(), col, df_copy[col].dtype, config,
                    ))
                    for col in valid_cols
                ]
            for col, future in futures:
                try:
                    _, series, info = future.result()
                    if series is not None:
                        df_copy[col] = series
                    if info is not None:
                        changes.append(info)
                except Exception:
                    pass

    return df_copy, changes


# ─────────────────────────── TYPE INCONSISTENCIES ────────────────────────────

def _clean_numeric_value(value: Any) -> Any:
    if pd.isna(value):
        return np.nan
    text = str(value).strip()
    if text == "":
        return np.nan
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


def _clean_text_value(value: Any, pattern: re.Pattern, replacement: str) -> Any:
    if pd.isna(value):
        return value
    text = str(value)
    return re.sub(pattern, replacement, text)


def _type_col_worker(
    col_series: pd.Series,
    col: str,
    df_index: pd.Index,
    config: TypeInconsistencyConfig,
    profiler: DataProfiler,
) -> Tuple[str, Optional[pd.Series], List[Dict]]:
    """
    Fix type inconsistencies for one column.
    Returns (col_name, result_series, changes_list).
    Each worker receives its own copy of the series so writes are thread-safe.
    profiler._detect_type_and_inconsistencies is called read-only.
    """
    col_data = col_series.copy()
    col_changes: List[Dict] = []

    primary_type, inconsistent_indices, _ = profiler._detect_type_and_inconsistencies(col_data)
    is_numeric_primary = primary_type.value in ["Integer", "Decimal"]

    if config.numeric_only and not is_numeric_primary:
        return col, None, []

    cleaned_numeric = False
    cleaned_text = False
    cleanup_generated_missing_indices = []
    numeric_cleanup_enabled = bool(config.numeric_cleanup or config.numeric_only)
    text_cleanup_enabled = bool(config.text_cleanup)

    if numeric_cleanup_enabled and is_numeric_primary:
        cleaned_series = col_data.apply(_clean_numeric_value)
        cleaned_numeric_series = pd.to_numeric(cleaned_series, errors="coerce")
        changed_mask = ~(
            col_data.isna() & cleaned_series.isna()
        ) & (col_data.astype(str) != cleaned_series.astype(str))
        generated_missing_mask = col_data.notna() & cleaned_numeric_series.isna()
        cleanup_generated_missing_indices = (
            df_index[generated_missing_mask].tolist()
        )
        col_data = cleaned_numeric_series
        cleaned_numeric = True
        if changed_mask.any():
            col_changes.append({
                "column": col,
                "action": "clean_numeric_chars",
                "rows_affected": int(changed_mask.sum()),
            })

    if text_cleanup_enabled and primary_type.value in ["Text", "Alphanumeric"]:
        pattern_text = config.text_regex or r"[^A-Za-z0-9\s]"
        try:
            compiled_pattern = re.compile(pattern_text)
        except re.error as exc:
            raise ValueError(f"Invalid text_regex: {pattern_text}") from exc
        replacement_text = (
            "" if config.text_replacement is None else str(config.text_replacement)
        )
        cleaned_text_series = col_data.apply(
            lambda value: _clean_text_value(value, compiled_pattern, replacement_text)
        )
        changed_mask = ~(
            col_data.isna() & cleaned_text_series.isna()
        ) & (col_data.astype(str) != cleaned_text_series.astype(str))
        col_data = cleaned_text_series
        cleaned_text = True
        if changed_mask.any():
            col_changes.append({
                "column": col,
                "action": "clean_text_regex",
                "rows_affected": int(changed_mask.sum()),
                "regex": pattern_text,
            })

    primary_type, inconsistent_indices, _ = profiler._detect_type_and_inconsistencies(col_data)
    target_indices = list(
        dict.fromkeys(list(inconsistent_indices) + cleanup_generated_missing_indices)
    )

    if not target_indices:
        if col_changes:
            return col, col_data, col_changes
        return col, None, []

    replacement = None
    numeric_series = pd.to_numeric(col_data, errors="coerce")
    if config.method in ["mean", "median"]:
        if config.method == "mean":
            replacement = numeric_series.mean()
        else:
            replacement = numeric_series.median()
    else:
        if is_numeric_primary:
            mode_values = numeric_series.dropna().mode()
        else:
            mode_values = col_data.dropna().mode()
        if len(mode_values) > 0:
            replacement = mode_values.iloc[0]

    if replacement is None or (isinstance(replacement, float) and pd.isna(replacement)):
        if col_changes:
            return col, col_data, col_changes
        return col, None, []

    col_data.loc[target_indices] = replacement
    if is_numeric_primary:
        col_data = pd.to_numeric(col_data, errors="coerce")

    _, remaining_inconsistent_indices, _ = profiler._detect_type_and_inconsistencies(col_data)
    if remaining_inconsistent_indices:
        col_data.loc[remaining_inconsistent_indices] = replacement
        if is_numeric_primary:
            col_data = pd.to_numeric(col_data, errors="coerce")

    col_changes.append({
        "column": col,
        "action": f"fix_type_inconsistency_{config.method}",
        "rows_affected": int(len(target_indices)),
        "primary_type": primary_type.value,
        "numeric_only": bool(config.numeric_only),
        "numeric_cleaned": cleaned_numeric,
        "text_cleaned": cleaned_text,
    })

    return col, col_data, col_changes


def handle_type_inconsistencies(
    df: pd.DataFrame, config: TypeInconsistencyConfig
) -> tuple[pd.DataFrame, List[Dict]]:
    changes = []
    df_copy = df.copy()
    target_columns = config.columns if config.columns else df_copy.columns.tolist()
    valid_cols = [c for c in target_columns if c in df_copy.columns]

    # One shared profiler — _detect_type_and_inconsistencies reads col_data param only
    profiler = DataProfiler(df_copy)

    n_workers = min(_MAX_WORKERS, len(valid_cols))

    if n_workers <= 1:
        for col in valid_cols:
            _, series, col_changes = _type_col_worker(
                df_copy[col].copy(), col, df_copy.index, config, profiler
            )
            if series is not None:
                df_copy[col] = series
            changes.extend(col_changes)
    else:
        with ThreadPoolExecutor(max_workers=n_workers) as pool:
            futures = [
                (col, pool.submit(
                    _type_col_worker,
                    df_copy[col].copy(), col, df_copy.index, config, profiler,
                ))
                for col in valid_cols
            ]
        for col, future in futures:
            try:
                _, series, col_changes = future.result()
                if series is not None:
                    df_copy[col] = series
                changes.extend(col_changes)
            except Exception:
                pass

    return df_copy, changes


# ─────────────────────────── API ENDPOINTS ────────────────────────────────────

@router.post("/preview")
async def preview_cleaning(
    request: CleaningRequest,
    db: Session = Depends(get_db)
):
    """Preview cleaning operations without saving"""
    try:
        profiler = get_profiler(request.session_id, db)
        df = profiler.df.copy()

        original_shape = df.shape
        preview_results = {
            "original_rows": int(original_shape[0]),
            "original_columns": int(original_shape[1]),
            "changes": []
        }

        # Preview missing value handling
        if request.missing_value_config:
            df, missing_changes = handle_missing_values(df, request.missing_value_config)
            preview_results["changes"].extend([
                {"type": "missing_value", **change} for change in missing_changes
            ])

        # Preview outlier handling
        if request.outlier_config:
            df, outlier_changes = handle_outliers(df, request.outlier_config)
            preview_results["changes"].extend([
                {"type": "outlier", **change} for change in outlier_changes
            ])

        # Preview duplicate handling
        if request.duplicate_config:
            df, duplicate_change = handle_duplicates(df, request.duplicate_config)
            preview_results["changes"].append({"type": "duplicates", **duplicate_change})

        # Preview type inconsistency handling
        if request.type_inconsistency_config:
            df, type_changes = handle_type_inconsistencies(
                df, request.type_inconsistency_config
            )
            preview_results["changes"].extend([
                {"type": "type_inconsistency", **change} for change in type_changes
            ])

        preview_results["resulting_rows"] = int(len(df))
        preview_results["resulting_columns"] = int(len(df.columns))
        preview_results["rows_removed"] = int(original_shape[0] - len(df))

        return JSONResponse(content=sanitize_data(preview_results))

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)}")


@router.post("/apply")
async def apply_cleaning(
    request: CleaningRequest,
    db: Session = Depends(get_db)
):
    """Apply cleaning operations and save the cleaned dataset"""
    try:
        profiler = get_profiler(request.session_id, db)
        file_record = crud.get_file_by_session(db, request.session_id)
        if not file_record:
            raise HTTPException(404, "Session not found")

        df = profiler.df.copy()
        original_shape = df.shape
        change_log = []

        # Apply missing value handling
        if request.missing_value_config:
            df, missing_changes = handle_missing_values(df, request.missing_value_config)
            change_log.extend([{"type": "missing_value", **change} for change in missing_changes])

        # Apply outlier handling
        if request.outlier_config:
            df, outlier_changes = handle_outliers(df, request.outlier_config)
            change_log.extend([{"type": "outlier", **change} for change in outlier_changes])

        # Apply duplicate handling
        if request.duplicate_config:
            df, duplicate_change = handle_duplicates(df, request.duplicate_config)
            change_log.append({"type": "duplicates", **duplicate_change})

        # Apply type inconsistency handling
        if request.type_inconsistency_config:
            df, type_changes = handle_type_inconsistencies(
                df, request.type_inconsistency_config
            )
            change_log.extend([{"type": "type_inconsistency", **change} for change in type_changes])

        # Save cleaned data to buffer — always CSV internally; format at export time
        buffer = BytesIO()
        df.to_csv(buffer, index=False)

        cleaned_binary = buffer.getvalue()

        # Update file record with cleaned data
        file_record.file_binary = cleaned_binary
        file_record.row_count = len(df)
        file_record.column_count = len(df.columns)
        db.commit()
        job = crud.get_preprocessing_job(db, file_record.id)
        # Invalidate profiler cache
        remove_profiler(request.session_id)

        # Create or update preprocessing job
        job = crud.get_preprocessing_job(db, file_record.id)
        if not job:
            job = crud.create_preprocessing_job(
                db,
                file_id=file_record.id,
                missing_handling=request.missing_value_config.method if request.missing_value_config else "omit",
                outlier_method=request.outlier_config.method if request.outlier_config else "iqr",
                outlier_action=request.outlier_config.action if request.outlier_config else "remove"
            )

        # Update job with results
        crud.update_preprocessing_job(
            db,
            job_id=job.id,
            status="completed",
            cleaned_row_count=len(df),
            cleaned_col_count=len(df.columns),
            change_log=change_log
        )

        # Generate new profile and warm the cache so subsequent refreshes are instant
        new_profiler = DataProfiler(df)
        updated_profile = new_profiler.profile()
        set_profiler(request.session_id, new_profiler)

        # Save updated column profiles
        crud.save_column_profiles(db, file_record.id, updated_profile["columns"])

        response = {
            "success": True,
            "original_shape": {"rows": int(original_shape[0]), "columns": int(original_shape[1])},
            "cleaned_shape": {"rows": int(len(df)), "columns": int(len(df.columns))},
            "changes": change_log,
            "job_id": job.id,
            "profile": updated_profile
        }

        return JSONResponse(content=sanitize_data(response))

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Cleaning failed: {str(e)}")


@router.get("/stats/{session_id}")
async def get_cleaning_stats(
    session_id: str,
    db: Session = Depends(get_db)
):
    """Get statistics about the current dataset for cleaning recommendations"""
    try:
        profiler = get_profiler(session_id, db)
        df = profiler.df

        stats = {
            "total_rows": int(len(df)),
            "total_columns": int(len(df.columns)),
            "missing_values": {},
            "duplicates": {
                "total": int(df.duplicated().sum()),
                "percentage": float(df.duplicated().sum() / len(df) * 100) if len(df) > 0 else 0
            },
            "outliers": {},
            "column_types": {}
        }

        # Missing value stats per column
        for col in df.columns:
            missing_count = df[col].isna().sum()
            if missing_count > 0:
                stats["missing_values"][col] = {
                    "count": int(missing_count),
                    "percentage": float(missing_count / len(df) * 100)
                }

        # Outlier stats (IQR method) for numeric columns
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        for col in numeric_cols:
            Q1 = df[col].quantile(0.25)
            Q3 = df[col].quantile(0.75)
            IQR = Q3 - Q1
            lower_bound = Q1 - 1.5 * IQR
            upper_bound = Q3 + 1.5 * IQR
            outliers = ((df[col] < lower_bound) | (df[col] > upper_bound)).sum()

            if outliers > 0:
                stats["outliers"][col] = {
                    "count": int(outliers),
                    "percentage": float(outliers / len(df) * 100),
                    "lower_bound": float(lower_bound),
                    "upper_bound": float(upper_bound)
                }

        # Column types
        for col in df.columns:
            stats["column_types"][col] = str(df[col].dtype)

        return JSONResponse(content=sanitize_data(stats))

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")


@router.get("/download-cleaned/{session_id}")
async def download_cleaned(
    session_id: str,
    db: Session = Depends(get_db)
):
    """Download the cleaned dataset"""
    try:
        file_record = crud.get_file_by_session(db, session_id)
        if not file_record:
            raise HTTPException(404, "Session not found")

        job = crud.get_preprocessing_job(db, file_record.id)

        if job and job.cleaned_file_binary:
            buffer = BytesIO(job.cleaned_file_binary)
        else:
            # Use current file if no cleaned version
            buffer = BytesIO(file_record.file_binary)

        media_type = "text/csv" if file_record.file_type.value.lower() == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"cleaned_{file_record.file_name}"

        return StreamingResponse(
            buffer,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")
