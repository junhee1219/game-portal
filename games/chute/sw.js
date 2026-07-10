// 조르르 서비스 워커 — 게임 업데이트 배포 시 CACHE 버전을 올릴 것.
// (참고: 포털 서빙 레이어가 게임 sw.js를 NOOP로 대체하므로 실제 운영에선 이 파일이 안 뜬다. 로컬/직접 접근 대비.)
const CACHE = 'chute-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)); return res; })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)); return res;
    })),
  );
});
