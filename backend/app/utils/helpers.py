import pandas as pd
import numpy as np
from datetime import datetime, date


def detect_file_type(filename: str) -> str:
    """Detect file type from extension"""
    ext = filename.lower().split('.')[-1]
    if ext in ['csv']:
        return 'csv'
    elif ext in ['xlsx', 'xls']:
        return 'excel'
    elif ext in ['json']:
        return 'json'
    elif ext in ['txt', 'log', 'md']:
        return 'text'
    elif ext in ['sql']:
        return 'sql'
    else:
        return 'unknown'

def get_base_name(filename: str) -> str:
    """Get filename without extension"""
    return filename.rsplit('.', 1)[0]

def get_extension(filename: str) -> str:
    """Get file extension"""
    return filename.rsplit('.', 1)[1] if '.' in filename else 'txt'

def sanitize_data(obj):
    """Recursively convert Numpy/Pandas types to standard Python types."""
    if isinstance(obj, dict):
        return {k: sanitize_data(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple, set)):
        return [sanitize_data(v) for v in obj]
    elif isinstance(obj, (np.integer, pd.Int64Dtype)):
        return int(obj)
    elif isinstance(obj, (np.floating, pd.Float64Dtype)):
        return float(obj)
    elif isinstance(obj, (np.ndarray, pd.Series)):
        return sanitize_data(obj.tolist())
    elif isinstance(obj, (pd.Timestamp, datetime, date, np.datetime64)):
        return obj.isoformat() if hasattr(obj, "isoformat") else str(obj)
    elif pd.isna(obj):
        return None
    return obj