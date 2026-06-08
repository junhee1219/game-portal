"""세션 쿠키 + 비밀번호 해싱.

- 세션: itsdangerous 서명 쿠키 (stateless, 서버 세션 스토어 불필요).
- 해시: bcrypt(cost=12) 직접. 비번 72바이트 truncation 회피 위해 입력 64자 상한.
- Secure 쿠키: base_url이 https일 때만 (http:8080 환경에선 못 단다 — certbot 붙으면 자동 True).
"""
import logging
import secrets

import bcrypt
from fastapi import Request
from fastapi.responses import Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app import database
from app.config import settings

logger = logging.getLogger(__name__)

SESSION_COOKIE = "gp_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30일
PASSWORD_MAX_LEN = 64

_secret = settings.secret_key
if not _secret:
    _secret = secrets.token_urlsafe(32)
    logger.warning(
        "SECRET_KEY 미설정 — 임시 랜덤 키 생성. 재시작마다 전 세션 무효화됩니다. "
        "prod는 .env에 SECRET_KEY를 고정하세요."
    )

_serializer = URLSafeTimedSerializer(_secret, salt="gp-session")


def hash_password(password: str) -> str:
    pw = password[:PASSWORD_MAX_LEN].encode("utf-8")
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(password[:PASSWORD_MAX_LEN].encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _secure_cookie() -> bool:
    return settings.base_url.startswith("https")


def set_session_cookie(resp: Response, user_id: str) -> None:
    resp.set_cookie(
        SESSION_COOKIE,
        _serializer.dumps(user_id),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=_secure_cookie(),
        path="/",
    )


def clear_session_cookie(resp: Response) -> None:
    resp.delete_cookie(SESSION_COOKIE, path="/")


def read_session(request: Request) -> str | None:
    """쿠키에서 user_id 추출. 위조/만료면 None."""
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    try:
        return _serializer.loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None


async def current_user(request: Request):
    """로그인 user 행 반환, 비로그인/DB없음이면 None. 어떤 API도 로그인을 강제하지 않는다."""
    uid = read_session(request)
    if not uid or database.async_session is None:
        return None
    from app.models import User

    async with database.async_session() as db:
        return await db.get(User, uid)
