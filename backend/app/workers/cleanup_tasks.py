"""定时清理任务。

三个 Celery Beat 调度：
- purge_old_logs: 每天 03:30，清 30 天以前的 ApiCallLog 行
- purge_old_artifacts: 每天 04:00，清 3 天以前的任务（文件 + DB 行 + 前端记录）
- mark_zombie_running_failed: 每小时 :15，把 running/queued >2h 没更新的任务打成 failed

清理决策（用户已确认 A1 + B2 + C1）:
  A1: status=RUNNING 永远不删；QUEUED/RETRY 超 3 天视为僵尸一并删
  B2: 导演模式 NEEDS_REVIEW group 跟 success 一样 3 天清
  C1: fission 血缘链整链一起删
"""
import os
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from app.database import SessionLocal
from app.models.api_call_log import ApiCallLog
from app.models.task import Task, TaskGroup, TaskSource, TaskStatus
from app.utils.logger import logger
from app.workers.celery_app import celery_app


REPLICATE_BASE = Path("uploads/replicate")


RETENTION_DAYS_LOGS = 30
RETENTION_DAYS_ARTIFACTS = 3


@celery_app.task(name="app.workers.cleanup_tasks.purge_old_logs")
def purge_old_logs() -> dict:
    """删除 created_at < (now - 30d) 的 ApiCallLog 行。"""
    cutoff = datetime.utcnow() - timedelta(days=RETENTION_DAYS_LOGS)
    db = SessionLocal()
    try:
        deleted = (
            db.query(ApiCallLog)
            .filter(ApiCallLog.created_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        logger.info(f"purge_old_logs: deleted {deleted} rows older than {cutoff.isoformat()}")
        return {"deleted": deleted, "cutoff": cutoff.isoformat()}
    except Exception as e:
        db.rollback()
        logger.error(f"purge_old_logs failed: {e}")
        return {"error": str(e)}
    finally:
        db.close()


def _safe_remove(path: str | None) -> bool:
    """删单个文件，不存在或失败都吞掉。返回是否真删了。"""
    if not path:
        return False
    if not os.path.exists(path):
        return False
    try:
        os.remove(path)
        return True
    except Exception as e:
        logger.warning(f"purge: failed to remove {path}: {e}")
        return False


@celery_app.task(name="app.workers.cleanup_tasks.purge_old_artifacts")
def purge_old_artifacts() -> dict:
    """滚动清理 created_at < (now - 3d) 的 task_groups 及关联资源。

    保护规则:
      - 任意 sub task.status == RUNNING 的 group 不删（保护正在跑的）
      - 其他全部状态（SUCCESS / FAILED / RETRY / QUEUED / NEEDS_REVIEW）的 group 都清
      - 如果 group 整体没活跃 sub task 就视为可清

    清理动作：
      1. 先把 ApiCallLog 中指向待删 task/group 的 FK 置 NULL（保留账单审计行）
      2. 把 fission_parent_id 指向待删 group 的反向引用置 NULL（解锁自引用 FK）
      3. 物理删 task.output_file / output_thumbnail / input_files 路径
      4. 物理删 group.config_json["anchor_file"]（导演模式锚点）
      5. db.delete(group) — TaskGroup.tasks 关系定义了 cascade=delete-orphan，会自动级联删 tasks
    """
    cutoff = datetime.utcnow() - timedelta(days=RETENTION_DAYS_ARTIFACTS)
    db = SessionLocal()
    deleted_files = 0
    deleted_groups = 0
    deleted_tasks_estimate = 0
    skipped_active = 0
    try:
        # 1. 找候选老 group：created_at < cutoff
        candidate_groups = db.query(TaskGroup).filter(
            TaskGroup.created_at < cutoff
        ).all()

        # 2. 过滤掉有 RUNNING sub task 的 group（A1：保护跑中的）
        running_group_ids = {
            row[0] for row in
            db.query(Task.group_id).filter(Task.status == TaskStatus.RUNNING).distinct().all()
        }
        old_groups = [g for g in candidate_groups if g.id not in running_group_ids]
        skipped_active = len(candidate_groups) - len(old_groups)

        if not old_groups:
            logger.info(f"purge_old_artifacts: no old groups to clean (cutoff={cutoff.isoformat()}, skipped_active={skipped_active})")
            return {"deleted_groups": 0, "deleted_tasks": 0, "deleted_files": 0,
                    "skipped_active": skipped_active, "cutoff": cutoff.isoformat()}

        old_group_ids = [g.id for g in old_groups]

        # 3. 收集所有待删 task ids（用于解 ApiCallLog FK 和文件路径）
        all_task_ids = []
        for g in old_groups:
            for t in g.tasks:
                all_task_ids.append(t.id)
                deleted_tasks_estimate += 1

        # 4. ApiCallLog FK 解绑（保留行，置 task_id/group_id = NULL）
        if all_task_ids:
            db.query(ApiCallLog).filter(
                ApiCallLog.task_id.in_(all_task_ids)
            ).update({"task_id": None}, synchronize_session=False)
        db.query(ApiCallLog).filter(
            ApiCallLog.group_id.in_(old_group_ids)
        ).update({"group_id": None}, synchronize_session=False)

        # 5. fission_parent_id 反向引用解绑（C1：整链一起删，但保险起见把所有指向 in-list 的引用都置 NULL）
        db.query(TaskGroup).filter(
            TaskGroup.fission_parent_id.in_(old_group_ids)
        ).update({"fission_parent_id": None}, synchronize_session=False)
        db.flush()

        # 6. 物理删文件 + 删 group（cascade 删 sub tasks）
        for group in old_groups:
            # group 锚点（导演模式）
            anchor = (group.config_json or {}).get("anchor_file") if isinstance(group.config_json, dict) else None
            if _safe_remove(anchor):
                deleted_files += 1

            # 复刻视频作业的整个工作目录（uploads/replicate/<id>/）
            if group.source == TaskSource.STORYBOARD:
                workdir = REPLICATE_BASE / group.id
                # 双保险：再 resolve 一次防止 .. 越界
                try:
                    if workdir.exists() and str(workdir.resolve()).startswith(str(REPLICATE_BASE.resolve())):
                        shutil.rmtree(workdir)
                        deleted_files += 1
                except Exception as e:
                    logger.warning(f"purge: rmtree replicate workdir {workdir} failed: {e}")

            # sub tasks 的所有文件
            for t in group.tasks:
                # input_files 是 JSON list of paths
                inputs = t.input_files or []
                if isinstance(inputs, list):
                    for fp in inputs:
                        if isinstance(fp, str) and _safe_remove(fp):
                            deleted_files += 1
                if _safe_remove(t.output_file):
                    deleted_files += 1
                if _safe_remove(t.output_thumbnail):
                    deleted_files += 1

            db.delete(group)  # cascade 删 sub tasks
            deleted_groups += 1

        db.commit()
        result = {
            "deleted_groups": deleted_groups,
            "deleted_tasks": deleted_tasks_estimate,
            "deleted_files": deleted_files,
            "skipped_active": skipped_active,
            "cutoff": cutoff.isoformat(),
        }
        logger.info(f"purge_old_artifacts: {result}")
        return result
    except Exception as e:
        db.rollback()
        logger.error(f"purge_old_artifacts failed: {e}")
        return {"error": str(e)}
    finally:
        db.close()


ZOMBIE_HOURS = 2


@celery_app.task(name="app.workers.cleanup_tasks.mark_zombie_running_failed")
def mark_zombie_running_failed() -> dict:
    """把 status=running/queued 但 updated_at < now-2h 的任务统一打成 failed。

    用途：worker 崩溃/重启/网络断后会留下 RUNNING/QUEUED 状态的"卡住"任务，
    它们既不出图也不报错，UI 永远显示"生成中..."。本任务定期扫一遍兜底。
    """
    cutoff = datetime.utcnow() - timedelta(hours=ZOMBIE_HOURS)
    db = SessionLocal()
    try:
        zombies = db.query(Task).filter(
            Task.status.in_([TaskStatus.RUNNING, TaskStatus.QUEUED]),
            Task.updated_at < cutoff,
        ).all()
        if not zombies:
            return {"marked": 0, "cutoff": cutoff.isoformat()}

        msg = f"worker 长时间无响应（>{ZOMBIE_HOURS}h），系统自动标记失败。可点重试。"
        now = datetime.utcnow()
        for t in zombies:
            t.status = TaskStatus.FAILED
            t.error_message = msg
            t.updated_at = now
        group_ids = list({t.group_id for t in zombies if t.group_id})
        db.commit()

        # 同步刷新组状态。复用 workers.tasks.update_group_status（延迟 import 避免循环依赖）
        try:
            from app.workers.tasks import update_group_status
            for gid in group_ids:
                try:
                    update_group_status(db, gid)
                except Exception as e:
                    logger.warning(f"mark_zombie: group {gid} status refresh failed: {e}")
            db.commit()
        except Exception as e:
            logger.warning(f"mark_zombie: skipped group refresh ({e})")

        result = {
            "marked": len(zombies),
            "groups_refreshed": len(group_ids),
            "cutoff": cutoff.isoformat(),
        }
        logger.info(f"mark_zombie_running_failed: {result}")
        return result
    except Exception as e:
        db.rollback()
        logger.error(f"mark_zombie_running_failed failed: {e}")
        return {"error": str(e)}
    finally:
        db.close()
