# routes/ml.py
#
# ML model training, saving, listing, and prediction endpoints.
# Training reads the session's current (step-replayed) DataFrame from the
# profiler cache / file binary.  Models are serialised with joblib and
# stored in the trained_models table.

from __future__ import annotations

import io
import time
import logging
import traceback
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import joblib

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.connection import get_db
from app.db import crud
from app.routes.profiler_cache import get_profiler, bytes_to_df
from app.services.training_summary import compute_training_summary, validate_user_input
from collections import OrderedDict
from threading import Lock

# ── Correlation matrix cache ──────────────────────────────────────────────────
# Key: (session_id, nrows, sorted numeric col names) — stable until data shape
# or numeric columns change. Invalidated automatically via key mismatch.
_corr_store: OrderedDict = OrderedDict()
_corr_lock = Lock()
_CORR_MAX = 30

def _corr_key(session_id: str, df) -> str:
    cols = ",".join(sorted(df.select_dtypes(include=[np.number]).columns.tolist()))
    return f"{session_id}:{df.shape[0]}:{cols}"

def _corr_get(key: str):
    with _corr_lock:
        val = _corr_store.get(key)
        if val is not None:
            _corr_store.move_to_end(key)
        return val

def _corr_put(key: str, value) -> None:
    with _corr_lock:
        _corr_store.pop(key, None)
        if len(_corr_store) >= _CORR_MAX:
            _corr_store.popitem(last=False)
        _corr_store[key] = value

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ml", tags=["ML"])

# ─────────────────────────── helpers ─────────────────────────────────────────

MODEL_REGISTRY: Dict[str, Any] = {}

def _build_model(model_type: str, params: Dict):
    from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.svm import SVC, SVR
    from sklearn.linear_model import LinearRegression, LogisticRegression

    mt = model_type.lower().replace(" ", "_").replace("-", "_")

    if mt in ("knn", "k_nearest_neighbors"):
        k = int(params.get("k", 5))
        metric = params.get("distance", "euclidean")
        weights = params.get("weights", "uniform")
        return {
            "classifier": KNeighborsClassifier(n_neighbors=k, metric=metric, weights=weights),
            "regressor":  KNeighborsRegressor(n_neighbors=k, metric=metric, weights=weights),
        }
    if mt in ("random_forest",):
        kw = dict(
            n_estimators    = int(params.get("n_estimators", 100)),
            max_depth       = int(params.get("max_depth", 10)),
            min_samples_split = int(params.get("min_samples_split", 2)),
            criterion       = params.get("criterion", "gini"),
            random_state    = 42,
            n_jobs          = -1,
        )
        return {
            "classifier": RandomForestClassifier(**kw),
            "regressor":  RandomForestRegressor(**{k: v for k, v in kw.items() if k != "criterion"},
                                                criterion="squared_error"),
        }
    if mt in ("xgboost",):
        try:
            from xgboost import XGBClassifier, XGBRegressor
        except (ImportError, OSError) as exc:
            raise HTTPException(400, f"xgboost is not available: {exc}")
        # use_label_encoder was removed in XGBoost 2.0 — do not pass it.
        kw = dict(
            learning_rate = float(params.get("learning_rate", 0.1)),
            max_depth     = int(params.get("max_depth", 6)),
            n_estimators  = int(params.get("n_estimators", 100)),
            random_state  = 42,
            n_jobs        = 1,   # avoid thread oversubscription inside parallel CV
        )
        return {
            "classifier": XGBClassifier(**kw),
            "regressor":  XGBRegressor(**kw),
        }
    if mt in ("lightgbm", "lgbm"):
        try:
            from lightgbm import LGBMClassifier, LGBMRegressor
        except (ImportError, OSError) as exc:
            raise HTTPException(400, f"lightgbm is not available: {exc}")
        kw = dict(
            learning_rate = float(params.get("learning_rate", 0.1)),
            max_depth     = int(params.get("max_depth", 6)),
            n_estimators  = int(params.get("n_estimators", 100)),
            random_state  = 42,
            verbose       = -1,
            n_jobs        = 1,   # avoid thread oversubscription inside parallel CV
        )
        return {
            "classifier": LGBMClassifier(**kw),
            "regressor":  LGBMRegressor(**kw),
        }
    if mt in ("svm", "support_vector_machine"):
        kernel = params.get("kernel", "rbf")
        C = float(params.get("C", 1.0))
        return {
            "classifier": SVC(C=C, kernel=kernel, probability=True),
            "regressor":  SVR(C=C, kernel=kernel),
        }
    if mt in ("linear_regression",):
        return {
            "classifier": LogisticRegression(max_iter=1000, random_state=42),
            "regressor":  LinearRegression(),
        }
    if mt in ("logistic_regression",):
        C       = float(params.get("C", 1.0))
        max_iter = int(params.get("max_iter", 1000))
        solver  = params.get("solver", "lbfgs")
        penalty = params.get("penalty", "l2")
        return {
            "classifier": LogisticRegression(
                C=C, max_iter=max_iter, solver=solver,
                penalty=penalty, random_state=42,
            ),
            "regressor": LinearRegression(),
        }
    if mt in ("catboost",):
        try:
            from catboost import CatBoostClassifier, CatBoostRegressor
        except (ImportError, OSError) as exc:
            raise HTTPException(400, f"catboost is not available: {exc}")
        kw = dict(
            learning_rate = float(params.get("learning_rate", 0.1)),
            depth         = int(params.get("depth", 6)),
            iterations    = int(params.get("iterations", 100)),
            random_seed   = 42,
            verbose       = 0,
            thread_count  = 1,
        )
        return {
            "classifier": CatBoostClassifier(**kw),
            "regressor":  CatBoostRegressor(**kw),
        }
    raise HTTPException(400, f"Unknown model type: {model_type}")


def _is_classification(y: pd.Series) -> bool:
    """Heuristic: ≤20 unique values or dtype is object/bool → classification."""
    if y.dtype == object or y.dtype.name == "bool":
        return True
    return y.nunique() <= 20


