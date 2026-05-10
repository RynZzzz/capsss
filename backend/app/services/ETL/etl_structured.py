import pandas as pd
import sys
import numpy as np
from scipy import stats
from pyod.models.knn import KNN
def file_processor(fileName):


        df = pd.read_excel(fileName)
        print("printing")
        data = df.describe().to_dict()
        types_dict = df.dtypes.to_dict()

        
       
   
import pandas as pd

# Let's assume 'df' is your DataFrame
def report_column_health(df):
    report_data = []
    # catch_data = {}
    for col in df.columns:
        # 1. Get the official Pandas dtype
        official_dtype = df[col].dtype
        
        # 2. Get every unique Python type present in the rows
        internal_types = df[col].map(type).unique()
        
        # 3. Flag if it's mixed (more than one type)
        is_mixed = len(internal_types) > 1
        
        report_data.append({
            "Column": col,
            "Pandas Dtype": str(official_dtype),
            "Internal Types": [t.__name__ for t in internal_types],
            "Status": "MIXED" if is_mixed else "CLEAN"
        })
        # catch_data
    # Display as a nice DataFrame for scannability
    return pd.DataFrame(report_data)

import re

def report_column_health(df):
    report_data = []
    
    # Regex Patterns
    currency_pattern = r'^\s*[\$\€\£\¥]\s*\d+|\d+\s*[\$\€\£\¥]\s*$'
    special_char_pattern = r'[^a-zA-Z0-9\s]' # Detects symbols like @, #, !, etc.
    number_in_text_pattern = r'\d' # Detects if a text string contains digits

    for col in df.columns:
        official_dtype = str(df[col].dtype)
        sample_data = df[col].dropna().astype(str)
        
        # 1. Detect Currency
        is_currency = sample_data.str.contains(currency_pattern).any()
        
        # 2. Detect Dirty Text (Special chars or Numbers in alpha columns)
        # We only check this if the column is primarily text
        has_special = False
        has_numbers = False
        if "object" in official_dtype:
            has_special = sample_data.str.contains(special_char_pattern).any()
            has_numbers = sample_data.str.contains(number_in_text_pattern).any()

        # 3. Identify Type
        detected_as = "Numeric" if "int" in official_dtype or "float" in official_dtype else "Text/Mixed"
        if is_currency: detected_as = "Currency"
        if "datetime" in official_dtype: detected_as = "Date"

        status_flags = []
        if has_special: status_flags.append("SPECIAL_CHARS")
        if has_numbers and "object" in official_dtype: status_flags.append("HAS_DIGITS")
        if is_currency: status_flags.append("CURRENCY_FORMAT")

        report_data.append({
            "Column": col,
            "Pandas Dtype": official_dtype,
            "Detected Type": detected_as,
            "Flags": ", ".join(status_flags) if status_flags else "CLEAN",
            "Status": "WARNING" if status_flags else "OK"
        })
        
    return pd.DataFrame(report_data)
from collections import defaultdict

def report_all_imposters(df):
    # print(f"{'COLUMN':<20} | {'MAJORITY':<12} | {'IMPOSTER TYPE':<15} | {'INDICES'}")
    # print("-" * 80)
    imposter = []
    for col in df.columns:
        # Group indices by the type of the value found there
        type_groups = defaultdict(list)
        for idx, value in df[col].items():
            type_groups[type(value).__name__].append(idx)

        # If only one type exists, the column is clean; skip it
        if len(type_groups) <= 1:
            continue

        # Find the majority type based on count of occurrences
        majority_type = max(type_groups, key=lambda k: len(type_groups[k]))

        # Print a row for every 'imposter' type found in this column
        for t_name, indices in type_groups.items():
            if t_name != majority_type:
                # Truncate index list if it's too long to keep the print clean
                idx_str = str(indices)
                # print(f"{col:<20} | {majority_type:<12} | {t_name:<15} | {idx_str}")
                imposter.append(
                    {
                        "column":col,
                        "majority": majority_type,
                        "imposter_type": t_name,
                        "index": idx_str
                    }
                )
        return pd.DataFrame(imposter)
# --- Example Usage ---
# report_all_imposters(df)

# Run the report
import numpy as np
import pandas as pd
from scipy import stats
from pyod.models.knn import KNN  # Ensure correct import
from dateutil import parser
def detect_outliers_hybrid(col):
    outlier_report = {}
    data_clean = col.dropna()
        
    is_normal = False
    # Shapiro-Wilk is unreliable for N > 5000; strictly for small samples
    if 3 <= len(data_clean) <= 5000:
        _, p_val = stats.shapiro(data_clean)
        is_normal = p_val > 0.05
    if is_normal:
        Q1 = data_clean.quantile(0.25)
        Q3 = data_clean.quantile(0.75)
        IQR = Q3 - Q1
        lower_bound = Q1 - 1.5 * IQR
        upper_bound = Q3 + 1.5 * IQR
        
        # Extracting the index labels
        outliers_indices = data_clean[(data_clean < lower_bound) | (data_clean > upper_bound)].index
        method = "IQR (Statistical)"
    else:
        # PyOD expects a 2D array
        X = data_clean.values.reshape(-1, 1)
        clf = KNN(contamination=0.05) 
        clf.fit(X)
        
        # clf.labels_ is a numpy array of 0s and 1s
        # We use it to mask the original index of data_clean
        outliers_indices = data_clean.index[clf.labels_ == 1]
        method = "KNN (Machine Learning)"
        
    outlier_report = {
        "method": method,
        "outliers": outliers_indices.tolist(), # These are the row indices
        "count": len(outliers_indices)
    }
    
    return outlier_report


