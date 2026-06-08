"""크레딧 적립 로직.

╔══════════════════════════════════════════════════════════════════════════╗
║ ★ 1차는 골격만. 적립 규칙·금액은 미구현 (크레딧 용도 확정 후 구현).         ║
║                                                                            ║
║ 나중에 "크레딧 적립 구현해줘" 하면 → 여기 award_if_under_cap() 채우고        ║
║ ping(type=end) / score 핸들러(app/routers/api.py)에서 호출하면 됨.          ║
║ 규칙 spec 전체 = DESIGN.md §4 "적립 규칙(미구현)" 표.                        ║
╚══════════════════════════════════════════════════════════════════════════╝

설계 메모 (구현 시 이 표대로):
  play_session  ping end & duration>=60s    +10   게임당 1일 5회, duration 30분 clamp
  daily_first   그날 첫 play_session         +30   1일 1회
  new_record    score가 기존 best 초과       +20   게임당 1일 3회 (자동 캡처 중복 적립 차단)
  spend_*       (용도 미정 — API 안 만듦)     음수   잔액 검사 + FOR UPDATE

설계 원칙 (구현 시 지킬 것):
- 클라이언트발 'credit earn' 이벤트는 만들지 않는다. 서버가 이미 받는 ping/score 안에서만 적립.
- balance = SUM(amount) 파생 (캐시 컬럼 X — lost update race 원천 제거).
- 비로그인 적립은 visitor에 쌓고 claim 시 백필 (users.py claim_visitor — 이미 연결됨).
- duration 위조는 하한+clamp+cap 3중으로 가둠.
"""

# 적립 규칙 상수 (구현 시 활성화). 게임 추가해도 여기 한 곳.
REASONS = {
    "play_session": {"amount": 10, "daily_cap": 5, "min_duration_ms": 60_000, "max_duration_ms": 1_800_000},
    "daily_first": {"amount": 30, "daily_cap": 1},
    "new_record": {"amount": 20, "daily_cap": 3},
    # "spend_*": 음수 amount — 용도 확정 시
}


async def award_if_under_cap(db, *, visitor_id, user_id, reason, game=None, meta=None):
    """[미구현] 일일 cap 검사 후 크레딧 적립 (cap 초과면 skip).

    구현 시: ix_credit_dedup으로 (visitor_id, reason, 오늘) 카운트 → cap 미만이면
    CreditTransaction(amount=REASONS[reason]['amount'], ...) insert.
    """
    raise NotImplementedError(
        "크레딧 적립 미구현 — 용도 확정 후 DESIGN.md §4 표대로 구현. (app/credits.py)"
    )
