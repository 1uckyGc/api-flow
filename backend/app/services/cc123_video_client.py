"""cc123.ai relay 视频生成客户端 — 第三方 Seedance 2.0 / Sora-2 接入路径。

实测确定的 API 形态（2026-05-11，由用户官方样例核实）：

  POST /v1/video/generations           创建任务（application/json）
    body: {model, orientation, size, prompt, duration, watermark}
    返:   {id, task_id, status: "queued", progress: 0, created_at}

  GET /v1/videos/{task_id}             查询任务状态（OpenAI compat）
    返:   {status: queued/in_progress/completed/failed, progress, metadata: {url}}

  GET /v1/videos/{task_id}/content     流式下载 mp4（cc123 自己代理上游）

可用模型（来自 GET /v1/models 列表 + 用户文档）：
  sd-2          字节 Seedance 2.0 标准
  sd-2-vip      字节 Seedance 2.0 VIP（更高优先级 / 1080p）
  sora-2        OpenAI Sora 2

注意：
  - 之前用 /v1/videos multipart 是错的端点；用 /v1/video/generations JSON 才是正解
  - i2v 目前 schema 文档无明示，先只支持 t2v（image_path 字段保留但暂未启用）
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
    "sd-2",
    "sd-2-vip",
    "sora-2",
)


@dataclass
class CC123Result:
    success: bool
    task_id: Optional[str] = None
    status: Optional[str] = None
    local_video_path: Optional[str] = None  # 下载到本地后的路径（outputs/<uuid>.mp4）
    upstream_url: Optional[str] = None      # cc123 metadata.url（content 代理）
    error: Optional[str] = None
    poll_count: int = 0
    raw_response: Optional[dict] = None


def _aspect_to_orientation(aspect_ratio: Optional[str]) -> str:
    """前端比例 → cc123 orientation。9:16/2:3 → portrait，其他 → landscape。"""
    ar = (aspect_ratio or "9:16").strip()
    if ar in ("9:16", "9_16", "2:3", "2_3", "3:4", "3_4"):
        return "portrait"
    if ar in ("16:9", "16_9", "3:2", "3_2", "4:3", "4_3", "21:9"):
        return "landscape"
    return "portrait"


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

    def _auth_only(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def submit_video(
        self,
        *,
        model: str,
        prompt: str,
        duration: int = 15,
        orientation: str = "portrait",
        size: str = "large",
        watermark: bool = False,
    ) -> tuple[Optional[str], Optional[dict], Optional[str]]:
        """submit → (task_id, raw, error)。"""
        payload = {
            "model": model,
            "orientation": orientation,
            "size": size,
            "prompt": prompt,
            "duration": int(duration),
            "watermark": bool(watermark),
        }
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
            resp = r.json()
        except Exception as e:
            return None, None, f"json decode: {e}"

        # cc123 错误形态： {"code": "...", "message": "..."}
        if "code" in resp and resp.get("data") is None and "task_id" not in resp and "id" not in resp:
            return None, resp, f"{resp.get('code')}: {resp.get('message','')}"

        tid = resp.get("task_id") or resp.get("id")
        if not tid:
            return None, resp, f"no task_id in response: {str(resp)[:200]}"
        return tid, resp, None

    async def query_result(self, task_id: str) -> tuple[Optional[dict], Optional[str]]:
        """查询任务状态，用 OpenAI compat 端点 /v1/videos/{id}。
        返字段： {status, progress, metadata.url, ...}。
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec) as cli:
                r = await cli.get(
                    f"{self.base_url}/v1/videos/{task_id}",
                    headers=self._auth_only(),
                )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            return None, f"network: {type(e).__name__}: {e}"
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}: {r.text[:300]}"
        try:
            return r.json(), None
        except Exception as e:
            return None, f"json decode: {e}"

    async def download_content(self, task_id: str) -> Optional[str]:
        """流式下载 /v1/videos/{id}/content 到 outputs/<uuid>.mp4。"""
        out_dir = Path("outputs")
        out_dir.mkdir(parents=True, exist_ok=True)
        dst = out_dir / f"{uuid.uuid4().hex}.mp4"
        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec * 5, follow_redirects=True) as cli:
                async with cli.stream(
                    "GET",
                    f"{self.base_url}/v1/videos/{task_id}/content",
                    headers=self._auth_only(),
                ) as resp:
                    if resp.status_code != 200:
                        body = await resp.aread()
                        logger.error(f"cc123 download {task_id}: HTTP {resp.status_code} {body[:200]}")
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
        duration: int = 15,
        orientation: str = "portrait",
        size: str = "large",
        watermark: bool = False,
        max_wait_sec: int = 1800,
        poll_interval: int = 10,
    ) -> CC123Result:
        """submit → 轮询 → 下载，全程异步。"""
        tid, raw, err = await self.submit_video(
            model=model, prompt=prompt,
            duration=duration, orientation=orientation,
            size=size, watermark=watermark,
        )
        if not tid:
            return CC123Result(success=False, error=err or "submit failed", raw_response=raw)

        deadline = asyncio.get_event_loop().time() + max_wait_sec
        polls = 0
        last_status = None
        last_progress = None
        while asyncio.get_event_loop().time() < deadline:
            polls += 1
            await asyncio.sleep(poll_interval)
            data, qerr = await self.query_result(tid)
            if qerr:
                logger.warning(f"cc123 poll #{polls} sid={tid[:14]}: {qerr}")
                continue
            status = (data or {}).get("status")
            progress = (data or {}).get("progress")
            if status != last_status or progress != last_progress:
                logger.info(f"cc123 poll #{polls} sid={tid[:14]}: status={status} progress={progress}")
                last_status = status
                last_progress = progress
            if status in ("completed", "succeeded", "success"):
                upstream = ((data or {}).get("metadata") or {}).get("url")
                local = await self.download_content(tid)
                if not local:
                    return CC123Result(
                        success=False, task_id=tid, status=status,
                        upstream_url=upstream,
                        error="completed but content download failed",
                        raw_response=data, poll_count=polls,
                    )
                return CC123Result(
                    success=True, task_id=tid, status=status,
                    local_video_path=local, upstream_url=upstream,
                    raw_response=data, poll_count=polls,
                )
            if status == "failed":
                err_obj = (data or {}).get("error") or {}
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
