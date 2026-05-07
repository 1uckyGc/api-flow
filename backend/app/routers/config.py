from fastapi import APIRouter
from app.config import settings

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/ai-provider")
def get_ai_provider():
    """前端用于决定该展示哪一套模型下拉。"""
    return {
        "provider": (settings.AI_PROVIDER or "flow2api").lower(),
    }
