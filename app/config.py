"""게임 포털 설정. .env에서 로드."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # DB 없이도 포털/게임 서빙은 동작해야 한다 (계측만 죽음)
    database_url: str = ""
    env: str = "dev"  # dev | prod

    # 카카오 로그인 (키가 비어 있으면 라우트 비활성)
    # 활성화 조건: 카카오 개발자 콘솔에서 앱 생성 + redirect URI 등록 필요
    kakao_rest_api_key: str = ""
    kakao_client_secret: str = ""
    base_url: str = "http://158.179.178.70:8080"  # 도메인 연결 후 교체


settings = Settings()
