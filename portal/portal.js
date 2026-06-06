// 게임 포털 계측 — 서빙 시점에 게임 HTML에 주입된다. 게임 원본은 이 파일을 모른다.
(function () {
  var KEY = 'gp_vid';
  var vid = null;
  try {
    vid = localStorage.getItem(KEY);
    if (!vid) {
      vid = (crypto.randomUUID && crypto.randomUUID()) ||
        String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(KEY, vid);
    }
  } catch (e) {
    vid = 'anon';
  }

  var script = document.currentScript;
  var game = (script && script.dataset && script.dataset.game) ||
    (location.pathname.split('/')[1] || 'portal');

  function send(payload, useBeacon) {
    payload.visitor_id = vid;
    payload.game = game;
    var body = JSON.stringify(payload);
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/ping', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true
    }).catch(function () {});
  }

  // 방문 1회
  send({ type: 'visit', path: location.pathname, referrer: document.referrer || null });

  // 세션 길이 (pagehide 시 beacon) — 리텐션/몰입도 핵심 지표
  var t0 = Date.now();
  var ended = false;
  function end() {
    if (ended) return;
    ended = true;
    send({ type: 'end', duration_ms: Date.now() - t0 }, true);
  }
  window.addEventListener('pagehide', end);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') end();
    else { ended = false; t0 = Date.now(); }
  });

  // 점수 브리지 — 게임 쪽에서 원하면 window.GamePortal.reportScore(점수)를 호출
  window.GamePortal = {
    visitorId: vid,
    game: game,
    reportScore: function (score, meta) {
      fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitor_id: vid, game: game,
          score: Math.floor(Number(score) || 0), meta: meta || null
        }),
        keepalive: true
      }).catch(function () {});
    }
  };

  // 자동 점수 캡처 — 게임이 localStorage에 쓰는 신기록을 가로채 보고한다.
  // 게임 원본 무수정 원칙: 키 이름만 알면 게임 코드는 그대로.
  var SCORE_KEYS = {
    gateway: { key: 'gatewayBest', metric: 'best' },
    cube: { key: 'cubeSnakeBest', metric: 'best' },
    vase: { key: 'vaseMaxClear', metric: 'level' }
  };
  var conf = SCORE_KEYS[game];
  if (conf) {
    var last = 0;
    try { last = parseInt(localStorage.getItem(conf.key) || '0', 10) || 0; } catch (e) {}
    var origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      origSet.apply(this, arguments);
      try {
        if (this === window.localStorage && k === conf.key) {
          var n = parseInt(v, 10);
          if (!isNaN(n) && n > last) {
            last = n;
            window.GamePortal.reportScore(n, { metric: conf.metric, auto: true });
          }
        }
      } catch (e) {}
    };
  }
})();
