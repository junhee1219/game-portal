// 무지개 잇기 — 같은 색 구슬을 선으로 이어 보드를 가득 채우는 Flow 류 퍼즐
// 게임 계약: 레벨 클리어 시 localStorage.setItem('flowBest', String(maxLevel)) (서빙 후킹이 리더보드 캡처)
//            진행 flowLevel(다음 레벨) · 별 flowStars(JSON {level:stars}) · 음소거 flowMuted.
//            portal.js·후원 모달은 서빙이 주입.
(() => {
  'use strict';
  const Core = FlowCore;
  const PAL = Core.PALETTE;

  // ── DOM ──
  const wrap = document.getElementById('wrap');
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const levelEl = document.getElementById('level');
  const bestEl = document.getElementById('best');
  const overEl = document.getElementById('over');
  const hintEl = document.getElementById('hint');
  const undoBtn = document.getElementById('undo');

  // ── 상태 ──
  let W = 360, H = 360, dpr = 1;
  let level = parseInt(localStorage.getItem('flowLevel') || '1', 10) || 1;
  let best = parseInt(localStorage.getItem('flowBest') || '0', 10) || 0;
  let w = 5, h = 5, N = 25, K = 4;
  let cs = 60, ox = 0, oy = 0;
  let cellColor;            // Int16Array(N): -1 빈칸, 아니면 색 인덱스
  let paths;                // [ci] → 그려진 칸 인덱스 배열(시작 구슬에서 출발)
  let connected;            // [ci] → 양 구슬 연결 여부
  let endpointOf;           // {cell → ci}
  let endpoints;            // [ci] → [cellA, cellB]
  let drawing = null;       // {ci}
  let undoStack = [];
  let undosUsed = 0;
  let solved = false;
  let fx = [];              // 이펙트
  let shakeT = 0, shakeMag = 0;
  let popAnim = {};         // cell → 팝 시작시각

  // ── 오디오 (Web Audio 합성) ──
  const Audio = (() => {
    let actx = null, master;
    let muted = localStorage.getItem('flowMuted') === '1';
    function ensure() {
      if (actx) return;
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = muted ? 0 : 1;
      master.connect(actx.destination);
    }
    function init() { ensure(); if (actx.state !== 'running') actx.resume(); }
    function setMuted(m) { muted = m; localStorage.setItem('flowMuted', m ? '1' : '0'); if (actx) master.gain.setTargetAtTime(m ? 0 : 1, actx.currentTime, .02); }
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
      // 칸 진입음 — 경로 길이가 길수록 음이 살짝 올라간다(손맛)
      tick(len) { if (!actx) return; const t = actx.currentTime; const f = 320 * Math.pow(1.04, Math.min(len, 30)); tone(f, t, .05, 'sine', .12); },
      connect() { if (!actx) return; const t = actx.currentTime;[523, 659, 784].forEach((f, i) => tone(f, t + i * .05, .18, 'triangle', .16)); },
      clear() { if (!actx) return; const t = actx.currentTime;[523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * .09, .3, 'triangle', .18)); },
      undo() { if (!actx) return; const t = actx.currentTime; tone(200, t, .1, 'sine', .12); },
      record() { if (!actx) return; const t = actx.currentTime;[784, 988, 1319].forEach((f, i) => tone(f, t + i * .1, .35, 'triangle', .2)); },
    };
  })();
  const vibrate = (p) => { if (!Audio.isMuted() && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} };

  // ── 좌표 ──
  const X = (c) => c % w;
  const Y = (c) => (c - (c % w)) / w;
  const cellCX = (c) => ox + X(c) * cs + cs / 2;
  const cellCY = (c) => oy + Y(c) * cs + cs / 2;
  const isEP = (c) => endpointOf[c] !== undefined;
  function cellAt(px, py) {
    const gx = Math.floor((px - ox) / cs), gy = Math.floor((py - oy) / cs);
    if (gx < 0 || gx >= w || gy < 0 || gy >= h) return -1;
    return gy * w + gx;
  }
  function epOther(ci) { const s = paths[ci][0]; const e = endpoints[ci]; return e[0] === s ? e[1] : e[0]; }

  // ── 레벨 로드 ──
  function loadLevel(lv) {
    const L = Core.genLevel(lv);
    w = L.w; h = L.h; N = w * h; K = L.colors;
    cellColor = new Int16Array(N).fill(-1);
    paths = []; connected = []; endpointOf = {}; endpoints = [];
    for (const p of L.pairs) {
      const a = p.a.y * w + p.a.x, b = p.b.y * w + p.b.x;
      endpointOf[a] = p.ci; endpointOf[b] = p.ci;
      cellColor[a] = p.ci; cellColor[b] = p.ci;   // 구슬 칸은 항상 그 색
      endpoints[p.ci] = [a, b];
      paths[p.ci] = []; connected[p.ci] = false;
    }
    drawing = null; undoStack = []; undosUsed = 0; solved = false;
    fx = []; popAnim = {}; shakeMag = 0;
    levelEl.textContent = lv; bestEl.textContent = best;
    overEl.classList.remove('show');
    hintEl.classList.remove('hide');
    updateUndoBtn();
    layout();
  }

  // ── 레이아웃 ──
  function layout() {
    const r = wrap.getBoundingClientRect();
    W = Math.max(200, Math.round(r.width));
    H = Math.max(200, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = Math.max(10, Math.round(Math.min(W, H) * 0.045));
    cs = Math.floor((Math.min(W, H) - pad * 2) / Math.max(w, h));
    ox = Math.round((W - cs * w) / 2);
    oy = Math.round((H - cs * h) / 2);
    render();
  }

  // ── 색 경로 조작 ──
  function snapshot() {
    return { cc: Int16Array.from(cellColor), pa: paths.map(a => a.slice()), co: connected.slice() };
  }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 80) undoStack.shift(); updateUndoBtn(); }
  function restore(s) { cellColor = Int16Array.from(s.cc); paths = s.pa.map(a => a.slice()); connected = s.co.slice(); }
  function updateUndoBtn() { undoBtn.disabled = undoStack.length === 0; }

  function clearColor(ci) {
    for (const c of paths[ci]) if (!isEP(c)) cellColor[c] = -1;
    paths[ci] = []; connected[ci] = false;
  }
  function truncateTo(ci, cell) { // cell 이후 칸 제거(cell 포함 유지)
    const p = paths[ci]; const idx = p.indexOf(cell);
    if (idx < 0) return;
    for (let i = idx + 1; i < p.length; i++) if (!isEP(p[i])) cellColor[p[i]] = -1;
    p.length = idx + 1; connected[ci] = false;
  }
  function truncateBefore(ci, cell) { // cell 부터 제거(cell 비움)
    const p = paths[ci]; const idx = p.indexOf(cell);
    if (idx < 0) return;
    for (let i = idx; i < p.length; i++) if (!isEP(p[i])) cellColor[p[i]] = -1;
    p.length = idx; connected[ci] = false;
  }

  // head에서 next(인접 칸)로 한 칸 이동. 성공 true.
  function stepTo(ci, next) {
    const p = paths[ci]; const head = p[p.length - 1];
    // 인접성 확인
    const dx = Math.abs(X(next) - X(head)), dy = Math.abs(Y(next) - Y(head));
    if (dx + dy !== 1) return false;
    // 되돌아가기 (직전 칸)
    if (p.length >= 2 && p[p.length - 2] === next) {
      if (!isEP(head)) cellColor[head] = -1;
      p.pop(); connected[ci] = false; return true;
    }
    // 이미 내 경로 안 → 거기까지 자르기
    if (p.indexOf(next) >= 0) { truncateTo(ci, next); return true; }
    // 다른 색 구슬 위 → 금지
    if (isEP(next) && endpointOf[next] !== ci) return false;
    // 다른 색 경로 위 → 그 색을 next에서 끊고 빼앗기
    const occ = cellColor[next];
    if (occ >= 0 && occ !== ci && !isEP(next)) truncateBefore(occ, next);
    // 진입
    cellColor[next] = ci; p.push(next); popAnim[next] = performance.now();
    const reachedOther = (next === epOther(ci));
    connected[ci] = reachedOther;
    if (reachedOther) {
      fx.push({ type: 'ring', x: cellCX(next), y: cellCY(next), ci, t: 0 });
      Audio.connect(); vibrate([0, 14, 26, 14]);
      shake(4);
    } else {
      Audio.tick(p.length);
    }
    return true;
  }

  function startDraw(cell) {
    if (cell < 0) return false;
    let ci = -1;
    if (isEP(cell)) {            // 구슬에서 새로 시작
      ci = endpointOf[cell];
      pushUndo();
      clearColor(ci);
      paths[ci] = [cell]; cellColor[cell] = ci;
    } else if (cellColor[cell] >= 0) {  // 기존 경로 중간에서 이어 그리기
      ci = cellColor[cell];
      pushUndo();
      truncateTo(ci, cell);
    } else return false;
    drawing = { ci };
    hintEl.classList.add('hide');
    Audio.init();
    return true;
  }

  // head에서 target까지 한 칸씩 진행(빠른 드래그 대응)
  function moveToCell(target) {
    if (!drawing || target < 0) return;
    const ci = drawing.ci;
    let steps = 0;
    while (paths[ci][paths[ci].length - 1] !== target && steps < 80) {
      steps++;
      const head = paths[ci][paths[ci].length - 1];
      const dx = X(target) - X(head), dy = Y(target) - Y(head);
      let next;
      if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) next = head + Math.sign(dx);
      else if (dy !== 0) next = head + Math.sign(dy) * w;
      else if (dx !== 0) next = head + Math.sign(dx);
      else break;
      if (!stepTo(ci, next)) break;
    }
  }

  function endDraw() {
    if (!drawing) return;
    drawing = null;
    checkWin();
  }

  function checkWin() {
    if (solved) return;
    for (let ci = 0; ci < K; ci++) {
      const p = paths[ci];
      connected[ci] = p.length >= 2 && isEP(p[0]) && isEP(p[p.length - 1]) && p[0] !== p[p.length - 1];
    }
    let filled = true;
    for (let c = 0; c < N; c++) if (cellColor[c] < 0) { filled = false; break; }
    if (filled && connected.every(Boolean)) onSolved();
  }

  // ── 클리어 ──
  function onSolved() {
    solved = true;
    const stars = undosUsed === 0 ? 3 : (undosUsed <= 2 ? 2 : 1);
    // 별 저장(레벨별 최고)
    let starsMap = {};
    try { starsMap = JSON.parse(localStorage.getItem('flowStars') || '{}') || {}; } catch (e) {}
    if (!starsMap[level] || stars > starsMap[level]) { starsMap[level] = stars; localStorage.setItem('flowStars', JSON.stringify(starsMap)); }
    // 기록
    const isRec = level > best;
    if (isRec) { best = level; localStorage.setItem('flowBest', String(best)); }
    localStorage.setItem('flowLevel', String(level + 1)); // 나가도 다음 레벨부터
    bestEl.textContent = best;

    // 클리어 연출 — 보드 셰이크 + 색종이 + 구슬 펄스
    Audio.clear(); vibrate([0, 30, 50, 30]); shake(8);
    spawnConfetti();

    document.getElementById('over-level').textContent = level;
    const starEls = document.querySelectorAll('#stars .ki');
    starEls.forEach(s => s.classList.remove('on'));
    document.getElementById('over-record').classList.toggle('show', isRec);

    setTimeout(() => {
      overEl.classList.add('show');
      for (let i = 0; i < stars; i++) setTimeout(() => starEls[i].classList.add('on'), 180 + i * 240);
      if (isRec) setTimeout(() => Audio.record(), 180 + stars * 240 + 120);
      // 공유 제안 1회 + 후원은 3레벨마다(피곤하지 않게)
      if (window.GamePortal && GamePortal.shareResult) try { GamePortal.shareResult(); } catch (e) {}
      if (window.GamePortal && level % 3 === 0) setTimeout(() => { try { GamePortal.openSupport(); } catch (e) {} }, 1000);
    }, 560);
  }

  function spawnConfetti() {
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < 36; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      fx.push({
        type: 'confetti', x: cx + (Math.random() - .5) * cs, y: cy + (Math.random() - .5) * cs,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 3,
        rot: Math.random() * 6, vr: (Math.random() - .5) * .4,
        ci: (Math.random() * K) | 0, t: 0, life: 1.1 + Math.random() * .5,
      });
    }
  }
  function shake(mag) { shakeMag = Math.max(shakeMag, mag); shakeT = 0; }

  // ── 렌더 ──
  function rr(x, y, ww, hh, r) {
    r = Math.min(r, ww / 2, hh / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, r);
    ctx.arcTo(x + ww, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + ww, y, r);
    ctx.closePath();
  }

  function render() {
    const now = performance.now();
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shakeMag > 0.3) {
      const ox2 = (Math.random() - .5) * shakeMag, oy2 = (Math.random() - .5) * shakeMag;
      ctx.translate(ox2, oy2);
    }

    // 빈 칸 슬롯(은은한 라운드 사각)
    for (let c = 0; c < N; c++) {
      const x = ox + X(c) * cs, y = oy + Y(c) * cs;
      rr(x + cs * 0.12, y + cs * 0.12, cs * 0.76, cs * 0.76, cs * 0.22);
      ctx.fillStyle = 'rgba(70,84,120,0.05)';
      ctx.fill();
    }

    // 색 경로 리본
    const lw = cs * 0.46;
    for (let ci = 0; ci < K; ci++) {
      const p = paths[ci]; if (p.length < 2) continue;
      const col = PAL[ci % PAL.length];
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      // 본체
      ctx.beginPath();
      ctx.moveTo(cellCX(p[0]), cellCY(p[0]));
      for (let i = 1; i < p.length; i++) ctx.lineTo(cellCX(p[i]), cellCY(p[i]));
      ctx.lineWidth = lw; ctx.strokeStyle = col.base; ctx.stroke();
      // 윗 광택(가는 밝은 심)
      ctx.lineWidth = lw * 0.42; ctx.strokeStyle = col.rim;
      ctx.globalAlpha = 0.55; ctx.stroke(); ctx.globalAlpha = 1;
      // 연결된 경로엔 흐르는 반짝임(주스①)
      if (connected[ci]) {
        ctx.save();
        ctx.lineWidth = lw * 0.28; ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.4;
        ctx.setLineDash([cs * 0.12, cs * 0.7]);
        ctx.lineDashOffset = -(now / 1000 * cs * 1.6) % (cs * 0.82) - ci * 7;
        ctx.beginPath();
        ctx.moveTo(cellCX(p[0]), cellCY(p[0]));
        for (let i = 1; i < p.length; i++) ctx.lineTo(cellCX(p[i]), cellCY(p[i]));
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.setLineDash([]);

    // 칸 진입 팝(주스②) — 새로 채운 칸 살짝 번쩍
    for (const cellStr in popAnim) {
      const t = (now - popAnim[cellStr]) / 220; if (t >= 1) { delete popAnim[cellStr]; continue; }
      const c = +cellStr, k = 1 - t;
      ctx.save();
      ctx.globalAlpha = k * 0.5;
      ctx.fillStyle = '#fff';
      const rad = cs * (0.2 + t * 0.28);
      ctx.beginPath(); ctx.arc(cellCX(c), cellCY(c), rad, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 구슬(글로시 젬)
    for (let ci = 0; ci < K; ci++) {
      if (!endpoints[ci]) continue;
      const col = PAL[ci % PAL.length];
      for (const c of endpoints[ci]) {
        const x = cellCX(c), y = cellCY(c), R = cs * 0.32;
        // 연결되면 외곽 펄스 링
        if (connected[ci]) {
          const pulse = 1 + Math.sin(now / 240 + ci) * 0.06;
          ctx.beginPath(); ctx.arc(x, y, R * 1.28 * pulse, 0, Math.PI * 2);
          ctx.strokeStyle = col.base; ctx.globalAlpha = 0.3; ctx.lineWidth = cs * 0.06; ctx.stroke(); ctx.globalAlpha = 1;
        }
        // 하드 섀도(블러 0) — 바닥에 놓인 사탕
        ctx.beginPath(); ctx.ellipse(x, y + R * 0.62, R * 0.92, R * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(70,84,120,0.18)'; ctx.fill();
        // 본체
        const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.35, R * 0.1, x, y, R);
        g.addColorStop(0, col.rim); g.addColorStop(0.5, col.base); g.addColorStop(1, col.base);
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        // 윗 림 하이라이트(크리스프)
        ctx.beginPath(); ctx.arc(x - R * 0.28, y - R * 0.3, R * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
      }
    }

    // 색종이(주스④)
    for (const f of fx) {
      if (f.type === 'confetti') {
        const col = PAL[f.ci % PAL.length];
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - f.t / f.life);
        ctx.translate(f.x, f.y); ctx.rotate(f.rot);
        ctx.fillStyle = col.base;
        rr(-cs * 0.07, -cs * 0.05, cs * 0.14, cs * 0.1, 2); ctx.fill();
        ctx.restore();
      } else if (f.type === 'ring') {
        const col = PAL[f.ci % PAL.length];
        const pr = f.t / 0.5; if (pr > 1) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - pr);
        ctx.strokeStyle = col.base; ctx.lineWidth = cs * 0.08;
        ctx.beginPath(); ctx.arc(f.x, f.y, cs * (0.3 + pr * 0.5), 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── 루프 ──
  let lastTs = 0;
  function loop(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0; lastTs = ts;
    // 셰이크 감쇠
    if (shakeMag > 0.3) { shakeMag *= Math.pow(0.001, dt); if (shakeMag < 0.3) shakeMag = 0; }
    // fx 물리
    for (const f of fx) {
      f.t += dt;
      if (f.type === 'confetti') { f.vy += 14 * dt; f.x += f.vx; f.y += f.vy; f.rot += f.vr; }
    }
    fx = fx.filter(f => (f.type === 'confetti' ? f.t < f.life : f.t < 0.5));
    render();
    requestAnimationFrame(loop);
  }

  // ── 입력 ──
  let pointing = false;
  function px(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left), y: (e.clientY - r.top) }; }
  cv.addEventListener('pointerdown', (e) => {
    if (solved) return;
    e.preventDefault();
    const p = px(e); const c = cellAt(p.x, p.y);
    if (startDraw(c)) { pointing = true; try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pointing || !drawing) return;
    e.preventDefault();
    const p = px(e); const c = cellAt(p.x, p.y);
    if (c >= 0) moveToCell(c);
  });
  function release() { if (pointing) { pointing = false; endDraw(); } }
  cv.addEventListener('pointerup', (e) => { e.preventDefault(); release(); });
  cv.addEventListener('pointercancel', release);

  // ── 버튼 ──
  undoBtn.addEventListener('click', () => {
    if (undoStack.length === 0 || solved) return;
    restore(undoStack.pop());
    undosUsed++;
    updateUndoBtn();
    Audio.init(); Audio.undo();
  });
  document.getElementById('restart').addEventListener('click', () => { Audio.init(); loadLevel(level); });
  document.getElementById('btn-retry').addEventListener('click', () => { Audio.init(); loadLevel(level); });
  document.getElementById('btn-next').addEventListener('click', () => { Audio.init(); level += 1; loadLevel(level); });
  document.getElementById('btn-share').addEventListener('click', () => { if (window.GamePortal && GamePortal.shareResult) GamePortal.shareResult(); });
  document.getElementById('btn-feedback').addEventListener('click', () => { if (window.GamePortal && GamePortal.openFeedback) GamePortal.openFeedback(); });

  // 음소거
  function refreshMute() { document.getElementById('mute-use').setAttribute('href', Audio.isMuted() ? '#p-speaker-slash' : '#p-speaker-high'); }
  document.getElementById('mute').addEventListener('click', () => {
    Audio.init(); Audio.setMuted(!Audio.isMuted()); refreshMute();
    if (!Audio.isMuted()) Audio.tick(1);
  });

  window.addEventListener('resize', layout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);

  // ── 부팅 ──
  refreshMute();
  loadLevel(level);
  requestAnimationFrame(loop);
})();
