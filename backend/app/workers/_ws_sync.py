"""Sync helper for pushing WebSocket messages from non-async contexts.

Mirrors `app/workers/tasks.py::notify_ws` but uses `httpx.Client` (sync) so it can be
called from synchronous Celery tasks / subprocess poll loops without an event loop.
"""
import os

import httpx

from app.config import settings
from app.utils.logger import logger


def notify_ws_sync(user_id: int, message: dict) -> None:
    """POST 到内部 WS 注入端点。失败吞掉，进度推送是 best-effort。"""
    try:
        api_url = os.environ.get("WEB_API_URL") or getattr(settings, "WEB_API_URL", None) or "http://127.0.0.1:8000"
        with httpx.Client(timeout=3.0) as c:
            c.post(
                f"{api_url}/ws/internal/notify",
                json={"user_id": user_id, "message": message},
            )
    except Exception as e:
        logger.warning(f"notify_ws_sync failed: {e}")