def _run_cv(model, X: np.ndarray, y: np.ndarray, task: str, cv: int) -> Dict:
    """
    Run k-fold cross-validation and return mean ± std for every metric.
    Returns a dict of { metric: mean, metric_std: std }.
    """
    from sklearn.model_selection import cross_validate, StratifiedKFold, KFold
    from sklearn.metrics import make_scorer, mean_absolute_error, mean_squared_error, r2_score

    if task == "classification":
        scoring = {
            "accuracy":  "accuracy",
            "precision": "precision_weighted",
            "recall":    "recall_weighted",
            "f1":        "f1_weighted",
            "mae":       make_scorer(mean_absolute_error, greater_is_better=False),
            "rmse":      make_scorer(
                             lambda yt, yp: float(np.sqrt(mean_squared_error(yt, yp))),
                             greater_is_better=False,
                         ),
            "r2":        "r2",
        }
        cv_splitter = StratifiedKFold(n_splits=cv, shuffle=True, random_state=42)
    else:
        scoring = {
            "mae":  make_scorer(mean_absolute_error, greater_is_better=False),
            "rmse": make_scorer(
                        lambda yt, yp: float(np.sqrt(mean_squared_error(yt, yp))),
                        greater_is_better=False,
                    ),
            "r2":   "r2",
        }
        cv_splitter = KFold(n_splits=cv, shuffle=True, random_state=42)

    try:
        cv_results = cross_validate(
            model, X, y,
            cv=cv_splitter,
            scoring=scoring,
            n_jobs=1,   # models with internal threading (XGBoost/LightGBM) deadlock with n_jobs=-1 on Windows
            return_train_score=False,
            error_score=np.nan,
        )
    except Exception as exc:
        _log.warning("cross_validate failed: %s", exc)
        return {}

    out: Dict[str, Any] = {}
    for key in scoring:
        scores = cv_results.get(f"test_{key}", np.array([np.nan]))
        # sklearn negates "greater_is_better=False" scorers — undo that
        if key in ("mae", "rmse"):
            scores = np.abs(scores)
        valid = scores[~np.isnan(scores)]
        out[key]             = round(float(np.mean(valid)), 4) if len(valid) else None
        out[f"{key}_std"]    = round(float(np.std(valid)),  4) if len(valid) else None

    # For regression, expose r2 as "accuracy" (clamped to ≥0) for the UI
    if task == "regression":
        r2_mean = out.get("r2")
        r2_std  = out.get("r2_std")
        out["accuracy"]     = round(max(0.0, r2_mean), 4) if r2_mean is not None else None
        out["accuracy_std"] = r2_std
        out.setdefault("precision",     None)
        out.setdefault("precision_std", None)
        out.setdefault("recall",        None)
        out.setdefault("recall_std",    None)
        out.setdefault("f1",            None)
        out.setdefault("f1_std",        None)

    return out


def _compute_holdout_metrics(model, X_test: np.ndarray, y_test: np.ndarray, task: str) -> Dict:
    """Final holdout metrics on the test split (after the model is fit on X_train)."""
    from sklearn.metrics import (
        accuracy_score, mean_absolute_error, mean_squared_error,
        r2_score, precision_score, recall_score, f1_score,
    )
    y_pred = model.predict(X_test)
    metrics: Dict[str, Any] = {}

    if task == "classification":
        avg = "weighted"
        metrics["holdout_accuracy"]  = round(float(accuracy_score(y_test, y_pred)), 4)
        metrics["holdout_precision"] = round(float(precision_score(y_test, y_pred, average=avg, zero_division=0)), 4)
        metrics["holdout_recall"]    = round(float(recall_score(y_test, y_pred, average=avg, zero_division=0)), 4)
        metrics["holdout_f1"]        = round(float(f1_score(y_test, y_pred, average=avg, zero_division=0)), 4)
        metrics["holdout_mae"]       = round(float(mean_absolute_error(y_test, y_pred)), 4)
        metrics["holdout_rmse"]      = round(float(np.sqrt(mean_squared_error(y_test, y_pred))), 4)
        metrics["holdout_r2"]        = round(float(r2_score(y_test, y_pred)), 4)
    else:
        mae  = float(mean_absolute_error(y_test, y_pred))
        rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        r2   = float(r2_score(y_test, y_pred))
        metrics["holdout_accuracy"] = round(max(0.0, r2), 4)
        metrics["holdout_mae"]      = round(mae, 4)
        metrics["holdout_rmse"]     = round(rmse, 4)
        metrics["holdout_r2"]       = round(r2, 4)
        metrics["holdout_precision"] = None
        metrics["holdout_recall"]    = None
        metrics["holdout_f1"]        = None

    return metrics


def _get_feature_importance(model, feature_names: List[str]) -> Optional[Dict]:
    try:
        fi = None

        # LightGBM: prefer gain importance — split counts are unnormalised integers
        # that can run into the thousands and are meaningless as percentages.
        if hasattr(model, "booster_") and hasattr(model.booster_, "feature_importance"):
            fi = model.booster_.feature_importance(importance_type="gain").astype(float)
        elif hasattr(model, "feature_importances_"):
            fi = np.array(model.feature_importances_, dtype=float)
        elif hasattr(model, "coef_"):
            coef = np.array(model.coef_, dtype=float)
            if coef.ndim > 1:
                coef = np.abs(coef).mean(axis=0)
            fi = np.abs(coef)

        if fi is None:
            return None

        # Normalise to [0, 1] so the frontend can multiply by 100 to get %.
        total = fi.sum()
        if total > 0:
            fi = fi / total

        return dict(zip(feature_names, [round(float(v), 4) for v in fi]))
    except Exception:
        pass
    return None


def _serialise(model) -> bytes:
    buf = io.BytesIO()
    joblib.dump(model, buf)
    return buf.getvalue()


def _deserialise(binary: bytes):
    return joblib.load(io.BytesIO(binary))


# ─────────────────────────── request / response schemas ──────────────────────

class TrainRequest(BaseModel):
    session_id: str
    feature_columns: List[str]
    target_column: str
    selected_models: List[str]         # e.g. ["KNN", "Random_Forest"]
    hyperparameters: Dict[str, Dict]   # model_type → {param: value}
    train_test_split: float = 0.8
    cv_folds: int = 5
    # Per-column preprocessing (col → "none"|"standard"|"normalize"|"label_encode")
    feature_preprocessing: Optional[Dict[str, str]] = None
    # Target preprocessing: "auto"|"label_encode"|"none"
    target_preprocessing: Optional[str] = None
    # Sampling strategy for class imbalance: "none"|"stratified"|"random_oversampling"|"smote"
    sampling_method: Optional[str] = "none"


class SaveModelRequest(BaseModel):
    # The trained model data comes from the /train response (kept in client memory)
    session_id: str
    model_type: str
    model_name: str
    description: Optional[str] = None
    tags: Optional[List[str]] = []
    visibility: str = "private"
    user_id: Optional[int] = None
    # Serialised training result forwarded from the train response
    feature_columns: List[str]
    target_column: str
    hyperparameters: Dict = {}
    metrics: Dict = {}
    training_time_seconds: float = 0.0
    training_samples: int = 0
    test_samples: int = 0
    # model binary as base64 is too large; we re-train on save instead of
    # transferring the binary over HTTP.  So we also accept the same train params.
    train_test_split: float = 0.8
    # Optional: raw model bytes encoded as base64 (if client cached them)


