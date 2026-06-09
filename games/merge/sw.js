// 서빙 레이어가 어차피 NOOP로 대체하지만, 직접 서빙/오프라인 대비 최소 SW.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
