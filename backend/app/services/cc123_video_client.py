"""cc123.ai relay 视频生成客户端（第三方 Seedance 2.0 接入路径）。

OpenAPI 形态（来自 https://cc123.ai/openapi/relay.json）：
  POST /v1/video/generations    {model, prompt, image, duration, width, height, n}  → {task_id, ...}
  GET  /v1/video/generations/{task_id} → {status, url, format, error}

模型名对应 dreamina/即梦：
  seedance2.0      —— 720p 标准
  seedance2.0fast  —— 720p 快速
  seedance2.0_vip  —— 720p / 1080p
  seedance2.0fast_vip
（cc123 作为 NewAPI relay，模型名按上游原样透传；如果 cc123 那边模型名不一样，
 可以在前端下拉里改 value，或在 dispatcher 里做名字 mapping。）

策略：submit → 轮询 → 拿到 url 流式下载到 outputs/<uuid>.mp4。
"""
from __future__ import annotations

import asyncio
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

from app.config import settings
from app.utils.logger import logger


SUPPORTED_CC123_MODELS = (
    "seedance2.0fast",
    "seedance2.0",
    "seedance2.0fast_vip",
    "seedance2.0_vip",
)


@dataclass
class CC123Result:
    success: bool
    task_id: Optional[str] = None
    status: Optional[str] = None
    url: Optional[str] = None             # cc123 上游托管 mp4 URL
    local_video_path: Optional[str] = None  # 下载到本地后的路径
    error: Optional[str] = None
    poll_count: int = 0
    raw_response: Optional[dict] = None


def _aspect_to_wh(aspect_ratio: Optional[str], resolution: str = "720p") -> tuple[int, int]:
    """把 9:16 / 16:9 / 1:1 + 720p/1080p 转 (width, height)。"""
    if resolution == "1080p":
        base = 1080
    else:
        base = 720
    ar = (aspect_ratio or "9:16").strip()
    if ar in ("9:16", "9_16"):
        return (base, int(base * 16 / 9))    # 720x1280 / 1080x1920
    if ar in ("16:9", "16_9"):
        return (int(base * 16 / 9), base)
    if ar in ("1:1", "1_1"):
        return (base, base)
    return (720, 1280)


class CC123VideoClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://cc123.ai",
        timeout_sec: float = 60.0,
    ):
        if not api_key or not api_key.strip():
            raise ValueError("CC123 api_key is required")
        self.api_key = api_key.strip()
        self.base_url = (base_url or "https://cc123.ai").rstrip("/")
        self.timeout_sec = float(timeout_sec)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def submit_video(
        self,
        *,
        model: str,
        prompt: str,
        image_url_or_b64: Optional[str] = None,
        duration: int = 15,
        width: int = 720,
        height: int = 1280,
        n: int = 1,
    ) -> tuple[Optional[str], Optional[dict], Optional[str]]:
        """submit → (task_id, raw, error)；任一非空 task_id 即视为成功 submit。"""
        payload = {
            "model": model,
            "prompt": prompt,
            "duration": int(duration),
            "width": int(width),
            "height": int(height),
            "n": int(n),
            "response_format": "url",
        }
        if image_url_or_b64:
            payload["image"] = image_url_or_b64

        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec) as cli:
                r = await cli.post(
                    f"{self.base_url}/v1/video/generations",
                    json=payload, headers=self._headers(),
                )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            return None, None, f"network: {type(e).__name__}: {e}"

        if r.status_code != 200:
            return None, None, f"HTTP {r.status_code}: {r.text[:300]}"
        try:
            data = r.json()
        except Exception as e:
            return None, None, f"json decode: {e}"
        tid = data.get("task_id") or data.get("id")
        if not tid:
            return None, data, f"no task_id in response: {str(data)[:200]}"
        return tid, data, None

    async def query_result(self, task_id: str) -> tuple[Optional[dict], Optional[str]]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec) as cli:
                r = await cli.get(
                    f"{self.base_url}/v1/video/generations/{task_id}",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            return None, f"network: {type(e).__name__}: {e}"
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}: {r.text[:300]}"
        try:
            return r.json(), None
        except Exception as e:
            return None, f"json decode: {e}"

    async def download_to_outputs(self, url: str) -> Optional[str]:
        """流式下载到 outputs/<uuid>.mp4，返回相对路径。"""
        out_dir = Path("outputs")
        out_dir.mkdir(parents=True, exist_ok=True)
        dst = out_dir / f"{uuid.uuid4().hex}.mp4"
        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec * 5) as cli:
                async with cli.stream("GET", url) as resp:
                    if resp.status_code != 200:
                        logger.error(f"cc123 download {url}: HTTP {resp.status_code}")
                        return None
                    with dst.open("wb") as f:
                        async for chunk in resp.aiter_bytes(chunk_size=64 * 1024):
                            f.write(chunk)
            return str(dst).replace("\\", "/")
        except Exception as e:
            logger.error(f"cc123 download failed: {e}")
            if dst.exists():
                try: dst.unlink()
                except Exception: pass
            return None

    async def submit_and_wait(
        self,
        *,
        model: str,
        prompt: str,
        image_url_or_b64: Optional[str] = None,
        duration: int = 15,
        width: int = 720,
        height: int = 1280,
        max_wait_sec: int = 1800,
        poll_interval: int = 10,
    ) -> CC123Result:
        """submit → 轮询 → 下载，全程异步。"""
        tid, raw, err = await self.submit_video(
            model=model, prompt=prompt,
            image_url_or_b64=image_url_or_b64,
            duration=duration, width=width, height=height,
        )
        if not tid:
            return CC123Result(success=False, error=err or "submit failed", raw_response=raw)

        deadline = asyncio.get_event_loop().time() + max_wait_sec
        polls = 0
        last_status = None
        while asyncio.get_event_loop().time() < deadline:
            polls += 1
            await asyncio.sleep(poll_interval)
            data, qerr = await self.query_result(tid)
            if qerr:
                # 网络瞬抖，继续轮询
                logger.warning(f"cc123 poll #{polls} sid={tid[:8]}: {qerr}")
                continue
            status = (data or {}).get("status")
            if status != last_status:
                logger.info(f"cc123 poll #{polls} sid={tid[:8]}: status={status}")
                last_status = status
            if status == "completed":
                url = data.get("url")
                if not url:
                    return CC123Result(
                        success=False, task_id=tid, status=status,
                        error=f"completed but no url: {str(data)[:200]}",
                        raw_response=data, poll_count=polls,
                    )
                local = await self.download_to_outputs(url)
                if not local:
                    return CC123Result(
                        success=False, task_id=tid, status=status, url=url,
                        error="download failed",
                        raw_response=data, poll_count=polls,
                    )
                return CC123Result(
                    success=True, task_id=tid, status=status, url=url,
                    local_video_path=local, raw_response=data, poll_count=polls,
                )
            if status == "failed":
                err_obj = data.get("error") or {}
                err_msg = err_obj.get("message") if isinstance(err_obj, dict) else str(err_obj)
                return CC123Result(
                    success=False, task_id=tid, status=status,
                    error=err_msg or "gen_status=failed",
                    raw_response=data, poll_count=polls,
                )

        return CC123Result(
            success=False, task_id=tid, status="timeout",
            error=f"polling timed out after {max_wait_sec}s ({polls} polls)",
            poll_count=polls,
        )


def get_cc123_client() -> Optional[CC123VideoClient]:
    """单例工厂；未配置 key 时返 None。"""
    if not settings.CC123_API_KEY:
        return None
    return CC123VideoClient(
        api_key=settings.CC123_API_KEY,
        base_url=settings.CC123_BASE_URL,
    )
