import asyncio
import base64
import json
import logging
import os
import re
import subprocess
import tempfile
import uuid as _uuid
from typing import Optional, Callable

import httpx
from app.config import settings

from app.utils.logger import logger


async def stream_download_to_file(
    client: httpx.AsyncClient,
    url: str,
    ext: str,
    headers: dict | None = None,
    timeout: httpx.Timeout | None = None,
    min_bytes: int = 100,
) -> str:
    """流式下载到 outputs/<uuid>.<ext>，返回 filepath。

    全程 chunk-by-chunk 写盘，峰值内存仅 64KB，避免 50-100MB 视频整段进内存。
    异常或下载过小时清理 partial 文件并 re-raise。

    Args:
        client: 调用方传入的 httpx.AsyncClient（已是 per-task 自管 lifecycle）
        url: 下载地址
        ext: 扩展名（含或不含 . 都行）
        headers: 可选请求头（如鉴权 Bearer）
        timeout: 可选超时（默认 400s read / 60s connect）
        min_bytes: 下载字节小于此值视为失败（默认 100 字节防空文件）

    Returns:
        outputs/<uuid>.<ext> 的相对路径
    Raises:
        httpx.* 网络异常 / RuntimeError("HTTP {status}") / RuntimeError("too small")
    """
    if not ext.startswith("."):
        ext = "." + ext
    ext = ext.lower()
    timeout = timeout or httpx.Timeout(400.0, connect=60.0, read=400.0)

    output_filename = f"{_uuid.uuid4().hex}{ext}"
    output_filepath = os.path.join("outputs", output_filename)
    os.makedirs("outputs", exist_ok=True)

    bytes_written = 0
    try:
        async with client.stream(
            "GET", url, headers=headers or {}, timeout=timeout, follow_redirects=True
        ) as dl:
            if dl.status_code != 200:
                raise RuntimeError(f"HTTP {dl.status_code}")
            with open(output_filepath, "wb") as f:
                async for chunk in dl.aiter_bytes(chunk_size=64 * 1024):
                    f.write(chunk)
                    bytes_written += len(chunk)
        if bytes_written < min_bytes:
            raise RuntimeError(f"downloaded too small ({bytes_written} bytes)")
        return output_filepath
    except Exception:
        # 清掉 partial 文件
        try:
            if os.path.exists(output_filepath):
                os.remove(output_filepath)
        except Exception:
            pass
        raise

class GenerationResult:
    def __init__(self, success: bool=False, media_type: str="", data: bytes=b"", mime_type: str="", error: str="", file_ext: str="", output_file_path: str=""):
        self.success = success
        self.media_type = media_type
        # data 是历史字段：caller 自己写盘。新代码（HOLO 流式下载）直接落盘 outputs/<uuid>.<ext>
        # 然后 set output_file_path，data 留空避免 50MB 视频在内存里占着。
        self.data = data
        self.mime_type = mime_type
        self.error = error
        self.file_ext = file_ext
        self.output_file_path = output_file_path  # 优先于 data；caller 检查这个字段决定是否还需自己写盘

# 老 Flow2API 时代的视频模型别名 → HOLO 真实模型名
# 映射策略：_ultra_relaxed → Lite 档（最便宜 720p），_ultra/_ultra_fl → Fast 档（中等 720p）
LEGACY_MODEL_ALIASES = {
    # T2V
    "veo_3_1_t2v_fast_ultra":                    "veo_3_1_t2v_fast_landscape",
    "veo_3_1_t2v_fast_portrait_ultra":           "veo_3_1_t2v_fast_portrait",
    "veo_3_1_t2v_fast_ultra_relaxed":            "veo_3_1_t2v_lite_landscape",
    "veo_3_1_t2v_fast_portrait_ultra_relaxed":   "veo_3_1_t2v_lite_portrait",
    # I2V（旧名前缀 i2v_s_fast 在 HOLO 没有，根据后缀映射档位）
    "veo_3_1_i2v_s_fast_ultra_fl":               "veo_3_1_i2v_fast_landscape",
    "veo_3_1_i2v_s_fast_portrait_ultra_fl":      "veo_3_1_i2v_fast_portrait",
    "veo_3_1_i2v_s_fast_ultra_relaxed":          "veo_3_1_i2v_lite_landscape",
    "veo_3_1_i2v_s_fast_portrait_ultra_relaxed": "veo_3_1_i2v_lite_portrait",
    # R2V
    "veo_3_1_r2v_fast_ultra":                    "veo_3_1_r2v_fast_landscape",
    "veo_3_1_r2v_fast_portrait_ultra":           "veo_3_1_r2v_fast_portrait",
    "veo_3_1_r2v_fast_ultra_relaxed":            "veo_3_1_r2v_lite_landscape",
    "veo_3_1_r2v_fast_portrait_ultra_relaxed":   "veo_3_1_r2v_lite_portrait",
}


