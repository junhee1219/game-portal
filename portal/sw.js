// 포털 서비스 워커 — main.py가 {{GAME_RE}}에 게임 prefix를 주입해 서빙한다.
// ★원칙: 게임 경로(/{game}/*)는 SW가 절대 손대지 않는다 (stale-game 캐시 사고 재발 0).
//   게임은 오늘과 동일하게 순수 네트워크 + 서버 Cache-Control로만 동작.
//   포털 shell만 network-first (캐시는 오프라인 fallback 전용, correctness 영향 X).
const PORTAL_CACHE = 'portal-v1';
const SHELL = ['/', '/portal.css', '/rank', '/icons/portal-192.png'];
const GAME_RE = /^\/({{GAME_RE}})(\/|$)/;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(PORTAL_CACHE).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  // 포털 캐시 중 구버전만 정리 (게임 NOOP과 달리 origin 전역 삭제 금지)
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) {
        return k.indexOf('portal-') === 0 && k !== PORTAL_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 게임 경로 = passthrough (respondWith 호출 안 함 → 순수 네트워크, stale 게임 불가능)
  if (GAME_RE.test(url.pathname)) return;
  // API/auth = passthrough (오프라인 큐잉 안 함)
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/auth/') === 0) return;
  // 포털 shell만 network-first
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok) {
        var clone = res.clone();
        caches.open(PORTAL_CACHE).then(function (c) { c.put(e.request, clone); });
      }
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});
