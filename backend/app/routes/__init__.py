from fastapi import APIRouter

api_router = APIRouter()

from app.routes import upload, saves