def normalize_holo_model(model: str) -> str:
    """老别名透明翻译为 HOLO 真名；未命中则原样返回。"""
    if model in LEGACY_MODEL_ALIASES:
        new = LEGACY_MODEL_ALIASES[model]
        logger.info(f"Model alias: {model} → {new}")
        return new
    return model


def get_mime_type(image_path: str) -> str:
    ext = os.path.splitext(image_path)[1].lower()
    mime_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    }
    return mime_map.get(ext, "image/jpeg")

def image_to_base64_sync(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def extract_last_frame_base64_sync(video_path: str) -> str:
    """提取视频尾帧并返回 base64 图像，用于视频延长接力"""
    try:
        cmd_fps = [
            'ffprobe', '-v', 'error', '-select_streams', 'v:0', 
            '-show_entries', 'stream=nb_frames', 
            '-of', 'default=noprint_wrappers=1:nokey=1', video_path
        ]
        output = subprocess.check_output(cmd_fps, stderr=subprocess.STDOUT).decode('utf-8').strip().split('\n')
        total_frames = int(output[0]) if output and output[0].isdigit() else 1
        
        target_frame = max(0, total_frames - 1)
        
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_name = tmp.name
            
        try:
            # 使用 -sseof -0.1 直接定位到视频末尾取最后一帧，速度快且兼容性好
            cmd_extract = [
                'ffmpeg', '-y', '-sseof', '-0.1', '-i', video_path, 
                '-vframes', '1', '-q:v', '2', tmp_name
            ]
            subprocess.check_call(cmd_extract, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            with open(tmp_name, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
        finally:
            if os.path.exists(tmp_name):
                os.remove(tmp_name)
    except Exception as e:
        logger.error(f"Failed to extract last frame from {video_path}: {e}")
        raise ValueError(f"无法提取视频尾帧: {e}")

def _holo_url() -> str:
    return (settings.HOLO_API_URL or settings.AI_API_URL or "").rstrip("/")

def _holo_key() -> str:
    return settings.HOLO_API_KEY or settings.AI_API_KEY or ""

def _flow2api_url() -> str:
    return (settings.FLOW2API_URL or settings.AI_API_URL or "").rstrip("/")

def _flow2api_key() -> str:
    return settings.FLOW2API_KEY or settings.AI_API_KEY or ""


class AIClient:
    def __init__(self):
        # 老 self.api_key 留兼容（未传 api_key 时 _generate_holo/_flow2api 用各自 helper）。
        self.api_key = settings.AI_API_KEY
        # ⚠ 不再缓存共享 httpx pool — celery threads 池下多 thread 各有自己的 loop，
        # 共享 self._http_pool 会触发 race condition：A thread 的 client 被 B thread
        # 的 "loop drift" 检测 aclose 掉，导致 "Cannot send a request" 报错。
        # 现状：每个 _generate_* 调用 async with 自管 lifecycle（per-task 独立 client）。

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def _build_messages(self, prompt: str, image_paths: list[str] | None = None) -> list[dict]:
        if not image_paths:
            return [{"role": "user", "content": prompt}]

        content_parts: list[dict] = [{"type": "text", "text": prompt}]
        for img_path in image_paths:
            try:
                if img_path.lower().endswith(".mp4"):
                    mime = "image/jpeg"
                    b64 = await asyncio.to_thread(extract_last_frame_base64_sync, img_path)
                else:
                    mime = get_mime_type(img_path)
                    b64 = await asyncio.to_thread(image_to_base64_sync, img_path)
                    
                content_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                })
            except Exception as e:
                logger.error(f"Error loading image {img_path}: {e}")
                
        return [{"role": "user", "content": content_parts}]

    async def _detect_file_type(self, result: GenerationResult, is_video: bool) -> GenerationResult:
        data = result.data
        if not data or len(data) < 4:
            return result

        if data.startswith(b"\x89PNG"):
            result.mime_type, result.file_ext, result.media_type = "image/png", ".png", "image"
        elif data.startswith(b"\xff\xd8"):
            result.mime_type, result.file_ext, result.media_type = "image/jpeg", ".jpg", "image"
        elif data.startswith(b"RIFF") and len(data) > 11 and data[8:12] == b"WEBP":
            result.mime_type, result.file_ext, result.media_type = "image/webp", ".webp", "image"
        elif b"ftyp" in data[:32]:
            result.mime_type, result.file_ext, result.media_type = "video/mp4", ".mp4", "video"
        else:
            if is_video:
                result.media_type, result.mime_type, result.file_ext = "video", "video/mp4", ".mp4"
            else:
                result.media_type, result.mime_type, result.file_ext = "image", "image/png", ".png"
        return result

    async def generate_with_retry(
        self, model: str, prompt: str, image_paths: list[str] = None, max_retries: int = 3,
        progress_callback: Callable[[str], None] = None,
        api_key: str = None, allow_fallback: bool = False
    ) -> GenerationResult:
        """带重试机制的生成接口"""
        last_error = ""
        actual_retries = max_retries if max_retries > 0 else 3
        for attempt in range(actual_retries + 1):
            current_model = model

            try:
                if progress_callback:
                    if attempt > 0:
                        await progress_callback(f"[重试 {attempt}/{actual_retries}] 正在重新提交...")
                    else:
                        await progress_callback("正在准备发送请求...")
                        
                result = await self.generate(current_model, prompt, image_paths, progress_callback, api_key=api_key)
                if result.success:
                    return result

                # HOLO 已自动退款的终态（content policy / cancelled），不再重试以免无意义烧配额
                if getattr(result, "_terminal", False):
                    logger.info(f"Generation terminal (refunded), skip retries: {result.error}")
                    return result

                error_str = str(result.error)
                last_error = error_str
                logger.warning(f"Generation attempt {attempt + 1} failed: {error_str}")

            except Exception as e:
                last_error = str(e)
                logger.warning(f"Generation attempt {attempt + 1} raised error: {last_error}")
            
            if attempt < actual_retries:
                # 指数级退避等待重试
                await asyncio.sleep(2 ** attempt)

        # 最终失败
        res = GenerationResult()
        res.error = f"Max retries ({actual_retries}) reached. Last error: {last_error}"
        return res

    async def generate(self, model: str, prompt: str, image_paths: list[str] | None = None, progress_callback: Callable[[str], None] = None, api_key: str = None) -> GenerationResult:
        """统一入口；按模型名解析 provider，分发到 _generate_holo / _generate_flow2api。
        Grok 走外层 dispatcher（grok_client 需要 config_json，本类不持有），不在此处理。

        速率锁按 provider 拆桶：
          - HOLO：不强加本地速率（HOLO 上游 /v1/generate 自管 85 generators + 任务级 queued/position 排队）
          - Flow2API：每 5s 一个槽位（自托管易触验证码，需要保护）
        """
        from app.utils.scheduler import wait_for_api_slot
        from app.services.model_registry import resolve_provider

        provider = resolve_provider(model, getattr(settings, "AI_PROVIDER", "holo") or "holo")

        if provider == "flow2api":
            # Flow2API 单 slot 5s 间隔（独立 key，与 HOLO 互不影响）
            await wait_for_api_slot(api_type="flow2api", interval_base=5)
            return await self._generate_flow2api(model, prompt, image_paths, progress_callback, api_key)

        # HOLO（含未注册模型兜底）：跳过本地速率，让 worker 真并发，HOLO 上游自动排队
        return await self._generate_holo(model, prompt, image_paths, progress_callback, api_key)

    async def _generate_holo(self, model: str, prompt: str, image_paths: list[str] | None = None, progress_callback: Callable[[str], None] = None, api_key: str = None) -> GenerationResult:
        """HOLO API: 提交 → 轮询 → 下载。"""
        from app.services.model_registry import strip_provider_prefix
        result = GenerationResult()
        model = strip_provider_prefix(model)
        model = normalize_holo_model(model)
        is_video = any(k in model.lower() for k in ["veo", "t2v", "i2v", "r2v"])
        base_url = _holo_url()
        active_key = api_key if api_key else _holo_key()
        headers = {
            "Authorization": f"Bearer {active_key}",
            "Content-Type": "application/json",
        }

        # 每 task 自管 client lifecycle — 避免 threads 池下共享池被其它 thread aclose
        client = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0))
        try:
            messages = await self._build_messages(prompt, image_paths)
            payload = {"model": model, "messages": messages}

            # --- 1. SUBMIT ---
            if progress_callback:
                await progress_callback("正在提交生成任务...")
            try:
                submit_resp = await client.post(
                    f"{base_url}/v1/generate",
                    json=payload, headers=headers, timeout=60.0,
                )
            except (httpx.ReadError, httpx.ConnectError, httpx.RemoteProtocolError) as e:
                result.error = f"提交请求异常: {e}"
                return result

            if submit_resp.status_code not in (200, 202):
                body = submit_resp.text
                result.error = f"Submit HTTP {submit_resp.status_code}: {body[:300]}"
                return result

            try:
                submit_data = submit_resp.json()
            except ValueError:
                result.error = f"Submit 返回非 JSON: {submit_resp.text[:200]}"
                return result

            task_id = submit_data.get("task_id")
            if not task_id:
                result.error = f"Submit 未返回 task_id: {submit_data}"
                return result

            # 给 dispatcher 用于 ApiCallLog 回填
            result._holo_task_id = task_id
            result._cost = submit_data.get("cost")

            queue_pos = submit_data.get("position")
            if progress_callback:
                if queue_pos is not None:
                    await progress_callback(f"已排队 (位置 {queue_pos})...")
                else:
                    await progress_callback("已提交，等待处理...")

            # --- 2. POLL ---
            poll_url = f"{base_url}/v1/tasks/{task_id}"
            poll_interval = float(getattr(settings, "AI_POLL_INTERVAL", 5.0))
            max_wait = float(getattr(settings, "AI_POLL_TIMEOUT", 600))
            elapsed = 0.0
            last_status = None
            file_url = None
            file_ext_hint = None

            while elapsed < max_wait:
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
                try:
                    poll_resp = await client.get(poll_url, headers=headers, timeout=30.0)
                except (httpx.ReadError, httpx.ConnectError, httpx.RemoteProtocolError) as e:
                    logger.warning(f"Poll transient error: {e}")
                    continue

                if poll_resp.status_code == 404:
                    result.error = f"Task {task_id} 不存在或已过期"
                    return result
                if poll_resp.status_code != 200:
                    logger.warning(f"Poll HTTP {poll_resp.status_code}, retrying")
                    continue

                try:
                    body = poll_resp.json()
                except ValueError:
                    continue

                status = body.get("status")
                if status != last_status:
                    last_status = status
                    if progress_callback:
                        if status == "queued":
                            pos = body.get("position")
                            await progress_callback(f"排队中 (位置 {pos})..." if pos is not None else "排队中...")
                        elif status == "processing":
                            await progress_callback("AI 正在生成...")

                if status == "completed":
                    res_obj = body.get("result") or {}
                    file_url = res_obj.get("file_url")
                    file_ext_hint = res_obj.get("file_ext")
                    # 回填 cost / task_type（如响应里有）给 dispatcher 写日志用
                    if body.get("cost") is not None:
                        result._cost = body.get("cost")
                    if res_obj.get("type"):
                        result._task_type = res_obj.get("type")
                    break
                if status in ("failed", "cancelled"):
                    err = body.get("error") or status
                    result.error = f"Task {status}: {err}"
                    # HOLO 已自动退款，标记终态避免上层重试烧配额
                    result._terminal = True
                    result._refunded = bool(body.get("refunded", True))
                    return result
                # else queued/processing → 继续轮询
            else:
                result.error = f"轮询超时 ({max_wait}s, task_id={task_id})"
                return result

            if not file_url:
                result.error = "已 completed 但缺少 file_url"
                return result

            # --- 3. DOWNLOAD (流式下载，避免视频整段进内存导致 OOM) ---
            if progress_callback:
                await progress_callback("正在下载结果...")
            full_url = file_url if file_url.startswith("http") else f"{base_url}{file_url}"

            # 提前定下落盘扩展名（HOLO 总是返回 file_ext，无需嗅探）
            if file_ext_hint:
                ext = file_ext_hint if file_ext_hint.startswith(".") else f".{file_ext_hint}"
                ext_low = ext.lower()
            else:
                # 兜底：HOLO 偶尔不给 hint 时，按 is_video 推
                ext_low = ".mp4" if is_video else ".png"
            mime_map = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".webp": "image/webp", ".mp4": "video/mp4",
            }

            import uuid as _uuid
            output_filename = f"{_uuid.uuid4().hex}{ext_low}"
            output_filepath = os.path.join("outputs", output_filename)
            os.makedirs("outputs", exist_ok=True)

            for dl_attempt in range(3):
                bytes_written = 0
                try:
                    async with client.stream(
                        "GET", full_url, headers=headers,
                        timeout=httpx.Timeout(400.0, connect=60.0, read=400.0),
                        follow_redirects=True,
                    ) as dl:
                        if dl.status_code != 200:
                            result.error = f"下载文件失败: HTTP {dl.status_code}"
                            break
                        with open(output_filepath, "wb") as f:
                            async for chunk in dl.aiter_bytes(chunk_size=64 * 1024):
                                f.write(chunk)
                                bytes_written += len(chunk)

                    if bytes_written < 100:
                        result.error = f"下载文件过小 ({bytes_written} bytes)"
                        # 清掉过小的 partial
                        try:
                            os.remove(output_filepath)
                        except Exception:
                            pass
                        break

                    # 成功
                    result.success = True
                    result.output_file_path = output_filepath  # 关键：caller 不需要再 f.write(result.data)
                    result.data = b""  # 不在内存里存
                    result.file_ext = ext_low
                    result.mime_type = mime_map.get(ext_low, "application/octet-stream")
                    result.media_type = "video" if ext_low == ".mp4" else "image"
                    return result

                except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError) as e:
                    logger.warning(f"DL attempt {dl_attempt+1} failed: {e} (wrote {bytes_written} bytes)")
                    # 流式中断：清掉 partial 文件，重试时重新建
                    try:
                        if os.path.exists(output_filepath):
                            os.remove(output_filepath)
                    except Exception:
                        pass
                    if dl_attempt == 2:
                        result.error = f"下载文件异常: {e}"
                    await asyncio.sleep(1)
            return result

        except Exception as e:
            logger.error(f"HOLO generation failed: {e}")
            return GenerationResult(success=False, error=str(e))
        finally:
            try:
                await client.aclose()
            except Exception:
                pass

    async def _generate_flow2api(self, model: str, prompt: str, image_paths: list[str] | None = None, progress_callback: Callable[[str], None] = None, api_key: str = None) -> GenerationResult:
        """Flow2API: OpenAI 兼容流式 SSE。"""
        from app.services.model_registry import strip_provider_prefix
        model = strip_provider_prefix(model)
        base_url = _flow2api_url()
        url = f"{base_url}/v1/chat/completions"
        messages = await self._build_messages(prompt, image_paths)
        payload = {"model": model, "messages": messages, "stream": True}
        result = GenerationResult()
        is_video = any(k in model.lower() for k in ["veo", "t2v", "i2v", "r2v"])

        active_key = api_key if api_key else _flow2api_key()
        headers = {
            "Authorization": f"Bearer {active_key}",
            "Content-Type": "application/json",
        }

        # 每 task 自管 client lifecycle — 避免 threads 池下共享池被其它 thread aclose
        client = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0))
        try:
            collected_content = ""
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                if response.status_code != 200:
                    err_body = await response.aread()
                    result.error = f"HTTP {response.status_code}: {err_body.decode('utf-8', errors='replace')}"
                    return result

                async for line in response.aiter_lines():
                    if not line.startswith("data: "): continue
                    data_str = line[6:].strip()
                    if data_str == "[DONE]": break
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        logger.debug(f"Skipped non-JSON SSE chunk: {data_str[:100]}")
                        continue
                        
                    if "error" in chunk:
                        err_info = chunk["error"]
                        result.error = err_info.get("message", str(err_info)) if isinstance(err_info, dict) else str(err_info)
                        return result

                    choices = chunk.get("choices", [])
                    if choices and choices[0].get("delta", {}).get("content"):
                        collected_content += choices[0]["delta"]["content"]
                        if progress_callback:
                            lines = [ln.strip() for ln in collected_content.split('\n') if ln.strip()]
                            if lines:
                                last_line = lines[-1]
                                if "http" not in last_line and "![" not in last_line and "{" not in last_line:
                                    msg = last_line[:50]
                                    if msg:
                                        await progress_callback(msg)

            if not collected_content:
                result.error = "服务器未返回任何内容"
                return result

            try:
                err_obj = json.loads(collected_content.strip())
                if isinstance(err_obj, dict) and "error" in err_obj:
                    result.error = str(err_obj["error"])
                    return result
            except ValueError:
                pass
                
            # Parse Results
            img_match = re.search(r"!\[.*?\]\(data:(image/\w+);base64,([A-Za-z0-9+/=\s]+)\)", collected_content)
            if img_match:
                result.data = base64.b64decode(img_match.group(2).replace("\n", "").replace(" ", ""))
                result.success = True
                result.mime_type = img_match.group(1)
                result.media_type = "image"
                return await self._detect_file_type(result, is_video)

            url_match = re.search(r"(https?://[^\s\)\"\[\]]+)", collected_content)
            if url_match:
                file_url = url_match.group(1).rstrip(")'\",;")
                # 流式下载到 outputs/<uuid>.<ext>，峰值内存 ~64KB
                # 视频先按 .mp4 写盘；图片先按 .png；后面 _detect_file_type 嗅探
                tmp_ext = ".mp4" if is_video else ".png"
                last_err = ""
                for dl_attempt in range(3):
                    try:
                        if progress_callback and dl_attempt > 0:
                            await progress_callback(f"正在重试下载 ({dl_attempt}/3)...")
                        filepath = await stream_download_to_file(
                            client, file_url, tmp_ext,
                            timeout=httpx.Timeout(400.0, connect=60.0, read=400.0),
                            min_bytes=100,
                        )
                        # 嗅探前 32 字节，必要时改后缀（mp4 / png / jpg / webp）
                        with open(filepath, "rb") as f:
                            head = f.read(32)
                        new_ext = tmp_ext
                        if head.startswith(b"\x89PNG"):
                            new_ext = ".png"
                        elif head.startswith(b"\xff\xd8"):
                            new_ext = ".jpg"
                        elif head.startswith(b"RIFF") and len(head) > 11 and head[8:12] == b"WEBP":
                            new_ext = ".webp"
                        elif b"ftyp" in head[:32]:
                            new_ext = ".mp4"
                        if new_ext != tmp_ext:
                            new_filepath = filepath[:-len(tmp_ext)] + new_ext
                            os.rename(filepath, new_filepath)
                            filepath = new_filepath
                        mime_map = {".png":"image/png",".jpg":"image/jpeg",".webp":"image/webp",".mp4":"video/mp4"}
                        result.success = True
                        result.output_file_path = filepath
                        result.file_ext = new_ext
                        result.mime_type = mime_map.get(new_ext, "application/octet-stream")
                        result.media_type = "video" if new_ext == ".mp4" else "image"
                        return result
                    except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError) as e:
                        last_err = f"网络异常: {e}"
                        logger.warning(f"Download attempt {dl_attempt+1} failed for {file_url}: {e}")
                        await asyncio.sleep(1)
                    except Exception as e:
                        # 业务错误（如 404 / too small）不重试
                        result.error = f"下载文件出现异常: {e}"
                        return result
                result.error = f"下载文件异常 (多次重试失败): {last_err}"
                return result

            # 如果完全没匹配到任何媒体特征
            try:
                maybe_err = json.loads(collected_content.strip())
                if isinstance(maybe_err, dict) and "error" in maybe_err:
                    result.error = str(maybe_err["error"])
                    return result
            except (ValueError, json.JSONDecodeError):
                pass

            result.data = collected_content.encode("utf-8")
            result.error = f"无法解析生成结果格式: {collected_content[:200]}"
            return result

        except Exception as e:
            logger.error(f"Image generation failed: {e}")
            return GenerationResult(success=False, error=str(e))
        finally:
            try:
                await client.aclose()
            except Exception:
                pass

