import enum
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, List, Any
from datetime import datetime, timezone
from app.models.task import TaskType, TaskSource, GroupStatus, TaskStatus

def ensure_utc(v: Any) -> Any:
    if isinstance(v, datetime) and v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v

class TaskBase(BaseModel):
    prompt: Optional[str] = None
    input_files: List[str] = []

class TaskResponse(TaskBase):
    id: str
    group_id: str
    status: TaskStatus
    output_file: Optional[str] = None
    output_thumbnail: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int
    config_json: Optional[dict] = Field(default_factory=dict)
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator('created_at', 'updated_at', mode='before')
    @classmethod
    def validate_tz(cls, v):
        return ensure_utc(v)

# 轻量版 Task 响应：列表 API 专用，不包含 prompt/input_files 等长文本
class TaskLiteResponse(BaseModel):
    id: str
    group_id: str
    prompt: Optional[str] = None
    status: TaskStatus
    output_file: Optional[str] = None
    output_thumbnail: Optional[str] = None
    input_files: List[str] = []
    error_message: Optional[str] = None
    config_json: Optional[dict] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)

class TaskGroupBase(BaseModel):
    title: str
    task_type: TaskType
    source: TaskSource = TaskSource.TOOLBOX
    global_prompt: Optional[str] = None
    config_json: dict = {}

    @field_validator('status', mode='before', check_fields=False)
    @classmethod
    def parse_status(cls, v):
        if isinstance(v, str):
            return v.lower()
        if hasattr(v, 'name'):
            return v.name.lower()
        return v

class TaskGroupCreate(TaskGroupBase):
    tasks: List[TaskBase]

class TaskGroupResponse(TaskGroupBase):
    id: str
    user_id: int
    status: GroupStatus
    total_count: int
    completed_count: int
    failed_count: int
    fission_parent_id: Optional[str] = None
    fission_stage: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    tasks: List[TaskResponse] = []

    model_config = ConfigDict(from_attributes=True)

    @field_validator('created_at', 'updated_at', mode='before')
    @classmethod
    def validate_tz(cls, v):
        return ensure_utc(v)

class TaskGroupListResponse(TaskGroupBase):
    id: str
    status: GroupStatus
    total_count: int
    completed_count: int
    failed_count: int
    fission_parent_id: Optional[str] = None
    fission_stage: Optional[str] = None
    progress_message: Optional[str] = None
    created_at: datetime
    
    # 使用轻量版 Task 响应，不序列化 prompt/input_files 等大字段
    tasks: List[TaskLiteResponse] = []

    model_config = ConfigDict(from_attributes=True)

    @field_validator('created_at', mode='before')
    @classmethod
    def validate_tz(cls, v):
        return ensure_utc(v)


class DirectorCreateRequest(BaseModel):
    """导演模式：剧本转分镜系列生成"""
    title: str
    product_files: List[str]
    script: str
    count: int = Field(ge=1, le=20)
    style: Optional[str] = None
    character_desc: Optional[str] = None
    model: str = "gemini-3.1-flash-image-portrait"
    video_model: str = "veo_3_1_i2v_s_fast_portrait_ultra_relaxed"

class DirectorConfirmRequest(BaseModel):
    director_scenes: List[dict]

class DirectorVideoRequest(BaseModel):
    """导演模式 Phase 2：分镜图 → 视频序列"""
    video_model: str = "veo_3_1_i2v_s_fast_portrait_ultra_relaxed"
    task_ids: Optional[List[str]] = None  # None 表示处理全量成功帧
    video_prompts: Optional[dict] = None  # form: {"task_id": "user prompt"}