class PredictRequest(BaseModel):
    model_id: Optional[int] = None   # also supplied as path param
    input_data: Dict[str, Any]       # {feature_name: value}
    user_id: Optional[int] = None


class ListModelsRequest(BaseModel):
    user_id: Optional[int] = None
    scope: str = "my"              # "my" | "public" | "all"
    model_type: Optional[str] = None
    sort_by: str = "date"          # "accuracy" | "date" | "times_used"


# ─────────────────────────── /session-info ───────────────────────────────────

@router.get("/session-info/{session_id}")
async def get_session_info(session_id: str, db: Session = Depends(get_db)):
    """Return column names and dtypes of the current session DataFrame."""
    try:
        profiler = get_profiler(session_id, db)
        df: pd.DataFrame = profiler.df
    except Exception:
        raise HTTPException(404, "Session not found or no data")

    columns = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        if dtype.startswith("int") or dtype.startswith("Int"):
            col_type = "numeric"
        elif dtype.startswith("float"):
            col_type = "numeric"
        elif dtype in ("bool",):
            col_type = "categorical"
        else:
            col_type = "categorical"

        # Class distribution + imbalance check for categorical columns
        is_imbalanced = False
        imbalance_ratio = None
        dominant_class = None
        dominant_pct = None
        class_distribution = []   # [{label, count, pct}] top-10
        if col_type == "categorical":
            n_unique = int(df[col].nunique())
            vc = df[col].value_counts().head(10)
            total = int(df[col].count())
            if total > 0:
                class_distribution = [
                    {"label": str(k), "count": int(v), "pct": round(v / total * 100, 1)}
                    for k, v in vc.items()
                ]
            if 2 <= n_unique <= 20 and total > 0:
                max_count = int(vc.iloc[0])
                min_count = int(df[col].value_counts().iloc[-1])
                dom_pct = max_count / total
                if dom_pct >= 0.75 and min_count > 0:
                    is_imbalanced = True
                    imbalance_ratio = round(max_count / min_count, 2)
                    dominant_class = str(vc.index[0])
                    dominant_pct = round(dom_pct * 100, 1)

        columns.append({
            "name": col,
            "dtype": dtype,
            "type": col_type,
            "is_imbalanced": is_imbalanced,
            "imbalance_ratio": imbalance_ratio,
            "dominant_class": dominant_class,
            "dominant_pct": dominant_pct,
            "class_distribution": class_distribution,
        })

    return {
        "session_id": session_id,
        "rows": int(len(df)),
        "columns": columns,
    }


# ─────────────────────────── /preview-transform ──────────────────────────────

class PreviewTransformRequest(BaseModel):
    session_id: str
    feature_columns: List[str]
    target_column: str
    feature_preprocessing: Optional[Dict[str, str]] = None
    target_preprocessing: Optional[str] = None


@router.post("/preview-transform")
async def preview_transform(req: PreviewTransformRequest, db: Session = Depends(get_db)):
    """
    Apply the requested per-column transforms to a copy of the session DataFrame
    and return before/after column stats + first 10 sample rows.
    The original session data is never modified.
    """
    from sklearn.preprocessing import StandardScaler, MinMaxScaler, OrdinalEncoder
    from sklearn.compose import ColumnTransformer

    try:
        profiler = get_profiler(req.session_id, db)
        df: pd.DataFrame = profiler.df.copy()
    except Exception:
        raise HTTPException(404, "Session not found")

    all_cols = req.feature_columns + ([req.target_column] if req.target_column else [])
    missing = [c for c in all_cols if c not in df.columns]
    if missing:
        raise HTTPException(400, f"Columns not found: {missing}")

    # Work on selected columns only
    feat_prep: Dict[str, str] = dict(req.feature_preprocessing or {})
    for col in req.feature_columns:
        if col not in feat_prep:
            dtype = str(df[col].dtype)
            feat_prep[col] = "none" if dtype.startswith(("int", "Int", "float", "Float")) else "label_encode"

    tgt_prep = req.target_preprocessing or "auto"

    # ── Compute BEFORE stats ──────────────────────────────────────────────────
    def col_stats(series: pd.Series, prep: str) -> Dict:
        s = series.dropna()
        if prep == "label_encode" or s.dtype == object:
            vc = s.astype(str).value_counts()
            return {
                "dtype":    str(series.dtype),
                "unique":   int(s.nunique()),
                "top":      vc.index[0] if len(vc) else None,
                "nulls":    int(series.isna().sum()),
                "is_cat":   True,
            }
        return {
            "dtype":  str(series.dtype),
            "mean":   round(float(s.mean()), 4),
            "std":    round(float(s.std()),  4),
            "min":    round(float(s.min()),  4),
            "max":    round(float(s.max()),  4),
            "nulls":  int(series.isna().sum()),
            "is_cat": False,
        }

    before_stats: Dict[str, Dict] = {}
    for col in req.feature_columns:
        before_stats[col] = col_stats(df[col], feat_prep.get(col, "none"))
    if req.target_column:
        before_stats[req.target_column] = col_stats(df[req.target_column], tgt_prep)

    # ── Build ColumnTransformer for features ──────────────────────────────────
    standard_cols    = [c for c in req.feature_columns if feat_prep.get(c) == "standard"]
    normalize_cols   = [c for c in req.feature_columns if feat_prep.get(c) == "normalize"]
    encode_cols      = [c for c in req.feature_columns if feat_prep.get(c) == "label_encode"]
    passthrough_cols = [c for c in req.feature_columns if feat_prep.get(c) == "none"]

    X = df[req.feature_columns].copy()
    for c in encode_cols:
        X[c] = X[c].astype(str)

    transformers = []
    if standard_cols:
        transformers.append(("standard", StandardScaler(), standard_cols))
    if normalize_cols:
        transformers.append(("normalize", MinMaxScaler(), normalize_cols))
    if encode_cols:
        transformers.append(("encode", OrdinalEncoder(
            handle_unknown="use_encoded_value", unknown_value=-1
        ), encode_cols))
    if passthrough_cols:
        transformers.append(("pass", "passthrough", passthrough_cols))

    effective_cols = standard_cols + normalize_cols + encode_cols + passthrough_cols
    label_classes_per_col: Dict[str, List] = {}

    if transformers:
        ct = ColumnTransformer(transformers=transformers, remainder="drop")
        X_arr = ct.fit_transform(X)
        X_transformed = pd.DataFrame(X_arr, columns=effective_cols)
        # Capture ordinal category mappings
        for t_name, t_trans, t_cols in ct.transformers_:
            if t_name == "encode" and hasattr(t_trans, "categories_"):
                for c, cats in zip(t_cols, t_trans.categories_):
                    label_classes_per_col[c] = cats.tolist()
    else:
        X_transformed = X.copy()

    # ── Transform target ─────────────────────────────────────────────────────
    y_orig = df[req.target_column].copy() if req.target_column else None
    y_transformed = None
    target_classes = None

    if y_orig is not None:
        from sklearn.preprocessing import LabelEncoder
        is_classification = _is_classification(y_orig)
        if tgt_prep == "label_encode" or (tgt_prep == "auto" and is_classification):
            le_y = LabelEncoder()
            y_transformed = pd.Series(le_y.fit_transform(y_orig.astype(str)), name=req.target_column)
            target_classes = le_y.classes_.tolist()
        else:
            y_transformed = pd.to_numeric(y_orig, errors="coerce")

    # ── Compute AFTER stats ───────────────────────────────────────────────────
    after_stats: Dict[str, Dict] = {}
    for col in effective_cols:
        p = feat_prep.get(col, "none")
        after_stats[col] = col_stats(X_transformed[col], p)

    if req.target_column and y_transformed is not None:
        after_stats[req.target_column] = col_stats(y_transformed, tgt_prep)

    # ── Build column summary list ─────────────────────────────────────────────
    column_summary = []
    for col in req.feature_columns:
        column_summary.append({
            "column":     col,
            "transform":  feat_prep.get(col, "none"),
            "before":     before_stats.get(col),
            "after":      after_stats.get(col),
            "categories": label_classes_per_col.get(col),
        })
    if req.target_column:
        column_summary.append({
            "column":     req.target_column,
            "transform":  tgt_prep,
            "is_target":  True,
            "before":     before_stats.get(req.target_column),
            "after":      after_stats.get(req.target_column),
            "categories": target_classes,
        })

    # ── Sample rows (first 10, original columns only) ─────────────────────────
    sample_before = df[req.feature_columns + ([req.target_column] if req.target_column else [])].head(10)
    sample_before = sample_before.where(sample_before.notna(), None)

    # Align transformed sample
    if y_transformed is not None:
        sample_after_df = pd.concat(
            [X_transformed.head(10).reset_index(drop=True),
             y_transformed.head(10).reset_index(drop=True).rename(req.target_column)],
            axis=1
        )
    else:
        sample_after_df = X_transformed.head(10).reset_index(drop=True)

    sample_after_df = sample_after_df.round(4).where(sample_after_df.notna(), None)

    return {
        "feature_columns":       req.feature_columns,
        "target_column":         req.target_column,
        "column_summary":        column_summary,
        "sample_before":         sample_before.to_dict(orient="records"),
        "sample_after":          sample_after_df.to_dict(orient="records"),
        "label_classes_per_col": label_classes_per_col,
        "target_classes":        target_classes,
    }


