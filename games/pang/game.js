/* 과일 팡팡 — 애니팡식 매치3.
   - DOM+SVG 타일(game-kit 2층 아이콘: g-* 과일 글리프). 위치는 외부 .tile(translate), 팝/선택은 내부 .ti(scale).
   - 캐스케이드는 async/await로 시퀀싱. 사운드는 game-kit audio.js(star=콤보 상승 팝). */
(function () {
  'use strict';

  // ===== 설정 =====
  var COLS = 7, ROWS = 8;
  var FRUITS = [
    { id: 'g-cherry',     color: '#ef4444' },
    { id: 'g-strawberry', color: '#fb6f92' },
    { id: 'g-orange',     color: '#ff9f1c' },
    { id: 'g-lemon',      color: '#f4c20d' },
    { id: 'g-grapes',     color: '#9b5de5' },
    { id: 'g-watermelon', color: '#2ec4b6' }
  ];
  var TYPES = FRUITS.length;
  var GAME_SEC = 60;
  var BEST_KEY = 'pangBest', MUTE_KEY = 'pangMuted';
  var GAP = 6;

  // ===== DOM =====
  var board = document.getElementById('board');
  var fx = document.getElementById('fx');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var timeWrap = document.getElementById('timebar');
  var timeFill = document.getElementById('timefill');
  var muteBtn = document.getElementById('mute');
  var startOv = document.getElementById('start');
  var overOv = document.getElementById('over');
  var overScore = document.getElementById('over-score');
  var overBest = document.getElementById('over-best');
  var overNew = document.getElementById('over-new');

  // ===== 오디오 =====
  var A = createGameAudio(MUTE_KEY);

  // ===== 상태 =====
  var grid = [];
  var tileSize = 46;
  var busy = false, playing = false;
  var score = 0, best = 0;
  var sel = null;
  var timeLeft = GAME_SEC, timerId = null, startT = 0;
  var uid = 0;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ri(n) { return Math.floor(Math.random() * n); }
  function num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  // ===== 레이아웃 =====
  function layout() {
    var maxW = Math.min(window.innerWidth - 24, 460);
    var maxH = window.innerHeight - 188;
    var sw = (maxW - GAP * (COLS - 1)) / COLS;
    var sh = (maxH - GAP * (ROWS - 1)) / ROWS;
    tileSize = Math.max(32, Math.min(66, Math.floor(Math.min(sw, sh))));
    board.style.width = (tileSize * COLS + GAP * (COLS - 1)) + 'px';
    board.style.height = (tileSize * ROWS + GAP * (ROWS - 1)) + 'px';
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (grid[r] && grid[r][c]) place(grid[r][c]);
  }
  function xOf(c) { return c * (tileSize + GAP); }
  function yOf(r) { return r * (tileSize + GAP); }
  function place(t) {
    t.el.style.width = tileSize + 'px';
    t.el.style.height = tileSize + 'px';
    t.el.style.transform = 'translate(' + xOf(t.c) + 'px,' + yOf(t.r) + 'px)';
  }

  // ===== 타일 =====
  function makeTile(type, r, c) {
    var t = { id: ++uid, type: type, r: r, c: c, el: null };
    var el = document.createElement('div');
    el.className = 'tile';
    el.style.setProperty('--fc', FRUITS[type].color);
    el.innerHTML = '<div class="ti"><svg class="frt" viewBox="0 0 512 512" aria-hidden="true"><use href="#' + FRUITS[type].id + '"/></svg></div>';
    el.addEventListener('pointerdown', function () { onTap(t); });
    t.el = el;
    board.appendChild(el);
    return t;
  }
  function renderGlyph(t) {
    t.el.style.setProperty('--fc', FRUITS[t.type].color);
    t.el.querySelector('use').setAttribute('href', '#' + FRUITS[t.type].id);
  }

  // ===== 보드 생성 (즉시 매치 없이) =====
  function newBoard() {
    board.innerHTML = '';
    grid = [];
    for (var r = 0; r < ROWS; r++) {
      grid[r] = [];
      for (var c = 0; c < COLS; c++) {
        var type, guard = 0;
        do {
          type = ri(TYPES); guard++;
        } while (guard < 24 && (
          (c >= 2 && grid[r][c - 1].type === type && grid[r][c - 2].type === type) ||
          (r >= 2 && grid[r - 1][c].type === type && grid[r - 2][c].type === type)
        ));
        var t = makeTile(type, r, c);
        grid[r][c] = t;
        place(t);
      }
    }
    if (!hasMove()) reshuffle();
  }

  // ===== 매치 탐색 =====
  function findMatches() {
    var hits = {}, r, c, k, run;
    for (r = 0; r < ROWS; r++) {
      run = 1;
      for (c = 1; c <= COLS; c++) {
        var same = c < COLS && grid[r][c] && grid[r][c - 1] && grid[r][c].type === grid[r][c - 1].type;
        if (same) run++;
        else { if (run >= 3) for (k = 0; k < run; k++) hits[r + ',' + (c - 1 - k)] = 1; run = 1; }
      }
    }
    for (c = 0; c < COLS; c++) {
      run = 1;
      for (r = 1; r <= ROWS; r++) {
        var same2 = r < ROWS && grid[r][c] && grid[r - 1][c] && grid[r][c].type === grid[r - 1][c].type;
        if (same2) run++;
        else { if (run >= 3) for (k = 0; k < run; k++) hits[(r - 1 - k) + ',' + c] = 1; run = 1; }
      }
    }
    return hits;
  }

  // ===== 입력 =====
  function onTap(t) {
    if (!playing || busy) return;
    A.init();
    if (!sel) { sel = t; t.el.classList.add('sel'); A.select(); return; }
    if (sel === t) { sel.el.classList.remove('sel'); sel = null; return; }
    var adj = (sel.r === t.r && Math.abs(sel.c - t.c) === 1) || (sel.c === t.c && Math.abs(sel.r - t.r) === 1);
    if (!adj) { sel.el.classList.remove('sel'); sel = t; t.el.classList.add('sel'); A.select(); return; }
    var a = sel; a.el.classList.remove('sel'); sel = null;
    trySwap(a, t);
  }

  function swapModel(a, b) {
    grid[a.r][a.c] = b; grid[b.r][b.c] = a;
    var r = a.r, c = a.c; a.r = b.r; a.c = b.c; b.r = r; b.c = c;
  }

  async function trySwap(a, b) {
    busy = true;
    A.whoosh();
    swapModel(a, b); place(a); place(b);
    await sleep(180);
    if (!Object.keys(findMatches()).length) {
      A.bad();
      swapModel(a, b); place(a); place(b);   // 되돌리기
      await sleep(180);
      busy = false;
      return;
    }
    await resolve();
  }

  // ===== 해소 (캐스케이드) =====
  async function resolve() {
    var cascade = 0;
    while (true) {
      var keys = Object.keys(findMatches());
      if (!keys.length) break;
      cascade++;
      var gained = keys.length * 10 * cascade;
      score += gained; updateScore();
      A.star(Math.min(cascade - 1, 6));
      popupGain(keys, gained);
      if (cascade >= 2) comboText(cascade);
      if (cascade >= 3) shake();
      await popCells(keys);
      applyGravity();
      refill();
      await sleep(195);
    }
    busy = false;
    if (playing && !hasMove()) reshuffle();
  }

  function popCells(keys) {
    keys.forEach(function (key) {
      var p = key.split(','), r = +p[0], c = +p[1];
      var t = grid[r][c];
      if (!t) return;
      grid[r][c] = null;
      spark(t);
      t.el.classList.add('pop');
      var el = t.el;
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
    });
    return sleep(165);
  }

  function applyGravity() {
    for (var c = 0; c < COLS; c++) {
      var write = ROWS - 1;
      for (var r = ROWS - 1; r >= 0; r--) {
        if (grid[r][c]) {
          if (write !== r) {
            var t = grid[r][c];
            grid[write][c] = t; grid[r][c] = null;
            t.r = write; place(t);
          }
          write--;
        }
      }
    }
  }

  function refill() {
    for (var c = 0; c < COLS; c++) {
      for (var r = 0; r < ROWS; r++) {
        if (grid[r][c]) break;          // 채워진 영역은 바닥에 연속 → 위쪽만 비어있음
        var t = makeTile(ri(TYPES), r, c);
        grid[r][c] = t;
        t.el.style.transition = 'none';
        t.el.style.transform = 'translate(' + xOf(c) + 'px,' + yOf(r - ROWS) + 'px)';
        void t.el.offsetHeight;          // reflow → 위에서 떨어지는 애니메이션
        t.el.style.transition = '';
        place(t);
      }
    }
  }

  // ===== 움직일 수 있는 수가 있나 / 섞기 =====
  function anyRun() {
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var t = grid[r][c]; if (!t) continue;
      if (c + 2 < COLS && grid[r][c + 1] && grid[r][c + 2] && grid[r][c + 1].type === t.type && grid[r][c + 2].type === t.type) return true;
      if (r + 2 < ROWS && grid[r + 1][c] && grid[r + 2][c] && grid[r + 1][c].type === t.type && grid[r + 2][c].type === t.type) return true;
    }
    return false;
  }
  function swapType(r1, c1, r2, c2) {
    var a = grid[r1][c1], b = grid[r2][c2];
    var tt = a.type; a.type = b.type; b.type = tt;
  }
  function hasMove() {
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      if (!grid[r][c]) continue;
      if (c + 1 < COLS && grid[r][c + 1]) { swapType(r, c, r, c + 1); var m = anyRun(); swapType(r, c, r, c + 1); if (m) return true; }
      if (r + 1 < ROWS && grid[r + 1][c]) { swapType(r, c, r + 1, c); var m2 = anyRun(); swapType(r, c, r + 1, c); if (m2) return true; }
    }
    return false;
  }
  function reshuffle() {
    var types = [], r, c;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (grid[r][c]) types.push(grid[r][c].type);
    var guard = 0;
    do {
      for (var i = types.length - 1; i > 0; i--) { var j = ri(i + 1), tmp = types[i]; types[i] = types[j]; types[j] = tmp; }
      var idx = 0;
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (grid[r][c]) grid[r][c].type = types[idx++];
      guard++;
    } while (guard < 40 && (Object.keys(findMatches()).length > 0 || !hasMove()));
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (grid[r][c]) renderGlyph(grid[r][c]);
  }

  // ===== 손맛 (파티클/팝업/흔들림) =====
  function spark(t) {
    var cx = xOf(t.c) + tileSize / 2, cy = yOf(t.r) + tileSize / 2;
    for (var i = 0; i < 4; i++) {
      var s = document.createElement('div');
      s.className = 'spark';
      s.style.setProperty('--fc', FRUITS[t.type].color);
      var ang = (Math.PI / 2) * i + Math.random() * 0.7, dist = tileSize * 0.6;
      s.style.left = cx + 'px'; s.style.top = cy + 'px';
      s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      fx.appendChild(s);
      (function (el) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 480); })(s);
    }
  }
  function popupGain(keys, gained) {
    var sx = 0, sy = 0;
    keys.forEach(function (k) { var p = k.split(','); sx += xOf(+p[1]) + tileSize / 2; sy += yOf(+p[0]) + tileSize / 2; });
    sx /= keys.length; sy /= keys.length;
    var el = document.createElement('div');
    el.className = 'gain'; el.textContent = '+' + gained;
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    fx.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 720);
  }
  function comboText(n) {
    var el = document.createElement('div');
    el.className = 'combo'; el.textContent = n + ' 콤보!';
    fx.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 780);
  }
  function shake() { board.classList.remove('shake'); void board.offsetWidth; board.classList.add('shake'); }

  // ===== HUD =====
  function updateScore() {
    scoreEl.textContent = score.toLocaleString();
    scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump');
  }
  function updateTime() {
    timeFill.style.width = Math.max(0, timeLeft / GAME_SEC * 100) + '%';
    timeWrap.classList.toggle('low', timeLeft <= 10);
  }
  function renderMute() {
    muteBtn.innerHTML = '<svg class="ki"><use href="#' + (A.muted ? 'p-speaker-slash' : 'p-speaker-high') + '"/></svg>';
  }

  // ===== 게임 흐름 =====
  function startGame() {
    best = Math.max(best, num(localStorage.getItem(BEST_KEY)));
    score = 0; updateScore();
    sel = null; busy = false; playing = true;
    startOv.classList.add('hidden');
    overOv.classList.add('hidden');
    newBoard(); layout();
    timeLeft = GAME_SEC; updateTime();
    startT = Date.now();
    if (timerId) clearInterval(timerId);
    timerId = setInterval(tick, 100);
  }
  function tick() {
    timeLeft = GAME_SEC - (Date.now() - startT) / 1000;
    if (timeLeft <= 0) { timeLeft = 0; updateTime(); endGame(); return; }
    updateTime();
  }
  function endGame() {
    playing = false; busy = true;
    if (timerId) { clearInterval(timerId); timerId = null; }
    if (sel) { sel.el.classList.remove('sel'); sel = null; }
    best = Math.max(best, num(localStorage.getItem(BEST_KEY)));
    var isNew = score > best;
    if (isNew) { best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {} }
    overScore.textContent = score.toLocaleString();
    overBest.textContent = best.toLocaleString();
    overNew.style.display = isNew ? 'block' : 'none';
    bestEl.textContent = best.toLocaleString();
    overOv.classList.remove('hidden');
    if (isNew) A.record(); else A.win();
  }

  // ===== 부팅 =====
  best = num(localStorage.getItem(BEST_KEY));
  bestEl.textContent = best.toLocaleString();
  renderMute();
  newBoard(); layout();          // 시작 화면 뒤 장식용 보드
  window.addEventListener('resize', layout);
  document.addEventListener('pointerdown', function () { A.init(); }, { passive: true });
  muteBtn.addEventListener('click', function () { A.init(); A.setMuted(!A.muted); renderMute(); });
  document.getElementById('btn-start').addEventListener('click', function () { A.init(); startGame(); });
  document.getElementById('btn-again').addEventListener('click', function () { A.init(); startGame(); });
})();
