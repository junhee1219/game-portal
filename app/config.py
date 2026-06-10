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
    # 운영 origin은 서버 .env(BASE_URL)에서 주입. 기본값은 공개 도메인 — 원본 서버 IP를
    # repo(public)에 남기지 않는다. (kakao redirect_uri · secure 쿠키 판정에 쓰임)
    base_url: str = "https://mini-game.kr"

    # 세션 쿠키 서명 키. prod는 .env로 고정 (없으면 재시작마다 전 세션 무효).
    # 비어 있으면 auth_session이 임시 랜덤 키를 생성하고 경고 로그를 남긴다.
    secret_key: str = ""

    # 후원 링크 (토스/카카오뱅크). 개인 금융 식별자라 서버 .env에만 두고 커밋 금지.
    # 둘 다 비어 있으면 후원 버튼/모달이 아예 노출되지 않는다.
    support_toss_url: str = ""
    support_kakaobank_url: str = ""

    # 검색엔진 소유확인(site verification) 코드. 비어 있으면 해당 메타태그를 아예 안 박는다
    # (빈 content는 없는 것만 못함). Google Search Console / Naver 서치어드바이저에서 발급받아
    # 서버 .env(GOOGLE_SITE_VERIFICATION / NAVER_SITE_VERIFICATION)에 넣고 재시작 → 홈에 노출.
    google_site_verification: str = ""
    naver_site_verification: str = ""


settings = Settings()
