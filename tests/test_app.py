"""포털 서빙 레이어 테스트 — DB 없이 동작하는 영역 전부.

실행: venv/bin/python -m pytest tests/ -q
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_portal_index():
    res = client.get("/")
    assert res.status_code == 200
    assert "한 판 하고" in res.text
    # og:image의 {{BASE}}가 실제 주소로 치환됐는지
    assert "{{BASE}}" not in res.text
    assert 'og:image" content="http' in res.text
    # 게임 카드가 레지스트리로 서버사이드 렌더됐는지 ({{CARDS}} 치환 + 실제 게임)
    assert "{{CARDS}}" not in res.text
    assert "물병 정렬" in res.text
    assert 'href="/vase/"' in res.text


def test_api_games():
    res = client.get("/api/games")
    assert res.status_code == 200
    data = res.json()
    ids = [g["id"] for g in data["games"]]
    assert {"vase", "gateway", "cube"} <= set(ids)
    vase = next(g for g in data["games"] if g["id"] == "vase")
    assert vase["score_key"] == "vaseMaxClear"
    assert vase["icon"] == "/vase/icon-192.png"
    # state_keys 인터페이스가 노출되는지 (Phase 2 sync가 소비)
    assert any(k["key"] == "vaseBest" and k["merge"] == "union_min" for k in vase["state_keys"])


def test_rank_page():
    res = client.get("/rank")
    assert res.status_code == 200
    assert "기록실" in res.text


def test_dash_page():
    res = client.get("/dash")
    assert res.status_code == 200


@pytest.mark.parametrize("game", ["vase", "gateway", "cube"])
def test_game_serves_with_injection(game):
    res = client.get(f"/{game}/")
    assert res.status_code == 200
    # 계측 스크립트가 정확히 1번 주입
    assert res.text.count('src="/portal.js"') == 1
    assert f'data-game="{game}"' in res.text
    # 점수 config가 fetch가 아니라 주입으로 동기 전달되는지 (setItem 후킹 race 방지)
    assert 'data-score-key="' in res.text


@pytest.mark.parametrize("game", ["vase", "gateway", "cube"])
def test_game_root_redirects_to_slash(game):
    res = client.get(f"/{game}", follow_redirects=False)
    assert res.status_code == 308
    assert res.headers["location"] == f"/{game}/"


def test_sw_neutralized():
    res = client.get("/vase/sw.js")
    assert res.status_code == 200
    assert "unregister" in res.text
    # 원본 sw.js 내용이 아니어야 한다
    assert "cache" in res.text.lower()


def test_unknown_game_404():
    assert client.get("/nope/").status_code == 404
    assert client.get("/nope").status_code == 404


def test_path_traversal_blocked():
    res = client.get("/vase/..%2F..%2F..%2Fetc%2Fpasswd")
    assert res.status_code == 404
    res = client.get("/vase/../../app/config.py")
    assert res.status_code == 404


def test_game_static_asset():
    res = client.get("/vase/icon-192.png")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"


def test_api_graceful_without_db():
    """DB 미설정 환경에서 계측 API가 200 + ok:false로 조용히 동작."""
    res = client.post("/api/ping", json={"visitor_id": "t", "game": "vase"})
    assert res.status_code == 200
    res = client.get("/api/leaderboard/vase")
    assert res.status_code == 200
    assert res.json()["entries"] == []


def test_api_rejects_unknown_game():
    res = client.post("/api/score", json={"visitor_id": "t", "game": "hack", "score": 1})
    assert res.status_code == 200
    assert res.json()["ok"] is False


def test_kakao_disabled_without_keys():
    res = client.get("/auth/kakao/login")
    assert res.status_code == 501


def test_share_page_redirects_without_db():
    res = client.get("/s/1", follow_redirects=False)
    assert res.status_code == 302


# --- Phase 1: 유저 ---

def test_account_page():
    res = client.get("/account")
    assert res.status_code == 200
    assert "닉네임" in res.text


def test_auth_me_anonymous():
    res = client.get("/auth/me")
    assert res.status_code == 200
    assert res.json() == {"user": None}


def test_register_requires_db():
    # DB 없는 테스트 환경 — 가입은 503 (게임 플레이는 막지 않지만 가입은 DB 필수)
    res = client.post(
        "/auth/register", json={"nickname": "tester", "password": "secret1"}
    )
    assert res.status_code == 503
    assert res.json()["ok"] is False


def test_check_nickname_invalid():
    res = client.get("/auth/check-nickname?n=")
    assert res.json()["available"] is False


def test_password_hash_roundtrip():
    from app.auth_session import hash_password, verify_password

    h = hash_password("hunter2!")
    assert h != "hunter2!"
    assert verify_password("hunter2!", h) is True
    assert verify_password("wrong", h) is False
    assert verify_password("anything", None) is False


def test_session_token_roundtrip():
    from app import auth_session

    token = auth_session._serializer.dumps("user-123")
    assert auth_session._serializer.loads(token, max_age=60) == "user-123"


def test_me_scores_anonymous():
    res = client.get("/api/me/scores")
    assert res.status_code == 200
    assert res.json()["ok"] is False


# --- Phase 2: 상태 동기화 ---

def test_merge_max():
    from app.state_merge import merge_value
    assert merge_value("max", 120, 40) == 120      # 오래된 기기가 낮은 값 써도 후퇴 안 함
    assert merge_value("max", 40, 120) == 120
    assert merge_value("max", None, 7) == 7         # 첫 기록
    assert merge_value("max", "100", "9") == 100    # 문자열도 숫자로


def test_merge_union_maxmin():
    from app.state_merge import merge_value
    # union: 키별 max (vaseStars — 높을수록 좋음)
    assert merge_value("union", {"3": 2, "5": 1}, {"5": 3, "7": 2}) == {"3": 2, "5": 3, "7": 2}
    # union_min: 키별 min (vaseBest — moves 적을수록 좋음)
    assert merge_value("union_min", {"3": 20, "5": 15}, {"3": 12, "7": 9}) == {"3": 12, "5": 15, "7": 9}


def test_merge_lww_passthrough():
    from app.state_merge import merge_value
    # lww/미지 타입은 client(최신 쓰기)가 그대로 — raw 문자열 보존
    assert merge_value("lww", "0", "1") == "1"
    assert merge_value("unknown", "a", "b") == "b"


def test_state_requires_login():
    # 비로그인(쿠키 없음) → 401, sync OFF
    assert client.get("/api/state/vase").status_code == 401
    assert client.put("/api/state/vase", json={"changes": {"vaseMaxClear": 5}}).status_code == 401


def test_game_injects_state_keys():
    # 게임 페이지에 상태 manifest가 동기 주입되는지 (fetch 금지)
    res = client.get("/vase/")
    assert "data-state-keys=" in res.text
    assert "union_min" in res.text  # vaseBest merge 방식이 주입에 실려야


# --- Phase 3: 크레딧 골격 ---

def test_credits_anonymous():
    res = client.get("/api/me/credits")
    assert res.status_code == 200
    assert res.json()["ok"] is False
    assert res.json()["balance"] == 0


def test_award_not_implemented():
    # 적립 로직은 골격만 — 호출 시 명확히 미구현임을 알린다
    import asyncio

    from app.credits import award_if_under_cap

    with pytest.raises(NotImplementedError):
        asyncio.run(
            award_if_under_cap(None, visitor_id="v", user_id="u", reason="play_session")
        )


# --- Phase 4: 친구 ---

def test_follow_requires_login():
    assert client.post("/api/follow", json={"followee_id": "x"}).status_code == 401
    assert client.get("/api/friends").status_code == 401
    assert client.get("/api/friends/leaderboard/vase").status_code == 401


def test_score_owner_graceful_without_db():
    res = client.get("/api/score-owner/1")
    assert res.status_code == 200
    assert res.json()["owner_user_id"] is None


def test_follow_page():
    res = client.get("/follow/someuserid")
    assert res.status_code == 200
    assert "친구" in res.text


# --- Phase 5: PWA ---

def test_manifest():
    res = client.get("/manifest.webmanifest")
    assert res.status_code == 200
    assert "application/manifest+json" in res.headers["content-type"]
    data = res.json()
    assert data["scope"] == "/"
    assert data["name"] == "한 판 하고 가요"
    assert any(i["purpose"] == "maskable" for i in data["icons"])


def test_service_worker():
    res = client.get("/sw.js")
    assert res.status_code == 200
    # 게임 prefix가 주입돼 {{GAME_RE}} 치환됐는지 + 게임 경로 passthrough 가드
    assert "{{GAME_RE}}" not in res.text
    assert "vase" in res.text and "gateway" in res.text
    assert "portal-v1" in res.text


def test_portal_icons():
    res = client.get("/icons/portal-192.png")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    # 경로 이탈 차단
    assert client.get("/icons/..%2f..%2fapp%2fconfig.py").status_code == 404


def test_noop_sw_preserves_portal_cache():
    # 게임 NOOP sw가 portal- 캐시는 지우지 않아야 (포털 SW silent no-op 방지)
    res = client.get("/vase/sw.js")
    assert res.status_code == 200
    assert "portal-" in res.text  # 제외 필터 존재
    assert "unregister" in res.text