# ─────────────────────────── /correlation ────────────────────────────────────

@router.get("/correlation/{session_id}")
async def get_correlation(session_id: str, db: Session = Depends(get_db)):
    """Return the correlation matrix for all numeric columns in the dataset."""
    try:
        profiler = get_profiler(session_id, db)
        df: pd.DataFrame = profiler.df
    except Exception:
        raise HTTPException(404, "Session not found")

    numeric_df = df.select_dtypes(include=[np.number])
    if numeric_df.shape[1] < 2:
        return {"columns": [], "matrix": [], "warnings": []}

    cache_key = _corr_key(session_id, df)
    cached = _corr_get(cache_key)
    if cached is not None:
        return cached

    corr = numeric_df.corr().round(3)
    cols = corr.columns.tolist()
    matrix = corr.values.tolist()

    warnings = []
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            v = abs(corr.iloc[i, j])
            if v > 0.8:
                warnings.append({
                    "col1": cols[i],
                    "col2": cols[j],
                    "correlation": round(float(corr.iloc[i, j]), 3),
                })

    result = {"columns": cols, "matrix": matrix, "warnings": warnings}
    _corr_put(cache_key, result)
    return result


# ─────────────────────────── /train ──────────────────────────────────────────

@router.post("/train")
async def train_models(req: TrainRequest, db: Session = Depends(get_db)):
    """
    Train one or more models on the session DataFrame.
    Returns metrics + serialised model bytes for each model (base64-free:
    binaries are kept server-side in a short-lived cache keyed by a token).
    """
    from sklearn.model_selection import train_test_split as tts
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import LabelEncoder, MinMaxScaler, StandardScaler, OrdinalEncoder
    from sklearn.compose import ColumnTransformer

    # ── Load data ─────────────────────────────────────────────────────────────
    try:
        profiler = get_profiler(req.session_id, db)
        df: pd.DataFrame = profiler.df.copy()
    except Exception:
        raise HTTPException(404, "Session not found")

    missing = [c for c in req.feature_columns + [req.target_column] if c not in df.columns]
    if missing:
        raise HTTPException(400, f"Columns not found: {missing}")

    X = df[req.feature_columns].copy()
    y = df[req.target_column].copy()

    # Drop rows with NaN in X or y
    valid = X.notna().all(axis=1) & y.notna()
    X = X[valid]
    y = y[valid]

    if len(X) < 10:
        raise HTTPException(400, "Not enough rows to train (need at least 10)")

    # ── Per-column preprocessing ──────────────────────────────────────────────
    feat_prep: Dict[str, str] = dict(req.feature_preprocessing or {})
    # Auto-detect defaults for any column not specified
    for col in req.feature_columns:
        if col not in feat_prep:
            dtype = str(df[col].dtype)
            if dtype.startswith(("int", "Int", "float", "Float")):
                feat_prep[col] = "none"
            else:
                feat_prep[col] = "label_encode"

    # Group columns by transform type (CT output order: standard → normalize → encode → pass)
    standard_cols    = [c for c in req.feature_columns if feat_prep.get(c) == "standard"]
    normalize_cols   = [c for c in req.feature_columns if feat_prep.get(c) == "normalize"]
    encode_cols      = [c for c in req.feature_columns if feat_prep.get(c) == "label_encode"]
    passthrough_cols = [c for c in req.feature_columns if feat_prep.get(c) == "none"]

    # Coerce OrdinalEncoder columns to string
    for c in encode_cols:
        X[c] = X[c].astype(str)

    # Effective column order after ColumnTransformer
    effective_feature_cols = standard_cols + normalize_cols + encode_cols + passthrough_cols

    # ── Detect task + encode target ───────────────────────────────────────────
    task = "classification" if _is_classification(y) else "regression"
    tgt_prep = req.target_preprocessing or "auto"
    le_y: Optional[LabelEncoder] = None
    label_classes: Optional[List] = None

    if task == "classification" or tgt_prep == "label_encode":
        le_y = LabelEncoder()
        y = le_y.fit_transform(y.astype(str))
        label_classes = le_y.classes_.tolist()
    else:
        y = pd.to_numeric(y, errors="coerce")
        valid2 = pd.Series(y).notna()
        X = X[valid2.values]
        y = y[valid2.values]

    sampling_method = (req.sampling_method or "none").lower()
    test_size = 1.0 - req.train_test_split

    # Stratified split preserves class distribution in both halves
    use_stratify = (task == "classification" and sampling_method == "stratified")
    try:
        X_train, X_test, y_train, y_test = tts(
            X, y, test_size=test_size, random_state=42,
            stratify=y if use_stratify else None,
        )
    except ValueError:
        # Fall back to un-stratified if any class has too few samples
        X_train, X_test, y_train, y_test = tts(
            X, y, test_size=test_size, random_state=42
        )

    cv = max(2, min(req.cv_folds, len(X_train)))   # guard: can't fold more than rows

    # ── Train each requested model ────────────────────────────────────────────
    results = []
    for model_type in req.selected_models:
        params = req.hyperparameters.get(model_type, {})
        try:
            model_variants = _build_model(model_type, params)
            base_model = model_variants["classifier"] if task == "classification" else model_variants["regressor"]

            # Build a fresh ColumnTransformer for this model
            fresh_transformers = []
            if standard_cols:
                fresh_transformers.append(("standard", StandardScaler(), standard_cols))
            if normalize_cols:
                fresh_transformers.append(("normalize", MinMaxScaler(), normalize_cols))
            if encode_cols:
                fresh_transformers.append(("encode", OrdinalEncoder(
                    handle_unknown="use_encoded_value", unknown_value=-1, dtype=np.int64
                ), encode_cols))
            if passthrough_cols:
                fresh_transformers.append(("pass", "passthrough", passthrough_cols))

            # Build sampler for oversampling methods (classification only)
            sampler = None
            if task == "classification" and sampling_method in ("random_oversampling", "smote", "smote_tomek"):
                try:
                    if sampling_method == "smote":
                        from imblearn.over_sampling import SMOTE
                        sampler = SMOTE(random_state=42)
                    elif sampling_method == "smote_tomek":
                        from imblearn.combine import SMOTETomek
                        sampler = SMOTETomek(random_state=42)
                    else:
                        from imblearn.over_sampling import RandomOverSampler
                        sampler = RandomOverSampler(random_state=42)
                except ImportError:
                    sampler = None  # imbalanced-learn not installed — skip silently

            if fresh_transformers:
                preprocessor = ColumnTransformer(transformers=fresh_transformers, remainder="drop")
                if sampler is not None:
                    from imblearn.pipeline import Pipeline as ImbPipeline
                    model = ImbPipeline([("preprocessor", preprocessor), ("sampler", sampler), ("model", base_model)])
                else:
                    model = Pipeline([("preprocessor", preprocessor), ("model", base_model)])
            else:
                if sampler is not None:
                    from imblearn.pipeline import Pipeline as ImbPipeline
                    model = ImbPipeline([("sampler", sampler), ("model", base_model)])
                else:
                    model = base_model

            # ── 1. Cross-validate on the training split → mean ± std metrics ──
            t0 = time.time()
            cv_metrics = _run_cv(model, X_train, y_train, task, cv)
            cv_elapsed = time.time() - t0

            # ── 2. Final fit on full training split → model for saving ──────
            t1 = time.time()
            model.fit(X_train, y_train)
            fit_elapsed = time.time() - t1

            total_elapsed = cv_elapsed + fit_elapsed

            # ── 3. Holdout test-set metrics (single evaluation, no leakage) ──
            holdout = _compute_holdout_metrics(model, X_test, y_test, task)

            # Extract label categories per column from the fitted OrdinalEncoder
            label_classes_per_col: Dict[str, List] = {}
            if isinstance(model, Pipeline):
                fitted_ct = model.named_steps.get("preprocessor")
                if fitted_ct and hasattr(fitted_ct, "transformers_"):
                    for t_name, t_trans, t_cols in fitted_ct.transformers_:
                        if t_name == "encode" and hasattr(t_trans, "categories_"):
                            for col, cats in zip(t_cols, t_trans.categories_):
                                label_classes_per_col[col] = cats.tolist()

            # Merge everything into one metrics dict
            metrics = {
                **cv_metrics,          # accuracy, accuracy_std, mae, mae_std, …
                **holdout,             # holdout_accuracy, holdout_mae, …
                "training_time": round(total_elapsed, 3),
                "cv_folds":      cv,
                "target_encoding": "label_encode" if le_y is not None else "none",
            }

            # Model size in MB (pipeline binary)
            buf = io.BytesIO()
            joblib.dump(model, buf)
            metrics["model_size_mb"] = round(len(buf.getvalue()) / 1_048_576, 3)

            # Feature importance: uses effective column order (CT output order)
            fi_model = model.named_steps["model"] if isinstance(model, Pipeline) else model
            fi = _get_feature_importance(fi_model, effective_feature_cols)

            # Compute training data summary for model library reference
            try:
                tr_summary = compute_training_summary(df, req.feature_columns, req.target_column)
            except Exception:
                tr_summary = {}

            # Cache serialised binary server-side
            binary = _serialise(model)
            cache_key = f"{req.session_id}::{model_type}"
            MODEL_REGISTRY[cache_key] = {
                "binary":                binary,
                "feature_columns":       req.feature_columns,
                "target_column":         req.target_column,
                "task":                  task,
                "label_encoder_y":       le_y,
                "label_classes":         label_classes,
                "feature_preprocessing": feat_prep,
                "label_classes_per_col": label_classes_per_col,
                "training_summary":      tr_summary,
            }

            preprocessing_summary = {
                "feature_preprocessing":  feat_prep,
                "target_encoding":        "label_encode" if le_y is not None else "none",
                "label_classes":          label_classes,
                "label_classes_per_col":  label_classes_per_col,
            }

            results.append({
                "model_type":            model_type,
                "task":                  task,
                "metrics":               metrics,
                "feature_importance":    fi,
                "hyperparameters":       params,
                "training_samples":      int(len(X_train)),
                "test_samples":          int(len(X_test)),
                "cache_key":             cache_key,
                "label_classes":         label_classes,
                "preprocessing_summary": preprocessing_summary,
            })
        except HTTPException:
            raise
        except Exception as exc:
            _log.warning("Training %s failed: %s", model_type, exc)
            results.append({
                "model_type": model_type,
                "error":      str(exc),
            })

    # Sort by accuracy desc
    ok = [r for r in results if "metrics" in r]
    err = [r for r in results if "error" in r]
    ok.sort(key=lambda r: r["metrics"].get("accuracy", 0), reverse=True)

    return {
        "session_id": req.session_id,
        "task": task,
        "feature_columns": req.feature_columns,
        "target_column": req.target_column,
        "results": ok + err,
    }


