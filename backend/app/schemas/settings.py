from pydantic import BaseModel, ConfigDict
from typing import Optional

class SystemSettingsBase(BaseModel):
    max_concurrent_tasks: int = 3
    submission_delay_ms: int = 2000
    max_retries: int = 3
    trim_tail_frames: int = 9

    veo_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None
    allow_fallback_model: bool = True

    auto_cleanup_failed_tasks: bool = False
    source_file_retention_days: int = 30
    theme: str = "light"

class SystemSettingsUpdate(SystemSettingsBase):
    pass

class SystemSettingsResponse(SystemSettingsBase):
    id: int
    user_id: int

    model_config = ConfigDict(from_attributes=True)