# 全局单例
ai_client = AIClient()

async def generate_fission_prompts(global_prompt: str, count: int, image_paths: list[str] = None, progress_callback: Callable[[str], None] = None) -> list[str]:
    """
    调用 LLM (支持多模态) 对模糊全局提示词进行裂变扩写
    """
    from app.prompts import (
        LLM_SYSTEM_PROMPT,
        LLM_USER_PROMPT_GLOBAL,
        LLM_USER_PROMPT_COUNT,
        LLM_USER_PROMPT_MAIN,
        LLM_REASONER_FORMAT_PROMPT
    )
    
    api_key = settings.DEEPSEEK_API_KEY
    if not api_key:
        logger.error("DEEPSEEK_API_KEY is not configured.")
        raise RuntimeError("系统未配置 DEEPSEEK_API_KEY，无法执行裂变推理")

    if progress_callback:
        await progress_callback("DeepSeek 推理引擎已启动，正在分析全局需求...")

    # 1. 组装 Prompt
    system_msg = LLM_SYSTEM_PROMPT.replace("{count}", str(count))
    user_msg_parts = [
        LLM_USER_PROMPT_GLOBAL.replace("{global_prompt}", global_prompt),
        LLM_USER_PROMPT_COUNT.replace("{count}", str(count)),
        LLM_USER_PROMPT_MAIN
    ]
    user_msg = "\n".join(user_msg_parts)

    prompt_context = "\n".join(user_msg_parts)
    messages = [{"role": "system", "content": system_msg}]
    
    # 协议能力判定：仅当模型名包含 vision/vl/gemini/gpt-4o 等关键字时才启用多模态 Image 协议
    vision_keywords = ["vision", "vl", "gemini", "gpt-4o", "claude"]
    is_vision_model = any(k in settings.DEEPSEEK_MODEL.lower() for k in vision_keywords)

    if image_paths and is_vision_model:
        # 构造多模态内容 (如用户所述：Text 居首，多 Image 紧随其后)
        content_parts: list[dict] = [{"type": "text", "text": prompt_context}]
        for img_path in image_paths:
            try:
                mime = get_mime_type(img_path)
                b64 = image_to_base64_sync(img_path)
                content_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"}
                })
            except Exception as e:
                logger.warning(f"Failed to process fission image {img_path}: {e}")
        messages.append({"role": "user", "content": content_parts})
    else:
        # 降级或默认：使用纯文本 String 格式 (针对 deepseek-chat 等)
        messages.append({"role": "user", "content": prompt_context})

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": 0.8,
        "stream": False,
        "response_format": {"type": "json_object"}
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    if progress_callback:
        await progress_callback("正在构思创意方案，注入光影与构图细节...")

    _ds_client = httpx.AsyncClient(timeout=60.0)
    retries = 2
    for attempt in range(retries):
        try:
            resp = await _ds_client.post(
                settings.DEEPSEEK_API_URL, 
                headers=headers, 
                json=payload
            )
            resp.raise_for_status()
            data = resp.json()
            
            if progress_callback:
                await progress_callback(f"正在对 {count} 个裂变变体进行文本对齐与质量校验...")

            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            prompts_list = parsed.get("prompts", [])
            
            if not prompts_list:
                continue
                
            # 补齐或截断
            if len(prompts_list) < count:
                prompts_list.extend([prompts_list[-1]] * (count - len(prompts_list)))
            elif len(prompts_list) > count:
                prompts_list = prompts_list[:count]
            
            if progress_callback:
                await progress_callback(f"创意裂变成功！已就绪 {len(prompts_list)} 组分身指令。")
                
            return prompts_list
                
        except Exception as e:
            logger.warning(f"DeepSeek generation attempt {attempt + 1} failed: {e}")
            if progress_callback:
                await progress_callback(f"尝试第 {attempt+1} 次重连推理引擎...")
            # 如果是 JSON 解析错，尝试给下一轮加上 Reasoner 强约束
            payload["messages"].append({
                "role": "user", 
                "content": LLM_REASONER_FORMAT_PROMPT
            })
            
    logger.error("All attempts to generate fission prompts failed.")
    raise RuntimeError("DeepSeek 引擎响应超时或格式错误，无法生成创意分身")


