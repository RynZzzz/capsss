from fastapi import FastAPI, HTTPException
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os
from app.routes.upload import router as upload_router
from app.routes.saves  import router as save_router
from app.db.connection import init_db
from app.routes import profiling, editing, preprocessing, visualization
from app.routes.ai import router as ai_router
from app.routes.ai_summary import router as ai_summary_router
from app.routes.auth import auth
from app.services.ETL.Cleaning import router as cleaning_router
from app.routes.sessions import router as sessions_router
from app.routes.project import router as project_router
from app.routes.logs import router as logs_router
from app.routes.ml import router as ml_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(
    title="Multi-Format Data API",
    description="API for uploading, editing, and saving various file formats",
    version="1.0.0",
    lifespan=lifespan
)



# CORS Middleware
from app.config.config import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,  # Set to True for OAuth cookies/sessions
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(upload_router, tags=["upload"])
app.include_router(save_router, tags=["save"])
app.include_router(profiling.router)
app.include_router(editing.router)
app.include_router(preprocessing.router)
app.include_router(visualization.router)
app.include_router(auth.router)
app.include_router(cleaning_router)
app.include_router(ai_router)
app.include_router(ai_summary_router)
app.include_router(sessions_router)
app.include_router(project_router)
app.include_router(logs_router)
app.include_router(ml_router)

@app.get("/api")
async def root():
    return {
        "message": "Multi-Format Data API",
        "status": "running",
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    """Liveness probe — lightweight, no DB hit."""
    return {"status": "healthy"}

@app.get("/ready")
async def readiness_check():
    """Deeper readiness probe — verifies the DB is reachable."""
    from sqlalchemy import text as _text
    from app.db.connection import SessionLocal
    db = SessionLocal()
    try:
        db.execute(_text("SELECT 1"))
        return {"status": "ready"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"DB not reachable: {exc}")
    finally:
        db.close()


frontend_dist = Path(
    os.getenv("FRONTEND_DIST", Path(__file__).resolve().parent / "frontend_dist")
)

if frontend_dist.exists():
    assets_dir = frontend_dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/", include_in_schema=False)
    async def serve_frontend_root():
        return FileResponse(frontend_dist / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        api_prefixes = ("api/", "file/", "files/", "export/", "save", "save-text", "health", "ready")
        if full_path.startswith(api_prefixes):
            raise HTTPException(status_code=404, detail="Not found")
        requested_file = frontend_dist / full_path
        if requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(frontend_dist / "index.html")
