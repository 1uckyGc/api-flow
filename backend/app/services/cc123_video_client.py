"""cc123.ai relay 视频生成客户端（OpenAI Sora 兼容形态，sd-2 / sora-2 系列）。

实测确定的 API 形态（2026-05-10）：
  POST /v1/videos                    multipart/form-data — 创建视频任务
    fields: model / prompt / seconds / input_reference (binary, 可选 i2v)
    → {id, status, ...} (跟 OpenAI Sora API 一致)
  GET  /v1/videos/{id}               查询视频任务状态
    → {id, status, ...}  status: queued / in_progress / completed / failed
  GET  /v1/videos/{id}/content       流式下载 mp4 (status=completed 后)

cc123 上 seedance 实际只有 2 个变体（来自 GET /v1/models）：
  sd-2          — 标准
  sd-2-vip      — VIP（支持 1080p、队列优先）
（也支持 sora-2 但本客户端只用于 seedance 路径）
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
)


@dataclass
class CC123Result:
    success: bool
    task_id: Optional[str] = None
    status: Optional[str] = None
    local_video_path: Optional[str] = None  # 下载到本地后的路径（outputs/<uuid>.mp4）
    error: Optional[str] = None
    poll_count: int = 0
    raw_response: Optional[dict] = None


def _aspect_to_wh(aspect_ratio: Optional[str], resolution: str = "720p") -> tuple[int, int]:
    """把 9:16 / 16:9 / 1:1 + 720p/1080p 转 (width, height)。
    sd-2 系列实际不接受 width/height，但保留这个 helper 给前端展示用。
    """
    if resolution == "1080p":
        base = 1080
    else:
        base = 720
    ar = (aspect_ratio or "9:16").strip()
    if ar in ("9:16", "9_16"):
        return (base, int(base * 16 / 9))
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

    def _auth_header(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def submit_video(
        self,
        *,
        model: str,
        prompt: str,
        image_path: Optional[str] = None,    # i2v 时传本地图片绝对路径
        seconds: int = 15,
    ) -> tuple[Optional[str], Optional[dict], Optional[str]]:
        """submit → (task_id, raw, error)。"""
        files = {}
        data = {
            "model": model,
            "prompt": prompt,
            "seconds": str(int(seconds)),
        }
        if image_path and os.path.exists(image_path):
            # multipart 文件字段名按 OpenAPI doc 是 input_reference
            files["input_reference"] = (
                os.path.basename(image_path),
                open(image_path, "rb"),
                "application/octet-stream",
            )

        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec) as cli:
                r = await cli.post(
                    f"{self.base_url}/v1/videos",
                    data=data,
                    files=files if files else None,
                    headers=self._auth_header(),
                )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            return None, None, f"network: {type(e).__name__}: {e}"
        finally:
            for _name, fobj_tuple in files.items():
                try:
                    fobj_tuple[1].close()
                except Exception:
                    pass

        if r.status_code != 200:
            return None, None, f"HTTP {r.status_code}: {r.text[:300]}"
        try:
            resp = r.json()
        except Exception as e:
            return None, None, f"json decode: {e}"

        # cc123 / OpenAI 错误形态： {"code": "...", "message": "..."}
        if "code" in resp and resp.get("data") is None:
            return None, resp, f"{resp.get('code')}: {resp.get('message','')}"

        tid = resp.get("id") or resp.get("task_id")
        if not tid:
            return None, resp, f"no id in response: {str(resp)[:200]}"
        return tid, resp, None

    async def query_result(self, task_id: str) -> tuple[Optional[dict], Optional[str]]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec) as cli:
                r = await cli.get(
                    f"{self.base_url}/v1/videos/{task_id}",
                    headers=self._auth_header(),
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
            async with httpx.AsyncClient(timeout=self.timeout_sec * 5) as cli:
                async with cli.stream(
                    "GET",
                    f"{self.base_url}/v1/videos/{task_id}/content",
                    headers=self._auth_header(),
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
        image_path: Optional[str] = None,
        seconds: int = 15,
        max_wait_sec: int = 1800,
        poll_interval: int = 10,
    ) -> CC123Result:
        """submit → 轮询 → 下载，全程异步。"""
        tid, raw, err = await self.submit_video(
            model=model, prompt=prompt,
            image_path=image_path, seconds=seconds,
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
                logger.warning(f"cc123 poll #{polls} sid={tid[:12]}: {qerr}")
                continue
            status = (data or {}).get("status")
            if status != last_status:
                logger.info(f"cc123 poll #{polls} sid={tid[:12]}: status={status}")
                last_status = status
            if status == "completed":
                local = await self.download_content(tid)
                if not local:
                    return CC123Result(
                        success=False, task_id=tid, status=status,
                        error="completed but content download failed",
                        raw_response=data, poll_count=polls,
                    )
                return CC123Result(
                    success=True, task_id=tid, status=status,
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
