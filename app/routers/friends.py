"""친구 (단방향 follow) + 친구 리더보드.

- 주체는 항상 쿠키 세션 user (body로 follower 안 받음 — 위조 차단).
- 친구 찾기 = 카톡 공유 루프 결합: /s/{id} → score-owner → /follow/{user_id}.
- 친구 리더보드는 scores.user_id snapshot에 의존 (Phase 1에서 추가됨).
"""
import logging
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError

from app import database, games
from app.auth_session import current_user
from app.database import kst_now
from app.models import Friendship, Score, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


class FollowIn(BaseModel):
    followee_id: str = Field(max_length=64)


async def _followee_ids(db, user_id: str) -> list[str]:
    rows = (
        await db.execute(select(Friendship.followee_id).where(Friendship.follower_id == user_id))
    ).all()
    return [r[0] for r in rows]


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


@router.post("/follow")
async def follow(body: FollowIn, request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    if body.followee_id == user.id:
        return JSONResponse({"ok": False, "reason": "self"}, status_code=400)
    try:
        async with database.async_session() as db:
            target = await db.get(User, body.followee_id)
            if target is None:
                return JSONResponse({"ok": False, "reason": "not-found"}, status_code=404)
            existing = (
                await db.execute(
                    select(Friendship.id).where(
                        Friendship.follower_id == user.id,
                        Friendship.followee_id == body.followee_id,
                    )
                )
            ).first()
            if existing:
                return {"ok": True, "already": True}
            db.add(
                Friendship(
                    id=uuid.uuid4().hex,
                    follower_id=user.id,
                    followee_id=body.followee_id,
                )
            )
            try:
                await db.commit()
            except IntegrityError:  # 동시 follow race → 유니크 제약
                await db.rollback()
                return {"ok": True, "already": True}
        return {"ok": True, "nickname": target.nickname}
    except Exception:
        logger.exception("follow 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.delete("/follow")
async def unfollow(body: FollowIn, request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    try:
        async with database.async_session() as db:
            row = (
                await db.execute(
                    select(Friendship).where(
                        Friendship.follower_id == user.id,
                        Friendship.followee_id == body.followee_id,
                    )
                )
            ).scalar_one_or_none()
            if row is not None:
                await db.delete(row)
                await db.commit()
        return {"ok": True}
    except Exception:
        logger.exception("unfollow 실패")
        return JSONResponse({"ok": False, "reason": "db-error"}, status_code=500)


@router.get("/friends")
async def friends(request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    try:
        async with database.async_session() as db:
            ids = await _followee_ids(db, user.id)
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
            ids = await _followee_ids(db, user.id) + [user.id]  # 친구 + 본인
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
