from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PROJECT_NAME: str = "Yoinker API"
    API_V1_STR: str = "/api/v1"
    DATABASE_URL: str = "sqlite:///./yoinker.db"
    SECRET_KEY: str = "CHANGE_THIS_SECRET_FOR_PRODUCTION"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7
    MEDIA_ROOT: str = "media"
    FFMPEG_LOCATION: str = ""
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    PUBLIC_WEB_URL: str = "http://localhost:5173"
    API_BASE_URL: str = "http://localhost:8000"
    WORKER_POLL_INTERVAL_SECONDS: float = 2.0
    WORKER_JOB_TIMEOUT_SECONDS: int = 900
    DISCOVERY_STREAM_TTL_SECONDS: int = 900
    SEARCH_CACHE_TTL_SECONDS: int = 180
    PROVIDER_SEARCH_TIMEOUT_SECONDS: int = 8
    CANONICAL_HINT_TIMEOUT_SECONDS: int = 2

    @property
    def media_root_path(self) -> Path:
        return Path(self.MEDIA_ROOT).resolve()

    @property
    def cors_origins_list(self) -> list[str]:
        value = self.CORS_ORIGINS.strip()
        if not value:
            return []
        if value.startswith("["):
            import json

            return json.loads(value)
        return [item.strip() for item in value.split(",") if item.strip()]


settings = Settings()
