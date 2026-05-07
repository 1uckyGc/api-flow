from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, JSON, Text
from sqlalchemy.sql import func
from app.database import Base


class ApiCallLog(Base):
    """每次外部 AI 调用的本地审计行（HOLO / Flow2API / Grok 通用）。"""
    __tablename__ = "api_call_log"

    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), index=True, nullable=True)
    task_id         = Column(String, ForeignKey("tasks.id"), index=True, nullable=True)
    group_id        = Column(String, ForeignKey("task_groups.id"), index=True, nullable=True)

    provider        = Column(String, index=True, nullable=False)      # holo / flow2api / grok
    model           = Column(String, nullable=False)
    task_type       = Column(String, nullable=True)                   # t2i / i2i / t2v / i2v / r2v / r2i / unknown

    holo_task_id    = Column(String, index=True, nullable=True)
    cost            = Column(Integer, nullable=True)                  # HOLO 才有
    refunded        = Column(Boolean, default=False, nullable=False)

    status          = Column(String, index=True, nullable=False)      # submitted / completed / failed / cancelled
    latency_ms      = Column(Integer, nullable=True)
    error_msg       = Column(Text, nullable=True)
    request_summary = Column(JSON, nullable=True)                     # 截断 prompt / aspect_ratio / image_count 等

    created_at      = Column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)
    completed_at    = Column(DateTime(timezone=True), nullable=True)
