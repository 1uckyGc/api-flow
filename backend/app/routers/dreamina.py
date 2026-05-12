"""Dreamina 状态端点 —— 给前端轮询用，不限 admin。

GET /api/dreamina/concurrency
返：
{
  "max": 5,              // 配额（Maestro VIP 实测上限）
  "in_flight": 2,        // 当前正在跑（submit→poll→download）的 dreamina 任务数
  "waiting": 3,          // 抢槽等待中的任务数
  "available": false,    // in_flight < max → true
}
"""
from fastapi import APIRouter, Depends

from app.models.user import User
from app.routers.auth import get_current_user
from app.utils.dreamina_concurrency import get_status


router = APIRouter(prefix="/api/dreamina", tags=["dreamina"])


@router.get("/concurrency")
def dreamina_concurrency_status(current_user: User = Depends(get_current_user)) -> dict:
    """前端 EndlessGallery 顶栏指示器轮询此端点 (~5s)。所有登录用户可读。"""
    return get_status()
