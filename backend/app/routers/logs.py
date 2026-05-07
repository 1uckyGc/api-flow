"""
调用日志 + HOLO 官方账单代理。

GET /api/logs                  本地表分页查询（admin 看全部，普通用户只看自己）
GET /api/logs/balance          代理 HOLO GET /me
GET /api/logs/transactions     代理 HOLO GET /me/transactions
GET /api/logs/{id}             单条详情（admin 或 owner）
"""
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.api_call_log import ApiCallLog
from app.models.user import User
from app.routers.auth import get_current_user
from app.utils.logger import logger


router = APIRouter(prefix="/api/logs", tags=["logs"])


def _is_admin(u: User) -> bool:
    return bool(u and u.username == "admin")


def _holo_base() -> str:
    return (settings.HOLO_API_URL or settings.AI_API_URL or "").rstrip("/")


def _holo_headers() -> dict:
    key = settings.HOLO_API_KEY or settings.AI_API_KEY or ""
    return {"Authorization": f"Bearer {key}"}


# ───────────────────────── 本地表 ─────────────────────────

@router.get("")
def list_logs(
    provider: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(ApiCallLog)

    # 权限：非 admin 强制只能看自己
    if not _is_admin(current_user):
        q = q.filter(ApiCallLog.user_id == current_user.id)
    elif user_id is not None:
        q = q.filter(ApiCallLog.user_id == user_id)

    if provider:
        q = q.filter(ApiCallLog.provider == provider)
    if status:
        q = q.filter(ApiCallLog.status == status)
    if date_from:
        try:
            q = q.filter(ApiCallLog.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            raise HTTPException(400, f"date_from 格式错误，需 ISO: {date_from}")
    if date_to:
        try:
            q = q.filter(ApiCallLog.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            raise HTTPException(400, f"date_to 格式错误，需 ISO: {date_to}")

    total = q.count()
    rows = (
        q.order_by(desc(ApiCallLog.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    # 拉关联用户名（一次性）
    user_ids = {r.user_id for r in rows if r.user_id}
    user_map = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.username

    items = []
    for r in rows:
        items.append({
            "id": r.id,
            "user_id": r.user_id,
            "username": user_map.get(r.user_id),
            "task_id": r.task_id,
            "group_id": r.group_id,
            "provider": r.provider,
            "model": r.model,
            "task_type": r.task_type,
            "holo_task_id": r.holo_task_id,
            "cost": r.cost,
            "refunded": r.refunded,
            "status": r.status,
            "latency_ms": r.latency_ms,
            "error_msg": r.error_msg,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/balance")
async def holo_balance(current_user: User = Depends(get_current_user)):
    """代理 HOLO GET /me — 当前 key 的余额、今日扣费、阶梯定价等。
    仅管理员可看；普通用户共享同一把 HOLO key，不应暴露账户级账单数据。
    """
    if not _is_admin(current_user):
        raise HTTPException(403, "仅管理员可查看 HOLO 账户余额")
    base = _holo_base()
    if not base:
        raise HTTPException(503, "HOLO 未配置")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"{base}/me", headers=_holo_headers())
            r.raise_for_status()
            return r.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"HOLO /me: {e.response.text[:200]}")
    except Exception as e:
        logger.warning(f"HOLO balance proxy failed: {e}")
        raise HTTPException(502, f"HOLO 代理失败: {e}")


@router.get("/transactions")
async def holo_transactions(
    type: Optional[str] = Query(None),
    task_type: Optional[str] = Query(None),
    date: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
):
    """代理 HOLO GET /me/transactions —— 账户级官方账单流水。
    仅管理员可看，普通用户对应行只能看本地 ApiCallLog。
    """
    if not _is_admin(current_user):
        raise HTTPException(403, "仅管理员可查看 HOLO 账户账单")
    base = _holo_base()
    if not base:
        raise HTTPException(503, "HOLO 未配置")
    params = {"limit": limit, "offset": offset}
    if type:
        params["type"] = type
    if task_type:
        params["task_type"] = task_type
    if date:
        params["date"] = date
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(f"{base}/me/transactions", params=params, headers=_holo_headers())
            r.raise_for_status()
            return r.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"HOLO /me/transactions: {e.response.text[:200]}")
    except Exception as e:
        logger.warning(f"HOLO transactions proxy failed: {e}")
        raise HTTPException(502, f"HOLO 代理失败: {e}")


@router.get("/{log_id}")
def get_log_detail(
    log_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(ApiCallLog).filter(ApiCallLog.id == log_id).first()
    if not row:
        raise HTTPException(404, "log not found")
    if not _is_admin(current_user) and row.user_id != current_user.id:
        raise HTTPException(403, "无权查看")
    return {
        "id": row.id,
        "user_id": row.user_id,
        "task_id": row.task_id,
        "group_id": row.group_id,
        "provider": row.provider,
        "model": row.model,
        "task_type": row.task_type,
        "holo_task_id": row.holo_task_id,
        "cost": row.cost,
        "refunded": row.refunded,
        "status": row.status,
        "latency_ms": row.latency_ms,
        "error_msg": row.error_msg,
        "request_summary": row.request_summary,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }
