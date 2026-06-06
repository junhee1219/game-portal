"""카카오 로그인.

⚠ 키 미설정 시 전체 비활성 (501). 활성화하려면:
1. 카카오 개발자 콘솔(developers.kakao.com)에서 앱 생성
2. 플랫폼 > Web에 도메인 등록, Redirect URI = {BASE_URL}/auth/kakao/callback
3. .env에 KAKAO_REST_API_KEY / KAKAO_CLIENT_SECRET 추가 후 재시작

흐름: /auth/kakao/login?vid={visitor_id} → 카카오 동의 → callback에서
visitor 행에 kakao_id/nickname 연결. 익명 방문 기록과 자연 합류.
"""
import logging

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from app import database
from app.config import settings
from app.models import Visitor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/kakao")

KAUTH = "https://kauth.kakao.com"
KAPI = "https://kapi.kakao.com"


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
        nickname = (me.get("properties") or {}).get("nickname")

        async with database.async_session() as db:
            visitor = await db.get(Visitor, state) if state else None
            if visitor is None:
                visitor = Visitor(id=state or kakao_id)
                db.add(visitor)
            visitor.kakao_id = kakao_id
            if nickname:
                visitor.nickname = nickname[:32]
            await db.commit()

        return RedirectResponse(url="/rank", status_code=302)
    except Exception:
        logger.exception("카카오 로그인 실패")
        return RedirectResponse(url="/", status_code=302)
