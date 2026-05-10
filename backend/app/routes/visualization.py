# routers/visualization.py
# Routes: save chart, list charts, get image, delete chart, ai-insights

from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import json
import logging
import re
import pandas as pd

from app.db.connection import get_db
from app.config.config import VisualizationRequest
from app.routes.profiler_cache import get_profiler
from app.db import crud

router = APIRouter(prefix="/api", tags=["Visualization"])
logger = logging.getLogger("uvicorn.error")

# ---------------------------------------------------------------------------
# Visualization list cache (keyed by file_id)
# ---------------------------------------------------------------------------

_viz_store: OrderedDict = OrderedDict()
_viz_lock = Lock()
_VIZ_MAX = 50


def _viz_get(file_id: int):
    with _viz_lock:
        if file_id not in _viz_store:
            return None
        _viz_store.move_to_end(file_id)
        return _viz_store[file_id]


def _viz_put(file_id: int, value) -> None:
    with _viz_lock:
        if file_id in _viz_store:
            _viz_store.move_to_end(file_id)
        _viz_store[file_id] = value
        if len(_viz_store) > _VIZ_MAX:
            _viz_store.popitem(last=False)


def _viz_invalidate(file_id: int) -> None:
    with _viz_lock:
        _viz_store.pop(file_id, None)


# ---------------------------------------------------------------------------
# AI insights helpers
# ---------------------------------------------------------------------------

def _parse_insights(text: str) -> list:
    """Extract JSON array of insights from AI response."""
    cleaned = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict) and "insights" in parsed:
            return parsed["insights"]
    except Exception:
        pass
    match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return []


def _fallback_insights(columns_meta: list) -> list:
    """Rule-based insights when AI is unavailable."""
    insights = []
    for col in columns_meta:
        name = col.get("column_name", "")
        null_pct = col.get("null_percent", 0)
        issues = col.get("issues", [])
        dtype = col.get("data_type", "")

        if null_pct >= 20:
            insights.append({
                "column_name": name,
                "insight": f"{name} has {null_pct:.1f}% missing values — high incompleteness.",
                "recommendation": "Impute with median (numeric) or mode (categorical) before visualizing.",
                "confidence": 0.9,
            })
        elif "outliers" in issues:
            insights.append({
                "column_name": name,
                "insight": f"{name} contains statistical outliers that may skew charts.",
                "recommendation": "Cap outliers with IQR before using this column in histograms.",
                "confidence": 0.85,
            })
        elif "type_inconsistencies" in issues:
            insights.append({
                "column_name": name,
                "insight": f"{name} has mixed value types affecting sort and scale.",
                "recommendation": "Standardize the column type before charting.",
                "confidence": 0.8,
            })
        elif dtype in ("integer", "decimal", "float"):
            insights.append({
                "column_name": name,
                "insight": f"{name} is numeric — suitable for histograms, boxplots, and scatter plots.",
                "recommendation": "Use a histogram to understand distribution and a boxplot to check spread.",
                "confidence": 0.95,
            })
        else:
            insights.append({
                "column_name": name,
                "insight": f"{name} is categorical — suitable for bar and pie charts.",
                "recommendation": "Use a bar chart showing the top 10 most frequent values.",
                "confidence": 0.95,
            })
    return insights


# ---------------------------------------------------------------------------
# Server-side chart data aggregation
# ---------------------------------------------------------------------------

def _find_col(df: pd.DataFrame, name: str) -> Optional[str]:
    """Resolve a column name to its actual DataFrame column (case-insensitive + fuzzy)."""
    if name is None or name not in [None, ""] and name not in df.columns:
        if name is None:
            return None
        if name in df.columns:
            return name
        nl = name.lower()
        for col in df.columns:
            if col.lower() == nl:
                return col
        for col in df.columns:
            cl = col.lower()
            if nl.startswith(cl) or cl.startswith(nl) or nl in cl or cl in nl:
                return col
        return None
    return name if name in df.columns else None


class ChartDataRequest(BaseModel):
    session_id: str
    chart_type: str
    x_axis: Optional[str] = None
    y_axis: Optional[str] = None
    aggregation: Optional[str] = "sum"
    filter_column: Optional[str] = None
    filter_value: Optional[str] = None


