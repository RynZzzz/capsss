from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Any
import os
import json
import logging
import re
import base64
from app.config import settings
from google import genai
from google.genai import types as genai_types
import sys
import requests
from sqlalchemy.orm import Session
from app.db.connection import get_db
from app.db import crud
from app.routes.profiler_cache import get_profiler
from app.db.models import SessionRecord

router = APIRouter(prefix="/api/ai", tags=["AI"])
logger = logging.getLogger("uvicorn.error")


# ---------------------------------------------------------------------------
# Gemini (direct) helpers
# ---------------------------------------------------------------------------

def _get_client(api_key: str):
    return genai.Client(api_key=api_key)


def _generate_content(client, text: str):
    last_error = None
    for model_name in ("gemini-2.5-flash", "gemini-2.0-flash", "models/gemini-2.0-flash"):
        try:
            return client.models.generate_content(
                model=model_name,
                contents=text,
            )
        except Exception as exc:
            last_error = exc
    raise last_error


# ---------------------------------------------------------------------------
# Ollama (local) helper — phi4-mini fallback
# ---------------------------------------------------------------------------

_OLLAMA_BASE = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "phi4-mini")


def _ollama_generate(text: str):
    url = f"{_OLLAMA_BASE}/v1/chat/completions"
    payload = {
        "model": _OLLAMA_MODEL,
        "messages": [{"role": "user", "content": text}],
        "stream": False,
    }
    try:
        response = requests.post(url, json=payload, timeout=120)
    except requests.exceptions.ConnectionError:
        logger.warning("Ollama not reachable at %s", _OLLAMA_BASE)
        return None, None
    if not response.ok:
        logger.warning("Ollama error %s: %s", response.status_code, response.text[:200])
        return None, None
    data = response.json()
    content = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    logger.warning("Ollama used model: %s", _OLLAMA_MODEL)
    return content or "", data.get("usage") or {}


# ---------------------------------------------------------------------------
# Shared AI generate — tries Gemini → Ollama (local phi4-mini)
# ---------------------------------------------------------------------------

def _ai_generate(text: str):
    """Try Gemini first, then local Ollama (phi4-mini) as fallback."""
    api_key = settings.GEMINI_API_KEY or os.getenv("gemini_api_key")
    if api_key:
        try:
            client = _get_client(api_key)
            response = _generate_content(client, text)
            usage = getattr(response, "usage_metadata", None) or {}
            text_out = getattr(response, "text", "") or ""
            return text_out, usage
        except Exception as exc:
            logger.warning("Gemini failed (%s), falling back to Ollama phi4-mini", exc)

    text_out, usage = _ollama_generate(text)
    if text_out is not None:
        return text_out, usage

    return None, None


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ExplainRequest(BaseModel):
    prompt: str
    context: dict | None = None


class RecommendRequest(BaseModel):
    profile: dict
    extra_context: dict | None = None


# ---------------------------------------------------------------------------
# Local fallback helpers (no AI needed)
# ---------------------------------------------------------------------------

def _fallback_recommendations(profile: dict) -> str:
    issues = profile.get("issues_summary") or {}
    columns = profile.get("columns") or []
    missing = int(issues.get("missing") or 0)
    outliers = int(issues.get("outliers") or 0)
    type_inconsistencies = int(issues.get("type_inconsistencies") or 0)

    def _top_columns(key: str, limit: int = 20) -> str:
        hits = [c.get("name") for c in columns if (c.get(key) or 0) > 0]
        hits = [h for h in hits if h]
        if not hits:
            return ""
        head = hits[:limit]
        suffix = " ..." if len(hits) > limit else ""
        return ", ".join(head) + suffix

    recs = []
    if missing > 0:
        cols = _top_columns("missing_count")
        detail = f" Focus on: {cols}." if cols else ""
        recs.append(f"• Missing values: {missing} total. Recommended fix: impute or remove affected rows.{detail}")
    else:
        recs.append("• Missing values: 0. No action required.")

    if type_inconsistencies > 0:
        cols = _top_columns("type_inconsistency_count")
        detail = f" Focus on: {cols}." if cols else ""
        recs.append(f"• Type inconsistencies: {type_inconsistencies} total. Recommended fix: standardize column types.{detail}")
    else:
        recs.append("• Type inconsistencies: 0. No action required.")

    if outliers > 0:
        cols = _top_columns("outlier_count")
        detail = f" Focus on: {cols}." if cols else ""
        recs.append(f"• Outliers: {outliers} total. Recommended fix: review and cap or remove outliers.{detail}")
    else:
        recs.append("• Outliers: 0. No action required.")

    recs.append("• Duplicates: check for duplicate rows and keep first occurrence.")
    recs.append("• Normalization: consider normalizing numeric columns for consistency.")
    recs.append("• Column notes: validate schema and sample rows manually.")

    return "\n".join(recs)


def _fallback_config(profile: dict) -> dict:
    columns = profile.get("columns") or []
    missing_rules = []
    numeric_missing = []
    text_missing = []
    high_missing = []
    outlier_columns = []
    outlier_ratio_max = 0
    type_columns = []

    for col in columns:
        name = col.get("name")
        if not name:
            continue
        total = col.get("total_count") or 0
        missing = col.get("missing_count") or 0
        outliers = col.get("outlier_count") or 0
        type_inconsistencies = col.get("type_inconsistency_count") or 0
        col_type = (col.get("type") or col.get("data_type") or "").lower()

        if total and missing:
            ratio = missing / total
            if ratio >= 0.5:
                high_missing.append(name)
            elif col_type in ("integer", "decimal"):
                numeric_missing.append(name)
            else:
                text_missing.append(name)

        if outliers and col_type in ("integer", "decimal"):
            outlier_columns.append(name)
            if total:
                outlier_ratio_max = max(outlier_ratio_max, outliers / total)

        if type_inconsistencies:
            type_columns.append(name)

    def add_rule(method, cols):
        if cols:
            missing_rules.append({"method": method, "columns": cols})

    add_rule("omit", high_missing)
    add_rule("mean", numeric_missing)
    add_rule("mode", text_missing)
    if not missing_rules:
        missing_rules.append({"method": "mean", "columns": []})

    outlier_action = "ignore"
    if outlier_columns:
        outlier_action = "remove" if outlier_ratio_max >= 0.1 else "cap"

    return {
        "missing_rules": missing_rules,
        "duplicates": {"method": "keep_first", "columns": []},
        "outlier": {
            "method": "iqr",
            "action": outlier_action,
            "columns": outlier_columns,
            "param": 1.5,
        },
        "type_inconsistencies": {
            "method": "mode",
            "columns": type_columns,
            "numeric_cleanup": True,
            "text_cleanup": True,
            "text_regex": "[^A-Za-z0-9\\s]",
            "text_replacement": "",
        },
    }


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------

def _extract_json(text: str) -> dict | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            chunk = part.strip()
            if chunk.startswith("json"):
                chunk = chunk[4:].strip()
            if chunk.startswith("{") and chunk.endswith("}"):
                try:
                    return json.loads(chunk)
                except Exception:
                    continue
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start: end + 1])
        except Exception:
            return None
    return None


def _normalize_config(raw: dict | None, fallback: dict) -> dict:
    if not isinstance(raw, dict):
        return fallback
    config = raw.get("config") if isinstance(raw.get("config"), dict) else raw
    if not isinstance(config, dict):
        return fallback
    missing_rules = config.get("missing_rules")
    if not isinstance(missing_rules, list):
        missing_rules = fallback.get("missing_rules") or []
    duplicates = config.get("duplicates") if isinstance(config.get("duplicates"), dict) else fallback.get("duplicates")
    outlier = config.get("outlier") if isinstance(config.get("outlier"), dict) else fallback.get("outlier")
    type_inconsistencies = (
        config.get("type_inconsistencies")
        if isinstance(config.get("type_inconsistencies"), dict)
        else fallback.get("type_inconsistencies")
    )
    return {
        "missing_rules": missing_rules,
        "duplicates": duplicates,
        "outlier": outlier,
        "type_inconsistencies": type_inconsistencies,
    }


