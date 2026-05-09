"""复刻视频自动模式 Celery 任务。

run_storyboard_llm(job_id):
  1. 从 DB 加 TaskGroup（source=STORYBOARD, status 应为 PROCESSING）
  2. 读 master_prompt + 视频路径 + 商品图路径
  3. 调 PackyGeminiClient → 拿到 LLM 完整输出
  4. 落盘 full_llm_output.md
  5. parse_llm_output → save_gus_to_dir
  6. 更新 group: total_count=GU 数，status=COMPLETED；失败 → FAILED + progress_message=错误
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Optional

from app.config import settings
from app.database import SessionLocal
from app.models.task import GroupStatus, Task, TaskGroup, TaskSource, TaskStatus
from app.services.cc123_video_client import CC123VideoClient, _aspect_to_wh, get_cc123_client
from app.services.dreamina_client import DreaminaClient, move_to_outputs
from app.services.packy_gemini import (
    DEFAULT_GEMINI_MODEL,
    PackyGeminiClient,
    SUPPORTED_GEMINI_MODELS,
)
from app.services.storyboard.pipeline import parse_llm_output, save_gus_to_dir
from app.utils.logger import logger
from app.workers.celery_app import celery_app


@celery_app.task(name="app.workers.replicate_tasks.run_storyboard_llm")
def run_storyboard_llm(job_id: str) -> dict:
    db = SessionLocal()
    try:
        group = (
            db.query(TaskGroup)
            .filter(
                TaskGroup.id == job_id,
                TaskGroup.source == TaskSource.STORYBOARD,
            )
            .first()
        )
        if not group:
            logger.error(f"replicate auto: job {job_id} not found")
            return {"error": "job not found"}

        cfg = dict(group.config_json or {})
        master_prompt_path = cfg.get("master_prompt_path")
        video_path = cfg.get("video_path")
        product_image_paths = cfg.get("product_image_paths") or []
        chosen_model = cfg.get("gemini_model") or DEFAULT_GEMINI_MODEL
        if chosen_model not in SUPPORTED_GEMINI_MODELS:
            chosen_model = DEFAULT_GEMINI_MODEL

        if not master_prompt_path or not os.path.exists(master_prompt_path):
            return _fail(db, group, f"master_prompt 文件丢失: {master_prompt_path}")
        if not video_path or not os.path.exists(video_path):
            return _fail(db, group, f"样片视频文件丢失: {video_path}")

        master_prompt = Path(master_prompt_path).read_text(encoding="utf-8")

        api_key = settings.PACKYAPI_GEMINI_KEY
        if not api_key:
            return _fail(db, group, "PACKYAPI_GEMINI_KEY 未配置（.env 里加上）")

        client = PackyGeminiClient(
            api_key=api_key,
            base_url=settings.PACKYAPI_BASE_URL,
            default_model=chosen_model,
        )

        group.progress_message = f"Gemini 分析样片中（{chosen_model}）…"
        db.commit()

        result = asyncio.run(
            client.run_storyboard(
                master_prompt=master_prompt,
                video_path=video_path,
                product_image_paths=product_image_paths,
                model=chosen_model,
            )
        )

        if not result.success:
            err = result.error or "Gemini 调用失败"
            return _fail(db, group, f"LLM 调用失败：{err}", model_used=result.model_used)

        # 落盘 LLM 原文
        workdir = Path(master_prompt_path).parent
        llm_output_path = workdir / "full_llm_output.md"
        llm_output_path.write_text(result.text or "", encoding="utf-8")

        # 解析 GU 并落盘
        gus = parse_llm_output(result.text or "")
        if not gus:
            return _fail(
                db,
                group,
                "LLM 输出未识别出任何 GU 块（缺 ═══【GU01/...】 标记）；可手动改用粘贴模式重试",
                model_used=result.model_used,
            )

        gu_dir = Path(cfg.get("gu_output_dir") or (workdir / "gus"))
        save_gus_to_dir(gus, gu_dir)

        cfg.update({
            "llm_output_path": str(llm_output_path).replace("\\", "/"),
            "gu_output_dir": str(gu_dir).replace("\\", "/"),
            "gu_count": len(gus),
            "gemini_model_used": result.model_used,
            "gemini_usage": {
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "reasoning_tokens": result.reasoning_tokens,
            },
        })
        group.config_json = cfg
        group.total_count = len(gus)
        group.status = GroupStatus.COMPLETED
        group.progress_message = (
            f"完成 · {len(gus)} GU · "
            f"{result.prompt_tokens or 0} in / {result.completion_tokens or 0} out tokens"
        )
        db.commit()
        logger.info(f"replicate auto: job {job_id} done, {len(gus)} GUs, model={result.model_used}")
        return {
            "ok": True,
            "gu_count": len(gus),
            "model": result.model_used,
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
        }
    except Exception as e:
        logger.exception(f"replicate auto job {job_id} crashed")
        try:
            return _fail(db, group, f"任务崩溃：{type(e).__name__}: {e}")
        except Exception:
            return {"error": str(e)}
    finally:
        db.close()


def _fail(db, group: TaskGroup, message: str, *, model_used: str | None = None) -> dict:
    group.status = GroupStatus.FAILED
    group.progress_message = message[:500]
    if model_used:
        cfg = dict(group.config_json or {})
        cfg["gemini_model_used"] = model_used
        group.config_json = cfg
    db.commit()
    logger.warning(f"replicate auto: job {group.id} failed: {message}")
    return {"error": message}


# ─────────────────────────────────────────────────────────────────────
# 产线 B 视频生成（即梦 / Dreamina CLI subprocess）
# ─────────────────────────────────────────────────────────────────────
@celery_app.task(name="app.workers.replicate_tasks.run_video_via_dreamina", bind=True)
def run_video_via_dreamina(self, task_id: str) -> dict:
    """对一个 storyboard pipeline B 子任务，调 dreamina CLI 出 15s 视频。

    Task 是由 router.generate_video 创建的（status=QUEUED），config_json 形如:
      {gu_id, kind="video", model_version, duration, video_resolution, ratio, prompt}
    input_files[0] 是用作 i2v 输入的图片（产品参考图或 GU 已生成的 9宫格图）。
    """
    db = SessionLocal()
    try:
        task: Optional[Task] = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            logger.error(f"dreamina task {task_id} not found")
            return {"error": "task not found"}

        cfg = dict(task.config_json or {})
        prompt = task.prompt or ""
        if not prompt.strip():
            return _fail_task(db, task, "prompt 为空")

        inputs = task.input_files or []
        if not inputs or not isinstance(inputs, list) or not inputs[0]:
            return _fail_task(db, task, "无输入图（input_files 为空）")

        image_path = inputs[0]
        if not image_path.startswith(("/", "C:", "D:", "E:")) and not Path(image_path).is_absolute():
            # 相对路径转绝对（worker 工作目录是 /app）
            image_path = str(Path("/app") / image_path)
        if not Path(image_path).exists():
            return _fail_task(db, task, f"输入图文件不存在: {image_path}")

        task.status = TaskStatus.RUNNING
        db.commit()

        cli = DreaminaClient()
        if not cli.is_logged_in():
            return _fail_task(db, task, "Dreamina CLI 未登录。运维需 SSH 进 worker 容器跑 `dreamina login --headless` 一次")

        result = cli.image2video(
            image_path=image_path,
            prompt=prompt,
            model_version=cfg.get("model_version", "seedance2.0fast"),
            duration=int(cfg.get("duration", 15)),
            video_resolution=cfg.get("video_resolution", "720p"),
            max_wait_sec=int(cfg.get("max_wait_sec", 1800)),
            poll_interval=int(cfg.get("poll_interval", 15)),
        )

        if not result.success:
            err = (result.fail_reason or "dreamina 调用失败")[:500]
            return _fail_task(db, task, err)

        # 把临时 dreamina mp4 移到 outputs/<uuid>.mp4
        moved = move_to_outputs(result.local_video_path) if result.local_video_path else None
        task.output_file = moved
        task.status = TaskStatus.SUCCESS
        # 把 submit_id / poll_count 写进 config_json，前端可读
        cfg.update({
            "dreamina_submit_id": result.submit_id,
            "dreamina_polls": result.poll_count,
        })
        task.config_json = cfg
        db.commit()
        logger.info(f"dreamina task {task_id} success, submit_id={result.submit_id}, file={moved}")
        return {"ok": True, "submit_id": result.submit_id, "file": moved, "polls": result.poll_count}
    except Exception as e:
        logger.exception(f"dreamina task {task_id} crashed")
        try:
            task = db.query(Task).filter(Task.id == task_id).first()
            return _fail_task(db, task, f"任务崩溃：{type(e).__name__}: {e}") if task else {"error": str(e)}
        except Exception:
            return {"error": str(e)}
    finally:
        db.close()


def _fail_task(db, task: Task, message: str) -> dict:
    if task is None:
        return {"error": message}
    task.status = TaskStatus.FAILED
    task.error_message = message[:500]
    db.commit()
    logger.warning(f"task {task.id} failed: {message}")
    return {"error": message}


# ─────────────────────────────────────────────────────────────────────
# 产线 B 视频生成 — 第三方 cc123.ai Seedance 2.0 路径（HTTP）
# ─────────────────────────────────────────────────────────────────────
@celery_app.task(name="app.workers.replicate_tasks.run_video_via_cc123", bind=True)
def run_video_via_cc123(self, task_id: str) -> dict:
    """对一个 storyboard pipeline B 子任务，调 cc123.ai relay 出 seedance 视频。

    Task 是由 router.generate_video 创建的（status=QUEUED），config_json 形如:
      {gu_id, kind="video", provider="cc123",
       model_version="cc123/seedance2.0fast", duration, video_resolution, aspect_ratio}
    input_files[0] 用于 i2v 输入。cc123 接受 URL 或 base64，我们用 base64 inline。
    """
    db = SessionLocal()
    try:
        task: Optional[Task] = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            logger.error(f"cc123 task {task_id} not found")
            return {"error": "task not found"}

        cfg = dict(task.config_json or {})
        prompt = (task.prompt or "").strip()
        if not prompt:
            return _fail_task(db, task, "prompt 为空")

        # i2v 输入图：用绝对路径（worker /app 是项目根）
        inputs = task.input_files or []
        image_path = None
        if inputs and isinstance(inputs, list) and inputs[0]:
            ip = inputs[0]
            if not Path(ip).is_absolute():
                ip = str(Path("/app") / ip)
            if not Path(ip).exists():
                return _fail_task(db, task, f"输入图文件不存在: {ip}")
            image_path = ip

        # cc123/sd-2 → sd-2（strip 前缀后透传给 cc123 上游）
        raw_model = cfg.get("model_version", "cc123/sd-2")
        cc123_model = raw_model.split("/", 1)[1] if "/" in raw_model else raw_model

        client = get_cc123_client()
        if client is None:
            return _fail_task(db, task, "CC123_API_KEY 未配置（.env 里加上）")

        task.status = TaskStatus.RUNNING
        db.commit()

        result = asyncio.run(
            client.submit_and_wait(
                model=cc123_model,
                prompt=prompt,
                image_path=image_path,
                seconds=int(cfg.get("duration", 15)),
                max_wait_sec=int(cfg.get("max_wait_sec", 1800)),
                poll_interval=int(cfg.get("poll_interval", 10)),
            )
        )

        if not result.success:
            return _fail_task(db, task, (result.error or "cc123 调用失败")[:500])

        task.output_file = result.local_video_path
        task.status = TaskStatus.SUCCESS
        cfg.update({
            "cc123_task_id": result.task_id,
            "cc123_polls": result.poll_count,
            "cc123_url": result.url,
        })
        task.config_json = cfg
        db.commit()
        logger.info(f"cc123 task {task_id} success, task_id={result.task_id}, file={result.local_video_path}")
        return {"ok": True, "task_id": result.task_id, "file": result.local_video_path, "polls": result.poll_count}
    except Exception as e:
        logger.exception(f"cc123 task {task_id} crashed")
        try:
            task = db.query(Task).filter(Task.id == task_id).first()
            return _fail_task(db, task, f"任务崩溃：{type(e).__name__}: {e}") if task else {"error": str(e)}
        except Exception:
            return {"error": str(e)}
    finally:
        db.close()
