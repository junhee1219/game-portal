// 벽돌 깨기 — NOOP 서비스 워커.
// 의도적으로 캐시/가로채기를 하지 않는다(서빙 레이어가 stale 캐시를 막는 원칙).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// fetch 핸들러 없음 = 모든 요청 패스스루(stale 0).
