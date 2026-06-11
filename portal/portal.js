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
      // 비회원 점수는 저장하지 않는다 — 기록실은 회원 전용. 로그인(gp_auth) 상태에서만 전송.
      // (가입 직후 직전 점수는 로그인 감지 시 localStorage 최고점을 1회 claim POST해서 귀속)
      var authed = false; try { authed = localStorage.getItem('gp_auth') === '1'; } catch (e) {}
      if (!authed) return;
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
    // 후원+의견 모달 열기 (게임/포털 어디서든 호출. 링크는 /api/support = 서버 .env)
    openSupport: function () { gpOpenSupport(false); },
    // 의견 남기기로 바로 (textarea 펼친 채로) 열기
    openFeedback: function () { gpOpenSupport(true); }
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
      '.gp-sup-soon{font-size:14px;color:#888;padding:8px 0 4px;}' +
      '.gp-sup-div{height:1px;background:#eee;margin:18px 0 14px;}' +
      '.gp-fb-h{font-size:14px;font-weight:800;color:#333;margin-bottom:4px;text-align:left;}' +
      '.gp-fb-sub{font-size:11px;color:#999;margin-bottom:8px;text-align:left;}' +
      '.gp-fb-ta{width:100%;box-sizing:border-box;min-height:74px;resize:vertical;border:1px solid #e2e2e2;' +
      'border-radius:12px;padding:11px;font:inherit;font-size:14px;color:#222;outline:none;}' +
      '.gp-fb-ta:focus{border-color:#9aa6ff;}' +
      '.gp-fb-send{width:100%;box-sizing:border-box;margin-top:8px;padding:12px;border:none;border-radius:12px;' +
      'background:#5b6cff;color:#fff;font:inherit;font-size:14px;font-weight:800;cursor:pointer;}' +
      '.gp-fb-send:disabled{opacity:.5;cursor:default;}' +
      '.gp-fb-done{font-size:14px;color:#3aa76d;font-weight:700;padding:10px 0 2px;}' +
      '.gp-join{display:block;width:100%;box-sizing:border-box;padding:14px;border-radius:14px;' +
      'background:linear-gradient(180deg,#ff9a6b,#ff7a4d);color:#fff;font-size:15px;font-weight:800;' +
      'text-decoration:none;text-align:center;box-shadow:0 4px 12px rgba(255,110,70,.35);}' +
      '.gp-join-sub{font-size:12px;color:#999;margin:8px 2px 0;line-height:1.5;}';
    document.head.appendChild(st);
  }
  function gpOpenSupport(focusFeedback) {
    gpFetchSupport().then(function (links) {
      gpEnsureSupportStyle();
      var isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
      var rows = '';
      // 토스는 앱 스킴(supertoss://)이라 새 탭 X. http면 일반 링크.
      if (links.toss) {
        var tossApp = !/^https?:/i.test(links.toss);
        rows += '<a class="gp-sup-btn toss" data-app="' + (tossApp ? '1' : '0') + '" href="' + gpEsc(links.toss) + '"' +
          (tossApp ? '' : ' target="_blank" rel="noopener"') + '>토스로 간식 사주기</a>';
      }
      if (links.kakaobank) rows += '<a class="gp-sup-btn kb" href="' + gpEsc(links.kakaobank) + '" target="_blank" rel="noopener">카카오페이로 간식 사주기</a>';
      if (!rows) rows = '<p class="gp-sup-soon">후원 링크 준비 중이에요. 곧 열릴게요!</p>';
      // 비회원이면 게임오버 모달 맨 위에 가입 CTA — 가입하고 게임으로 돌아오면 방금 점수가 귀속된다.
      var authed = false; try { authed = localStorage.getItem('gp_auth') === '1'; } catch (e) {}
      var joinHtml = '';
      if (!authed) {
        var nextp = location.pathname + location.search;
        joinHtml = '<div class="gp-sup-h">기록을 남겨보세요</div>' +
          '<a class="gp-join" href="/account?next=' + gpEsc(encodeURIComponent(nextp)) + '">가입하고 이 점수 남기기 &rsaquo;</a>' +
          '<p class="gp-join-sub">가입하면 이 점수가 기록실에 올라가고 친구와 겨룰 수 있어요. (비회원 기록은 저장되지 않아요)</p>' +
          '<div class="gp-sup-div"></div>';
      }
      var ov = document.createElement('div');
      ov.className = 'gp-sup-ov';
      ov.innerHTML = '<div class="gp-sup-card"><button class="gp-sup-x" aria-label="닫기">&times;</button>' +
        joinHtml +
        '<div class="gp-sup-h">♡ 개발자에게 간식 사주기</div>' +
        '<p class="gp-sup-desc">재밌게 즐기셨다면, 다음 게임 만들 힘이 됩니다.</p>' + rows +
        '<div class="gp-sup-div"></div>' +
        '<div class="gp-fb-h">의견 남기기</div>' +
        '<div class="gp-fb-sub">버그 · 아이디어 · 불만 뭐든 환영! 바로 전달돼요.</div>' +
        '<textarea class="gp-fb-ta" maxlength="2000" placeholder="여기에 적어주세요"></textarea>' +
        '<button class="gp-fb-send" type="button">보내기</button>' +
        '</div>';
      document.body.appendChild(ov);
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      ov.querySelector('.gp-sup-x').addEventListener('click', close);
      // PC에서 토스 앱 스킴 클릭 → 폰 안내 (앱 스킴은 폰에서만 열림)
      var tossBtn = ov.querySelector('.gp-sup-btn.toss[data-app="1"]');
      if (tossBtn && !isMobile) {
        tossBtn.addEventListener('click', function (e) {
          e.preventDefault();
          ov.querySelector('.gp-sup-desc').textContent = '토스 송금은 폰에서 열려요. 폰으로 접속해 눌러주세요!';
          tossBtn.style.opacity = '.5';
        });
      }
      // 의견 남기기 → /api/feedback 즉시 저장
      var ta = ov.querySelector('.gp-fb-ta');
      var send = ov.querySelector('.gp-fb-send');
      send.addEventListener('click', function () {
        var txt = (ta.value || '').trim();
        if (!txt) { ta.focus(); return; }
        send.disabled = true; send.textContent = '보내는 중…';
        fetch('/api/feedback', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: txt, page: game, visitor_id: vid })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.ok) {
            ta.style.display = 'none'; send.style.display = 'none';
            ov.querySelector('.gp-fb-sub').style.display = 'none';
            var done = document.createElement('div');
            done.className = 'gp-fb-done';
            done.textContent = '고맙습니다! 잘 받았어요 :)';
            ov.querySelector('.gp-fb-h').textContent = '의견 보냄';
            ov.querySelector('.gp-fb-h').after(done);
          } else {
            send.disabled = false; send.textContent = '다시 보내기';
          }
        }).catch(function () { send.disabled = false; send.textContent = '다시 보내기'; });
      });
      if (focusFeedback) { try { ta.focus(); ta.scrollIntoView({ block: 'center' }); } catch (e) {} }
    });
  }
  // 노출 헬퍼: 링크가 있을 때만 콜백(true) — 게임이 후원 버튼 보일지 결정
  window.GamePortal.supportAvailable = function (cb) {
    gpFetchSupport().then(function (links) { cb(!!(links.toss || links.kakaobank)); });
  };

  // ===== 게임 내 포털 런처 (메인으로 + 공유) — 게임 페이지에만 주입 =====
  // 게임 원본엔 메인 복귀/공유 동선이 없다(원본 무수정). 포털이 일괄 주입해
  // 모든 게임에 '메인으로(이탈 확인)'와 '기록 공유'를 자동 제공한다.
  // 아이콘은 이모지 금지 — Phosphor fill 글리프를 인라인(viewBox 0 0 256 256).
  var GP_ICON_HOME = '<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M218.83,103.77l-80-75.48a1.14,1.14,0,0,1-.11-.11,16,16,0,0,0-21.53,0l-.11.11L37.17,103.77A16,16,0,0,0,32,115.55V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V160h32v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V115.55A16,16,0,0,0,218.83,103.77Z"/></svg>';
  var GP_ICON_SHARE = '<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M176,160a39.89,39.89,0,0,0-28.62,12.09l-46.1-29.63a39.8,39.8,0,0,0,0-28.92l46.1-29.63a40,40,0,1,0-8.66-13.45l-46.1,29.63a40,40,0,1,0,0,55.82l46.1,29.63A40,40,0,1,0,176,160Z"/></svg>';

  function gpEnsureLauncherStyle() {
    if (document.getElementById('gp-launcher-style')) return;
    var st = document.createElement('style');
    st.id = 'gp-launcher-style';
    st.textContent =
      '#gp-launcher{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);' +
      'left:calc(env(safe-area-inset-left,0px) + 8px);z-index:9000;display:flex;gap:6px;' +
      'opacity:.55;transition:opacity .2s ease;}' +
      '#gp-launcher:hover,#gp-launcher:active{opacity:1;}' +
      '.gp-lb{width:38px;height:38px;padding:0;border-radius:11px;border:1px solid rgba(255,255,255,.22);' +
      'background:rgba(20,20,26,.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);' +
      'color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.25);}' +
      '.gp-lb:active{transform:scale(.93);}' +
      '.gp-lb svg{width:20px;height:20px;display:block;}' +
      '.gp-cf-ov{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:24px;' +
      'font-family:"Pretendard Variable",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;}' +
      '.gp-cf-card{background:#18181f;color:#f2f2f0;border:1px solid #26262f;border-radius:20px;' +
      'padding:24px 22px;max-width:300px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.4);}' +
      '.gp-cf-h{font-size:18px;font-weight:800;}' +
      '.gp-cf-desc{font-size:13px;color:#8e8e98;line-height:1.5;margin:8px 0 20px;}' +
      '.gp-cf-go{display:block;width:100%;box-sizing:border-box;padding:14px;border-radius:13px;border:none;' +
      'background:#ffb13d;color:#14110a;font:inherit;font-size:15px;font-weight:800;cursor:pointer;}' +
      '.gp-cf-stay{display:block;width:100%;box-sizing:border-box;padding:13px;border-radius:13px;margin-top:8px;' +
      'border:1px solid #26262f;background:transparent;color:#8e8e98;font:inherit;font-size:15px;font-weight:700;cursor:pointer;}' +
      '.gp-cf-go:active,.gp-cf-stay:active{transform:scale(.98);}' +
      '.gp-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 28px);transform:translate(-50%,12px);' +
      'z-index:10000;max-width:80vw;padding:11px 18px;border-radius:12px;background:rgba(20,20,26,.92);color:#f2f2f0;' +
      'font-family:"Pretendard Variable",-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;font-size:13px;' +
      'font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.4);opacity:0;transition:opacity .25s ease,transform .25s ease;pointer-events:none;}' +
      '.gp-toast.show{opacity:1;transform:translate(-50%,0);}';
    document.head.appendChild(st);
  }

  function gpToast(msg) {
    gpEnsureLauncherStyle();
    var t = document.createElement('div');
    t.className = 'gp-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 2600);
  }

  function gpConfirmHome() {
    if (document.getElementById('gp-confirm-ov')) return;
    gpEnsureLauncherStyle();
    var ov = document.createElement('div');
    ov.id = 'gp-confirm-ov';
    ov.className = 'gp-cf-ov';
    ov.innerHTML = '<div class="gp-cf-card">' +
      '<div class="gp-cf-h">메인 화면으로 나갈까요?</div>' +
      '<p class="gp-cf-desc">지금 게임의 진행 상황은 저장되지 않을 수 있어요.</p>' +
      '<button class="gp-cf-go" type="button">나가기</button>' +
      '<button class="gp-cf-stay" type="button">계속하기</button></div>';
    document.body.appendChild(ov);
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.gp-cf-stay').addEventListener('click', close);
    ov.querySelector('.gp-cf-go').addEventListener('click', function () { location.href = '/'; });
  }

  function gpShareRecord() {
    var best = 0;
    try { if (scoreKey) best = numOf(localStorage.getItem(scoreKey)); } catch (e) {}
    if (!scoreKey || best <= 0) {
      gpToast('아직 기록이 없어요. 한 판 하고 다시 눌러주세요!');
      return;
    }
    var authed = false; try { authed = localStorage.getItem('gp_auth') === '1'; } catch (e) {}
    if (!authed) { gpOpenSupport(false); return; }  // 비회원은 저장 안 돼 링크 못 만듦 → 가입 동선
    fetch('/api/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: vid, game: game, score: best, meta: { from: 'game-share' } })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.share_url) { gpToast('공유 링크를 만들지 못했어요.'); return; }
      var url = location.origin + d.share_url;
      if (navigator.share) { navigator.share({ url: url }).catch(function () {}); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { gpToast('공유 링크를 복사했어요!'); })
          .catch(function () { location.href = url; });
        return;
      }
      location.href = url;
    }).catch(function () { gpToast('네트워크 오류예요.'); });
  }

  if (game !== 'portal' && document.body && !document.getElementById('gp-launcher')) {
    gpEnsureLauncherStyle();
    var gpLauncher = document.createElement('div');
    gpLauncher.id = 'gp-launcher';
    gpLauncher.innerHTML =
      '<button class="gp-lb" type="button" data-act="home" aria-label="메인으로">' + GP_ICON_HOME + '</button>' +
      '<button class="gp-lb" type="button" data-act="share" aria-label="기록 공유">' + GP_ICON_SHARE + '</button>';
    document.body.appendChild(gpLauncher);
    gpLauncher.querySelector('[data-act="home"]').addEventListener('click', gpConfirmHome);
    gpLauncher.querySelector('[data-act="share"]').addEventListener('click', gpShareRecord);
  }

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
        // 가입/로그인 직후: 직전(비회원) 플레이의 localStorage 최고점을 회원 기록으로 1회 귀속.
        // (비회원 땐 /api/score 저장을 안 하므로, 여기서 claim해야 방금 게임 점수가 기록실에 올라간다)
        if (scoreKey) {
          var localBest = numOf(localStorage.getItem(scoreKey));
          if (localBest > 0) window.GamePortal.reportScore(localBest, { metric: scoreMetric, claim: true });
        }
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
