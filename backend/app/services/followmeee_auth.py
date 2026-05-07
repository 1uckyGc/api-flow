"""
集中身份代理：把 api-flow 登录请求转发到 followmeee.co/api/login。
"""
from typing import Any

import httpx

from app.config import settings
from app.utils.logger import logger


class FollowmeeeAuthError(Exception):
    """上游不可达或 5xx — 应当 fallback 到离线 admin 兜底。"""


class FollowmeeeAuthInvalid(Exception):
    """上游明确返回凭据无效（401 / 422）— 直接 401 给前端。"""


async def verify_via_followmeee(username: str, password: str) -> dict[str, Any]:
    """成功返回 followmeee.co 的 user dict（原样响应 JSON）。

    异常分两类：
    - FollowmeeeAuthInvalid：上游说凭据错（401 / 422 / 4xx 非 5xx）
    - FollowmeeeAuthError：上游不可达（超时/连接错）或 5xx，调用方应走兜底
    """
    base = (settings.FOLLOWMEEE_AUTH_URL or "https://followmeee.co").rstrip("/")
    url = f"{base}/api/login"
    payload = {"username": username, "password": password}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=3.0)) as client:
            r = await client.post(url, json=payload,
                                  headers={"User-Agent": "api-flow/auth-proxy"})
    except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError) as e:
        logger.warning(f"followmeee auth unreachable for user={username!r}: {type(e).__name__}: {e}")
        raise FollowmeeeAuthError(f"upstream unreachable: {e}")

    if r.status_code == 200:
        try:
            return r.json()
        except ValueError:
            logger.warning(f"followmeee /api/login 200 but non-JSON: {r.text[:200]}")
            raise FollowmeeeAuthError("upstream returned non-JSON 200")

    # 4xx 视为凭据错（401/422 都是 followmeee.co 拒绝凭据的形式）
    if 400 <= r.status_code < 500:
        return _raise_invalid_with_log(r, username)

    # 5xx → 上游故障，走兜底
    logger.warning(f"followmeee /api/login {r.status_code} for user={username!r}: {r.text[:200]}")
    raise FollowmeeeAuthError(f"upstream {r.status_code}: {r.text[:200]}")


def _raise_invalid_with_log(r: httpx.Response, username: str):
    logger.info(f"followmeee /api/login rejected user={username!r}: {r.status_code} {r.text[:120]}")
    raise FollowmeeeAuthInvalid()


def extract_is_admin(upstream: dict) -> bool:
    """从 followmeee.co 200 响应里抠 is_admin。

    试多种 shape（实际跑通后确认 followmeee 用哪种）：
    1. {"user": {"is_admin": true, ...}}
    2. {"user": {"role": "admin", ...}}
    3. {"is_admin": true}
    4. {"role": "admin"}
    """
    if not isinstance(upstream, dict):
        return False
    user = upstream.get("user") if isinstance(upstream.get("user"), dict) else upstream
    if isinstance(user, dict):
        if user.get("is_admin") is True:
            return True
        if str(user.get("role", "")).lower() in ("admin", "super_admin", "superadmin"):
            return True
    return False


def extract_display_name(upstream: dict, fallback: str) -> str:
    """从 followmeee.co 响应抠 display_name，没有就用 username 兜底。"""
    if not isinstance(upstream, dict):
        return fallback
    user = upstream.get("user") if isinstance(upstream.get("user"), dict) else upstream
    if isinstance(user, dict):
        for key in ("display_name", "name", "nickname"):
            v = user.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return fallback
