from fastapi import FastAPI
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
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
@app.get("/")
async def root():
    return {
        "message": "Multi-Format Data API",
        "status": "running",
        "version": "1.0.0"
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
