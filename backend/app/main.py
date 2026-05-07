from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth, tasks, ws, upload, settings
from app.routers import director, workflows
from app.config import settings as app_settings
from app.database import engine, Base
from fastapi.staticfiles import StaticFiles
import os
import logging
from app.utils.logger import setup_logger

# 确保必要的系统目录存在
os.makedirs("outputs", exist_ok=True)
os.makedirs("uploads", exist_ok=True)
os.makedirs("logs", exist_ok=True)

# 初始化增强版日志系统 (Console + File 持久化)
setup_logger()



# 直接建表 (生产环境建议用 Alembic)
Base.metadata.create_all(bind=engine)

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import logging

app = FastAPI(title="FollowmeeeAIGC API", version="1.0.0")

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    logging.error(f"Validation error for {request.url.path}: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": exc.body},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/outputs/") or request.url.path.startswith("/uploads/"):
        response.headers["Cache-Control"] = "public, max-age=2592000, immutable"
    return response

app.include_router(auth.router)
app.include_router(tasks.router)
app.include_router(settings.router)
app.include_router(ws.router)
app.include_router(upload.router)
app.include_router(director.router)
app.include_router(workflows.router)


# 挂载静态资源路由
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

@app.get("/")
def read_root():
    return {"message": "Welcome to FollowmeeeAIGC API"}
