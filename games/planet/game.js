// 행성 키우기 — 방치형 성장 (캔버스 행성 + DOM 생성기 패널)
// 게임 계약: 단계 갱신 시 localStorage.setItem('planetBest', String(stage)) → 서빙 후킹이 리더보드 캡처.
//            음소거 키 planetMuted('1'/'0'). 진행 상태는 planetSave(JSON, 로컬). portal.js·후원은 서빙이 주입.
(function () {
  'use strict';
  var C = window.PlanetCore;
  var G = C.GENERATORS, N = G.length;

  // ===== 저장 =====
  var KEY = { best: 'planetBest', muted: 'planetMuted', save: 'planetSave' };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var state = { life: 0, total: 0, owned: [], stage: 0 };
  for (var i = 0; i < N; i++) state.owned.push(0);
  var bestStage = parseInt(lsGet(KEY.best) || '0', 10) || 0;
  var awayGain = 0, awaySec = 0;

  (function load() {
    var raw = lsGet(KEY.save);
    if (!raw) return;
    try {
      var s = JSON.parse(raw);
      state.life = Math.max(0, +s.life || 0);
      state.total = Math.max(state.life, +s.total || 0);
      if (Array.isArray(s.owned)) for (var i = 0; i < N; i++) state.owned[i] = Math.max(0, Math.floor(+s.owned[i] || 0));
      // 오프라인 진행 — 자리를 비운 사이의 생산
      var now = Date.now();
      var last = +s.lastSeen || now;
      var elapsed = Math.max(0, (now - last) / 1000);
      var per = C.prodPerSec(state.owned);
      if (per > 0 && elapsed > 8) {
        awayGain = C.offlineGain(per, elapsed, 28800);
        awaySec = Math.min(elapsed, 28800);
        state.life += awayGain; state.total += awayGain;
      }
    } catch (e) {}
    state.stage = C.stageForTotal(state.total);
  })();

  var lastSaveT = 0;
  function save() {
    lsSet(KEY.save, JSON.stringify({ life: state.life, total: state.total, owned: state.owned, lastSeen: Date.now() }));
  }
  function commitBest() {
    if (state.stage > bestStage) { bestStage = state.stage; lsSet(KEY.best, String(bestStage)); }
  }

  // ===== 오디오 (Web Audio 합성) =====
  var Audio = (function () {
    var actx = null, master, muted = lsGet(KEY.muted) === '1';
    function ensure() { if (actx) return; actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(actx.destination); }
    function init() { ensure(); if (actx.state !== 'running') actx.resume(); }
    function setMuted(m) { muted = m; lsSet(KEY.muted, m ? '1' : '0'); if (actx) master.gain.setTargetAtTime(m ? 0 : 1, actx.currentTime, .02); }
    function isMuted() { return muted; }
    function tone(f, t0, dur, type, peak) {
      if (!actx || muted) return;
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(.0001, t0); g.gain.linearRampToValueAtTime(peak || .2, t0 + .008);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + .02);
    }
    return {
      init: init, setMuted: setMuted, isMuted: isMuted,
      tap: function (n) { if (!actx) return; var t = actx.currentTime; var f = 440 * Math.pow(1.04, Math.min(n, 30)); tone(f, t, .08, 'sine', .12); tone(f * 1.5, t + .005, .05, 'sine', .05); },
      buy: function () { if (!actx) return; var t = actx.currentTime; tone(523, t, .1, 'triangle', .16); tone(784, t + .04, .12, 'triangle', .12); },
      evolve: function () { if (!actx) return; var t = actx.currentTime;[523, 659, 784, 1047].forEach(function (f, i) { tone(f, t + i * .09, .22, 'triangle', .16); }); },
      record: function () { if (!actx) return; var t = actx.currentTime;[784, 988, 1319, 1568].forEach(function (f, i) { tone(f, t + .05 + i * .08, .18, 'triangle', .14); }); }
    };
  })();
  var hadBest = bestStage; // 진화 시 신기록 사운드 판단용

  // ===== 캔버스 =====
  var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  var W = 0, H = 0, DPR = 1, panelH = 0, planetCX = 0, planetCY = 0, planetR = 0;
  function layout() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    panelH = Math.min(430, H * 0.46);
    var freeTop = (H - panelH);
    planetCX = W / 2;
    planetCY = freeTop * 0.54;
    planetR = Math.max(48, Math.min(W * 0.30, freeTop * 0.30));
  }
  window.addEventListener('resize', layout); layout();

  // ===== 별(배경) — 정적 위치 =====
  var stars = [];
  (function () { var seed = 1337; function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; } for (var i = 0; i < 90; i++) stars.push({ x: rnd(), y: rnd(), r: .5 + rnd() * 1.4, a: .25 + rnd() * .5, tw: rnd() * 6.28 }); })();

  // ===== 행성 표면 피처(구면 회전) — 결정적 배치 =====
  function mkFeatures(n, latSpan, seedBase) {
    var arr = [], seed = seedBase;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (var i = 0; i < n; i++) arr.push({ lat: (rnd() * 2 - 1) * latSpan, lon: rnd() * 6.28, sz: .5 + rnd() * .9 });
    return arr;
  }
  var FEAT = {
    ocean: mkFeatures(7, 0.7, 11), moss: mkFeatures(16, 0.85, 23), forest: mkFeatures(13, 0.8, 37),
    fire: mkFeatures(9, 0.6, 53), city: mkFeatures(20, 0.7, 71)
  };

  // 단계별 행성 본체 색 (단일 색조, 차분 — 네온/검보라 금지)
  var STAGE_COL = ['#b7a98f', '#8d8475', '#5b86b0', '#6f9e6a', '#4e8f5c', '#6a9d4f', '#7d8a5a', '#5e7088', '#6b6f9a', '#7a86c2', '#d8c98e', '#e8b46a'];
  function bodyColor(stage) { return STAGE_COL[Math.min(stage, STAGE_COL.length - 1)]; }
  function hx(c) { c = c.replace('#', ''); return [parseInt(c.substr(0, 2), 16), parseInt(c.substr(2, 2), 16), parseInt(c.substr(4, 2), 16)]; }
  function shade(c, f) { var r = hx(c); function k(v) { return Math.max(0, Math.min(255, Math.round(v))); } return 'rgb(' + k(r[0] + f) + ',' + k(r[1] + f) + ',' + k(r[2] + f) + ')'; }

  // ===== 파티클 / 플로팅 텍스트 =====
  var parts = [], floats = [], planetPulse = 0, ringFx = [];
  function burst(x, y, col, n) { for (var i = 0; i < (n || 8); i++) { var a = Math.random() * 6.28, s = 40 + Math.random() * 150; parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 2 + Math.random() * 3, col: col, life: 1 }); } }
  function ring(x, y, col) { ringFx.push({ x: x, y: y, r: planetR * 0.6, col: col, life: 1 }); }
  function floatTxt(x, y, txt, col, sz) { floats.push({ x: x, y: y, txt: txt, col: col || '#fff', sz: sz || 18, life: 1 }); }

  // ===== 톡(생명 추가) =====
  var tapCount = 0, started = false;
  function firstStart() { if (started) return; started = true; document.getElementById('hint').style.opacity = '0'; Audio.init(); }
  function doTap(cx, cy) {
    firstStart();
    var g = C.tapGain(C.prodPerSec(state.owned));
    state.life += g; state.total += g;
    tapCount++;
    planetPulse = 1;
    Audio.tap(tapCount % 30);
    floatTxt(cx, cy - planetR * 0.5, '+' + C.formatNum(g), '#dff0ff', 17);
    burst(cx, cy - planetR * 0.2, '#bfe0ff', 5);
    if (navigator.vibrate) try { navigator.vibrate(6); } catch (e) {}
    checkStage();
    refreshGens();
  }
  cv.addEventListener('pointerdown', function (e) {
    var x = e.clientX, y = e.clientY;
    if (y > H - panelH) return;                 // 패널 영역 제외
    var d = Math.hypot(x - planetCX, y - planetCY);
    if (d <= planetR * 1.35) { e.preventDefault(); doTap(x, y); }
    else { firstStart(); }                      // 첫 안내만 닫기
  }, { passive: false });

  // ===== 단계 진화 =====
  function checkStage() {
    var ns = C.stageForTotal(state.total);
    if (ns > state.stage) {
      state.stage = ns;
      commitBest();
      var info = C.stageInfo(ns);
      ring(planetCX, planetCY, '#ffe08a'); burst(planetCX, planetCY, '#ffe08a', 22);
      floatTxt(planetCX, planetCY - planetR - 8, info.name + '!', '#ffe08a', 22);
      var newRecord = ns > hadBest;
      if (newRecord) { hadBest = ns; Audio.record(); } else Audio.evolve();
      showEvolve(info, ns);
      document.getElementById('stage-name').textContent = info.name;
    }
  }

  // ===== 생성기 패널 (DOM) =====
  var GEN_COL = ['#7fd6c0', '#7bbf6a', '#c7a86a', '#5fa06a', '#d09a5a', '#d97a5a', '#8fb0e0', '#b89bff'];
  var gensEl = document.getElementById('gens');
  var rows = [];
  (function buildGens() {
    for (var i = 0; i < N; i++) {
      var g = G[i];
      var el = document.createElement('button');
      el.className = 'gen locked'; el.type = 'button'; el.setAttribute('data-i', i);
      var ic = document.createElement('canvas'); ic.width = 84; ic.height = 84;
      drawEmblem(ic.getContext('2d'), g.key, 84, GEN_COL[i]);
      var mid = document.createElement('div'); mid.className = 'mid';
      mid.innerHTML = '<div class="nm">' + g.name + ' <span class="own">0</span></div><div class="sub"></div>';
      var buy = document.createElement('div'); buy.className = 'buy';
      buy.innerHTML = '<div class="c">0</div><div class="lbl">생명</div>';
      el.appendChild(ic); el.appendChild(mid); el.appendChild(buy);
      el.addEventListener('click', (function (idx) { return function () { buyGen(idx); }; })(i));
      gensEl.appendChild(el);
      rows.push({ el: el, own: mid.querySelector('.own'), sub: mid.querySelector('.sub'), cost: buy.querySelector('.c') });
    }
  })();

  function unlocked(i) {
    if (i === 0) return true;
    if (state.owned[i] > 0) return true;
    if (state.owned[i - 1] > 0) return true;          // 이전 생성기를 사면 다음이 열림(단계적 공개)
    return state.life >= C.cost(G[i].base, 0) * 0.5;   // 거의 살 수 있으면 미리 보여 기대감
  }
  function buyGen(i) {
    if (!unlocked(i)) return;
    var c = C.cost(G[i].base, state.owned[i]);
    if (state.life < c) { rows[i].el.animate ? rows[i].el.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 160 }) : 0; return; }
    firstStart();
    state.life -= c; state.owned[i]++;
    Audio.buy();
    var r = cellOf(i);
    floatTxt(r.x, r.y, G[i].name + ' +1', '#9bf0b4', 16);
    refreshGens(); save();
  }
  function cellOf(i) { var b = rows[i].el.getBoundingClientRect(); return { x: b.left + 28, y: b.top + 18 }; }

  function refreshGens() {
    for (var i = 0; i < N; i++) {
      var r = rows[i], g = G[i], un = unlocked(i);
      r.el.style.display = un ? 'flex' : 'none';
      if (!un) continue;
      r.el.classList.remove('locked');
      var c = C.cost(g.base, state.owned[i]);
      var poor = state.life < c;
      r.el.classList.toggle('poor', poor);
      r.own.textContent = state.owned[i];
      r.sub.textContent = '초당 +' + C.formatNum(g.rate) + (state.owned[i] ? '  ·  합계 +' + C.formatNum(state.owned[i] * g.rate) : '');
      r.cost.textContent = C.formatNum(c);
      r.cost.classList.toggle('ok', !poor);
    }
  }

  // ===== HUD =====
  var lifeEl = document.getElementById('life'), rateEl = document.getElementById('rate'),
    stageNameEl = document.getElementById('stage-name'), progEl = document.querySelector('#prog i'),
    progLbl = document.getElementById('prog-lbl');
  function updateHud() {
    lifeEl.innerHTML = C.formatNum(state.life) + '<small>생명</small>';
    rateEl.textContent = '초당 ' + C.formatNum(C.prodPerSec(state.owned));
    var info = C.stageInfo(state.stage);
    stageNameEl.textContent = info.name;
    var p = C.stageProgress(state.total, state.stage);
    progEl.style.width = (p * 100).toFixed(1) + '%';
    var nxt = C.nextStageMin(state.stage);
    progLbl.textContent = '다음 단계까지 ' + C.formatNum(Math.max(0, nxt - state.total));
  }

  // ===== 루프 =====
  var last = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    var dt = last ? Math.min((t - last) / 1000, 0.25) : 0.016; last = t;
    var per = C.prodPerSec(state.owned);
    if (per > 0) { var add = per * dt; state.life += add; state.total += add; checkStage(); }
    if (planetPulse > 0) planetPulse = Math.max(0, planetPulse - dt * 3.2);
    ageFx(dt);
    updateHud();
    if (per > 0) refreshGensThrottle(dt);
    draw(t / 1000);
    lastSaveT += dt; if (lastSaveT > 4) { lastSaveT = 0; save(); }
  }
  var gensThrottle = 0;
  function refreshGensThrottle(dt) { gensThrottle += dt; if (gensThrottle > 0.3) { gensThrottle = 0; refreshGens(); } }

  function ageFx(dt) {
    for (var i = parts.length - 1; i >= 0; i--) { var p = parts[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.2, dt); p.vy *= Math.pow(0.2, dt); p.life -= dt * 1.5; if (p.life <= 0) parts.splice(i, 1); }
    for (var j = ringFx.length - 1; j >= 0; j--) { var rr = ringFx[j]; rr.r += dt * planetR * 2.2; rr.life -= dt * 1.6; if (rr.life <= 0) ringFx.splice(j, 1); }
    for (var k = floats.length - 1; k >= 0; k--) { var f = floats[k]; f.y -= dt * 34; f.life -= dt * 0.9; if (f.life <= 0) floats.splice(k, 1); }
  }

  // ===== 렌더 =====
  function draw(time) {
    // 배경(차분한 단일 색조 우주 + 별)
    var bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1b2236'); bg.addColorStop(1, '#101420');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < stars.length; i++) { var s = stars[i]; var a = s.a * (0.6 + 0.4 * Math.sin(time * 1.5 + s.tw)); ctx.globalAlpha = a; ctx.fillStyle = '#cdd8f2'; ctx.beginPath(); ctx.arc(s.x * W, s.y * (H - panelH) * 0.92, s.r, 0, 6.28); ctx.fill(); }
    ctx.globalAlpha = 1;

    drawPlanet(time);

    // 확산 링
    for (var r = 0; r < ringFx.length; r++) { var rf = ringFx[r]; ctx.globalAlpha = rf.life * 0.6; ctx.strokeStyle = rf.col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(rf.x, rf.y, rf.r, 0, 6.28); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // 파편
    for (var p = 0; p < parts.length; p++) { var pt = parts[p]; ctx.globalAlpha = Math.max(0, pt.life); ctx.fillStyle = pt.col; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 6.28); ctx.fill(); }
    ctx.globalAlpha = 1;
    // 플로팅 텍스트
    ctx.textAlign = 'center';
    for (var f = 0; f < floats.length; f++) { var fl = floats[f]; ctx.globalAlpha = Math.min(1, fl.life * 1.5); ctx.font = '900 ' + fl.sz + 'px "Pretendard Variable",sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.strokeText(fl.txt, fl.x, fl.y); ctx.fillStyle = fl.col; ctx.fillText(fl.txt, fl.x, fl.y); }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  function drawPlanet(time) {
    var cx = planetCX, cy = planetCY, R = planetR * (1 + planetPulse * 0.06), stage = state.stage, col = bodyColor(stage);
    var spin = time * 0.25;

    // 고단계 글로우
    if (stage >= 10) { var gl = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.9); gl.addColorStop(0, 'rgba(255,224,150,.35)'); gl.addColorStop(1, 'rgba(255,224,150,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, R * 1.9, 0, 6.28); ctx.fill(); }
    // 대기 림(바다 단계부터)
    if (stage >= 2) { ctx.strokeStyle = stage >= 10 ? 'rgba(255,236,180,.5)' : 'rgba(150,200,255,.4)'; ctx.lineWidth = Math.max(2, R * 0.06); ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, 6.28); ctx.stroke(); }

    // 위성 궤도(달) — 뒤쪽이면 행성보다 먼저
    var moonA = time * 0.6, moonZ = Math.cos(moonA), moonX = cx + Math.sin(moonA) * R * 1.7, moonY = cy - R * 0.5 + Math.cos(moonA) * R * 0.25, moonR = R * 0.16;
    function drawMoon() { ctx.save(); var mg = ctx.createRadialGradient(moonX - moonR * .3, moonY - moonR * .3, moonR * .2, moonX, moonY, moonR); mg.addColorStop(0, '#dfe4ee'); mg.addColorStop(1, '#9098a8'); ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(moonX, moonY, moonR, 0, 6.28); ctx.fill(); ctx.restore(); }
    if (stage >= 1 && moonZ < 0) drawMoon();

    // 토성형 고리(궤도 문명 단계부터) — 뒤쪽 반
    if (stage >= 9) drawRing(cx, cy, R, spin, true);

    // 본체 구
    var grad = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    grad.addColorStop(0, shade(col, 46)); grad.addColorStop(0.55, col); grad.addColorStop(1, shade(col, -42));
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.28); ctx.fill();

    // 표면 피처 — 구면 회전
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.28); ctx.clip();
    if (stage >= 2) drawFeatures(FEAT.ocean, cx, cy, R, spin, '#3f73b0', 0.18, 0.9);
    if (stage >= 3) drawFeatures(FEAT.moss, cx, cy, R, spin, '#86c46f', 0.10, 0.5);
    if (stage >= 4) drawFeatures(FEAT.forest, cx, cy, R, spin, '#2f6b3e', 0.13, 0.65);
    if (stage >= 6) drawFeatures(FEAT.fire, cx, cy, R, spin * 1.1, '#ffb15a', 0.05, 0.4, true);
    if (stage >= 7) drawFeatures(FEAT.city, cx, cy, R, spin, '#ffe9a8', 0.035, 0.32, true);
    // 명암(좌상 광원) — 우하단 그림자
    var term = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.2, cx + R * 0.25, cy + R * 0.3, R * 1.25);
    term.addColorStop(0, 'rgba(0,0,0,0)'); term.addColorStop(0.65, 'rgba(0,0,0,0)'); term.addColorStop(1, 'rgba(8,10,20,.6)');
    ctx.fillStyle = term; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    // 윗 림 하이라이트
    var rim = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.5, R * 0.05, cx - R * 0.4, cy - R * 0.5, R * 0.9);
    rim.addColorStop(0, 'rgba(255,255,255,.28)'); rim.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rim; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    if (stage >= 9) drawRing(cx, cy, R, spin, false); // 고리 앞쪽 반
    if (stage >= 1 && moonZ >= 0) drawMoon();
  }

  function drawFeatures(list, cx, cy, R, spin, color, sizeFrac, baseAlpha, additive) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i], latA = f.lat * (Math.PI / 2), lon = f.lon + spin;
      var depth = Math.cos(latA) * Math.cos(lon);
      if (depth <= 0.02) continue;                 // 뒷면
      var px = cx + R * Math.cos(latA) * Math.sin(lon);
      var py = cy + R * Math.sin(latA);
      var rr = R * sizeFrac * f.sz * (0.55 + 0.45 * depth);
      ctx.globalAlpha = baseAlpha * (0.5 + 0.5 * depth) * (additive ? 1 : 1);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px, py, Math.max(0.6, rr), 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawRing(cx, cy, R, spin, back) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.5);
    ctx.scale(1, 0.32);
    ctx.lineWidth = R * 0.13; ctx.strokeStyle = back ? 'rgba(180,170,210,.35)' : 'rgba(210,200,235,.65)';
    ctx.beginPath();
    if (back) ctx.arc(0, 0, R * 1.55, Math.PI, Math.PI * 2);
    else ctx.arc(0, 0, R * 1.55, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  // ===== 생성기 엠블럼 (절차적, 이모지 미사용) =====
  function drawEmblem(x, key, S, color) {
    var u = S / 84;
    function L(c, f) { var r = hx(c); function k(v) { return Math.max(0, Math.min(255, Math.round(v))); } return 'rgb(' + k(r[0] + f) + ',' + k(r[1] + f) + ',' + k(r[2] + f) + ')'; }
    var dark = L(color, -64), light = L(color, 55), mid = color;
    function disc(cx, cy, r, col) { x.fillStyle = col; x.beginPath(); x.arc(cx * u, cy * u, r * u, 0, 6.28); x.fill(); }
    function ell(cx, cy, rx, ry, col) { x.save(); x.translate(cx * u, cy * u); x.scale(rx, ry); x.fillStyle = col; x.beginPath(); x.arc(0, 0, u, 0, 6.28); x.fill(); x.restore(); }
    function line(x1, y1, x2, y2, w, col) { x.strokeStyle = col; x.lineWidth = w * u; x.lineCap = 'round'; x.beginPath(); x.moveTo(x1 * u, y1 * u); x.lineTo(x2 * u, y2 * u); x.stroke(); }
    function rrect(rx, ry, rw, rh, rad, col) { x.fillStyle = col; var r = rad * u; x.beginPath(); var X = rx * u, Y = ry * u, Wd = rw * u, Hd = rh * u; x.moveTo(X + r, Y); x.arcTo(X + Wd, Y, X + Wd, Y + Hd, r); x.arcTo(X + Wd, Y + Hd, X, Y + Hd, r); x.arcTo(X, Y + Hd, X, Y, r); x.arcTo(X, Y, X + Wd, Y, r); x.fill(); }
    function tri(x1, y1, x2, y2, x3, y3, col) { x.fillStyle = col; x.beginPath(); x.moveTo(x1 * u, y1 * u); x.lineTo(x2 * u, y2 * u); x.lineTo(x3 * u, y3 * u); x.closePath(); x.fill(); }
    x.clearRect(0, 0, S, S);

    if (key === 'microbe') {
      disc(42, 44, 22, mid); disc(36, 38, 5, light); disc(50, 46, 4, dark); disc(40, 52, 3.4, dark);
      for (var i = 0; i < 8; i++) { var a = i / 8 * 6.28; line(42 + Math.cos(a) * 22, 44 + Math.sin(a) * 22, 42 + Math.cos(a) * 28, 44 + Math.sin(a) * 28, 2.4, mid); }
    } else if (key === 'moss') {
      x.fillStyle = dark; x.beginPath(); x.arc(42 * u, 58 * u, 26 * u, Math.PI, 0); x.fill();
      disc(30, 50, 9, mid); disc(46, 46, 11, mid); disc(58, 52, 8, mid); disc(40, 44, 6, light); disc(52, 48, 5, light);
    } else if (key === 'bug') {
      ell(44, 46, 17, 22, mid); disc(44, 26, 9, dark);
      line(28, 40, 16, 34, 3, dark); line(28, 50, 14, 50, 3, dark); line(28, 60, 16, 66, 3, dark);
      line(60, 40, 72, 34, 3, dark); line(60, 50, 74, 50, 3, dark); line(60, 60, 72, 66, 3, dark);
      line(40, 20, 34, 10, 2.6, dark); line(48, 20, 54, 10, 2.6, dark); disc(40, 44, 4, light);
    } else if (key === 'tree') {
      rrect(38, 46, 8, 26, 2, L('#6b4a2a', 0)); disc(42, 36, 18, mid); disc(30, 42, 12, mid); disc(54, 42, 12, mid); disc(38, 30, 9, light);
    } else if (key === 'beast') {
      ell(44, 48, 20, 13, mid); disc(64, 40, 10, mid); // 몸 + 머리
      line(34, 58, 32, 70, 5, dark); line(44, 60, 44, 72, 5, dark); line(54, 60, 56, 72, 5, dark); line(60, 56, 64, 68, 5, dark);
      line(24, 48, 14, 42, 5, mid); line(70, 32, 76, 24, 3, dark); disc(67, 37, 2.4, '#1a1a22'); // 꼬리 머리뿔 눈
    } else if (key === 'tribe') {
      tri(42, 18, 22, 60, 62, 60, L(color, -10)); tri(42, 18, 36, 60, 48, 60, dark);
      disc(42, 66, 6, '#ffcaa0'); tri(42, 56, 37, 68, 47, 68, '#ff9d5a'); tri(42, 60, 39, 68, 45, 68, '#ffe08a');
    } else if (key === 'city') {
      rrect(22, 44, 12, 28, 2, dark); rrect(36, 32, 13, 40, 2, mid); rrect(51, 40, 12, 32, 2, L(color, -20)); rrect(63, 50, 10, 22, 2, mid);
      x.fillStyle = '#ffe9a8'; for (var bx = 0; bx < 4; bx++) for (var by = 0; by < 4; by++) { if ((bx + by) % 2) continue; x.fillRect((39 + bx * 3) * u, (36 + by * 6) * u, 2 * u, 3 * u); }
    } else if (key === 'orbit') {
      disc(42, 44, 15, mid); disc(36, 38, 5, light);
      x.save(); x.translate(42 * u, 44 * u); x.rotate(-0.5); x.scale(1, 0.34); x.strokeStyle = light; x.lineWidth = 4 * u; x.beginPath(); x.arc(0, 0, 26 * u, 0, 6.28); x.stroke(); x.restore();
      disc(64, 30, 3.4, '#fff');
    }
  }

  // ===== 팝업 =====
  function showEvolve(info, stage) {
    document.getElementById('ev-name').textContent = info.name;
    document.getElementById('ev-desc').textContent = info.desc;
    document.getElementById('ev-stage').textContent = stage;
    document.getElementById('evolve').classList.add('show');
  }
  document.getElementById('ev-go').addEventListener('click', function () { document.getElementById('evolve').classList.remove('show'); save(); });
  document.getElementById('ev-sup').addEventListener('click', function () { if (window.GamePortal) window.GamePortal.openSupport(); });
  document.getElementById('away-go').addEventListener('click', function () { document.getElementById('away').classList.remove('show'); });

  // ===== 음소거 =====
  var muteBtn = document.getElementById('mute'), muteUse = muteBtn.querySelector('use');
  function syncMute() { muteUse.setAttribute('href', Audio.isMuted() ? '#p-speaker-slash' : '#p-speaker-high'); }
  muteBtn.addEventListener('click', function () { Audio.setMuted(!Audio.isMuted()); syncMute(); }); syncMute();

  // ===== 저장 안전망 =====
  function flush() { save(); }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  // ===== 시작 =====
  if (awayGain > 0) {
    var mins = Math.round(awaySec / 60);
    document.getElementById('away-desc').textContent = (mins >= 60 ? Math.floor(mins / 60) + '시간 ' + (mins % 60) + '분' : mins + '분') + ' 동안 행성이 자랐어요';
    document.getElementById('away-gain').textContent = C.formatNum(awayGain);
    document.getElementById('away').classList.add('show');
  }
  state.stage = C.stageForTotal(state.total); commitBest();
  document.getElementById('stage-name').textContent = C.stageInfo(state.stage).name;
  refreshGens(); updateHud(); save();
  requestAnimationFrame(loop);
})();
