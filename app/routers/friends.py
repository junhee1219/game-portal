"""친구 (상호 수락) + 친구 리더보드.

- 주체는 항상 쿠키 세션 user (body로 follower 안 받음 — 위조 차단).
- 친구 = 요청(pending) → 상대 수락(accepted). 양방향 관계로 친구 리더보드에 서로 보인다.
- 발견 경로 = 카톡 공유 루프: /s/{id} → score-owner → /follow/{user_id} 페이지 → 친구 요청.
- friendships.follower_id=요청자, followee_id=대상, status='pending'|'accepted'.
  내 친구 = 내가 follower거나 followee인 accepted 행(양방향). 기존 행은 DDL default 'accepted'.
"""
import logging
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, or_, select
from sqlalchemy.exc import IntegrityError

from app import database, games
from app.auth_session import current_user
from app.models import Friendship, Score, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


class FriendIn(BaseModel):
    other_id: str = Field(max_length=64)


class FriendByNickIn(BaseModel):
    nickname: str = Field(max_length=32)


async def _request_friend(db, user_id: str, target_id: str, target_nickname: str | None) -> dict:
    """user_id → target_id 친구 요청 생성. 상대가 이미 나에게 보낸 pending이면 즉시 수락(친구 성립).

    target 존재·self 체크는 호출측에서. 응답 dict 반환.
    """
    existing = (
        await db.execute(
            select(Friendship).where(
                or_(
                    (Friendship.follower_id == user_id) & (Friendship.followee_id == target_id),
                    (Friendship.follower_id == target_id) & (Friendship.followee_id == user_id),
                )
            )
        )
    ).scalars().all()
    for fr in existing:
        if fr.status == "accepted":
            return {"ok": True, "status": "accepted", "already": True, "nickname": target_nickname}
    for fr in existing:  # 상대가 나에게 보낸 pending → 수락해서 즉시 친구
        if fr.status == "pending" and fr.follower_id == target_id:
            fr.status = "accepted"
            await db.commit()
            return {"ok": True, "status": "accepted", "nickname": target_nickname}
    for fr in existing:  # 내가 이미 보낸 pending
        if fr.status == "pending" and fr.follower_id == user_id:
            return {"ok": True, "status": "pending", "already": True, "nickname": target_nickname}
    db.add(Friendship(id=uuid.uuid4().hex, follower_id=user_id, followee_id=target_id, status="pending"))
    try:
        await db.commit()
    except IntegrityError:  # 동시 요청 race → 유니크 제약
        await db.rollback()
        return {"ok": True, "status": "pending", "already": True, "nickname": target_nickname}
    return {"ok": True, "status": "pending", "nickname": target_nickname}


async def _friend_ids(db, user_id: str) -> list[str]:
    """accepted 양방향 친구 id 목록 (본인 제외)."""
    rows = (
        await db.execute(
            select(Friendship.follower_id, Friendship.followee_id).where(
                Friendship.status == "accepted",
                or_(Friendship.follower_id == user_id, Friendship.followee_id == user_id),
            )
        )
    ).all()
    ids = set()
    for f, t in rows:
        ids.add(t if f == user_id else f)  # 상대편
    ids.discard(user_id)
    return list(ids)


@router.get("/score-owner/{score_id}")
async def score_owner(score_id: int):
    """점수 주인이 로그인 user인지 + 닉네임. share 페이지 친구버튼 노출 판정 (공개)."""
    if database.async_session is None:
        return {"ok": False, "owner_user_id": None, "nickname": None}
    try:
        async with database.async_session() as db:
            score = await db.get(Score, score_id)
            if score is None or not score.user_id:
                return {"ok": True, "owner_user_id": None, "nickname": None}
            owner = await db.get(User, score.user_id)
            if owner is None:
                return {"ok": True, "owner_user_id": None, "nickname": None}
            # user_id는 opaque uuid라 노출해도 enumeration 가치 낮음. login 식별자 아님.
            return {"ok": True, "owner_user_id": owner.id, "nickname": owner.nickname}
    except Exception:
        logger.exception("score-owner 조회 실패")
        return {"ok": False, "owner_user_id": None, "nickname": None}


