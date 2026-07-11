"""게임 레지스트리 단일 소스 (games.json 로더).

원칙:
- 게임 메타는 repo 루트 games.json 한 곳에만 둔다. main.py GAMES / api.py VALID_GAMES /
  portal.js SCORE_KEYS / rank.html / dash.html 의 중복을 전부 여기로 모은다.
- 게임 폴더 안(games/{id}/)에 두지 않는다: sync-games.sh의 rm -rf에 쓸려나가고,
  게임 자체 PWA manifest.json과 이름이 충돌한다.
- DB 테이블이 아니다: VALID_GAMES 검사·서빙·점수 config 주입이 요청 hot path라
  DB 장애 시 게임 서빙 자체가 멈추면 안 된다 (원칙: DB 없어도 게임 동작).

mtime 캐시: games.json이 바뀔 때만 다시 읽는다 → hot path 비용 거의 0 + dev 무재시작 반영.
"""
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
REGISTRY_PATH = BASE_DIR / "games.json"

# 이벤트 소스이지만 플레이 가능한 게임은 아님 (포털 페이지 방문 추적용 합성 ID)
SYNTHETIC_SOURCES = {"portal"}

_cache: dict = {"mtime": None, "games": []}

# 홈 카테고리(폴더) 정의 — 표시 순서 = 이 리스트 순서.
# 게임은 games.json 엔트리의 `category` 필드로 소속을 선언한다(범용 인터페이스 + 데이터 선언 원칙).
# 매칭 안 되는 category(또는 필드 누락)는 맨 끝 "그 외"로 떨어져 새 게임도 항상 노출된다.
CATEGORIES = [
    {"id": "merge", "title": "합치기·키우기", "tagline": "합치고 먹어서 점점 커져요"},
    {"id": "arcade", "title": "순발력·아케이드", "tagline": "순간 반응과 타이밍"},
    {"id": "puzzle", "title": "느긋한 두뇌 퍼즐", "tagline": "시간제한 없이 한 수 한 수"},
    {"id": "board", "title": "맞추기·보드", "tagline": "규칙으로 겨루는 한 판"},
    {"id": "logic", "title": "추리·기억", "tagline": "단서를 읽고 알아맞혀요"},
]
_ETC = {"id": "etc", "title": "그 외", "tagline": ""}


def load_games() -> list[dict]:
    """games.json을 읽어 게임 목록 반환. 파일이 바뀌었을 때만 재파싱.

    파일이 깨졌거나 없으면 직전 정상값(없으면 빈 목록)을 돌려준다 —
    운영자가 games.json을 잘못 편집해도 서빙 hot path가 500으로 번지지 않게.
    """
    try:
        mtime = REGISTRY_PATH.stat().st_mtime
        if _cache["mtime"] != mtime:
            data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
            _cache["games"] = data["games"]
            _cache["mtime"] = mtime
        return _cache["games"]
    except Exception:
        logger.exception("games.json 로드 실패 — 직전 캐시/빈 목록으로 대체")
        return _cache["games"]


def games_by_id() -> dict[str, dict]:
    return {g["id"]: g for g in load_games()}


def playable_ids() -> set[str]:
    """실제 플레이 가능한 게임 슬러그 집합 (서빙/리다이렉트/share 검사용)."""
    return {g["id"] for g in load_games()}


def valid_event_games() -> set[str]:
    """ping/score가 허용하는 game 값 = 플레이 게임 + 합성 소스(portal).

    lab 게임도 포함 — 실험실 게임은 서빙·계측이 정상 동작해야 초기 신호(얍-곡선)를 얻는다.
    """
    return playable_ids() | SYNTHETIC_SOURCES


def is_lab(g: dict) -> bool:
    """실험실(lab) 게임 여부. games.json 엔트리에 `"lab": true`면 프로토타입."""
    return bool(g.get("lab"))


def home_games() -> list[dict]:
    """홈 그리드·sitemap·리더보드 등 *공개 노출*에 쓰는 게임 = lab 제외."""
    return [g for g in load_games() if not is_lab(g)]


def lab_games() -> list[dict]:
    """실험실(/lab)에만 노출하는 프로토타입 게임."""
    return [g for g in load_games() if is_lab(g)]


def home_games_by_category() -> list[tuple[dict, list[dict]]]:
    """홈 게임을 카테고리(폴더)별로 묶어 (카테고리 메타, 게임들) 순서대로 반환.

    - 카테고리 순서 = CATEGORIES 순서. 각 카테고리 안 게임 순서 = games.json 순서(대략 hot 우선).
    - 게임이 하나도 없는 카테고리는 건너뛴다.
    - 알 수 없는 category / 필드 누락 게임은 맨 끝 "그 외"로 모은다.
    """
    grouped: dict[str, list[dict]] = {c["id"]: [] for c in CATEGORIES}
    etc: list[dict] = []
    for g in home_games():
        cid = g.get("category")
        if cid in grouped:
            grouped[cid].append(g)
        else:
            etc.append(g)
    out = [(c, grouped[c["id"]]) for c in CATEGORIES if grouped[c["id"]]]
    if etc:
        out.append((_ETC, etc))
    return out


def public_games() -> list[dict]:
    """/api/games 응답용 — 클라이언트가 쓰는 필드만, icon은 컨벤션으로 채워서.

    lab 게임도 포함하되 `lab` 필드로 구분한다 — dash는 전체를 보고,
    rank 등 공개 목록은 클라이언트에서 `lab`을 걸러낸다.
    """
    out = []
    for g in load_games():
        out.append(
            {
                "id": g["id"],
                "title": g.get("title", g["id"]),
                "tagline": g.get("tagline", ""),
                "unit": g.get("unit", "점"),
                "score_key": g.get("score_key"),
                "score_metric": g.get("score_metric", "best"),
                "icon": f"/{g['id']}/icon-192.png",
                "state_keys": g.get("state_keys", []),
                "lab": is_lab(g),
            }
        )
    return out
