# DESIGN v2 — 유저 / 친구 / 크레딧 / 상태 동기화 / PWA

작성: 2026-06-07. 12-agent 설계 워크플로우(identity 스트레스 테스트 → 6영역 설계 → 적대 검증) 결과 종합.
구현 전 설계 문서. 비판 단계에서 잡힌 critical 4건의 수정이 본문에 모두 반영되어 있다.

## 0. 요구사항과 확정 원칙

요구사항 (2026-06-07 사용자):

1. user 도입 — 모든 미니게임에서 통용
2. 가입은 아이디+비밀번호로 간단하게. 카카오 등은 확장 가능하되 **미리 구현 금지 (YAGNI)**
3. 게임 기록을 user가 소유
4. 친구맺기 — 친구 기록 트래킹
5. 플레이마다 크레딧 적립 (용도 미정)
6. 게임을 쉽게 추가할 수 있어야 함
7. 게임 상태 = localStorage + 서버 저장 + sync
8. PWA, 나중에 앱스토어 출시가 어렵지 않게

대화에서 확정된 데이터 분류 (이 문서 전체의 기준):

| 데이터 | 위치 | 오프라인/DB 장애 시 |
|---|---|---|
| 플레이에 필요한 상태 (진행도·신기록·설정) | **localStorage가 원본** + 서버 sync | 게임 정상 동작, 다음 접속 때 sync |
| 크레딧 (적립·사용), 친구, 리더보드 | **서버 전용** | 그냥 안 됨. 적립 소급 없음 |

기존 원칙 유지: ① 게임 원본 파일 무수정 (서빙 주입만) ② DB 없어도 게임 동작 ③ 빌드 없는 vanilla JS ④ 테이블 복수형 / KST naive / FK 제약 없이 인덱스만.

---

## 1. Identity 등뼈 — 모든 요구사항이 여기 매달린다

기록 소유(3)·친구(4)·크레딧(5)·sync(7)가 전부 "user가 누구냐"에 의존하므로 이걸 먼저 확정한다.

### 1.1 모델

```sql
CREATE TABLE users (
  id            VARCHAR(64)  NOT NULL PRIMARY KEY,        -- uuid str. 불변 PK = 모든 FK가 가리키는 안정 키
  nickname      VARCHAR(32)  NOT NULL,                    -- 로그인 ID 겸 표시명. UNIQUE. ★PK 아님
  password_hash VARCHAR(128) NULL,
  kakao_id      VARCHAR(32)  NULL,                        -- UNIQUE. 자리만 (지금 미사용)
  created_at    DATETIME     NOT NULL,
  UNIQUE KEY uq_users_nickname (nickname),
  UNIQUE KEY uq_users_kakao (kakao_id)
);
```

**닉네임 = 로그인 ID = 표시명 (한 컬럼), 단 PK는 uuid.** 사용자 결정: 가입은 닉네임+비번 2필드,
별도 아이디 없음. 닉네임으로 로그인한다. 하지만 PK를 닉네임으로 잡지 않는 이유 = **나중에 닉네임
변경권을 판매할 수 있도록** — PK는 불변 uuid(`id`)라 모든 scores/friendships/credits FK가 여기 매달리고,
닉네임 변경은 `users.nickname` 한 컬럼 UPDATE + 유니크 재검사로 끝난다(FK 안 깨짐). 지금은 닉네임 변경
기능 안 만든다(가입 후 불변). 가입 페이지에서 **닉네임 중복 검사 + 경고만** 제공.

```sql
ALTER TABLE visitors ADD COLUMN user_id VARCHAR(64) NULL;   -- "이 디바이스의 현재 주인" (mutable claim)
ALTER TABLE visitors ADD INDEX ix_visitors_user (user_id);

ALTER TABLE scores ADD COLUMN user_id VARCHAR(64) NULL;     -- "이 기록의 역사적 소유자" (write-time snapshot)
ALTER TABLE scores ADD INDEX ix_scores_game_user (game, user_id);
```

**왜 scores에도 user_id를 박는가 (검증에서 잡힌 critical).** `visitors.user_id` join만으로 해석하면
공용 PC에서 user A가 점수 쌓고 → B가 같은 디바이스에서 로그인하는 순간, A의 과거 점수 전부가
COALESCE 집계에서 B로 재귀속된다 (visitor의 user_id가 mutable이라서). 그래서:

