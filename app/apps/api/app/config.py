from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    NODE_ENV: Literal["development", "test", "production"] = "development"
    PORT: int = 3000
    PUBLIC_URL: str = "http://localhost:8080"
    DATABASE_URL: str = "postgresql+asyncpg://treinow:treinow@localhost:5432/treinow"
    REDIS_URL: str = "redis://:change-me@localhost:6379"
    SESSION_SECRET: str = "development-only-session-secret-change"
    CSRF_SECRET: str = "development-only-csrf-secret-change-now"
    MINIO_ENDPOINT: str = "http://localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin-change"
    MINIO_BUCKET: str = "trainow"
    GDRIVE_BUCKET: str = "trainow"
    TTS_MODELS_DIR: str = "/app/models/kokoro-int8-multi-lang-v1_0"
    TTS_VOICE: str = "pm_alex"
    TTS_CACHE_DIR: str = "/data/tts-cache"
    TTS_ENABLED: bool = True
    TTS_SPEED: float = Field(default=0.95, gt=0, le=3)
    VIDEO_STORAGE_PROVIDER: Literal["gdrive", "s3"] = "gdrive"
    PLAN_ENGINE: Literal["rules", "gemini"] = "rules"
    GEMINI_API_KEY: str | None = None
    GEMINI_PLAN_MODEL: str = "gemini-3.1-pro-preview"
    GEMINI_FALLBACK_MODEL: str = "gemini-3.5-flash"

    @field_validator("SESSION_SECRET", "CSRF_SECRET")
    @classmethod
    def _min_length(cls, value: str) -> str:
        if len(value) < 32:
            raise ValueError("must be at least 32 characters")
        return value


@lru_cache
def get_config() -> Config:
    return Config()


config = get_config()
