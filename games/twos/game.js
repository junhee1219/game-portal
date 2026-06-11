// 2048 — 한 방향으로 밀어 같은 수를 합치는 숫자 퍼즐
// 게임 계약: 신기록 시 localStorage.setItem('twosBest', String(score)) (서빙 후킹이 리더보드 캡처)
//            진행 중 보드는 'twosBoard'에 로컬 저장 → 나갔다 와도 이어하기 (시간제한 없음 원칙)
//            음소거 키 twosMuted ('1'/'0'). portal.js·후원 모달은 서빙이 주입.
(() => {
  'use strict';
  const Core = (typeof TwosCore !== 'undefined') ? TwosCore : null;
  const SIZE = 4;

  // ── 타일 색상 (파스텔 단일 톤 ramp: 차분한 파랑→초록→앰버→골드, 명도폭 좁게) ──
  const COLORS = {
    2:    { bg: '#eaf1fb', fg: '#5b6478' },
    4:    { bg: '#d8e6fb', fg: '#4a5570' },
    8:    { bg: '#8fc0f0', fg: '#ffffff' },
    16:   { bg: '#6ea8ea', fg: '#ffffff' },
    32:   { bg: '#7fcf9f', fg: '#ffffff' },
    64:   { bg: '#52bd84', fg: '#ffffff' },
    128:  { bg: '#f3cd86', fg: '#ffffff' },
    256:  { bg: '#efb65f', fg: '#ffffff' },
    512:  { bg: '#ec9f4e', fg: '#ffffff' },
    1024: { bg: '#ed8b6a', fg: '#ffffff' },
    2048: { bg: '#f5a623', fg: '#ffffff' },
  };
  function colorFor(v) {
    if (COLORS[v]) return COLORS[v];
    // 2048 너머: 깊은 골드로 고정
    return { bg: '#e07b3c', fg: '#ffffff' };
  }
  function fontScale(v) {
    const d = String(v).length;
    return d <= 2 ? 0.46 : d === 3 ? 0.39 : d === 4 ? 0.31 : 0.25;
  }

  // ── DOM ──
  const boardEl = document.getElementById('board');
  const tilesEl = document.getElementById('tiles');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overEl = document.getElementById('over');
  const hintEl = document.getElementById('hint');
  const toastEl = document.getElementById('toast');

  // ── 상태 ──
  let grid = [];               // SIZE×SIZE: tile 객체 또는 null
  let score = 0;
  let best = +(localStorage.getItem('twosBest') || 0) || 0;
  let curMax = 0;              // 이번 판 최대 타일 (마일스톤 토스트용)
  let nextId = 1;
  let animating = false;
  let over = false;
  let cell = 80, gap = 12;     // 레이아웃 (resize에서 계산)

  // ── 오디오 (Web Audio 합성) ──
  const Audio = (() => {
    let actx = null, master;
    let muted = localStorage.getItem('twosMuted') === '1';
    function ensure() {
      if (actx) return;
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = muted ? 0 : 1;
      master.connect(actx.destination);
    }
    function init() { ensure(); if (actx.state !== 'running') actx.resume(); }
    function setMuted(m) { muted = m; localStorage.setItem('twosMuted', m ? '1' : '0'); if (actx) master.gain.setTargetAtTime(m ? 0 : 1, actx.currentTime, .02); }
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
      move() { if (!actx) return; const t = actx.currentTime; tone(220, t, .06, 'triangle', .07); },
      merge(value) { if (!actx) return; const t = actx.currentTime; const e = Math.log2(value); const f = 300 * Math.pow(1.055, Math.min(e, 12)); tone(f, t, .13, 'triangle', .2); tone(f * 1.5, t + .02, .1, 'sine', .08); },
      milestone() { if (!actx) return; const t = actx.currentTime;[523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * .08, .2, 'triangle', .16)); },
      over() { if (!actx) return; const t = actx.currentTime;[392, 311, 247].forEach((f, i) => tone(f, t + i * .13, .3, 'triangle', .18)); },
    };
  })();
  const vibrate = (p) => { if (!Audio.isMuted() && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} };

  // ── 레이아웃 ──
  function layout() {
    const W = boardEl.clientWidth;
    gap = Math.max(8, Math.round(W * 0.03));
    boardEl.style.setProperty('--gap', gap + 'px');
    const cellsW = W - 2 * gap;
    cell = (cellsW - (SIZE - 1) * gap) / SIZE;
    // 모든 타일 재배치 (애니메이션 없이)
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c]; if (t) placeTile(t, false);
    }
  }
  function xy(r, c) { return { x: c * (cell + gap), y: r * (cell + gap) }; }

  function placeTile(t, animate) {
    const p = xy(t.r, t.c);
    t.el.style.width = cell + 'px';
    t.el.style.height = cell + 'px';
    t.el.style.fontSize = Math.round(cell * fontScale(t.value)) + 'px';
    const tf = 'translate(' + p.x + 'px,' + p.y + 'px)';
    t.el.style.setProperty('--xy', tf);
    if (!animate) {
      t.el.style.transition = 'none';
      t.el.style.transform = tf;
      void t.el.offsetWidth;            // reflow → 다음 transition 복원
      t.el.style.transition = '';
    } else {
      t.el.style.transform = tf;
    }
  }

  function paintTile(t) {
    const col = colorFor(t.value);
    t.el.style.background = col.bg;
    t.el.style.color = col.fg;
    t.el.style.fontSize = Math.round(cell * fontScale(t.value)) + 'px';
    t.el.querySelector('.v').textContent = t.value;
  }

  function makeTile(r, c, value, spawn) {
    const el = document.createElement('div');
    el.className = 'tile' + (spawn ? ' spawn' : '');
    el.innerHTML = '<span class="v"></span>';
    const t = { id: nextId++, r, c, value, el };
    tilesEl.appendChild(el);
    paintTile(t);
    placeTile(t, false);
    grid[r][c] = t;
    return t;
  }

  // ── 새 게임 / 이어하기 ──
  function clearTiles() {
    tilesEl.innerHTML = '';
    grid = [];
    for (let r = 0; r < SIZE; r++) { grid.push([]); for (let c = 0; c < SIZE; c++) grid[r].push(null); }
  }

  function spawnRandom(spawn) {
    const empties = Core.emptyCells(toValues());
    if (!empties.length) return null;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    const value = Math.random() < 0.9 ? 2 : 4;
    return makeTile(r, c, value, spawn);
  }

  function toValues() {
    return grid.map(row => row.map(t => t ? t.value : 0));
  }

  function newGame() {
    over = false; animating = false; score = 0; curMax = 0;
    overEl.classList.remove('show');
    clearTiles();
    layout();
    spawnRandom(true);
    spawnRandom(true);
    curMax = Core.maxTile(toValues());
    updateHud();
    hintEl.classList.remove('hide');
    save();
  }

  function restore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem('twosBoard') || 'null'); } catch (e) {}
    if (!data || !Array.isArray(data.grid) || data.grid.length !== SIZE) { newGame(); return; }
    over = false; animating = false;
    clearTiles();
    layout();
    let any = false;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const v = data.grid[r] && data.grid[r][c];
      if (v) { makeTile(r, c, v, false); any = true; }
    }
    if (!any) { newGame(); return; }
    score = +data.score || 0;
    curMax = Core.maxTile(toValues());
    hintEl.classList.add('hide');
    updateHud();
    if (!Core.hasMoves(toValues())) { setTimeout(() => endGame(), 300); }
  }

  function save() {
    try {
      localStorage.setItem('twosBoard', JSON.stringify({ grid: toValues(), score: score }));
    } catch (e) {}
  }

  function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
  }

  // ── 이동 ──
  function applyMove(dir) {
    if (animating || over) return;
    const ls = Core.lines(SIZE, dir);
    const actions = [];    // {tile, toR, toC, dead, merged, newValue}
    let gained = 0, moved = false;

    for (const coords of ls) {
      const vals = coords.map(rc => { const t = grid[rc[0]][rc[1]]; return t ? t.value : 0; });
      const res = Core.slideIndices(vals);
      gained += res.gained;
      if (res.moved) moved = true;
      for (const mv of res.moves) {
        const from = coords[mv.from], to = coords[mv.to];
        const tile = grid[from[0]][from[1]];
        if (!tile) continue;
        actions.push({
          tile,
          toR: to[0], toC: to[1],
          dead: mv.merged && !mv.survivor,
          merged: mv.merged && mv.survivor,
          newValue: res.result[mv.to],
        });
      }
    }

    if (!moved) return;     // 변화 없는 방향은 무시 (스폰 안 함)

    animating = true;
    hintEl.classList.add('hide');
    Audio.init();
    Audio.move();

    // 모델 갱신 + 슬라이드 애니메이션
    const newGrid = [];
    for (let r = 0; r < SIZE; r++) { newGrid.push([]); for (let c = 0; c < SIZE; c++) newGrid[r].push(null); }
    let mergedCount = 0;
    for (const a of actions) {
      a.tile.r = a.toR; a.tile.c = a.toC;
      placeTile(a.tile, true);                 // transition으로 이동
      if (a.dead) {
        // 합쳐져 사라지는 타일 — 슬라이드 후 제거
      } else {
        a.tile.value = a.newValue;             // 모델 값 갱신 (생존/일반)
        newGrid[a.toR][a.toC] = a.tile;
        if (a.merged) mergedCount++;
      }
    }
    grid = newGrid;

    score += gained;
    if (score > best) { best = score; localStorage.setItem('twosBest', String(best)); }
    updateHud();

    setTimeout(() => {
      // 사라지는 타일 제거
      for (const a of actions) { if (a.dead) { a.tile.el.remove(); } }
      // 생존(합쳐진) 타일: 값 표시 갱신 + 팝
      for (const a of actions) {
        if (a.merged) {
          paintTile(a.tile);
          a.tile.el.classList.remove('pop'); void a.tile.el.offsetWidth;
          a.tile.el.classList.add('pop');
          Audio.merge(a.tile.value);
        }
      }
      if (mergedCount) vibrate(12);

      // 새 타일 스폰
      spawnRandom(true);

      // 마일스톤 (새 최고 타일)
      const mx = Core.maxTile(toValues());
      if (mx > curMax) {
        curMax = mx;
        if (mx >= 128) showMilestone(mx);
      }

      save();
      animating = false;

      if (!Core.hasMoves(toValues())) endGame();
    }, 125);
  }

  function showMilestone(value) {
    if (value >= 2048) { toastEl.textContent = value + ' 달성!'; Audio.milestone(); vibrate([0, 20, 40, 20]); }
    else { toastEl.textContent = value + '!'; }
    toastEl.classList.add('show');
    clearTimeout(showMilestone._t);
    showMilestone._t = setTimeout(() => toastEl.classList.remove('show'), 1100);
  }

  // ── 게임오버 ──
  function endGame() {
    if (over) return;
    over = true;
    Audio.over();
    vibrate([0, 40, 60, 40]);
    const mx = Core.maxTile(toValues());
    if (score > best) { best = score; localStorage.setItem('twosBest', String(best)); updateHud(); }
    const isRec = score >= best && score > 0;
    document.getElementById('over-score').textContent = score;
    document.getElementById('over-best').textContent = '최고 ' + best + '점 · 타일 ' + mx;
    document.getElementById('over-record').classList.toggle('show', isRec);
    try { localStorage.removeItem('twosBoard'); } catch (e) {}   // 끝난 판은 이어하기 대상 아님
    setTimeout(() => overEl.classList.add('show'), 420);
    if (window.GamePortal) setTimeout(() => { GamePortal.openSupport(); }, 1100);
  }

  // ── 입력: 스와이프 + 키보드 ──
  let sx = 0, sy = 0, swiping = false;
  boardEl.addEventListener('pointerdown', (e) => {
    if (over) return;
    swiping = true; sx = e.clientX; sy = e.clientY;
    Audio.init();
  });
  function endSwipe(e) {
    if (!swiping) return;
    swiping = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const TH = 18;
    if (Math.max(ax, ay) < TH) return;
    if (ax > ay) applyMove(dx > 0 ? 'right' : 'left');
    else applyMove(dy > 0 ? 'down' : 'up');
  }
  boardEl.addEventListener('pointerup', endSwipe);
  boardEl.addEventListener('pointercancel', () => { swiping = false; });

  const KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
  };
  window.addEventListener('keydown', (e) => {
    if (over) {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); Audio.init(); newGame(); }
      return;
    }
    const dir = KEYS[e.key];
    if (dir) { e.preventDefault(); Audio.init(); applyMove(dir); }
  });

  // ── 음소거 ──
  function refreshMute() {
    document.getElementById('mute-use').setAttribute('href', Audio.isMuted() ? '#p-speaker-slash' : '#p-speaker-high');
  }
  document.getElementById('mute').addEventListener('click', () => {
    Audio.init(); Audio.setMuted(!Audio.isMuted()); refreshMute();
    if (!Audio.isMuted()) Audio.move();
  });
  document.getElementById('btn-again').addEventListener('click', () => { Audio.init(); newGame(); });

  // ── 리사이즈 ──
  let rT = null;
  function onResize() { clearTimeout(rT); rT = setTimeout(layout, 80); }
  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  // ── 부팅 ──
  refreshMute();
  restore();
})();