@router.post("/visualization/chart-data")
async def get_chart_data(body: ChartDataRequest, db: Session = Depends(get_db)):
    """Aggregate chart data server-side from the full dataset."""
    try:
        profiler = get_profiler(body.session_id, db)
        df = profiler.df.copy()
    except Exception:
        raise HTTPException(404, "Session not found or profiler unavailable")

    total_rows = len(df)

    # Apply cross-filter
    if body.filter_column and body.filter_value is not None:
        fc = _find_col(df, body.filter_column)
        if fc:
            df = df[df[fc].astype(str) == str(body.filter_value)]

    x_col  = _find_col(df, body.x_axis)
    y_col  = _find_col(df, body.y_axis)
    ctype  = body.chart_type
    agg    = body.aggregation or "sum"

    # ── Scatter: sample up to 2000 representative points ──────────────────
    if ctype == "scatter":
        if not x_col or not y_col:
            return {"data": [], "total_rows": total_rows, "sampled": False}
        sample = df.sample(min(2_000, len(df)), random_state=42) if len(df) > 2_000 else df
        data = []
        for _, row in sample[[x_col, y_col]].iterrows():
            try:
                xv = float(row[x_col])
                yv = float(row[y_col])
                if pd.notna(xv) and pd.notna(yv):
                    data.append({"x": round(xv, 4), "y": round(yv, 4)})
            except (ValueError, TypeError):
                pass
        return {"data": data, "total_rows": total_rows, "sampled": len(df) > 2_000}

    # ── Histogram / box: bin numeric column ───────────────────────────────
    if ctype in ("histogram", "box") or (not y_col and ctype != "pie"):
        dist_col = (y_col or x_col) if ctype == "box" else x_col
        if not dist_col:
            return {"data": [], "total_rows": total_rows, "sampled": False}
        series = pd.to_numeric(df[dist_col], errors="coerce").dropna()
        if series.empty:
            return {"data": [], "total_rows": total_rows, "sampled": False}
        bins = 10
        mn, mx = float(series.min()), float(series.max())
        size = (mx - mn) / bins if mx != mn else 1.0
        counts = [0] * bins
        for v in series:
            idx = min(bins - 1, max(0, int((v - mn) / size)))
            counts[idx] += 1
        data = [{"name": f"{mn + size * i:.2f}", "value": counts[i]} for i in range(bins)]
        return {"data": data, "total_rows": total_rows, "sampled": False}

    # ── Group-aggregate: bar, line, area, pie ─────────────────────────────
    if not x_col:
        return {"data": [], "total_rows": total_rows, "sampled": False}

    df = df.copy()
    df["_x"] = df[x_col].fillna("null").astype(str)

    if y_col and agg != "count":
        df["_y"] = pd.to_numeric(df[y_col], errors="coerce").fillna(0)
        agg_fn = {"avg": "mean", "min": "min", "max": "max"}.get(agg, "sum")
        grouped = df.groupby("_x", sort=False)["_y"].agg(agg_fn)
    else:
        grouped = df.groupby("_x", sort=False)["_x"].count()

    entries = [{"name": str(k), "value": round(float(v), 4)} for k, v in grouped.items()]

    if ctype in ("bar", "pie"):
        entries.sort(key=lambda e: e["value"], reverse=True)

    return {"data": entries[:20], "total_rows": total_rows, "sampled": False}


# ---------------------------------------------------------------------------
# AI insights endpoint
# ---------------------------------------------------------------------------