# ─────────────────────────── /models/save ────────────────────────────────────

@router.post("/models/save")
async def save_model(req: SaveModelRequest, db: Session = Depends(get_db)):
    """
    Persist a trained model (retrieved from the server-side cache) to the DB.
    """
    cache_key = f"{req.session_id}::{req.model_type}"
    cached = MODEL_REGISTRY.get(cache_key)
    if not cached:
        # Model not in cache (server restarted?).  Tell the client to retrain.
        raise HTTPException(
            400,
            "Trained model not found in cache. Please retrain before saving.",
        )

    user_id = req.user_id or 1
    file_record = crud.get_file_by_session(db, req.session_id)
    file_id = file_record.id if file_record else None

    # Resolve username for created_by
    user = crud.get_user_by_id(db, user_id)
    created_by = user.username if user else f"user_{user_id}"

    # Merge preprocessing info from cache into hyperparameters so it survives reloads
    hyp = dict(req.hyperparameters or {})
    if cached.get("feature_preprocessing"):
        hyp["feature_preprocessing"] = cached["feature_preprocessing"]
    if cached.get("label_classes_per_col"):
        hyp["label_classes_per_col"] = cached["label_classes_per_col"]
    if cached.get("training_summary"):
        hyp["training_summary"] = cached["training_summary"]

    saved = crud.save_trained_model(
        db                    = db,
        user_id               = user_id,
        model_name            = req.model_name,
        model_type            = req.model_type,
        model_binary          = cached["binary"],
        metrics               = req.metrics,
        hyperparameters       = hyp,
        feature_names         = req.feature_columns,
        target_column         = req.target_column,
        training_time_seconds = req.training_time_seconds,
        training_samples      = req.training_samples,
        test_samples          = req.test_samples,
        description           = req.description,
        visibility            = req.visibility,
        tags                  = req.tags or [],
        created_by            = created_by,
        file_id               = file_id,
    )

    return {"success": True, "model_id": saved.id, "message": f"Model '{req.model_name}' saved."}


