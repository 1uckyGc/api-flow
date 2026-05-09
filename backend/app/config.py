from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator

class Settings(BaseSettings):
    PROJECT_NAME: str = "FollowmeeeAIGC API"
    VERSION: str = "1.0.0"
    
    # Database
    DATABASE_URL: str
    
    # Redis & Celery
    CELERY_BROKER_URL: str = "redis://localhost:6380/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6380/0"
    CELERY_TASK_ALWAYS_EAGER: bool = True  # 开发和本地无 Redis 环境下开启，设为 False 恢复队列模式
    
    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:81"
    
    # JWT
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # 集中身份：把 api-flow 登录代理到 followmeee.co/api/login
    FOLLOWMEEE_AUTH_URL: str = "https://followmeee.co"

    # 离线 admin 兜底（followmeee.co 不可达时仍可登）
    # EMERGENCY_ADMIN_PASSWORD_HASH 留空 → 兜底通道关闭
    EMERGENCY_ADMIN_USERNAME: str = "admin"
    EMERGENCY_ADMIN_PASSWORD_HASH: str = ""
    
    # AI APIs
    # 老字段：作为 HOLO/FLOW2API 未填时的兜底（向后兼容）
    AI_API_URL: str = "http://localhost:8000"
    AI_API_KEY: str = ""
    AI_PROVIDER: str = "holo"  # 仅作为模型名命中不到任何 provider 规则时的兜底
    AI_POLL_TIMEOUT: int = 600
    AI_POLL_INTERVAL: float = 5.0

    # 三套显式 provider 凭据（推荐使用，不再共用 AI_API_*）
    HOLO_API_URL: str = ""
    HOLO_API_KEY: str = ""
    FLOW2API_URL: str = ""
    FLOW2API_KEY: str = ""

    # Worker 推 WS 通知到 backend 的内部地址
    # Docker: http://backend:8000；本地: http://127.0.0.1:8000
    WEB_API_URL: str = "http://127.0.0.1:8000"
    
    # DeepSeek
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_API_URL: str = "https://api.deepseek.com/chat/completions"
    DEEPSEEK_MODEL: str = "deepseek-chat"
    
    # Grok2API (grok2api gateway service)
    GROK_API_URL: str = "http://localhost:8001"
    GROK_API_KEY: str = ""

    # PackyAPI (Gemini OpenAI-shape gateway, 用于 /replicate 自动模式)
    PACKYAPI_BASE_URL: str = "https://www.packyapi.com"
    PACKYAPI_GEMINI_KEY: str = ""

    # cc123.ai relay (第三方 Seedance 2.0 video gen，OpenAI 形态 /v1/video/generations)
    CC123_BASE_URL: str = "https://cc123.ai"
    CC123_API_KEY: str = ""

    MAX_RETRIES: int = 3

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
    
    @model_validator(mode="after")
    def _validate_secrets(self):
        if not self.SECRET_KEY:
            raise ValueError("SECRET_KEY 未设置，请在 .env 中配置")
        return self
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
