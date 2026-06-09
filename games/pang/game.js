/* 과일 팡팡 — 레벨/목표/이동 매치3 (Royal Match풍, 시간제약 X).
   - 레벨마다 [이동 횟수 제한 + 수확 목표(특정 과일 N개 모으기)]. 목표 달성=다음 레벨, 이동 소진=게임오버.
   - match-4+ = 폭죽: 해당 칸의 가로·세로 줄 전체 클리어(부스터, 수확에도 큰 도움).
   - DOM+SVG 타일(game-kit g-* 과일). 위치=외부 .tile(translate), 팝/선택=내부 .ti(scale). 캐스케이드=async. */
(function () {
  'use strict';

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
  var BEST_KEY = 'pangBest', MUTE_KEY = 'pangMuted';
  var GAP = 6;

  // ===== 레벨 스펙: 이동 횟수 + 수확 목표 =====
  function levelSpec(L) {
    var moves = Math.max(15, 22 - (L - 1));            // 22→15 (긴장감 위해 조임)
    var nTypes = L < 4 ? 2 : 3;                         // 4레벨부터 목표 3종
    var per = 9 + (L - 1) * 2;                          // 종류당 개수 9,11,13,... (빠르게 증가)
    // 이번 레벨 목표 과일 종류 (레벨에 따라 회전 — 다양성)
    var goals = [];
    var used = {};
    for (var i = 0; i < nTypes; i++) {
      var t = (L * 2 + i * 2 + i) % TYPES;
      while (used[t]) t = (t + 1) % TYPES;
      used[t] = 1;
      goals.push({ type: t, need: per, got: 0 });
    }
    return { moves: moves, goals: goals };
  }

  // ===== DOM =====
  var board = document.getElementById('board');
  var fx = document.getElementById('fx');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var levelEl = document.getElementById('level');
  var movesEl = document.getElementById('moves');
  var movesWrap = document.getElementById('moves-wrap');
  var goalsEl = document.getElementById('goals');
  var muteBtn = document.getElementById('mute');
  var startOv = document.getElementById('start');
  var clearOv = document.getElementById('clear');
  var clearTitle = document.getElementById('clear-title');
  var clearSub = document.getElementById('clear-sub');
  var overOv = document.getElementById('over');
  var overLevel = document.getElementById('over-level');
  var overScore = document.getElementById('over-score');
  var overBest = document.getElementById('over-best');
  var overNew = document.getElementById('over-new');

  var A = createGameAudio(MUTE_KEY);

  // ===== 상태 =====
  var grid = [];
  var tileSize = 46;
  var busy = false, playing = false;
  var score = 0, best = 0;
  var level = 1, movesLeft = 0;
  var goals = [];
  var sel = null;
  var uid = 0;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ri(n) { return Math.floor(Math.random() * n); }
  function num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  // ===== 레이아웃 =====
  function layout() {
    var maxW = Math.min(window.innerWidth - 24, 460);
    var maxH = window.innerHeight - 244;     // HUD(레벨/점수/이동 + 목표칩) 공간 확보
    var sw = (maxW - GAP * (COLS - 1)) / COLS;
    var sh = (maxH - GAP * (ROWS - 1)) / ROWS;
    tileSize = Math.max(32, Math.min(64, Math.floor(Math.min(sw, sh))));
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

  function makeTile(type, r, c) {
    var t = { id: ++uid, type: type, r: r, c: c, el: null };
    var el = document.createElement('div');
    el.className = 'tile';
    el.style.setProperty('--fc', FRUITS[type].color);
    el.innerHTML = '<div class="ti"><svg class="frt" viewBox="0 0 512 512" aria-hidden="true"><use href="#' + FRUITS[type].id + '"/></svg></div>';
    el.addEventListener('pointerdown', function (e) { onPointerDown(t, e); });
    t.el = el;
    board.appendChild(el);
    return t;
  }
  function renderGlyph(t) {
    t.el.style.setProperty('--fc', FRUITS[t.type].color);
    t.el.querySelector('use').setAttribute('href', '#' + FRUITS[t.type].id);
  }

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

  // ===== 매치 탐색: hits(터질 칸) + 4+ 런이면 blast(가로·세로 줄) 추가 =====
  function findMatches() {
    var hits = {}, blastCenters = [], r, c, k, run;
    function markRun(cells) {
      cells.forEach(function (rc) { hits[rc[0] + ',' + rc[1]] = 1; });
      if (cells.length >= 4) blastCenters.push(cells[Math.floor(cells.length / 2)]);
    }
    for (r = 0; r < ROWS; r++) {
      run = [];
      for (c = 0; c <= COLS; c++) {
        var cont = c < COLS && grid[r][c] && run.length && grid[r][c].type === grid[r][run[run.length - 1][1]].type;
        if (c < COLS && (run.length === 0 || cont)) run.push([r, c]);
        else { if (run.length >= 3) markRun(run); run = (c < COLS) ? [[r, c]] : []; }
      }
    }
    for (c = 0; c < COLS; c++) {
      run = [];
      for (r = 0; r <= ROWS; r++) {
        var cont2 = r < ROWS && grid[r][c] && run.length && grid[r][c].type === grid[run[run.length - 1][0]][c].type;
        if (r < ROWS && (run.length === 0 || cont2)) run.push([r, c]);
        else { if (run.length >= 3) markRun(run); run = (r < ROWS) ? [[r, c]] : []; }
      }
    }
    // 폭죽: 4+런 중심 칸의 가로·세로 줄 전체를 hits에 추가
    blastCenters.forEach(function (ctr) {
      var br = ctr[0], bc = ctr[1];
      for (var cc = 0; cc < COLS; cc++) if (grid[br][cc]) hits[br + ',' + cc] = 1;
      for (var rr = 0; rr < ROWS; rr++) if (grid[rr][bc]) hits[rr + ',' + bc] = 1;
    });
    return { hits: Object.keys(hits), blasts: blastCenters.length };
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

  // 드래그(스와이프)로 스왑 — 끌면 그 방향 이웃과 교체, 안 끌면 탭(탭-탭도 그대로 지원)
  var drag = null;
  function onPointerDown(t, e) {
    if (!playing || busy) return;
    A.init();
    drag = { tile: t, x: e.clientX, y: e.clientY, fired: false };
  }
  function onPointerMove(e) {
    if (!drag || drag.fired || busy) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < Math.max(12, tileSize * 0.35)) return;
    var nr = drag.tile.r, nc = drag.tile.c;
    if (ax > ay) nc += (dx > 0 ? 1 : -1); else nr += (dy > 0 ? 1 : -1);
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || !grid[nr][nc]) return; // 가장자리 — 발화 안 함
    drag.fired = true;
    if (sel) { sel.el.classList.remove('sel'); sel = null; }
    trySwap(drag.tile, grid[nr][nc]);
  }
  function onPointerUp() {
    if (drag && !drag.fired) onTap(drag.tile); // 안 끌었으면 탭으로 처리
    drag = null;
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', function () { drag = null; });

  function swapModel(a, b) {
    grid[a.r][a.c] = b; grid[b.r][b.c] = a;
    var r = a.r, c = a.c; a.r = b.r; a.c = b.c; b.r = r; b.c = c;
  }
  async function trySwap(a, b) {
    busy = true;
    A.whoosh();
    swapModel(a, b); place(a); place(b);
    await sleep(170);
    if (!findMatches().hits.length) {
      A.bad();
      swapModel(a, b); place(a); place(b);    // 되돌리기 — 이동 소모 없음
      await sleep(170);
      busy = false;
      return;
    }
    movesLeft--; updateMoves();                // 유효한 수만 이동 소모
    await resolve();
    // 캐스케이드 종료 후 승패 판정 (승 먼저)
    if (goalsMet()) { await levelClear(); }
    else if (movesLeft <= 0) { gameOver(); }
    else { busy = false; }
  }

  // ===== 해소 (캐스케이드 + 수확 카운트) =====
  async function resolve() {
    var cascade = 0;
    while (true) {
      var m = findMatches();
      if (!m.hits.length) break;
      cascade++;
      var gained = m.hits.length * 10 * cascade;
      score += gained; updateScore();
      if (m.blasts) A.success(); else A.star(Math.min(cascade - 1, 6));
      popupGain(m.hits, gained);
      if (cascade >= 2) comboText(cascade);
      if (cascade >= 3 || m.blasts) shake();
      await popCells(m.hits);
      applyGravity();
      refill();
      await sleep(190);
    }
  }
  function popCells(keys) {
    keys.forEach(function (key) {
      var p = key.split(','), r = +p[0], c = +p[1];
      var t = grid[r][c];
      if (!t) return;
      countGoal(t.type);              // 수확 목표 카운트
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
          if (write !== r) { var t = grid[r][c]; grid[write][c] = t; grid[r][c] = null; t.r = write; place(t); }
          write--;
        }
      }
    }
  }
  function refill() {
    for (var c = 0; c < COLS; c++) {
      for (var r = 0; r < ROWS; r++) {
        if (grid[r][c]) break;
        var t = makeTile(ri(TYPES), r, c);
        grid[r][c] = t;
        t.el.style.transition = 'none';
        t.el.style.transform = 'translate(' + xOf(c) + 'px,' + yOf(r - ROWS) + 'px)';
        void t.el.offsetHeight;
        t.el.style.transition = '';
        place(t);
      }
    }
  }

  // ===== 수확 목표 =====
  function countGoal(type) {
    for (var i = 0; i < goals.length; i++) {
      if (goals[i].type === type && goals[i].got < goals[i].need) {
        goals[i].got++;
        renderGoals();
        return;
      }
    }
  }
  function goalsMet() {
    for (var i = 0; i < goals.length; i++) if (goals[i].got < goals[i].need) return false;
    return true;
  }
  function renderGoals() {
    goalsEl.innerHTML = goals.map(function (g) {
      var done = g.got >= g.need;
      var left = Math.max(0, g.need - g.got);
      return '<div class="goal' + (done ? ' done' : '') + '" style="--fc:' + FRUITS[g.type].color + '">' +
        '<svg class="gfrt" viewBox="0 0 512 512"><use href="#' + FRUITS[g.type].id + '"/></svg>' +
        '<span>' + (done ? '✓' : left) + '</span></div>';
    }).join('');
  }

  // ===== 움직임 가능 / 섞기 =====
  function anyRun() {
    for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
      var t = grid[r][c]; if (!t) continue;
      if (c + 2 < COLS && grid[r][c + 1] && grid[r][c + 2] && grid[r][c + 1].type === t.type && grid[r][c + 2].type === t.type) return true;
      if (r + 2 < ROWS && grid[r + 1][c] && grid[r + 2][c] && grid[r + 1][c].type === t.type && grid[r + 2][c].type === t.type) return true;
    }
    return false;
  }
  function swapType(r1, c1, r2, c2) { var a = grid[r1][c1], b = grid[r2][c2], t = a.type; a.type = b.type; b.type = t; }
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
    } while (guard < 40 && (findMatches().hits.length > 0 || !hasMove()));
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) if (grid[r][c]) renderGlyph(grid[r][c]);
  }

  // ===== 손맛 =====
  function spark(t) {
    var cx = xOf(t.c) + tileSize / 2, cy = yOf(t.r) + tileSize / 2;
    for (var i = 0; i < 4; i++) {
      var s = document.createElement('div');
      s.className = 'spark'; s.style.setProperty('--fc', FRUITS[t.type].color);
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
  function updateMoves() {
    movesEl.textContent = Math.max(0, movesLeft);
    movesWrap.classList.toggle('low', movesLeft <= 5);
  }
  function renderMute() {
    muteBtn.innerHTML = '<svg class="ki"><use href="#' + (A.muted ? 'p-speaker-slash' : 'p-speaker-high') + '"/></svg>';
  }

  // ===== 게임 흐름 =====
  function startLevel(L) {
    level = L;
    var spec = levelSpec(L);
    movesLeft = spec.moves;
    goals = spec.goals;
    best = Math.max(best, num(localStorage.getItem(BEST_KEY)));
    if (L > best) { best = L; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {} }  // 도달 레벨 기록
    levelEl.textContent = L;
    if (bestEl) bestEl.textContent = best.toLocaleString();
    updateMoves(); renderGoals();
    sel = null;
    newBoard(); layout();
    busy = false;
  }
  function startGame() {
    score = 0; updateScore();
    playing = true;
    startOv.classList.add('hidden');
    overOv.classList.add('hidden');
    clearOv.classList.add('hidden');
    startLevel(1);
  }
  async function levelClear() {
    playing = false;
    A.win();
    var bonus = movesLeft * 50;
    score += bonus; updateScore();
    clearTitle.textContent = '레벨 ' + level + ' 클리어!';
    clearSub.textContent = bonus > 0 ? ('남은 이동 보너스 +' + bonus.toLocaleString()) : '다음 레벨로!';
    clearOv.classList.remove('hidden');
    await sleep(1300);
    clearOv.classList.add('hidden');
    playing = true;
    startLevel(level + 1);
  }
  function gameOver() {
    playing = false; busy = true;
    if (sel) { sel.el.classList.remove('sel'); sel = null; }
    best = Math.max(best, num(localStorage.getItem(BEST_KEY)));
    var isNew = level > num(localStorage.getItem(BEST_KEY)) || level >= best;
    // best는 이미 startLevel에서 도달 레벨로 기록됨 — 여기선 표시만
    if (level >= best) best = level;
    overLevel.textContent = level;
    overScore.textContent = score.toLocaleString();
    overBest.textContent = best.toLocaleString();
    overNew.style.display = (level >= best) ? 'block' : 'none';
    if (bestEl) bestEl.textContent = best.toLocaleString();
    overOv.classList.remove('hidden');
    if (level >= best) A.record(); else A.bad();
  }

  // ===== 부팅 =====
  best = num(localStorage.getItem(BEST_KEY));
  if (bestEl) bestEl.textContent = best.toLocaleString();
  levelEl.textContent = '1';
  renderMute();
  // 시작 화면 뒤 장식 보드
  goals = [];
  newBoard(); layout();
  window.addEventListener('resize', layout);
  document.addEventListener('pointerdown', function () { A.init(); }, { passive: true });
  muteBtn.addEventListener('click', function () { A.init(); A.setMuted(!A.muted); renderMute(); });
  document.getElementById('btn-start').addEventListener('click', function () { A.init(); startGame(); });
  document.getElementById('btn-again').addEventListener('click', function () { A.init(); startGame(); });
  // 후원 버튼 (포털 공용 모달) — 시작/게임오버 화면에서만, 플레이 중 X.
  // portal.js는 서빙 주입이라 game.js보다 늦게 뜸 → GamePortal 준비를 기다린다.
  // 링크(서버 .env) 없으면 버튼 자체를 숨긴다(기본 숨김).
  function whenPortal(cb, tries) {
    tries = tries || 0;
    if (window.GamePortal && window.GamePortal.openSupport) { cb(); return; }
    if (tries > 25) return;
    setTimeout(function () { whenPortal(cb, tries + 1); }, 100);
  }
  ['btn-support-start', 'btn-support-over'].forEach(function (id) {
    var b = document.getElementById(id);
    if (!b) return;
    b.style.display = 'none';
    b.addEventListener('click', function () {
      if (window.GamePortal && window.GamePortal.openSupport) window.GamePortal.openSupport();
    });
  });
  whenPortal(function () {
    window.GamePortal.supportAvailable(function (ok) {
      if (!ok) return;
      ['btn-support-start', 'btn-support-over'].forEach(function (id) {
        var b = document.getElementById(id); if (b) b.style.display = '';
      });
    });
  });
})();
