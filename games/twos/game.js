// 2048 — 보석 진화 퍼즐 (단일 캔버스 렌더 + 풀 주스)
// 메커니즘은 클래식 2048. 로직은 core.js(TwosCore) 무수정 호출. 이 파일은 렌더/애니/이펙트/오디오만.
// 게임 계약: 신기록 시 localStorage.setItem('twosBest', score) (서빙 후킹이 리더보드 캡처)
//            진행 중 보드는 'twosBoard'에 저장 → 이어하기. 음소거 키 'twosMuted'('1'/'0').
(() => {
  'use strict';
  const Core = (typeof TwosCore !== 'undefined') ? TwosCore : null;
  const SIZE = 4;
  const now = () => performance.now();
  const SLIDE = 110;                 // 슬라이드 고정 시간(ms) — 거리 무관, 모든 타일 동시 도착
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───────────────────────── 색 유틸 ─────────────────────────
  function hx(h) { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
  function css(c) { return 'rgb(' + (c.r | 0) + ',' + (c.g | 0) + ',' + (c.b | 0) + ')'; }
  function mix(a, b, t) { return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }; }
  const WHITE = { r: 255, g: 255, b: 255 }, BLACK = { r: 0, g: 0, b: 0 };
  function lighten(c, t) { return mix(c, WHITE, t); }
  function darken(c, t) { return mix(c, BLACK, t); }
  function lum(c) { return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255; }

  // ───────────────────────── 티어(보석) 정의 ─────────────────────────
  // facetN: 컷 면 수 / fc: 면 명도 대비 / sp: sparkle 주기(ms,0=없음) / leak: 재질 누출(px,하드엣지) / spec: 스펙큘러 점
  const TIER = {
    2:    { ko: '조약돌',        base: '#7c8190', rim: '#888d9c', sh: '#6a6f7d', facetN: 0,  fc: 0.02, sp: 0,    leak: 0,   spec: 0 },
    4:    { ko: '부싯돌',        base: '#8a8478', rim: '#969084', sh: '#777166', facetN: 3,  fc: 0.03, sp: 0,    leak: 0,   spec: 0 },
    8:    { ko: '청금석',        base: '#3f6fa8', rim: '#5180b6', sh: '#36608f', facetN: 4,  fc: 0.05, sp: 0,    leak: 0,   spec: 1 },
    16:   { ko: '소달라이트',    base: '#3b86c4', rim: '#4f97d0', sh: '#3274ac', facetN: 6,  fc: 0.06, sp: 5000, leak: 0,   spec: 1 },
    32:   { ko: '페리도트',      base: '#4faa6b', rim: '#62b87c', sh: '#43955c', facetN: 8,  fc: 0.07, sp: 3500, leak: 0,   spec: 1 },
    64:   { ko: '에메랄드',      base: '#2f9d6a', rim: '#45ab7b', sh: '#288759', facetN: 8,  fc: 0.08, sp: 2500, leak: 0,   spec: 1 },
    128:  { ko: '시트린',        base: '#d6a23e', rim: '#e2b257', sh: '#c08e34', facetN: 10, fc: 0.09, sp: 1750, leak: 1,   spec: 2 },
    256:  { ko: '임페리얼 토파즈', base: '#e09433', rim: '#eea64a', sh: '#c87f29', facetN: 12, fc: 0.10, sp: 1200, leak: 1,   spec: 2 },
    512:  { ko: '파드파라샤',    base: '#e07a4e', rim: '#ec8d63', sh: '#c6663d', facetN: 14, fc: 0.11, sp: 800,  leak: 1.5, spec: 2 },
    1024: { ko: '루비',          base: '#cf4f54', rim: '#ffffff', sh: '#b53f44', facetN: 16, fc: 0.12, sp: 420,  leak: 2,   spec: 3 },
    2048: { ko: '다이아몬드',    base: '#eef2f6', rim: '#ffffff', sh: '#c9d2dc', facetN: 16, fc: 0.12, sp: 1,    leak: 2,   spec: 3, diamond: true },
  };
  // 2048 너머: 블랙 다이아 — 색 안 늘리고 '격'으로만 (모듈 상수 1개, 매 프레임 할당 방지)
  const BLACK_DIAMOND = { ko: '블랙 다이아', base: '#2c2e34', rim: '#7e8392', sh: '#1c1e23', facetN: 16, fc: 0.13, sp: 1, leak: 2, spec: 3, diamond: true, black: true };
  // tier별 파생값 사전계산: rgb 파싱 + 숫자 색 판정(핫패스에서 hx/lum 재계산 제거)
  function enrich(t) { t.rgb = hx(t.base); t.textDark = lum(t.rgb) > 0.56; return t; }
  Object.keys(TIER).forEach(k => enrich(TIER[k]));
  enrich(BLACK_DIAMOND);
  function tierFor(v) { return TIER[v] || BLACK_DIAMOND; }
  const PENTA = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 1046.50]; // C4..C6 펜타토닉
  const pentaFor = (v) => PENTA[Math.max(0, Math.min(10, Math.round(Math.log2(v)) - 1))];
  function fontScale(v) { const d = String(v).length; return d <= 2 ? 0.46 : d === 3 ? 0.39 : d === 4 ? 0.31 : 0.25; }

  // ───────────────────────── 이징 ─────────────────────────
  const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
  const easeInOutQuad = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const easeOutBack = (t, s) => { s = s || 1.7; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
  // cubic-bezier(.34,.02,.16,1) 슬라이드 — 손맛용 커스텀
  function bez(t) { const p1 = 0.34, p2 = 0.16; let u = t; for (let i = 0; i < 5; i++) { const x = 3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u; u -= (x - t) / (3 * (1 - u) * (1 - u) * p1 + 6 * (1 - u) * u * (p2 - p1) + 3 * u * u * (1 - p2)); } const v = u; const y1 = 0.02, y2 = 1; return 3 * (1 - v) * (1 - v) * v * y1 + 3 * (1 - v) * v * v * y2 + v * v * v; }

  // ───────────────────────── DOM ─────────────────────────
  const boardEl = document.getElementById('board');
  const cv = document.getElementById('g');
  const ctx = cv.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const bestPill = document.getElementById('best-pill');
  const overEl = document.getElementById('over');
  const hintEl = document.getElementById('hint');

  // ───────────────────────── 오디오 (Web Audio 합성, 버스 구조) ─────────────────────────
  const A = (() => {
    let ac = null, master, comp, busMerge, busUi, busFan;
    let muted = localStorage.getItem('twosMuted') === '1';
    let lastMove = 0, voices = 0;
    function ensure() {
      if (ac) return;
      ac = new (window.AudioContext || window.webkitAudioContext)();
      comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.12;
      master = ac.createGain(); master.gain.value = muted ? 0 : 1;
      comp.connect(master); master.connect(ac.destination);
      busMerge = ac.createGain(); busMerge.gain.value = 0.22;
      busUi = ac.createGain(); busUi.gain.value = 0.08;
      busFan = ac.createGain(); busFan.gain.value = 0.16;
      [busMerge, busUi, busFan].forEach(b => b.connect(comp));
    }
    function init() { ensure(); if (ac.state !== 'running') ac.resume(); }
    function setMuted(m) { muted = m; localStorage.setItem('twosMuted', m ? '1' : '0'); if (ac) master.gain.setTargetAtTime(m ? 0 : 1, ac.currentTime, 0.02); }
    const isMuted = () => muted;
    // 한 음
    function tone(bus, freq, t0, dur, type, peak, opt) {
      if (!ac || muted) return;
      if (voices > 16) return;
      opt = opt || {};
      const o = ac.createOscillator(), g = ac.createGain();
      const det = 1 + (Math.random() - 0.5) * 0.006;          // ±0.3% humanize
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq * det, t0);
      if (opt.slideTo) o.frequency.linearRampToValueAtTime(opt.slideTo * det, t0 + (opt.slideMs || dur) / 1000);
      let node = o;
      if (opt.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opt.lp; o.connect(f); node = f; }
      const a = (opt.atk || 5) / 1000;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      node.connect(g); g.connect(opt.bus || busMerge);
      o.start(t0); o.stop(t0 + dur + 0.03);
      voices++; o.onended = () => { voices--; };
    }
    return {
      init, setMuted, isMuted,
      move() { if (!ac || muted) return; const t = ac.currentTime; if (t - lastMove < 0.08) return; lastMove = t; tone(busUi, 174, t, 0.06, 'triangle', 0.06, { bus: busUi, lp: 1200, atk: 4, slideTo: 150, slideMs: 50 }); },
      merge(v) {
        if (!ac || muted) return; const t = ac.currentTime; const f = pentaFor(v);
        if (v <= 64) { tone(busMerge, f, t, 0.11, 'triangle', 0.16, { atk: 5, lp: 2500 }); tone(busMerge, f * 2, t, 0.09, 'sine', 0.05 * 0.16 / 0.16, { atk: 5 }); }
        else { tone(busMerge, f, t, 0.16, 'triangle', 0.22, { atk: 4, lp: 5000 }); tone(busMerge, f * 2, t, 0.12, 'sine', 0.10, { atk: 4 }); tone(busMerge, f * 3, t, 0.10, 'sine', 0.07, { atk: 4 }); tone(busMerge, 8000, t + 0.04, 0.03, 'sine', 0.04, { atk: 3 }); }
      },
      combo(values) {
        if (!ac || muted) return; const t = ac.currentTime; const vs = values.slice().sort((a, b) => a - b).slice(0, 6);
        vs.forEach((v, i) => tone(busMerge, pentaFor(v), t + i * 0.045, 0.12, 'triangle', 0.16, { atk: 4, lp: 4000 }));
        if (values.length >= 4) tone(busFan, pentaFor(vs[vs.length - 1]) * 2, t + vs.length * 0.045, 0.16, 'sine', 0.10, { bus: busFan, atk: 4 });
      },
      tierUp(v) {
        if (!ac || muted) return; const t = ac.currentTime; const base = pentaFor(v);
        [1, 1.26, 1.5].forEach((m, i) => tone(busFan, base * m, t + i * 0.06, 0.22, 'triangle', 0.14, { bus: busFan, atk: 5 }));
        if (v >= 1024) { tone(busFan, base * 2, t, 0.3, 'sine', 0.08, { bus: busFan, atk: 6 }); tone(busFan, 5000, t + 0.18, 0.2, 'sine', 0.05, { bus: busFan, atk: 4, slideTo: 9000, slideMs: 200 }); }
      },
      record() { if (!ac || muted) return; const t = ac.currentTime; tone(busFan, 783.99, t, 0.22, 'sine', 0.16, { bus: busFan, atk: 5 }); tone(busFan, 1174.66, t + 0.09, 0.28, 'triangle', 0.16, { bus: busFan, atk: 5 }); tone(busFan, 8000, t + 0.12, 0.35, 'sine', 0.05, { bus: busFan, atk: 4, slideTo: 10000, slideMs: 300 }); },
      diamond() {
        if (!ac || muted) return; const t = ac.currentTime;
        tone(busFan, 80, t, 0.08, 'sine', 0.18, { bus: busFan, atk: 3 });
        const run = [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5];
        run.forEach((f, i) => tone(busFan, f, t + 0.1 + i * 0.055, 0.16, 'triangle', 0.13, { bus: busFan, atk: 4 }));
        const tc = t + 0.1 + run.length * 0.055;
        [1046.5, 1318.5, 1568].forEach(f => { tone(busFan, f, tc, 0.6, 'triangle', 0.1, { bus: busFan, atk: 6 }); tone(busFan, f * 2.01, tc, 0.6, 'sine', 0.04, { bus: busFan, atk: 6 }); });
        tone(busFan, 4000, tc, 0.5, 'sine', 0.06, { bus: busFan, atk: 5, slideTo: 12000, slideMs: 500 });
      },
      over() { if (!ac || muted) return; const t = ac.currentTime;[392, 311, 247].forEach((f, i) => tone(busUi, f, t + i * 0.13, 0.3, 'triangle', 0.16, { bus: busUi, atk: 6, lp: i === 2 ? 800 : 4000, slideTo: i === 2 ? 300 : 0, slideMs: 300 })); },
    };
  })();
  const vibrate = (p) => { if (!A.isMuted() && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} };

  // ───────────────────────── 레이아웃 / 보석 스프라이트 캐시 ─────────────────────────
  let W = 0, cell = 80, gap = 12, pad = 12, dpr = 1;
  const spriteCache = new Map();   // value@cellRounded@dpr -> offscreen canvas
  let bgCanvas = null;             // 보드 패널+빈 칸 정적 배경(오프스크린, layout 시 1회 베이킹)

  function layout() {
    W = boardEl.clientWidth;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(W * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gap = Math.max(8, Math.round(W * 0.028));
    pad = gap;
    cell = (W - 2 * pad - (SIZE - 1) * gap) / SIZE;
    spriteCache.clear();
    buildBg();
    // 타일 재배치 — 슬라이드 중이면 목표 좌표를 새 셀 기준으로 보정(리사이즈 도중 어긋남 방지)
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const t = grid[r] && grid[r][c]; if (!t) continue;
      if (t.slide) { t.slide.x1 = cellX(c); t.slide.y1 = cellY(r); } else { t.x = cellX(c); t.y = cellY(r); }
    }
    dead.forEach(t => { if (t.slide) { t.slide.x1 = cellX(t.c); t.slide.y1 = cellY(t.r); } });
  }
  const cellX = (c) => pad + c * (cell + gap);
  const cellY = (r) => pad + r * (cell + gap);

  // 정적 배경(패널 + 16 빈 칸)을 오프스크린에 1회 렌더 → draw에서 drawImage 1번 (프레임당 clip/stroke 80회 제거)
  function buildBg() {
    bgCanvas = document.createElement('canvas');
    bgCanvas.width = cv.width; bgCanvas.height = cv.height;
    const g = bgCanvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    rr(g, 0, 0, W, W, W * 0.045); g.fillStyle = '#191920'; g.fill();
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const x = cellX(c), y = cellY(r);
      rr(g, x, y, cell, cell, cell * 0.18); g.fillStyle = '#22232b'; g.fill();
      g.save(); rr(g, x, y, cell, cell, cell * 0.18); g.clip();
      g.strokeStyle = '#2c2d37'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + cell * 0.18, y + 1); g.lineTo(x + cell - cell * 0.18, y + 1); g.stroke();
      g.strokeStyle = '#101015'; g.beginPath(); g.moveTo(x + cell * 0.18, y + cell - 1); g.lineTo(x + cell - cell * 0.18, y + cell - 1); g.stroke();
      g.restore();
    }
  }

  // 둥근 사각형 path
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // 보석 면 그리기 — (g, 0..S 좌표계). 숫자/스파클/플래시는 라이브(여기 미포함).
  function drawGemFace(g, S, value) {
    const t = tierFor(value), base = t.rgb, rad = S * 0.18;
    g.save();
    rr(g, 0, 0, S, S, rad); g.clip();
    // 베이스 세로 그라데(명도폭 ~12%)
    const topL = t.diamond ? 0.03 : 0.06, botL = t.diamond ? 0.05 : 0.06;
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, css(lighten(base, topL))); grd.addColorStop(1, css(darken(base, botL)));
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    // 컷 면(브릴리언트 팬) — 위 면 밝게/아래 면 어둡게
    const cx = S / 2, cy = S * 0.46, R = S * 0.78, N = t.facetN;
    if (N >= 3) {
      for (let i = 0; i < N; i++) {
        const a0 = -Math.PI / 2 + (i / N) * Math.PI * 2, a1 = -Math.PI / 2 + ((i + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
        const up = -Math.sin(am);                       // 위를 향한 면일수록 +1
        const adj = t.fc * up;
        g.beginPath(); g.moveTo(cx, cy);
        g.lineTo(cx + R * Math.cos(a0), cy + R * Math.sin(a0));
        g.lineTo(cx + R * Math.cos(a1), cy + R * Math.sin(a1));
        g.closePath();
        g.fillStyle = css(adj >= 0 ? lighten(base, adj) : darken(base, -adj));
        g.globalAlpha = 0.6; g.fill(); g.globalAlpha = 1;
      }
      // 테이블(중앙 면) — 살짝 밝게, 보석 read
      g.beginPath(); const tr = S * 0.16;
      g.moveTo(cx, cy - tr); g.lineTo(cx + tr, cy); g.lineTo(cx, cy + tr); g.lineTo(cx - tr, cy); g.closePath();
      g.fillStyle = css(lighten(base, t.fc * 0.9)); g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1;
    }
    // 다이아 모서리 파스텔 분광(하드, 1~2px)
    if (t.diamond && !t.black) {
      const pr = [['#ffd9d9', 0, 0], ['#d9ffe4', S, 0], ['#d9e8ff', 0, S]];
      pr.forEach(p => { g.fillStyle = p[0]; g.globalAlpha = 0.5; g.beginPath(); g.arc(p[1], p[2], S * 0.1, 0, 7); g.fill(); });
      g.globalAlpha = 1;
    }
    // 재질 누출(고티어, 하드엣지 안쪽 림)
    if (t.leak) { g.strokeStyle = css(lighten(base, 0.16)); g.lineWidth = t.leak; g.globalAlpha = 0.7; rr(g, t.leak, t.leak, S - 2 * t.leak, S - 2 * t.leak, rad * 0.8); g.stroke(); g.globalAlpha = 1; }
    g.restore();
    // 크리스프 윗 림 + 좌 림 (클립 안 — 테두리 선명)
    g.save(); rr(g, 0.5, 0.5, S - 1, S - 1, rad); g.clip();
    g.strokeStyle = t.rim; g.lineWidth = t.diamond ? 1.6 : 1.4; g.globalAlpha = t.diamond ? 1 : 0.9;
    g.beginPath(); g.moveTo(rad, 1); g.lineTo(S - rad, 1); g.stroke();
    g.globalAlpha = 0.45; g.beginPath(); g.moveTo(1, rad); g.lineTo(1, S * 0.55); g.stroke();
    // 하단 하드 음영
    g.globalAlpha = 0.5; g.strokeStyle = css(darken(base, 0.14)); g.lineWidth = 2;
    g.beginPath(); g.moveTo(rad, S - 1.5); g.lineTo(S - rad, S - 1.5); g.stroke();
    g.globalAlpha = 1; g.restore();
    // 스펙큘러 점(작고 하드 — gaussian halo 금지)
    if (t.spec) {
      g.fillStyle = 'rgba(255,255,255,' + (t.diamond ? 0.95 : 0.8) + ')';
      g.beginPath(); g.arc(S * 0.30, S * 0.26, S * 0.035, 0, 7); g.fill();
      if (t.spec >= 2) { g.globalAlpha = 0.6; g.beginPath(); g.arc(S * 0.40, S * 0.34, S * 0.018, 0, 7); g.fill(); g.globalAlpha = 1; }
    }
  }

  function sprite(value) {
    const px = Math.round(cell);
    const key = value + '@' + px + 'x' + dpr;
    let s = spriteCache.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = Math.round(px * dpr); s.height = Math.round(px * dpr);
    const g = s.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGemFace(g, px, value);
    spriteCache.set(key, s);
    return s;
  }

  // ───────────────────────── 상태 ─────────────────────────
  let grid = [];                 // SIZE×SIZE
  let dead = [];                 // 슬라이드 중 사라지는 타일
  let score = 0, scoreShown = 0;
  let best = +(localStorage.getItem('twosBest') || 0) || 0;
  let curMax = 0, nextId = 1;
  let animating = false, over = false, queuedDir = null;
  let recordCelebrated = false, startBest = 0;   // startBest = 판 시작 시점 최고기록(라이브 신기록 판정 기준)
  const events = [];             // {at, fn}
  // 이펙트 풀
  let shards = [], rings = [], floats = [], sparks = [];
  let shake = null;              // {amp, ax, ay, start, dur}
  let comboFx = null;            // {text, sub, color, start}
  let signature = null;          // 다이아 시그니처 상태
  let recordToast = null;        // {start}

  function makeTile(r, c, value, kind) {
    const t = { id: nextId++, r, c, value, x: cellX(c), y: cellY(r), nextSp: now() + Math.random() * 2000 };
    if (kind === 'spawn') t.spawn = { start: now() };
    grid[r][c] = t;
    return t;
  }
  function clearGrid() { grid = []; for (let r = 0; r < SIZE; r++) { grid.push([]); for (let c = 0; c < SIZE; c++) grid[r].push(null); } dead = []; }
  function toValues() { return grid.map(row => row.map(t => t ? t.value : 0)); }
  function topGem() { let m = 0; for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const t = grid[r][c]; if (t && t.value > m) m = t.value; } return m; }

  function spawnRandom(kind) {
    const empties = Core.emptyCells(toValues());
    if (!empties.length) return null;
    const [r, c] = empties[(Math.random() * empties.length) | 0];
    return makeTile(r, c, Math.random() < 0.9 ? 2 : 4, kind);
  }

  // ───────────────────────── 새 게임 / 이어하기 / 저장 ─────────────────────────
  function newGame() {
    over = false; animating = false; queuedDir = null; score = 0; scoreShown = 0; curMax = 0; recordCelebrated = false; startBest = best;
    shards = []; rings = []; floats = []; sparks = []; shake = null; comboFx = null; signature = null; recordToast = null;
    events.length = 0;
    overEl.classList.remove('show');
    clearGrid(); layout();
    spawnRandom('spawn'); spawnRandom('spawn');
    curMax = topGem();
    updateHud(true);
    hintEl.classList.remove('hide');
    save(); kick();
  }
  function restore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem('twosBoard') || 'null'); } catch (e) {}
    if (!data || !Array.isArray(data.grid) || data.grid.length !== SIZE) { newGame(); return; }
    over = false; animating = false; queuedDir = null;
    clearGrid(); layout();
    let any = false;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const v = data.grid[r] && data.grid[r][c]; if (v) { makeTile(r, c, v); any = true; } }
    if (!any) { newGame(); return; }
    score = +data.score || 0; scoreShown = score; curMax = topGem();
    startBest = best; recordCelebrated = false;
    hintEl.classList.add('hide'); updateHud(true);
    if (!Core.hasMoves(toValues())) setTimeout(endGame, 300);
    kick();
  }
  function save() { try { localStorage.setItem('twosBoard', JSON.stringify({ grid: toValues(), score })); } catch (e) {} }

  function updateHud(instant) {
    if (instant) { scoreShown = score; scoreEl.textContent = score; }
    bestEl.textContent = best;
  }

  // ───────────────────────── 이동 ─────────────────────────
  function applyMove(dir) {
    if (over) return;
    if (animating) { queuedDir = dir; return; }
    const ls = Core.lines(SIZE, dir);
    const actions = []; let gained = 0, moved = false;
    for (const coords of ls) {
      const vals = coords.map(rc => { const t = grid[rc[0]][rc[1]]; return t ? t.value : 0; });
      const res = Core.slideIndices(vals);
      gained += res.gained; if (res.moved) moved = true;
      for (const mv of res.moves) {
        const from = coords[mv.from], to = coords[mv.to];
        const tile = grid[from[0]][from[1]]; if (!tile) continue;
        actions.push({ tile, toR: to[0], toC: to[1], dead: mv.merged && !mv.survivor, merged: mv.merged && mv.survivor, newValue: res.result[mv.to] });
      }
    }
    if (!moved) return;

    animating = true; hintEl.classList.add('hide'); A.init(); A.move();
    const t0 = now();
    // 슬라이드 셋업 + 새 grid 구성
    const ng = []; for (let r = 0; r < SIZE; r++) { ng.push([]); for (let c = 0; c < SIZE; c++) ng[r].push(null); }
    dead = [];
    for (const a of actions) {
      const t = a.tile;
      t.slide = { x0: t.x, y0: t.y, x1: cellX(a.toC), y1: cellY(a.toR), start: t0 };
      t.r = a.toR; t.c = a.toC;
      if (a.dead) { dead.push(t); }
      else { if (a.merged) { t.pendValue = a.newValue; } ng[a.toR][a.toC] = t; }
    }
    grid = ng;

    score += gained;
    if (score > best) { best = score; try { localStorage.setItem('twosBest', String(best)); } catch (e) {} }

    schedule(t0 + SLIDE, () => resolveMove(actions, gained));
    kick();
  }

  function resolveMove(actions, gained) {
    try {
      // 슬라이드 종료 — 값 확정. 위치는 항상 현재 셀 기준 cellX/cellY로(리사이즈 도중에도 정합, slide null 역참조 방지)
      dead = [];
      const merges = actions.filter(a => a.merged);
      const prevMax = curMax;
      merges.forEach(a => { a.tile.value = a.tile.pendValue; a.tile.pendValue = null; a.tile.x = cellX(a.toC); a.tile.y = cellY(a.toR); a.tile.slide = null; });
      actions.forEach(a => { if (!a.merged) { a.tile.x = cellX(a.toC); a.tile.y = cellY(a.toR); a.tile.slide = null; } });

      const mx = topGem();
      const diamond = merges.some(a => a.newValue === 2048) && prevMax < 2048;
      const mergedCount = merges.length;
      const tierUps = merges.filter(a => a.newValue > prevMax && a.newValue >= 128);
      curMax = Math.max(curMax, mx);

      // 셰이크 에너지
      let E = 0; merges.forEach(a => E += Math.log2(a.newValue));

      if (diamond) {
        startDiamond(merges.find(a => a.newValue === 2048).tile, merges);
      } else if (mergedCount >= 2) {
        // 콤보: 개별 음/플로팅 끔 → 아르페지오 + stagger pop + +TOTAL
        const ordered = merges.slice().sort((a, b) => (a.tile.r - b.tile.r) || (a.tile.c - b.tile.c));
        ordered.forEach((a, i) => { popTile(a.tile, i * 45); spawnShards(a.tile, true); });
        A.combo(merges.map(a => a.newValue));
        const mult = mergedCount === 2 ? 1.4 : mergedCount === 3 ? 1.6 : 1.9;
        const topColor = tierFor(Math.max.apply(null, merges.map(a => a.newValue)));
        comboFx = { text: '+' + gained, sub: mergedCount >= 3 ? '체인 ×' + mergedCount : '', mult, color: topColor.rim, start: now() };
        tierUps.forEach(a => { ring(a.tile, topColor.rim); a.tile.sweep = { start: now() }; });
        doShake(Math.min(6, E >= 15 ? 6 : E >= 8 ? 4 : 3), null, true);
        vibrate(mergedCount >= 3 ? [0, 14, 30, 14] : 12);
      } else if (mergedCount === 1) {
        const a = merges[0];
        popTile(a.tile, 0); flash(a.tile); spawnShards(a.tile, false);
        A.merge(a.newValue);
        if (tierUps.length) {
          a.tile.sweep = { start: now() }; ring(a.tile, tierFor(a.newValue).rim);
          A.tierUp(a.newValue); doShake(E >= 8 ? 4 : 3, a, false); vibrate([0, 10, 20, 18]);
          floatText('+' + gained, a.tile, tierFor(a.newValue).rim, 1.0);
        } else { vibrate(10); }
      }

      // 신기록 라이브 — 판 시작 기록(startBest)을 처음 넘어설 때만 1회. 깰 기록이 없던 신규 유저 첫 점수엔 안 띄움.
      if (!recordCelebrated && gained > 0 && startBest > 0 && score > startBest) {
        recordCelebrated = true;
        bestPill.classList.add('pulse'); setTimeout(() => bestPill.classList.remove('pulse'), 460);
        const anchor = merges[0] ? merges[0].tile : null;
        // 콤보(≥2)면 중앙 +TOTAL이 이미 떠 있으므로 골드 플로팅 중복 억제 — 링/펄스/토스트로만 신기록 신호
        if (anchor) { ring(anchor, '#e7b24b'); if (mergedCount < 2) floatText('+' + gained, anchor, '#e7b24b', 1.3); }
        if (!diamond) A.record();
        doShake(diamond ? 6 : 4, anchor, true);
        // 콤보와 동시면 +TOTAL이 페이드 시작한 뒤 토스트가 뜨게 살짝 지연(과밀 방지)
        const toastDelay = mergedCount >= 2 ? 280 : 0;
        schedule(now() + toastDelay, () => { recordToast = { start: now() }; });
      }

      updateHud(false); save();

      if (diamond) {
        // 다이아 시그니처: 입력 0.9s 잠금(spec) → 그 시점에 스폰 + 게임오버 체크
        schedule(now() + 900, () => {
          try { if (!over) { spawnRandom('spawn'); updateHud(false); save(); } }
          finally { animating = false; }
          if (!over && !Core.hasMoves(toValues())) schedule(now() + 900, endGame);
          else if (queuedDir) { const d = queuedDir; queuedDir = null; applyMove(d); }
        });
      } else {
        // 스폰 (로직상 즉시 존재 → 다음 입력 정합성 보장. 시각 드롭만 애니)
        spawnRandom('spawn'); save();
        animating = false;
        if (!Core.hasMoves(toValues())) schedule(now() + (recordToast ? 700 : 360), endGame);
        else if (queuedDir) { const d = queuedDir; queuedDir = null; applyMove(d); }
      }
    } catch (err) {
      // 안전망: 어떤 예외에도 입력이 영구 잠기지 않도록 강제 복구
      try {
        actions.forEach(a => {
          if (a && a.tile) { if (a.merged && a.tile.pendValue) { a.tile.value = a.tile.pendValue; a.tile.pendValue = null; } a.tile.slide = null; a.tile.x = cellX(a.toC); a.tile.y = cellY(a.toR); }
        });
        dead = [];
        if (Core.emptyCells(toValues()).length) spawnRandom('spawn');
        curMax = Math.max(curMax, topGem()); updateHud(false); save();
      } catch (_) {}
      animating = false;
      if (queuedDir) { const d = queuedDir; queuedDir = null; applyMove(d); }
      kick();
    }
  }

  // ───────────────────────── 이펙트 ─────────────────────────
  function popTile(t, delay) { t.pop = { start: now() + delay }; }
  function flash(t) { t.flash = { start: now() }; }
  function doShake(amp, anchor, iso) {
    if (reduceMotion) return;
    const k = iso ? 1 : 0.85;   // iso=등방성(콤보) / 아니면 약한 단일축 느낌
    shake = { amp, ax: k, ay: k, start: now(), dur: 140 };
  }
  function ring(t, color) { rings.push({ x: t.x + cell / 2, y: t.y + cell / 2, color, start: now(), dur: 240 }); if (t.value >= 256) rings.push({ x: t.x + cell / 2, y: t.y + cell / 2, color, start: now() + 50, dur: 240, a: 0.6 }); }
  function spawnShards(t, combo) {
    if (reduceMotion) return;
    const v = t.value; const tr = tierFor(v); const base = tr.rgb;
    const n = v <= 16 ? 5 : v <= 128 ? 6 : v <= 1024 ? 7 : 8;
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.9) + (Math.random() < 0.5 ? 0 : Math.PI);
      const sp = (90 + Math.random() * 170) * (cell / 90);
      shards.push({ x: t.x + cell / 2, y: t.y + cell / 2, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40, rot: Math.random() * 7, vr: (Math.random() - 0.5) * 12, size: cell * (0.10 + Math.random() * 0.08), col: Math.random() < 0.5 ? css(base) : css(lighten(base, 0.18)), sides: 3 + (Math.random() * 2 | 0), start: now(), dur: 260 + Math.random() * 200 });
    }
    if (shards.length > 120) shards.splice(0, shards.length - 120);
  }
  function floatText(text, t, color, scale) { floats.push({ text, x: t.x + cell / 2, y: t.y + cell / 2, color, scale: scale || 1, start: now(), dur: 640 }); }
  function schedule(at, fn) { events.push({ at, fn }); }

  function startDiamond(dt, merges) {
    popTile(dt, 0); flash(dt); spawnShards(dt, false);
    doShake(6, dt, true); vibrate([0, 30, 40, 30, 40, 60]); A.diamond();
    dt.sparkle = true; // 영구 회전 sparkle
    signature = { tile: dt, start: now() };
    schedule(now() + 900, () => { signature && (signature.showText = true); });
  }

  // ───────────────────────── 렌더 ─────────────────────────
  function poly(g, cx, cy, r, sides, rot) { g.beginPath(); for (let i = 0; i < sides; i++) { const a = rot + i / sides * Math.PI * 2; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); }
  function star4(g, cx, cy, r, rot, alpha) { g.save(); g.translate(cx, cy); g.rotate(rot); g.globalAlpha = alpha; g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const rr2 = i % 2 ? r * 0.28 : r; g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); } g.closePath(); g.fill(); g.restore(); g.globalAlpha = 1; }

  function tileScale(t, T) {
    // squash&stretch / spawn / signature 부풀기 → {sx, sy, scale}
    let sx = 1, sy = 1, sc = 1;
    if (t.spawn) {
      const e = (T - t.spawn.start); if (e >= 190) t.spawn = null;
      else { const p = clamp01(e / 190); sc = easeOutBack(p, 1.7) * 1.0; if (sc > 1.08) sc = 1.08 - (sc - 1.08); }
    }
    if (t.pop) {
      const e = T - t.pop.start;
      if (e < 0) { } else if (e > 200) t.pop = null;
      else if (e < 40) { const p = easeOutQuad(e / 40); sx = 1 + 0.18 * p; sy = 1 - 0.16 * p; }
      else if (e < 110) { const p = easeOutBack((e - 40) / 70); sx = 1.18 + (0.93 - 1.18) * p; sy = 0.84 + (1.10 - 0.84) * p; }
      else { const p = easeOutQuad((e - 110) / 90); sx = 0.93 + (1 - 0.93) * p; sy = 1.10 + (1 - 1.10) * p; }
    }
    if (signature && signature.tile === t) { const e = T - signature.start; if (e < 700) { const p = easeOutCubic(clamp01(e / 520)); sc *= 1 + 0.35 * p; } else sc *= 1.35; }
    return { sx: sx * sc, sy: sy * sc };
  }

  function drawTile(t, T) {
    if (t.slide) { const p = clamp01((T - t.slide.start) / SLIDE); const e = bez(p); t.x = t.slide.x0 + (t.slide.x1 - t.slide.x0) * e; t.y = t.slide.y0 + (t.slide.y1 - t.slide.y0) * e; }
    const s = tileScale(t, T);
    let alpha = 1;
    if (t.spawn) alpha = clamp01((T - t.spawn.start) / 90);
    // 시그니처: 다이아 외 타일 채도 죽임
    let desat = 0;
    if (signature) { const e = T - signature.start; if (signature.tile !== t) { if (e < 180) desat = 0; else if (e < 520) desat = (e - 180) / 340 * 0.4; else if (e < 920) desat = 0.4 - (e - 520) / 400 * 0.4; } }
    const cx = t.x + cell / 2, cy = t.y + cell / 2;
    let dropY = 0; if (t.spawn) dropY = -(1 - clamp01((T - t.spawn.start) / 190)) * cell * 0.12;
    ctx.save();
    ctx.globalAlpha = alpha;
    // 하드 섀도 (블러0)
    const sw = cell * s.sx, sh = cell * s.sy;
    rr(ctx, cx - sw / 2, cy - sh / 2 + dropY + 3, sw, sh, cell * 0.18);
    ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fill();
    // 보석
    ctx.translate(cx, cy + dropY); ctx.scale(s.sx, s.sy);
    if (desat > 0) ctx.globalAlpha = alpha * (1 - desat * 0.55);
    ctx.drawImage(sprite(t.value), -cell / 2, -cell / 2, cell, cell);
    // 머지 플래시 (실루엣 안 additive)
    if (t.flash) { const e = T - t.flash.start; if (e > 130) t.flash = null; else { rr(ctx, -cell / 2, -cell / 2, cell, cell, cell * 0.18); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,255,255,' + (0.3 * (1 - e / 90)).toFixed(3) + ')'; if (e < 90) ctx.fill(); ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * (1 - e / 130)).toFixed(3) + ')'; ctx.lineWidth = 2; rr(ctx, -cell / 2 + 3, -cell / 2 + 3, cell - 6, cell - 6, cell * 0.15); ctx.stroke(); } }
    // 티어업 스펙큘러 스윕
    if (t.sweep) { const e = T - t.sweep.start; if (e > 220) t.sweep = null; else { const p = easeInOutQuad(e / 220); ctx.save(); rr(ctx, -cell / 2, -cell / 2, cell, cell, cell * 0.18); ctx.clip(); const gx = -cell / 2 + p * cell; const gd = ctx.createLinearGradient(gx - cell * 0.2, 0, gx + cell * 0.2, 0); gd.addColorStop(0, 'rgba(255,255,255,0)'); gd.addColorStop(0.5, 'rgba(255,255,255,.5)'); gd.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gd; ctx.fillRect(-cell / 2, -cell / 2, cell, cell); ctx.restore(); } }
    ctx.restore();
    const tr = tierFor(t.value);
    // sparkle (고티어) — 숫자보다 먼저 그려 숫자가 항상 위 레이어 (판독성 1순위)
    drawSparkle(t, T, cx, cy + dropY);
    // 숫자 (라이브 — 스쿼시 따라감)
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy + dropY); ctx.scale(s.sx, s.sy);
    ctx.font = '800 ' + Math.round(cell * fontScale(t.value)) + 'px "Pretendard Variable",-apple-system,sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, cell * 0.07);
    ctx.strokeStyle = tr.textDark ? 'rgba(255,255,255,.7)' : 'rgba(20,24,38,.72)';
    ctx.strokeText(String(t.value), 0, cell * 0.02);
    ctx.fillStyle = tr.textDark ? '#262b38' : '#fff';
    ctx.fillText(String(t.value), 0, cell * 0.02);
    ctx.restore();
  }

  function drawSparkle(t, T, cx, cy) {
    const tr = tierFor(t.value);
    if (tr.diamond || t.sparkle) {
      // 영구 회전 별 — 숫자 글리프 밖(코너)으로 밀어 판독성 보호
      const rot = T / 1400;
      star4(ctx, cx + cell * 0.34, cy - cell * 0.34, cell * 0.10, rot, 0.85);
      star4(ctx, cx - cell * 0.33, cy + cell * 0.30, cell * 0.05, -rot * 1.3, 0.55);
      return;
    }
    if (!tr.sp) return;
    if (T >= t.nextSp) { t.spStart = T; t.spX = (Math.random() - 0.5) * cell * 0.5; t.spY = -cell * 0.2 + (Math.random() - 0.5) * cell * 0.3; t.nextSp = T + tr.sp * (0.6 + Math.random() * 0.6); }
    if (t.spStart != null) { const e = T - t.spStart; if (e < 360) { const a = Math.sin(e / 360 * Math.PI) * 0.85; star4(ctx, cx + t.spX, cy + t.spY, cell * 0.07, e / 200, a); } }
  }

  function draw(T) {
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    // 셰이크
    if (shake) { const e = T - shake.start; if (e > shake.dur) shake = null; else { const k = 1 - e / shake.dur; const off = shake.amp * k * Math.sin(e / shake.dur * Math.PI * 3); ctx.translate(off * shake.ax, off * 0.5 * shake.ay); } }
    // 보드 패널 + 빈 칸 (오프스크린 베이킹 1장 — 셰이크 translate 영향 받음)
    if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, W, W);
    // 파편 (보석 뒤)
    shards.forEach(p => { const e = T - p.start; const k = clamp01(e / p.dur); ctx.save(); ctx.globalAlpha = (1 - k) * (k > 0.6 ? (1 - (k - 0.6) / 0.4) : 1); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; const sz = p.size * (k > 0.7 ? 0.7 + 0.3 * (1 - (k - 0.7) / 0.3) : 1); poly(ctx, 0, 0, sz, p.sides, 0); ctx.fill(); ctx.restore(); });
    ctx.globalAlpha = 1;
    // 슬라이드 중인 죽는 타일 (보석 아래로 먼저)
    dead.forEach(t => drawTile(t, T));
    // 타일
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const t = grid[r][c]; if (t) drawTile(t, T); }
    // 충격파 링 (하드엣지)
    rings.forEach(p => { const e = T - p.start; if (e < 0) return; const k = clamp01(e / p.dur); ctx.globalAlpha = (p.a || 1) * 0.45 * (1 - k); ctx.strokeStyle = p.color; ctx.lineWidth = 2.5 - 1.5 * k; ctx.beginPath(); ctx.arc(p.x, p.y, cell * (0.2 + 1.4 * easeOutCubic(k)), 0, 7); ctx.stroke(); });
    ctx.globalAlpha = 1;
    // 플로팅 텍스트
    floats.forEach(p => { const e = T - p.start; const k = clamp01(e / p.dur); const yy = p.y - easeOutCubic(k) * cell * 0.9; const sc = clamp01(e / 90) * (0.6 + 0.4); ctx.save(); ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1; ctx.font = '800 ' + Math.round(cell * 0.34 * (p.scale)) + 'px "Pretendard Variable",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(20,23,35,.6)'; ctx.strokeText(p.text, p.x, yy); ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, yy); ctx.restore(); });
    ctx.restore(); // 셰이크 해제

    // 콤보 텍스트 (보드 중앙, 셰이크 영향 X)
    if (comboFx) { const e = T - comboFx.start; if (e > 760) comboFx = null; else { const p = clamp01(e / 120); const fade = e > 560 ? 1 - (e - 560) / 200 : 1; ctx.save(); ctx.globalAlpha = fade; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const sc = easeOutBack(p) * comboFx.mult; ctx.font = '900 ' + Math.round(cell * 0.5 * sc) + 'px "Pretendard Variable",sans-serif'; ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(16,16,20,.7)'; ctx.strokeText(comboFx.text, W / 2, W * 0.42); ctx.fillStyle = comboFx.color; ctx.fillText(comboFx.text, W / 2, W * 0.42); if (comboFx.sub) { ctx.font = '800 ' + Math.round(cell * 0.28) + 'px "Pretendard Variable",sans-serif'; ctx.strokeText(comboFx.sub, W / 2, W * 0.42 + cell * 0.42); ctx.fillText(comboFx.sub, W / 2, W * 0.42 + cell * 0.42); } ctx.restore(); } }
    // 신기록 마이크로 토스트
    if (recordToast) { const e = T - recordToast.start; if (e > 900) recordToast = null; else { const p = clamp01(e / 100); const fade = e > 650 ? 1 - (e - 650) / 250 : 1; ctx.save(); ctx.globalAlpha = fade; ctx.textAlign = 'center'; ctx.font = '800 ' + Math.round(cell * 0.26) + 'px "Pretendard Variable",sans-serif'; ctx.fillStyle = '#e7b24b'; ctx.fillText('신기록 갱신', W / 2, W * 0.14 * p); ctx.restore(); } }
    // 다이아 시그니처 한 줄
    if (signature && signature.showText) { const e = T - signature.start - 900; const a = clamp01(e / 900); ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 ' + Math.round(cell * 0.34) + 'px "Pretendard Variable",sans-serif'; ctx.fillStyle = '#eef2f6'; ctx.fillText('다이아몬드', W / 2, W * 0.5); ctx.font = '700 ' + Math.round(cell * 0.2) + 'px "Pretendard Variable",sans-serif'; ctx.fillStyle = '#c9d2dc'; ctx.fillText('여기까지 온 사람은 드뭅니다', W / 2, W * 0.5 + cell * 0.4); ctx.restore(); if (e > 2000) signature = null; }
  }

  // ───────────────────────── 업데이트 루프 ─────────────────────────
  let raf = 0, idleTimer = 0, lastT = 0, looping = false;
  // 진짜 애니메이션(60fps 필요) — slide/pop/particle/score 카운트업 등
  function anim(T) {
    if (animating || events.length || shards.length || rings.length || floats.length || shake || comboFx || recordToast || signature) return true;
    if (scoreShown !== score) return true;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const t = grid[r][c]; if (t && (t.pop || t.spawn || t.slide || t.flash || t.sweep)) return true; }
    return false;
  }
  // 앰비언트 sparkle만 살아있는 idle — 저빈도 재그리기로 충분(배터리 보호). reduce-motion이면 완전 정지.
  function sparkleAlive() {
    if (reduceMotion) return false;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) { const t = grid[r][c]; if (t && (t.sparkle || tierFor(t.value).sp)) return true; }
    return false;
  }
  function compact(arr, T, extra) { let j = 0; for (let i = 0; i < arr.length; i++) { if (T - arr[i].start < arr[i].dur + (extra || 0)) arr[j++] = arr[i]; } arr.length = j; }
  function frame() {
    looping = false; raf = 0; idleTimer = 0;
    const T = now();
    for (let i = 0; i < events.length; i++) { if (T >= events[i].at) { const fn = events[i].fn; events.splice(i, 1); i--; fn(); } }
    const dt = Math.min(40, T - lastT); lastT = T;
    if (shards.length) { const f = dt / 1000; for (let i = 0; i < shards.length; i++) { const p = shards[i]; p.x += p.vx * f; p.y += p.vy * f; p.vy += 1400 * f; p.vx *= 0.9; p.vy *= 0.9; p.rot += p.vr * f; } compact(shards, T); }
    if (rings.length) compact(rings, T, 60);
    if (floats.length) compact(floats, T);
    if (scoreShown !== score) { const d = score - scoreShown; scoreShown += Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * 0.18)); if ((d > 0 && scoreShown > score) || (d < 0 && scoreShown < score)) scoreShown = score; scoreEl.textContent = scoreShown; }
    draw(T);
    ensureLoop(T);
  }
  // 멱등 루프 재무장 — 진짜 애니면 60fps rAF, 앰비언트 sparkle뿐이면 ~9fps, 둘 다 아니면 park.
  // looping 플래그로 재진입(이벤트 fn 안 kick) 시 체인 중복 생성 방지.
  function ensureLoop(T) {
    if (looping) return;
    T = T || now();
    if (anim(T)) { looping = true; raf = requestAnimationFrame(frame); }
    else if (sparkleAlive()) { looping = true; idleTimer = setTimeout(frame, 110); }
  }
  function kick() { ensureLoop(); }
  function stopLoop() { looping = false; if (raf) cancelAnimationFrame(raf); if (idleTimer) clearTimeout(idleTimer); raf = 0; idleTimer = 0; }

  // ───────────────────────── 게임오버 ─────────────────────────
  function endGame() {
    if (over) return; over = true;
    const mx = topGem(); const tr = tierFor(mx);
    if (score > best) { best = score; try { localStorage.setItem('twosBest', String(best)); } catch (e) {} }
    const isRec = score >= best && score > 0;
    if (!recordCelebrated || !isRec) A.over();
    vibrate([0, 40, 60, 40]);
    // 최고 보석 렌더
    const og = document.getElementById('over-gem'); const ogc = og.getContext('2d'); const OS = og.width;
    ogc.clearRect(0, 0, OS, OS); ogc.save(); ogc.translate(OS * 0.08, OS * 0.08);
    drawGemFace(ogc, OS * 0.84, mx);
    ogc.font = '800 ' + Math.round(OS * 0.84 * fontScale(mx)) + 'px "Pretendard Variable",sans-serif'; ogc.textAlign = 'center'; ogc.textBaseline = 'middle';
    const td = tr.textDark; ogc.lineJoin = 'round'; ogc.lineWidth = OS * 0.04;
    ogc.strokeStyle = td ? 'rgba(255,255,255,.55)' : 'rgba(24,28,44,.5)'; ogc.strokeText(String(mx), OS * 0.42, OS * 0.44);
    ogc.fillStyle = td ? '#262b38' : '#fff'; ogc.fillText(String(mx), OS * 0.42, OS * 0.44); ogc.restore();
    document.getElementById('over-gem-name').textContent = tr.ko + ' · 최고 ' + mx;
    const sc = document.getElementById('over-score'); sc.textContent = score; sc.classList.toggle('rec', isRec);
    document.getElementById('over-record').classList.toggle('show', isRec);
    document.getElementById('over-sub').textContent = isRec ? '나의 새 최고 기록!' : '최고 ' + best + '점';
    try { localStorage.removeItem('twosBoard'); } catch (e) {}
    setTimeout(() => { overEl.classList.add('show'); try { document.getElementById('btn-again').focus(); } catch (e) {} }, 360);
    if (window.GamePortal && GamePortal.shareResult) GamePortal.shareResult();
  }

  // ───────────────────────── 입력 ─────────────────────────
  let sx = 0, sy = 0, st = 0, swiping = false, axis = null;
  boardEl.addEventListener('pointerdown', (e) => { if (over) return; swiping = true; axis = null; sx = e.clientX; sy = e.clientY; st = now(); A.init(); });
  boardEl.addEventListener('pointermove', (e) => { if (!swiping || axis) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) > 8 || Math.abs(dy) > 8) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; });
  function endSwipe(e) {
    if (!swiping) return; swiping = false;
    const dx = e.clientX - sx, dy = e.clientY - sy; const ax = Math.abs(dx), ay = Math.abs(dy);
    const dtm = now() - st; const vel = Math.max(ax, ay) / Math.max(1, dtm);
    const a = axis || (ax > ay ? 'x' : 'y');
    const TH = a === 'x' ? 14 : 20; const dist = a === 'x' ? ax : ay;
    if (dist < TH && vel < 0.5) return;
    if (a === 'x') applyMove(dx > 0 ? 'right' : 'left'); else applyMove(dy > 0 ? 'down' : 'up');
  }
  boardEl.addEventListener('pointerup', endSwipe);
  boardEl.addEventListener('pointercancel', () => { swiping = false; });
  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
  window.addEventListener('keydown', (e) => {
    if (over) { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); A.init(); newGame(); } return; }
    const dir = KEYS[e.key]; if (dir) { e.preventDefault(); A.init(); applyMove(dir); }
  });

  // ───────────────────────── 버튼 / 음소거 / 리사이즈 ─────────────────────────
  function refreshMute() { const m = A.isMuted(); const btn = document.getElementById('mute'); document.getElementById('mute-use').setAttribute('href', m ? '#p-speaker-slash' : '#p-speaker-high'); btn.style.color = m ? '' : 'var(--ink)'; btn.setAttribute('aria-pressed', m ? 'true' : 'false'); }
  document.getElementById('mute').addEventListener('click', () => { A.init(); A.setMuted(!A.isMuted()); refreshMute(); if (!A.isMuted()) A.move(); });
  document.getElementById('btn-again').addEventListener('click', () => { A.init(); newGame(); });
  document.getElementById('btn-support').addEventListener('click', () => { if (window.GamePortal) GamePortal.openSupport(); });
  // 공유는 포털 공용 계약에 위임 — 신기록 시 portal.js가 결과 share_url로 공유 제안(shareResult, endGame에서 호출). 게임 자체 공유 UI 없음(톤 일관).
  let rT = null;
  function onResize() { clearTimeout(rT); rT = setTimeout(() => { layout(); kick(); }, 80); }
  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); else stopLoop(); });

  // ───────────────────────── 부팅 ─────────────────────────
  clearGrid();
  refreshMute();
  restore();
})();
