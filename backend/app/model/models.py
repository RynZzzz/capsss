from pydantic import BaseModel, EmailStr
from typing import List, Dict, Any, Optional
from datetime import datetime
class SaveDataRequest(BaseModel):
    """Request model for saving tabular data"""
    data: List[Dict[str, Any]]
    columns: List[str]
    file_name: str
    file_type: str

class SaveTextRequest(BaseModel):
    """Request model for saving text content"""
    content: str
    file_name: str

class FileResponse(BaseModel):
    """Response model for file operations"""
    file_type: str
    file_name: str
    message: str
    data: Optional[List[Dict[str, Any]]] = None
    columns: Optional[List[str]] = None
    content: Optional[str] = None
    shape: Optional[tuple] = None
    size: Optional[int] = None
    lines: Optional[int] = None

class SaveResponse(BaseModel):
    """Response model for save operations"""
    message: str
    output_file: str
    rows: Optional[int] = None
    columns: Optional[int] = None
    size: Optional[int] = None

class User(BaseModel):
    id:int 
    email: EmailStr
    name: str
    created_at: Optional[datetime] = None

class Accounts(BaseModel):
    id:int
    user_id:int
    provider:set
    provider_id:str 
    refresh_token:Optional[str]=None
class GoogleAuthRequest(BaseModel):
    token:str