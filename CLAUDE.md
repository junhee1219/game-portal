# game-portal — 미니게임 포털

`https://mini-game.kr` — 설치·가입 없이 바로 하는 웹 미니게임 모음. 게임 원본은 **무수정**, 서빙 레이어에서 계측·계정·동기화·PWA를 주입한다.

> **상세 설계(6 phase · DDL · 적대 검증 함정) → [`DESIGN.md`](./DESIGN.md)**.
> 이 파일은 *AI agent(Claude Code) 맥락 자동 주입*용 high-level 요약.

---

## 핵심 원칙

- **게임 원본 무수정.** `games/{id}/`에 원본 그대로 둔다. 계측은 *서빙 시점*에 HTML로 주입한다.
- **DB·인터페이스는 범용, 게임별 차이는 선언(데이터)만.** 새 게임은 컬럼을 안 판다 — `games.json` 엔트리 + 폴더로 끝.
- **DB 죽어도 게임 플레이는 동작.** 계측/계정 API는 조용히 실패하고 플레이는 계속된다.
- **게임 추가 = 폴더 + `games.json` 한 엔트리.** 코드 수정 없음.

---

## 모든 게임 공통 의무 (game contract)

새 게임을 추가하거나 기존 게임을 손볼 때 **예외 없이** 지킨다. 게임별 코드가 아니라 *서빙/포털 레이어*에서 일괄 주입·강제하는 게 원칙(원본 무수정).

- **톤 일관.** 모든 게임은 동일한 비주얼 톤을 유지한다 — 아이콘 2층 구조 + 아래 *시각 디자인 규칙*을 그대로 따른다. 게임마다 따로 노는 색·폰트·이펙트 금지. "한 포털의 게임"으로 보여야 한다.
- **회원 기능 공유.** 로그인·계정·리더보드·크로스 디바이스 동기화는 **포털 공용 1벌**(`portal.js` + `/api/*` + `users`/`scores`/`game_states`)을 모든 게임이 함께 쓴다. 게임별 별도 계정/로그인 만들지 않는다.
- **후원 기능 필수.** 모든 게임에 후원(토스 · 카카오뱅크) 진입점을 넣는다. 게임 원본에 박지 말고 *포털이 주입*하는 공용 UI(예: `portal.js`가 띄우는 후원 버튼/모달)로 일괄 제공 → 새 게임은 자동 포함. 송금 링크·계좌는 서버 설정/`.env`에만 두고 **커밋 금지**. (현재 미구현 — 구현 시 이 레이어에 추가)

---

## 기술 스택

| 구분 | 기술 |
|---|---|
| Framework | FastAPI (Python 3.14) |
| DB | MySQL (async, SQLAlchemy 2.0 + aiomysql) |
| Frontend | **정적 HTML/CSS/JS — 빌드·npm 없음** (필요한 것만 복사해서 씀) |
| Async | FastAPI `BackgroundTasks` |
| 인증 | bcrypt 해시 + itsdangerous 서명 httponly 쿠키 |
| PWA | 동적 `/manifest.webmanifest` + `/sw.js` |

---

## 아키텍처 — 서빙 시점 주입

- 게임 요청(`/{game}/...`)은 `app/main.py`의 `serve_game`이 처리. `index.html`이면 `</body>` 앞에 **`portal.js`를 주입**한다.
- 게임별 config(점수 키·상태 키 등)는 `<script data-*>` **속성으로 전달** — `fetch` 아님 (게임이 `setItem`을 먼저 호출해 후킹 race가 나는 걸 피하려고).
- `portal.js`가 `Storage.prototype.setItem`을 후킹: ① 신기록 자동 캡처(리더보드) ② 상태 변경 push(로그인 시).
- 게임 자체 `sw.js`는 서빙에서 **NOOP로 대체**(stale cache 방지). HTML은 `no-cache`(게임 업데이트 즉시 반영), 에셋은 짧은 캐시.

---

## 게임 레지스트리 (`games.json`) — "게임 쉽게 추가"의 핵심

단일 소스. `app/games.py`가 로드. 엔트리 1개 = 게임 1개:

```json
{
  "id": "vase",
  "title": "물병 정렬",
  "tagline": "...",
  "unit": "레벨",
  "score_key": "vaseMaxClear",      // 리더보드에 올릴 localStorage 키
  "score_metric": "level",
  "state_keys": [                    // 크로스 디바이스 동기화 대상 + merge 방식
    { "key": "vaseMaxClear", "merge": "max" },
    { "key": "vaseStars",    "merge": "union" },
    { "key": "vaseBest",     "merge": "union_min" },
    { "key": "vaseMuted",    "merge": "lww" }
  ]
}
```

현재 게임: **vase**(물병 정렬, score=vaseMaxClear) · **cube**(Cube Snake, cubeSnakeBest) · **gateway**(라면집 사장님, gatewayBest).
새 게임: `games/{id}/` 폴더 + 위 엔트리 추가 → 끝. `score_key` 없으면 리더보드 미참여, `state_keys` 없으면 동기화 안 함.

