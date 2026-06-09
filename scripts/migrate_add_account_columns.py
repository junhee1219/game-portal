"""DDL 마이그레이션 (2026-06): 계정 온보딩·기록 공개·친구 요청 컬럼 추가.

멱등 — 이미 있으면 건너뛴다. 서버에서 코드 배포(restart) **전에** 실행한다:
    cd ~/game-portal && git pull && venv/bin/python scripts/migrate_add_account_columns.py && ./restart.sh

추가:
- users.nickname_set TINYINT(1) NOT NULL DEFAULT 1   (카카오 신규는 코드에서 0)
- users.public       TINYINT(1) NOT NULL DEFAULT 1   (전역 리더보드 노출)
- friendships.status VARCHAR(12) NOT NULL DEFAULT 'accepted'  (기존 관계 그랜드파더링)
- friendships 인덱스 ix_friendships_followee (followee_id)
"""
import asyncio

from sqlalchemy import text

from app.database import engine

COLUMNS = [
    ("users", "nickname_set",
     "ALTER TABLE users ADD COLUMN nickname_set TINYINT(1) NOT NULL DEFAULT 1"),
    ("users", "public",
     "ALTER TABLE users ADD COLUMN public TINYINT(1) NOT NULL DEFAULT 1"),
    ("friendships", "status",
     "ALTER TABLE friendships ADD COLUMN status VARCHAR(12) NOT NULL "
     "DEFAULT 'accepted' COLLATE utf8mb4_unicode_ci"),
]
INDEXES = [
    ("friendships", "ix_friendships_followee",
     "ALTER TABLE friendships ADD INDEX ix_friendships_followee (followee_id)"),
]


async def _col_exists(conn, table: str, col: str) -> bool:
    r = await conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c"
        ),
        {"t": table, "c": col},
    )
    return (r.scalar() or 0) > 0


async def _idx_exists(conn, table: str, idx: str) -> bool:
    r = await conn.execute(
        text(
            "SELECT COUNT(*) FROM information_schema.statistics "
            "WHERE table_schema = DATABASE() AND table_name = :t AND index_name = :i"
        ),
        {"t": table, "i": idx},
    )
    return (r.scalar() or 0) > 0


async def main() -> None:
    if engine is None:
        print("NO ENGINE — DATABASE_URL 미설정. 마이그레이션 건너뜀.")
        return
    async with engine.begin() as conn:
        for table, col, ddl in COLUMNS:
            if await _col_exists(conn, table, col):
                print(f"skip  {table}.{col} (이미 있음)")
            else:
                await conn.execute(text(ddl))
                print(f"added {table}.{col}")
        for table, idx, ddl in INDEXES:
            if await _idx_exists(conn, table, idx):
                print(f"skip  index {idx} (이미 있음)")
            else:
                await conn.execute(text(ddl))
                print(f"added index {idx}")
    print("DDL DONE")


if __name__ == "__main__":
    asyncio.run(main())