async def generate_director_scene_prompts(
    script: str,
    count: int,
    style: str = "",
    character_desc: str = "",
    product_image_paths: list[str] = None,
    progress_callback: Callable[[str], None] = None,
) -> list[dict]:
    """
    导演模式 Phase 1：调用 LLM 将剧本解析为 n 个结构化分镜描述。
    返回列表，每个元素形如：
      {"index": 1, "shot_type": "中景", "action": "...", "description": "..."}
    """
    from app.prompts import DIRECTOR_LLM_SYSTEM_PROMPT

    api_key = settings.DEEPSEEK_API_KEY
    if not api_key:
        raise RuntimeError("系统未配置 DEEPSEEK_API_KEY，无法执行导演模式剧本解析")

    if progress_callback:
        await progress_callback("导演引擎启动，正在解析剧本结构...")

    system_msg = DIRECTOR_LLM_SYSTEM_PROMPT.replace("{count}", str(count))

    user_parts = [f"【剧本内容】：\n{script}"]
    if style:
        user_parts.append(f"【全局风格设定】：{style}")
    if character_desc:
        user_parts.append(f"【人物外形描述】：{character_desc}")
    user_parts.append(f"请严格按照以上信息，生成 {count} 个连贯的分镜描述。")
    user_msg = "\n\n".join(user_parts)

    messages = [{"role": "system", "content": system_msg}]

    vision_keywords = ["vision", "vl", "gemini", "gpt-4o", "claude"]
    is_vision_model = any(k in settings.DEEPSEEK_MODEL.lower() for k in vision_keywords)

    if product_image_paths and is_vision_model:
        content_parts: list[dict] = [{"type": "text", "text": user_msg}]
        for img_path in product_image_paths:
            try:
                mime = get_mime_type(img_path)
                b64 = image_to_base64_sync(img_path)
                content_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"}
                })
            except Exception as e:
                logger.warning(f"Director: failed to load product image {img_path}: {e}")
        messages.append({"role": "user", "content": content_parts})
    else:
        messages.append({"role": "user", "content": user_msg})

    payload = {
        "model": settings.DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": 0.75,
        "stream": False,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    if progress_callback:
        await progress_callback(f"正在将剧本拆解为 {count} 个分镜指令...")

    retries = 2
    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(retries):
            try:
                resp = await client.post(settings.DEEPSEEK_API_URL, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                scenes = parsed.get("scenes", [])
                
                # 显式排序：核心修复，确保 index 对应列表物理位置
                scenes.sort(key=lambda x: x.get("index", 0))

                if not scenes:
                    raise ValueError("LLM 返回的 scenes 列表为空")

                # 补齐或截断
                if len(scenes) < count:
                    scenes.extend([scenes[-1]] * (count - len(scenes)))
                elif len(scenes) > count:
                    scenes = scenes[:count]

                if progress_callback:
                    await progress_callback(f"剧本解析完成，共 {len(scenes)} 个分镜就绪。")

                return scenes

            except Exception as e:
                logger.warning(f"Director scene prompts attempt {attempt + 1} failed: {e}")
                if attempt < retries - 1:
                    payload["messages"].append({
                        "role": "user",
                        "content": "请务必仅返回 JSON 格式数据，确保可被 json.loads 解析。"
                    })

    raise RuntimeError("DeepSeek 导演引擎响应超时或格式错误，无法解析剧本分镜")
