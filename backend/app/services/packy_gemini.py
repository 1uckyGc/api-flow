"""PackyAPI Gemini OpenAI-compat 客户端。

PackyAPI 网关把 Gemini 包成 OpenAI Chat Completions 形态。视频 / 图片输入靠
{"type":"image_url","image_url":{"url":"data:<mime>;base64,..."}}，网关根据
data URL 的 mime 类型自动路由到 Gemini 的视频/图片解码。

实测 (2026-05-09):
  - gemini-2.5-flash / gemini-2.5-pro / gemini-3-flash-preview /
    gemini-3-pro-preview / gemini-3.1-pro-preview 都支持视频
  - 3.x 系列每帧 token 消耗约为 2.5 系列的 1/4
  - 这些模型自带 thinking，max_tokens 要给足（建议 ≥ 8000，剧本任务 ≥ 32000）
"""
from __future__ import annotations

import base64
import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx


SUPPORTED_GEMINI_MODELS = (
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-3.1-pro-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
)
DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview"


@dataclass
class GeminiCallResult:
    success: bool
    text: Optional[str] = None
    model_used: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    reasoning_tokens: Optional[int] = None
    error: Optional[str] = None


def _file_to_data_url(path: str) -> str:
    p = Path(path)
    mime, _ = mimetypes.guess_type(p.name)
    if not mime:
        # 视频默认 mp4，图片默认 jpeg
        mime = "video/mp4" if p.suffix.lower() in (".mp4", ".mov", ".webm", ".mkv") else "image/jpeg"
    b64 = base64.b64encode(p.read_bytes()).decode()
    return f"data:{mime};base64,{b64}"


class PackyGeminiClient:
    """OpenAI 形态的 Gemini 客户端。"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://www.packyapi.com",
        default_model: str = DEFAULT_GEMINI_MODEL,
        timeout_sec: float = 600.0,
    ):
        if not api_key or not api_key.strip():
            raise ValueError("api_key is required")
        self.api_key = api_key.strip()
        self.base_url = (base_url or "https://www.packyapi.com").rstrip("/")
        self.default_model = default_model or DEFAULT_GEMINI_MODEL
        self.timeout_sec = float(timeout_sec)

    async def run_storyboard(
        self,
        master_prompt: str,
        video_path: Optional[str],
        product_image_paths: list[str],
        *,
        model: Optional[str] = None,
        max_tokens: int = 32000,
    ) -> GeminiCallResult:
        """执行 6 阶段分镜复刻 prompt。

        master_prompt 已渲染好（含品牌配置块），客户端只负责把视频 / 商品图
        转成 data URL 拼进 messages。
        """
        if not master_prompt or not master_prompt.strip():
            return GeminiCallResult(success=False, error="master_prompt is empty")

        chosen_model = model or self.default_model
        if chosen_model not in SUPPORTED_GEMINI_MODELS:
            # 不强行 reject，让 PackyAPI 的 503 来回应；只是 log 一下
            pass

        # 顺序：先文字（含整段 master prompt），再视频，再商品图
        content: list[dict] = [{"type": "text", "text": master_prompt}]

        if video_path:
            if not os.path.exists(video_path):
                return GeminiCallResult(success=False, error=f"video not found: {video_path}")
            content.append({
                "type": "image_url",
                "image_url": {"url": _file_to_data_url(video_path)},
            })

        for img in product_image_paths or []:
            if not os.path.exists(img):
                continue
            content.append({
                "type": "image_url",
                "image_url": {"url": _file_to_data_url(img)},
            })

        payload = {
            "model": chosen_model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": max_tokens,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "FollowmeeeAIGC/1.0 (PackyGeminiClient)",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout_sec) as cli:
                resp = await cli.post(
                    f"{self.base_url}/v1/chat/completions",
                    json=payload, headers=headers,
                )
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            return GeminiCallResult(success=False, error=f"network: {type(e).__name__}: {e}", model_used=chosen_model)

        if resp.status_code != 200:
            return GeminiCallResult(
                success=False,
                error=f"HTTP {resp.status_code}: {resp.text[:400]}",
                model_used=chosen_model,
            )

        try:
            data = resp.json()
        except Exception as e:
            return GeminiCallResult(success=False, error=f"json decode failed: {e}", model_used=chosen_model)

        choices = data.get("choices") or []
        if not choices:
            return GeminiCallResult(success=False, error="no choices in response", model_used=chosen_model)

        msg = choices[0].get("message") or {}
        text = (msg.get("content") or "").strip()
        finish = choices[0].get("finish_reason")

        usage = data.get("usage") or {}
        ct_details = usage.get("completion_tokens_details") or {}

        if not text:
            return GeminiCallResult(
                success=False,
                error=f"empty content (finish_reason={finish})",
                model_used=chosen_model,
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
                reasoning_tokens=ct_details.get("reasoning_tokens"),
            )

        return GeminiCallResult(
            success=True,
            text=text,
            model_used=chosen_model,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            reasoning_tokens=ct_details.get("reasoning_tokens"),
        )