# ─────────────────────────── /models  (list) ─────────────────────────────────

@router.get("/models")
async def list_models(
    user_id:    int  = 1,
    scope:      str  = "my",
    model_type: str  = None,
    sort_by:    str  = "date",
    db: Session = Depends(get_db),
):
    models = crud.list_models(db, user_id=user_id, scope=scope,
                               model_type=model_type, sort_by=sort_by)
    out = []
    for m in models:
        tc = m.training_config or {}
        out.append({
            "id":                   m.id,
            "model_name":           m.model_name,
            "model_type":           m.model_type.value if m.model_type else "",
            "description":          m.description,
            "accuracy":             m.accuracy,
            "mae":                  m.mae,
            "r2_score":             m.r2_score,
            "f1_score":             m.f1_score,
            "rmse":                 m.rmse,
            "model_size_mb":        round(m.model_size / 1_048_576, 3) if m.model_size else 0,
            "training_time_seconds":m.training_time_seconds,
            "training_samples":     m.training_samples,
            "test_samples":         m.test_samples,
            "feature_columns":      m.feature_columns,
            "target_column":        m.target_column,
            "tags":                 m.tags or [],
            "visibility":           m.visibility,
            "created_by":           m.created_by,
            "times_used":           m.times_used,
            "created_at":           m.created_at.isoformat() if m.created_at else None,
            "training_summary":     tc.get("training_summary"),
        })
    return {"models": out}


# ─────────────────────────── /models/{id} ────────────────────────────────────

@router.get("/models/{model_id}")
async def get_model(model_id: int, db: Session = Depends(get_db)):
    m = crud.get_model_by_id(db, model_id)
    if not m or not m.is_active:
        raise HTTPException(404, "Model not found")
    return {
        "id":                   m.id,
        "model_name":           m.model_name,
        "model_type":           m.model_type.value if m.model_type else "",
        "description":          m.description,
        "metrics":              m.metrics,
        "hyperparameters":      m.training_config,
        "feature_columns":      m.feature_columns,
        "target_column":        m.target_column,
        "accuracy":             m.accuracy,
        "mae":                  m.mae,
        "r2_score":             m.r2_score,
        "precision_score":      m.precision_score,
        "recall_score":         m.recall_score,
        "f1_score":             m.f1_score,
        "rmse":                 m.rmse,
        "model_size_mb":        round(m.model_size / 1_048_576, 3) if m.model_size else 0,
        "training_time_seconds":m.training_time_seconds,
        "training_samples":     m.training_samples,
        "test_samples":         m.test_samples,
        "visibility":           m.visibility,
        "tags":                 m.tags or [],
        "created_by":           m.created_by,
        "times_used":           m.times_used,
        "created_at":           m.created_at.isoformat() if m.created_at else None,
        "training_summary":     (m.training_config or {}).get("training_summary"),
    }


@router.delete("/models/{model_id}")
async def delete_model(model_id: int, user_id: int = 1, db: Session = Depends(get_db)):
    ok = crud.delete_trained_model(db, model_id, user_id)
    if not ok:
        raise HTTPException(404, "Model not found or not owned by you")
    return {"success": True}


# ─────────────────────────── /models/{id}/predict ────────────────────────────

