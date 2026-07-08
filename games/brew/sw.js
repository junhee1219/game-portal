// 약초 가마 — NOOP 서비스 워커.
// 서빙 레이어가 이 파일을 NOOP로 대체하므로(stale cache 방지) 여기서는 아무것도 캐시하지 않는다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
