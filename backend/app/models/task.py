import uuid
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, Enum as SQLEnum, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from app.database import Base

class TaskType(str, enum.Enum):
    TEXT_TO_IMAGE = "text_to_image"
    IMAGE_TO_IMAGE = "image_to_image"
    TEXT_TO_VIDEO = "text_to_video"
    IMAGE_TO_VIDEO = "image_to_video"

class TaskSource(str, enum.Enum):
    TOOLBOX = "TOOLBOX"
    GALLERY = "GALLERY"
    PIPELINE = "PIPELINE"
    GALLERY_EXTEND = "GALLERY_EXTEND"
    FISSION = "FISSION"
    DIRECTOR = "DIRECTOR"
    DIRECTOR_VIDEO = "DIRECTOR_VIDEO"
    STORYBOARD_FISSION = "STORYBOARD_FISSION"
    STORYBOARD = "STORYBOARD"

class GroupStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    NEEDS_REVIEW = "needs_review"
    AWAITING_LLM_INPUT = "awaiting_llm_input"
    COMPLETED = "completed"
    FAILED = "failed"

class TaskStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    RETRY = "retry"

class TaskGroup(Base):
    __tablename__ = "task_groups"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String, nullable=False)
    task_type = Column(SQLEnum(TaskType), nullable=False)
    source = Column(SQLEnum(TaskSource), default=TaskSource.TOOLBOX)
    status = Column(SQLEnum(GroupStatus), default=GroupStatus.PENDING)
    
    global_prompt = Column(String, nullable=True)
    config_json = Column(JSON, default=dict)
    progress_message = Column(String, nullable=True)
    
    # 裂变专属的血缘追踪阶段
    fission_parent_id = Column(String, ForeignKey("task_groups.id"), nullable=True)
    fission_stage = Column(String, nullable=True) # e.g. 'images', 'videos', 'extended'

    # 工作流关联
    workflow_run_id = Column(String, ForeignKey("workflow_runs.id"), nullable=True)
    workflow_step_index = Column(Integer, nullable=True)
    
    total_count = Column(Integer, default=0)
    completed_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    tasks = relationship("Task", back_populates="group", order_by="Task.created_at", cascade="all, delete-orphan")
    user = relationship("User")

class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    group_id = Column(String, ForeignKey("task_groups.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    
    status = Column(SQLEnum(TaskStatus), default=TaskStatus.QUEUED)
    prompt = Column(String, nullable=True)
    input_files = Column(JSON, default=list) # e.g. ["uploads/ref1.png"]
    
    output_file = Column(String, nullable=True)
    output_thumbnail = Column(String, nullable=True)
    error_message = Column(String, nullable=True)
    
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    celery_task_id = Column(String, nullable=True)
    config_json = Column(JSON, default=dict) # 存储任务特定配置（如 index）
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    group = relationship("TaskGroup", back_populates="tasks")
    user = relationship("User")