@router.post("/models/{model_id}/predict")
async def predict(model_id: int, req: PredictRequest, db: Session = Depends(get_db)):
    m = crud.get_model_by_id(db, model_id)
    if not m or not m.is_active:
        raise HTTPException(404, "Model not found")

    try:
        model = _deserialise(m.model_binary)
    except Exception as exc:
        raise HTTPException(500, f"Could not load model: {exc}")

    feature_cols = m.feature_columns or []

    # Retrieve feature_preprocessing stored with the model
    saved_feat_prep: Dict[str, str] = {}
    if m.training_config:
        tc = m.training_config if isinstance(m.training_config, dict) else {}
        saved_feat_prep = tc.get("feature_preprocessing", {})

    row: Dict[str, Any] = {}
    for col in feature_cols:
        val = req.input_data.get(col)
        if saved_feat_prep.get(col) == "label_encode":
            row[col] = str(val) if val is not None else ""
        else:
            try:
                row[col] = float(val) if val is not None else 0.0
            except (TypeError, ValueError):
                row[col] = 0.0

    X_input = pd.DataFrame([row])[feature_cols]

    try:
        prediction = model.predict(X_input)
        pred_value = prediction[0]
        if isinstance(pred_value, (np.integer,)):
            pred_value = int(pred_value)
        elif isinstance(pred_value, (np.floating,)):
            pred_value = float(pred_value)

        confidence = None
        if hasattr(model, "predict_proba"):
            try:
                proba = model.predict_proba(X_input)[0]
                confidence = round(float(max(proba)), 4)
            except Exception:
                pass

    except Exception as exc:
        raise HTTPException(500, f"Prediction failed: {exc}")

    crud.increment_model_usage(db, model_id)

    # Include stored training metrics so the frontend can show model quality
    stored_metrics = m.metrics or {}
    model_metrics = {
        "accuracy":  m.accuracy,
        "f1":        m.f1_score,
        "precision": m.precision_score,
        "recall":    m.recall_score,
        "mae":       m.mae,
        "rmse":      m.rmse,
        "r2":        m.r2_score,
        # richer fields from the JSON blob if available
        "holdout_accuracy": stored_metrics.get("holdout_accuracy"),
        "cv_accuracy":      stored_metrics.get("accuracy"),
        "accuracy_std":     stored_metrics.get("accuracy_std"),
        "task":             stored_metrics.get("task_type") or (
            "regression" if m.mae is not None and m.accuracy is None else "classification"
        ),
    }
    # Remove None-only keys to keep response clean
    model_metrics = {k: v for k, v in model_metrics.items() if v is not None}

    return {
        "model_id":     model_id,
        "model_name":   m.model_name,
        "prediction":   pred_value,
        "confidence":   confidence,
        "target_column": m.target_column,
        "model_metrics": model_metrics,
    }


# ─────────────────────── /predict-cached (in-session, pre-save) ──────────────

class CachedPredictRequest(BaseModel):
    session_id: str
    model_type: str
    feature_columns: List[str]
    target_column: str
    input_data: Dict[str, Any]


@router.post("/predict-cached")
async def predict_cached(req: CachedPredictRequest):
    """
    Make a prediction from a model that was just trained (still in the
    server-side cache) but not yet saved to the database.
    """
    cache_key = f"{req.session_id}::{req.model_type}"
    cached = MODEL_REGISTRY.get(cache_key)
    if not cached:
        raise HTTPException(
            400,
            "Model not found in cache. Please retrain before predicting.",
        )

    model = _deserialise(cached["binary"])
    feature_cols = req.feature_columns or cached.get("feature_columns", [])
    le_y: Optional[LabelEncoder] = cached.get("label_encoder_y")
    cached_feat_prep: Dict[str, str] = cached.get("feature_preprocessing", {})

    row: Dict[str, Any] = {}
    for col in feature_cols:
        val = req.input_data.get(col)
        if cached_feat_prep.get(col) == "label_encode":
            row[col] = str(val) if val is not None else ""
        else:
            try:
                row[col] = float(val) if val is not None else 0.0
            except (TypeError, ValueError):
                row[col] = 0.0

    X_input = pd.DataFrame([row])[feature_cols]

    try:
        prediction = model.predict(X_input)
        pred_value = prediction[0]
        if isinstance(pred_value, (np.integer,)):
            pred_value = int(pred_value)
        elif isinstance(pred_value, (np.floating,)):
            pred_value = float(pred_value)

        # Inverse-transform label-encoded predictions back to original class names
        if le_y is not None:
            try:
                pred_value = le_y.inverse_transform([int(pred_value)])[0]
            except Exception:
                pass

        confidence = None
        if hasattr(model, "predict_proba"):
            try:
                proba = model.predict_proba(X_input)[0]
                confidence = round(float(max(proba)), 4)
            except Exception:
                pass
    except Exception as exc:
        raise HTTPException(500, f"Prediction failed: {exc}")

    return {
        "model_type":    req.model_type,
        "prediction":    pred_value,
        "confidence":    confidence,
        "target_column": req.target_column,
        "label_classes": cached.get("label_classes"),
    }


# ─────────────────────── file-based bulk prediction ──────────────────────────

def _read_uploaded_file(content: bytes, filename: str) -> pd.DataFrame:
    name = (filename or "").lower()
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return pd.read_excel(io.BytesIO(content))
    return pd.read_csv(io.BytesIO(content))


def _eval_metrics(y_true, y_pred, model) -> Dict:
    """Compute evaluation metrics by comparing predictions to actual values."""
    from sklearn.metrics import (
        accuracy_score, f1_score, precision_score, recall_score,
        mean_absolute_error, mean_squared_error, r2_score,
    )
    import math
    metrics = {}
    try:
        # Determine task type: if target is numeric try regression metrics first
        numeric_target = pd.to_numeric(pd.Series(y_true), errors="coerce").notna().all()
        has_proba = hasattr(model, "predict_proba")

        if not has_proba and numeric_target:
            # Regression
            y_t = [float(v) for v in y_true]
            y_p = [float(v) for v in y_pred]
            mae  = mean_absolute_error(y_t, y_p)
            rmse = math.sqrt(mean_squared_error(y_t, y_p))
            r2   = r2_score(y_t, y_p)
            metrics["mae"]  = round(mae, 4)
            metrics["rmse"] = round(rmse, 4)
            metrics["r2"]   = round(r2, 4)
            metrics["task"] = "regression"
        else:
            # Classification
            y_t = [str(v) for v in y_true]
            y_p = [str(v) for v in y_pred]
            avg = "binary" if len(set(y_t)) == 2 else "weighted"
            metrics["accuracy"]  = round(float(accuracy_score(y_t, y_p)), 4)
            metrics["f1"]        = round(float(f1_score(y_t, y_p, average=avg, zero_division=0)), 4)
            metrics["precision"] = round(float(precision_score(y_t, y_p, average=avg, zero_division=0)), 4)
            metrics["recall"]    = round(float(recall_score(y_t, y_p, average=avg, zero_division=0)), 4)
            metrics["task"] = "classification"
    except Exception as exc:
        metrics["error"] = str(exc)
    return metrics


