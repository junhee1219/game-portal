"""가입/로그인/로그아웃/세션 조회.

- 닉네임 = 로그인 ID 겸 표시명 (login_id 별도 없음). 비번과 함께 2필드 가입.
- 로그인 성공 시 그 디바이스(visitor)의 과거 익명 기록을 user로 claim (귀속).
- write-path 인증: 점수 기록 주체는 쿠키 세션 user (api.py). visitor_id는 익명 트래킹 키일 뿐.
"""
import logging
import time
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app import database
from app.auth_session import (
    clear_session_cookie,
    current_user,
    hash_password,
    set_session_cookie,
    verify_password,
)
from app.models import CreditTransaction, Score, User, Visitor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth")

NICK_MIN, NICK_MAX = 1, 16
PW_MIN = 4

# brute-force 최소 방어 — in-memory (프로세스 단일이라 충분, redis/slowapi 과설계 금지)
_RL_WINDOW = 300  # 5분
_RL_MAX = 5
_attempts: dict[tuple[str, str], list[float]] = {}

# 닉네임 단위 글로벌 백스톱. (ip, nickname) 키만 쓰면 X-Forwarded-For를 매 요청
# 바꿔치기해 IP를 위조하는 순간 키가 갈려 제한이 무력화된다. IP와 무관하게
# 계정당 총 시도 수를 캡해, 닉(=로그인ID는 공개)을 아는 공격자의 무차별 대입을 막는다.
_RL_NICK_WINDOW = 900  # 15분
_RL_NICK_MAX = 20
_nick_attempts: dict[str, list[float]] = {}


def _rate_limited(ip: str, nickname: str) -> bool:
    now = time.monotonic()
    key = (ip, nickname.lower())
    hist = [t for t in _attempts.get(key, []) if now - t < _RL_WINDOW]
    _attempts[key] = hist
    nk = nickname.lower()
    nhist = [t for t in _nick_attempts.get(nk, []) if now - t < _RL_NICK_WINDOW]
    _nick_attempts[nk] = nhist
    return len(hist) >= _RL_MAX or len(nhist) >= _RL_NICK_MAX


def _record_attempt(ip: str, nickname: str) -> None:
    now = time.monotonic()
    _attempts.setdefault((ip, nickname.lower()), []).append(now)
    _nick_attempts.setdefault(nickname.lower(), []).append(now)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "?"


class RegisterIn(BaseModel):
    nickname: str = Field(max_length=32)
    password: str = Field(max_length=128)
    visitor_id: str | None = Field(default=None, max_length=64)


class LoginIn(BaseModel):
    nickname: str = Field(max_length=32)
    password: str = Field(max_length=128)
    visitor_id: str | None = Field(default=None, max_length=64)


class SetNicknameIn(BaseModel):
    nickname: str = Field(max_length=32)


def _valid_nickname(n: str) -> bool:
    n = n.strip()
    return NICK_MIN <= len(n) <= NICK_MAX and "\n" not in n and "\t" not in n


async def claim_visitor(db, visitor_id: str | None, user_id: str) -> None:
    """로그인/가입 순간 이 디바이스의 과거 익명 기록을 user로 귀속.

    핵심 안전장치: Score.user_id IS NULL 행만 백필 — 이미 다른 user가 박힌 과거 기록은
    절대 안 건드린다 (공용 PC에서 A→B 재로그인 시 A 기록 도둑질 방지).
    """
    if not visitor_id:
        return
    visitor = await db.get(Visitor, visitor_id)
    if visitor is None:
        db.add(Visitor(id=visitor_id, user_id=user_id))
    else:
        visitor.user_id = user_id
    await db.execute(
        update(Score)
        .where(Score.visitor_id == visitor_id, Score.user_id.is_(None))
        .values(user_id=user_id)
    )
    # 익명 동안 쌓인 크레딧도 user로 백필 (NULL 행만 — scores와 동일 규칙).
    # 적립 로직은 아직 미구현이라 보통 0건이지만, 구현 후엔 이 백필이 익명 적립을 합류시킨다.
    await db.execute(
        update(CreditTransaction)
        .where(CreditTransaction.visitor_id == visitor_id, CreditTransaction.user_id.is_(None))
        .values(user_id=user_id)
    )
    await db.commit()


@router.get("/check-nickname")
async def check_nickname(n: str = ""):
    """가입 폼 실시간 중복 검사."""
    n = n.strip()
    if not _valid_nickname(n):
        return {"available": False, "reason": "invalid"}
    if database.async_session is None:
        return {"available": True}  # DB 없으면 검사 불가 — 막지 않음
    async with database.async_session() as db:
        existing = (await db.execute(select(User.id).where(User.nickname == n))).first()
    return {"available": existing is None}


