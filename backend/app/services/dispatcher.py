"""
Worker 层统一分发器：根据模型名解析 provider，分别走 HOLO / Flow2API（→ ai_client）或 Grok（→ grok_client）。

埋点写入 ApiCallLog —— 调用前 record_api_call、调用后 complete_api_call。
HOLO 的 holo_task_id / cost / refunded 通过 GenerationResult 上的 _holo_task_id / _cost / _refunded 字段回填。
"""
import asyncio
import os
import subprocess
import time
from typing import Callable, Optional

from app.config import settings
from pathlib import Path

from app.services.ai_service import GenerationResult, ai_client
from app.services.cc123_video_client import _aspect_to_orientation, get_cc123_client
from app.services.dreamina_client import DreaminaClient
from app.services.grok_client import grok_client
from app.services.model_registry import resolve_provider, strip_provider_prefix, get_task_type
from app.services.call_logger import record_api_call, complete_api_call
from app.utils.logger import logger


def _extract_last_video_frame(video_path: str) -> Optional[str]:
    """Grok 视频延展：把 mp4 尾帧抠成 jpg 给 grok_client 当参考图。"""
    if not video_path or not os.path.exists(video_path):
        return None
    out_path = f"{video_path}.lastframe.jpg"
    try:
        cmd = ["ffmpeg", "-y", "-sseof", "-0.1", "-i", video_path,
               "-update", "1", "-q:v", "2", out_path]
        subprocess.run(cmd, check=True, capture_output=True)
        return out_path
    except Exception as e:
        logger.error(f"dispatcher.extract_last_video_frame failed: {e}")
        return None


def _summarize_request(prompt: str, image_paths, config_json) -> dict:
    summary = {
        "prompt": (prompt or "")[:500],
        "image_count": len(image_paths) if image_paths else 0,
    }
    if config_json:
        for k in ("aspect_ratio", "grok_mode", "isExtension", "seconds", "quality"):
            if k in config_json:
                summary[k] = config_json[k]
    return summary


async def dispatch_generate(
    model: str,
    prompt: str,
    image_paths: Optional[list[str]] = None,
    config_json: Optional[dict] = None,
    api_key: Optional[str] = None,
    max_retries: int = 3,
    progress_callback: Optional[Callable[[str], None]] = None,
    allow_fallback: bool = False,
    user_id: Optional[int] = None,
    task_id: Optional[str] = None,
    group_id: Optional[str] = None,
) -> GenerationResult:
    """worker 唯一入口：解析 provider 后分发；写日志。"""
    cfg = config_json or {}
    provider = resolve_provider(model, getattr(settings, "AI_PROVIDER", "holo") or "holo")
    task_type = get_task_type(model)

    # 调用前埋点
    log_id = record_api_call(
        user_id=user_id,
        task_id=task_id,
        group_id=group_id,
        provider=provider,
        model=model,
        task_type=task_type,
        request_summary=_summarize_request(prompt, image_paths, cfg),
    )
    t0 = time.monotonic()

    try:
        if provider == "grok":
            result = await _run_grok(
                model=model, prompt=prompt,
                image_paths=image_paths, config_json=cfg,
                api_key=api_key, max_retries=max_retries,
                progress_callback=progress_callback,
            )
        elif provider == "cc123":
            result = await _run_cc123(
                model=model, prompt=prompt,
                image_paths=image_paths, config_json=cfg,
                progress_callback=progress_callback,
            )
        elif provider == "dreamina":
            result = await _run_dreamina(
                model=model, prompt=prompt,
                image_paths=image_paths, config_json=cfg,
                progress_callback=progress_callback,
            )
        else:
            # HOLO 或 Flow2API：走 AIClient（内部按模型名再分发）
            result = await ai_client.generate_with_retry(
                model=model, prompt=prompt,
                image_paths=image_paths,
                max_retries=max_retries,
                progress_callback=progress_callback,
                api_key=api_key,
                allow_fallback=allow_fallback,
            )
    except Exception as e:
        latency_ms = int((time.monotonic() - t0) * 1000)
        complete_api_call(log_id, status="failed", latency_ms=latency_ms, error_msg=str(e))
        raise

    latency_ms = int((time.monotonic() - t0) * 1000)
    if result and result.success:
        complete_api_call(
            log_id,
            status="completed",
            cost=getattr(result, "_cost", None),
            holo_task_id=getattr(result, "_holo_task_id", None),
            refunded=bool(getattr(result, "_refunded", False)),
            latency_ms=latency_ms,
        )
    else:
        complete_api_call(
            log_id,
            status="failed",
            cost=getattr(result, "_cost", None),
            holo_task_id=getattr(result, "_holo_task_id", None),
            refunded=bool(getattr(result, "_refunded", False)),
            latency_ms=latency_ms,
            error_msg=getattr(result, "error", "") if result else "no result",
        )
    return result


