from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "MuFiBu"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "postgresql://mufibu:mufibu@localhost:5432/mufibu"

    # JWT
    JWT_SECRET_KEY: str = "change-me-in-production-use-strong-random-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost", "http://localhost:80", "http://localhost:3000"]

    # First PowerAdmin seed (created on first startup if no users exist)
    SEED_ADMIN_USERNAME: str = "poweradmin"
    SEED_ADMIN_EMAIL: str = "poweradmin@mufibu.local"
    SEED_ADMIN_PASSWORD: str = "ChangeMe1!"

    class Config:
        env_file = "/etc/mufibu/backend.env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
