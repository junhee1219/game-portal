// 오순도순 마을 — 코지 타일 배치 (고정 7×7 격자 캔버스)
// 게임 계약: 신기록 시 localStorage.setItem('villageBest', String(score)) → 서빙 후킹이 리더보드 캡처.
//            음소거 villageMuted('1'/'0'). 진행 상태 villageSave(JSON, 로컬 — 같은 기기 이어하기).
//            portal.js·후원·공유는 서빙이 주입. 격자가 다 차면 게임오버 → 행복 점수가 기록.
(function () {
  'use strict';
  var C = window.VillageCore, GRID = C.GRID;
  var KEY = { best: 'villageBest', muted: 'villageMuted', save: 'villageSave' };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ===== 스프라이트 (finda-asset 생성 PNG) =====
  var SPRITE_SRC = { house: 'assets/house.png', forest: 'assets/forest.png', pond: 'assets/pond.png', flower: 'assets/flower.png', field: 'assets/field.png' };
  var ANIMAL_SRC = ['assets/cat.png', 'assets/bunny.png'];
  var sprites = {}, animals = [];
  (function () {
    for (var t in SPRITE_SRC) (function (k, s) { var im = new Image(); im.src = s; im.onload = function () { im._ok = true; }; sprites[k] = im; })(t, SPRITE_SRC[t]);
    ANIMAL_SRC.forEach(function (s) { var im = new Image(); im.src = s; im.onload = function () { im._ok = true; }; animals.push(im); });
  })();

  var GROUND = { house: '#f6ead6', forest: '#d7eccd', pond: '#cfe7f4', flower: '#f4ddec', field: '#f0e6c9' };
  var GROUND_RIM = { house: '#e7d6b8', forest: '#c0e0b3', pond: '#b5d6ea', flower: '#e6c8da', field: '#ddcc9f' };

  // ===== 상태 =====
  var board = new Map();
  var state = { score: 0, residents: 0, over: false, queue: [] };
  var best = parseInt(lsGet(KEY.best) || '0', 10) || 0;
  var hadBest = best;
  var bag = C.makeBag();
  var animalOf = {}, animalSeed = 1;

  function refillQueue() { while (state.queue.length < 4) state.queue.push(bag()); }
  function recomputeScore() {
    var s = 0, res = 0;
    board.forEach(function (t) {
      s += C.tileScore(t.type, C.neighborCounts(board, t.x, t.y));
      t.villager = C.tileIsHome(board, t);
      if (t.villager) res++;
    });
    state.score = s; state.residents = res;
  }

  function newGame() {
    board = new Map();
    state = { score: 0, residents: 0, over: false, queue: [] };
    bag = C.makeBag(); animalOf = {};
    refillQueue();
    fx.length = 0; firstPlaced = false; scoreAnim.from = 0; scoreAnim.t = 1; hideOver();
    layout();
  }

  function serialize() {
    var b = []; board.forEach(function (t) { b.push([t.x, t.y, t.type]); });
    return JSON.stringify({ b: b, q: state.queue, a: animalOf, v: 2 });
  }
  function save() { if (!state.over) lsSet(KEY.save, serialize()); }
  function load() {
    var raw = lsGet(KEY.save); if (!raw) return false;
    try {
      var d = JSON.parse(raw); if (!d || d.v !== 2 || !Array.isArray(d.b) || !d.b.length) return false;
      board = new Map();
      d.b.forEach(function (e) { if (C.inBounds(e[0], e[1])) board.set(C.key(e[0], e[1]), { x: e[0], y: e[1], type: e[2], villager: false }); });
      state.queue = Array.isArray(d.q) ? d.q.slice() : [];
      animalOf = d.a || {};
      recomputeScore(); refillQueue();
      return board.size > 0 && !C.isFull(board);
    } catch (e) { return false; }
  }
  function commitBest() { if (state.score > best) { best = state.score; lsSet(KEY.best, String(best)); } }

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
      place: function (gain) { if (!actx) return; var t = actx.currentTime; var f = 360 + Math.min(gain, 12) * 26; tone(f, t, .09, 'sine', .14); tone(f * 1.5, t + .01, .06, 'triangle', .05); },
      dud: function () { if (!actx) return; var t = actx.currentTime; tone(180, t, .08, 'sine', .08); },
      villager: function () { if (!actx) return; var t = actx.currentTime;[660, 880, 1175].forEach(function (f, i) { tone(f, t + i * .07, .18, 'triangle', .15); }); },
      milestone: function () { if (!actx) return; var t = actx.currentTime;[523, 659, 784, 1047].forEach(function (f, i) { tone(f, t + i * .08, .2, 'triangle', .15); }); },
      over: function () { if (!actx) return; var t = actx.currentTime;[523, 659, 784].forEach(function (f, i) { tone(f, t + i * .1, .24, 'triangle', .13); }); },
      record: function () { if (!actx) return; var t = actx.currentTime;[784, 988, 1319, 1568, 2093].forEach(function (f, i) { tone(f, t + .04 + i * .08, .2, 'triangle', .15); }); }
    };
  })();

  // ===== 캔버스 / 고정 격자 =====
  var cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  var W = 0, H = 0, DPR = 1, cell = 50, gx = 0, gy = 0;
  function layout() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var topPad = 112, botPad = 118;
    var availW = W - 20, availH = H - topPad - botPad;
    cell = Math.floor(Math.min(availW / GRID, availH / GRID));
    cell = Math.max(34, cell);
    var span = cell * GRID;
    gx = Math.round((W - span) / 2);
    gy = Math.round(topPad + (availH - span) / 2);
  }
  window.addEventListener('resize', layout);
  function cellToScreen(x, y) { return { sx: gx + x * cell + cell / 2, sy: gy + y * cell + cell / 2 }; }
  function screenToCell(px, py) { return { x: Math.floor((px - gx) / cell), y: Math.floor((py - gy) / cell) }; }

  // ===== 입력 =====
  var firstPlaced = false;
  cv.addEventListener('pointerdown', function (e) {
    Audio.init();
    if (state.over) return;
    var c = screenToCell(e.clientX, e.clientY);
    if (C.isPlaceable(board, c.x, c.y)) doPlace(c.x, c.y);
    else Audio.dud();
  }, { passive: true });

  function doPlace(x, y) {
    var type = state.queue[0];
    var r = C.place(board, x, y, type);
    state.queue.shift(); refillQueue();
    var oldScore = state.score; state.score += r.gain;
    scoreAnim.from = oldScore; scoreAnim.t = 0;
    var newV = r.newlyHome.length; state.residents += newV;
    firstPlaced = true;
    var p = cellToScreen(x, y);
    spawnPlace(x, y);
    if (r.gain > 0) spawnFloat(p.sx, p.sy - cell * 0.5, '+' + r.gain, '#ff9d2e');
    r.affected.forEach(function (a) { if (!(a.x === x && a.y === y)) pulse(a.x, a.y); });
    Audio.place(r.gain);
    if (newV > 0) {
      r.newlyHome.forEach(function (h) {
        if (animalOf[C.key(h.x, h.y)] == null) animalOf[C.key(h.x, h.y)] = (animalSeed++) % Math.max(1, animals.length);
        spawnVillager(h.x, h.y);
      });
      Audio.villager(); shake(5);
      var hp = cellToScreen(r.newlyHome[0].x, r.newlyHome[0].y);
      spawnFloat(hp.sx, hp.sy - cell * 0.7, '주민 입주!', '#3aa655');
      if (Math.floor(state.residents / 5) > Math.floor((state.residents - newV) / 5)) { showToast('마을 인구 ' + state.residents + '명!'); Audio.milestone(); }
    }
    commitBest(); save();
    if (C.isFull(board)) setTimeout(gameOver, 360);
  }

  // ===== 연출(juice) =====
  var fx = [], scoreAnim = { from: 0, t: 1 }, shakeAmt = 0, placeAnim = {}, villagerHop = {};
  function shake(a) { shakeAmt = Math.max(shakeAmt, a); }
  function spawnPlace(x, y) { placeAnim[C.key(x, y)] = { t: 0 }; }
  function pulse(x, y) { fx.push({ kind: 'pulse', x: x, y: y, t: 0, life: .45 }); }
  function spawnFloat(sx, sy, text, color) { fx.push({ kind: 'float', sx: sx, sy: sy, text: text, color: color, t: 0, life: 1.0 }); }
  function spawnVillager(x, y) { fx.push({ kind: 'ring', x: x, y: y, t: 0, life: .6 }); }

  var toastEl = document.getElementById('toast'), toastTimer = 0;
  function showToast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600); }

  // ===== 게임오버 =====
  function gameOver() {
    state.over = true; lsDel(KEY.save);
    var isRec = state.score > hadBest;
    setTimeout(function () { isRec ? Audio.record() : Audio.over(); }, 100);
    document.getElementById('ov-score').textContent = C.formatNum(state.score);
    document.getElementById('ov-res').textContent = state.residents;
    var rec = document.getElementById('ov-rec');
    if (isRec) { rec.textContent = '새 기록!'; rec.style.display = ''; document.getElementById('ov-best').textContent = ''; hadBest = state.score; }
    else { rec.style.display = 'none'; document.getElementById('ov-best').textContent = '최고 ' + C.formatNum(best); }
    document.getElementById('over').classList.add('show');
  }
  function hideOver() { var o = document.getElementById('over'); if (o) o.classList.remove('show'); }

  // ===== 그리기 =====
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function drawSlots() {
    // 빈 칸: 은은한 슬롯. 첫 수 전엔 전체가 살짝 맥동해 '여기 두세요'를 알린다.
    var hintA = firstPlaced ? 0 : (0.18 + 0.12 * Math.sin(now * 0.004));
    for (var y = 0; y < GRID; y++) for (var x = 0; x < GRID; x++) {
      if (board.has(C.key(x, y))) continue;
      var sz = cell * 0.9, px = gx + x * cell + (cell - sz) / 2, py = gy + y * cell + (cell - sz) / 2, r = sz * 0.22;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.34 + hintA) + ')';
      roundRect(ctx, px, py, sz, sz, r); ctx.fill();
      ctx.strokeStyle = 'rgba(120,150,110,.28)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
      roundRect(ctx, px, py, sz, sz, r); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function drawTile(t, scl) {
    var p = cellToScreen(t.x, t.y), sz = cell * 0.92 * scl, x = p.sx - sz / 2, yy = p.sy - sz / 2, r = sz * 0.2;
    ctx.fillStyle = 'rgba(60,50,30,.16)'; roundRect(ctx, x + 2, yy + sz * 0.1, sz, sz, r); ctx.fill();
    ctx.fillStyle = GROUND[t.type] || '#eee'; roundRect(ctx, x, yy, sz, sz, r); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1, sz * 0.04);
    roundRect(ctx, x + ctx.lineWidth / 2, yy + ctx.lineWidth / 2, sz - ctx.lineWidth, sz * 0.5, r); ctx.stroke();
    ctx.strokeStyle = GROUND_RIM[t.type] || '#ccc'; ctx.lineWidth = Math.max(1, sz * 0.03);
    roundRect(ctx, x, yy, sz, sz, r); ctx.stroke();
    var im = sprites[t.type];
    if (im && im._ok) { var iw = sz * 0.82; ctx.drawImage(im, p.sx - iw / 2, p.sy - iw / 2 - sz * 0.02, iw, iw); }
    else { ctx.fillStyle = GROUND_RIM[t.type]; ctx.beginPath(); ctx.arc(p.sx, p.sy, sz * 0.26, 0, 7); ctx.fill(); }
    if (t.villager) {
      var am = animals[animalOf[C.key(t.x, t.y)] || 0], hop = 0, pa = villagerHop[C.key(t.x, t.y)];
      if (pa != null) hop = Math.abs(Math.sin(pa * Math.PI * 3)) * sz * 0.12 * (1 - pa);
      if (am && am._ok) { var aw = sz * 0.5; ctx.drawImage(am, p.sx + sz * 0.14, p.sy + sz * 0.04 - hop, aw, aw); }
    }
  }

  function drawFx(dt) {
    for (var i = fx.length - 1; i >= 0; i--) {
      var f = fx[i]; f.t += dt; var k = f.t / f.life;
      if (k >= 1) { fx.splice(i, 1); continue; }
      if (f.kind === 'float') {
        ctx.save(); ctx.globalAlpha = 1 - k; ctx.font = '900 ' + (15 + 4 * (1 - k)) + 'px "Pretendard Variable",sans-serif';
        ctx.textAlign = 'center'; ctx.fillStyle = f.color; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)';
        var yy = f.sy - 28 * k; ctx.strokeText(f.text, f.sx, yy); ctx.fillText(f.text, f.sx, yy); ctx.restore();
      } else if (f.kind === 'pulse') {
        var p = cellToScreen(f.x, f.y), sz = cell * (0.92 + 0.18 * k);
        ctx.save(); ctx.globalAlpha = (1 - k) * 0.6; ctx.strokeStyle = '#ffd66e'; ctx.lineWidth = 3;
        roundRect(ctx, p.sx - sz / 2, p.sy - sz / 2, sz, sz, sz * 0.2); ctx.stroke(); ctx.restore();
      } else if (f.kind === 'ring') {
        var pr = cellToScreen(f.x, f.y), rr = cell * (0.4 + 1.0 * k);
        ctx.save(); ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = '#7fd89a'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(pr.sx, pr.sy, rr, 0, 7); ctx.stroke(); ctx.restore();
        villagerHop[C.key(f.x, f.y)] = k;
      }
    }
  }

  // ===== HUD =====
  var elScore = document.getElementById('score'), elRes = document.getElementById('res'),
    elLeft = document.getElementById('tiles'), elTray = document.getElementById('tray'), elHint = document.getElementById('hint');
  function syncHud() {
    scoreAnim.t = Math.min(1, scoreAnim.t + 0.08);
    var shown = Math.round(scoreAnim.from + (state.score - scoreAnim.from) * easeOut(scoreAnim.t));
    elScore.textContent = C.formatNum(shown);
    elRes.textContent = state.residents;
    var left = C.cellsLeft(board); elLeft.textContent = left; elLeft.className = left <= 6 ? 'low' : '';
    var html = '';
    for (var i = 0; i < 3 && i < state.queue.length; i++) {
      var t = state.queue[i];
      html += '<div class="tslot' + (i === 0 ? ' cur' : '') + '" style="--g:' + GROUND[t] + '"><img src="' + SPRITE_SRC[t] + '" alt=""><span class="tname">' + C.NAME[t] + '</span></div>';
    }
    elTray.innerHTML = html;
    elHint.style.opacity = firstPlaced ? 0 : 1;
  }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

  // ===== 루프 =====
  var now = 0, last = 0, trayKey = '';
  function frame(ts) {
    if (!last) last = ts; var dt = Math.min(0.05, (ts - last) / 1000); last = ts; now = ts;
    for (var k in placeAnim) { placeAnim[k].t += dt * 3.2; if (placeAnim[k].t >= 1) delete placeAnim[k]; }
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#eaf6ea'); g.addColorStop(1, '#dceedf');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save();
    if (shakeAmt > 0.2) { ctx.translate((Math.random() - .5) * shakeAmt, (Math.random() - .5) * shakeAmt); shakeAmt *= 0.85; } else shakeAmt = 0;
    drawSlots();
    var arr = []; board.forEach(function (t) { arr.push(t); }); arr.sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i], pa = placeAnim[C.key(t.x, t.y)];
      var scl = pa ? easeOutBack(pa.t) : 1;
      drawTile(t, scl);
    }
    drawFx(dt);
    ctx.restore();
    syncHud();
    requestAnimationFrame(frame);
  }

  // ===== 버튼 / 음소거 =====
  var muteBtn = document.getElementById('mute');
  function syncMute() { muteBtn.innerHTML = '<svg class="ki"><use href="#' + (Audio.isMuted() ? 'p-speaker-slash' : 'p-speaker-high') + '"/></svg>'; }
  muteBtn.addEventListener('click', function () { Audio.init(); Audio.setMuted(!Audio.isMuted()); syncMute(); });
  syncMute();
  document.getElementById('ov-again').addEventListener('click', function () { Audio.init(); newGame(); });

  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  // ===== 시작 =====
  layout();
  if (load()) { firstPlaced = true; scoreAnim.from = state.score; scoreAnim.t = 1; }
  else newGame();
  requestAnimationFrame(frame);
})();
