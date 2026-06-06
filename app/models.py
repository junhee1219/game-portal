"""게임 포털 데이터 모델. 테이블명 복수형, ID는 클라이언트 생성 UUID 문자열."""
from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, kst_now


class Visitor(Base):
    """익명 방문자. localStorage UUID 기준."""

    __tablename__ = "visitors"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    first_referrer: Mapped[str | None] = mapped_column(String(512), nullable=True)


class Event(Base):
    """방문/세션 종료 등 계측 이벤트. D1/D7 리텐션의 원천."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    visitor_id: Mapped[str] = mapped_column(String(64), index=True)
    game: Mapped[str] = mapped_column(String(32), index=True)  # cube | gateway | vase | portal
    type: Mapped[str] = mapped_column(String(16), default="visit")  # visit | end | share
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    path: Mapped[str | None] = mapped_column(String(256), nullable=True)
    referrer: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)

    __table_args__ = (Index("ix_events_game_created", "game", "created_at"),)


class Score(Base):
    """게임 점수 기록. 리더보드/점수 공유의 원천."""

    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    visitor_id: Mapped[str] = mapped_column(String(64), index=True)
    game: Mapped[str] = mapped_column(String(32), index=True)
    score: Mapped[int] = mapped_column(BigInteger)
    nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)

    __table_args__ = (Index("ix_scores_game_score", "game", "score"),)
