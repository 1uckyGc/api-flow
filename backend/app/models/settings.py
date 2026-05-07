from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)

    # 1. 任务调度与并发控制
    max_concurrent_tasks = Column(Integer, default=3)
    submission_delay_ms = Column(Integer, default=2000)
    max_retries = Column(Integer, default=3)
    trim_tail_frames = Column(Integer, default=9)

    # 2. 模型与 API 密钥管理
    veo_api_key = Column(String, nullable=True)
    gemini_api_key = Column(String, nullable=True)
    allow_fallback_model = Column(Boolean, default=True)

    # 3. 存储与系统策略
    auto_cleanup_failed_tasks = Column(Boolean, default=False)
    source_file_retention_days = Column(Integer, default=30)
    theme = Column(String, default="light")

    user = relationship("User", back_populates="settings")