async def _run_grok(
    model: str, prompt: str,
    image_paths: Optional[list[str]],
    config_json: dict,
    api_key: Optional[str],
    max_retries: int,
    progress_callback: Optional[Callable[[str], None]],
) -> GenerationResult:
    """Grok 自带重试循环 + 视频延展尾帧预处理。"""
    actual_retries = max_retries if max_retries > 0 else 3
    last_err = ""
    result: GenerationResult = GenerationResult()

    # 视频延展场景：input 是上一段 mp4，需要抠尾帧给 grok 当参考图
    img_path_for_grok = image_paths[0] if image_paths else None
    cleanup_path = None
    if config_json.get("isExtension") and img_path_for_grok and img_path_for_grok.endswith(".mp4"):
        if progress_callback:
            await progress_callback("正在提取视频尾帧作为环境参考...")
        last_frame_path = _extract_last_video_frame(img_path_for_grok)
        if last_frame_path:
            img_path_for_grok = last_frame_path
            cleanup_path = last_frame_path

    try:
        for attempt in range(actual_retries + 1):
            if attempt > 0 and progress_callback:
                await progress_callback(f"[重试 {attempt}/{actual_retries}] 正在重新排队提交...")
            try:
                result = await grok_client.generate(
                    model=model,
                    prompt=prompt,
                    config_json=config_json,
                    input_image_path=img_path_for_grok,
                    input_image_paths=[img_path_for_grok] if img_path_for_grok else None,
                    api_key=api_key,
                    progress_callback=progress_callback,
                )
                if result.success:
                    return result
                last_err = str(result.error)
                logger.warning(f"Grok dispatcher attempt {attempt+1} failed: {last_err}")
            except Exception as e:
                last_err = str(e)
                logger.warning(f"Grok dispatcher attempt {attempt+1} raised: {last_err}")

            if attempt < actual_retries:
                await asyncio.sleep(2 ** attempt)

        if not result.success:
            result.error = f"Max retries ({actual_retries}) reached. Last error: {last_err}"
        return result
    finally:
        if cleanup_path:
            try:
                os.remove(cleanup_path)
            except Exception:
                pass


async def _run_cc123(
    model: str, prompt: str,
    image_paths: Optional[list[str]],
    config_json: dict,
    progress_callback: Optional[Callable[[str], None]],
) -> GenerationResult:
    """cc123.ai relay 视频生成路径（POST /v1/video/generations JSON）。

    model 形如 "cc123/sd-2" / "cc123/sd-2-vip" / "cc123/sora-2" → strip 前缀后透传。
    cc123 当前 schema 不支持 i2v 输入图（暂未明示 image_url 字段），全走 t2v。
    """
    result = GenerationResult()
    client = get_cc123_client()
    if client is None:
        result.success = False
        result.error = "CC123_API_KEY 未配置"
        return result

    cc123_model = strip_provider_prefix(model)

    aspect = config_json.get("aspect_ratio") or "9:16"
    orientation = _aspect_to_orientation(aspect)
    duration = int(config_json.get("seconds") or config_json.get("duration") or 15)
    # cc123 sd-2 / sd-2-vip 当前固定 15s（其他时长上游开通后再放开）
    if cc123_model.startswith("sd-2"):
        if duration != 15:
            logger.info(f"cc123 {cc123_model}: forcing duration {duration}s → 15s (locked)")
        duration = 15
    size = config_json.get("size") or "large"
    watermark = bool(config_json.get("watermark", False))

    if progress_callback:
        await progress_callback(f"提交 cc123 {cc123_model} {orientation} {duration}s...")

    cc_result = await client.submit_and_wait(
        model=cc123_model,
        prompt=prompt,
        duration=duration,
        orientation=orientation,
        size=size,
        watermark=watermark,
        max_wait_sec=int(config_json.get("max_wait_sec", 1800)),
        poll_interval=int(config_json.get("poll_interval", 10)),
    )

    if not cc_result.success:
        result.success = False
        result.error = cc_result.error or "cc123 调用失败"
        return result

    # 跟 HOLO/Grok 流式下载约定保持一致
    result.success = True
    result.output_file_path = cc_result.local_video_path or ""
    return result


