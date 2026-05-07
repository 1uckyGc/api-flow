"""定时清理任务：滚动删除 30 天以前的 ApiCallLog 记录。

由 Celery Beat 调度，每天凌晨 03:30 执行。
"""
from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models.api_call_log import ApiCallLog
from app.utils.logger import logger
from app.workers.celery_app import celery_app


RETENTION_DAYS = 30


@celery_app.task(name="app.workers.cleanup_tasks.purge_old_logs")
def purge_old_logs() -> dict:
    """删除 created_at < (now - RETENTION_DAYS) 的 ApiCallLog 行。"""
    cutoff = datetime.utcnow() - timedelta(days=RETENTION_DAYS)
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
