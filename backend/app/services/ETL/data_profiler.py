import pandas as pd
import numpy as np
from dateutil import parser
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
from enum import Enum
from concurrent.futures import ThreadPoolExecutor
import threading

def convert_to_json_serializable(obj):
    if isinstance(obj, (np.integer, np.int64)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float64)):
        # Handle NaN/Inf which are invalid in strict JSON
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    elif isinstance(obj, (np.bool_)):
        return bool(obj)
    elif isinstance(obj, (np.ndarray, pd.Series, pd.Index)):
        return [convert_to_json_serializable(item) for item in obj]
    elif isinstance(obj, (pd.Timestamp, datetime, np.datetime64)):
        return obj.isoformat() if hasattr(obj, 'isoformat') else str(obj)
    elif isinstance(obj, dict):
        return {k: convert_to_json_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_json_serializable(item) for item in obj]
    elif pd.isna(obj):
        return None
    return obj

class DataType(Enum):
    """Enumeration of supported data types"""
    INTEGER = "Integer"
    DECIMAL = "Decimal"
    TEXT = "Text"
    ALPHANUMERIC = "Alphanumeric"
    DATETIME = "DateTime"
    MIXED = "Mixed"


class IssueType(Enum):
    """Enumeration of data quality issues"""
    MISSING = "missing"
    OUTLIER = "outlier"
    TYPE_INCONSISTENCY = "type_inconsistency"


@dataclass
class CellIssue:
    """Represents an issue in a specific cell"""
    row_idx: int
    col_name: str
    issue_type: IssueType
    details: Dict[str, Any]


@dataclass
class ColumnStats:
    """Statistics for a single column"""
    name: str
    data_type: DataType
    total_count: int
    non_null_count: int
    missing_count: int
    missing_indices: List[int]
    unique_count: int
    
    # Numeric-specific stats
    mean: Optional[float] = None
    median: Optional[float] = None
    std: Optional[float] = None
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    q1: Optional[float] = None
    q3: Optional[float] = None
    
    # Text-specific stats
    top_value: Optional[str] = None
    top_freq: Optional[int] = None
    
    # Quality issues
    outlier_count: int = 0
    outlier_indices: List[int] = None
    outlier_method: Optional[str] = None
    type_inconsistency_count: int = 0
    type_inconsistency_indices: List[int] = None
    
    # Value distribution
    value_counts: Dict[Any, int] = None
    value_indices: Dict[Any, List[int]] = None

    # Class imbalance (low-cardinality categorical columns only)
    is_imbalanced: bool = False
    imbalance_ratio: Optional[float] = None   # most_freq_count / least_freq_count
    dominant_class: Optional[str] = None
    dominant_pct: Optional[float] = None      # % of non-null rows dominated by one class

    def __post_init__(self):
        if self.outlier_indices is None:
            self.outlier_indices = []
        if self.type_inconsistency_indices is None:
            self.type_inconsistency_indices = []
        if self.value_counts is None:
            self.value_counts = {}
        if self.value_indices is None:
            self.value_indices = {}


