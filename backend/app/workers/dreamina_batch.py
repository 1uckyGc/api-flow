"""Sequential batch executor for Dreamina Seedance i2v.

Why this exists:
- Dreamina is single-account OAuth, parallel submits burn credits + race the queue.
- Existing process_generation fires N tasks in parallel via Celery delay() — when
  model == dreamina/seedance*, that's wrong. This task takes a group_id, runs all
  its tasks **serially**, and pushes live progress (queue position / status /
  fail reason) to the frontend every 60 s.

Trigger: app/routers/tasks.py detects `config_json.model.startswith("dreamina/seedance")`
and dispatches `run_dreamina_serial_batch.delay(group_id)` instead of N delay() calls.
"""
import os
import re
from typing import Optional

from app.database import SessionLocal
from app.models.task import Task, TaskGroup, TaskStatus, GroupStatus
from app.services.dreamina_client import DreaminaClient
from app.services.model_registry import strip_provider_prefix
from app.utils.logger import logger
from app.workers._ws_sync import notify_ws_sync
from app.workers.celery_app import celery_app
from app.workers.tasks import extract_video_poster


def _query_dreamina_account() -> dict:
    """运行 `dreamina user_credit`，提取 credits 数字。
    未登录 / 解析失败都不致命，返回 {}。
    """
    try:
        client = DreaminaClient()
        credits = client.user_credit()
        if credits is None:
            return {}
        return {"credits": credits}
    except Exception as e:
        logger.warning(f"_query_dreamina_account failed: {e}")
        return {}


def _account_summary(acct: dict) -> str:
    """单行字符串。空 dict → '账户未知'。"""
    if not acct:
        return "账户未知"
    parts = []
    if "credits" in acct:
        parts.append(f"credits {acct['credits']}")
    return " · ".join(parts) or "账户未知"


def _pick_resolution(model_version: str, cfg: dict) -> str:
    """复用 dispatcher.py 的 vip-gating：非 vip 模型强制 720p。"""
    res = (cfg or {}).get("video_resolution") or "720p"
    if res != "720p" and "vip" not in (model_version or "").lower():
        logger.info(f"dreamina_batch: forcing {res} → 720p (model {model_version} not vip)")
        res = "720p"
    return res


def _resolve_input_image(raw: str) -> Optional[str]:
    """input_files 里存的可能是 'outputs/xxx.png' 相对路径；container 内绝对路径在 /app 下。"""
    if not raw:
        return None
    if os.path.isabs(raw) and os.path.exists(raw):
        return raw
    candidates = [raw, os.path.join("/app", raw)]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