- **visitors.user_id** = 현재 claim (다음 점수의 snapshot 소스로만 사용)
- **scores.user_id** = 기록 *시점*의 소유자 snapshot — 한 번 박히면 안 바뀜
- 집계 주체 = `COALESCE(scores.user_id, scores.visitor_id)` — scores 단독, join 불필요

기존 데이터 마이그레이션 0건 (익명 기록은 user_id NULL인 채 그대로). user_identities 같은
provider 추상 테이블은 **만들지 않는다** — users.kakao_id 컬럼 자리가 곧 확장 seam.

### 1.2 가입/로그인 (라우터 `app/routers/users.py`, prefix `/auth`)

| Method | Endpoint | 동작 |
|---|---|---|
| POST `/auth/register` | `{nickname, password, visitor_id}` | 닉네임 중복 검사 → bcrypt 해싱 → User insert → claim → 세션 쿠키 |
| POST `/auth/login` | `{nickname, password, visitor_id}` | verify → claim → 세션 쿠키 |
| POST `/auth/logout` | — | 쿠키 삭제 (visitor.user_id는 유지) |
| GET `/auth/check-nickname?n=` | — | 가입 폼 실시간 중복 검사 `{available: bool}` |
| GET `/auth/me` | (쿠키) | `{user_id, nickname}` 또는 `{user: null}` — 모든 페이지의 로그인 판정 단일 소스 |

- **가입 폼 = 닉네임 + 비번 2필드.** 닉네임이 로그인 ID 겸 표시명. `/auth/check-nickname`으로 입력 중 중복 경고.
- 해시 = **bcrypt(cost=12) 직접 사용** (passlib X — 유지보수 정체, argon2 X — 파라미터 오설정 위험). 비번 상한 64자.
- 세션 = **itsdangerous URLSafeTimedSerializer** 서명 쿠키 `gp_session`. httponly, samesite=lax, 30일.
  Secure는 `base_url`이 https일 때만 (지금 http:8080 → False, certbot 붙으면 자동 True).
- `SECRET_KEY` .env 필수 (없으면 재시작마다 전 세션 무효).
- brute-force: in-memory `IP+nickname 5분 5회 → 429`. redis/slowapi 과설계 금지.
- **비번 분실 = 복구 없음 (명시적 트레이드오프).** 이메일 인프라는 YAGNI. 새 계정 파면 되고 기록은 DB에 남는다.
- 실패 메시지는 가입/로그인 공통 모호하게 ("닉네임 또는 비밀번호를 확인하세요").

### 1.3 claim — 로그인 순간 과거 익명 기록 귀속

```python
async def claim_visitor(db, visitor_id, user_id):
    visitor.user_id = user_id                                  # 1) 디바이스 claim
    UPDATE scores              SET user_id=:u WHERE visitor_id=:v AND user_id IS NULL   # 2) 익명 점수 백필
    UPDATE credit_transactions SET user_id=:u WHERE visitor_id=:v AND user_id IS NULL   # 3) 익명 크레딧 백필 (4장)
```

**`user_id IS NULL` 조건이 오염 방지의 게이트.** 이미 다른 user가 박힌 행은 절대 안 건드린다.
(③은 검증에서 잡힌 누락 — credits 설계가 가정한 백필이 claim 핸들러에 없었음. 명시적 계약으로 포함.)

### 1.4 write-path 인증 — visitor_id는 익명 트래킹 키일 뿐, 인증 식별자가 아니다

현재 `/api/score`는 body의 visitor_id를 무검증 신뢰한다. user가 붙으면 "위조된 점수도 user가 소유"가 되므로:

- 로그인 상태: **쿠키의 user_id가 권위 소스** → `score.user_id` snapshot. body visitor_id는 위조해도 익명 풀에만 떨어짐.
- 비로그인: 기존 익명 동작 유지. 단 visitor가 이미 claim돼 있으면 그 user로 snapshot
  (beacon/keepalive 경로에서 쿠키가 빠지는 엣지 보강).