async def _run_dreamina(
    model: str, prompt: str,
    image_paths: Optional[list[str]],
    config_json: dict,
    progress_callback: Optional[Callable[[str], None]],
) -> GenerationResult:
    """Dreamina CLI 路径（subprocess + 轮询）。

    model 形如 dreamina/<sub-spec>：
      t2i-5.0 / t2i-4.6     → text2image（含 model_version 子档）
      i2i-default           → image2image（用上传的图）
      t2v-default           → text2video
      seedance2.0fast 等    → image2video（i2v）

    所有子命令通过 dreamina_client.DreaminaClient 包装的 subprocess 调用，
    跑在 asyncio.to_thread 里避免阻塞 event loop。
    """
    result = GenerationResult()
    client = DreaminaClient()

    # 提前检查登录态
    if not await asyncio.to_thread(client.is_logged_in):
        result.success = False
        result.error = "Dreamina CLI 未登录 — SSH 进 worker 容器跑 `dreamina login` 一次扫码授权"
        return result

    raw = strip_provider_prefix(model)  # e.g. "t2i-5.0" / "seedance2.0fast"

    if progress_callback:
        await progress_callback(f"提交 dreamina {raw}...")

    # 子命令分发
    if raw.startswith("t2i-"):
        model_version = raw.split("-", 1)[1]  # "5.0" / "4.6" 等
        ratio = config_json.get("aspect_ratio") or "1:1"
        # 前端 resolution 字段: standard / 2k / 4k → dreamina: 1k / 2k / 4k
        res_in = (config_json.get("resolution") or "1k").lower()
        resolution_type = "1k" if res_in in ("standard", "1k", "") else res_in
        dr = await asyncio.to_thread(
            client.text2image,
            prompt=prompt,
            model_version=model_version,
            ratio=ratio,
            resolution_type=resolution_type,
        )
        if dr.success:
            result.success = True
            result.output_file_path = dr.local_image_path or ""
        else:
            result.success = False
            result.error = dr.fail_reason or "dreamina text2image 失败"
        return result

    if raw.startswith("i2i-"):
        img = (image_paths or [None])[0]
        if not img:
            result.success = False
            result.error = "i2i 需要输入图"
            return result
        # 路径转绝对（worker 工作目录 /app）
        if not os.path.isabs(img):
            img = str(Path("/app") / img)
        if not os.path.exists(img):
            result.success = False
            result.error = f"输入图文件不存在: {img}"
            return result
        dr = await asyncio.to_thread(
            client.image2image,
            image_path=img,
            prompt=prompt,
        )
        if dr.success:
            result.success = True
            result.output_file_path = dr.local_image_path or ""
        else:
            result.success = False
            result.error = dr.fail_reason or "dreamina image2image 失败"
        return result

    if raw.startswith("t2v-"):
        dr = await asyncio.to_thread(
            client.text2video,
            prompt=prompt,
        )
        if dr.success:
            result.success = True
            result.output_file_path = dr.local_video_path or ""
        else:
            result.success = False
            result.error = dr.fail_reason or "dreamina text2video 失败"
        return result

    # seedance2.0 / seedance2.0fast / *_vip → image2video
    img = (image_paths or [None])[0]
    if not img:
        result.success = False
        result.error = "seedance i2v 需要输入图"
        return result
    if not os.path.isabs(img):
        img = str(Path("/app") / img)
    if not os.path.exists(img):
        result.success = False
        result.error = f"输入图文件不存在: {img}"
        return result

    duration = int(config_json.get("seconds") or config_json.get("duration") or 15)
    video_resolution = config_json.get("video_resolution") or "720p"
    # 非 VIP 不支持 1080p，guard
    if video_resolution != "720p" and "vip" not in raw:
        logger.info(f"dreamina i2v: forcing video_resolution {video_resolution} → 720p (model {raw} not vip)")
        video_resolution = "720p"

    dr = await asyncio.to_thread(
        client.image2video,
        image_path=img,
        prompt=prompt,
        model_version=raw,
        duration=duration,
        video_resolution=video_resolution,
    )
    if dr.success:
        result.success = True
        result.output_file_path = dr.local_video_path or ""
    else:
        result.success = False
        result.error = dr.fail_reason or "dreamina image2video 失败"
    return result
