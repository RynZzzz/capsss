import pandas as pd
import json
import io
import zipfile
import xml.etree.ElementTree as ET


def read_csv(file_content: bytes) -> pd.DataFrame:
    """Read CSV file with encoding fallback"""
    try:
        return pd.read_csv(io.BytesIO(file_content))
    except UnicodeDecodeError:
        return pd.read_csv(io.BytesIO(file_content), encoding='latin-1')
    except pd.errors.ParserError:
        return pd.read_csv(io.BytesIO(file_content), sep=None, engine='python')


def read_excel(file_content: bytes) -> pd.DataFrame:
    """Read Excel file — tries calamine (Rust, fast) first, falls back to openpyxl / xlrd."""
    try:
        return pd.read_excel(io.BytesIO(file_content), engine='calamine')
    except Exception:
        try:
            return pd.read_excel(io.BytesIO(file_content), engine='openpyxl')
        except Exception as e:
            try:
                return pd.read_excel(io.BytesIO(file_content), engine='xlrd')
            except Exception:
                raise Exception(f"Failed to read Excel file: {str(e)}")


def get_merge_ranges(file_content: bytes) -> list:
    """Detect merged cell ranges without loading the full workbook.

    For .xlsx (ZIP-based): reads only the sheet XML — no openpyxl overhead.
    For .xls (BIFF): falls back to xlrd.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(file_content)) as zf:
            sheet_names = sorted(
                name for name in zf.namelist()
                if name.startswith('xl/worksheets/sheet') and name.endswith('.xml')
            )
            if not sheet_names:
                return []
            with zf.open(sheet_names[0]) as sheet_file:
                root = ET.parse(sheet_file).getroot()
                ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                merge_cells_el = root.find('.//ns:mergeCells', ns)
                if merge_cells_el is None:
                    return []
                return [
                    mc.get('ref')
                    for mc in merge_cells_el.findall('ns:mergeCell', ns)
                    if mc.get('ref')
                ]
    except zipfile.BadZipFile:
        # Not an xlsx — try xls with xlrd
        try:
            import xlrd
            wb = xlrd.open_workbook(file_contents=file_content)
            ws = wb.sheet_by_index(0)
            if not ws.merged_cells:
                return []
            return [
                f"{xlrd.colname(c_lo)}{r_lo + 1}:{xlrd.colname(c_hi - 1)}{r_hi}"
                for r_lo, r_hi, c_lo, c_hi in ws.merged_cells
            ]
        except Exception:
            return []
    except Exception as e:
        raise Exception(f"Failed to check merged columns: {str(e)}")


def read_json(file_content: bytes) -> pd.DataFrame:
    """Read JSON file"""
    json_data = json.loads(file_content.decode('utf-8'))
    if isinstance(json_data, list):
        return pd.DataFrame(json_data)
    else:
        return pd.DataFrame([json_data])


def read_text(file_content: bytes) -> str:
    """Read text file"""
    return file_content.decode('utf-8')