- 친구/크레딧/state 등 신규 쓰기 API 전부 동일 원칙: **주체는 항상 쿠키에서, body로 안 받는다.**

### 1.5 리더보드 개편 + 내 기록

```python
subject = func.coalesce(Score.user_id, Score.visitor_id)
# GROUP BY subject → 같은 user의 폰+노트북 기록이 1행으로 dedup
# 닉네임: users.nickname > visitors.nickname > '익명'
```

- `GET /api/me/scores` 신규 — 로그인 user의 게임별 best. 노트북에서 로그인하면 폰에서 쌓은 기록이 보이는,
  "user 도입의 가치가 눈에 보이는 첫 지점". rank.html 내 기록: 로그인 → 이 API / 비로그인 → 기존 localStorage.
- `/s/{id}` 공유 OG에 닉네임 노출 (`○○님의 물병 정렬 — 37레벨`). login_id/user_id는 어디에도 비노출.
- 운영 지표(stats/dash)도 COALESCE 주체 단위로 재정의 — D1/D7은 아직 미구현이므로 처음부터 user 단위로 짠다.

### 1.6 UI

- `GET /account` — 가입/로그인 토글 한 화면 (vanilla, portal.css 톤). body에 `visitor_id: gp_vid` 동봉(claim 트리거).
- index/rank 헤더에 로그인 위젯 (`/auth/me` 1회 fetch). **게임 안에는 로그인 UI 일절 주입 안 함** —
  플레이는 100% 익명 OK, 로그인 유저는 same-origin 쿠키 덕에 자동 캡처가 알아서 user 귀속.

### 1.7 카카오 (deferred — 활성화 시점 작업)

users.kakao_id 자리만. 활성화 때: auth.py 콜백을 "kakao_id로 users upsert → visitor claim"으로 재작성,
state CSRF nonce 검증 추가, `Visitor(id=kakao_id)` 폴백 제거, visitor.kakao_id 실데이터 카운트 확인 후 백필.

---

## 2. 게임 레지스트리 `games.json` — "게임 쉽게 추가"의 핵심

현재 게임 정의가 5곳에 흩어져 있다 (main.py GAMES / api.py VALID_GAMES / portal.js SCORE_KEYS /
rank.html SCORE_KEYS / dash.html NAMES). 단일 소스로:

```jsonc
// games.json (repo 루트 — 게임 폴더 안 X: sync-games.sh의 rm -rf에 쓸려나감. DB X: 서빙 hot path가 DB에 묶임)
{
  "games": [
    {
      "id": "vase", "title": "물병 정렬", "tagline": "...", "unit": "레벨",
      "score_key": "vaseMaxClear", "score_metric": "level",
      "state_keys": [                                  // ← sync 영역과의 단일 인터페이스 (3장)
        { "key": "vaseMaxClear", "merge": "max" },
        { "key": "vaseLevel",    "merge": "max" },
        { "key": "vaseStars",    "merge": "union" },     // {레벨: 별} — 키별 max
        { "key": "vaseBest",     "merge": "union_min" }, // {레벨: moves} — 키별 min (낮을수록 좋음!)
        { "key": "vaseMuted",    "merge": "lww" }
      ]
    },
    { "id": "gateway", ..., "state_keys": [
        { "key": "gatewayBest",  "merge": "max", "init_cache": true },  // game.js:67 — init 1회 read 게임
        { "key": "gatewayMuted", "merge": "lww" } ] },
    { "id": "cube", ..., "state_keys": [
        { "key": "cubeSnakeBest", "merge": "max" },
        { "key": "cubeSnakeMuted","merge": "lww" } ] }
  ]
}
```

- `app/games.py`는 **로더일 뿐** (`load_games()` 매 요청 read — HTML도 매 요청 읽으니 일관, dev 무재시작).
  GAME_STATE_KEYS 같은 별도 dict를 만들지 않는다 (검증에서 잡힌 이중 정의 — games.json이 유일한 집).
- `init_cache` 플래그 = "localStorage를 init에 1회만 읽고 캐시하는 게임" (sync의 reload 판정에 사용, 3.4).
- `GET /api/games` — 레지스트리 노출 (DB 무관 항상 200). rank/dash가 fetch해서 동적 렌더, index는 서버사이드 `{{CARDS}}` 치환.
- load_games에 try/except — games.json 오타가 서빙 전체 500으로 번지지 않게.

