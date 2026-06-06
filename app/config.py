"""게임 포털 설정. .env에서 로드."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # DB 없이도 포털/게임 서빙은 동작해야 한다 (계측만 죽음)
    database_url: str = ""
    env: str = "dev"  # dev | prod


settings = Settings()
