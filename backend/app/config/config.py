from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import BaseModel
from typing import List
from pathlib import Path
import os
from dataclasses import dataclass, field
from typing import Optional, Dict, Any


current_dir = Path(__file__).resolve().parent
# env_path = current_dir.parent.parent / ".env"

class Settings(BaseSettings):
    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    
    # CORS — comma-separated list. Override via CORS_ORIGINS env var in production
    # (App Platform: set this to the public URL of the deployed app).
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"
    
    # Directories
    UPLOAD_DIR: str = "uploads"
    TEXT_DIR: str = "text_files"
    PROCESSED_DIR: str = "processed"
    
    # File Settings
    # App Platform defaults to a 100 MiB request body cap. Files larger than
    # ~95 MiB should use the /upload/chunk + /upload/complete flow.
    MAX_FILE_SIZE: int = 200 * 1024 * 1024  # 200 MiB
    
    GOOGLE_CLIENT_ID: str = "191625527569-l6ereqd4ga4o4h5l4t5vr685nri9l2hj.apps.googleusercontent.com"
    GEMINI_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_TEXT_MODEL: str = "openrouter/auto"
    OPENROUTER_VISION_MODEL: str = "openrouter/auto"
    GROQ_API_KEY: str = ""
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    # Llama 3.3 70B Versatile is Groq's flagship text model. Override to
    # "llama-3.1-8b-instant" for faster/cheaper or "deepseek-r1-distill-llama-70b"
    # for stronger reasoning.
    GROQ_TEXT_MODEL: str = "llama-3.3-70b-versatile"
    # Llama 4 Scout is multimodal (vision-capable) on Groq. Override to
    # "meta-llama/llama-4-maverick-17b-128e-instruct" for stronger vision or
    # "llama-3.2-11b-vision-preview" for the smaller legacy vision model.
    GROQ_VISION_MODEL: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    # Primary AI provider: "groq" (default), "openrouter", or "ollama" (local).
    # _ai_generate / _vision_analyze try this provider first then fall through
    # the standard chain on failure.
    AI_PRIMARY_PROVIDER: str = "groq"
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
    
    @property
    def cors_origins_list(self) -> List[str]:
        """Convert CORS_ORIGINS string to list"""
        if isinstance(self.CORS_ORIGINS, str):
            return [origin.strip() for origin in self.CORS_ORIGINS.split(',')]
        return self.CORS_ORIGINS


@dataclass
class DatabaseConfig:
    host: str = "127.0.0.1"
    port: int = 3306
    user: str = "root"
    password: str = ""
    database: str = "cleanLogic"

    @classmethod
    def from_env(cls) -> "DatabaseConfig":
        return cls(
            host = os.getenv("DB_HOST", "127.0.0.1"),
            port = int(os.getenv("DB_PORT", "3306")),
            user = os.getenv("DB_USER", "root"),
            password = os.getenv("DB_PASSWORD", ""),
            database = os.getenv("DB_NAME", "cleanLogic")
        )


@dataclass
class config:
    databaseconfig: DatabaseConfig = field(default_factory=DatabaseConfig)

    @classmethod
    def from_env(cls) -> "config":
        return cls(
            databaseconfig=DatabaseConfig.from_env()
        )



class CellUpdateRequest(BaseModel):
    row_idx: int; col_name: str; new_value: Any

class BatchCellUpdateRequest(BaseModel):
    updates: List[CellUpdateRequest]

class ColumnTypeUpdateRequest(BaseModel):
    col_name: str
    new_type: str
    dry_run: bool = False
    allow_partial: bool = False
    preview_limit: int = 10

class DeleteRowsRequest(BaseModel):
    row_indices: List[int]

class DropColumnRequest(BaseModel):
    col_name: str

class RecipeRequest(BaseModel):
    steps: List[Dict[str, Any]]

class PreprocessingConfigRequest(BaseModel):
    missing_handling: str = "omit"
    outlier_method: str = "iqr"
    outlier_action: str = "remove"
    outlier_param: float = 1.5
    missing_constant_value: Optional[str] = None
    column_missing_overrides: Dict[str, str] = {}
    column_outlier_overrides: Dict[str, Dict] = {}
    column_type_changes: Dict[str, str] = {}

class VisualizationRequest(BaseModel):
    chart_type: str
    chart_title: Optional[str] = None
    x_column: Optional[str] = None
    y_column: Optional[str] = None
    group_by: Optional[str] = None
    chart_config: Optional[Dict] = None


settings = Settings()