**portal.js의 config는 fetch가 아니라 주입 (correctness — 검증 critical).**
portal.js는 `Storage.prototype.setItem`을 래핑하는데, config를 fetch로 받으면 응답 전에 발생한
첫 신기록 쓰기가 후킹 전에 유실된다. 서버는 주입 시점에 game을 아니까 config도 같이 박는다:

```html
<!-- INJECT_SNIPPET 확장: 동기 inline config + portal.js. fetch 의존 0 -->
<script>window.__GP={game:"vase",scoreKey:"vaseMaxClear",scoreMetric:"level",
  stateKeys:[...games.json의 state_keys...],initCache:false};</script>
<script src="/portal.js"></script>
```

**새 게임 추가 절차 = 2단계**: ① `~/game/{new}/` 만들고 `./sync-games.sh` (하드코딩 루프 → `$SRC/*/` 순회로 수정)
② games.json에 entry 1개. 코드 수정 0곳. 단, 새 게임이 init-cache 패턴인지 확인해 `init_cache` 표기 (체크리스트화).

---

## 3. 게임 상태 동기화 — 이 설계의 최난제

### 3.1 merge 시맨틱 — DB·인터페이스는 범용, 게임별 차이는 선언(데이터)만 (사용자 확정)

**핵심 원칙 (사용자 지적): merge가 게임마다 다른 건 "컬럼을 더 파는" 문제가 아니라 "코드"다.**
- `game_states` 테이블은 게임이 몇 개든 merge가 몇 종이든 **영원히 `(user_id, game, k, value, updated_at)`** — value는 opaque JSON TEXT. 게임당 컬럼 추가 0.
- API도 `{changes: {k: v}}`로 범용. 게임 id조차 path 파라미터로 일반화.
- **게임별로 다른 것 = "이 키는 어떤 reducer로 합치냐"는 선언 한 줄**(games.json의 `state_keys[].merge`). 그게 전부.
- merge reducer는 **범용 재사용 라이브러리**(`app/state_merge.py`) — vase 전용 코드가 아니다. 어떤 게임이든 같은 reducer를 재사용한다.

"update_time 비교 양방향 sync"(사용자 제안)는 설정값엔 맞지만 신기록엔 틀린다: 오래 꺼져있던 폰 B가
화요일에 best=40을 쓰면 (월요일의 서버 best=120보다) timestamp가 더 새것이라 LWW가 기록을 파괴한다.
게다가 클라이언트 시계는 못 믿는다. 그래서 범용 reducer 라이브러리를 키별로 선언한다:

| reducer (범용) | 의미 | 어느 게임이든 재사용 | 구현 |
|---|---|---|---|
| `max` | 숫자, 클수록 좋음 | 신기록, 진행 레벨 (gateway/cube/vaseMaxClear) | `GREATEST(server, client)` — 시계 불필요, 순서 무관, 멱등 |
| `union` | 객체, 키별 max | "키별 최고값" 류 (vaseStars `{레벨: 별}`) | 키 합집합 + 값 max |
| `union_min` | 객체, 키별 **min** | "키별 최소값(낮을수록 좋음)" 류 (vaseBest `{레벨: moves}`) | 키 합집합 + 값 min |
| `lww` | updated_at 비교 (서버 시각) | muted 등 순수 설정 | 사용자 제안 그대로 — 설정엔 옳다 |

`union_min`은 검증이 잡은 critical에서 나왔다: vaseBest는 `{level: moves}` 객체이고 **낮을수록 좋은** 기록이라
max/union/lww 어느 것도 못 다룬다 (union이면 더 나쁜 기록이 이기고, max면 객체에 parseInt가 깨져
JSON.parse throw → 레벨별 기록 맵 전체 소실). **단 union_min은 vase 전용이 아니라 범용 reducer** — 앞으로
"낮을수록 좋은 기록을 가진 게임"이면 선언만으로 재사용. 게임별 커스텀 merge *함수*는 안 만든다 — 범용
reducer 4종 + games.json 선언이 한계선. 새 게임이 4종으로 안 되는 진짜 새 shape를 요구할 때만 reducer 1개 추가.

