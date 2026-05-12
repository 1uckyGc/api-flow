"""即梦 / Dreamina CLI 子进程包装器。

CLI 二进制装在 /root/.local/bin/dreamina（见 backend/Dockerfile），登录态在
/root/.dreamina_cli/（docker volume dreamina_session 持久化）。

用法：
    cli = DreaminaClient()
    result = cli.image2video(image="...", prompt="...", model_version="seedance2.0fast",
                             duration=15, download_dir="outputs/")
    if result.success: ... result.local_video_path

策略：先 submit 拿 submit_id，然后内部 time.sleep + query_result 轮询，
gen_status=success 时用 query_result --download_dir 下载本地 → 返回 mp4 路径。

"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import httpx

from app.utils.logger import logger


def _parse_query_result_json(text: str) -> Optional[dict]:
    """dreamina CLI stdout 混了 SQL 慢查询 ANSI 日志和真正的 JSON 输出。
    定位以 `{\\n  "submit_id"` 开头的真正 JSON 块，去除前后噪声后解析。
    失败返 None。
    """
    if not text:
        return None
    # marker：dreamina CLI 真正的 JSON 输出第一行总是 `{` + 换行 + `  "submit_id"`
    idx = text.find('{\n  "submit_id"')
    if idx == -1:
        # 兜底：第一个 `{\n` 开头
        idx = text.find('{\n')
        if idx == -1:
            return None
    snippet = text[idx:]
    # JSON 结束后可能还有零星日志；scan 出 balanced 顶层对象的结束位置
    depth = 0
    in_str = False
    esc = False
    end = -1
    for i, ch in enumerate(snippet):
        if esc:
            esc = False
            continue
        if ch == '\\' and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end == -1:
        return None
    try:
        return json.loads(snippet[:end])
    except Exception:
        return None


def _extract_video_url_from_query(text: str) -> Optional[str]:
    """从 query_result 输出 JSON 抽 result_json.videos[0].video_url（已签名的 CDN 直链）。

    实测：dreamina CLI 自带下载 ~25s/11MB（~460KB/s），而直链 httpx 流式下载 ~2s/11MB
    （~5.7MB/s），12x 提速。优先用直链，失败 fallback 老 CLI 下载。
    """
    data = _parse_query_result_json(text)
    if not data:
        return None
    try:
        vids = (data.get("result_json") or {}).get("videos") or []
        if not vids:
            return None
        url = vids[0].get("video_url")
        return url if isinstance(url, str) and url.startswith("http") else None
    except Exception:
        return None


def _extract_image_urls_from_query(text: str) -> list:
    """从 query_result 输出 JSON 抽 result_json.images[].image_url（t2i/i2i 用）。"""
    data = _parse_query_result_json(text)
    if not data:
        return []
    try:
        imgs = (data.get("result_json") or {}).get("images") or []
        return [im.get("image_url") for im in imgs if isinstance(im.get("image_url"), str) and im.get("image_url", "").startswith("http")]
    except Exception:
        return []


def _direct_download_video(url: str, ddir: Path, sid: str, suffix: str = "_video_1") -> Optional[str]:
    """直接用 httpx 流式下载 dreamina 已签名的 CDN URL 到 ddir/<sid><suffix>.mp4。
    比 dreamina CLI 自带下载快约 12x（实测 11MB 25s → 2s）。
    """
    ddir.mkdir(parents=True, exist_ok=True)
    dst = ddir / f"{sid}{suffix}.mp4"
    try:
        t0 = time.monotonic()
        with httpx.Client(timeout=120.0, follow_redirects=True) as cli:
            with cli.stream("GET", url) as resp:
                if resp.status_code != 200:
                    logger.warning(
                        f"dreamina direct download HTTP {resp.status_code} for sid={sid[:8]}; "
                        f"will fall back to CLI"
                    )
                    return None
                with dst.open("wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=64 * 1024):
                        f.write(chunk)
        elapsed = time.monotonic() - t0
        size_mb = dst.stat().st_size / 1024 / 1024
        logger.info(
            f"dreamina direct download sid={sid[:8]} {size_mb:.1f}MB in {elapsed:.1f}s "
            f"({size_mb/elapsed:.1f}MB/s) → {dst}"
        )
        return str(dst).replace("\\", "/")
    except Exception as e:
        logger.warning(f"dreamina direct download failed for sid={sid[:8]}: {e}; will fall back to CLI")
        if dst.exists():
            try: dst.unlink()
            except Exception: pass
        return None


DREAMINA_BIN = os.environ.get("DREAMINA_BIN", "/root/.local/bin/dreamina")


@dataclass
class DreaminaResult:
    success: bool
    submit_id: Optional[str] = None
    gen_status: Optional[str] = None        # querying / success / fail
    fail_reason: Optional[str] = None
    local_video_path: Optional[str] = None  # 下载好的本地 mp4 绝对路径
    local_image_path: Optional[str] = None  # 下载好的本地 image 绝对路径（t2i/i2i 用）
    raw_stdout_tail: str = ""               # 最后一次 stdout（调试用）
    poll_count: int = 0


SUBMIT_ID_PATTERNS = [
    re.compile(r'"submit_id"\s*:\s*"([0-9a-f-]{8,})"'),
    re.compile(r"submit_id[=:\s]+([0-9a-f-]{8,})"),
]
GEN_STATUS_PATTERN = re.compile(r'"gen_status"\s*:\s*"(\w+)"')
QUEUE_IDX_PATTERN = re.compile(r'"queue_idx"\s*:\s*(\d+)')
FAIL_REASON_PATTERN = re.compile(r'"fail_reason"\s*:\s*"([^"]*)"')
LOCAL_PATH_PATTERN = re.compile(r"(/[^\s\"',]+\.mp4)")
LOCAL_IMAGE_PATH_PATTERN = re.compile(r"(/[^\s\"',]+\.(?:png|jpg|jpeg|webp))", re.IGNORECASE)


def _estimate_eta(queue_history: list) -> Optional[int]:
    """基于 (ts, queue_idx) 历史点估算剩余秒数。
    - 历史 < 2 点：None（信息不足）
    - 队列没动 / 在上升：None（不可估算）
    - 否则：剩余 = current_idx / (消化速率 个/秒)
    """
    if not queue_history or len(queue_history) < 2:
        return None
    # 用最早 vs 最新两个点的差算速率
    t0, q0 = queue_history[0]
    tN, qN = queue_history[-1]
    dt = tN - t0
    dq = q0 - qN   # 队列下降为正
    if dt <= 0 or dq <= 0:
        return None
    rate_per_sec = dq / dt
    if rate_per_sec <= 0:
        return None
    return int(qN / rate_per_sec)


def _run(args: list[str], timeout: int = 120) -> tuple[int, str, str]:
    """运行 dreamina 子命令，返回 (returncode, stdout, stderr)。stderr 合并到 stdout。"""
    cmd = [DREAMINA_BIN, *args]
    try:
        proc = subprocess.run(
            cmd, timeout=timeout, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or ""), (proc.stderr or "")
    except subprocess.TimeoutExpired as e:
        return 124, (e.stdout or "") + f"\n[TIMEOUT after {timeout}s]", (e.stderr or "")


def _extract_submit_id(text: str) -> Optional[str]:
    for pat in SUBMIT_ID_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1)
    return None


def _extract_gen_status(text: str) -> Optional[str]:
    m = GEN_STATUS_PATTERN.search(text)
    return m.group(1) if m else None


def _extract_fail_reason(text: str) -> Optional[str]:
    m = FAIL_REASON_PATTERN.search(text)
    return m.group(1) if m else None


def _extract_local_video_path(text: str, download_dir: Path) -> Optional[str]:
    """从 query_result --download_dir 的 stdout 找到下载好的 mp4 路径。

    优先 stdout 内出现的绝对路径；fallback 扫 download_dir 找最新生成的 mp4。
    """
    for m in LOCAL_PATH_PATTERN.finditer(text):
        p = m.group(1)
        if os.path.exists(p) and p.endswith(".mp4"):
            return p
    # fallback：扫目录最新 mp4
    if download_dir.exists():
        mp4s = sorted(download_dir.glob("*.mp4"), key=lambda x: x.stat().st_mtime, reverse=True)
        if mp4s:
            return str(mp4s[0])
    return None


def _extract_local_image_path(text: str, download_dir: Path) -> Optional[str]:
    """从 query_result --download_dir 的 stdout 找到下载好的 image 路径（t2i/i2i 用）。

    优先 stdout 里出现的绝对路径（含 .png/.jpg/.jpeg/.webp）；
    fallback 扫 download_dir 取最新 image。
    """
    for m in LOCAL_IMAGE_PATH_PATTERN.finditer(text):
        p = m.group(1)
        if os.path.exists(p):
            return p
    if download_dir.exists():
        imgs = []
        for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.PNG", "*.JPG", "*.JPEG", "*.WEBP"):
            imgs.extend(download_dir.glob(ext))
        imgs.sort(key=lambda x: x.stat().st_mtime, reverse=True)
        if imgs:
            return str(imgs[0])
    return None


def _submit_poll_download(
    submit_args: list,
    *,
    download_kind: str = "video",   # "video" | "image"
    download_dir_subpath: str = "dreamina",
    submit_timeout: int = 300,
    poll_timeout: int = 60,
    download_timeout: int = 180,
    max_wait_sec: int = 1800,
    poll_interval: int = 15,
) -> DreaminaResult:
    """所有 dreamina 子命令共用的 submit + 轮询 + 下载流程。

    submit_args 是 dreamina CLI 子命令参数（不含 dreamina 自身和 --poll=0；都由这里加）。
    download_kind 决定下载到本地后用哪个 extractor 找文件。
    """
    # 1) submit (--poll=0 立即返 submit_id 不阻塞)
    rc, out, _ = _run([*submit_args, "--poll=0"], timeout=submit_timeout)

    # 优先看 gen_status — 如果是 fail，直接拿 fail_reason 报上去
    gs = _extract_gen_status(out)
    fail_reason = _extract_fail_reason(out)
    if gs == "fail":
        return DreaminaResult(
            success=False, gen_status=gs,
            fail_reason=fail_reason or "Dreamina submit 返回 gen_status=fail",
            raw_stdout_tail=out[-400:].strip(),
        )

    sid = _extract_submit_id(out)
    if not sid:
        tail = out[-400:].strip()
        msg = fail_reason or f"submit 未返回 submit_id (rc={rc}, gen_status={gs})"
        return DreaminaResult(
            success=False,
            fail_reason=f"{msg}. tail: {tail}",
            raw_stdout_tail=tail,
        )

    # 2) 轮询
    ddir = Path("outputs") / download_dir_subpath
    ddir.mkdir(parents=True, exist_ok=True)

    deadline = time.monotonic() + max_wait_sec
    polls = 0
    last_out = out
    last_queue_idx = None
    last_gs = None
    while time.monotonic() < deadline:
        polls += 1
        time.sleep(poll_interval)
        rc2, out2, _ = _run(["query_result", f"--submit_id={sid}"], timeout=poll_timeout)
        last_out = out2
        gs = _extract_gen_status(out2)
        qm = QUEUE_IDX_PATTERN.search(out2)
        qi = int(qm.group(1)) if qm else None
        if gs != last_gs or (qi is not None and last_queue_idx != qi):
            logger.info(f"dreamina poll #{polls} sid={sid[:8]} status={gs} queue_idx={qi}")
            last_gs = gs
            if qi is not None:
                last_queue_idx = qi
        if gs == "success":
            local = None
            raw_tail = ""
            # 视频优先尝试直链下载（12x faster）；图片暂未实现（CLI 下载图片相对快）
            if download_kind == "video":
                video_url = _extract_video_url_from_query(out2)
                if video_url:
                    local = _direct_download_video(video_url, ddir, sid)
                    if local:
                        raw_tail = out2[-400:].strip()
            if not local:
                if download_kind == "video":
                    logger.info(f"dreamina {download_dir_subpath} sid={sid[:8]} fallback to CLI download")
                rc3, out3, _ = _run([
                    "query_result",
                    f"--submit_id={sid}",
                    f"--download_dir={ddir}",
                ], timeout=download_timeout)
                if download_kind == "image":
                    local = _extract_local_image_path(out3, ddir)
                    kind_label = "image"
                else:
                    local = _extract_local_video_path(out3, ddir)
                    kind_label = "mp4"
                raw_tail = out3[-400:].strip()
                if not local:
                    return DreaminaResult(
                        success=False, submit_id=sid, gen_status=gs,
                        fail_reason=f"success but couldn't locate downloaded {kind_label} (rc={rc3}); tail: {out3[-300:].strip()}",
                        raw_stdout_tail=raw_tail,
                        poll_count=polls,
                    )
            return DreaminaResult(
                success=True, submit_id=sid, gen_status=gs,
                local_video_path=local if download_kind == "video" else None,
                local_image_path=local if download_kind == "image" else None,
                raw_stdout_tail=raw_tail,
                poll_count=polls,
            )
        if gs == "fail":
            return DreaminaResult(
                success=False, submit_id=sid, gen_status=gs,
                fail_reason=_extract_fail_reason(out2) or "gen_status=fail",
                raw_stdout_tail=out2[-400:].strip(),
                poll_count=polls,
            )

    return DreaminaResult(
        success=False, submit_id=sid, gen_status="timeout",
        fail_reason=f"polling timed out after {max_wait_sec}s ({polls} polls); last status={_extract_gen_status(last_out)}",
        raw_stdout_tail=last_out[-400:].strip(),
        poll_count=polls,
    )


class DreaminaClient:
    """同步包装。submit + 轮询 + 下载到本地一条龙。"""

    def __init__(self, bin_path: str = DREAMINA_BIN):
        self.bin = bin_path
        if not os.path.exists(self.bin):
            logger.warning(f"DreaminaClient: binary not found at {self.bin}")

    # ---------- 基础子命令 ----------
    def is_logged_in(self) -> bool:
        rc, out, _ = _run(["user_credit"], timeout=30)
        return rc == 0 and "未检测到" not in out and "请先执行" not in out

    def user_credit(self) -> Optional[int]:
        rc, out, _ = _run(["user_credit"], timeout=30)
        if rc != 0:
            return None
        m = re.search(r"(\d+)", out)
        return int(m.group(1)) if m else None

    # ---------- 主流程 ----------
    def image2video(
        self,
        *,
        image_path: Optional[str] = None,
        prompt: Optional[str] = None,
        model_version: str = "seedance2.0fast",
        duration: int = 15,
        video_resolution: str = "720p",
        download_dir: Optional[str] = None,
        max_wait_sec: int = 1800,    # 30 min — seedance2.0fast 高峰时排队 5-15 min 是常态
        poll_interval: int = 15,     # 队列长就别太勤快，省得撞速率限制
        progress_callback: Optional[Callable[[dict], None]] = None,
        sid_persist_callback: Optional[Callable[[str], None]] = None,
        resume_sid: Optional[str] = None,
    ) -> DreaminaResult:
        """submit + 自动轮询 + 自动下载到本地 mp4。
        外层 wrap: 全局 dreamina concurrency semaphore（Redis），抢不到槽就阻塞排队。
        in-flight 占着整段 submit→poll→download，完成后释放。

        resume_sid: 续 poll 模式 —— 跳过 submit，直接用已有 sid 进入 poll 循环
        （worker 重启时恢复 zombie task 用）。image_path / prompt 可省略。
        """
        from app.utils.dreamina_concurrency import wait_for_slot, release_slot

        # 抢槽（阻塞直到拿到或超时）。waiting 期间前端轮询能看到 waiting 数+1
        if progress_callback:
            try:
                progress_callback({
                    "gen_status": "queuing",
                    "queue_idx": None,
                    "fail_reason": "等待 Dreamina 并发槽（账户并发上限）",
                    "elapsed_sec": 0,
                    "submit_id": None,
                })
            except Exception:
                pass
        if not wait_for_slot(timeout_sec=max_wait_sec, poll=3.0):
            return DreaminaResult(
                success=False,
                fail_reason=f"等待 Dreamina 并发槽超时（{max_wait_sec}s）；账户并发被打满太久。",
            )

        try:
            return self._image2video_inner(
                image_path=image_path, prompt=prompt,
                model_version=model_version, duration=duration,
                video_resolution=video_resolution, download_dir=download_dir,
                max_wait_sec=max_wait_sec, poll_interval=poll_interval,
                progress_callback=progress_callback,
                sid_persist_callback=sid_persist_callback,
                resume_sid=resume_sid,
            )
        finally:
            release_slot()

    def _image2video_inner(
        self,
        *,
        image_path: Optional[str],
        prompt: Optional[str],
        model_version: str,
        duration: int,
        video_resolution: str,
        download_dir: Optional[str],
        max_wait_sec: int,
        poll_interval: int,
        progress_callback: Optional[Callable[[dict], None]],
        sid_persist_callback: Optional[Callable[[str], None]] = None,
        resume_sid: Optional[str] = None,
    ) -> DreaminaResult:
        """原 image2video 主体（submit + poll + download），不管 concurrency 槽。
        resume_sid 非空时跳过 submit，直接用已有 sid 进 poll。
        """
        if not os.path.exists(self.bin):
            return DreaminaResult(success=False, fail_reason=f"dreamina binary missing: {self.bin}")
        if not resume_sid:
            if not image_path or not os.path.exists(image_path):
                return DreaminaResult(success=False, fail_reason=f"image not found: {image_path}")

        if resume_sid:
            # 续 poll 模式：跳过 submit，直接用已有 sid
            sid = resume_sid
            logger.info(f"dreamina image2video resume mode: sid={sid[:18]}")
            out = ""  # 留给后面 raw_stdout_tail 用
        else:
            # 1) submit —— ExceedConcurrencyLimit (ret=1310) 是瞬态错误（账户级并发暂时打满），
            # 等几秒前面任务释放后通常就能进。最多重试 7 次，每次间隔 45s（总扛 ~5.25min）。
            submit_cmd = [
                "image2video",
                f"--image={image_path}",
                f"--prompt={prompt}",
                f"--duration={int(max(4, min(15, duration)))}",
                f"--video_resolution={video_resolution}",
                f"--model_version={model_version}",
                "--poll=0",
            ]
            SUBMIT_RETRY_BACKOFF = 45  # 秒
            SUBMIT_MAX_TRIES = 8       # 首次 + 7 次重试
            for attempt in range(SUBMIT_MAX_TRIES):
                rc, out, _ = _run(submit_cmd, timeout=300)
                gs = _extract_gen_status(out)
                fail_reason = _extract_fail_reason(out)
                is_concurrency = bool(fail_reason and "ExceedConcurrencyLimit" in fail_reason) or "ret=1310" in (out or "")
                if not is_concurrency:
                    break  # 不是并发问题，按原路径走
                if attempt == SUBMIT_MAX_TRIES - 1:
                    logger.warning(f"dreamina submit hit ExceedConcurrencyLimit, exhausted {SUBMIT_MAX_TRIES} tries; giving up")
                    break
                logger.info(f"dreamina submit hit ExceedConcurrencyLimit (try {attempt+1}/{SUBMIT_MAX_TRIES}), wait {SUBMIT_RETRY_BACKOFF}s then retry")
                # 让 caller 看见我们在等并发槽
                if progress_callback:
                    try:
                        progress_callback({
                            "gen_status": "queuing",
                            "queue_idx": None,
                            "fail_reason": f"账户并发上限暂满，等 {SUBMIT_RETRY_BACKOFF}s 重试 ({attempt+1}/{SUBMIT_MAX_TRIES})",
                            "elapsed_sec": 0,
                            "submit_id": None,
                        })
                    except Exception:
                        pass
                time.sleep(SUBMIT_RETRY_BACKOFF)

            if gs == "fail":
                return DreaminaResult(
                    success=False, gen_status=gs,
                    fail_reason=fail_reason or "Dreamina submit 返回 gen_status=fail（无 fail_reason）",
                    raw_stdout_tail=out[-400:].strip(),
                )

            sid = _extract_submit_id(out)
            if not sid:
                tail = out[-400:].strip()
                msg = fail_reason or f"submit 未返回 submit_id (rc={rc}, gen_status={gs})"
                return DreaminaResult(
                    success=False,
                    fail_reason=f"{msg}. tail: {tail}",
                    raw_stdout_tail=tail,
                )

            # 立即同步持久化 sid 到 DB — 闭合 worker 崩溃前 60s callback 节流的竞争窗口
            if sid_persist_callback:
                try:
                    sid_persist_callback(sid)
                except Exception as e:
                    logger.warning(f"image2video sid_persist_callback raised: {e}")

        # 提交成功（或 resume）立即推一次进度（不等 60s）
        def _safe_cb(info: dict) -> None:
            if not progress_callback:
                return
            try:
                progress_callback(info)
            except Exception as e:
                logger.warning(f"dreamina progress_callback raised: {e}")

        start_ts = time.monotonic()
        _safe_cb({
            "gen_status": "submitted",
            "queue_idx": None,
            "fail_reason": None,
            "elapsed_sec": 0,
            "submit_id": sid,
        })

        # 2) 轮询
        ddir = Path(download_dir) if download_dir else Path("outputs") / "dreamina"
        ddir.mkdir(parents=True, exist_ok=True)

        deadline = time.monotonic() + max_wait_sec
        polls = 0
        last_out = out
        last_queue_idx = None
        last_gs = None
        last_cb_ts = time.monotonic()
        CB_INTERVAL = 60.0  # 每 60s 节流一次回调
        # ETA 估算用：(monotonic_ts, queue_idx) 历史，cap 10 条
        queue_history: list[tuple[float, int]] = []
        while time.monotonic() < deadline:
            polls += 1
            time.sleep(poll_interval)
            rc2, out2, _ = _run([
                "query_result",
                f"--submit_id={sid}",
            ], timeout=60)
            last_out = out2
            gs = _extract_gen_status(out2)
            qm = QUEUE_IDX_PATTERN.search(out2)
            qi = int(qm.group(1)) if qm else None
            # 状态变化（gs 或 queue_idx）都打 log —— 之前只看 queue_idx 变化，
            # queue=0 → success 转换完全沉默，无观测性
            if gs != last_gs or (qi is not None and last_queue_idx != qi):
                logger.info(f"dreamina poll #{polls} sid={sid[:8]} status={gs} queue_idx={qi}")
                last_gs = gs
                if qi is not None and last_queue_idx != qi:
                    last_queue_idx = qi
                    queue_history.append((time.monotonic(), qi))
                    if len(queue_history) > 10:
                        queue_history = queue_history[-10:]
            now = time.monotonic()
            if progress_callback and (now - last_cb_ts) >= CB_INTERVAL:
                # ETA 估算：基于 queue_history 算消化速率
                eta_sec = _estimate_eta(queue_history)
                _safe_cb({
                    "gen_status": gs,
                    "queue_idx": qi if qi is not None else last_queue_idx,
                    "fail_reason": _extract_fail_reason(out2),
                    "elapsed_sec": int(now - start_ts),
                    "submit_id": sid,
                    "eta_sec": eta_sec,
                })
                last_cb_ts = now
            if gs == "success":
                # 优先尝试直链下载（实测 12x 提速：CLI 25s → httpx 2s）
                video_url = _extract_video_url_from_query(out2)
                local = None
                if video_url:
                    local = _direct_download_video(video_url, ddir, sid)
                # fallback: CLI 自带下载（兼容 video_url 解析失败 / 直链 403 等）
                if not local:
                    logger.info(f"dreamina image2video sid={sid[:8]} fallback to CLI download")
                    rc3, out3, _ = _run([
                        "query_result",
                        f"--submit_id={sid}",
                        f"--download_dir={ddir}",
                    ], timeout=180)
                    local = _extract_local_video_path(out3, ddir)
                    raw_tail = out3[-400:].strip()
                    if not local:
                        return DreaminaResult(
                            success=False, submit_id=sid, gen_status=gs,
                            fail_reason=f"success but couldn't locate downloaded mp4 (rc={rc3}); tail: {out3[-300:].strip()}",
                            raw_stdout_tail=raw_tail,
                            poll_count=polls,
                        )
                else:
                    raw_tail = out2[-400:].strip()
                return DreaminaResult(
                    success=True, submit_id=sid, gen_status=gs,
                    local_video_path=local,
                    raw_stdout_tail=raw_tail,
                    poll_count=polls,
                )
            if gs == "fail":
                return DreaminaResult(
                    success=False, submit_id=sid, gen_status=gs,
                    fail_reason=_extract_fail_reason(out2) or "gen_status=fail",
                    raw_stdout_tail=out2[-400:].strip(),
                    poll_count=polls,
                )
            # querying / 其他状态 → 继续

        # poll 预算用完但上游仍在排队/渲染 —— 不算失败，让 batch 层续 poll
        last_status = _extract_gen_status(last_out) or "querying"
        logger.info(
            f"image2video poll budget {max_wait_sec}s used up but upstream still {last_status}, "
            f"sid={sid[:8]} persisted, awaiting batch-level resume"
        )
        return DreaminaResult(
            success=False, submit_id=sid, gen_status="still_queuing",
            fail_reason=(
                f"poll 预算 {max_wait_sec}s 已用完 ({polls} polls)，上游仍在 {last_status}；"
                f"sid={sid[:8]} 已持久化，等待续 poll"
            ),
            raw_stdout_tail=last_out[-400:].strip(),
            poll_count=polls,
        )


    # ---------- multimodal2video (全能参考 / formerly ref2video) ----------
    def multimodal2video(
        self,
        *,
        image_paths: Optional[list] = None,
        prompt: Optional[str] = None,
        ratio: str = "9:16",
        model_version: str = "seedance2.0fast",
        duration: int = 15,
        video_resolution: str = "720p",
        download_dir: Optional[str] = None,
        max_wait_sec: int = 1800,
        poll_interval: int = 15,
        progress_callback: Optional[Callable[[dict], None]] = None,
        sid_persist_callback: Optional[Callable[[str], None]] = None,
        resume_sid: Optional[str] = None,
    ) -> DreaminaResult:
        """Dreamina 旗舰"全能参考"视频生成。
        多图/视频/音频作参考，dreamina 自由生成视频。
        当前仅暴露 image_paths（最多 9 张）；未来可扩展 video/audio。
        ratio 必填：1:1 / 3:4 / 16:9 / 4:3 / 9:16 / 21:9。
        外层 wrap: 全局 dreamina concurrency semaphore（与 image2video 共用）。
        """
        from app.utils.dreamina_concurrency import wait_for_slot, release_slot

        if progress_callback:
            try:
                progress_callback({
                    "gen_status": "queuing",
                    "queue_idx": None,
                    "fail_reason": "等待 Dreamina 并发槽（账户并发上限）",
                    "elapsed_sec": 0,
                    "submit_id": None,
                })
            except Exception:
                pass
        if not wait_for_slot(timeout_sec=max_wait_sec, poll=3.0):
            return DreaminaResult(
                success=False,
                fail_reason=f"等待 Dreamina 并发槽超时（{max_wait_sec}s）；账户并发被打满太久。",
            )

        try:
            return self._multimodal2video_inner(
                image_paths=image_paths, prompt=prompt,
                ratio=ratio, model_version=model_version,
                duration=duration, video_resolution=video_resolution,
                download_dir=download_dir,
                max_wait_sec=max_wait_sec, poll_interval=poll_interval,
                progress_callback=progress_callback,
                sid_persist_callback=sid_persist_callback,
                resume_sid=resume_sid,
            )
        finally:
            release_slot()

    def _multimodal2video_inner(
        self,
        *,
        image_paths: Optional[list],
        prompt: Optional[str],
        ratio: str,
        model_version: str,
        duration: int,
        video_resolution: str,
        download_dir: Optional[str],
        max_wait_sec: int,
        poll_interval: int,
        progress_callback: Optional[Callable[[dict], None]],
        sid_persist_callback: Optional[Callable[[str], None]] = None,
        resume_sid: Optional[str] = None,
    ) -> DreaminaResult:
        """multimodal2video 主体（submit + poll + download），不管 concurrency 槽。
        resume_sid 非空时跳过 submit，直接 poll。
        """
        if not os.path.exists(self.bin):
            return DreaminaResult(success=False, fail_reason=f"dreamina binary missing: {self.bin}")

        if resume_sid:
            sid = resume_sid
            logger.info(f"dreamina multimodal2video resume mode: sid={sid[:18]}")
            out = ""
        else:
            if not image_paths:
                return DreaminaResult(success=False, fail_reason="multimodal2video 至少需 1 张图")
            for p in image_paths:
                if not os.path.exists(p):
                    return DreaminaResult(success=False, fail_reason=f"image not found: {p}")

            # 构造 submit 命令：multimodal2video --image=<repeat> --ratio=... --prompt=...
            submit_cmd = ["multimodal2video"]
            for p in image_paths:
                submit_cmd.append(f"--image={p}")
            if prompt:
                submit_cmd.append(f"--prompt={prompt}")
            submit_cmd.extend([
                f"--ratio={ratio}",
                f"--duration={int(max(4, min(15, duration)))}",
                f"--video_resolution={video_resolution}",
                f"--model_version={model_version}",
                "--poll=0",
            ])

            SUBMIT_RETRY_BACKOFF = 45
            SUBMIT_MAX_TRIES = 8
            gs = None
            fail_reason = None
            rc, out = 0, ""
            for attempt in range(SUBMIT_MAX_TRIES):
                rc, out, _ = _run(submit_cmd, timeout=300)
                gs = _extract_gen_status(out)
                fail_reason = _extract_fail_reason(out)
                is_concurrency = bool(fail_reason and "ExceedConcurrencyLimit" in fail_reason) or "ret=1310" in (out or "")
                if not is_concurrency:
                    break
                if attempt == SUBMIT_MAX_TRIES - 1:
                    logger.warning(f"multimodal2video submit hit ExceedConcurrencyLimit, exhausted {SUBMIT_MAX_TRIES} tries; giving up")
                    break
                logger.info(f"multimodal2video submit hit ExceedConcurrencyLimit (try {attempt+1}/{SUBMIT_MAX_TRIES}), wait {SUBMIT_RETRY_BACKOFF}s")
                if progress_callback:
                    try:
                        progress_callback({
                            "gen_status": "queuing",
                            "queue_idx": None,
                            "fail_reason": f"账户并发上限暂满，等 {SUBMIT_RETRY_BACKOFF}s 重试 ({attempt+1}/{SUBMIT_MAX_TRIES})",
                            "elapsed_sec": 0,
                            "submit_id": None,
                        })
                    except Exception:
                        pass
                time.sleep(SUBMIT_RETRY_BACKOFF)

            # 识别 AigcComplianceConfirmationRequired —— Dreamina Web 端首次授权
            if fail_reason and "AigcComplianceConfirmationRequired" in fail_reason:
                return DreaminaResult(
                    success=False, gen_status=gs,
                    fail_reason="multimodal2video 首次使用需 Dreamina Web 端授权确认。请登录 jimeng.jianying.com 完成授权后重试。",
                    raw_stdout_tail=out[-400:].strip(),
                )

            if gs == "fail":
                return DreaminaResult(
                    success=False, gen_status=gs,
                    fail_reason=fail_reason or "multimodal2video submit 返回 gen_status=fail",
                    raw_stdout_tail=out[-400:].strip(),
                )

            sid = _extract_submit_id(out)
            if not sid:
                tail = out[-400:].strip()
                msg = fail_reason or f"submit 未返回 submit_id (rc={rc}, gen_status={gs})"
                return DreaminaResult(
                    success=False,
                    fail_reason=f"{msg}. tail: {tail}",
                    raw_stdout_tail=tail,
                )

            # 立即同步持久化 sid 到 DB — 闭合 worker 崩溃前 60s callback 节流的竞争窗口
            if sid_persist_callback:
                try:
                    sid_persist_callback(sid)
                except Exception as e:
                    logger.warning(f"multimodal2video sid_persist_callback raised: {e}")

        # 内部 _safe_cb + 初始 submitted 推送
        def _safe_cb(info: dict) -> None:
            if not progress_callback:
                return
            try:
                progress_callback(info)
            except Exception as e:
                logger.warning(f"multimodal2video progress_callback raised: {e}")

        start_ts = time.monotonic()
        _safe_cb({
            "gen_status": "submitted",
            "queue_idx": None,
            "fail_reason": None,
            "elapsed_sec": 0,
            "submit_id": sid,
        })

        # poll + download —— 复用 image2video 完全一致的逻辑
        ddir = Path(download_dir) if download_dir else Path("outputs") / "dreamina"
        ddir.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + max_wait_sec
        polls = 0
        last_out = out
        last_queue_idx = None
        last_gs = None
        last_cb_ts = time.monotonic()
        CB_INTERVAL = 60.0
        queue_history: list[tuple[float, int]] = []
        while time.monotonic() < deadline:
            polls += 1
            time.sleep(poll_interval)
            rc2, out2, _ = _run([
                "query_result",
                f"--submit_id={sid}",
            ], timeout=60)
            last_out = out2
            gs = _extract_gen_status(out2)
            qm = QUEUE_IDX_PATTERN.search(out2)
            qi = int(qm.group(1)) if qm else None
            if gs != last_gs or (qi is not None and last_queue_idx != qi):
                logger.info(f"multimodal2video poll #{polls} sid={sid[:8]} status={gs} queue_idx={qi}")
                last_gs = gs
                if qi is not None and last_queue_idx != qi:
                    last_queue_idx = qi
                    queue_history.append((time.monotonic(), qi))
                    if len(queue_history) > 10:
                        queue_history = queue_history[-10:]
            now = time.monotonic()
            if progress_callback and (now - last_cb_ts) >= CB_INTERVAL:
                eta_sec = _estimate_eta(queue_history)
                _safe_cb({
                    "gen_status": gs,
                    "queue_idx": qi if qi is not None else last_queue_idx,
                    "fail_reason": _extract_fail_reason(out2),
                    "elapsed_sec": int(now - start_ts),
                    "submit_id": sid,
                    "eta_sec": eta_sec,
                })
                last_cb_ts = now
            if gs == "success":
                # 优先尝试直链下载（实测 12x 提速）
                video_url = _extract_video_url_from_query(out2)
                local = None
                if video_url:
                    local = _direct_download_video(video_url, ddir, sid)
                if not local:
                    logger.info(f"dreamina multimodal2video sid={sid[:8]} fallback to CLI download")
                    rc3, out3, _ = _run([
                        "query_result",
                        f"--submit_id={sid}",
                        f"--download_dir={ddir}",
                    ], timeout=180)
                    local = _extract_local_video_path(out3, ddir)
                    raw_tail = out3[-400:].strip()
                    if not local:
                        return DreaminaResult(
                            success=False, submit_id=sid, gen_status=gs,
                            fail_reason=f"success but couldn't locate downloaded mp4 (rc={rc3}); tail: {out3[-300:].strip()}",
                            raw_stdout_tail=raw_tail,
                            poll_count=polls,
                        )
                else:
                    raw_tail = out2[-400:].strip()
                return DreaminaResult(
                    success=True, submit_id=sid, gen_status=gs,
                    local_video_path=local,
                    raw_stdout_tail=raw_tail,
                    poll_count=polls,
                )
            if gs == "fail":
                return DreaminaResult(
                    success=False, submit_id=sid, gen_status=gs,
                    fail_reason=_extract_fail_reason(out2) or "gen_status=fail",
                    raw_stdout_tail=out2[-400:].strip(),
                    poll_count=polls,
                )
            # querying / 其他 → 继续

        # poll 预算用完但上游仍在排队/渲染 —— 不算失败，让 batch 层续 poll
        last_status = _extract_gen_status(last_out) or "querying"
        logger.info(
            f"multimodal2video poll budget {max_wait_sec}s used up but upstream still {last_status}, "
            f"sid={sid[:8]} persisted, awaiting batch-level resume"
        )
        return DreaminaResult(
            success=False, submit_id=sid, gen_status="still_queuing",
            fail_reason=(
                f"poll 预算 {max_wait_sec}s 已用完 ({polls} polls)，上游仍在 {last_status}；"
                f"sid={sid[:8]} 已持久化，等待续 poll"
            ),
            raw_stdout_tail=last_out[-400:].strip(),
            poll_count=polls,
        )


    # ---------- t2i / i2i / t2v 新加 ----------
    def text2image(
        self,
        *,
        prompt: str,
        model_version: str = "5.0",
        ratio: str = "1:1",
        resolution_type: str = "1k",
        max_wait_sec: int = 600,
        poll_interval: int = 8,
    ) -> DreaminaResult:
        """dreamina text2image。返 local_image_path。"""
        if not os.path.exists(self.bin):
            return DreaminaResult(success=False, fail_reason=f"dreamina binary missing: {self.bin}")
        if not prompt.strip():
            return DreaminaResult(success=False, fail_reason="prompt 为空")
        return _submit_poll_download(
            [
                "text2image",
                f"--prompt={prompt}",
                f"--model_version={model_version}",
                f"--ratio={ratio}",
                f"--resolution_type={resolution_type}",
            ],
            download_kind="image",
            max_wait_sec=max_wait_sec,
            poll_interval=poll_interval,
        )

    def image2image(
        self,
        *,
        image_path: str,
        prompt: str,
        max_wait_sec: int = 600,
        poll_interval: int = 8,
    ) -> DreaminaResult:
        """dreamina image2image。返 local_image_path。"""
        if not os.path.exists(self.bin):
            return DreaminaResult(success=False, fail_reason=f"dreamina binary missing: {self.bin}")
        if not os.path.exists(image_path):
            return DreaminaResult(success=False, fail_reason=f"image not found: {image_path}")
        return _submit_poll_download(
            [
                "image2image",
                f"--image={image_path}",
                f"--prompt={prompt}",
            ],
            download_kind="image",
            max_wait_sec=max_wait_sec,
            poll_interval=poll_interval,
        )

    def text2video(
        self,
        *,
        prompt: str,
        max_wait_sec: int = 1800,
        poll_interval: int = 15,
    ) -> DreaminaResult:
        """dreamina text2video。返 local_video_path。"""
        if not os.path.exists(self.bin):
            return DreaminaResult(success=False, fail_reason=f"dreamina binary missing: {self.bin}")
        if not prompt.strip():
            return DreaminaResult(success=False, fail_reason="prompt 为空")
        return _submit_poll_download(
            [
                "text2video",
                f"--prompt={prompt}",
            ],
            download_kind="video",
            max_wait_sec=max_wait_sec,
            poll_interval=poll_interval,
        )


def move_to_outputs(local_path: str) -> str:
    """把 dreamina 下载到 outputs/dreamina/ 的临时 mp4 重命名到 outputs/<uuid>.mp4，
    返回相对路径形式（以 outputs/ 开头），与 GenerationResult.output_file_path 对齐。"""
    if not local_path or not os.path.exists(local_path):
        return local_path
    src = Path(local_path)
    dst_dir = Path("outputs")
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / f"{uuid.uuid4().hex}.mp4"
    shutil.move(str(src), str(dst))
    return str(dst).replace("\\", "/")
