"""계측/점수 API. DB가 죽어 있어도 200을 돌려준다 — 게임 플레이를 막지 않는 게 우선."""
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select, text

from app import database, games
from app.auth_session import current_user
from app.database import kst_now
from app.models import Event, Score, User, Visitor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/games")
async def list_games():
    """게임 레지스트리 단일 소스. DB 무관 항상 200. rank/dash가 fetch해서 소비."""
    return {"games": games.public_games()}


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
    if body.game not in games.valid_event_games():
        return {"ok": False, "reason": "unknown-game"}
    user = await current_user(request)  # 로그인 시 디바이스 claim 동기화 (점수 소유 무관)
    try:
        async with database.async_session() as db:
            visitor = await db.get(Visitor, body.visitor_id)
            if visitor is None:
                visitor = Visitor(
                    id=body.visitor_id,
                    user_agent=(request.headers.get("user-agent") or "")[:512],
                    first_referrer=(body.referrer or "")[:512] or None,
                    user_id=user.id if user else None,
                )
                db.add(visitor)
            else:
                visitor.last_seen_at = kst_now()
                if user is not None and visitor.user_id != user.id:
                    visitor.user_id = user.id
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
async def record_score(body: ScoreIn, request: Request):
    if database.async_session is None:
        return {"ok": False, "reason": "no-db"}
    if body.game not in games.valid_event_games():
        return {"ok": False, "reason": "unknown-game"}
    # write-path 인증: 로그인 시 쿠키 user가 권위 소스 (body.visitor_id는 익명 트래킹 키일 뿐).
    user = await current_user(request)
    try:
        async with database.async_session() as db:
            if user is not None:
                user_id = user.id
                nickname = user.nickname
            else:
                # 비로그인: 이 디바이스가 이미 claim돼 있으면 그 user로 snapshot
                # (자동 캡처가 beacon/keepalive로 들어와 쿠키가 빠지는 엣지 보강)
                visitor = await db.get(Visitor, body.visitor_id)
                user_id = visitor.user_id if visitor else None
                nickname = body.nickname
            score = Score(
                visitor_id=body.visitor_id,
                user_id=user_id,
                game=body.game,
                score=body.score,
                nickname=nickname,
                meta=body.meta,
            )
            db.add(score)
            await db.commit()
            return {"ok": True, "id": score.id, "share_url": f"/s/{score.id}"}
    except Exception:
        logger.exception("score 기록 실패")
        return {"ok": False, "reason": "db-error"}


@router.get("/leaderboard/{game}")
async def leaderboard(game: str, limit: int = 10):
    if database.async_session is None or game not in games.valid_event_games():
        return {"game": game, "entries": []}
    limit = max(1, min(limit, 50))
    try:
        async with database.async_session() as db:
            # 논리 주체 = COALESCE(user_id, visitor_id): 같은 user의 폰+노트북 기록이 1행으로 dedup.
            # 익명 기록은 visitor_id가 주체라 디바이스 단위 (기존 동작 유지).
            subject = func.coalesce(Score.user_id, Score.visitor_id).label("subject")
            best = (
                select(subject, func.max(Score.score).label("best_score"))
                .where(Score.game == game)
                .group_by(subject)
                .subquery()
            )
            # 닉네임 우선순위: users.nickname(로그인) > visitors.nickname(익명) > '익명'
            rows = (
                await db.execute(
                    select(
                        best.c.subject,
                        best.c.best_score,
                        func.coalesce(User.nickname, Visitor.nickname).label("nick"),
                    )
                    .outerjoin(User, User.id == best.c.subject)
                    .outerjoin(Visitor, Visitor.id == best.c.subject)
                    .order_by(desc(best.c.best_score))
                    .limit(limit)
                )
            ).all()
        return {
            "game": game,
            "entries": [
                {"rank": i + 1, "nickname": nick or "익명", "score": int(score)}
                for i, (_, score, nick) in enumerate(rows)
            ],
        }
    except Exception:
        logger.exception("leaderboard 조회 실패")
        return {"game": game, "entries": []}


@router.get("/me/scores")
async def my_scores(request: Request):
    """로그인 user의 게임별 best. 크로스 디바이스 '내 기록' 가시화.

    노트북에서 로그인하면 localStorage가 비어도 폰에서 쌓은 기록이 내려온다.
    비로그인은 ok:false — rank.html이 localStorage 폴백으로 분기.
    """
    user = await current_user(request)
    if user is None:
        return {"ok": False, "scores": {}}
    try:
        async with database.async_session() as db:
            rows = (
                await db.execute(
                    select(Score.game, func.max(Score.score))
                    .where(Score.user_id == user.id)
                    .group_by(Score.game)
                )
            ).all()
        return {"ok": True, "scores": {g: int(s) for g, s in rows}}
    except Exception:
        logger.exception("me/scores 조회 실패")
        return {"ok": False, "scores": {}}


@router.get("/stats/daily")
async def stats_daily(days: int = 14):
    """일별 게임별 방문자 수 — 어느 게임이 사는지 보는 핵심 지표."""
    if database.async_session is None:
        return {"ok": False, "reason": "no-db"}
    days = max(1, min(days, 60))
    try:
        async with database.async_session() as db:
            rows = (
                await db.execute(
                    select(
                        func.date(Event.created_at).label("day"),
                        Event.game,
                        func.count(func.distinct(Event.visitor_id)).label("visitors"),
                    )
                    .where(
                        Event.type == "visit",
                        Event.created_at >= func.date_sub(func.now(), text(f"INTERVAL {days} DAY")),
                    )
                    .group_by(func.date(Event.created_at), Event.game)
                    .order_by(func.date(Event.created_at))
                )
            ).all()
        out: dict[str, dict[str, int]] = {}
        for day, game, visitors in rows:
            out.setdefault(str(day), {})[game] = int(visitors)
        return {"ok": True, "days": out}
    except Exception:
        logger.exception("stats/daily 조회 실패")
        return {"ok": False, "reason": "db-error"}


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
