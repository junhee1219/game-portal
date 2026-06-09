# 계정·친구·신규게임 설계 (2026-06-09)

3개 독립 트랙. 친구 인프라(follow/리더보드/전역랭킹/닉중복체크)는 이미 구현돼 있고, 아래는 **net-new** 부분만.

승인된 결정:
- 새 게임 = **드롭 머지(물리)**, 자유롭게 2~3종 실험(별로면 삭제). matter.js·테마는 구현 재량.
- 공개 = **기본 ON, 끄면 전체 랭킹에서만 숨김**(친구는 계속 노출).
- 친구 = **상호 수락(친구 요청)** — 기존 즉시 follow를 요청→수락으로 변경.

---

## A. 카카오 닉네임 온보딩

**문제:** `auth.py:_upsert_kakao_user`가 카카오 닉을 자동으로 박음 → 닉네임이 곧 로그인ID(유니크)인데 사용자가 못 고름.

**변경:**
- 신규 카카오 유저: 임시 닉(`임시{uuid8}`)으로 생성 + `users.nickname_set=0`.
- `kakao_callback`: `nickname_set=0`이면 `/rank` 대신 **`/onboard`**로 redirect.
- `/onboard`(portal/onboard.html): `GET /auth/check-nickname`(기존) 재사용 실시간 중복체크 + **`POST /auth/set-nickname`**(신규) → 유니크 충돌 시 재시도하며 닉 확정 + `nickname_set=1` → `/rank`.
- 미설정 상태 유저가 다른 페이지 진입 시 온보딩으로 유도(portal.js 또는 account-widget에서 `me` 응답에 `nickname_set` 포함해 판정).
- 중도 이탈: 계정+임시닉만 존재, 다음 로그인에 온보딩 재개.
- 기존 자동닉 유저는 범위 밖(유지). 닉 변경권 추후.

**DDL(배포 전, 운영+개발):** `ALTER TABLE users ADD COLUMN nickname_set TINYINT(1) NOT NULL DEFAULT 1;`
(기존 유저 default 1 = 온보딩 안 거침. 신규 카카오만 코드에서 0으로 생성.)

**엔드포인트:** `POST /auth/set-nickname {nickname}` — 세션 user 필요, `_valid_nickname` 재사용, 충돌 retry, `nickname_set=1`. `GET /auth/me`에 `nickname_set` 추가.

---

## B. 기록 공개 on/off

**추가:** `users.public TINYINT(1) NOT NULL DEFAULT 1`.

**전역 리더보드(`api.py:/leaderboard`):** 외부 select에 `WHERE (User.id IS NULL OR User.public = 1)` 추가 — user 소유 기록은 public만, 익명(visitor-only)은 그대로. 집계(best subquery)는 그대로 두고 join 후 필터(숨긴 user가 슬롯 차지 안 하게 limit 전 필터).

**친구 리더보드(`friends.py`):** public 무시(친구는 항상 노출) — 변경 없음.

**계정 UI:** `/account`에 공개 토글 스위치 + **`POST /api/visibility {public:bool}`**(세션 user). `GET /auth/me`에 `public` 추가.

**DDL(배포 전):** `ALTER TABLE users ADD COLUMN public TINYINT(1) NOT NULL DEFAULT 1;`

---

## C. 친구 요청(상호 수락)

**모델:** `friendships`에 `status VARCHAR(12)`('pending'|'accepted'). (follower=요청자, followee=대상.) **내 친구 = 양방향 accepted**(내가 follower거나 followee인 accepted 행).

**그랜드파더링:** 기존 행은 `DEFAULT 'accepted'`로 친구 유지.

**엔드포인트(friends.py 개편):**
- `POST /api/friend-request {target}` — 기존 `/follow` 대체. pending 생성(이미 accepted면 already, 역방향 pending 있으면 즉시 accepted로 매칭).
- `POST /api/friend-request/accept {requester}` — pending→accepted.
- `DELETE /api/friend {other}` — 거절/친구삭제(양방향 행 제거).
- `GET /api/friend-requests` — 받은 pending 목록(닉네임).
- `GET /api/friends` — accepted 양방향.

**친구 리더보드 `_followee_ids` → `_friend_ids`:** accepted 양방향 + 본인.

**발견 경로:** 공유링크 유지(`/s/{score}`→`/follow/{user}` 페이지). 클릭 시 즉시 follow 대신 **요청 전송**. 상대는 기록실/계정 **요청함**에서 수락.

**UI:** 기록실(rank.html) 또는 계정에 받은 요청함(수락/거절) + 친구 페이지의 follow 버튼을 "친구 요청"으로.

**DDL(배포 전):** `ALTER TABLE friendships ADD COLUMN status VARCHAR(12) NOT NULL DEFAULT 'accepted' COLLATE utf8mb4_unicode_ci;`

---

## D. 새 게임 — 드롭 머지(물리) ×2~3

- `games/{id}/` 폴더 + `games.json` 엔트리(score_key/state_keys 선언만). 코드 무수정 원칙.
- **물리:** matter.js 단일 파일 복사(MIT, build/npm 아님) — 손맛(쌓임/바운스/안정화).
- 게임 공통 의무: 톤 일관(파스텔+아이콘 2층), 후원/계정/동기화는 portal.js 자동 주입(게임 원본 무수정), game-icons 쓰면 푸터 크레딧.
- 점수 = 최고점, `state_keys` 동기화. sw.js는 서빙에서 NOOP 대체.
- pang(과일)과 겹치지 않게 동물/구슬/행성 등 리테마. 2~3 변형 자유 실험.

**실행:** D는 worktree 병렬 에이전트로, A·B·C는 메인에서. DDL은 코드 배포 전에 운영+개발 DB에 먼저.
