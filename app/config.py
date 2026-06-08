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

    # 세션 쿠키 서명 키. prod는 .env로 고정 (없으면 재시작마다 전 세션 무효).
    # 비어 있으면 auth_session이 임시 랜덤 키를 생성하고 경고 로그를 남긴다.
    secret_key: str = ""

    # 후원 링크 (토스/카카오뱅크). 개인 금융 식별자라 서버 .env에만 두고 커밋 금지.
    # 둘 다 비어 있으면 후원 버튼/모달이 아예 노출되지 않는다.
    support_toss_url: str = ""
    support_kakaobank_url: str = ""


settings = Settings()