@celery_app.task(name="app.workers.dreamina_batch.run_dreamina_serial_batch")
def run_dreamina_serial_batch(group_id: str) -> dict:
    """串行跑某 group 的全部 task，每条 dreamina i2v 跑完才发下一条。"""
    db = SessionLocal()
    try:
        group = db.query(TaskGroup).filter(TaskGroup.id == group_id).first()
        if not group:
            logger.error(f"dreamina_batch: group {group_id} not found")
            return {"error": "group not found"}

        tasks = (
            db.query(Task)
            .filter(Task.group_id == group_id)
            .order_by(Task.created_at.asc())
            .all()
        )
        if not tasks:
            logger.warning(f"dreamina_batch: group {group_id} has 0 tasks")
            return {"completed": 0, "failed": 0, "total": 0}

        model_full = (group.config_json or {}).get("model", "")
        model_version = strip_provider_prefix(model_full) or "seedance2.0fast"
        cfg = group.config_json or {}
        duration = int(cfg.get("seconds") or cfg.get("duration") or 15)
        video_resolution = _pick_resolution(model_version, cfg)

        account = _query_dreamina_account()
        acct_str = _account_summary(account)

        total = len(tasks)
        completed = 0
        failed = 0
        client = DreaminaClient()
        user_id = group.user_id

        # 任务组开始
        group.status = GroupStatus.PROCESSING
        db.commit()

        for i, task in enumerate(tasks):
            # 1. 标 RUNNING + 推一次起点进度
            task.status = TaskStatus.RUNNING
            head_msg = (
                f"任务 {i+1}/{total} 启动 · 本批完成 {completed} 失败 {failed} "
                f"剩余 {total-i-1} · Dreamina {acct_str}"
            )
            task.progress_message = head_msg
            group.progress_message = head_msg
            db.commit()
            notify_ws_sync(user_id, {"type": "TASK_PROGRESS", "task_id": task.id, "message": head_msg})
            notify_ws_sync(user_id, {"type": "GROUP_PROGRESS", "group_id": group_id, "message": head_msg})
            notify_ws_sync(user_id, {"type": "TASK_UPDATE"})

            # 2. progress_callback 闭包：dreamina_client 每 60s 调一次
            #    注意：这里在 Celery worker 主线程同步执行，能直接 db.commit
            def make_cb(t: Task, idx: int):
                def _cb(info: dict) -> None:
                    q = info.get("queue_idx")
                    gs = info.get("gen_status")
                    fr = info.get("fail_reason")
                    elapsed = info.get("elapsed_sec", 0)
                    # queue_idx > 0 是真实排队位置，优先用它判定（实测 dreamina 排队时
                    # gen_status="querying" + queue_info.queue_idx=N，旧逻辑会丢掉 N 走渲染中）
                    if q is not None and q > 0:
                        phase = f"排队中 · 队列位置 {q}"
                    elif gs == "success":
                        phase = "下载中"
                    elif gs == "fail":
                        phase = f"失败 ({fr or '原因未知'})"
                    elif gs == "submitted":
                        phase = "已提交"
                    elif gs in ("querying", "queuing"):
                        # queue_idx is None/0 但 status 仍在 querying → 真正在渲染
                        phase = "渲染中"
                    else:
                        phase = f"运行中 ({gs or '?'})"
                    m = (
                        f"任务 {idx+1}/{total} · {phase} · 已耗时 {elapsed}s · "
                        f"本批完成 {completed} 失败 {failed} 剩余 {total-idx-1} · "
                        f"Dreamina {acct_str}"
                    )
                    try:
                        t.progress_message = m
                        group.progress_message = m
                        db.commit()
                    except Exception as e:
                        logger.warning(f"dreamina_batch cb commit failed: {e}")
                        db.rollback()
                    notify_ws_sync(user_id, {"type": "TASK_PROGRESS", "task_id": t.id, "message": m})
                    notify_ws_sync(user_id, {"type": "GROUP_PROGRESS", "group_id": group_id, "message": m})
                return _cb

            # 3. 实跑 image2video
            img_path = _resolve_input_image((task.input_files or [None])[0])
            if not img_path:
                task.status = TaskStatus.FAILED
                task.error_message = f"输入图文件不存在: {(task.input_files or ['?'])[0]}"
                failed += 1
                db.commit()
                notify_ws_sync(user_id, {"type": "TASK_UPDATE"})
                continue

            try:
                result = client.image2video(
                    image_path=img_path,
                    prompt=task.prompt or "",
                    model_version=model_version,
                    duration=duration,
                    video_resolution=video_resolution,
                    progress_callback=make_cb(task, i),
                )
                if result.success and result.local_video_path:
                    task.output_file = result.local_video_path
                    # 提取首帧作为视频封面（前端 <video poster> 用）
                    try:
                        poster_path = extract_video_poster(result.local_video_path)
                        if poster_path:
                            if poster_path.startswith("outputs/"):
                                task.output_thumbnail = poster_path
                            else:
                                task.output_thumbnail = os.path.join("outputs", os.path.basename(poster_path)).replace("\\", "/")
                    except Exception as pe:
                        logger.warning(f"dreamina_batch poster extract failed for task {task.id}: {pe}")
                    task.status = TaskStatus.SUCCESS
                    completed += 1
                    final_msg = (
                        f"任务 {i+1}/{total} 完成 · 本批完成 {completed} 失败 {failed} "
                        f"剩余 {total-i-1}"
                    )
                else:
                    task.status = TaskStatus.FAILED
                    task.error_message = result.fail_reason or "Dreamina 任务失败"
                    failed += 1
                    final_msg = (
                        f"任务 {i+1}/{total} 失败 ({task.error_message[:80]}) · "
                        f"本批完成 {completed} 失败 {failed} 剩余 {total-i-1}"
                    )
            except Exception as e:
                logger.error(f"dreamina_batch task {task.id} crashed: {e}")
                task.status = TaskStatus.FAILED
                task.error_message = str(e)[:300]
                failed += 1
                final_msg = (
                    f"任务 {i+1}/{total} 异常 · 本批完成 {completed} 失败 {failed} "
                    f"剩余 {total-i-1}"
                )

            task.progress_message = final_msg
            group.progress_message = final_msg
            db.commit()
            notify_ws_sync(user_id, {"type": "TASK_PROGRESS", "task_id": task.id, "message": final_msg})
            notify_ws_sync(user_id, {"type": "GROUP_PROGRESS", "group_id": group_id, "message": final_msg})
            notify_ws_sync(user_id, {"type": "TASK_UPDATE"})

        # 4. 收尾
        if failed == 0:
            group.status = GroupStatus.COMPLETED
        elif completed == 0:
            group.status = GroupStatus.FAILED
        else:
            group.status = GroupStatus.COMPLETED  # 部分成功视为完成
        group.completed_count = completed
        group.failed_count = failed
        group.progress_message = f"批次完成：成功 {completed} / 失败 {failed} / 总计 {total}"
        db.commit()
        notify_ws_sync(user_id, {"type": "TASK_UPDATE"})
        return {"completed": completed, "failed": failed, "total": total}
    except Exception as e:
        logger.error(f"run_dreamina_serial_batch crashed: {e}", exc_info=True)
        db.rollback()
        return {"error": str(e)}
    finally:
        db.close()
