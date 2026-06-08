// 포털 페이지 우상단 로그인 상태 위젯 + PWA 설치 유도. #topbar 컨테이너에 렌더.
// 게임 페이지에는 주입하지 않는다 (플레이는 익명 OK — portal.js만 주입).
(function () {
  var box = document.getElementById('topbar');
  if (!box) return;

  // ===== PWA 설치 유도 (high-intent 페이지에서만, mid-game 금지) =====
  // /rank(기록 본 직후 = 재방문 의도)에서만 설치 버튼 노출.
  var onRank = location.pathname === '/rank';
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (onRank) showInstallButton();
  });
  function showInstallButton() {
    if (document.getElementById('gp-install-btn') || !deferredPrompt) return;
    var btn = document.createElement('button');
    btn.id = 'gp-install-btn';
    btn.type = 'button';
    btn.textContent = '앱 설치';
    btn.style.cssText = 'background:var(--accent);color:#14110a;border:none;padding:4px 12px;' +
      'border-radius:8px;font:inherit;font-weight:700;font-size:12px;cursor:pointer;text-decoration:none';
    btn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt = null;
      btn.remove();
    });
    box.insertBefore(btn, box.firstChild);
  }
  // iOS Safari는 beforeinstallprompt 없음 → 수동 안내 (홈 화면에 추가)
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
  var isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  if (onRank && isIOS && !isStandalone) {
    var hint = document.createElement('span');
    hint.className = 'who';
    hint.style.fontSize = '12px';
    hint.textContent = '공유 → 홈 화면에 추가로 앱처럼';
    box.insertBefore(hint, box.firstChild);
  }

  fetch('/auth/me', { headers: { 'Accept': 'application/json' } })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.user) {
        var span = document.createElement('span');
        span.className = 'who';
        span.innerHTML = '<b></b>님';
        span.querySelector('b').textContent = d.user.nickname;  // XSS 방지 textContent
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '로그아웃';
        btn.addEventListener('click', function () {
          // 로그인 힌트 제거 + 다음 게임 진입 재동기화 + 계정 전환 가드용 sync 플래그 초기화
          try {
            localStorage.removeItem('gp_auth');
            Object.keys(sessionStorage).forEach(function (k) {
              if (k.indexOf('gp_synced:') === 0) sessionStorage.removeItem(k);
            });
          } catch (e) {}
          fetch('/auth/logout', { method: 'POST' })
            .then(function () { location.reload(); })
            .catch(function () { location.reload(); });
        });
        box.appendChild(span);
        box.appendChild(btn);
      } else {
        var a = document.createElement('a');
        a.href = '/account';
        a.textContent = '로그인 / 가입';
        box.appendChild(a);
      }
    })
    .catch(function () {});
})();
