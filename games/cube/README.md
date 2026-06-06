# 🐍 Cube Snake

3D 큐브 표면을 기어다니는 귀여운 스네이크 게임. 모서리를 넘으면 세상이 돌아간다!

**플레이:** https://junhee1219.github.io/cube-game/

## 특징

- 큐브 6면을 기어다니는 표면 토폴로지 스네이크 — 모서리를 넘으면 카메라가 따라 돈다
- 과일 누적에 따라 진화하는 배경 (풀밭 → 하늘 → 밤하늘 → 디스코 → 전설 모드)
- 콤보·황금 과일·무지개 뱀 스킨 등 점수 구간별 연출
- 효과음 전부 Web Audio 실시간 합성 (외부 에셋 0개)
- PWA — 홈 화면에 설치하면 오프라인에서도 플레이 가능
- UI는 game-kit 공용 컴포넌트 (Phosphor / game-icons 2층 아이콘)

## 크레딧

Icons: [game-icons.net](https://game-icons.net) (CC BY 3.0, by Lorc·Delapouite) · [Phosphor Icons](https://phosphoricons.com) (MIT)

## 개발

```bash
node test.js                  # 토폴로지 엔진 테스트
python3 -m http.server 8123   # 로컬 실행 → http://localhost:8123
```

## 구조

```
index.html   마크업 + 스타일 + 인라인 엔진/게임 스크립트
engine.js    표면 토폴로지 엔진 (node 테스트 공용, index.html 인라인과 동기화)
test.js      엔진 불변식 테스트 (node test.js)
kit.css      game-kit 공용 컴포넌트 (복사본)
sprite.svg   아이콘 심볼 시트 (game-kit sprite 서브셋)
sw.js        서비스 워커 (배포 시 CACHE 버전 올릴 것)
```