**직렬화 규칙 (게임이 읽는 형식 보존):** max → 정수 문자열(`"120"`), union/union_min → JSON,
lww → **게임이 쓴 raw 문자열 그대로** (cube의 muted는 `'1'/'0'`인데 JSON true/false로 변환하면
`=== '1'` 비교가 깨진다). 키마다 "게임 setItem 원형 → 서버 → 복원값이 게임 getItem 비교를 통과"하는
라운드트립 테스트 필수.

### 3.2 저장 모델

```sql
CREATE TABLE game_states (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(64)  NOT NULL,          -- 로그인 전용. 비로그인 sync 없음 (localStorage만)
  game       VARCHAR(32)  NOT NULL,
  k          VARCHAR(64)  NOT NULL,          -- localStorage 키
  value      TEXT         NOT NULL,
  updated_at DATETIME     NOT NULL,          -- lww 판정용 (서버 시각)
  UNIQUE KEY uq_user_game_key (user_id, game, k)
);
```

### 3.3 프로토콜

```
GET /api/state/{game}   → 쿠키 user의 키맵. 비로그인 401 (→ 클라 sync OFF), DB 없으면 ok:false
PUT /api/state/{game}   → body {changes:{k:v}} — 서버가 키별 시맨틱으로 merge 후 {merged} 반환
                          merge 불가 키는 reason과 함께 응답 (클라가 .catch로 삼키지 말고 console.warn)
                          max는 INSERT ... ON DUPLICATE KEY UPDATE value=GREATEST(...)로 원자화
```

클라이언트 (portal.js 확장 — 기존 setItem 후킹 **하나**에 신기록 캡처 + state push 통합):

1. **pull** (진입 시): 서버값을 키별 merge해 localStorage write-through.
2. **reconcile push** (pull 직후): **로컬 > 서버인 max/union 키는 1회 역방향 push.**
   (검증이 잡은 비대칭 — pull은 서버→로컬만 보므로, 오프라인에서 달성한 기록이
   그 키를 다시 갱신하기 전까지 디바이스에 영영 갇히는 구멍. 멱등이라 안전.)
3. **push** (플레이 중): setItem 가로채기 → debounce 1.5s → PUT. pagehide에서 flush. 오프라인 큐 없음 —
   max 시맨틱 + reconcile 덕에 다음 접속 때 자연 복구. (YAGNI)
4. 비로그인: sync 완전 OFF. 로그인 직후 첫 진입에서 로컬 키 전체 1회 push = 익명 진행의 user 병합.

### 3.4 reload — init-cache 게임의 stale 변수 문제

gateway는 best를 module load 시 1회 읽고 캐시한다. 주입이 `</body>`라 portal.js의 async pull은
항상 게임 init보다 늦다 → 새 디바이스 첫 진입 시 게임이 낮은 로컬값을 들고 있다. 해법:

- `init_cache: true` 게임 + 서버값 > 로컬값일 때만 `location.reload()` 1회 (sessionStorage `gp_synced:{game}` 가드).
- **단 grace window 안에서만**: 첫 pointerdown/keydown 이후엔 reload 금지 — 느린 네트워크에서 pull이
  플레이 도중 도착해 판을 날리는 사고(검증 major) 방지. 게임 시작 후 도착하면 다음 진입으로 미룬다.
- 같은 디바이스 재방문은 직전 세션의 write-through 덕에 reload 자체가 불필요. cube/vase(best는 re-read)는 해당 없음.

### 3.5 계정 전환 오염 가드 (검증 critical)

공용 PC에서 A 로그아웃 → B 로그인하면, A가 남긴 `vaseMaxClear=20`을 B의 초기 push가 올려
**B 계정이 A의 진행을 소유**하게 된다 (max merge "안전"의 거짓 전제). 가드:

- localStorage에 `gp_last_uid` 기록. 로그인 시 직전 uid와 다르면 → **모든 게임의 state_keys를 localStorage에서
  clear 후 pull부터** (초기 push 생략). 같은 uid 재로그인이면 정상 플로우.
