from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, List, Any
from datetime import datetime, timezone
from app.models.workflow import WorkflowRunStatus


def ensure_utc(v: Any) -> Any:
    if isinstance(v, datetime) and v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


# ── Step 配置 ──

class StepConfig(BaseModel):
    """单个积木块的配置"""
    model_config = ConfigDict(extra="allow")

    model: Optional[str] = None
    system_prompt: Optional[str] = None
    user_template: Optional[str] = None
    count: Optional[int] = None
    aspect_ratio: Optional[str] = None
    images_per_prompt: Optional[int] = None
    prompt_mode: Optional[str] = None
    duration: Optional[int] = None


class StepDefinition(BaseModel):
    """工作流中一个步骤的完整定义"""
    type: str
    label: str
    config: StepConfig = Field(default_factory=StepConfig)


# ── Workflow 模板 CRUD ──

class WorkflowCreate(BaseModel):
    title: str
    description: Optional[str] = None
    steps_json: List[StepDefinition]
    input_schema: Optional[dict] = None


class WorkflowUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    steps_json: Optional[List[StepDefinition]] = None
    input_schema: Optional[dict] = None


class WorkflowResponse(BaseModel):
    id: str
    user_id: int
    title: str
    description: Optional[str] = None
    steps_json: List[dict] = []
    input_schema: Optional[dict] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator('created_at', 'updated_at', mode='before')
    @classmethod
    def validate_tz(cls, v):
        return ensure_utc(v)


class WorkflowListItem(BaseModel):
    """列表页用的轻量响应"""
    id: str
    title: str
    description: Optional[str] = None
    step_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator('created_at', 'updated_at', mode='before')
    @classmethod
    def validate_tz(cls, v):
        return ensure_utc(v)


# ── WorkflowRun 执行实例 ──

class WorkflowRunCreate(BaseModel):
    """启动工作流执行"""
    title: Optional[str] = None
    input_files: List[str] = []
    input_prompts: List[str] = []


class StepState(BaseModel):
    """单个步骤的运行时状态"""
    step_index: int
    type: str
    status: str = "pending"
    task_group_id: Optional[str] = None
    output_files: List[str] = []
    output_prompts: List[str] = []
    stats: Optional[dict] = None
    error: Optional[str] = None


class WorkflowRunResponse(BaseModel):
    id: str
    workflow_id: str
    user_id: int
    title: Optional[str] = None
    status: WorkflowRunStatus
    current_step: int = 0
    steps_state: Optional[List[dict]] = None
    input_files: Optional[List[str]] = None
    input_prompts: Optional[List[str]] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator('created_at', 'updated_at', mode='before')
    @classmethod
    def validate_tz(cls, v):
        return ensure_utc(v)


class WorkflowRunListItem(BaseModel):
    """执行记录列表用的轻量响应"""
    id: str
    workflow_id: str
    title: Optional[str] = None
    status: WorkflowRunStatus
    current_step: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator('created_at', mode='before')
    @classmethod
    def validate_tz(cls, v):
        return ensure_utc(v)


# ── 审核提交 ──

class ReviewSubmit(BaseModel):
    """人工审核步骤：用户选择保留的文件"""
    selected_files: List[str]
    selected_prompts: Optional[List[str]] = None


# ── 导入/导出 ──

class WorkflowExport(BaseModel):
    """导出格式"""
    title: str
    description: Optional[str] = None
    steps_json: List[dict]
    input_schema: Optional[dict] = None
    version: str = "1.0"