class DataProfiler:
    """Main class for profiling datasets"""
    
    def __init__(self, df: pd.DataFrame):
        self.df = df.copy()
        self.original_df = self.df   # same reference — reset not needed during profiling
        self._column_stats_cache: Dict[str, ColumnStats] = {}
        self._issues_cache: List[CellIssue] = []
        self._changes_log: List[Dict] = []
        # O(1) index lookup sets — populated alongside _column_stats_cache
        self._missing_sets: Dict[str, set] = {}
        self._outlier_sets: Dict[str, set] = {}
        self._type_inconsistency_sets: Dict[str, set] = {}
        self._duplicate_indices: List[int] = []
        
    def profile(self, preview_rows: int = 10) -> Dict[str, Any]:
        """
        Generate complete data profile
        Returns a dictionary with all profiling information
        """
        # Skip full re-scan when every column is already cached
        if self._column_stats_cache and all(
            col in self._column_stats_cache for col in self.df.columns
        ):
            columns = [self._stats_to_dict(self._column_stats_cache[col]) for col in self.df.columns]
        else:
            columns = self._profile_all_columns()

        self._duplicate_indices = self.duplicate_detection(self.df)

        profile = {
            "metadata": self._get_metadata(),
            "columns": columns,
            "type_distribution": self._get_type_distribution(),
            "issues_summary": self._get_issues_summary(),
            "data": self._get_data_preview(preview_rows)
        }
        return convert_to_json_serializable(profile)
    
    def _get_metadata(self) -> Dict[str, Any]:
        """Get basic dataset metadata"""
        return {
            "total_rows": int(len(self.df)),
            "total_columns": len(self.df.columns),
            "memory_usage": self.df.memory_usage(deep=True).sum(),
            "shape": [int(s) for s in self.df.shape]
        }
    
    def _profile_all_columns(self) -> List[Dict[str, Any]]:
        """Profile all columns in parallel using a thread pool."""
        results_dict: Dict[str, Dict] = {}
        lock = threading.Lock()

        def _profile_one(col: str) -> None:
            try:
                stats = self._profile_column(col)
            except Exception:
                cd = self.df[col]
                stats = ColumnStats(
                    name=col,
                    data_type=DataType.MIXED,
                    total_count=int(len(cd)),
                    non_null_count=int(cd.notna().sum()),
                    missing_count=int(cd.isna().sum()),
                    missing_indices=[],
                    unique_count=0,
                )
            col_dict = self._stats_to_dict(stats)
            with lock:
                self._column_stats_cache[col] = stats
                self._missing_sets[col] = set(stats.missing_indices)
                self._outlier_sets[col] = set(stats.outlier_indices)
                self._type_inconsistency_sets[col] = set(stats.type_inconsistency_indices)
                results_dict[col] = col_dict

        n_workers = min(8, max(1, len(self.df.columns)))
        with ThreadPoolExecutor(max_workers=n_workers) as executor:
            list(executor.map(_profile_one, self.df.columns))

        return [results_dict[col] for col in self.df.columns]
    
    def _profile_column(self, col_name: str) -> ColumnStats:
        """Profile a single column with detailed analysis"""
        col_data = self.df[col_name]

        # Detect type — returns pre-computed numeric Series for numeric columns
        # so _calculate_numeric_stats / _detect_outliers don't repeat the work.
        data_type, type_issues, numeric_series = self._detect_type_and_inconsistencies(col_data)

        # Basic stats
        total_count = len(col_data)
        non_null_count = col_data.notna().sum()
        missing_count = total_count - non_null_count
        missing_indices = col_data[col_data.isna()].index.tolist()

        # Value distribution — for columns already typed by pandas (int/float/datetime),
        # skip the full value_counts pass and use nunique() instead (much faster).
        dtype = col_data.dtype
        is_pandas_typed = (
            pd.api.types.is_integer_dtype(dtype)
            or pd.api.types.is_float_dtype(dtype)
            or pd.api.types.is_datetime64_any_dtype(dtype)
        )
        if is_pandas_typed:
            value_counts = {}
            value_indices = {}
            unique_count = int(col_data.nunique())
        else:
            value_counts, value_indices = self._get_value_distribution(col_data, build_indices=False)
            unique_count = len(value_counts)

        stats = ColumnStats(
            name=col_name,
            data_type=data_type,
            total_count=total_count,
            non_null_count=non_null_count,
            missing_count=missing_count,
            missing_indices=missing_indices,
            unique_count=unique_count,
            type_inconsistency_count=len(type_issues),
            type_inconsistency_indices=type_issues,
            value_counts=value_counts,
            value_indices=value_indices,
        )

        # Type-specific analysis — pass the pre-computed numeric series to avoid
        # calling pd.to_numeric a second time inside each method.
        if data_type in [DataType.INTEGER, DataType.DECIMAL]:
            self._calculate_numeric_stats(numeric_series, stats)
            self._detect_outliers(numeric_series, stats)
        elif data_type in [DataType.TEXT, DataType.ALPHANUMERIC]:
            self._calculate_text_stats(stats)

        # Class imbalance — only for low-cardinality categorical columns (2–20 unique values)
        if data_type in [DataType.TEXT, DataType.ALPHANUMERIC, DataType.MIXED] and value_counts:
            n_unique = len(value_counts)
            if 2 <= n_unique <= 20:
                counts = list(value_counts.values())
                total_non_null = sum(counts)
                if total_non_null > 0:
                    max_count = max(counts)
                    min_count = min(counts)
                    dom_pct = max_count / total_non_null
                    if dom_pct >= 0.75 and min_count > 0:
                        stats.is_imbalanced = True
                        stats.imbalance_ratio = round(max_count / min_count, 2)
                        stats.dominant_class = str(max(value_counts, key=value_counts.get))
                        stats.dominant_pct = round(dom_pct * 100, 1)

        return stats
    
    def _detect_type_and_inconsistencies(
        self, col_data: pd.Series
    ) -> tuple:
        """Vectorized type detection — returns (DataType, inconsistency_indices, numeric_series).

        The third element is the pre-computed pd.to_numeric Series for INTEGER/DECIMAL
        columns so callers don't have to recompute it. It is None for all other types.

        Fast path: honour the pandas dtype when it is already unambiguous
        (int64/float64 → numeric, datetime64 → datetime).  Only object-dtype
        columns need the expensive string-based analysis.
        """
        dtype = col_data.dtype

        # ── Fast path: pandas already inferred a concrete type ───────────────
        if pd.api.types.is_integer_dtype(dtype):
            return DataType.INTEGER, [], col_data
        if pd.api.types.is_float_dtype(dtype):
            return DataType.DECIMAL, [], col_data
        if pd.api.types.is_datetime64_any_dtype(dtype):
            return DataType.DATETIME, [], None

        # ── Slow path: object (string) column — run vectorized detection ──────
        non_null_mask = col_data.notna()
        non_null = col_data[non_null_mask]

        if len(non_null) == 0:
            return DataType.MIXED, [], None

        # Numeric
        numeric = pd.to_numeric(non_null, errors="coerce")
        numeric_ok = numeric.notna()
        integer_ok = numeric_ok & ((numeric % 1) == 0)
        decimal_ok = numeric_ok & ~integer_ok

        # Datetime — sample first to avoid calling pd.to_datetime on 500K rows
        # when the column is obviously text/alphanumeric.
        dt_ok = pd.Series(False, index=non_null.index)
        non_numeric_vals = non_null[~numeric_ok]
        if len(non_numeric_vals) > 0:
            sample = non_numeric_vals.head(200).astype(str)
            try:
                sample_parsed = pd.to_datetime(sample, errors="coerce", infer_datetime_format=True)
                sample_hit_rate = sample_parsed.notna().mean()
            except Exception:
                sample_hit_rate = 0.0
            if sample_hit_rate >= 0.7:
                # Looks like a datetime column — parse all values
                try:
                    parsed = pd.to_datetime(
                        non_numeric_vals.astype(str),
                        errors="coerce",
                        infer_datetime_format=True,
                    )
                    dt_ok[non_numeric_vals.index] = parsed.notna()
                except Exception:
                    pass

        # Text / Alphanumeric — only run regex on values that are neither numeric nor datetime
        remaining_mask = ~numeric_ok & ~dt_ok
        remaining_vals = non_null[remaining_mask].astype(str).str.strip()
        text_flags     = remaining_vals.str.fullmatch(r"[A-Za-z\s]+", na=False)
        alphanum_flags = remaining_vals[~text_flags].str.fullmatch(r"[A-Za-z0-9\s]+", na=False)

        text_ok     = pd.Series(False, index=non_null.index)
        alphanum_ok = pd.Series(False, index=non_null.index)
        text_ok[text_flags[text_flags].index]         = True
        alphanum_ok[alphanum_flags[alphanum_flags].index] = True

        counts = {
            "integer":      int(integer_ok.sum()),
            "decimal":      int(decimal_ok.sum()),
            "datetime":     int(dt_ok.sum()),
            "text":         int(text_ok.sum()),
            "alphanumeric": int(alphanum_ok.sum()),
            "other":        int((~numeric_ok & ~dt_ok & ~text_ok & ~alphanum_ok).sum()),
        }

        total = sum(counts.values())
        if total == 0:
            return DataType.MIXED, [], None

        primary_key = max(counts, key=counts.get)
        primary_pct = counts[primary_key] / total * 100

        type_mapping = {
            "integer":      DataType.INTEGER,
            "decimal":      DataType.DECIMAL,
            "text":         DataType.TEXT,
            "alphanumeric": DataType.ALPHANUMERIC,
            "datetime":     DataType.DATETIME,
            "other":        DataType.MIXED,
        }

        if primary_pct < 90:
            return DataType.MIXED, [], None

        primary_type = type_mapping[primary_key]

        # Inconsistent indices: non-null values that don't match the primary type
        consistent_map = {
            "integer":      numeric_ok,
            "decimal":      numeric_ok,
            "datetime":     dt_ok,
            "text":         text_ok | alphanum_ok,
            "alphanumeric": alphanum_ok | text_ok,
            "other":        pd.Series(True, index=non_null.index),
        }
        consistent = consistent_map[primary_key]
        inconsistencies = non_null.index[~consistent][:100].tolist()
        cached_numeric = numeric if primary_key in ("integer", "decimal") else None
        return primary_type, inconsistencies, cached_numeric
    
    def _calculate_numeric_stats(self, numeric_series: pd.Series, stats: ColumnStats):
        """Calculate statistics for numeric columns from a pre-computed numeric Series."""
        numeric_data = numeric_series.dropna()

        if len(numeric_data) > 0:
            stats.mean = float(numeric_data.mean())
            stats.median = float(numeric_data.median())
            stats.std = float(numeric_data.std())
            stats.min_val = float(numeric_data.min())
            stats.max_val = float(numeric_data.max())
            stats.q1 = float(numeric_data.quantile(0.25))
            stats.q3 = float(numeric_data.quantile(0.75))
    
    def _calculate_text_stats(self, stats: ColumnStats):
        """Calculate statistics for text columns — reuse already-computed value_counts."""
        if stats.value_counts:
            top_key = next(iter(stats.value_counts))
            stats.top_value = str(top_key)
            stats.top_freq = int(stats.value_counts[top_key])
    
    def _detect_outliers(self, numeric_series: pd.Series, stats: ColumnStats):
        """Detect outliers using IQR from a pre-computed numeric Series."""
        numeric_data = numeric_series.dropna()

        if len(numeric_data) < 3:
            return
    
        Q1 = numeric_data.quantile(0.25)
        Q3 = numeric_data.quantile(0.75)
        IQR = Q3 - Q1
        lower_bound = Q1 - 1.5 * IQR
        upper_bound = Q3 + 1.5 * IQR
        
        outlier_mask = (numeric_data < lower_bound) | (numeric_data > upper_bound)
        stats.outlier_indices = numeric_data[outlier_mask].index.tolist()
        stats.outlier_method = "IQR"
        stats.outlier_count = len(stats.outlier_indices)
    
    # def _get_value_distribution(self, col_data: pd.Series) -> tuple[Dict, Dict]:
    #     """
    #     Get value counts and indices for each unique value
    #     Returns: (value_counts_dict, value_indices_dict)
    #     """
    #     value_indices = {}
        
    #     for idx, value in col_data.items():
    #         if pd.isna(value):
    #             continue
            
    #         value_key = str(value)
    #         if value_key not in value_indices:
    #             value_indices[value_key] = []
    #         value_indices[value_key].append(int(idx))
        
    #     value_counts = {k: len(v) for k, v in value_indices.items()}
        
    #     # Limit to top 1000 unique values for performance
    #     if len(value_counts) > 1000:
    #         sorted_items = sorted(value_counts.items(), key=lambda x: x[1], reverse=True)
    #         value_counts = dict(sorted_items[:1000])
    #         value_indices = {k: v for k, v in value_indices.items() if k in value_counts}
        
    #     return value_counts, value_indices
    def _get_value_distribution(self, col_data: pd.Series, build_indices: bool = True) -> tuple[Dict, Dict]:
        """Get value counts (and optionally row-index maps) for the top 1000 values.

        build_indices=False skips the groupby — use for numeric columns where
        per-value row lookup is not needed and the groupby is very expensive.
        """
        clean_data = col_data.dropna().astype(str)
        if clean_data.empty:
            return {}, {}

        counts_series = clean_data.value_counts().head(1000)
        value_counts = counts_series.to_dict()

        if not build_indices:
            return value_counts, {}

        top_keys = set(value_counts.keys())
        filtered = clean_data[clean_data.isin(top_keys)]
        value_indices = {
            str(k): v.tolist()
            for k, v in filtered.groupby(filtered).groups.items()
        }
        return value_counts, value_indices
    

    def _get_type_distribution(self) -> Dict[str, int]:
        """Get distribution of data types across columns"""
        distribution = {}
        for stats in self._column_stats_cache.values():
            type_name = stats.data_type.value
            distribution[type_name] = distribution.get(type_name, 0) + 1
        return distribution
    
    def _get_issues_summary(self) -> Dict[str, Any]:
        """Get summary of all data quality issues"""
        total_missing = sum(stats.missing_count for stats in self._column_stats_cache.values())
        total_outliers = sum(stats.outlier_count for stats in self._column_stats_cache.values())
        total_inconsistencies = sum(stats.type_inconsistency_count for stats in self._column_stats_cache.values())
        
        total_duplicates = len(self._duplicate_indices)
        return {
            "total_issues": int(total_missing + total_outliers + total_inconsistencies + total_duplicates),
            "missing": total_missing,
            "outliers": total_outliers,
            "type_inconsistencies": total_inconsistencies,
            "duplicates": total_duplicates,
            "duplicate_indices": self._duplicate_indices,
            "columns_with_issues": sum(1 for stats in self._column_stats_cache.values()
                                      if stats.missing_count > 0 or stats.outlier_count > 0 or stats.type_inconsistency_count > 0)
        }

    def _get_data_preview(self, preview_rows: int) -> List[Dict[str, Any]]:
        preview_df = self.df.head(int(preview_rows)).copy()
        if "_index" not in preview_df.columns:
            preview_df.insert(0, "_index", preview_df.index)
        # Convert nullable-integer/boolean columns to object so replace works uniformly
        for col in preview_df.columns:
            if hasattr(preview_df[col], "dtype") and pd.api.types.is_extension_array_dtype(preview_df[col].dtype):
                preview_df[col] = preview_df[col].astype(object)
        preview_df = preview_df.where(preview_df.notna(), other=None)
        return preview_df.to_dict(orient="records")
    
    def _get_cell_issues(self, row_idx: int, col_name: str) -> List[CellIssue]:
        """Get all issues for a specific cell"""
        issues = []
        
        if col_name not in self._column_stats_cache:
            return issues
        
        stats = self._column_stats_cache[col_name]
        
        # O(1) set lookups — fall back to list scan if sets not yet built
        missing_set = self._missing_sets.get(col_name) or set(stats.missing_indices)
        outlier_set = self._outlier_sets.get(col_name) or set(stats.outlier_indices)
        type_set = self._type_inconsistency_sets.get(col_name) or set(stats.type_inconsistency_indices)

        if row_idx in missing_set:
            issues.append(CellIssue(
                row_idx=row_idx,
                col_name=col_name,
                issue_type=IssueType.MISSING,
                details={}
            ))

        if row_idx in outlier_set:
            outlier_details: Dict[str, Any] = {"method": stats.outlier_method}
            if stats.q1 is not None and stats.q3 is not None:
                iqr = stats.q3 - stats.q1
                outlier_details["lower_bound"] = round(stats.q1 - 1.5 * iqr, 4)
                outlier_details["upper_bound"] = round(stats.q3 + 1.5 * iqr, 4)
            if stats.mean is not None and stats.std is not None and stats.std > 0:
                try:
                    cell_val = self.df.at[row_idx, col_name]
                    if not pd.isna(cell_val):
                        outlier_details["z_score"] = round((float(cell_val) - stats.mean) / stats.std, 2)
                except Exception:
                    pass
            issues.append(CellIssue(
                row_idx=row_idx,
                col_name=col_name,
                issue_type=IssueType.OUTLIER,
                details=outlier_details
            ))

        if row_idx in type_set:
            type_details: Dict[str, Any] = {"expected_type": stats.data_type.value}
            try:
                cell_val = self.df.at[row_idx, col_name]
                if not pd.isna(cell_val):
                    type_details["actual_value"] = str(cell_val)
            except Exception:
                pass
            issues.append(CellIssue(
                row_idx=row_idx,
                col_name=col_name,
                issue_type=IssueType.TYPE_INCONSISTENCY,
                details=type_details
            ))
        
        return issues
    
    def _format_display_value(self, value: Any) -> str:
        """Format value for display"""
        if pd.isna(value):
            return "Empty"
        return str(value)
    
    def _stats_to_dict(self, stats: ColumnStats) -> Dict[str, Any]:
        """Convert ColumnStats to dictionary for JSON serialization"""
        # Get the actual pandas dtype for this column
        try:
            pandas_dtype = str(self.df[stats.name].dtype)
        except Exception:
            pandas_dtype = "unknown"

        result = {
            "name": stats.name,
            "type": stats.data_type.value,
            "dtype": pandas_dtype,
            "total_count": int(stats.total_count),
            "non_null_count": stats.non_null_count,
            "missing_count": stats.missing_count,
            "missing_indices": [int(i) for i in (stats.missing_indices[:100] if len(stats.missing_indices) > 100 else stats.missing_indices)],  # Limit for performance
            "unique_count": stats.unique_count,
            "completeness": round((stats.non_null_count / stats.total_count * 100) if stats.total_count > 0 else 0, 2),
            "outlier_count": stats.outlier_count,
            "outlier_indices": stats.outlier_indices[:100] if len(stats.outlier_indices) > 100 else stats.outlier_indices,
            "outlier_method": stats.outlier_method,
            "type_inconsistency_count": stats.type_inconsistency_count,
            "type_inconsistency_indices": stats.type_inconsistency_indices[:100] if len(stats.type_inconsistency_indices) > 100 else stats.type_inconsistency_indices,
            "has_more_missing": len(stats.missing_indices) > 100,
            "has_more_outliers": len(stats.outlier_indices) > 100,
            "has_more_inconsistencies": len(stats.type_inconsistency_indices) > 100
        }
        
        # Add numeric-specific stats
        if stats.data_type in [DataType.INTEGER, DataType.DECIMAL]:
            result.update({
                "mean": round(float(stats.mean), 4) if stats.mean is not None else None,
                "median": round(float(stats.median), 4) if stats.median is not None else None,
                "std": round(float(stats.std), 4) if stats.std is not None else None,
                "min": float(stats.min_val) if stats.min_val is not None else None,
                "max": float(stats.max_val) if stats.max_val is not None else None,
                "q1": round(float(stats.q1), 4) if stats.q1 is not None else None,
                "q3": round(float(stats.q3), 4) if stats.q3 is not None else None
            })
        
        # Add text-specific stats
        if stats.data_type in [DataType.TEXT, DataType.ALPHANUMERIC, DataType.MIXED]:
            result.update({
                "top_value": stats.top_value,
                "top_freq": stats.top_freq
            })

        # Class imbalance
        result.update({
            "is_imbalanced": stats.is_imbalanced,
            "imbalance_ratio": stats.imbalance_ratio,
            "dominant_class": stats.dominant_class,
            "dominant_pct": stats.dominant_pct,
        })

        return result
    
    @staticmethod
    def _is_datetime(val_str: str) -> bool:
        """Check if string is a valid datetime"""
        try:
            parser.parse(val_str)
            return True
        except Exception:
            return False
    
    # ========== UPDATE METHODS ==========
    
    def update_cell(self, row_idx: int, col_name: str, new_value: Any) -> Dict[str, Any]:
        """
        Update a single cell value
        Returns: updated cell info with new issues
        """
        old_value = self.df.at[row_idx, col_name]

        # Treat empty strings and common missing tokens as true missing values
        if isinstance(new_value, str):
            normalized = new_value.strip()
            if normalized == "" or normalized.lower() in {"na", "nan", "null", "none"}:
                new_value = pd.NA

        self.df.at[row_idx, col_name] = new_value
        
        # Log change
        self._changes_log.append({
            "type": "cell_update",
            "row": row_idx,
            "column": col_name,
            "old_value": old_value,
            "new_value": new_value,
            "timestamp": datetime.now().isoformat()
        })
        
        # Re-profile the column
        updated_stats = self._profile_column(col_name)
        self._column_stats_cache[col_name] = updated_stats
        
        # Return updated cell info
        issues = self._get_cell_issues(row_idx, col_name)
        return {
            "value": new_value,
            "display_value": self._format_display_value(new_value),
            "issues": [{"type": issue.issue_type.value, **issue.details} for issue in issues]
        }
    
    def update_column_type(
        self,
        col_name: str,
        new_type: str,
        dry_run: bool = False,
        allow_partial: bool = False,
        preview_limit: int = 10,
    ) -> Dict[str, Any]:
        """
        Change the data type of a column
        Returns: success status and updated column stats
        """
        if col_name not in self.df.columns:
            return {"success": False, "error": "Column not found"}

        stats = self._column_stats_cache.get(col_name)
        source_type = stats.data_type.value if stats else "Unknown"
        series = self.df[col_name]
        normalized_target = str(new_type).strip()

        def to_family(type_name: str) -> str:
            lower = str(type_name or "").lower()
            if lower in {"integer", "decimal", "number", "numeric", "float", "double"}:
                return "numeric"
            if lower in {"datetime", "date", "timestamp"}:
                return "datetime"
            if lower in {"text", "string", "alphanumeric"}:
                return "string"
            return "other"

        source_family = to_family(source_type)
        target_family = to_family(normalized_target)

        allowed = (
            (source_family == "numeric" and target_family == "numeric")
            or (source_family == "numeric" and target_family == "string")
            or (source_family == "string" and target_family == "numeric")
            or (source_family == "datetime" and target_family == "string")
            or (source_family == "string" and target_family == "datetime")
        )
        if source_family == target_family and source_family in {"numeric", "string", "datetime"}:
            allowed = True
        if not allowed:
            return {
                "success": False,
                "error": f"Conversion from {source_type} to {normalized_target} is not allowed",
            }

        non_empty_mask = series.notna() & (series.astype(str).str.strip() != "")
        invalid_indices: List[int] = []
        converted_preview: List[Dict[str, Any]] = []
        error_reason = None

        try:
            if normalized_target in {"Integer", "Decimal"}:
                numeric_coerced = pd.to_numeric(series, errors="coerce")
                invalid_mask = non_empty_mask & numeric_coerced.isna()
                invalid_indices = [int(i) for i in numeric_coerced[invalid_mask].index.tolist()]
                if normalized_target == "Integer":
                    converted_series = numeric_coerced.round().astype("Int64")
                else:
                    converted_series = numeric_coerced.astype("Float64").round(1)
            elif normalized_target == "DateTime":
                datetime_coerced = pd.to_datetime(series, errors="coerce")
                invalid_mask = non_empty_mask & datetime_coerced.isna()
                invalid_indices = [int(i) for i in datetime_coerced[invalid_mask].index.tolist()]
                converted_series = datetime_coerced
            elif normalized_target == "Text":
                converted_series = series.astype("string")
                invalid_indices = []
            else:
                return {"success": False, "error": f"Unsupported target type: {normalized_target}"}

            preview_indices = series.index[: max(1, int(preview_limit))]
            for idx in preview_indices:
                old_val = series.loc[idx]
                new_val = converted_series.loc[idx]
                converted_preview.append(
                    {
                        "row_idx": int(idx),
                        "old_value": None if pd.isna(old_val) else str(old_val),
                        "new_value": None if pd.isna(new_val) else str(new_val),
                    }
                )

            report = {
                "source_type": source_type,
                "target_type": normalized_target,
                "total_rows": int(len(series)),
                "invalid_count": int(len(invalid_indices)),
                "invalid_rows": invalid_indices[:50],
                "convertible_count": int(len(series) - len(invalid_indices)),
                "preview": converted_preview,
            }

            if dry_run:
                return {
                    "success": True,
                    "dry_run": True,
                    "can_convert": len(invalid_indices) == 0,
                    "allow_partial": len(invalid_indices) > 0,
                    "report": report,
                }

            if len(invalid_indices) > 0 and not allow_partial:
                return {
                    "success": False,
                    "error": "Some rows cannot be converted",
                    "report": report,
                }

            if len(invalid_indices) > 0 and allow_partial:
                valid_mask = ~series.index.isin(invalid_indices)
                self.df.loc[valid_mask, col_name] = converted_series.loc[valid_mask]
            else:
                self.df[col_name] = converted_series

            self._changes_log.append(
                {
                    "type": "type_conversion",
                    "column": col_name,
                    "old_type": source_type,
                    "new_type": normalized_target,
                    "partial": bool(len(invalid_indices) > 0 and allow_partial),
                    "invalid_count": int(len(invalid_indices)),
                    "timestamp": datetime.now().isoformat(),
                }
            )

            updated_stats = self._profile_column(col_name)
            self._column_stats_cache[col_name] = updated_stats

            return {
                "success": True,
                "column_stats": self._stats_to_dict(updated_stats),
                "report": report,
            }

        except Exception as e:
            error_reason = str(e)

        return {"success": False, "error": f"Type conversion failed: {error_reason}"}
    
    def get_column_values(self, col_name: str, value_key: Optional[str] = None) -> Dict[str, Any]:
        """
        Get all values or specific value occurrences for a column
        If value_key is provided, returns indices where that value occurs
        """
        if col_name not in self.df.columns:
            return {"error": "Column not found"}
        
        stats = self._column_stats_cache.get(col_name)
        if not stats:
            stats = self._profile_column(col_name)
            self._column_stats_cache[col_name] = stats
        
        if value_key:
            # Compute on-demand: find rows where the string representation matches value_key
            col_str = self.df[col_name].dropna().astype(str)
            indices = col_str[col_str == value_key].index.tolist()
            values = [{"index": idx, "value": self.df.at[idx, col_name]} for idx in indices]
            return {
                "value_key": value_key,
                "count": len(indices),
                "indices": indices,
                "values": values
            }
        else:
            # Return all unique values summary
            return {
                "unique_count": stats.unique_count,
                "value_counts": stats.value_counts,
                "top_value": stats.top_value,
                "top_freq": stats.top_freq
            }
    
    def save_changes(self) -> Dict[str, Any]:
        """
        Commit all changes and return summary
        """
        return {
            "success": True,
            "changes_count": len(self._changes_log),
            "changes": self._changes_log,
            "timestamp": datetime.now().isoformat()
        }
    
    def get_changes_log(self) -> List[Dict]:
        """Get all changes made"""
        return self._changes_log
    
    def reset_to_original(self):
        """Reset dataframe to original state"""
        self.df = self.original_df.copy()
        self._column_stats_cache = {}
        self._changes_log = []


    def duplicate_detection(self, df: pd.DataFrame) -> List[int]:
        """Detect duplicate rows and return their indices"""
        duplicate_mask = df.duplicated(keep=False)
        duplicate_indices = df[duplicate_mask].index.tolist()
        return duplicate_indices
