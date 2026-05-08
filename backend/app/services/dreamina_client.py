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
from typing import Optional

from app.utils.logger import logger


DREAMINA_BIN = os.environ.get("DREAMINA_BIN", "/root/.local/bin/dreamina")


@dataclass
class DreaminaResult:
    success: bool
    submit_id: Optional[str] = None
    gen_status: Optional[str] = None        # querying / success / fail
    fail_reason: Optional[str] = None
    local_video_path: Optional[str] = None  # 下载好的本地 mp4 绝对路径
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
        image_path: str,
        prompt: str,
        model_version: str = "seedance2.0fast",
        duration: int = 15,
        video_resolution: str = "720p",
        download_dir: Optional[str] = None,
        max_wait_sec: int = 1800,    # 20 min — seedance2.0fast 高峰时排队 5-15 min 是常态
        poll_interval: int = 15,     # 队列长就别太勤快，省得撞速率限制
    ) -> DreaminaResult:
        """submit + 自动轮询 + 自动下载到本地 mp4。"""
        if not os.path.exists(self.bin):
            return DreaminaResult(success=False, fail_reason=f"dreamina binary missing: {self.bin}")
        if not os.path.exists(image_path):
            return DreaminaResult(success=False, fail_reason=f"image not found: {image_path}")

        # 1) submit
        rc, out, _ = _run([
            "image2video",
            f"--image={image_path}",
            f"--prompt={prompt}",
            f"--duration={int(max(4, min(15, duration)))}",
            f"--video_resolution={video_resolution}",
            f"--model_version={model_version}",
            "--poll=0",
        ], timeout=300)
        sid = _extract_submit_id(out)
        if not sid:
            tail = out[-400:].strip()
            return DreaminaResult(
                success=False,
                fail_reason=f"submit failed (rc={rc}); could not parse submit_id. tail: {tail}",
                raw_stdout_tail=tail,
            )

        gs = _extract_gen_status(out)
        if gs == "fail":
            return DreaminaResult(
                success=False, submit_id=sid, gen_status=gs,
                fail_reason=_extract_fail_reason(out) or "submit gen_status=fail",
                raw_stdout_tail=out[-400:].strip(),
            )

        # 2) 轮询
        ddir = Path(download_dir) if download_dir else Path("outputs") / "dreamina"
        ddir.mkdir(parents=True, exist_ok=True)

        deadline = time.monotonic() + max_wait_sec
        polls = 0
        last_out = out
        last_queue_idx = None
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
            if qm:
                qi = int(qm.group(1))
                if last_queue_idx != qi:
                    logger.info(f"dreamina poll #{polls} sid={sid[:8]} status={gs} queue_idx={qi}")
                    last_queue_idx = qi
            if gs == "success":
                # 3) 触发下载
                rc3, out3, _ = _run([
                    "query_result",
                    f"--submit_id={sid}",
                    f"--download_dir={ddir}",
                ], timeout=180)
                local = _extract_local_video_path(out3, ddir)
                if not local:
                    return DreaminaResult(
                        success=False, submit_id=sid, gen_status=gs,
                        fail_reason=f"success but couldn't locate downloaded mp4 (rc={rc3}); tail: {out3[-300:].strip()}",
                        raw_stdout_tail=out3[-400:].strip(),
                        poll_count=polls,
                    )
                return DreaminaResult(
                    success=True, submit_id=sid, gen_status=gs,
                    local_video_path=local,
                    raw_stdout_tail=out3[-400:].strip(),
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

        return DreaminaResult(
            success=False, submit_id=sid, gen_status="timeout",
            fail_reason=f"polling timed out after {max_wait_sec}s ({polls} polls); last status={_extract_gen_status(last_out)}",
            raw_stdout_tail=last_out[-400:].strip(),
            poll_count=polls,
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