- 로그아웃 시에도 state_keys clear (account 페이지가 /api/games로 키 목록 조회 — 여긴 timing 안 중요해서 fetch OK).
- 익명 → 첫 가입은 clear 안 함 (익명 진행을 user로 가져가는 게 맞는 동작).

---

## 4. 크레딧 — 서버 전용 (사용자 확정). ★1차는 골격만, 적립 규칙은 TODO

**사용자 결정: 골격(ledger 테이블 + 잔액 조회)만 깔고, 적립 규칙·금액은 구현하지 않는다.**
용도가 정해지면 적립 규칙이 그에 종속되므로, 지금 박으면 갈아엎게 된다. 아래 적립 규칙 표는
**나중에 "크레딧 적립 구현해줘" 하면 바로 찾아 채울 spec**이다. 코드에는 명확한 TODO marker를 남긴다:

```python
# app/credits.py
# ============================================================================
# TODO(크레딧 적립): 용도 확정 후 구현. 규칙 spec = DESIGN.md §4 "적립 규칙(미구현)" 표.
#   - ping(type=end) 핸들러 / score 핸들러 안에서 award_if_under_cap() 호출
#   - 지금은 ledger 테이블 + GET /api/me/credits(SUM 잔액)만 산다.
# ============================================================================
def award_if_under_cap(...):  # 골격만, 호출처 없음
    raise NotImplementedError("DESIGN.md §4 — 적립 규칙 확정 시 구현")
```

append-only ledger. **클라이언트발 "credit earn" 이벤트는 만들지 않는다** — 구현 시점에도 서버가 이미 받는
신호(ping/score)의 핸들러 안에서만 적립. 오프라인 적립/소급 없음. localStorage에 크레딧 안 둠.

```sql
CREATE TABLE credit_transactions (
  id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(64) NULL,              -- 적립 시점 snapshot (scores와 동일 패턴)
  visitor_id VARCHAR(64) NOT NULL,          -- claim 병합 키
  amount     INT         NOT NULL,          -- +적립 / -소비 (spend는 음수 행 자리만)
  reason     VARCHAR(32) NOT NULL,
  game       VARCHAR(32) NULL,
  meta       JSON        NULL,
  created_at DATETIME    NOT NULL,
  KEY ix_credit_subject (user_id, visitor_id),
  KEY ix_credit_dedup   (visitor_id, reason, created_at)
);
-- ref(멱등 키) 컬럼은 YAGNI 검증에서 cut — 쓰는 로직이 전부 deferred였음. 필요해지면 expand ADD COLUMN
```

**적립 규칙 (미구현 — 구현 시 이 표대로 채운다):**

| reason | 트리거 (서버 핸들러) | 금액 | 방어 |
|---|---|---|---|
| `play_session` | ping type=end, duration ≥ 60s | +10 | duration clamp 30분, 게임당 1일 5회 |
| `daily_first` | 그날 첫 play_session | +30 | 1일 1회 |
| `new_record` | score POST가 기존 best **초과**일 때만 | +20 | 게임당 1일 3회 (자동 캡처 중복 적립 차단 게이트) |
| `spend_*` | 용도 미정 — **API 안 만듦** | 음수 자리만 | 용도 확정 시 FOR UPDATE 잔액 검사와 함께 |

**1차에 실제로 구현하는 것 (골격):**
- credit_transactions 테이블 + 인덱스 (DDL).
- `GET /api/me/credits` — `SUM(amount)` 잔액 + 최근 내역 (적립행이 0건이면 잔액 0).
- `app/credits.py`에 `award_if_under_cap()` 시그니처만 (NotImplementedError) + TODO marker.
- rank/헤더 잔액 배지는 0이어도 표시 가능하나, 적립이 0이라 의미 없음 → **배지도 구현 시점에** (deferred).

**구현 시 결정 그대로 적용할 설계 메모:** balance = `SUM(amount)` 파생 (캐시 컬럼 X — lost update race 원천
제거). 비로그인 적립은 visitor 단위로 쌓이고 claim 때 1회 백필 (1.3의 ③). duration 위조는 하한+clamp+cap
3중으로 가둠. — 이 메모는 "나중에 구현" 버튼을 눌렀을 때 바로 따라가면 되는 가이드.

