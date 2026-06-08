"""게임 상태 동기화 API (로그인 전용).

- GET  /api/state/{game} : 이 user의 게임 상태 키맵 + user_id
- PUT  /api/state/{game} : {changes:{k:v}} 를 manifest 시맨틱으로 merge 후 upsert
- 주체는 쿠키 세션 user만 (body로 user/visitor 안 받음 — 위조 차단).
- DB 없으면 ok:false (게임은 계속 동작), 비로그인은 401 (클라가 sync OFF).
"""
import json
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import database, games
from app.auth_session import current_user
from app.database import kst_now
from app.models import GameState
from app.state_merge import merge_value

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


def _manifest(game: str) -> dict[str, str]:
    """games.json의 state_keys → {키: merge방식}. 단일 소스."""
    g = games.games_by_id().get(game)
    if not g:
        return {}
    return {sk["key"]: sk.get("merge", "lww") for sk in g.get("state_keys", [])}


class StatePut(BaseModel):
    changes: dict = Field(default_factory=dict)


@router.get("/state/{game}")
async def get_state(game: str, request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    if database.async_session is None:
        return {"ok": False, "reason": "no-db"}
    mani = _manifest(game)
    if not mani:
        return {"ok": True, "user_id": user.id, "state": {}}
    try:
        async with database.async_session() as db:
            rows = (
                await db.execute(
                    select(GameState.k, GameState.value).where(
                        GameState.user_id == user.id, GameState.game == game
                    )
                )
            ).all()
        state: dict = {}
        for k, value in rows:
            if k not in mani:
                continue
            try:
                state[k] = json.loads(value)
            except (ValueError, TypeError):
                state[k] = value
        return {"ok": True, "user_id": user.id, "state": state}
    except Exception:
        logger.exception("state 조회 실패")
        return {"ok": False, "reason": "db-error"}


@router.put("/state/{game}")
async def put_state(game: str, body: StatePut, request: Request):
    user = await current_user(request)
    if user is None:
        return JSONResponse({"ok": False, "reason": "login-required"}, status_code=401)
    if database.async_session is None:
        return {"ok": False, "reason": "no-db"}
    mani = _manifest(game)
    if not mani:
        return {"ok": True, "merged": {}}
    merged_out: dict = {}
    try:
        async with database.async_session() as db:
            for k, client_val in body.changes.items():
                if k not in mani:  # manifest에 없는 키는 무시 (임의 키 폭주 차단)
                    continue
                row = (
                    await db.execute(
                        select(GameState).where(
                            GameState.user_id == user.id,
                            GameState.game == game,
                            GameState.k == k,
                        )
                    )
                ).scalar_one_or_none()
                server_val = None
                if row is not None:
                    try:
                        server_val = json.loads(row.value)
                    except (ValueError, TypeError):
                        server_val = row.value
                merged = merge_value(mani[k], server_val, client_val)
                value_json = json.dumps(merged)
                if row is None:
                    db.add(
                        GameState(
                            user_id=user.id, game=game, k=k, value=value_json, updated_at=kst_now()
                        )
                    )
                else:
                    row.value = value_json
                    row.updated_at = kst_now()
                merged_out[k] = merged
            await db.commit()
        return {"ok": True, "merged": merged_out}
    except Exception:
        logger.exception("state 저장 실패")
        return {"ok": False, "reason": "db-error"}