import re
import pandas as pd
import numpy as np
from decimal import Decimal
from app.services.file_storage import storage
import time
from datetime import datetime, timedelta
def is_dateTime(val_str):
                try:
                    parser.parse(val_str)
                    return True
                except (ValueError, TypeError):
                    return False

def format_excel_data(data):
    base_date = datetime(1899, 12, 30)
    dt_obj = base_date + timedelta(days=data)
    return dt_obj.strftime("%Y/%m/%d")
def inspect_data_integrity(df):
    inspection_results = [] 

    for col in df.columns:
        indices_alphanumeric = []
        indices_numeric = []
        indices_decimals = []
        indices_dates = []
        missing = []
        counts = {"numeric": 0, "decimals": 0,"alphanumeric": 0, "date": 0,"text": 0, "other": 0, "nonNullCount": 0,"missing" : 0}
        total_rows = len(df[col])
        indices_other = []
        column_type = ""
        unique_distribution = df[col].value_counts().to_dict()
        mean = 0
        standard_deviation = 0
        min = 0
        first_quantile = 0
        second_quantile = 0
        third_quantile = 0
        max = 0
        unique = "N/A"
        top = "N/A"
        freq = "N/A"
        outlier_method = "N/A"
        outlier_list = []
        outlier_count = 0
        for idx, value in df[col].items():


            val_str = str(value)
            

            # 2. Categorize the content
            
            if isinstance(value, (int, float)) and 40000 < value < 50000:
                counts["date"]+=1
                counts["nonNullCount"] +=1
                indices_dates.append(format_excel_data(value))
            elif val_str.strip().replace('.', '', 1).isdigit(): # Handles floats like '10.5'
                print("inside")
                
                if "." in val_str:
                    counts["decimals"]+=1
                    indices_decimals.append(val_str)
                    counts["nonNullCount"] +=1      
                else:
                    print("checking numeric")
                    counts["numeric"] += 1
                    indices_numeric.append(val_str)
                    counts["nonNullCount"] +=1
            elif is_dateTime(val_str):
                print("checking dateTime")
                counts["date"]+=1
                indices_dates.append(val_str)
                counts["nonNullCount"] +=1
            elif val_str.isalpha():
                print("checking alphabet")
                counts["text"] += 1
                counts["nonNullCount"] +=1
            elif "".join(val_str.split()).isalnum():
                print("checking alphanumeric")
                counts["alphanumeric"] += 1
                counts["nonNullCount"] +=1
                indices_alphanumeric.append(val_str)
            elif pd.isna(value):
                counts["missing"]+=1
                missing.append(idx)  
            
                            
            else:
                print("checking other")
                counts["other"]+=1
                indices_other.append(val_str)
    
        # --- Decision Logic ---
        numeric_ratio = counts["numeric"] / total_rows
        alphanumeric_ratio = counts["alphanumeric"] /total_rows
        decimal_ratio = counts["decimals"]/total_rows
        date_ratio = counts["date"]/total_rows
        text_ratio = counts["text"]/total_rows
        other_ratio = counts["other"]/total_rows
        missing_ratio = counts["missing"]/total_rows
        counts_ratio = {"numeric": numeric_ratio, "decimals": decimal_ratio,"alphanumeric": alphanumeric_ratio, "date": date_ratio,"text": text_ratio, "other": other_ratio, "missing" : missing_ratio}
        imposter = []
        if numeric_ratio == 1.0:
            final_label = "Integer"
        elif alphanumeric_ratio == 1.0:
            final_label = "Alphanumeric"
        elif decimal_ratio == 1.0:
            final_label = "Decimal"
        elif date_ratio == 1.0:
            final_label = "DateTime"
        elif text_ratio == 1.0:
            final_label = "Text"
        else:
            final_label = "Mix"
            imposter.append(idx)


        if final_label == "Integer":
            outliers = detect_outliers_hybrid(df[col])
            outlier_method = outliers.get("method", "N/A")
            outlier_count = outliers.get("count", 0)
            outlier_list = outliers.get("outliers", [])
            stats = df[col].astype(int).describe()
            count = stats.get("count")
            mean = stats.get("mean")
            standard_deviation = stats.get("std")
            min =  stats.get("min")
            first_quantile =  stats.get("25%")
            second_quantile = stats.get("50%")
            third_quantile = stats.get("75%")
            max = stats.get("max")
        
        elif final_label == "Decimal":
            outliers = detect_outliers_hybrid(df[col])
            outlier_method = outliers.get("method", "N/A")
            outlier_count = outliers.get("count", 0)
            outlier_list = outliers.get("outliers", [])
            stats = df[col].astype(float).describe()
            count = stats.get("count")
            mean = stats.get("mean")
            standard_deviation = stats.get("std")
            min =  stats.get("min")
            first_quantile =  stats.get("25%")
            second_quantile = stats.get("50%")
            third_quantile = stats.get("75%")
            max = stats.get("max")    
           

        elif final_label == "Alphanumeric" or final_label == "Text" or final_label == "Mix":
            stats = df[col].astype(str).describe()
            count = stats.get("count")
            unique = stats.get("unique")
            top = stats.get("top")
            freq = stats.get("freq")
             
        inspection_results.append({
            "column": col,
            "type": final_label,
            "count": count,
            "count_ratio":counts_ratio,
            "numeric_count": counts["numeric"],
            "decimals_count": counts["decimals"],
            "date": counts["date"],
            "alphanumeric_count":counts["alphanumeric"],
            "text_count": counts["text"],
            "other_counts":counts["other"],
            "uniqueValue_counts": len(unique_distribution),
            "decimals_idx": indices_decimals,
            "date_idx":indices_dates,
            "numeric_idx":indices_numeric,
            "other_idx":indices_other,
            "missing_idx":missing,
            "uniqueValues_map": unique_distribution,
            "mean": mean,
            "standard_deviation": standard_deviation,
            "min": min,
            "first_quantile": first_quantile,
            "second_quantile": second_quantile,
            "third_quantile": third_quantile,
            "max":max,
            "unique":unique,
            "top": top,
            "freq": freq,
            "nonNullCount": counts["nonNullCount"],
            "missing":counts["missing"],
            "outlier_method":outlier_method,
            "outlier_list":outlier_list,
            "outlier_count":outlier_count,
            "imposter": imposter
        })

    return pd.DataFrame(inspection_results)

