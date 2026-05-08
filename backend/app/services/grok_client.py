"""
Grok2API 专用客户端。

基于官方文档: https://blog.cheny.me/blog/posts/grok2api

生图 (T2I):    POST /v1/images/generations  — JSON body
图生图 (I2I):  POST /v1/images/edits        — multipart/form-data
视频 (T2V):    POST /v1/videos              — JSON body
图生视频(I2V): POST /v1/videos              — JSON body + image_reference (data URI)
              GET  /v1/videos/{id}          — 轮询状态
              GET  /v1/videos/{id}/content  — 下载 mp4
"""
import asyncio
import base64
import os

import httpx

from app.config import settings
from app.services.ai_service import GenerationResult, get_mime_type, image_to_base64_sync, stream_download_to_file
from app.utils.logger import logger
from app.utils.scheduler import wait_for_api_slot

# grok2api 源码 registry.py 中注册的模型名，直接透传
# grok-imagine-image       — 标准生图
# grok-imagine-image-lite   — 快速生图
# grok-imagine-image-pro    — 高质量生图
# grok-imagine-image-edit   — 图像编辑
# grok-imagine-video        — 视频生成

_ASPECT_TO_SIZE: dict[str, str] = {
    "9:16":  "720x1280",
    "16:9":  "1280x720",
    "1:1":   "1024x1024",
}

_VIDEO_TIMEOUT_S = 300
_POLL_INTERVALS = [5, 10, 15, 20, 30]


def _resolve_model(model: str) -> str:
    return model


def _size_from_ratio(aspect_ratio: str) -> str:
    return _ASPECT_TO_SIZE.get(aspect_ratio, "720x1280")


def _auth_headers(api_key: str | None = None) -> dict:
    key = api_key or settings.GROK_API_KEY
    return {"Authorization": f"Bearer {key}"}