---

## 5. 친구 — 단방향 follow

유일 use case "친구 기록 보기"의 대상은 이미 /rank에 공개된 데이터다. 보호할 비밀이 없으므로
상호 수락 상태머신은 과설계 → **단방향 follow**. 주체는 항상 user (익명은 친구 불가 = 가입 wedge).

```sql
CREATE TABLE friendships (
  id          VARCHAR(64) NOT NULL PRIMARY KEY,
  follower_id VARCHAR(64) NOT NULL,
  followee_id VARCHAR(64) NOT NULL,
  created_at  DATETIME    NOT NULL,
  UNIQUE KEY uq_friendship (follower_id, followee_id),
  KEY ix_friendships_follower (follower_id)
);
```

**친구 찾기 = 기존 카톡 공유 루프에 결합** (login_id 검색 X — enumeration 표면 + viral 루프 없음):

1. 로그인 user A의 점수 공유 → `/s/{score_id}`가 카톡에 돈다 (기존 그대로)
2. share.html이 `GET /api/score-owner/{id}` → 주인이 user면 **"○○님 친구 추가하고 기록 받아보기"** CTA 노출
3. CTA → `/follow/{user_id}` (점수가 아니라 **사람**에 고정 — 점수 갱신돼도 같은 대상)
4. 방문자 로그인 상태면 즉시 follow, 비로그인이면 `?next=/follow/{id}`로 가입 → 자동 follow → /rank
   ("친구 기록 보고 싶다"가 가입의 단일 명분이 되는 동선)

- API: `POST/DELETE /api/follow` (follower = 쿠키 세션, body 신뢰 X, idempotent, self-follow 400),
  `GET /api/friends`, `GET /api/friends/leaderboard/{game}` (followee + 본인, `scores.user_id IN (...)` — snapshot 컬럼 의존).
- UI: 별도 페이지 X — rank.html의 게임 board마다 **"전체 | 친구" 토글** (fetch URL 스왑만). 비로그인은 가입 배너 1줄.
- 로그인 판정은 전부 `GET /auth/me`로 통일 (/api/me 같은 건 안 만든다 — 검증에서 잡힌 phantom 엔드포인트).
- deferred: follower 목록 UI, 차단, 알림, 피드 — 단방향 모델이 어느 것도 막지 않음 (컬럼 추가로 확장 가능).

---

## 6. PWA + 앱스토어 경로

**모든 것의 선결 조건 = https 도메인.** http://IP:8080에선 SW 등록·설치 prompt·TWA 전부 불가.
코드는 지금 ship해도 http에서 무해(no-op)하고 도메인 붙는 순간 자동 활성 — 단 구현 순서는 마지막(8장).

- `GET /manifest.webmanifest` 동적 서빙 — name "한 판 하고 가요", scope `/`, display standalone,
  theme `#101014`, 포털 전용 아이콘 (현재 favicon이 vase 것을 빌려 쓰는 중 — 브랜딩 교체).
  게임들은 이미 각자 PWA(scope `/{game}/`)라 충돌 없음. 게임별 설치는 accepted bonus.
- `GET /sw.js` 포털 SW — **게임 경로는 SW가 절대 손대지 않는다** (fetch 핸들러에서 GAME_RE면 respondWith
  미호출 = 순수 네트워크 + 기존 Cache-Control). 이게 stale-game 사고 재발의 하드 가드.
  포털 shell만 network-first (캐시는 오프라인 fallback 전용). GAME_RE는 games.json에서 서버가 주입.
- **NOOP_SW 수정 필수 (한 세트)**: 현재 NOOP의 `caches.delete`는 origin 전역이라 게임 열 때마다
  포털 캐시까지 지운다 → `'portal-'` 접두 캐시 제외 필터 1줄. 안 하면 포털 SW가 silent no-op.
- 설치 유도: beforeinstallprompt를 stash → /rank에서만 노출 (mid-game 금지). iOS는 수동 안내 문구.
- 오프라인 게임 플레이 = 지원 안 함 (의식적 결정 — snapshot 통째 교체 모델에서 오프라인 캐시가 더 위험).
- 앱스토어: Android TWA (도메인 + assetlinks.json + Play $25 — manifest가 TWA-ready라 작업 작음) /
  iOS는 PWA 홈화면 추가 우선, Capacitor wrap($99/yr + thin-wrapper 리젝 리스크)은 수요 검증 후. **둘 다 defer.**

