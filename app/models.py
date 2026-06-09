"""게임 포털 데이터 모델. 테이블명 복수형, ID는 클라이언트 생성 UUID 문자열."""
from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, Index, Integer, String, Text, UniqueConstraint
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
    # 카카오 가입은 임시 닉으로 만들고 0 → 온보딩에서 직접 고르면 1. 자체가입/기존 유저는 1.
    nickname_set: Mapped[bool] = mapped_column(default=True)
    # 전체(전역) 리더보드 노출 여부. 끄면 전역에서만 숨고 친구 리더보드엔 계속 보인다.
    public: Mapped[bool] = mapped_column(default=True)
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


class GameState(Base):
    """게임 상태 동기화 (로그인 전용). value는 opaque JSON 문자열 — 게임당 컬럼 안 늘린다.

    merge 방식은 games.json의 state_keys[].merge 선언이 정하고, reducer는 app/state_merge.py.
    비로그인은 sync 없음 (localStorage만).
    """

    __tablename__ = "game_states"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    game: Mapped[str] = mapped_column(String(32))
    k: Mapped[str] = mapped_column(String(64))  # localStorage 키 ('key'는 예약어라 k)
    value: Mapped[str] = mapped_column(Text)  # 항상 JSON 문자열
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)

    __table_args__ = (UniqueConstraint("user_id", "game", "k", name="uq_user_game_key"),)


class CreditTransaction(Base):
    """크레딧 append-only ledger. balance = SUM(amount) 파생 (캐시 컬럼 없음).

    ★1차는 골격만 — 적립 규칙/금액은 미구현 (용도 확정 후). 적립 로직 = app/credits.py TODO.
    주체 = COALESCE(user_id, visitor_id) (scores와 동일 snapshot 패턴). spend는 음수 amount.
    """

    __tablename__ = "credit_transactions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 적립 시점 snapshot
    visitor_id: Mapped[str] = mapped_column(String(64))  # claim 병합 키
    amount: Mapped[int] = mapped_column(Integer)  # +적립 / -소비
    reason: Mapped[str] = mapped_column(String(32))
    game: Mapped[str | None] = mapped_column(String(32), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)

    __table_args__ = (
        Index("ix_credit_subject", "user_id", "visitor_id"),
        Index("ix_credit_dedup", "visitor_id", "reason", "created_at"),
    )


class Friendship(Base):
    """단방향 follow. A가 B를 follow하면 A의 /rank에 B 기록이 보인다 (B 동의 불필요).

    유일 use case = '친구 기록 보기'인데 그 기록은 이미 /rank에 공개 → 상호 수락은 과설계.
    주체는 항상 user (익명은 친구 불가 = 가입 wedge).
    """

    __tablename__ = "friendships"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    follower_id: Mapped[str] = mapped_column(String(64))   # 요청자
    followee_id: Mapped[str] = mapped_column(String(64))   # 대상
    # 'pending'(요청 보냄) | 'accepted'(상호 친구). 기존 행은 DDL default 'accepted'로 그랜드파더링.
    # 내 친구 = 내가 follower거나 followee인 accepted 행 (양방향).
    status: Mapped[str] = mapped_column(String(12), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)

    __table_args__ = (
        UniqueConstraint("follower_id", "followee_id", name="uq_friendship"),
        Index("ix_friendships_follower", "follower_id"),
        Index("ix_friendships_followee", "followee_id"),
    )


class Feedback(Base):
    """사용자 의견 (어디서든 textarea로 즉시 저장). 로그인이면 user_id, 익명이면 visitor_id."""

    __tablename__ = "feedbacks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    visitor_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)  # 작성 시점 스냅샷
    page: Mapped[str | None] = mapped_column(String(32), nullable=True)      # 어느 게임/페이지에서 남겼나
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=kst_now)

    # 신규 테이블 — collation 명시(서버 기본 0900_ai_ci로 새지 않게, JOIN 대비). CLAUDE.md quirk.
    __table_args__ = (
        Index("ix_feedbacks_created", "created_at"),
        {"mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )
