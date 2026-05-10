"""
training_summary.py
───────────────────
Generates a JSON-serialisable summary of the training dataset so that
users browsing the model library can understand what inputs the model
expects and verify their own data is compatible.
"""

from __future__ import annotations

import math
import random
from typing import Any, Dict, List, Optional

import pandas as pd
import numpy as np


# ── helpers ────────────────────────────────────────────────────────────────────

def _safe(v):
    """Convert numpy scalars / NaN to plain Python types."""
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def _is_numeric(series: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(series)


def _is_datetime(series: pd.Series) -> bool:
    return pd.api.types.is_datetime64_any_dtype(series)


# ── main function ──────────────────────────────────────────────────────────────

def compute_training_summary(
    df: pd.DataFrame,
    feature_cols: List[str],
    target_col: str,
) -> Dict[str, Any]:
    """
    Build a dataset-level + per-feature summary from the training DataFrame.

    Parameters
    ----------
    df          : full training DataFrame (before train/test split)
    feature_cols: list of feature column names used by the model
    target_col  : name of the target column

    Returns
    -------
    A dict that is safe to store as JSON.
    """
    summary: Dict[str, Any] = {}

    # ── dataset-level ──────────────────────────────────────────────────────────
    target_series = df[target_col] if target_col in df.columns else None
    task = "regression" if (target_series is not None and _is_numeric(target_series)) else "classification"

    summary["dataset"] = {
        "total_samples":   int(len(df)),
        "num_features":    int(len(feature_cols)),
        "target_column":   target_col,
        "task_type":       task,
    }

    # Class distribution (classification only)
    if task == "classification" and target_series is not None:
        vc = target_series.value_counts(dropna=True)
        total = int(vc.sum())
        summary["dataset"]["class_distribution"] = [
            {
                "class":   str(cls),
                "count":   int(cnt),
                "percent": round(int(cnt) / total * 100, 1) if total else 0,
            }
            for cls, cnt in vc.items()
        ]
        summary["dataset"]["num_classes"] = int(vc.nunique())
    else:
        if target_series is not None:
            summary["dataset"]["target_stats"] = {
                "min":    _safe(target_series.min()),
                "max":    _safe(target_series.max()),
                "mean":   _safe(target_series.mean()),
                "median": _safe(target_series.median()),
                "std":    _safe(target_series.std()),
            }

    # ── per-feature ────────────────────────────────────────────────────────────
    features: Dict[str, Any] = {}

    for col in feature_cols:
        if col not in df.columns:
            features[col] = {"type": "unknown", "missing": None}
            continue

        s = df[col]
        missing = int(s.isna().sum())

        if _is_datetime(s):
            features[col] = {
                "type":        "datetime",
                "missing":     missing,
                "earliest":    str(s.min()) if s.notna().any() else None,
                "latest":      str(s.max()) if s.notna().any() else None,
                "date_range_days": _safe((s.max() - s.min()).days) if s.notna().any() else None,
            }

        elif _is_numeric(s):
            # Distinguish integer vs decimal/float
            is_int = pd.api.types.is_integer_dtype(s) or (
                s.dropna().apply(lambda x: float(x) == int(x)).all()
                if s.notna().any() else True
            )
            dtype_label = "integer" if is_int else "decimal"
            q = s.quantile([0.25, 0.75])
            features[col] = {
                "type":    dtype_label,
                "missing": missing,
                "min":     _safe(s.min()),
                "max":     _safe(s.max()),
                "mean":    _safe(round(float(s.mean()), 4)) if s.notna().any() else None,
                "median":  _safe(s.median()),
                "std":     _safe(round(float(s.std()), 4)) if s.notna().any() else None,
                "q25":     _safe(q[0.25]),
                "q75":     _safe(q[0.75]),
            }

        else:
            # Categorical / text
            vc = s.value_counts(dropna=True)
            top20 = vc.head(20)
            features[col] = {
                "type":          "categorical",
                "missing":       missing,
                "unique_count":  int(s.nunique(dropna=True)),
                "top_values":    [
                    {"value": str(v), "count": int(c)}
                    for v, c in top20.items()
                ],
                "all_values":    [str(v) for v in vc.index.tolist()[:100]],
            }

    summary["features"] = features

    # ── sample rows ────────────────────────────────────────────────────────────
    sample_cols = [c for c in feature_cols if c in df.columns]
    n = min(3, len(df))
    sample_df = df[sample_cols].dropna(how="all").sample(n=n, random_state=42) if len(df) >= n else df[sample_cols]
    sample_rows = []
    for _, row in sample_df.iterrows():
        sample_rows.append({
            col: (None if pd.isna(row[col]) else
                  int(row[col]) if isinstance(row[col], (np.integer,)) else
                  float(row[col]) if isinstance(row[col], (np.floating,)) else
                  str(row[col]))
            for col in sample_cols
        })
    summary["sample_rows"] = sample_rows

    return summary


# ── validation helper ──────────────────────────────────────────────────────────

def validate_user_input(
    user_input: Dict[str, Any],
    training_summary: Dict[str, Any],
) -> List[Dict[str, str]]:
    """
    Compare a new user input row against the training summary.

    Returns a list of warning dicts: [{"field": ..., "warning": ...}]
    Empty list means no issues detected.
    """
    features = training_summary.get("features", {})
    warnings: List[Dict[str, str]] = []

    for col, meta in features.items():
        if col not in user_input:
            warnings.append({"field": col, "warning": f"Required feature '{col}' is missing."})
            continue

        val = user_input[col]
        if val is None or val == "":
            warnings.append({"field": col, "warning": f"'{col}' is empty."})
            continue

        ftype = meta.get("type")

        if ftype == "numerical":
            try:
                num = float(val)
                lo, hi = meta.get("min"), meta.get("max")
                if lo is not None and num < lo:
                    warnings.append({"field": col, "warning": f"Value {num} is below the training minimum ({lo})."})
                if hi is not None and num > hi:
                    warnings.append({"field": col, "warning": f"Value {num} is above the training maximum ({hi})."})
            except (TypeError, ValueError):
                warnings.append({"field": col, "warning": f"Expected a number for '{col}', got '{val}'."})

        elif ftype == "categorical":
            all_vals = meta.get("all_values", [])
            if all_vals and str(val) not in all_vals:
                warnings.append({
                    "field": col,
                    "warning": f"Value '{val}' was not seen during training for '{col}'."
                })

    return warnings
