// 포털 페이지 우상단 로그인 상태 위젯. #topbar 컨테이너에 렌더.
// 게임 페이지에는 주입하지 않는다 (플레이는 익명 OK — portal.js만 주입).
(function () {
  var box = document.getElementById('topbar');
  if (!box) return;

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
