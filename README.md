# game-portal

웹 미니게임 포털. 설치 없이 브라우저에서 바로 플레이.

| 경로 | 게임 | 설명 |
|---|---|---|
| `/vase/` | 물병 정렬 | 같은 색 물 모으기 퍼즐 |
| `/gateway/` | 라면집 사장님 | 원터치 줄 관리 아케이드 |
| `/cube/` | Cube Snake | 3D 큐브 표면 스네이크 |

## 구조

```
app/                  # FastAPI — 포털 페이지 + 게임 서빙 + 계측 API
├── main.py           # 게임 HTML 서빙 시 계측 스크립트 주입 (게임 원본 무수정)
├── models.py         # visitors / events / scores
└── routers/api.py    # /api/ping /api/score /api/leaderboard /api/stats
games/                # 게임 원본 스냅샷 — 직접 수정하지 않는다
portal/               # 메인 목록 페이지 + 주입용 portal.js
```

## 원칙

- **games/ 아래는 수정 금지.** 원본 게임 저장소(~/game)의 스냅샷. 계측이 필요하면
  서빙 레이어(main.py의 HTML 주입)에서 해결한다.
- 게임 원본이 업데이트되면 해당 게임 폴더를 통째로 교체한다.
- DB가 죽어도 게임 플레이는 동작해야 한다. 계측 API는 실패 시 조용히 무시.

## 로컬 실행

```bash
python3 -m venv venv && venv/bin/pip install -r requirements.txt
cp .env.example .env   # DATABASE_URL 채우기 (비우면 계측 없이 동작)
venv/bin/uvicorn app.main:app --reload --port 8080
```

## 배포 (오라클 서버)

```bash
ssh oracle-server
cd ~/game-portal && ./restart.sh
```

- systemd 서비스: `game-portal` (uvicorn, 127.0.0.1:8080)
- 도메인 연결: DNS A 레코드 → nginx server block(`proxy_pass http://127.0.0.1:8080`) → certbot

## 계측

게임 HTML 응답에 `portal.js`가 주입되어:
- 방문(visit) / 세션 길이(end, pagehide beacon) 자동 기록 → D1/D7 리텐션 산출 가능
- `window.GamePortal.reportScore(score)` 호출 시 점수 기록 (게임별 연동은 선택)

지표 확인: `GET /api/stats`