def _extract_summary(parsed: dict | None, text_out: str) -> str:
    """Extract a clean plain-text summary string from the parsed AI response."""
    if isinstance(parsed, dict):
        raw = parsed.get("summary") or ""
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
        if isinstance(raw, dict):
            reasons = raw.get("reasons") or []
            return "\n".join(f"• {r}" for r in reasons)
        if isinstance(raw, list):
            return "\n".join(f"• {item}" for item in raw)
    return ""


def _trim_row_dicts(rows: list, max_rows: int = 20, max_columns: int = 30) -> list:
    if not isinstance(rows, list):
        return rows
    out = []
    for row in rows[:max_rows]:
        if not isinstance(row, dict):
            out.append(row)
            continue
        out.append(dict(list(row.items())[:max_columns]))
    return out


def _strip_row_data(context: dict) -> dict:
    """Remove actual data rows from context — keep only column-level metadata and chart structure."""
    stripped = dict(context)
    stripped.pop("dataset_sample_rows", None)
    stripped.pop("selected_sample_rows", None)
    charts = stripped.get("charts")
    if isinstance(charts, list):
        clean_charts = []
        for chart in charts:
            if isinstance(chart, dict):
                c = {k: v for k, v in chart.items() if k != "data"}
                if isinstance(c.get("pies"), list):
                    c["pies"] = [{k: v for k, v in p.items() if k != "data"} for p in c["pies"] if isinstance(p, dict)]
                clean_charts.append(c)
        stripped["charts"] = clean_charts
    generated = stripped.get("generated_charts")
    if isinstance(generated, list):
        clean_gen = []
        for chart in generated:
            if isinstance(chart, dict):
                c = {k: v for k, v in chart.items() if k != "data"}
                if isinstance(c.get("pies"), list):
                    c["pies"] = [{k: v for k, v in p.items() if k != "data"} for p in c["pies"] if isinstance(p, dict)]
                clean_gen.append(c)
        stripped["generated_charts"] = clean_gen
    return stripped


