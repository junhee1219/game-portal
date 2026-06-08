"""게임 상태 sync용 범용 merge reducer.

DB·인터페이스는 범용 (game_states.value = opaque JSON). 게임별 차이는 games.json의
state_keys[].merge 선언뿐이고, 아래 reducer는 어떤 게임이든 재사용한다 (vase 전용 코드 X).

- max:       숫자, 클수록 좋음 (신기록/진행 레벨)
- union:     객체, 키별 max (vaseStars {레벨: 별} — 높을수록 좋음)
- union_min: 객체, 키별 min (vaseBest {레벨: moves} — 낮을수록 좋음)
- lww:       시간 비교 (muted 등 설정) — endpoint가 updated_at으로 처리, value는 opaque
"""
import json


def _as_int(v) -> int:
    if isinstance(v, bool):
        return 0
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _as_obj(v) -> dict:
    if isinstance(v, dict):
        return dict(v)
    if isinstance(v, str):
        try:
            d = json.loads(v)
            return dict(d) if isinstance(d, dict) else {}
        except ValueError:
            return {}
    return {}


def merge_max(server, client):
    return max(_as_int(server), _as_int(client))


def merge_union(server, client):
    """키별 max (높을수록 좋은 객체)."""
    out = {k: _as_int(v) for k, v in _as_obj(server).items()}
    for k, val in _as_obj(client).items():
        n = _as_int(val)
        if k not in out or n > out[k]:
            out[k] = n
    return out


def merge_union_min(server, client):
    """키별 min (낮을수록 좋은 객체 — vaseBest의 moves)."""
    out = {k: _as_int(v) for k, v in _as_obj(server).items()}
    for k, val in _as_obj(client).items():
        n = _as_int(val)
        if k not in out or n < out[k]:
            out[k] = n
    return out


REDUCERS = {"max": merge_max, "union": merge_union, "union_min": merge_union_min}


def merge_value(merge_type: str, server, client):
    """server 기존값과 client 입력값을 merge. lww/미지의 타입은 client(최신 쓰기)가 이긴다.

    server가 None(첫 기록)이면 reducer가 _as_int(None)=0 / _as_obj(None)={}로 자연 처리.
    max/union/union_min은 순서 무관·멱등이라 동시 push에도 수렴한다.
    """
    fn = REDUCERS.get(merge_type)
    if fn is None:  # lww 또는 미지 → 최신 쓰기 우선
        return client
    return fn(server, client)
