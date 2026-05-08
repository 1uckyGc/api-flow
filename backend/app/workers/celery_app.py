from celery import Celery
from celery.schedules import crontab
from app.config import settings
import os

# 确保 uploads 和 outputs 目录存在
os.makedirs("uploads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)

celery_app = Celery(
    "followmeeeaigc",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.workers.tasks",
        "app.workers.director_worker",
        "app.workers.workflow_worker",
        "app.workers.cleanup_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_always_eager=settings.CELERY_TASK_ALWAYS_EAGER,
    beat_schedule={
        "purge-old-api-call-logs": {
            "task": "app.workers.cleanup_tasks.purge_old_logs",
            "schedule": crontab(hour=3, minute=30),  # 每天凌晨 03:30 — 30 天滚动清 ApiCallLog
        },
        "purge-old-artifacts": {
            "task": "app.workers.cleanup_tasks.purge_old_artifacts",
            "schedule": crontab(hour=4, minute=0),  # 每天凌晨 04:00 — 3 天滚动清任务/文件/前端记录
        },
    },
)