def _build_visual_prompt(user_prompt: str, context: dict) -> str:
    metadata_context = _strip_row_data(context)
    context_text = json.dumps(metadata_context, ensure_ascii=False)
    return (
        "You are a data visualization analyst. "
        "You explain charts and data patterns using ONLY column-level metadata — you never reference or read off individual data rows. "
        "Focus on: data shape (distribution, skew, range, cardinality), what the chart type reveals about the column structure, "
        "and what patterns or insights a viewer should look for. "
        "When answering about a chart: describe what the axes represent, what the overall shape of the data tells us (skewed, uniform, clustered), "
        "what comparisons or relationships are visible, and what follow-up questions the chart raises. "
        "When answering about a column: use its data_type, unique count, missing %, min/max/mean/std, and top value to explain the distribution. "
        "If the question is about chart recommendations, use visualization_columns_by_type and visualization_rules. "
        "If the question is about a specific chart, use generated_charts or charts fields. "
        "Always name exact columns in your reasoning. "
        "If information is not in the context, say so explicitly — do not invent values.\n\n"
        f"User question:\n{user_prompt}\n\n"
        f"Metadata context (no raw rows):\n{context_text}"
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def _shrink_visual_context(context: dict) -> dict:
    if not isinstance(context, dict):
        return {}
    trimmed = dict(context)
    charts = trimmed.get("charts")
    if isinstance(charts, list):
        trimmed_charts = []
        for chart in charts[:8]:
            if not isinstance(chart, dict):
                trimmed_charts.append(chart)
                continue
            c = dict(chart)
            if isinstance(c.get("data"), list):
                c["data"] = c["data"][:6]
            if isinstance(c.get("pies"), list):
                pies = []
                for pie in c["pies"][:4]:
                    if not isinstance(pie, dict):
                        pies.append(pie)
                        continue
                    pie_copy = dict(pie)
                    if isinstance(pie_copy.get("data"), list):
                        pie_copy["data"] = pie_copy["data"][:6]
                    pies.append(pie_copy)
                c["pies"] = pies
            trimmed_charts.append(c)
        trimmed["charts"] = trimmed_charts
    if isinstance(trimmed.get("cleaning_steps"), list):
        trimmed["cleaning_steps"] = trimmed["cleaning_steps"][:8]
    if isinstance(trimmed.get("dataset_columns"), list):
        trimmed["dataset_columns"] = trimmed["dataset_columns"][:200]
    if isinstance(trimmed.get("dataset_column_stats"), list):
        trimmed["dataset_column_stats"] = trimmed["dataset_column_stats"][:120]
    if isinstance(trimmed.get("selected_column_stats"), list):
        trimmed["selected_column_stats"] = trimmed["selected_column_stats"][:80]
    if isinstance(trimmed.get("dataset_sample_rows"), list):
        trimmed["dataset_sample_rows"] = _trim_row_dicts(trimmed["dataset_sample_rows"], max_rows=20, max_columns=30)
    if isinstance(trimmed.get("selected_sample_rows"), list):
        trimmed["selected_sample_rows"] = _trim_row_dicts(trimmed["selected_sample_rows"], max_rows=20, max_columns=30)
    if isinstance(trimmed.get("visualization_columns_by_type"), list):
        trimmed["visualization_columns_by_type"] = trimmed["visualization_columns_by_type"][:20]
    if isinstance(trimmed.get("visualization_rules"), list):
        trimmed["visualization_rules"] = trimmed["visualization_rules"][:20]
    if isinstance(trimmed.get("generated_charts"), list):
        charts = []
        for chart in trimmed["generated_charts"][:12]:
            if not isinstance(chart, dict):
                charts.append(chart)
                continue
            c = dict(chart)
            if isinstance(c.get("data"), list):
                c["data"] = c["data"][:40]
            if isinstance(c.get("pies"), list):
                pies = []
                for pie in c["pies"][:8]:
                    if not isinstance(pie, dict):
                        pies.append(pie)
                        continue
                    pie_copy = dict(pie)
                    if isinstance(pie_copy.get("data"), list):
                        pie_copy["data"] = pie_copy["data"][:10]
                    pies.append(pie_copy)
                c["pies"] = pies
            charts.append(c)
        trimmed["generated_charts"] = charts
    if isinstance(trimmed.get("preprocessing"), dict):
        preprocessing = dict(trimmed["preprocessing"])
        if isinstance(preprocessing.get("column_missing_overrides"), dict):
            preprocessing["column_missing_overrides"] = dict(
                list(preprocessing["column_missing_overrides"].items())[:20]
            )
        if isinstance(preprocessing.get("column_outlier_overrides"), dict):
            preprocessing["column_outlier_overrides"] = dict(
                list(preprocessing["column_outlier_overrides"].items())[:20]
            )
        trimmed["preprocessing"] = preprocessing
    return trimmed

@router.post("/visualize")
async def explain_visualization(request: ExplainRequest):
    context = _shrink_visual_context(request.context or {})
    text = _build_visual_prompt(request.prompt, context)
    try:
        text_out, usage = _ai_generate(text)
        if usage:
            logger.warning("AI visualize usage: %s", usage)
        if text_out:
            logger.warning("AI visualize response preview: %s", text_out[:500])
        return {
            "success": True,
            "text": text_out or "AI explain did not return any content.",
        }
    except Exception:
        logger.exception("AI visualize failed")
        return {"success": True, "text": "AI explain is temporarily unavailable. Please try again later."}


@router.post("/recommend-cleaning")
async def recommend_cleaning(request: RecommendRequest):
    fallback_config = _fallback_config(request.profile)
    context = {
        "profile": request.profile,
        "extra_context": request.extra_context or {},
        "available_methods": {
            "missing_value_imputation": ["mean", "median", "mode", "forward_fill", "backward_fill", "constant", "knn"],
            "outlier_detection": ["iqr", "zscore", "isolation_forest"],
            "outlier_actions": ["remove", "cap", "winsorize", "ignore"],
            "type_inconsistency": ["mean", "median", "mode"],
            "type_cleanup": ["numeric_cleanup", "text_cleanup"],
            "normalization": ["normalize_minmax", "normalize_zscore"],
        },
    }
    context_text = json.dumps(context, ensure_ascii=False)
    prompt = (
        "Analyze the dataset profile and suggest cleaning steps using ONLY the available methods. "
        "Return ONLY a valid JSON object with exactly two keys: summary and config. "
        "summary must be a single plain-text string containing exactly 6 bullet lines using the • symbol, "
        "in this exact order:\n"
        "• Missing values: <count>. Recommended fix: <fix>.\n"
        "• Outliers: <count>. Recommended fix: <fix>.\n"
        "• Type inconsistencies: <count>. Recommended fix: <fix>.\n"
        "• Duplicates: <count or status>. Recommended fix: <fix>.\n"
        "• Normalization: <recommendation>.\n"
        "• Column notes: <any specific column observations or 'None'>.\n"
        "Do NOT use JSON, braces, nested objects, or markdown inside the summary value — plain text only. "
        "config must include: "
        "missing_rules (array of {method, columns}), "
        "outlier {method, action, columns, param}, "
        "duplicates {method, columns}, "
        "type_inconsistencies {method, columns, numeric_cleanup, text_cleanup, text_regex, text_replacement}. "
        "numeric_cleanup and text_cleanup must be booleans. "
        "Use only the provided available methods. "
        "If data is skewed prefer median + IQR; if normal use zscore; use KNN only for dense numeric columns. "
        "Return ONLY the JSON object. No text, notes, or explanations outside the JSON."
    )
    text = f"{prompt}\n\nContext:\n{context_text}"
    try:
        text_out, usage = _ai_generate(text)

        if usage:
            logger.warning("AI recommend usage: %s", usage)
        if text_out:
            logger.warning("AI recommend response preview: %s", text_out[:1000])

        if not text_out:
            return {
                "success": True,
                "text": _fallback_recommendations(request.profile),
                "config": fallback_config,
            }

        parsed = _extract_json(text_out)
        config = _normalize_config(parsed, fallback_config)
        summary = _extract_summary(parsed, text_out)

        if not summary:
            summary = _fallback_recommendations(request.profile)

        return {"success": True, "text": summary, "config": config}

    except Exception:
        logger.exception("AI recommend failed")
        return {
            "success": True,
            "text": _fallback_recommendations(request.profile),
            "config": fallback_config,
        }


# ---------------------------------------------------------------------------
# Preprocessing suggestions  (DSL-based, Gemini-powered)
# ---------------------------------------------------------------------------

_SUGGEST_SYSTEM_PROMPT = """You are a data preprocessing recommendation engine.

You receive two inputs:
  1. column_metadata — per-column statistics describing the current state of the data
  2. applied_steps — operations already applied to this dataset in the current session

Your job is to recommend ONLY operations that are still needed and have NOT already been addressed by applied_steps.
If a column already has a fill_nulls step applied, do NOT suggest another null-handling operation for it.
If a column already has cap_outliers or remove_outliers applied, do NOT suggest outlier handling again.
Use applied_steps to understand the user's preferred methods (e.g. if they used median for imputation before, prefer median for new columns too).

Each operation must include a rich, 3–4 sentence reason covering:
  1. What was detected in the metadata (specific issue with magnitude — use actual numbers from null_percent, outlier_percent, total_count, mean, median, std)
  2. Why it matters if left unfixed
  3. Why this method was chosen over alternatives (reference skew_hint, outlier_percent severity, data type)
  4. What the column will look like after the operation

OUTLIER METHOD SELECTION RULES (use outlier_percent to decide action):
- outlier_percent < 2%   → note only, low priority, cap_outliers
- outlier_percent 2–10%  → cap_outliers (preserve data, reduce distortion)
- outlier_percent > 10%  → remove_outliers (too many to cap without losing signal)
- skew_hint = "roughly_symmetric" → IQR and zscore equally valid, prefer IQR
- skew_hint = "right_skewed" or "left_skewed" → prefer IQR (zscore assumes normal distribution)

NULL IMPUTATION RULES:
- skew_hint = "right_skewed" or "left_skewed" → use median (robust to tail)
- skew_hint = "roughly_symmetric" → mean or median both valid, prefer mean
- data_type = text/string → use mode
- NEVER suggest drop_nulls — always fill_nulls

TYPE INCONSISTENCY RULES (use type_inconsistency_percent + data_type + skew_hint to decide):
Inconsistent values in a column are treated as dirty entries. The fix is always a two-step sequence:
  Step 1 — coerce the column to its primary type (convert_type), which turns inconsistent values into nulls
  Step 2 — impute those new nulls (fill_nulls), using the appropriate method for the primary type

- data_type = integer or decimal (numeric column with string/text values mixed in):
    → Step 1: convert_type to "int" or "float"
    → Step 2: fill_nulls with median (if skew_hint is right_skewed or left_skewed) or mean (if roughly_symmetric)
    Reason: string values in a numeric column are dirty entries; convert_type nullifies them, then fill_nulls restores a valid numeric value

- data_type = text, alphanumeric, or string (string column with numeric values mixed in):
    → Step 1: convert_type to "string"
    → Step 2: fill_nulls with mode
    Reason: numeric values in a text column break string operations; convert_type standardizes, mode imputes any resulting nulls with the dominant category

- data_type = datetime (date column with inconsistent formats):
    → normalize_date with target_format "YYYY-MM-DD" (single step is sufficient)
    Reason: format inconsistencies are not type errors, just encoding differences; normalize_date resolves them without creating nulls

- issues contains "mixed_types" (data_type = mixed, meaning no single type covers ≥90% of values):
    → convert_type to the most likely target type based on column name and context (e.g. "age" → int, "price" → float, "name" → string)
    → then fill_nulls with mode (text target) or median/mean (numeric target)
    Reason: no dominant type means the column has severe mixed-type data — it must be coerced to one consistent type before any analysis

- type_inconsistency_percent < 5%  → low risk, confidence 0.85
- type_inconsistency_percent 5–20% → medium risk, confidence 0.75
- type_inconsistency_percent > 20% → high risk, confidence 0.6, flag in reason that significant data loss may occur

ALLOWED OPERATIONS:
- trim_whitespace(column)
- lowercase(column)
- uppercase(column)
- normalize_case(column)
- fill_nulls(column, method: "mean"|"median"|"mode"|"constant")
- convert_type(column, target_type: "int"|"float"|"string"|"date")
- normalize_date(column, target_format: "YYYY-MM-DD")
- validate_regex(column, pattern_type: "email"|"phone"|"id")
- remove_invalid(column, pattern_type)
- deduplicate(column)
- cap_outliers(column, method: "IQR")
- remove_outliers(column, method: "IQR")

Output ONLY valid JSON. No markdown, no explanation outside JSON.

OUTPUT FORMAT:
{
  "columns": [
    {
      "column_name": "...",
      "operations": [
        {
          "type": "fill_nulls",
          "column": "...",
          "method": "median",
          "confidence": 0.9,
          "risk_level": "low",
          "reason": "18% of the 4,200 rows in Age are missing (756 values), likely from optional form fields. Leaving these nulls will silently exclude 756 rows from any model training and skew group-level aggregations. Median (32.0) is chosen over mean (38.4) because the column is right-skewed — the mean is inflated by high-age outliers detected in the data, making it a poor representative center. After imputation, Age will be fully populated with values near the true distribution center, minimally affecting variance."
        }
      ]
    }
  ]
}"""


def _build_column_meta(profile: dict) -> list:
    """Convert a profiler profile dict into DSL-friendly column metadata."""
    result = []
    for col in profile.get("columns", []):
        total = max(col.get("total_count") or 1, 1)
        col_type = (col.get("data_type") or col.get("type") or "string").lower()
        issues = []
        if (col.get("missing_count") or 0) > 0:
            issues.append("missing_values")
        if (col.get("outlier_count") or 0) > 0:
            issues.append("outliers")
        if (col.get("type_inconsistency_count") or 0) > 0:
            issues.append("type_inconsistencies")
        # MIXED means no single type dominates ≥90% — the whole column is a type problem
        if col_type == "mixed":
            issues.append("mixed_types")
        name_lower = col.get("name", "").lower()
        if any(k in name_lower for k in ("email", "mail")):
            issues.append("email_format")
        elif any(k in name_lower for k in ("phone", "mobile", "tel")):
            issues.append("phone_format")
        elif any(k in name_lower for k in ("date", "_at", "_on", "time")):
            issues.append("date_format")

        outlier_pct       = round((col.get("outlier_count") or 0) / total * 100, 1)
        inconsistency_pct = round((col.get("type_inconsistency_count") or 0) / total * 100, 1)

        entry = {
            "column_name":              col.get("name"),
            "data_type":                col_type,
            "total_count":              total,
            "null_percent":             round((col.get("missing_count") or 0) / total * 100, 1),
            "unique_ratio":             round((col.get("unique_count") or 0) / total, 3),
            "outlier_percent":          outlier_pct,
            "type_inconsistency_percent": inconsistency_pct,
            "issues":                   issues,
        }

        if col_type in ("integer", "decimal", "float", "int", "int64", "float64"):
            mean   = col.get("mean")
            median = col.get("median")
            skew_hint = None
            if mean is not None and median is not None and median != 0:
                ratio = mean / median
                if ratio > 1.1:
                    skew_hint = "right_skewed"
                elif ratio < 0.9:
                    skew_hint = "left_skewed"
                else:
                    skew_hint = "roughly_symmetric"
            entry.update({
                "min":       col.get("min"),
                "max":       col.get("max"),
                "mean":      round(mean, 4) if mean is not None else None,
                "median":    round(median, 4) if median is not None else None,
                "std":       round(col.get("std"), 4) if col.get("std") is not None else None,
                "skew_hint": skew_hint,
            })
        elif col_type in ("text", "string", "object", "alphanumeric"):
            entry.update({
                "top_value": col.get("top_value"),
                "top_freq":  col.get("top_freq"),
            })
        elif col_type in ("datetime", "date", "timestamp"):
            entry.update({
                "top_value": col.get("top_value"),
            })
        elif col_type == "mixed":
            # Include whatever stats the profiler managed to compute
            entry.update({
                "top_value": col.get("top_value"),
                "top_freq":  col.get("top_freq"),
            })

        result.append(entry)
    return result


def _build_column_meta_from_cache(profiler) -> list:
    """Build column metadata directly from profiler._column_stats_cache.

    Uses the same source as the Issues Found card so no issues are missed.
    Falls back to _build_column_meta(profile) if the cache is empty.
    """
    result = []
    for col_name, stats in profiler._column_stats_cache.items():
        total = max(stats.total_count or 1, 1)
        col_type = stats.data_type.value.lower()

        issues = []
        if stats.missing_count > 0:
            issues.append("missing_values")
        if stats.outlier_count > 0:
            issues.append("outliers")
        if stats.type_inconsistency_count > 0:
            issues.append("type_inconsistencies")
        if col_type == "mixed":
            issues.append("mixed_types")

        name_lower = col_name.lower()
        if any(k in name_lower for k in ("email", "mail")):
            issues.append("email_format")
        elif any(k in name_lower for k in ("phone", "mobile", "tel")):
            issues.append("phone_format")
        elif any(k in name_lower for k in ("date", "_at", "_on", "time")):
            issues.append("date_format")

        outlier_pct       = round(stats.outlier_count / total * 100, 1)
        inconsistency_pct = round(stats.type_inconsistency_count / total * 100, 1)

        entry = {
            "column_name":               col_name,
            "data_type":                 col_type,
            "total_count":               total,
            "null_percent":              round(stats.missing_count / total * 100, 1),
            "unique_ratio":              round((stats.unique_count or 0) / total, 3),
            "outlier_percent":           outlier_pct,
            "type_inconsistency_percent": inconsistency_pct,
            "issues":                    issues,
        }

        if col_type in ("integer", "decimal", "int", "int64", "float64", "float"):
            mean   = stats.mean
            median = stats.median
            skew_hint = None
            if mean is not None and median is not None and median != 0:
                ratio = mean / median
                if ratio > 1.1:
                    skew_hint = "right_skewed"
                elif ratio < 0.9:
                    skew_hint = "left_skewed"
                else:
                    skew_hint = "roughly_symmetric"
            entry.update({
                "min":       float(stats.min_val) if stats.min_val is not None else None,
                "max":       float(stats.max_val) if stats.max_val is not None else None,
                "mean":      round(float(mean), 4) if mean is not None else None,
                "median":    round(float(median), 4) if median is not None else None,
                "std":       round(float(stats.std), 4) if stats.std is not None else None,
                "skew_hint": skew_hint,
            })
        elif col_type in ("text", "string", "object", "alphanumeric"):
            entry.update({
                "top_value": stats.top_value,
                "top_freq":  stats.top_freq,
            })
        elif col_type in ("datetime", "date", "timestamp"):
            entry.update({
                "top_value": stats.top_value,
            })
        elif col_type == "mixed":
            entry.update({
                "top_value": stats.top_value,
                "top_freq":  stats.top_freq,
            })

        result.append(entry)
    return result


def _summarize_applied_steps(steps: list) -> list:
    """Convert raw session steps into a compact summary for the AI prompt."""
    _OP_LABELS = {
        "impute":             "fill_nulls",
        "outlier":            "handle_outliers",
        "duplicates":         "handle_duplicates",
        "type_inconsistency": "fix_type_inconsistency",
        "type_conversion":    "convert_type",
        "text_transform":     "text_transform",
        "normalize":          "normalize",
        "rename_column":      "rename_column",
        "drop_column":        "drop_column",
        "filter_rows":        "filter_rows",
    }
    summary = []
    for step in (steps or []):
        step_type = step.get("type", "")
        payload   = step.get("payload") or {}
        columns   = payload.get("columns") or ([step["column"]] if step.get("column") else [])
        strategy  = payload.get("strategy") or payload.get("method") or payload.get("operation") or ""
        label     = _OP_LABELS.get(step_type, step_type)
        summary.append({
            "operation": label,
            "columns":   columns,
            "method":    strategy,
        })
    return summary


def _sanitize_suggestions(columns: list) -> list:
    """Replace any drop_nulls operations with fill_nulls — dropping data is never preferred."""
    for col in columns:
        sanitized = []
        for op in col.get("operations", []):
            if op.get("type") == "drop_nulls":
                data_type = ""  # not available here; default to mode
                sanitized.append({
                    **op,
                    "type": "fill_nulls",
                    "method": "mode",
                    "confidence": min(float(op.get("confidence", 0.8)), 0.85),
                    "risk_level": "low",
                })
            else:
                sanitized.append(op)
        col["operations"] = sanitized
    return columns


def _parse_suggest_response(text: str) -> list:
    """Extract the columns array from AI response, tolerating markdown fences."""
    cleaned = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    try:
        parsed = json.loads(cleaned)
        return _sanitize_suggestions(parsed.get("columns", []))
    except Exception:
        match = re.search(r'\{.*"columns"\s*:\s*\[.*\]\s*\}', cleaned, re.DOTALL)
        if match:
            try:
                return _sanitize_suggestions(json.loads(match.group()).get("columns", []))
            except Exception:
                pass
    return []


@router.post("/suggest-preprocessing")
async def suggest_preprocessing(
    session_id: str,
    db: Session = Depends(get_db),
):
    try:
        profiler = get_profiler(session_id, db)
        # Populate the cache if empty (e.g. after a server restart)
        if not profiler._column_stats_cache:
            profiler.profile(preview_rows=0)
    except Exception:
        raise HTTPException(404, "Session not found or profiler unavailable")

    # Use cache directly — same source as the Issues Found card, no issues missed
    columns_meta = _build_column_meta_from_cache(profiler)

    # Restrict to columns that actually appear in the Issues Found card
    _issue_flags = {"missing_values", "outliers", "type_inconsistencies", "mixed_types"}
    columns_meta = [c for c in columns_meta if _issue_flags & set(c.get("issues", []))]

    if not columns_meta:
        return {"success": True, "columns": []}

    # Build an allowlist so AI hallucinations are always stripped
    valid_columns = {c["column_name"] for c in columns_meta}

    # Fetch applied steps from session to give AI context of what's already done
    applied_steps = []
    try:
        session = crud.get_session_record(db, session_id)
        if session and session.applied_steps:
            applied_steps = _summarize_applied_steps(session.applied_steps)
    except Exception:
        logger.warning("Could not fetch applied steps for session %s", session_id)

    input_payload = {"column_metadata": columns_meta, "applied_steps": applied_steps}
    input_json = json.dumps(input_payload, indent=2)
    prompt = f"{_SUGGEST_SYSTEM_PROMPT}\n\nInput:\n{input_json}"

    try:
        text_out, _ = _ai_generate(prompt)
        if text_out:
            columns = _parse_suggest_response(text_out)
            # Strip any column the AI invented that has no real issues
            columns = [c for c in columns if c.get("column_name") in valid_columns]
            if columns:
                return {"success": True, "columns": columns}
    except Exception:
        logger.exception("suggest-preprocessing AI call failed")

    # Fallback: rule-based suggestions
    # Build a set of already-handled (column, issue) pairs from applied steps
    already_handled: set = set()
    for step in (session.applied_steps if session and session.applied_steps else []):
        step_type = step.get("type", "")
        payload   = step.get("payload") or {}
        cols      = payload.get("columns") or ([step["column"]] if step.get("column") else [])
        for col in cols:
            already_handled.add((col, step_type))

    fallback = []
    for col in columns_meta:
        col_name = col["column_name"]
        col_type = col["data_type"]
        null_pct = col.get("null_percent", 0)
        outlier_pct = col.get("outlier_percent", 0)
        skew = col.get("skew_hint")
        ops = []

        if "missing_values" in col["issues"] and (col_name, "impute") not in already_handled:
            method = "mode" if col_type in ("text", "string", "object", "alphanumeric", "mixed") else (
                "median" if skew in ("right_skewed", "left_skewed") else "mean"
            )
            ops.append({"type": "fill_nulls", "column": col_name,
                        "method": method, "confidence": 0.85, "risk_level": "low",
                        "reason": f"{null_pct}% of {col.get('total_count', '?')} rows in {col_name} are missing. "
                                  f"{method.capitalize()} imputation chosen based on column type and distribution. "
                                  f"Leaving nulls will cause errors in aggregations and model training."})

        if "outliers" in col["issues"] and (col_name, "outlier") not in already_handled:
            action = "remove_outliers" if outlier_pct > 10 else "cap_outliers"
            ops.append({"type": action, "column": col_name,
                        "method": "IQR", "confidence": 0.8, "risk_level": "medium",
                        "reason": f"{outlier_pct}% of values in {col_name} are outliers. "
                                  f"{'Removal' if action == 'remove_outliers' else 'Capping'} chosen because outlier rate is "
                                  f"{'high (>10%)' if action == 'remove_outliers' else 'moderate — capping preserves row count'}. "
                                  f"IQR method used as it is robust to skewed distributions."})

        if "type_inconsistencies" in col["issues"] and (col_name, "type_inconsistency") not in already_handled:
            incon_pct = col.get("type_inconsistency_percent", 0)
            risk = "high" if incon_pct > 20 else ("medium" if incon_pct >= 5 else "low")
            conf = 0.6 if incon_pct > 20 else (0.75 if incon_pct >= 5 else 0.85)
            high_note = "High inconsistency rate — significant data may be nullified after conversion; review results." if incon_pct > 20 else "Low-to-moderate inconsistency — minimal data loss expected."

            if col_type in ("datetime", "date", "timestamp"):
                ops.append({"type": "normalize_date", "column": col_name,
                            "target_format": "YYYY-MM-DD",
                            "confidence": conf, "risk_level": risk,
                            "reason": f"{incon_pct}% of values in {col_name} are inconsistent in a datetime column, likely mixed date format strings (e.g. MM/DD/YYYY vs YYYY-MM-DD). "
                                      f"Inconsistent formats cause parsing failures in time-series operations and aggregations. "
                                      f"normalize_date resolves format differences without creating nulls — a single step is sufficient. "
                                      f"{high_note}"})
            elif col_type in ("integer", "decimal", "int", "int64", "float64", "float"):
                target = "int" if col_type in ("integer", "int", "int64") else "float"
                impute_method = "median" if skew in ("right_skewed", "left_skewed") else "mean"
                ops.append({"type": "convert_type", "column": col_name,
                            "target_type": target,
                            "confidence": conf, "risk_level": risk,
                            "reason": f"{incon_pct}% of values in {col_name} are non-numeric (text/symbols) mixed into a {col_type} column. "
                                      f"These dirty entries will break numeric aggregations, model training, and statistical operations. "
                                      f"convert_type coerces the column to {target}, turning unconvertible string values into nulls. "
                                      f"{high_note}"})
                ops.append({"type": "fill_nulls", "column": col_name,
                            "method": impute_method,
                            "confidence": conf, "risk_level": "low",
                            "reason": f"After convert_type, the {incon_pct}% of formerly inconsistent values in {col_name} become nulls and must be imputed. "
                                      f"{impute_method.capitalize()} is chosen because the column is {'skewed' if skew in ('right_skewed', 'left_skewed') else 'roughly symmetric'}, "
                                      f"making {'median' if impute_method == 'median' else 'mean'} the most representative center. "
                                      f"This restores a complete, fully numeric column with minimal distribution shift."})
            else:
                ops.append({"type": "convert_type", "column": col_name,
                            "target_type": "string",
                            "confidence": conf, "risk_level": risk,
                            "reason": f"{incon_pct}% of values in {col_name} are numeric mixed into a {col_type} column. "
                                      f"Numeric values in a text column break string operations like pattern matching, grouping, and case normalization. "
                                      f"convert_type standardizes all values to strings, resolving the type conflict. "
                                      f"{high_note}"})
                ops.append({"type": "fill_nulls", "column": col_name,
                            "method": "mode",
                            "confidence": conf, "risk_level": "low",
                            "reason": f"After convert_type, any unconvertible values in {col_name} become nulls. "
                                      f"Mode imputation fills them with the most frequent category, preserving the dominant distribution of the text column. "
                                      f"This ensures the column remains fully populated without introducing artificial values."})


        if "email_format" in col["issues"] and (col_name, "text_transform") not in already_handled:
            ops.append({"type": "lowercase", "column": col_name,
                        "confidence": 0.9, "risk_level": "low",
                        "reason": f"{col_name} appears to contain email addresses; lowercasing ensures consistent comparison and deduplication."})

        if "phone_format" in col["issues"] and (col_name, "text_transform") not in already_handled:
            ops.append({"type": "validate_regex", "column": col_name,
                        "pattern_type": "phone", "confidence": 0.8, "risk_level": "low",
                        "reason": f"{col_name} appears to contain phone numbers; regex validation flags entries that don't match a standard phone format."})

        if "date_format" in col["issues"] and (col_name, "type_conversion") not in already_handled:
            ops.append({"type": "normalize_date", "column": col_name,
                        "target_format": "YYYY-MM-DD", "confidence": 0.85, "risk_level": "low",
                        "reason": f"{col_name} appears to contain dates; normalizing to ISO 8601 ensures consistent parsing and sorting."})

        if "mixed_types" in col["issues"] and (col_name, "type_inconsistency") not in already_handled and (col_name, "type_conversion") not in already_handled:
            # Infer the most likely target type from column name
            name_l = col_name.lower()
            if any(k in name_l for k in ("price", "amount", "cost", "salary", "rate", "score", "weight", "height", "lat", "lon")):
                target, impute = "float", "median"
            elif any(k in name_l for k in ("age", "count", "qty", "quantity", "year", "num", "id")):
                target, impute = "int", "median"
            else:
                target, impute = "string", "mode"
            ops.append({"type": "convert_type", "column": col_name,
                        "target_type": target,
                        "confidence": 0.7, "risk_level": "high",
                        "reason": f"{col_name} is classified as MIXED — no single data type covers ≥90% of its values. "
                                  f"This means the column contains a severe blend of types (text, numeric, symbols) that will break all type-dependent operations. "
                                  f"convert_type to {target} is recommended based on the column name, turning unconvertible values into nulls. "
                                  f"High risk — review the nullified entries after conversion to confirm the target type is correct."})
            ops.append({"type": "fill_nulls", "column": col_name,
                        "method": impute,
                        "confidence": 0.7, "risk_level": "low",
                        "reason": f"After converting {col_name} to {target}, any values that could not be coerced become nulls and must be imputed. "
                                  f"{impute.capitalize()} is used as the imputation method for a {target} column. "
                                  f"This completes the type normalization and ensures the column has no remaining nulls."})

        if ops:
            fallback.append({"column_name": col_name, "operations": ops})

    return {"success": True, "columns": fallback}


# ---------------------------------------------------------------------------
# Chart recommendations
# ---------------------------------------------------------------------------

_ALLOWED_CHART_TYPES = {"bar", "line", "scatter", "histogram", "pie"}

_CHART_SYSTEM_PROMPT = """You are an expert data visualization consultant.
Given a dataset's column metadata (including data types, cardinality, missing %, min, max, mean, std, skew, and top values), recommend between 4 and 6 chart types to visualize the data. You MUST return at least 4 and no more than 6 recommendations.

IMPORTANT: You may ONLY use these 5 chart types: bar, line, scatter, histogram, pie. Do NOT suggest any other type.

Rules you MUST follow:
- Line charts: for time/date columns vs a numeric measure.
- Bar charts: for categorical (≤20 unique) vs numeric — comparisons.
- Scatter plots: for two numeric columns — relationships/correlation.
- Histograms: for a single numeric column — distribution.
- Pie charts: ONLY when a categorical column has ≤5 unique values and the user cares about composition.
- If a categorical column has cardinality >20, DO NOT use it as X-axis for bar/pie.
- If there are no date columns, do not recommend a line chart for trend.
- Use skew_hint to strengthen reasoning: right-skewed columns benefit from histogram; symmetric columns suit bar/scatter.
- Use min/max/mean/std to describe the numeric range and spread in your reasoning.
- Use top_value to describe what dominates a categorical column.

For each recommendation, reasoning must be 3–4 sentences covering:
  1. Why this column combination suits this chart type (data types, cardinality, numeric range)
  2. What specific pattern or insight the viewer should look for in this chart
  3. Why alternative chart types were ruled out for this combination

Respond ONLY with a valid JSON object:
{
  "recommendations": [
    {
      "chart_type": "bar",
      "title": "Revenue by Category",
      "x_axis": "Category",
      "y_axis": "Revenue",
      "color_by": null,
      "aggregation": "sum",
      "reasoning": "Category has only 5 unique values (top: Electronics) making it ideal for a bar chart — each bar directly compares total Revenue across groups. Revenue ranges from 0 to 150,000 with a right-skewed distribution (mean 42K vs median 28K), so the bar heights will expose which categories are driven by high-value outliers. A pie chart was ruled out because the goal is magnitude comparison, not part-of-whole composition.",
      "confidence": 0.92
    }
  ]
}

chart_type must be one of: bar, line, scatter, histogram, pie.
confidence is a float 0–1.
x_axis and y_axis must be exact column names from the input, or null for single-axis charts.
color_by is optional — use it when a third categorical column adds meaningful grouping.
"""


def _build_chart_meta(profile: dict) -> list:
    """Convert profile columns to enriched metadata for the AI chart prompt."""
    cols = profile.get("columns") or []
    out = []
    for c in cols:
        name = c.get("name") or c.get("column_name")
        if not name:
            continue
        dtype = (c.get("type") or c.get("data_type") or "unknown").lower()
        total = max(c.get("total_count") or 1, 1)
        entry = {
            "column":      name,
            "data_type":   dtype,
            "unique":      c.get("unique_count") or c.get("cardinality") or 0,
            "missing_pct": round((c.get("missing_count") or 0) / total * 100, 1),
        }
        if dtype in ("integer", "decimal", "float", "int", "int64", "float64"):
            mean = c.get("mean")
            median = c.get("median")
            skew_hint = None
            if mean is not None and median is not None and median != 0:
                ratio = mean / median
                if ratio > 1.1:
                    skew_hint = "right_skewed"
                elif ratio < 0.9:
                    skew_hint = "left_skewed"
                else:
                    skew_hint = "roughly_symmetric"
            entry.update({
                "min":       c.get("min"),
                "max":       c.get("max"),
                "mean":      round(mean, 4) if mean is not None else None,
                "std":       round(c.get("std"), 4) if c.get("std") is not None else None,
                "skew_hint": skew_hint,
            })
        elif dtype in ("text", "string", "object", "alphanumeric", "mixed", "category"):
            entry.update({
                "top_value": c.get("top_value"),
                "top_freq":  c.get("top_freq"),
            })
        out.append(entry)
    return out


def _fallback_chart_recs(cols_meta: list, exclude_keys: set = None) -> list:
    """Rule-based fallback chart recommendations — always returns up to 6."""
    exclude_keys = exclude_keys or set()
    recs = []

    def _key(r):
        return (r["chart_type"], r["x_axis"], r.get("y_axis"))

    def _add(r):
        if len(recs) >= 6:
            return
        if _key(r) not in exclude_keys:
            recs.append(r)
            exclude_keys.add(_key(r))

    numeric = [c for c in cols_meta if c["data_type"] in ("integer", "decimal", "float", "int", "int64", "float64")]
    categorical = [c for c in cols_meta if c["data_type"] in ("text", "string", "object", "category") and c["unique"] <= 20]
    date = [c for c in cols_meta if c["data_type"] in ("datetime", "date", "timestamp")]
    low_cat = [c for c in categorical if c["unique"] <= 5]

    # Time series — one per numeric column
    for num in numeric:
        for dt in date:
            _add({"chart_type": "line", "title": f"{num['column']} over Time",
                  "x_axis": dt["column"], "y_axis": num["column"],
                  "color_by": None, "aggregation": "sum",
                  "reasoning": f"{dt['column']} is a date column — a line chart shows the trend of {num['column']} over time.",
                  "confidence": 0.90})
        # Second line chart with a different numeric column for variety
        for dt in date:
            for num2 in numeric:
                if num2["column"] != num["column"]:
                    _add({"chart_type": "line", "title": f"{num2['column']} over Time",
                          "x_axis": dt["column"], "y_axis": num2["column"],
                          "color_by": None, "aggregation": "sum",
                          "reasoning": f"Line chart shows the trend of {num2['column']} over {dt['column']}.",
                          "confidence": 0.82})

    # Bar — categorical vs each numeric
    for cat in categorical:
        for num in numeric:
            _add({"chart_type": "bar", "title": f"{num['column']} by {cat['column']}",
                  "x_axis": cat["column"], "y_axis": num["column"],
                  "color_by": None, "aggregation": "sum",
                  "reasoning": f"{cat['column']} has {cat['unique']} unique values — bar chart compares {num['column']} across categories.",
                  "confidence": 0.88})

    # Scatter — all numeric pairs
    for i, n1 in enumerate(numeric):
        for n2 in numeric[i + 1:]:
            _add({"chart_type": "scatter", "title": f"{n1['column']} vs {n2['column']}",
                  "x_axis": n1["column"], "y_axis": n2["column"],
                  "color_by": categorical[0]["column"] if categorical else None, "aggregation": None,
                  "reasoning": f"Scatter plot of {n1['column']} and {n2['column']} reveals correlation or clusters.",
                  "confidence": 0.85})

    # Histogram — one per numeric column
    for num in numeric:
        _add({"chart_type": "histogram", "title": f"Distribution of {num['column']}",
              "x_axis": num["column"], "y_axis": None,
              "color_by": None, "aggregation": None,
              "reasoning": f"Histogram shows the frequency distribution of {num['column']}.",
              "confidence": 0.80})

    # Pie — low-cardinality categorical
    for cat in low_cat:
        _add({"chart_type": "pie", "title": f"Composition of {cat['column']}",
              "x_axis": cat["column"], "y_axis": None,
              "color_by": None, "aggregation": "count",
              "reasoning": f"{cat['column']} has only {cat['unique']} categories — pie chart shows composition clearly.",
              "confidence": 0.72})

    # If still under 6, add bar charts for any remaining categorical+numeric combos
    for cat in categorical:
        for num in numeric:
            _add({"chart_type": "bar", "title": f"Average {num['column']} by {cat['column']}",
                  "x_axis": cat["column"], "y_axis": num["column"],
                  "color_by": None, "aggregation": "avg",
                  "reasoning": f"Average {num['column']} per {cat['column']} category.",
                  "confidence": 0.70})

    return recs[:6]


@router.post("/chart-recommendations")
async def chart_recommendations(
    session_id: str,
    db: Session = Depends(get_db),
):
    """Return AI-ranked chart recommendations for the session's dataset."""
    # Return cached recommendations if already generated for this session
    session_record = db.query(SessionRecord).filter(SessionRecord.id == session_id).first()
    if session_record and session_record.chart_recommendations:
        return {"recommendations": session_record.chart_recommendations, "cached": True}

    try:
        profiler = get_profiler(session_id, db)
        profile = profiler.profile(preview_rows=0)
    except Exception:
        raise HTTPException(404, "Session not found or profiler unavailable")

    cols_meta = _build_chart_meta(profile)
    if not cols_meta:
        return {"recommendations": []}

    prompt = f"{_CHART_SYSTEM_PROMPT}\n\nDataset columns:\n{json.dumps(cols_meta, indent=2)}"

    valid_col_names = {c["column"].lower() for c in cols_meta}

    def _col_valid(name):
        """Accept column if it exactly matches (case-insensitive) or is a substring match of a real column."""
        if name is None:
            return True
        nl = name.lower()
        if nl in valid_col_names:
            return True
        # tolerate AI appending/prepending words (e.g. "GENERAL APPEARANCE Score" → "GENERAL APPEARANCE")
        return any(nl.startswith(real) or real.startswith(nl) for real in valid_col_names)

    def _snap_col(name):
        """Return the closest real column name for a hallucinated one, or None."""
        if name is None:
            return None
        nl = name.lower()
        if nl in valid_col_names:
            return name
        # exact real name whose lower equals nl already handled; try prefix/contains
        for c in cols_meta:
            rl = c["column"].lower()
            if nl.startswith(rl) or rl.startswith(nl) or nl in rl or rl in nl:
                return c["column"]
        return None

    recs = None
    try:
        text_out, _ = _ai_generate(prompt)
        if text_out:
            parsed = _extract_json(text_out)
            if isinstance(parsed, dict) and isinstance(parsed.get("recommendations"), list):
                raw = [r for r in parsed["recommendations"] if r.get("chart_type") in _ALLOWED_CHART_TYPES][:6]
                # Snap hallucinated column names to closest real columns; drop if unresolvable
                snapped = []
                for r in raw:
                    x = _snap_col(r.get("x_axis"))
                    y = _snap_col(r.get("y_axis"))
                    if r.get("x_axis") and x is None:
                        continue  # unresolvable x_axis — skip rec
                    r["x_axis"] = x
                    r["y_axis"] = y
                    snapped.append(r)
                recs = snapped
    except Exception:
        logger.exception("chart-recommendations AI call failed")

    if not recs:
        recs = _fallback_chart_recs(cols_meta)

    # Enforce 4–6 range: cap at 6, pad to 4 if AI returned fewer
    recs = recs[:6]
    if len(recs) < 4:
        existing_keys = {(r.get("chart_type"), r.get("x_axis"), r.get("y_axis")) for r in recs}
        padding = _fallback_chart_recs(cols_meta, exclude_keys=existing_keys)
        recs = recs + padding[: 4 - len(recs)]

    # Persist so subsequent visits skip the AI call
    if session_record and recs:
        session_record.chart_recommendations = recs
        db.commit()

    return {"recommendations": recs, "column_meta": cols_meta}


class ChartInsightRequest(BaseModel):
    session_id: str
    chart_type: str
    x_axis: str
    y_axis: Optional[str] = None
    title: Optional[str] = None


@router.post("/chart-insight")
async def generate_chart_insight(
    body: ChartInsightRequest,
    db: Session = Depends(get_db),
):
    """Generate a 1-2 sentence insight for a user-built chart."""
    from typing import Optional as _Opt
    try:
        profiler = get_profiler(body.session_id, db)
        profile = profiler.profile(preview_rows=0)
    except Exception:
        return {"insight": None}

    cols_meta = _build_chart_meta(profile)
    col_lookup = {c["column"]: c for c in cols_meta}

    x_info = col_lookup.get(body.x_axis, {})
    y_info = col_lookup.get(body.y_axis, {}) if body.y_axis else {}

    def _col_summary(info: dict, name: str) -> str:
        if not info:
            return name
        dtype = info.get("data_type", "unknown")
        unique = info.get("unique", "?")
        parts = [f"{name} ({dtype}, {unique} unique values)"]
        if info.get("mean") is not None:
            parts.append(f"mean={info['mean']}, range {info.get('min')}–{info.get('max')}")
        elif info.get("top_value"):
            parts.append(f"top value: {info['top_value']}")
        return ", ".join(parts)

    x_summary = _col_summary(x_info, body.x_axis)
    y_summary = _col_summary(y_info, body.y_axis) if body.y_axis else None
    chart_label = f"{body.chart_type} chart" + (f' "{body.title}"' if body.title else "")

    prompt = (
        f"You are a data analyst. Write exactly 1-2 sentences explaining what a {chart_label} "
        f"reveals about this dataset and what patterns the user should look for.\n"
        f"X axis: {x_summary}\n"
        + (f"Y axis: {y_summary}\n" if y_summary else "")
        + "Be specific, mention the column names, and keep the insight under 40 words."
    )

    try:
        text_out, _ = _ai_generate(prompt)
        insight = (text_out or "").strip().strip('"')
    except Exception:
        insight = None

    if not insight:
        # Deterministic fallback
        if body.chart_type == "scatter":
            insight = f"Scatter plot of {body.x_axis} vs {body.y_axis} — look for correlations, clusters, or outliers between the two variables."
        elif body.chart_type in ("bar",):
            insight = f"Bar chart comparing {body.y_axis or body.x_axis} across {body.x_axis} categories — identifies which groups lead or trail."
        elif body.chart_type == "line":
            insight = f"Line chart tracking {body.y_axis or body.x_axis} over {body.x_axis} — reveals trends and changes over time."
        elif body.chart_type == "pie":
            insight = f"Pie chart showing the proportional distribution of {body.x_axis} categories."
        elif body.chart_type == "histogram":
            insight = f"Histogram of {body.x_axis} — reveals its frequency distribution, spread, and skewness."
        else:
            insight = f"Visualises {body.x_axis}" + (f" vs {body.y_axis}" if body.y_axis else "") + "."

    return {"insight": insight}


@router.delete("/chart-recommendations")
async def clear_chart_recommendations(
    session_id: str,
    db: Session = Depends(get_db),
):
    """Clear cached chart recommendations so the next POST regenerates them."""
    session_record = db.query(SessionRecord).filter(SessionRecord.id == session_id).first()
    if session_record:
        session_record.chart_recommendations = None
        db.commit()
    return {"cleared": True}


# ---------------------------------------------------------------------------
# Analyze Chart (vision) — takes a chart image + metadata, returns insight
# ---------------------------------------------------------------------------

class ColumnStats(BaseModel):
    name: str
    type: Optional[str] = None
    total: Optional[int] = None
    missing: Optional[int] = None
    missing_pct: Optional[float] = None
    mean: Optional[float] = None
    median: Optional[float] = None
    std: Optional[float] = None
    min: Optional[Any] = None
    max: Optional[Any] = None
    outliers: Optional[int] = None
    unique: Optional[int] = None
    top_value: Optional[Any] = None
    top_freq: Optional[int] = None


class StepSummary(BaseModel):
    type: str
    description: Optional[str] = None
    column: Optional[str] = None


class ChartAnalysisRequest(BaseModel):
    image_base64: str
    chart_type: str
    x_axis: Optional[str] = None
    y_axis: Optional[str] = None
    x_stats: Optional[ColumnStats] = None
    y_stats: Optional[ColumnStats] = None
    applied_steps: Optional[List[StepSummary]] = []
    chart_title: Optional[str] = None


def _build_chart_prompt(body: ChartAnalysisRequest) -> str:
    lines = [
        f"Chart type: {body.chart_type}",
        f"Chart title: {body.chart_title or 'Untitled'}",
        f"X-axis column: {body.x_axis or 'N/A'}",
        f"Y-axis column: {body.y_axis or 'N/A'}",
    ]
    for label, stats in [("X-axis", body.x_stats), ("Y-axis", body.y_stats)]:
        if not stats:
            continue
        lines.append(f"\n{label} column stats ({stats.name}):")
        lines.append(f"  Data type    : {stats.type}")
        lines.append(f"  Total rows   : {stats.total}")
        lines.append(f"  Missing      : {stats.missing} ({stats.missing_pct}%)")
        lines.append(f"  Unique values: {stats.unique}")
        if stats.mean is not None or stats.median is not None:
            lines.append(f"  Mean / Median: {stats.mean} / {stats.median}")
        if stats.std is not None:
            lines.append(f"  Std dev      : {stats.std}")
        if stats.min is not None or stats.max is not None:
            lines.append(f"  Min / Max    : {stats.min} / {stats.max}")
        if stats.outliers:
            lines.append(f"  Outliers     : {stats.outliers}")
        if stats.top_value is not None:
            lines.append(f"  Top value    : {stats.top_value} ({stats.top_freq} times)")

    if body.applied_steps:
        relevant = [
            s.description or s.type
            for s in body.applied_steps
            if (s.column in (body.x_axis, body.y_axis)) or not s.column
        ]
        if relevant:
            lines.append("\nApplied cleaning steps on these columns:")
            for lbl in relevant:
                lines.append(f"  - {lbl}")

    context = "\n".join(lines)
    return (
        "You are a data analysis assistant. A user is viewing the chart attached.\n\n"
        f"Chart metadata:\n{context}\n\n"
        "Based on both the visual chart and the metadata above, provide:\n"
        "1. What the chart shows (1-2 sentences)\n"
        "2. Key patterns, trends, or distribution shape\n"
        "3. Any anomalies, outliers, or notable points visible\n"
        "4. One concrete actionable recommendation\n"
        "Be concise and specific. Refer to actual column names and values."
    )


def _gemini_vision(image_bytes: bytes, prompt: str) -> Optional[str]:
    """Try Gemini vision with image + text. Returns insight text or None on failure."""
    api_key = settings.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY") or os.getenv("gemini_api_key")
    if not api_key:
        return None
    try:
        client = genai.Client(api_key=api_key)
        image_part = genai_types.Part.from_bytes(data=image_bytes, mime_type="image/png")
    except Exception as exc:
        logger.warning("Gemini vision client/part setup failed: %s", exc)
        return None

    last_error = None
    for model_name in ("gemini-2.5-flash", "gemini-2.0-flash", "models/gemini-2.0-flash"):
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[image_part, prompt],
            )
            text_out = getattr(response, "text", "") or ""
            if text_out.strip():
                return text_out
        except Exception as exc:
            last_error = exc
            continue
    if last_error:
        logger.warning("Gemini vision failed on all models: %s", last_error)
    return None


@router.post("/analyze-chart")
async def analyze_chart(body: ChartAnalysisRequest):
    """Analyze a rendered chart with Gemini vision, falling back to text-only metadata analysis."""
    prompt = _build_chart_prompt(body)
    try:
        image_bytes = base64.b64decode(body.image_base64, validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")

    # Path 1: Gemini vision (image + text)
    insight = _gemini_vision(image_bytes, prompt)
    if insight:
        return {"success": True, "insight": insight.strip()}

    # Path 2: Text-only fallback (metadata only, no image)
    text_out, _ = _ai_generate(prompt)
    if text_out:
        return {
            "success": True,
            "insight": text_out.strip(),
            "note": "Image analysis unavailable \u2014 insight based on metadata only.",
        }

    raise HTTPException(status_code=503, detail="AI analysis unavailable")
