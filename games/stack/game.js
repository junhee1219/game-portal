// 탑 쌓기 — 좌우로 움직이는 블록을 톡 쳐서 쌓는 타이밍 게임
// 게임 계약: 신기록 시 localStorage.setItem('stackBest', String(score)) (서빙 후킹이 리더보드 캡처)
//            음소거 키 stackMuted ('1'/'0'). portal.js·후원 모달은 서빙이 주입.
(() => {
  'use strict';
  const Core = (typeof StackCore !== 'undefined') ? StackCore : null;

  // ── 상수 ──
  const PERFECT_TOL = 5;       // 완벽 정렬 허용 오차(px)
  const REGROW = 6;            // 완벽 시 너비 보너스(px)
  const MIN_W = 8;             // 이보다 좁으면 사실상 실패 위험 (게임오버는 overlap<=0에서)

  // ── DOM ──
  const wrap = document.getElementById('wrap');
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overEl = document.getElementById('over');
  const hintEl = document.getElementById('hint');

  // ── 상태 ──
  let W = 320, H = 480, dpr = 1;
  let BH = 30;                 // 블록 높이(px)
  let baseW = 180;             // 기준 너비
  let anchorY = 150;           // 활성 블록 윗변이 머무는 화면 Y
  let blocks = [];             // [{x,w,i, placedAt}] (i = 층 인덱스, 0=토대)
  let active = null;           // {x,w,dir,i}
  let shards = [];             // 깎여 떨어지는 조각
  let fx = [];                 // 완벽/효과
  let camTop = 0;              // 화면 anchor에 매핑되는 world-top(px)
  let count = 0;               // 쌓인 블록 수(토대 포함)
  let score = 0;
  let best = +(localStorage.getItem('stackBest') || 0) || 0;
  let combo = 0;
  let over = false;
  let lastTs = 0;

  // ── 오디오 (Web Audio 합성) ──
  const Audio = (() => {
    let actx = null, master;
    let muted = localStorage.getItem('stackMuted') === '1';
    function ensure() {
      if (actx) return;
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = muted ? 0 : 1;
      master.connect(actx.destination);
    }
    function init() { ensure(); if (actx.state !== 'running') actx.resume(); }
    function setMuted(m) { muted = m; localStorage.setItem('stackMuted', m ? '1' : '0'); if (actx) master.gain.setTargetAtTime(m ? 0 : 1, actx.currentTime, .02); }
    function isMuted() { return muted; }
    function tone(freq, t0, dur, type, peak) {
      if (!actx || muted) return;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak || .2, t0 + .008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + .02);
    }
    return {
      init, setMuted, isMuted,
      place(c) { if (!actx) return; const t = actx.currentTime; const f = 300 * Math.pow(1.06, Math.min(c, 24)); tone(f, t, .12, 'triangle', .2); tone(f * 1.5, t + .01, .08, 'sine', .08); },
      perfect(c) { if (!actx) return; const t = actx.currentTime; const f = 520 * Math.pow(1.06, Math.min(c, 24)); tone(f, t, .16, 'triangle', .22); tone(f * 1.25, t + .04, .16, 'sine', .12); tone(f * 1.5, t + .08, .14, 'sine', .08); },
      slice() { if (!actx) return; const t = actx.currentTime; tone(140, t, .12, 'sawtooth', .12); },
      over() { if (!actx) return; const t = actx.currentTime;[392, 311, 247].forEach((f, i) => tone(f, t + i * .13, .3, 'triangle', .18)); },
    };
  })();
  const vibrate = (p) => { if (!Audio.isMuted() && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} };

  // ── 레이아웃 ──
  function resize() {
    const r = wrap.getBoundingClientRect();
    const oldW = W;
    W = Math.max(200, Math.round(r.width));
    H = Math.max(280, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    BH = Math.max(22, Math.min(40, Math.round(H / 15)));
    anchorY = Math.round(H * 0.30);
    // 폭이 바뀌면 기존 블록 가로배치를 비율 보정 (게임 도중 회전 대비)
    if (oldW && Math.abs(oldW - W) > 1 && blocks.length) {
      const k = W / oldW;
      blocks.forEach(b => { b.x *= k; b.w *= k; });
      if (active) { active.x *= k; active.w *= k; }
      baseW *= k;
    } else {
      baseW = Math.round(W * 0.56);
    }
    render();
  }

  // ── 월드→화면 ──
  function screenTop(worldTop) { return anchorY + (camTop - worldTop); }
  function blockWorldTop(i) { return (i + 1) * BH; }
  function camTarget() { return (count + 1) * BH; }   // 활성 블록 윗변을 anchor에

  // ── 시작 ──
  function start() {
    over = false; combo = 0; score = 0; shards = []; fx = [];
    const baseX = Math.round((W - baseW) / 2);
    blocks = [{ x: baseX, w: baseW, i: 0, placedAt: 0 }];
    count = 1;
    camTop = camTarget();
    spawnActive();
    overEl.classList.remove('show');
    hintEl.classList.remove('hide');
    updateHud();
    bestEl.textContent = best;
    lastTs = 0;
    if (!rafOn) { rafOn = true; requestAnimationFrame(loop); }
  }

  function spawnActive() {
    const top = blocks[count - 1];
    const w = top.w;
    const fromLeft = (count % 2 === 1);
    active = { x: fromLeft ? 0 : (W - w), w: w, dir: fromLeft ? 1 : -1, i: count };
  }

  function moveSpeed() {
    // px/초 — 층이 오를수록 빨라짐(상한)
    return Math.min(W * 1.4, W * 0.5 * (1 + Math.min(count, 45) * 0.035));
  }

  // ── 떨어뜨리기 ──
  function drop() {
    if (over || !active) return;
    Audio.init();
    hintEl.classList.add('hide');
    const prev = blocks[count - 1];
    const aTopScreen = screenTop(blockWorldTop(active.i));
    const res = Core.computeDrop(prev, active, PERFECT_TOL);
    if (res.miss) {
      // 완전히 빗나감 → 활성 블록이 떨어지며 게임오버
      shards.push(makeShard(active.x, aTopScreen, active.w, active.i, (active.x < prev.x ? -1 : 1)));
      Audio.slice();
      gameOver();
      return;
    }
    // 깎여 떨어지는 조각
    if (res.overhang) {
      shards.push(makeShard(res.overhang.x, aTopScreen, res.overhang.w, active.i, (res.overhang.x < res.x ? -1 : 1)));
    }
    let nw = res.w, nx = res.x;
    if (res.perfect) {
      combo++;
      nw = Math.min(baseW, prev.w + REGROW);          // 완벽 → 살짝 넓어짐(보상)
      nx = prev.x - Math.round((nw - prev.w) / 2);     // 가운데 정렬 유지
      nx = Math.max(0, Math.min(W - nw, nx));
      fx.push({ type: 'perfect', x: nx, w: nw, top: screenTop(blockWorldTop(active.i)), t: 0, combo: combo });
      Audio.perfect(combo);
      vibrate([0, 12, 30, 12]);
    } else {
      combo = 0;
      Audio.place(0);
      vibrate(10);
    }
    blocks.push({ x: nx, w: nw, i: count, placedAt: performance.now() });
    count++;
    score = count - 1;
    if (score > best) { best = score; localStorage.setItem('stackBest', String(best)); }
    updateHud();
    spawnActive();
  }

  function makeShard(x, topScreen, w, i, dir) {
    return { x: x, y: topScreen, w: w, h: BH, vx: dir * (1.2 + Math.random() * 1.2), vy: -1.5 - Math.random(), rot: 0, vr: dir * (0.06 + Math.random() * 0.06), i: i, alpha: 1 };
  }

  function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
  }

  // ── 게임오버 ──
  function gameOver() {
    over = true; active = null;
    Audio.over();
    vibrate([0, 40, 60, 40]);
    const isRec = score >= best && score > 0;
    document.getElementById('over-score').textContent = score;
    document.getElementById('over-best').textContent = '최고 ' + best + '층';
    document.getElementById('over-record').classList.toggle('show', isRec);
    setTimeout(() => overEl.classList.add('show'), 420);
    if (window.GamePortal) setTimeout(() => { GamePortal.openSupport(); }, 1100);
  }

  // ── 루프 ──
  let rafOn = false;
  function loop(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;

    // 활성 블록 진자운동
    if (!over && active) {
      active.x += active.dir * moveSpeed() * dt;
      if (active.x <= 0) { active.x = 0; active.dir = 1; }
      else if (active.x >= W - active.w) { active.x = W - active.w; active.dir = -1; }
    }
    // 카메라 따라가기
    camTop += (camTarget() - camTop) * Math.min(1, dt * 10);

    // 파편 물리
    for (const s of shards) { s.vy += 0.4; s.x += s.vx; s.y += s.vy; s.rot += s.vr; s.alpha -= 0.012; }
    shards = shards.filter(s => s.alpha > 0 && s.y < H + 80);
    // 효과 수명
    for (const f of fx) f.t += dt;
    fx = fx.filter(f => f.t < 0.5);

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
  function paintSlab(x, top, w, hue, squash) {
    let h = BH;
    if (squash) { const k = 1 - squash * 0.18; const nh = h * k; top = top + (h - nh); h = nh; }
    // 본체
    ctx.fillStyle = 'hsl(' + hue + ',46%,63%)';
    roundRect(x, top, w, h, 4); ctx.fill();
    // 윗 림(크리스프) + 하단 음영 — 명도폭 좁게
    ctx.save(); roundRect(x, top, w, h, 4); ctx.clip();
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, 'rgba(255,255,255,.40)');
    g.addColorStop(0.45, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = g; ctx.fillRect(x, top, w, h);
    ctx.restore();
  }
  function render() {
    ctx.clearRect(0, 0, W, H);

    // 블록들
    const now = performance.now();
    for (const b of blocks) {
      const top = screenTop(blockWorldTop(b.i));
      if (top > H + BH || top + BH < -BH) continue;   // 화면 밖 스킵
      const age = b.placedAt ? (now - b.placedAt) / 1000 : 1;
      const squash = age < 0.16 ? (1 - age / 0.16) : 0;
      paintSlab(b.x, top, b.w, Core.hueFor(b.i), squash);
    }

    // 활성 블록
    if (active && !over) {
      const top = screenTop(blockWorldTop(active.i));
      paintSlab(active.x, top, active.w, Core.hueFor(active.i), 0);
    }

    // 파편
    for (const s of shards) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, s.alpha);
      ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
      ctx.rotate(s.rot);
      ctx.fillStyle = 'hsl(' + Core.hueFor(s.i) + ',46%,63%)';
      roundRect(-s.w / 2, -s.h / 2, s.w, s.h, 4); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // 완벽 효과 (확장 외곽선 + Perfect!)
    for (const f of fx) {
      if (f.type !== 'perfect') continue;
      const p = f.t / 0.5;            // 0→1
      const grow = p * 10;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      roundRect(f.x - grow, f.top - grow, f.w + grow * 2, BH + grow * 2, 6); ctx.stroke();
      // 텍스트
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.fillStyle = '#fff';
      ctx.font = '800 ' + Math.round(BH * 0.62) + 'px "Pretendard Variable",-apple-system,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const label = f.combo >= 2 ? ('완벽! x' + f.combo) : '완벽!';
      ctx.fillText(label, f.x + f.w / 2, f.top - 8 - grow);
      ctx.restore();
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  // ── 입력 ──
  cv.addEventListener('pointerdown', (e) => { e.preventDefault(); drop(); });
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (over) start(); else drop(); } });

  // 음소거
  function refreshMute() {
    document.getElementById('mute-use').setAttribute('href', Audio.isMuted() ? '#p-speaker-slash' : '#p-speaker-high');
  }
  document.getElementById('mute').addEventListener('click', () => {
    Audio.init(); Audio.setMuted(!Audio.isMuted()); refreshMute();
    if (!Audio.isMuted()) Audio.place(0);
  });
  document.getElementById('btn-again').addEventListener('click', () => { Audio.init(); start(); });

  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

  // 부팅
  refreshMute();
  resize();
  start();
})();