@router.post("/register")
async def register(body: RegisterIn, request: Request):
    if database.async_session is None:
        return JSONResponse({"ok": False, "reason": "no-db"}, status_code=503)
    nickname = body.nickname.strip()
    if not _valid_nickname(nickname):
        return JSONResponse(
            {"ok": False, "reason": "닉네임은 1~16자로 입력해주세요."}, status_code=400
        )
    if len(body.password) < PW_MIN:
        return JSONResponse(
            {"ok": False, "reason": f"비밀번호는 {PW_MIN}자 이상이어야 합니다."}, status_code=400
        )
    try:
        async with database.async_session() as db:
            taken = (await db.execute(select(User.id).where(User.nickname == nickname))).first()
            if taken:
                return JSONResponse(
                    {"ok": False, "reason": "이미 사용 중인 닉네임입니다."}, status_code=409
                )
            user = User(
                id=uuid.uuid4().hex,
                nickname=nickname,
                password_hash=hash_password(body.password),
            )
            db.add(user)
            try:
                await db.flush()
            except IntegrityError:
                await db.rollback()
                return JSONResponse(
                    {"ok": False, "reason": "이미 사용 중인 닉네임입니다."}, status_code=409
                )
            await db.commit()
            await claim_visitor(db, body.visitor_id, user.id)
        resp = JSONResponse({"ok": True, "nickname": nickname})
        set_session_cookie(resp, user.id)
        return resp
    except Exception:
        logger.exception("register 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.post("/set-nickname")
async def set_nickname(body: SetNicknameIn, request: Request):
    """카카오 온보딩: 세션 user의 닉네임을 처음 확정한다 (nickname_set=True).

    카카오 신규 가입은 임시 닉으로 만들어지므로, 사용자가 /onboard에서 고른 고유 닉을
    여기서 확정. 이미 확정된 유저의 닉 변경은 막는다(닉 변경권 별도 판매 대비).
    """
    if database.async_session is None:
        return JSONResponse({"ok": False, "reason": "no-db"}, status_code=503)
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    nickname = body.nickname.strip()
    if not _valid_nickname(nickname):
        return JSONResponse(
            {"ok": False, "reason": "닉네임은 1~16자로 입력해주세요."}, status_code=400
        )
    try:
        async with database.async_session() as db:
            db_user = await db.get(User, user.id)
            if db_user is None:
                return JSONResponse({"ok": False, "reason": "not-found"}, status_code=404)
            if db_user.nickname_set:
                # 이미 확정 — 멱등(같은 닉) 허용, 변경은 거부
                if db_user.nickname == nickname:
                    return {"ok": True, "nickname": nickname}
                return JSONResponse(
                    {"ok": False, "reason": "닉네임은 변경할 수 없습니다."}, status_code=409
                )
            taken = (
                await db.execute(
                    select(User.id).where(User.nickname == nickname, User.id != user.id)
                )
            ).first()
            if taken:
                return JSONResponse(
                    {"ok": False, "reason": "이미 사용 중인 닉네임입니다."}, status_code=409
                )
            db_user.nickname = nickname
            db_user.nickname_set = True
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()
                return JSONResponse(
                    {"ok": False, "reason": "이미 사용 중인 닉네임입니다."}, status_code=409
                )
        return {"ok": True, "nickname": nickname}
    except Exception:
        logger.exception("set-nickname 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.post("/login")
async def login(body: LoginIn, request: Request):
    if database.async_session is None:
        return JSONResponse({"ok": False, "reason": "no-db"}, status_code=503)
    nickname = body.nickname.strip()
    ip = _client_ip(request)
    if _rate_limited(ip, nickname):
        return JSONResponse(
            {"ok": False, "reason": "시도가 너무 많습니다. 잠시 후 다시 시도해주세요."},
            status_code=429,
        )
    try:
        async with database.async_session() as db:
            user = (
                await db.execute(select(User).where(User.nickname == nickname))
            ).scalar_one_or_none()
            if user is None or not verify_password(body.password, user.password_hash):
                _record_attempt(ip, nickname)
                return JSONResponse(
                    {"ok": False, "reason": "닉네임 또는 비밀번호를 확인하세요."}, status_code=401
                )
            await claim_visitor(db, body.visitor_id, user.id)
            nick = user.nickname
            uid = user.id
        resp = JSONResponse({"ok": True, "nickname": nick})
        set_session_cookie(resp, uid)
        return resp
    except Exception:
        logger.exception("login 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.post("/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    clear_session_cookie(resp)
    return resp


@router.get("/me")
async def me(request: Request):
    user = await current_user(request)
    if user is None:
        return {"user": None}
    return {
        "user": {
            "user_id": user.id,
            "nickname": user.nickname,
            "nickname_set": user.nickname_set,
            "public": user.public,
        }
    }
