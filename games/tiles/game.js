// 리듬 타일 — 내려오는 타일을 아래에서부터 순서대로 톡. 탭마다 펜타토닉 음.
// 게임 계약: 신기록 시 localStorage.setItem('tilesBest', String(score)) (서빙 후킹이 캡처)
//            음소거 키 tilesMuted ('1'/'0'). portal.js·후원 모달은 서빙이 주입.
(() => {
  'use strict';
  const Core = (typeof TilesCore !== 'undefined') ? TilesCore : null;
  const LANES = 4;
  const AHEAD = 10;            // pending 위로 미리 생성할 행 수
  const PAD = 4;
  // 펜타토닉(메이저) 한 옥타브 — 탭할수록 위로 올라갔다 되돌아오는 멜로디
  const SCALE = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];
  // 타일 색 — 차분한 파스텔 5색 순환(음과 색을 연결)
  const HUES = [158, 192, 262, 28, 130];

  // ── DOM ──
  const wrap = document.getElementById('wrap');
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overEl = document.getElementById('over');
  const hintEl = document.getElementById('hint');

  // ── 상태 ──
  let W = 320, H = 480, dpr = 1, RH = 96, laneW = 80;
  let rows = [];              // {lane, hit, hitAt}
  let scroll = 0;
  let pending = 0;
  let running = false;
  let over = false;
  let score = 0;
  let best = +(localStorage.getItem('tilesBest') || 0) || 0;
  let fail = null;            // {i, lane} 실패한 타일
  let flash = 0;              // 게임오버 붉은 플래시 알파
  let lastTs = 0;

  // ── 오디오 ──
  const Audio = (() => {
    let actx = null, master;
    let muted = localStorage.getItem('tilesMuted') === '1';
    function ensure() { if (actx) return; actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(actx.destination); }
    function init() { ensure(); if (actx.state !== 'running') actx.resume(); }
    function setMuted(m) { muted = m; localStorage.setItem('tilesMuted', m ? '1' : '0'); if (actx) master.gain.setTargetAtTime(m ? 0 : 1, actx.currentTime, .02); }
    function isMuted() { return muted; }
    function tone(freq, t0, dur, type, peak) {
      if (!actx || muted) return;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak || .2, t0 + .006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + .02);
    }
    return {
      init, setMuted, isMuted,
      note(i) { if (!actx) return; const t = actx.currentTime; const f = SCALE[i % SCALE.length]; tone(f, t, .35, 'triangle', .22); tone(f * 2, t + .005, .18, 'sine', .06); },
      over() { if (!actx) return; const t = actx.currentTime;[330, 262, 196].forEach((f, i) => tone(f, t + i * .12, .3, 'triangle', .2)); },
    };
  })();
  const vibrate = (p) => { if (!Audio.isMuted() && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} };

  // ── 레이아웃 ──
  function resize() {
    const r = wrap.getBoundingClientRect();
    W = Math.max(200, Math.round(r.width));
    H = Math.max(280, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    laneW = W / LANES;
    RH = Math.max(64, Math.min(140, Math.round(H / 5)));
    render();
  }

  function screenTopY(i) { return (H - RH) - i * RH + scroll; }
  function speed() { return Math.min(H * 1.0, H * 0.30 * (1 + score * 0.02)); }

  function ensureRows(maxIndex) {
    while (rows.length <= maxIndex) {
      const n = rows.length;
      const prev = n >= 1 ? rows[n - 1].lane : -1;
      const prev2 = n >= 2 ? rows[n - 2].lane : -1;
      rows.push({ lane: Core.nextLane(prev, prev2), hit: false, hitAt: 0 });
    }
  }

  function start() {
    over = false; running = false; scroll = 0; pending = 0; score = 0; fail = null; flash = 0;
    rows = [];
    ensureRows(AHEAD);
    overEl.classList.remove('show');
    hintEl.classList.remove('hide');
    updateHud();
    bestEl.textContent = best;
    lastTs = 0;
    if (!rafOn) { rafOn = true; requestAnimationFrame(loop); }
  }

  function laneFromX(clientX) {
    const r = cv.getBoundingClientRect();
    let l = Math.floor((clientX - r.left) / laneW);
    return Math.max(0, Math.min(LANES - 1, l));
  }

  function tap(clientX) {
    if (over) return;
    Audio.init();
    const lane = laneFromX(clientX);
    const res = Core.judgeTap(rows, pending, lane);
    if (res.hit) {
      const row = rows[pending];
      row.hit = true; row.hitAt = performance.now();
      score++;
      Audio.note(score - 1);
      vibrate(8);
      pending++;
      ensureRows(pending + AHEAD);
      updateHud();
      if (!running) { running = true; hintEl.classList.add('hide'); }
    } else {
      fail = { i: pending, lane: lane };
      gameOver();
    }
  }

  function updateHud() {
    scoreEl.textContent = score;
    if (score > best) { best = score; localStorage.setItem('tilesBest', String(best)); }
    bestEl.textContent = best;
  }

  function gameOver() {
    over = true; running = false; flash = 0.5;
    Audio.over();
    vibrate([0, 40, 60, 40]);
    const isRec = score >= best && score > 0;
    document.getElementById('over-score').textContent = score;
    document.getElementById('over-best').textContent = '최고 ' + best;
    document.getElementById('over-record').classList.toggle('show', isRec);
    setTimeout(() => overEl.classList.add('show'), 480);
    if (window.GamePortal) setTimeout(() => { GamePortal.openSupport(); }, 1150);
  }

  // ── 루프 ──
  let rafOn = false;
  function loop(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (running && !over) {
      scroll += speed() * dt;
      // pending 타일이 바닥 아래로 완전히 지나가면 놓침 → 게임오버
      if (screenTopY(pending) > H) { fail = { i: pending, lane: rows[pending].lane, missed: true }; gameOver(); }
    }
    if (flash > 0) flash = Math.max(0, flash - dt * 1.2);
    render();
    requestAnimationFrame(loop);
  }

  // ── 렌더 ──
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function tile(lane, top, hue, opts) {
    opts = opts || {};
    const x = lane * laneW + PAD, y = top + PAD, w = laneW - PAD * 2, h = RH - PAD * 2;
    let sat = 44, light = 64;
    if (opts.fail) { hue = 4; sat = 72; light = 62; }
    ctx.save();
    if (opts.scale && opts.scale !== 1) {
      ctx.translate(x + w / 2, y + h / 2); ctx.scale(opts.scale, opts.scale); ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.fillStyle = 'hsl(' + hue + ',' + sat + '%,' + light + '%)';
    roundRect(x, y, w, h, 10); ctx.fill();
    // 윗 림 + 하단 음영
    roundRect(x, y, w, h, 10); ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255,255,255,.40)'); g.addColorStop(.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  function render() {
    ctx.clearRect(0, 0, W, H);
    // 레인 구분선
    ctx.strokeStyle = 'rgba(70,110,90,.12)'; ctx.lineWidth = 1;
    for (let l = 1; l < LANES; l++) { ctx.beginPath(); ctx.moveTo(l * laneW, 0); ctx.lineTo(l * laneW, H); ctx.stroke(); }

    const iMin = Math.max(0, Math.floor((scroll - RH) / RH));
    const iMax = Math.floor((scroll + H) / RH) + 1;
    ensureRows(iMax + 1);
    const now = performance.now();
    for (let i = iMin; i <= iMax; i++) {
      const row = rows[i];
      if (!row) continue;
      const top = screenTopY(i);
      if (top > H || top + RH < 0) continue;
      if (row.hit) {
        // 탭된 타일 — 살짝 커졌다 사라지는 팝
        const age = (now - row.hitAt) / 1000;
        if (age > 0.32) continue;
        const p = age / 0.32;
        tile(row.lane, top, HUES[i % HUES.length], { scale: 1 + p * 0.16, alpha: 1 - p });
      } else {
        const isPending = (i === pending);
        const failHere = over && fail && fail.i === i && !!fail.missed;
        let scale = 1;
        if (isPending && !running && !over) scale = 1 + Math.sin(now / 240) * 0.03; // 첫 타일 살짝 맥동
        tile(row.lane, top, HUES[i % HUES.length], { scale: scale, fail: failHere });
      }
    }
    // 잘못 누른 레인 표시(빈 칸 오답)
    if (over && fail && !fail.missed) {
      const top = screenTopY(pending);
      tile(fail.lane, Math.max(0, Math.min(H - RH, top)), 4, { fail: true, alpha: .9 });
    }
    // 게임오버 붉은 플래시
    if (flash > 0) { ctx.fillStyle = 'rgba(220,80,80,' + (flash * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }
  }

  // ── 입력 ──
  cv.addEventListener('pointerdown', (e) => { e.preventDefault(); tap(e.clientX); });
  window.addEventListener('keydown', (e) => {
    const map = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, KeyA: 0, KeyS: 1, KeyK: 2, KeyL: 3 };
    if (over && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); start(); return; }
    if (map[e.code] != null && !over) { e.preventDefault(); const r = cv.getBoundingClientRect(); tap(r.left + (map[e.code] + 0.5) * laneW); }
  });

  function refreshMute() { document.getElementById('mute-use').setAttribute('href', Audio.isMuted() ? '#p-speaker-slash' : '#p-speaker-high'); }
  document.getElementById('mute').addEventListener('click', () => { Audio.init(); Audio.setMuted(!Audio.isMuted()); refreshMute(); if (!Audio.isMuted()) Audio.note(0); });
  document.getElementById('btn-again').addEventListener('click', () => { Audio.init(); start(); });

  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  refreshMute();
  resize();
  start();
})();
