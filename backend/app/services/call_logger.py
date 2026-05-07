"""
ApiCallLog 埋点工具：在 dispatcher 入口/出口处调用，记录每次外部 AI 调用。

设计要点：
- 各函数自管 SessionLocal 短事务，不依赖外部 db（worker 协程上下文里的 db 不能跨 await 共享）
- 失败不抛 — 任何写日志失败都只 logger.warning，避免影响主任务
"""
from datetime import datetime
from typing import Optional

from app.database import SessionLocal
from app.models.api_call_log import ApiCallLog
from app.utils.logger import logger


def record_api_call(
    user_id: Optional[int],
    task_id: Optional[str],
    group_id: Optional[str],
    provider: str,
    model: str,
    task_type: Optional[str],
    request_summary: Optional[dict] = None,
) -> Optional[int]:
    """记录一次新调用为 'submitted' 状态。返回 log_id，失败返回 None。"""
    db = SessionLocal()
    try:
        row = ApiCallLog(
            user_id=user_id,
            task_id=task_id,
            group_id=group_id,
            provider=provider,
            model=model,
            task_type=task_type,
            request_summary=request_summary,
            status="submitted",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.id
    except Exception as e:
        logger.warning(f"call_logger.record_api_call failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return None
    finally:
        db.close()


def complete_api_call(
    log_id: Optional[int],
    status: str,
    cost: Optional[int] = None,
    holo_task_id: Optional[str] = None,
    refunded: bool = False,
    latency_ms: Optional[int] = None,
    error_msg: Optional[str] = None,
) -> None:
    """结束一次调用：更新状态/成本/耗时/错误。任何错误只 warning 不抛。"""
    if log_id is None:
        return
    db = SessionLocal()
    try:
        row = db.query(ApiCallLog).filter(ApiCallLog.id == log_id).first()
        if not row:
            logger.warning(f"call_logger.complete_api_call: log_id {log_id} not found")
            return
        row.status = status
        if cost is not None:
            row.cost = cost
        if holo_task_id is not None:
            row.holo_task_id = holo_task_id
        if refunded:
            row.refunded = True
        if latency_ms is not None:
            row.latency_ms = latency_ms
        if error_msg:
            row.error_msg = error_msg[:2000]  # 截断防爆
        row.completed_at = datetime.utcnow()
        db.commit()
    except Exception as e:
        logger.warning(f"call_logger.complete_api_call failed (log_id={log_id}): {e}")
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()