def numeric_or_text(df):
    data = inspect_data_integrity(df)
    metadata = []
    for index, row in data.iterrows():
        col_name = row["column"]
        flag = row["detected_flag"]

        target_col = df[col_name]
        if flag == "Integer":
            stats = target_col.astype(int).describe()
            metadata.append(
                {
                    "column": col_name,
                    "type": flag,
                    "count": stats.get("count"),
                    "mean": stats.get("mean"),
                    "standard deviation": stats.get("std"),
                    "min": stats.get("min"),
                    "first_quartile": stats.get("25%"),
                    "second_quartile": stats.get("50%"),
                    "third_quartile": stats.get("75%"),
                    "max":stats.get("max")
                })
        elif flag == "Decimal":
            stats = target_col.astype(float).describe()
            metadata.append(
                {
                    "column": col_name,
                    "type": flag,
                    "count": stats.get("count"),
                    "mean": stats.get("mean"),
                    "standard deviation": stats.get("std"),
                    "min": stats.get("min"),
                    "first_quartile": stats.get("25%"),
                    "second_quartile": stats.get("50%"),
                    "third_quartile": stats.get("75%"),
                    "max":stats.get("max")
                })
        elif flag in ["Alphanumeric", "Text", "Mix"]:
            stats = target_col.astype(str).describe()
            metadata.append({
                    "column": col_name,
                    "type": flag,
                    "count": stats.get("count"),
                    "unique": stats.get("unique"),
                    "top": stats.get("top"),
                    "freq": stats.get("freq")
            })

    return pd.DataFrame(metadata)





def column_statistics(df):
    statistics = []
    
    stats = df.describe(include = 'all')
    for col in df.columns:
        total_count = stats.loc["count", col]
        mean = stats.loc["mean", col]
        # median = stats.loc["median", col]
        min = stats.loc["min", col]
        max = stats.loc["max", col]
        
        total_missing = (df[col].isna() | (df[col] == "")).sum()
        statistics.append(
            {
                "column":col,
                "total_count":total_count,
                "mean":mean,
                "min":min,
                "max":max,
                "total_missing": total_missing
            }
        )
    return pd.DataFrame(statistics)


def main():
    print("from main function")
    if len(sys.argv) > 1:
        content = sys.argv[1]
        # print(file_processor(content))
        df = pd.read_excel(sys.argv[1])
        # print(report_column_health(df))
        # report_all_imposters(df)
        # print(detect_outliers_hybrid(df))
        print(inspect_data_integrity(df))
        # storage.save_dataframe(inspect_data_integrity(df), "Student-Employability-Datasets.xlsx", "excel")
        # print(column_statistics(df))
        # print(numeric_or_text(df))
if __name__ == "__main__":
    main()