---

## 7. DDL 전체 (적용 순서 = 구현 phase 순서)

규칙: **expand DDL은 해당 코드 푸시 전에 운영 DB(game_portal)에 선반영.** 전부 ADD COLUMN nullable / CREATE TABLE이라 무중단.

```sql
-- Phase 1 (auth)
CREATE TABLE users (...);                                   -- 1.1
ALTER TABLE visitors ADD COLUMN user_id VARCHAR(64) NULL, ADD INDEX ix_visitors_user (user_id);
ALTER TABLE scores   ADD COLUMN user_id VARCHAR(64) NULL, ADD INDEX ix_scores_game_user (game, user_id);
-- Phase 2 (sync)
CREATE TABLE game_states (...);                             -- 3.2
-- Phase 3 (credits) — claim 백필 코드보다 먼저 존재해야 함
CREATE TABLE credit_transactions (...);                     -- 4
-- Phase 4 (friends)
CREATE TABLE friendships (...);                             -- 5
```

신규 의존성: `bcrypt>=4.0`, `itsdangerous>=2.0` + `.env`에 `SECRET_KEY`.

---

## 8. 구현 순서와 build/defer 선

| Phase | 내용 | 비고 |
|---|---|---|
| **0. 레지스트리** | games.json + app/games.py + 주입 config + 5곳 중복 소멸 + sync-games.sh 루프 | 모든 phase의 기반. 단독 배포 가능 |
| **1. 유저** | users/claim/세션/write-path 인증/리더보드 dedup/me·scores/account UI/공유 닉네임 | 등뼈. 여기까지가 "기록 소유" |
| **2. 상태 sync** | game_states + GET/PUT + portal.js sync 블록 + 전환 가드 + 라운드트립 테스트 | 최난제 — 3장의 가드 전부 포함 |
| **3. 크레딧 (골격)** | ledger 테이블 + GET /api/me/credits(SUM) + award 시그니처+TODO | **적립 규칙·배지는 미구현** — 용도 확정 후 §4 표대로 |
| **4. 친구** | friendships + follow 루프 + rank 토글 | 공유 루프 결합 |
| **5. PWA** | manifest/아이콘/SW/NOOP 수정/설치 유도 | 도메인 후 활성. TWA/iOS는 defer |

**명시적 defer 목록**: 카카오 활성화 / spend API / 비번 복구 / 리더보드 캐시 / 오프라인 큐 /
커스텀 merge 함수 / follower 목록·차단·알림 / TWA·Capacitor / user_identities 테이블 (영구 — 만들지 않음).

## 9. 검증(적대 단계)에서 잡혀 설계에 반영된 함정 — 구현 때 다시 보기

1. **vaseBest는 `{레벨: moves}` 키별-min 객체** — union_min 없으면 silent corruption (3.1)
2. **공용 디바이스 계정 전환** — gp_last_uid 가드 없으면 B가 A의 진행을 흡수 (3.5)
3. **pull/push 비대칭** — reconcile push 없으면 오프라인 기록이 디바이스에 갇힘 (3.3-2)
4. **mid-game reload** — grace window 없으면 느린 망에서 플레이 도중 판 파괴 (3.4)
5. **portal.js config fetch 금지** — 첫 신기록 유실 race. 반드시 주입 (2장)
6. **claim의 크레딧 백필 누락** — 익명 크레딧이 조용히 사라짐 (1.3)
7. **NOOP_SW 전역 캐시 삭제** — 포털 SW를 조용히 무력화 (6장)
8. **lww 직렬화** — '1'/'0' 같은 raw 문자열을 JSON 변환하면 게임 비교문 깨짐 (3.1)
9. **visitors.user_id 단독 해석 금지** — scores.user_id snapshot이 오염 방지의 등뼈 (1.1)
10. **재로그인 백필은 `user_id IS NULL` 행만** — 이 조건이 빠지면 기록 도둑질 (1.3)