def _bulk_predict(model, feature_cols: List[str], df: pd.DataFrame, target_col: str,
                  le_y: Optional[Any] = None,
                  feature_prep: Optional[Dict[str, str]] = None):
    """Run model on every row and return the augmented DataFrame as records."""
    fp = feature_prep or {}
    available = [c for c in feature_cols if c in df.columns]
    missing = [c for c in feature_cols if c not in df.columns]

    X = df[available].copy()
    for c in missing:
        X[c] = "" if fp.get(c) == "label_encode" else 0.0
    X = X[feature_cols]

    # Fill NaN appropriately per column type
    for c in feature_cols:
        if fp.get(c) == "label_encode":
            X[c] = X[c].fillna("").astype(str)
        else:
            X[c] = pd.to_numeric(X[c], errors="coerce").fillna(0)

    raw_preds = model.predict(X)

    # Inverse-transform if a label encoder was used on the target
    if le_y is not None:
        try:
            predictions = le_y.inverse_transform([int(p) for p in raw_preds])
        except Exception:
            predictions = raw_preds
    else:
        predictions = [
            int(p) if isinstance(p, (np.integer,)) else
            float(p) if isinstance(p, (np.floating,)) else p
            for p in raw_preds
        ]

    pred_col = f"{target_col}_predicted"
    result = df.copy()
    result[pred_col] = predictions

    confidence_col = None
    if hasattr(model, "predict_proba"):
        try:
            proba = model.predict_proba(X)
            result[f"{target_col}_confidence"] = [round(float(max(row)), 4) for row in proba]
            confidence_col = f"{target_col}_confidence"
        except Exception:
            pass

    return result, pred_col, confidence_col, missing


@router.post("/models/{model_id}/predict-file")
async def predict_file(
    model_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Bulk-predict every row in an uploaded CSV / Excel file using a saved model."""
    m = crud.get_model_by_id(db, model_id)
    if not m or not m.is_active:
        raise HTTPException(404, "Model not found")

    content = await file.read()
    try:
        df = _read_uploaded_file(content, file.filename)
    except Exception as exc:
        raise HTTPException(400, f"Could not read file: {exc}")

    if m.model_binary:
        model = _deserialise(m.model_binary)
    else:
        raise HTTPException(400, "Model binary not stored — please retrain and save.")

    feature_cols = m.feature_columns if isinstance(m.feature_columns, list) else (json.loads(m.feature_columns) if m.feature_columns else [])
    if not feature_cols:
        raise HTTPException(400, "Model has no feature columns recorded.")

    # Retrieve feature_preprocessing stored with the model
    saved_fp: Dict[str, str] = {}
    if m.training_config:
        tc = m.training_config if isinstance(m.training_config, dict) else {}
        saved_fp = tc.get("feature_preprocessing", {})

    try:
        result_df, pred_col, conf_col, missing_cols = _bulk_predict(
            model, feature_cols, df, m.target_column, feature_prep=saved_fp
        )
    except Exception as exc:
        raise HTTPException(500, f"Prediction failed: {exc}")

    # Compute evaluation metrics if the file contains the actual target column
    eval_metrics = None
    if m.target_column and m.target_column in df.columns:
        y_true = df[m.target_column].tolist()
        y_pred_vals = result_df[pred_col].tolist()
        eval_metrics = _eval_metrics(y_true, y_pred_vals, model)

    # Stored training metrics
    stored_metrics = m.metrics or {}
    model_metrics = {
        "accuracy":         m.accuracy,
        "f1":               m.f1_score,
        "precision":        m.precision_score,
        "recall":           m.recall_score,
        "mae":              m.mae,
        "rmse":             m.rmse,
        "r2":               m.r2_score,
        "holdout_accuracy": stored_metrics.get("holdout_accuracy"),
        "cv_accuracy":      stored_metrics.get("accuracy"),
        "accuracy_std":     stored_metrics.get("accuracy_std"),
        "task":             stored_metrics.get("task_type") or (
            "regression" if m.mae is not None and m.accuracy is None else "classification"
        ),
    }
    model_metrics = {k: v for k, v in model_metrics.items() if v is not None}

    records = result_df.where(result_df.notna(), None).to_dict(orient="records")
    return {
        "model_id":      model_id,
        "model_name":    m.model_name,
        "target_column": m.target_column,
        "pred_column":   pred_col,
        "conf_column":   conf_col,
        "row_count":     len(df),
        "missing_cols":  missing_cols,
        "columns":       list(result_df.columns),
        "data":          records,
        "metrics":       eval_metrics,
        "model_metrics": model_metrics,
    }


@router.post("/predict-cached-file")
async def predict_cached_file(
    session_id: str = Form(...),
    model_type: str = Form(...),
    feature_columns: str = Form(...),   # JSON-encoded list
    target_column: str = Form(...),
    file: UploadFile = File(...),
):
    """Bulk-predict every row in an uploaded file using a just-trained (cached) model."""
    cache_key = f"{session_id}::{model_type}"
    cached = MODEL_REGISTRY.get(cache_key)
    if not cached:
        raise HTTPException(400, "Model not found in cache. Please retrain before predicting.")

    model = _deserialise(cached["binary"])
    le_y_cached: Optional[Any] = cached.get("label_encoder_y")
    cached_fp: Dict[str, str] = cached.get("feature_preprocessing", {})

    try:
        feature_cols = json.loads(feature_columns)
    except Exception:
        raise HTTPException(400, "feature_columns must be a JSON-encoded list.")

    content = await file.read()
    try:
        df = _read_uploaded_file(content, file.filename)
    except Exception as exc:
        raise HTTPException(400, f"Could not read file: {exc}")

    try:
        result_df, pred_col, conf_col, missing_cols = _bulk_predict(
            model, feature_cols, df, target_column, le_y=le_y_cached, feature_prep=cached_fp
        )
    except Exception as exc:
        raise HTTPException(500, f"Prediction failed: {exc}")

    # Compute evaluation metrics if the file contains the actual target column
    eval_metrics = None
    if target_column and target_column in df.columns:
        y_true = df[target_column].tolist()
        y_pred_vals = result_df[pred_col].tolist()
        eval_metrics = _eval_metrics(y_true, y_pred_vals, model)

    records = result_df.where(result_df.notna(), None).to_dict(orient="records")
    return {
        "model_type":    model_type,
        "target_column": target_column,
        "pred_column":   pred_col,
        "conf_column":   conf_col,
        "row_count":     len(df),
        "missing_cols":  missing_cols,
        "columns":       list(result_df.columns),
        "data":          records,
        "metrics":       eval_metrics,
    }