class GrokClient:
    def __init__(self):
        self.base_url = settings.GROK_API_URL.rstrip("/")

    # ------------------------------------------------------------------
    # 文生图 T2I — POST /v1/images/generations  (JSON body)
    # ------------------------------------------------------------------
    async def generate_image(
        self,
        model: str,
        prompt: str,
        aspect_ratio: str = "9:16",
        api_key: str | None = None,
        progress_callback=None,
    ) -> GenerationResult:
        url = f"{self.base_url}/v1/images/generations"
        payload = {
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": _size_from_ratio(aspect_ratio),
            "response_format": "url",
        }

        if progress_callback:
            await progress_callback("正在排队等待 Grok 接口可用...")
        try:
            await wait_for_api_slot(api_type="grok", interval_base=1)
        except Exception as e:
            logger.warning(f"Grok rate limiter failed: {e}")

        if progress_callback:
            await progress_callback(f"正在向 Grok 发送生图请求 (model={model})...")

        try:
            headers = {**_auth_headers(api_key), "Content-Type": "application/json"}
            async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=30.0)) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    return GenerationResult(success=False, error=f"HTTP {resp.status_code}: {resp.text}")

                data = resp.json()
                items = data.get("data", [])
                if not items:
                    return GenerationResult(success=False, error="Grok 生图未返回任何数据")

                img_url = items[0].get("url", "")
                if not img_url:
                    b64 = items[0].get("b64_json", "")
                    if b64:
                        raw = base64.b64decode(b64)
                        return GenerationResult(success=True, media_type="image", data=raw, mime_type="image/png", file_ext=".png")
                    return GenerationResult(success=False, error="Grok 生图响应中无 url 或 b64_json")

                if progress_callback:
                    await progress_callback("图片生成完毕，正在下载...")

                # 流式下载（图片虽小，但保持统一架构 + 异常时清理 partial）
                # 默认 .png — 如果下游嗅探需要精确 MIME，从前 4 字节读
                # 但 Grok 图片返回的几乎都是 PNG 或 JPG；先按 PNG 落盘
                try:
                    filepath = await stream_download_to_file(
                        client, img_url, ".png",
                        timeout=httpx.Timeout(120.0),
                        min_bytes=100,
                    )
                except Exception as e:
                    return GenerationResult(success=False, error=f"下载图片失败: {e}")

                # MIME 嗅探：读前 4 字节看是 PNG 还是 JPG，必要时改扩展名
                with open(filepath, "rb") as f:
                    head = f.read(4)
                if head.startswith(b"\xff\xd8"):
                    mime, ext = "image/jpeg", ".jpg"
                    new_filepath = filepath[:-4] + ".jpg"
                    os.rename(filepath, new_filepath)
                    filepath = new_filepath
                else:
                    mime, ext = "image/png", ".png"

                return GenerationResult(
                    success=True, media_type="image",
                    output_file_path=filepath,
                    mime_type=mime, file_ext=ext,
                )

        except Exception as e:
            logger.error(f"GrokClient.generate_image failed: {e}")
            return GenerationResult(success=False, error=str(e))

    # ------------------------------------------------------------------
    # 图生图 I2I — POST /v1/images/edits  (multipart/form-data)
    # ------------------------------------------------------------------
    async def generate_image_edit(
        self,
        model: str,
        prompt: str,
        input_image_paths: list[str],
        size: str = "1024x1024",
        api_key: str | None = None,
        progress_callback=None,
    ) -> GenerationResult:
        url = f"{self.base_url}/v1/images/edits"
        if progress_callback:
            await progress_callback("正在排队等待 Grok 接口可用...")
        try:
            await wait_for_api_slot(api_type="grok", interval_base=1)
        except Exception as e:
            logger.warning(f"Grok rate limiter failed: {e}")

        if progress_callback:
            await progress_callback(f"正在向 Grok 发送图像编辑请求 (model={model})...")

        # 读取参考图文件列表并转换为 WEBP 以绕过 CF 检测
        file_tuples = []
        for img_path in input_image_paths:
            if not os.path.exists(img_path):
                logger.warning(f"GrokClient I2I: image not found: {img_path}")
                continue
            try:
                from PIL import Image
                import io
                
                def _convert_to_webp(p):
                    img = Image.open(p)
                    if img.mode in ("RGBA", "P", "LA"):
                        # 对于带有透明通道的，WEBP 支持，可以直接转 RGBA
                        img = img.convert("RGBA")
                    else:
                        img = img.convert("RGB")
                    buf = io.BytesIO()
                    img.save(buf, format="WEBP", quality=90)
                    return buf.getvalue()
                    
                raw_img = await asyncio.to_thread(_convert_to_webp, img_path)
                mime = "image/webp"
                filename = os.path.basename(img_path) + ".webp"
                file_tuples.append(("image[]", (filename, raw_img, mime)))
            except Exception as e:
                logger.warning(f"GrokClient I2I: failed to format {img_path} to WEBP: {e}")

        if not file_tuples:
            return GenerationResult(success=False, error="图生图：未能读取任何参考图文件")

        form_data = {
            "model": model,
            "prompt": prompt,
            "n": "1",
            "size": size,
            "response_format": "url",
        }

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=30.0)) as client:
                resp = await client.post(
                    url,
                    data=form_data,
                    files=file_tuples,
                    headers=_auth_headers(api_key),
                )
                if resp.status_code != 200:
                    return GenerationResult(success=False, error=f"HTTP {resp.status_code}: {resp.text}")

                data = resp.json()
                items = data.get("data", [])
                if not items:
                    return GenerationResult(success=False, error="Grok 图像编辑未返回任何数据")

                img_url = items[0].get("url", "")
                if not img_url:
                    b64 = items[0].get("b64_json", "")
                    if b64:
                        raw = base64.b64decode(b64)
                        return GenerationResult(success=True, media_type="image", data=raw, mime_type="image/png", file_ext=".png")
                    return GenerationResult(success=False, error="Grok 图像编辑响应中无 url 或 b64_json")

                if progress_callback:
                    await progress_callback("图像编辑完毕，正在下载...")

                # 流式下载到 outputs/<uuid>.png；MIME 嗅探后必要时改后缀
                try:
                    filepath = await stream_download_to_file(
                        client, img_url, ".png",
                        timeout=httpx.Timeout(120.0),
                        min_bytes=100,
                    )
                except Exception as e:
                    return GenerationResult(success=False, error=f"下载编辑图失败: {e}")

                with open(filepath, "rb") as f:
                    head = f.read(4)
                if head.startswith(b"\xff\xd8"):
                    mime, ext = "image/jpeg", ".jpg"
                    new_filepath = filepath[:-4] + ".jpg"
                    os.rename(filepath, new_filepath)
                    filepath = new_filepath
                else:
                    mime, ext = "image/png", ".png"
                return GenerationResult(
                    success=True, media_type="image",
                    output_file_path=filepath,
                    mime_type=mime, file_ext=ext,
                )

        except Exception as e:
            logger.error(f"GrokClient.generate_image_edit failed: {e}")
            return GenerationResult(success=False, error=str(e))

    # ------------------------------------------------------------------
    # 视频生成 T2V / I2V — POST /v1/videos  (JSON body)
    # ------------------------------------------------------------------
    async def generate_video(
        self,
        prompt: str,
        aspect_ratio: str = "9:16",
        seconds: int = 6,
        quality: str = "high",
        input_image_path: str | None = None,
        api_key: str | None = None,
        progress_callback=None,
    ) -> GenerationResult:
        create_url = f"{self.base_url}/v1/videos"
        size = _size_from_ratio(aspect_ratio)

        # form-data 字段（必须是字符串）
        form_data: dict[str, str] = {
            "model": "grok-imagine-video",
            "prompt": prompt,
            "seconds": str(seconds),
            "size": size,
            "quality": quality,
        }

        # 图生视频：input_reference 作为上传文件，强制转 WEBP
        file_tuples = []
        if input_image_path and os.path.exists(input_image_path):
            try:
                from PIL import Image
                import io
                
                def _convert_to_webp(p):
                    img = Image.open(p)
                    if img.mode in ("RGBA", "P", "LA"):
                        img = img.convert("RGBA")
                    else:
                        img = img.convert("RGB")
                    buf = io.BytesIO()
                    img.save(buf, format="WEBP", quality=90)
                    return buf.getvalue()
                    
                raw_img = await asyncio.to_thread(_convert_to_webp, input_image_path)
                mime = "image/webp"
                filename = os.path.basename(input_image_path) + ".webp"
                file_tuples.append(("input_reference", (filename, raw_img, mime)))
                if progress_callback:
                    await progress_callback("参考图已格式化为 WEBP，正在穿透检测提交视频任务...")
            except Exception as e:
                logger.warning(f"GrokClient I2V: failed to format input image {input_image_path} to WEBP: {e}")

        if progress_callback:
            await progress_callback("正在排队等待 Grok 接口可用...")
        try:
            await wait_for_api_slot(api_type="grok", interval_base=1)
        except Exception as e:
            logger.warning(f"Grok rate limiter failed: {e}")

        if progress_callback:
            await progress_callback("正在向 Grok 提交视频生成任务...")

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(_VIDEO_TIMEOUT_S, connect=30.0)) as client:
                if file_tuples:
                    resp = await client.post(create_url, data=form_data, files=file_tuples, headers=_auth_headers(api_key))
                else:
                    resp = await client.post(create_url, data=form_data, headers=_auth_headers(api_key))

                if resp.status_code not in (200, 201, 202):
                    return GenerationResult(success=False, error=f"创建视频任务失败 HTTP {resp.status_code}: {resp.text}")

                job = resp.json()
                video_id = job.get("id")
                if not video_id:
                    return GenerationResult(success=False, error=f"Grok 未返回 video_id: {job}")

                logger.info(f"GrokClient: video job created id={video_id}")

                # 轮询状态
                poll_url = f"{self.base_url}/v1/videos/{video_id}"
                content_url = f"{self.base_url}/v1/videos/{video_id}/content"
                elapsed = 0
                poll_idx = 0

                while elapsed < _VIDEO_TIMEOUT_S:
                    interval = _POLL_INTERVALS[min(poll_idx, len(_POLL_INTERVALS) - 1)]
                    await asyncio.sleep(interval)
                    elapsed += interval
                    poll_idx += 1

                    poll_resp = await client.get(poll_url, headers=_auth_headers(api_key))
                    if poll_resp.status_code != 200:
                        logger.warning(f"GrokClient: poll HTTP {poll_resp.status_code} for {video_id}")
                        continue

                    status_data = poll_resp.json()
                    status = status_data.get("status", "")

                    if progress_callback:
                        await progress_callback(f"Grok 视频生成中 ({elapsed}s / {_VIDEO_TIMEOUT_S}s)...")

                    if status in ("succeeded", "completed"):
                        if progress_callback:
                            await progress_callback("视频生成完毕，正在下载...")

                        # 流式下载 mp4 到 outputs/<uuid>.mp4，峰值内存 ~64KB
                        # 优先 /content 接口；失败回退 status_data.url
                        for source_url, label in [(content_url, "/content"), (status_data.get("url", ""), "url")]:
                            if not source_url:
                                continue
                            try:
                                filepath = await stream_download_to_file(
                                    client, source_url, ".mp4",
                                    headers=_auth_headers(api_key),
                                    timeout=httpx.Timeout(300.0),
                                    min_bytes=1000,
                                )
                                return GenerationResult(
                                    success=True, media_type="video",
                                    output_file_path=filepath,
                                    mime_type="video/mp4", file_ext=".mp4",
                                )
                            except Exception as e:
                                logger.warning(f"GrokClient: {label} stream download failed: {e}")

                        return GenerationResult(success=False, error="Grok 视频完成但下载失败")

                    if status == "failed":
                        err = status_data.get("error") or status_data.get("message") or "未知错误"
                        return GenerationResult(success=False, error=f"Grok 视频生成失败: {err}")

                    logger.info(f"GrokClient: video {video_id} poll response: {status_data}")

                return GenerationResult(success=False, error=f"Grok 视频生成超时 (>{_VIDEO_TIMEOUT_S}s)")

        except Exception as e:
            logger.error(f"GrokClient.generate_video failed: {e}")
            return GenerationResult(success=False, error=str(e))

    # ------------------------------------------------------------------
    # 统一入口（供 tasks.py 调用）
    # ------------------------------------------------------------------
    async def generate(
        self,
        model: str,
        prompt: str,
        config_json: dict,
        input_image_path: str | None = None,
        input_image_paths: list[str] | None = None,
        api_key: str | None = None,
        progress_callback=None,
    ) -> GenerationResult:
        grok_mode = config_json.get("grok_mode", "image")
        aspect_ratio = config_json.get("aspect_ratio", "9:16")
        
        # 延展模式本质是 I2V，强制覆盖
        if config_json.get("isExtension"):
            grok_mode = "i2v"

        if grok_mode == "image_edit":
            paths = input_image_paths or ([input_image_path] if input_image_path else [])
            # grok_size 直接由前端传入（如 '1280x720'），优先于 aspect_ratio 推导
            grok_size = config_json.get("grok_size") or _size_from_ratio(aspect_ratio)
            return await self.generate_image_edit(
                model=model,
                prompt=prompt,
                input_image_paths=paths,
                size=grok_size,
                api_key=api_key,
                progress_callback=progress_callback,
            )
        elif grok_mode == "image":
            return await self.generate_image(
                model=model,
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                api_key=api_key,
                progress_callback=progress_callback,
            )
        else:
            # t2v / i2v
            seconds = int(config_json.get("seconds", 6))
            quality = config_json.get("quality", "high")
            img_path = input_image_path if grok_mode == "i2v" else None
            return await self.generate_video(
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                seconds=seconds,
                quality=quality,
                input_image_path=img_path,
                api_key=api_key,
                progress_callback=progress_callback,
            )


# 全局单例
grok_client = GrokClient()