---

## 데이터 모델 (`app/models.py`)

| 테이블 | 역할 | id |
|---|---|---|
| **users** | 계정 (nickname=로그인ID, password_hash, kakao_id 자리) | uuid hex (String) |
| **visitors** | 익명 방문자 (user_id 연결 가능) | uuid hex (String) |
| **scores** | 리더보드 기록 (user_id 스냅샷 + visitor_id) | BigInt |
| **game_states** | 게임별 상태 (k, value=opaque JSON) | BigInt |
| **credit_transactions** | 크레딧 ledger (★골격만) | BigInt |
| **friendships** | 단방향 follow | uuid hex (String) |
| **events** | ping/플레이 이벤트 | BigInt |

**룰**: 테이블명 *복수형*. 시간대 *KST*. localStorage 키는 *게임 접두사*(같은 origin에 게임 여러 개) — `vaseMaxClear`, `gatewayBest`, `cubeSnakeBest`.

---

## 계정 · 기록 · 크로스 디바이스 동기화 (이 프로젝트의 최난제)

- **로그인** = 닉네임(=로그인 ID, 중복 불가, *현재 변경 불가* — 나중에 변경권 판매 대비해 PK는 uuid) + 비밀번호.
- **점수(리더보드)**: 게임이 신기록을 localStorage에 쓰는 순간 `portal.js` 후킹이 자동 캡처 → `/api/score`. 로그인 시 `user_id`, 익명 시 `visitor_id`로 기록. 리더보드는 `COALESCE(user_id, visitor_id)`로 dedup(같은 유저의 폰+노트북이 1행).
- **상태(레벨·진행·설정)**: `game_states`, **로그인 시에만** 동기화. 진입 시 서버→로컬 pull+merge, 변경 시 debounce push. **익명 플레이는 동기화 안 함**(그 브라우저 localStorage에만).
- **merge**: 키별 reducer(`app/state_merge.py`) — `max`(높은 값) / `union`(키별 합집합) / `union_min`(키별 낮은 값, 예: 최소 이동수) / `lww`(마지막 우선). games.json `state_keys`에 *선언*. 덕분에 폰+노트북 따로 해도 "각자 최고"가 충돌 없이 병합.
- **claim**: 로그인하는 순간 *그 기기의* 익명 기록(`user_id IS NULL`)만 계정에 귀속. 다른 user 것은 안 건드림 = 계정 전환 도둑질 방지.
- **크로스 origin 이전**: 게임의 다른 배포본(예: github.io)은 브라우저 localStorage 격리로 자동 이전 불가. 게임에 export/import가 있으면 그걸로 — vase는 비밀 작업실(타이틀 5탭)의 `VASE1.` 코드. import가 `setItem` → 로그인 상태면 포털 동기화가 받아 계정에 올린다.

---

## 아이콘 2층 구조 (UI 아이콘 컨벤션)

게임·포털 UI 아이콘은 **2층 구조**로 통일한다. **직접 그리지 않는다** — 글리프는 검증된 세트에서 가져오고, 재질·모션·시스템만 자체 제작.