@router.post("/friend-request")
async def friend_request(body: FriendIn, request: Request):
    """친구 요청 보내기(user_id). 상대가 이미 나에게 요청해둔 상태면 즉시 친구 성립."""
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    if body.other_id == user.id:
        return JSONResponse({"ok": False, "reason": "self"}, status_code=400)
    try:
        async with database.async_session() as db:
            target = await db.get(User, body.other_id)
            if target is None:
                return JSONResponse({"ok": False, "reason": "not-found"}, status_code=404)
            return await _request_friend(db, user.id, target.id, target.nickname)
    except Exception:
        logger.exception("friend-request 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.post("/friend-request/by-nickname")
async def friend_request_by_nickname(body: FriendByNickIn, request: Request):
    """닉네임으로 친구 신청 — 기록실 '친구 찾기'에서 사용. 닉네임은 유니크."""
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    nick = (body.nickname or "").strip()
    if not nick:
        return {"ok": False, "reason": "empty"}
    try:
        async with database.async_session() as db:
            target = (
                await db.execute(select(User).where(User.nickname == nick))
            ).scalar_one_or_none()
            if target is None:
                return JSONResponse({"ok": False, "reason": "not-found"}, status_code=404)
            if target.id == user.id:
                return JSONResponse({"ok": False, "reason": "self"}, status_code=400)
            return await _request_friend(db, user.id, target.id, target.nickname)
    except Exception:
        logger.exception("friend-request-by-nickname 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.post("/friend-request/accept")
async def friend_accept(body: FriendIn, request: Request):
    """받은 친구 요청 수락. other_id = 나에게 요청한 사람."""
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    try:
        async with database.async_session() as db:
            fr = (
                await db.execute(
                    select(Friendship).where(
                        Friendship.follower_id == body.other_id,
                        Friendship.followee_id == user.id,
                    )
                )
            ).scalar_one_or_none()
            if fr is None:
                return JSONResponse({"ok": False, "reason": "no-request"}, status_code=404)
            fr.status = "accepted"
            await db.commit()
        return {"ok": True}
    except Exception:
        logger.exception("friend-accept 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.delete("/friend")
async def remove_friend(body: FriendIn, request: Request):
    """친구 삭제 / 받은 요청 거절 — 나↔상대 사이 모든 행(양방향, 상태 무관) 제거."""
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    try:
        async with database.async_session() as db:
            rows = (
                await db.execute(
                    select(Friendship).where(
                        or_(
                            (Friendship.follower_id == user.id)
                            & (Friendship.followee_id == body.other_id),
                            (Friendship.follower_id == body.other_id)
                            & (Friendship.followee_id == user.id),
                        )
                    )
                )
            ).scalars().all()
            for fr in rows:
                await db.delete(fr)
            await db.commit()
        return {"ok": True}
    except Exception:
        logger.exception("remove-friend 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.get("/friend-requests")
async def friend_requests(request: Request):
    """나에게 들어온 대기 중 친구 요청 목록 (수락/거절 대상)."""
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    try:
        async with database.async_session() as db:
            rows = (
                await db.execute(
                    select(User.id, User.nickname)
                    .join(Friendship, Friendship.follower_id == User.id)
                    .where(Friendship.followee_id == user.id, Friendship.status == "pending")
                )
            ).all()
        return {"ok": True, "requests": [{"user_id": i, "nickname": n} for i, n in rows]}
    except Exception:
        logger.exception("friend-requests 조회 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.get("/friends")
async def friends(request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    try:
        async with database.async_session() as db:
            ids = await _friend_ids(db, user.id)
            if not ids:
                return {"ok": True, "friends": []}
            rows = (
                await db.execute(select(User.id, User.nickname).where(User.id.in_(ids)))
            ).all()
        return {"ok": True, "friends": [{"user_id": i, "nickname": n} for i, n in rows]}
    except Exception:
        logger.exception("friends 조회 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.get("/friends/leaderboard/{game}")
async def friends_leaderboard(game: str, request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    if game not in games.valid_event_games():
        return {"ok": True, "entries": []}
    try:
        async with database.async_session() as db:
            ids = await _friend_ids(db, user.id) + [user.id]  # 친구 + 본인
            # user 단위 best (scores.user_id snapshot). 여러 디바이스도 user_id로 1행 collapse.
            best = (
                select(Score.user_id.label("uid"), func.max(Score.score).label("best_score"))
                .where(Score.game == game, Score.user_id.in_(ids))
                .group_by(Score.user_id)
                .subquery()
            )
            rows = (
                await db.execute(
                    select(best.c.uid, best.c.best_score, User.nickname)
                    .join(User, User.id == best.c.uid)
                    .order_by(desc(best.c.best_score))
                )
            ).all()
        entries = [
            {
                "rank": i + 1,
                "nickname": nick or "익명",
                "score": int(s),
                "is_me": uid == user.id,
            }
            for i, (uid, s, nick) in enumerate(rows)
        ]
        return {"ok": True, "game": game, "entries": entries}
    except Exception:
        logger.exception("friends leaderboard 조회 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)
