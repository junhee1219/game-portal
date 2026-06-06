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
