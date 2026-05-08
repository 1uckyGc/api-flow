"""
调用日志 + HOLO 官方账单代理。

GET /api/logs                  本地表分页查询（admin 看全部，普通用户只看自己）
GET /api/logs/balance          代理 HOLO GET /me
GET /api/logs/transactions     代理 HOLO GET /me/transactions
GET /api/logs/providers        多 provider 余额/用量聚合（admin only）
GET /api/logs/{id}             单条详情（admin 或 owner）
"""
import asyncio
import json
import re
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


# ───────────────────────── 多 provider 聚合余额/用量 ─────────────────────────

async def _probe_holo() -> dict:
    base = _holo_base()
    if not base:
        return {"provider": "holo", "label": "HOLO", "online": False, "error": "未配置"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            r = await cli.get(f"{base}/me", headers=_holo_headers())
            r.raise_for_status()
            d = r.json()
        return {
            "provider": "holo",
            "label": "HOLO",
            "online": True,
            "primary": {"label": "余额", "value": d.get("credits"), "unit": "credits"},
            "metrics": {
                "frozen_credits": d.get("frozen_credits"),
                "daily_used": d.get("daily_used"),
                "daily_credits_used": d.get("daily_credits_used"),
                "today_img": d.get("today_img"),
                "today_vid": d.get("today_vid"),
                "img_30d": d.get("img_30d"),
                "vid_30d": d.get("vid_30d"),
                "rpm_limit": d.get("rpm_limit"),
                "account_tag": d.get("account_tag"),
                "tier_thresholds": d.get("tier_thresholds"),
                "name": d.get("name"),
            },
        }
    except Exception as e:
        return {"provider": "holo", "label": "HOLO", "online": False, "error": str(e)[:200]}


async def _probe_packyapi_gemini() -> dict:
    key = (settings.PACKYAPI_GEMINI_KEY or "").strip()
    base = (settings.PACKYAPI_BASE_URL or "https://www.packyapi.com").rstrip("/")
    label = "PackyAPI · Gemini"
    provider = "packyapi-gemini"
    if not key:
        return {"provider": provider, "label": label, "online": False, "error": "PACKYAPI_GEMINI_KEY 未配置"}
    headers = {"Authorization": f"Bearer {key}"}
    usage = None
    sub = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as cli:
            ru = await cli.get(f"{base}/v1/dashboard/billing/usage", headers=headers)
            if ru.status_code == 200:
                usage = ru.json()
            rs = await cli.get(f"{base}/v1/dashboard/billing/subscription", headers=headers)
            if rs.status_code == 200:
                sub = rs.json()
    except Exception as e:
        return {"provider": provider, "label": label, "online": False, "error": str(e)[:200]}

    if usage is None and sub is None:
        return {"provider": provider, "label": label, "online": False, "error": "subscription/usage endpoints 无响应"}

    total_usage = (usage or {}).get("total_usage")
    return {
        "provider": provider,
        "label": label,
        "online": True,
        "primary": {"label": "已用额度", "value": round(total_usage, 2) if isinstance(total_usage, (int, float)) else total_usage, "unit": "USD"},
        "metrics": {
            "hard_limit_usd": (sub or {}).get("hard_limit_usd"),
            "soft_limit_usd": (sub or {}).get("soft_limit_usd"),
            "has_payment_method": (sub or {}).get("has_payment_method"),
            "access_until": (sub or {}).get("access_until"),
            "note": "sk-key 仅暴露累计 USD，账户余额需在 packyapi.com 控制台查",
        },
    }


_DREAMINA_BIN = "/root/.local/bin/dreamina"


async def _probe_dreamina() -> dict:
    label = "即梦 (Dreamina)"
    provider = "dreamina"
    try:
        proc = await asyncio.create_subprocess_exec(
            _DREAMINA_BIN, "user_credit",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15.0)
    except FileNotFoundError:
        return {"provider": provider, "label": label, "online": False, "error": "dreamina CLI 未安装在容器内"}
    except asyncio.TimeoutError:
        return {"provider": provider, "label": label, "online": False, "error": "dreamina user_credit 超时"}
    except Exception as e:
        return {"provider": provider, "label": label, "online": False, "error": str(e)[:200]}

    out = (stdout or b"").decode("utf-8", "replace") + (stderr or b"").decode("utf-8", "replace")
    if "未检测到有效登录态" in out or "请先执行 dreamina login" in out:
        return {
            "provider": provider, "label": label, "online": False,
            "error": "未登录 — SSH 进 worker 跑 `dreamina login` 一次扫码授权",
        }
    # try parse JSON
    m = re.search(r"\{[\s\S]*\}", out)
    if not m:
        return {"provider": provider, "label": label, "online": False, "error": f"无法解析输出: {out[:200]}"}
    try:
        d = json.loads(m.group(0))
    except Exception:
        return {"provider": provider, "label": label, "online": False, "error": f"JSON 解析失败: {out[:200]}"}
    return {
        "provider": provider,
        "label": label,
        "online": True,
        "primary": {"label": "余额", "value": d.get("total_credit"), "unit": "credits"},
        "metrics": {
            "user_id": d.get("user_id"),
            "user_name": d.get("user_name") or "（未设置）",
            "vip_level": d.get("vip_level"),
        },
    }


@router.get("/providers")
async def providers_summary(current_user: User = Depends(get_current_user)):
    """聚合所有 provider 的余额/用量信息（仅 admin）。

    并发拉：HOLO `/me`、PackyAPI Gemini billing/usage+subscription、Dreamina `user_credit`。
    每个 provider 返回统一形态：
        {provider, label, online, primary: {label, value, unit}, metrics: {...}, error?}
    单个 provider 探测失败不影响其他，前端按 online=false 展示降级。
    """
    if not _is_admin(current_user):
        raise HTTPException(403, "仅管理员可查看 provider 余额信息")
    results = await asyncio.gather(
        _probe_holo(),
        _probe_packyapi_gemini(),
        _probe_dreamina(),
        return_exceptions=False,
    )
    return {"providers": results, "fetched_at": datetime.utcnow().isoformat() + "Z"}


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
