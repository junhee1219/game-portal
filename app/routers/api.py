"""계측/점수 API. DB가 죽어 있어도 200을 돌려준다 — 게임 플레이를 막지 않는 게 우선."""
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select

from app import database
from app.database import kst_now
from app.models import Event, Score, Visitor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

VALID_GAMES = {"cube", "gateway", "vase", "portal"}


class PingIn(BaseModel):
    visitor_id: str = Field(max_length=64)
    game: str = Field(max_length=32)
    type: str = Field(default="visit", max_length=16)
    duration_ms: int | None = None
    path: str | None = Field(default=None, max_length=256)
    referrer: str | None = Field(default=None, max_length=512)


class ScoreIn(BaseModel):
    visitor_id: str = Field(max_length=64)
    game: str = Field(max_length=32)
    score: int
    nickname: str | None = Field(default=None, max_length=32)
    meta: dict | None = None


@router.post("/ping")
async def ping(body: PingIn, request: Request):
    if database.async_session is None:
        return {"ok": False, "reason": "no-db"}
    if body.game not in VALID_GAMES:
        return {"ok": False, "reason": "unknown-game"}
    try:
        async with database.async_session() as db:
            visitor = await db.get(Visitor, body.visitor_id)
            if visitor is None:
                visitor = Visitor(
                    id=body.visitor_id,
                    user_agent=(request.headers.get("user-agent") or "")[:512],
                    first_referrer=(body.referrer or "")[:512] or None,
                )
                db.add(visitor)
            else:
                visitor.last_seen_at = kst_now()
            db.add(
                Event(
                    visitor_id=body.visitor_id,
                    game=body.game,
                    type=body.type if body.type in {"visit", "end", "share"} else "visit",
                    duration_ms=body.duration_ms,
                    path=body.path,
                    referrer=body.referrer,
                )
            )
            await db.commit()
        return {"ok": True}
    except Exception:
        logger.exception("ping 기록 실패")
        return {"ok": False, "reason": "db-error"}


@router.post("/score")
async def record_score(body: ScoreIn):
    if database.async_session is None:
        return {"ok": False, "reason": "no-db"}
    if body.game not in VALID_GAMES:
        return {"ok": False, "reason": "unknown-game"}
    try:
        async with database.async_session() as db:
            db.add(
                Score(
                    visitor_id=body.visitor_id,
                    game=body.game,
                    score=body.score,
                    nickname=body.nickname,
                    meta=body.meta,
                )
            )
            await db.commit()
        return {"ok": True}
    except Exception:
        logger.exception("score 기록 실패")
        return {"ok": False, "reason": "db-error"}


@router.get("/leaderboard/{game}")
async def leaderboard(game: str, limit: int = 10):
    if database.async_session is None or game not in VALID_GAMES:
        return {"game": game, "entries": []}
    limit = max(1, min(limit, 50))
    try:
        async with database.async_session() as db:
            rows = (
                await db.execute(
                    select(Score).where(Score.game == game).order_by(desc(Score.score)).limit(limit)
                )
            ).scalars().all()
        return {
            "game": game,
            "entries": [
                {
                    "rank": i + 1,
                    "nickname": s.nickname or "익명",
                    "score": s.score,
                    "at": s.created_at.isoformat(),
                }
                for i, s in enumerate(rows)
            ],
        }
    except Exception:
        logger.exception("leaderboard 조회 실패")
        return {"game": game, "entries": []}


@router.get("/stats")
async def stats():
    """간단 운영 지표 — 방문자/게임별 방문/평균 세션."""
    if database.async_session is None:
        return {"ok": False, "reason": "no-db"}
    try:
        async with database.async_session() as db:
            visitors = (await db.execute(select(func.count(Visitor.id)))).scalar() or 0
            per_game = (
                await db.execute(
                    select(Event.game, func.count(Event.id))
                    .where(Event.type == "visit")
                    .group_by(Event.game)
                )
            ).all()
            avg_session = (
                await db.execute(
                    select(Event.game, func.avg(Event.duration_ms))
                    .where(Event.type == "end", Event.duration_ms.isnot(None))
                    .group_by(Event.game)
                )
            ).all()
        return {
            "ok": True,
            "visitors": visitors,
            "visits": {g: c for g, c in per_game},
            "avg_session_ms": {g: int(a) for g, a in avg_session if a is not None},
        }
    except Exception:
        logger.exception("stats 조회 실패")
        return {"ok": False, "reason": "db-error"}