| 층 | 용도 | 출처 | prefix | 라이선스 |
|---|---|---|---|---|
| 1층 UI 크롬 | 되돌리기·사운드·잠금·트로피·공유·화살표 | [Phosphor Icons](https://phosphoricons.com) **Fill** | `p-` | MIT (크레딧 불필요) |
| 2층 게임 오브젝트 | 물병·돌고래·과일·라면·뱀 | [game-icons.net](https://game-icons.net) | `g-` | **CC BY 3.0 (크레딧 필수)** |

- 마크업: `<svg class="ki"><use href="#p-trophy"/></svg>`
- `.ki` = 단색 글리프(`currentColor`) — **24px 미만은 무조건 `.ki`** (외곽선은 작은 크기에서 디테일이 뭉갬). `.ki.sm`(18) / `.ki.lg`(32).
- `.ki-o` = 외곽선 입힌 "사물" 버전(버튼 위 캔디 느낌), game-icons는 `.ki-o.g` — **40px+ 히어로/장식에만**.
- 심볼 시트 `sprite.svg`에서 **쓸 `<symbol>`만** 추려 페이지 `<body>` 최상단에 인라인.
- 소스 = `game-kit`(별도 *로컬 자산 폴더*, 이 repo 밖 — sprite.svg + `.ki` CSS 규칙. git repo 아니라 파일 모음).
- ⚠️ game-icons.net(`g-*`)을 쓰면 **푸터에 크레딧 한 줄 필수**: `Icons: game-icons.net (CC BY 3.0) · Phosphor`.

### 시각 디자인 규칙 (AI 티 안 나게 — 아트디렉팅 세션 확정)

- 그라데이션: 색상 고정, **명도 폭 ≤12%** (색이 흐르면 "CSS 데모" 티).
- 빛 표현은 하나만: 크리스프 윗 림 + 부드러운 하단 음영. 띠(banding) 금지.
- 바닥은 **하드 섀도(블러 0)** = "사탕이 바닥에 놓인" 느낌.
- ❌ **검보라 그라데이션 + 네온 글로우 금지** (AI 티의 주범) → 단일 색조 차분한 톤 + 미세 질감.
- 아이콘 외곽선은 중립 다크 한 색으로 통일, 버튼 대비 ~30% 여백.

---

## 컨벤션

- Python 3.14, async/await, SQLAlchemy 2.0 declarative, 타입힌트, 한국어 docstring OK.
- 프론트는 정적 — 빌드 단계 없음. shadcn/Vite 같은 거 도입 금지(이 프로젝트 철학).
- 크레딧은 **골격만**: `app/credits.py`의 `award_if_under_cap()`는 `NotImplementedError` + TODO. 적립 규칙 spec은 `DESIGN.md §4`. "크레딧 적립 구현해줘" 하면 거기 + ping/score 핸들러를 채우면 됨.
- 커밋+푸시 **한 세트**. 커밋 전 브라우저(playwright/puppeteer) 스크린샷으로 렌더 확인.

---

## 알려진 quirks (밟은 함정 — 다시 밟지 말 것)

- **collation 통일 필수**: 모든 테이블 `utf8mb4_unicode_ci`. 새 테이블 DDL에 `CHARACTER SET utf8mb4`만 쓰면 서버 기본값(`utf8mb4_0900_ai_ci`)으로 생성돼 **cross-table JOIN이 500**(Illegal mix of collations). `COLLATE utf8mb4_unicode_ci` 명시.
- **expand DDL은 코드 푸시 *전에***: `ADD COLUMN` 등은 배포 전에 DB(운영+개발)에 먼저 친다. 안 그러면 배포 시 ORM이 없는 컬럼 찾다 장애.
- **DDL 마이그레이션은 직접 ALTER** — `restart.sh`에 넣지 않는다.
- 상태 push는 1.5s debounce지만 `pagehide` keepalive + 진입 시 reconcile push 안전망이 있어, 가져오기 직후 reload돼도 유실 안 됨.
- `gp_auth`(localStorage 힌트)가 있을 때만 `/api/state` 호출 → 익명은 안 쳐서 **401 콘솔 노이즈 0**. (보안 아님 — 서버가 쿠키로 진짜 검증. "이 기기에서 로그인한 적 있음" 표시일 뿐)
- 게임 sw.js는 NOOP 대체, 포털 PWA sw는 *포털 페이지 + https*에서만 등록(게임 경로는 passthrough = stale 0).
- **크로스 origin localStorage 격리**: 다른 도메인에서 하던 기록은 JS로 못 읽음 (위 "크로스 origin 이전" 참고).

---

## 배포

- 서버에서 **`./restart.sh`** (git pull → 의존성 → 서비스 재시작 → 헬스체크). 도메인 `https://mini-game.kr`.
- 게임 원본은 이제 `games/{id}/`를 repo에서 직접 편집·커밋한다 (별도 원본 폴더/`sync-games.sh` 동기화 폐지). "게임 원본 무수정" 원칙은 *서빙 레이어가 게임 코드를 안 건드린다*는 의미로 유지 — 게임 자체 개선은 `games/`에서 한다.
- **DB 접속 정보·서버 호스트·시크릿(secret_key 등)은 서버에만 존재** — repo와 이 문서에는 없다. 새로 추가할 때도 절대 커밋하지 말 것 (`.env`는 gitignore).

---

## 프로젝트 구조 (요약)

```
game-portal/
├── DESIGN.md            # 상세 설계 (6 phase · DDL · 검증 함정) — 깊은 맥락은 여기
├── games.json           # 게임 레지스트리 단일 소스
├── app/
│   ├── main.py          # FastAPI · 게임 서빙(주입) · 포털 라우트 · manifest/sw
│   ├── games.py         # games.json 로더
│   ├── models.py        # User/Visitor/Score/GameState/CreditTransaction/Friendship/Event
│   ├── state_merge.py   # merge reducer (max/union/union_min/lww)
│   ├── credits.py       # 크레딧 골격 (적립 미구현)
│   ├── auth_session.py  # bcrypt + 서명 쿠키
│   └── routers/         # users(/auth) · api · state · friends ...
├── portal/              # 포털 셸 + 주입 스크립트 (전부 정적)
│   ├── portal.js        # 게임에 주입 — 점수 캡처 + 상태 sync + PWA 등록
│   ├── account-widget.js · *.html · portal.css
│   └── icons/           # 포털 PWA 배지 아이콘
├── games/               # 게임 원본 스냅샷 (무수정)
└── restart.sh           # 배포
```

---

## Skill routing

작업이 skill과 맞으면 Skill 도구로 호출:
- 제품 아이디어/브레인스토밍 → office-hours
- 버그/에러/"왜 깨졌나" → investigate
- 배포/PR → ship
- QA/사이트 테스트 → qa
- 코드 리뷰 → review
