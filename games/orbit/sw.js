// ORBIT 서비스 워커 — 서빙 레이어가 NOOP로 대체하지만 로컬/오프라인용 최소 골격.
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => self.clients.claim());
