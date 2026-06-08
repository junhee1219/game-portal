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
  var ds = (script && script.dataset) || {};
  var game = ds.game || (location.pathname.split('/')[1] || 'portal');
  // 점수 config는 서버가 주입한 data-* 속성에서 동기 읽기 (fetch 금지 — setItem 후킹 race 방지)
  var scoreKey = ds.scoreKey || null;
  var scoreMetric = ds.scoreMetric || 'best';

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
    },
    // 후원 모달 열기 (게임/포털 어디서든 호출. 링크는 /api/support = 서버 .env)
    openSupport: function () { gpOpenSupport(); }
  };

  // ===== 후원(토스/카카오뱅크) — 포털 공용. 링크 없으면 아무것도 안 뜸 =====
  var gpSupportCache = null;
  function gpEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function gpFetchSupport() {
    if (gpSupportCache) return Promise.resolve(gpSupportCache);
    return fetch('/api/support').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) { gpSupportCache = d || {}; return gpSupportCache; })
      .catch(function () { return {}; });
  }
  function gpEnsureSupportStyle() {
    if (document.getElementById('gp-support-style')) return;
    var st = document.createElement('style');
    st.id = 'gp-support-style';
    st.textContent =
      '.gp-sup-ov{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:24px;' +
      'font-family:"Pretendard Variable",-apple-system,"Apple SD Gothic Neo",sans-serif;}' +
      '.gp-sup-card{background:#fff;color:#222;border-radius:24px;padding:26px 22px;max-width:320px;width:100%;' +
      'text-align:center;position:relative;box-shadow:0 20px 50px rgba(0,0,0,.3);}' +
      '.gp-sup-x{position:absolute;top:12px;right:14px;border:none;background:none;font-size:24px;line-height:1;' +
      'color:#aaa;cursor:pointer;}' +
      '.gp-sup-h{font-size:20px;font-weight:900;}' +
      '.gp-sup-desc{font-size:13px;color:#888;line-height:1.5;margin:8px 0 18px;}' +
      '.gp-sup-btn{display:block;width:100%;box-sizing:border-box;padding:14px;border-radius:14px;margin-top:10px;' +
      'font-size:15px;font-weight:800;text-decoration:none;}' +
      '.gp-sup-btn.toss{background:#2c66f6;color:#fff;}' +
      '.gp-sup-btn.kb{background:#fee500;color:#3c1e1e;}' +
      '.gp-sup-soon{font-size:14px;color:#888;padding:8px 0 4px;}';
    document.head.appendChild(st);
  }
  function gpOpenSupport() {
    gpFetchSupport().then(function (links) {
      gpEnsureSupportStyle();
      var rows = '';
      if (links.toss) rows += '<a class="gp-sup-btn toss" href="' + gpEsc(links.toss) + '" target="_blank" rel="noopener">토스로 후원</a>';
      if (links.kakaobank) rows += '<a class="gp-sup-btn kb" href="' + gpEsc(links.kakaobank) + '" target="_blank" rel="noopener">카카오뱅크로 후원</a>';
      if (!rows) rows = '<p class="gp-sup-soon">후원 링크 준비 중이에요. 곧 열릴게요!</p>';
      var ov = document.createElement('div');
      ov.className = 'gp-sup-ov';
      ov.innerHTML = '<div class="gp-sup-card"><button class="gp-sup-x" aria-label="닫기">&times;</button>' +
        '<div class="gp-sup-h">♡ 후원하기</div>' +
        '<p class="gp-sup-desc">광고 없이 즐기셨다면, 다음 게임 만들 힘이 됩니다.</p>' + rows + '</div>';
      document.body.appendChild(ov);
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      ov.querySelector('.gp-sup-x').addEventListener('click', close);
    });
  }
  // 노출 헬퍼: 링크가 있을 때만 콜백(true) — 게임이 후원 버튼 보일지 결정
  window.GamePortal.supportAvailable = function (cb) {
    gpFetchSupport().then(function (links) { cb(!!(links.toss || links.kakaobank)); });
  };

  // ===== 상태 동기화 manifest (서버 주입, 로그인 시에만 동작) =====
  var stateKeys = [];
  try { stateKeys = ds.stateKeys ? JSON.parse(ds.stateKeys) : []; } catch (e) {}
  var stateMani = {};            // key -> { merge, init_cache }
  stateKeys.forEach(function (sk) { stateMani[sk.key] = sk; });
  var loggedIn = false;          // /api/state 200이면 true
  window.__gpApplying = false;   // pull/merge가 쓰는 동안 후킹 side-effect 억제

  function numOf(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function objOf(v) { try { var o = JSON.parse(v); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }

  // 유저 첫 입력 시각 — init_cache 게임 reload는 입력 전(grace window)에만 (플레이 중 판 파괴 방지)
  function markInteracted() { window.__gpInteracted = true; }
  window.addEventListener('pointerdown', markInteracted, { once: true, capture: true });
  window.addEventListener('keydown', markInteracted, { once: true, capture: true });

  // ===== 자동 점수 캡처 + 상태 push 통합 후킹 (게임이 setItem 하는 순간 한 곳에서) =====
  var lastScore = 0;
  try { if (scoreKey) lastScore = numOf(localStorage.getItem(scoreKey)); } catch (e) {}

  if (scoreKey || stateKeys.length) {
    var origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      origSet.apply(this, arguments);
      if (window.__gpApplying) return;  // 우리가 pull로 쓴 값은 다시 보고/push 하지 않는다
      try {
        if (this !== window.localStorage) return;
        // 1) 신기록 자동 캡처 (leaderboard)
        if (scoreKey && k === scoreKey) {
          var n = parseInt(v, 10);
          if (!isNaN(n) && n > lastScore) {
            lastScore = n;
            window.GamePortal.reportScore(n, { metric: scoreMetric, auto: true });
          }
        }
        // 2) 상태 변경 push (로그인 시에만, debounce)
        if (loggedIn && stateMani[k]) queueStatePush(k);
      } catch (e) {}
    };
  }

  // ===== 상태 push (debounce 1.5s + pagehide flush, 오프라인 큐 없음 — max라 다음 pull로 복구) =====
  var pendingKeys = {};
  var pushTimer = null;
  function queueStatePush(k) {
    pendingKeys[k] = true;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flushState, 1500);
  }
  function collectLocal() {
    var changes = {};
    Object.keys(stateMani).forEach(function (k) {
      var raw = null;
      try { raw = localStorage.getItem(k); } catch (e) {}
      if (raw === null) return;
      var m = stateMani[k].merge;
      if (m === 'max') changes[k] = numOf(raw);
      else if (m === 'union' || m === 'union_min') changes[k] = objOf(raw);
      else changes[k] = raw;  // lww: raw 문자열 그대로
    });
    return changes;
  }
  function applyMerged(merged) {
    // 서버 권위값으로 로컬 보정 (후킹 억제 상태에서)
    window.__gpApplying = true;
    try {
      Object.keys(merged).forEach(function (k) {
        var sk = stateMani[k]; if (!sk) return;
        try {
          if (sk.merge === 'max') {
            if (numOf(merged[k]) > numOf(localStorage.getItem(k))) {
              localStorage.setItem(k, String(numOf(merged[k])));
              if (k === scoreKey) lastScore = numOf(merged[k]);
            }
          } else if (sk.merge === 'union' || sk.merge === 'union_min') {
            localStorage.setItem(k, JSON.stringify(merged[k]));
          }
        } catch (e) {}
      });
    } finally { window.__gpApplying = false; }
  }
  function pushChanges(changes) {
    if (!loggedIn || !Object.keys(changes).length) return;
    fetch('/api/state/' + game, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: changes }), keepalive: true
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.merged) applyMerged(d.merged); })
      .catch(function () {});
  }
  function flushState() {
    var all = collectLocal();
    var changes = {};
    Object.keys(pendingKeys).forEach(function (k) { if (k in all) changes[k] = all[k]; });
    pendingKeys = {};
    pushChanges(changes);
  }
  window.addEventListener('pagehide', function () {
    if (Object.keys(pendingKeys).length) flushState();
  });

  // ===== PULL on enter (세션당 1회) — 서버→로컬 merge + 양방향 reconcile push =====
  function syncPull() {
    var already = false;
    try { already = !!sessionStorage.getItem('gp_synced:' + game); } catch (e) {}
    if (already) { loggedIn = true; return; }  // 이미 동기화함 = 로그인 상태
    fetch('/api/state/' + game, { headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (r.status === 401) {  // 세션 만료 등 → sync OFF + stale 로그인 힌트 제거
          loggedIn = false;
          try { localStorage.removeItem('gp_auth'); } catch (e) {}
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d || !d.ok) return;
        loggedIn = true;
        var uid = d.user_id, state = d.state || {};
        // 계정 전환 가드: 이 디바이스의 {game} 로컬 상태가 다른 user 것이면 비운다 (도둑질 방지)
        var lastUid = null;
        try { lastUid = localStorage.getItem('gp_state_uid:' + game); } catch (e) {}
        window.__gpApplying = true;
        try {
          if (lastUid && lastUid !== uid) {
            Object.keys(stateMani).forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
          }
          try { localStorage.setItem('gp_state_uid:' + game, uid); } catch (e) {}
          // 서버→로컬 write-through merge
          var needReload = false;
          Object.keys(stateMani).forEach(function (k) {
            if (!(k in state)) return;
            var sk = stateMani[k], sv = state[k];
            try {
              if (sk.merge === 'max') {
                if (numOf(sv) > numOf(localStorage.getItem(k))) {
                  localStorage.setItem(k, String(numOf(sv)));
                  if (sk.init_cache) needReload = true;
                }
              } else if (sk.merge === 'union' || sk.merge === 'union_min') {
                localStorage.setItem(k, JSON.stringify(sv));
              } else {  // lww
                localStorage.setItem(k, typeof sv === 'string' ? sv : JSON.stringify(sv));
              }
            } catch (e) {}
          });
          if (scoreKey) { try { lastScore = numOf(localStorage.getItem(scoreKey)); } catch (e) {} }
        } finally { window.__gpApplying = false; }
        try { sessionStorage.setItem('gp_synced:' + game, '1'); } catch (e) {}
        // 양방향: 로컬 현재값 전체를 1회 push (reconcile + 초기 병합, merge가 멱등이라 안전)
        pushChanges(collectLocal());
        // init_cache 게임이 stale 변수를 들고 있으면 1회 reload — 단 유저 입력 전에만
        if (needReload && !window.__gpInteracted) {
          var reloaded = false;
          try { reloaded = !!sessionStorage.getItem('gp_reloaded:' + game); } catch (e) {}
          if (!reloaded) {
            try { sessionStorage.setItem('gp_reloaded:' + game, '1'); } catch (e) {}
            location.reload();
          }
        }
      })
      .catch(function () {});
  }

  // 로그인 힌트(gp_auth)가 있을 때만 sync 시도 — 익명 플레이어는 /api/state 안 쳐서 401 콘솔 노이즈 0.
  // (힌트는 보안 아님 — 서버가 쿠키로 진짜 검증. 힌트는 '이 기기에서 로그인한 적 있음'만 표시)
  var gpAuthed = false;
  try { gpAuthed = localStorage.getItem('gp_auth') === '1'; } catch (e) {}
  if (stateKeys.length && gpAuthed) syncPull();

  // ===== PWA 서비스 워커 등록 — 포털 페이지 + https에서만 =====
  // 게임 페이지엔 등록 안 함 (게임 자체 NOOP sw.js와 scope 충돌 회피).
  // http(IP:8080)에선 secure context가 아니라 등록 시도 자체를 안 함 (콘솔 에러 0).
  if (game === 'portal' && location.protocol === 'https:' &&
      navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
})();
