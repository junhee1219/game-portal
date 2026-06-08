"""게임 포털 데이터 모델. 테이블명 복수형, ID는 클라이언트 생성 UUID 문자열."""
from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, kst_now


class User(Base):
    """가입 회원. 닉네임이 로그인 ID 겸 표시명, PK는 불변 uuid (닉네임 변경권 판매 대비).

    login_id 별도 컬럼 없음 — 닉네임이 곧 로그인 키. kakao_id는 자리만 (지금 미사용).
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    nickname: Mapped[str] = mapped_column(String(32), unique=True)  # 로그인 ID 겸 표시명
    password_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    kakao_id: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)


class Visitor(Base):
    """익명 방문자(디바이스). localStorage UUID 기준.

    user_id = 현재 이 디바이스에 로그인된 user (mutable claim). 다음 점수의 snapshot 소스.
    """

    __tablename__ = "visitors"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    first_referrer: Mapped[str | None] = mapped_column(String(512), nullable=True)
    kakao_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)


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
    # 기록 시점의 소유자 user (write-time snapshot). 재로그인해도 안 바뀜 → 과거 기록 오염 방지.
    # 집계 주체 = COALESCE(user_id, visitor_id).
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    game: Mapped[str] = mapped_column(String(32), index=True)
    score: Mapped[int] = mapped_column(BigInteger)
    nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)

    __table_args__ = (
        Index("ix_scores_game_score", "game", "score"),
        Index("ix_scores_game_user", "game", "user_id"),
    )
