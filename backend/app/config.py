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
    
    # AI APIs
    AI_API_URL: str = "http://localhost:8000"
    AI_API_KEY: str = ""
    AI_PROVIDER: str = "flow2api"  # "flow2api" (SSE 流式) | "holo" (异步轮询)
    AI_POLL_TIMEOUT: int = 600     # HOLO 轮询超时（秒）
    AI_POLL_INTERVAL: float = 5.0  # HOLO 轮询间隔（秒）

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
