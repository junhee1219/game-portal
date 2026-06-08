"""카카오 로그인.

⚠ 키 미설정 시 전체 비활성 (501). 활성화하려면:
1. 카카오 개발자 콘솔(developers.kakao.com)에서 앱 생성
2. 플랫폼 > Web에 도메인 등록, Redirect URI = {BASE_URL}/auth/kakao/callback
3. .env에 KAKAO_REST_API_KEY / KAKAO_CLIENT_SECRET 추가 후 재시작

흐름: /auth/kakao/login?vid={visitor_id} → 카카오 동의 → callback에서
kakao_id로 User upsert(없으면 가입) → 세션 쿠키 발급 → 이 디바이스의
익명 기록을 user로 귀속(claim_visitor). 자체 로그인과 동일 레벨.
"""
import logging
import uuid

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import database
from app.auth_session import set_session_cookie
from app.config import settings
from app.models import User
from app.routers.users import claim_visitor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/kakao")

KAUTH = "https://kauth.kakao.com"
KAPI = "https://kapi.kakao.com"

NICK_MAX = 16  # 자체 가입과 동일 상한 (표시 일관성)


async def _upsert_kakao_user(db, kakao_id: str, kakao_nick: str | None) -> str:
    """kakao_id로 User 조회, 없으면 신규 가입. user.id 반환.

    닉네임 유니크 충돌은 suffix로 회피하되, 최종 안전망은 IntegrityError 재시도
    (register()와 동일 패턴 — pre-check만 믿지 않는다).
    """
    existing = (
        await db.execute(select(User).where(User.kakao_id == kakao_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing.id

    base = (kakao_nick or "게이머").strip()[:NICK_MAX - 4] or "게이머"
    candidate = (kakao_nick or "게이머").strip()[:NICK_MAX] or "게이머"
    for attempt in range(6):
        nickname = candidate if attempt == 0 else f"{base}{uuid.uuid4().hex[:4]}"
        user = User(
            id=uuid.uuid4().hex,
            nickname=nickname,
            password_hash=None,
            kakao_id=kakao_id,
        )
        db.add(user)
        try:
            await db.flush()
            return user.id
        except IntegrityError:
            await db.rollback()
            # kakao_id가 동시에 박혔을 수도 → 다시 조회해 그 user 사용
            existing = (
                await db.execute(select(User).where(User.kakao_id == kakao_id))
            ).scalar_one_or_none()
            if existing is not None:
                return existing.id
            # 아니면 닉네임 충돌 → 다음 suffix로 재시도
    raise RuntimeError("kakao user 닉네임 충돌 회피 실패")


def _enabled() -> bool:
    return bool(settings.kakao_rest_api_key and database.async_session is not None)


@router.get("/login")
async def kakao_login(vid: str = ""):
    if not _enabled():
        raise HTTPException(status_code=501, detail="카카오 로그인 미설정")
    redirect_uri = f"{settings.base_url}/auth/kakao/callback"
    url = (
        f"{KAUTH}/oauth/authorize?response_type=code"
        f"&client_id={settings.kakao_rest_api_key}"
        f"&redirect_uri={redirect_uri}"
        f"&state={vid[:64]}"
    )
    return RedirectResponse(url=url, status_code=302)


@router.get("/callback")
async def kakao_callback(code: str = "", state: str = "", error: str = ""):
    if not _enabled():
        raise HTTPException(status_code=501, detail="카카오 로그인 미설정")
    if error or not code:
        return RedirectResponse(url="/", status_code=302)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            token_res = await client.post(
                f"{KAUTH}/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": settings.kakao_rest_api_key,
                    "client_secret": settings.kakao_client_secret,
                    "redirect_uri": f"{settings.base_url}/auth/kakao/callback",
                    "code": code,
                },
            )
            token_res.raise_for_status()
            access_token = token_res.json()["access_token"]

            me_res = await client.get(
                f"{KAPI}/v2/user/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            me_res.raise_for_status()
            me = me_res.json()

        kakao_id = str(me["id"])
        kakao_nick = (me.get("properties") or {}).get("nickname")

        async with database.async_session() as db:
            user_id = await _upsert_kakao_user(db, kakao_id, kakao_nick)
            await db.commit()
            # 이 디바이스(state=vid)의 익명 기록을 user로 귀속 (자체 commit 포함)
            await claim_visitor(db, state or None, user_id)

        resp = RedirectResponse(url="/rank", status_code=302)
        set_session_cookie(resp, user_id)
        return resp
    except Exception:
        logger.exception("카카오 로그인 실패")
        return RedirectResponse(url="/", status_code=302)
