from fastapi import APIRouter, HTTPException
import pandas as pd
from app.model.models import SaveDataRequest, SaveTextRequest
from app.services.file_storage import storage
from app.utils.helpers import get_base_name, get_extension

router = APIRouter()

@router.post("/save")
async def save_changes(request: SaveDataRequest):
    """Save edited tabular data"""
    try:
        df = pd.DataFrame(request.data, columns=request.columns)
        base_name = get_base_name(request.file_name)
        
        # Determine output filename
        if request.file_type == 'csv':
            filename = f"{base_name}_edited.csv"
        elif request.file_type == 'excel':
            filename = f"{base_name}_edited.xlsx"
        elif request.file_type == 'json':
            filename = f"{base_name}_edited.json"
        else:
            filename = f"{base_name}_edited.csv"
        
        output_path = storage.save_dataframe(df, filename, request.file_type)
        
        return {
            "message": "Data saved successfully",
            "output_file": str(output_path),
            "rows": len(df),
            "columns": len(df.columns)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving data: {str(e)}")

@router.post("/save-text")
async def save_text(request: SaveTextRequest):
    """Save edited text content"""
    try:
        base_name = get_base_name(request.file_name)
        ext = get_extension(request.file_name)
        filename = f"{base_name}_edited.{ext}"
        
        output_path = storage.save_text(filename, request.content)
        
        return {
            "message": "Text file saved successfully",
            "output_file": str(output_path),
            "size": len(request.content)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving text: {str(e)}")