@router.post("/visualization/ai-insights/{session_id}")
async def generate_ai_insights(session_id: str, db: Session = Depends(get_db)):
    """
    Generate per-column AI insights from profile metadata only (no raw data).
    Low-risk columns use rule-based fallback; AI adds nuance for columns with issues.
    """
    from app.routes.ai import _ai_generate, _build_column_meta

    try:
        profiler = get_profiler(session_id, db)
        profile = profiler.profile(preview_rows=0)
    except Exception:
        raise HTTPException(404, "Session not found or profiler unavailable")

    columns_meta = _build_column_meta(profile)
    if not columns_meta:
        return JSONResponse({"success": True, "insights": []})

    meta_json = json.dumps(columns_meta, indent=2)
    prompt = (
        "You are a Data Visualization and Insights Assistant.\n"
        "Analyze the column metadata below and return one insight per column.\n"
        "Each object must have: column_name, insight (1 concise sentence), "
        "recommendation (1 actionable sentence), confidence (0-1 float).\n"
        "Focus on: missing values, outliers, distribution shape, and best chart type.\n"
        "Base analysis ONLY on the metadata provided — never reference raw data.\n"
        "Return ONLY a valid JSON array. No markdown, no extra text.\n\n"
        f"Column metadata:\n{meta_json}"
    )

    try:
        text_out, _ = _ai_generate(prompt)
        if text_out:
            insights = _parse_insights(text_out)
            if insights:
                return JSONResponse({"success": True, "insights": insights})
    except Exception:
        logger.exception("viz ai-insights AI call failed for session=%s", session_id)

    return JSONResponse({"success": True, "insights": _fallback_insights(columns_meta)})


@router.post("/visualization/{session_id}")
async def save_visualization(
    session_id: str,
    request: VisualizationRequest,
    db: Session = Depends(get_db),
):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    image_binary = None
    image_format = None

    chart_type = (request.chart_type or "").lower()
    chart_type_map = {
        "bar": "Bar",
        "line": "Line",
        "pie": "Pie",
        "scatter": "Scatter",
        "histogram": "Histogram",
        "heatmap": "Heatmap",
        "box_plot": "Box_Plot",
        "boxplot": "Box_Plot",
        "box-plot": "Box_Plot",
    }
    normalized_type = chart_type_map.get(chart_type, request.chart_type)

    viz = crud.save_visualization(
        db           = db,
        file_id      = file_record.id,
        chart_type   = normalized_type,
        chart_config = request.chart_config or {},
        chart_title  = request.chart_title,
        x_column     = request.x_column,
        y_column     = request.y_column,
        group_by     = request.group_by,
        image_binary = image_binary,
        image_format = image_format,
    )

    _viz_invalidate(file_record.id)

    return JSONResponse({
        "success":    True,
        "viz_id":     viz.id,
        "has_image":  image_binary is not None,
        "chart_type": viz.chart_type.value,
    })


@router.get("/visualizations/{session_id}")
async def get_visualizations(session_id: str, db: Session = Depends(get_db)):
    file_record = crud.get_file_by_session(db, session_id)
    if not file_record:
        raise HTTPException(404, "Session not found")

    cached = _viz_get(file_record.id)
    if cached is not None:
        return JSONResponse({"success": True, "visualizations": cached})

    vizs = crud.get_visualizations(db, file_record.id)
    result = [
        {
            "id":           v.id,
            "chart_type":   v.chart_type.value,
            "chart_title":  v.chart_title,
            "x_column":     v.x_column,
            "y_column":     v.y_column,
            "group_by":     v.group_by,
            "chart_config": v.chart_config,
            "has_image":    v.image_binary is not None,
            "created_at":   v.created_at.isoformat(),
        }
        for v in vizs
    ]
    _viz_put(file_record.id, result)
    return JSONResponse({"success": True, "visualizations": result})


@router.get("/visualization/{viz_id}/image")
async def get_visualization_image(viz_id: int, db: Session = Depends(get_db)):
    viz = crud.get_visualization_by_id(db, viz_id)
    if not viz or not viz.image_binary:
        raise HTTPException(404, "Image not found")
    media_type = "image/svg+xml" if viz.image_format == "svg" else "image/png"
    return Response(content=viz.image_binary, media_type=media_type)


@router.delete("/visualization/{viz_id}")
async def delete_visualization(viz_id: int, db: Session = Depends(get_db)):
    viz = crud.get_visualization_by_id(db, viz_id)
    if viz:
        try:
            _viz_invalidate(viz.file_id)
        except Exception:
            pass
    if not crud.delete_visualization(db, viz_id):
        raise HTTPException(404, "Not found")
    return JSONResponse({"success": True})
