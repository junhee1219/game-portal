"""비동기 DB 세션. DATABASE_URL 미설정/접속 실패 시에도 앱은 뜬다."""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")


def kst_now() -> datetime:
    return datetime.now(KST).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


engine = None
async_session: async_sessionmaker[AsyncSession] | None = None

if settings.database_url:
    engine = create_async_engine(settings.database_url, pool_recycle=3600, pool_pre_ping=True)
    async_session = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> bool:
    """테이블 생성. 실패해도 앱 기동은 막지 않는다."""
    if engine is None:
        logger.warning("DATABASE_URL 미설정 — 계측 비활성")
        return False
    try:
        from app import models  # noqa: F401  (메타데이터 등록)

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("DB 초기화 완료")
        return True
    except Exception:
        logger.exception("DB 초기화 실패 — 계측 없이 기동")
        return False
