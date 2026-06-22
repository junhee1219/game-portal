// 사탕 폭포 (candy) — 열에 떨어뜨려 인접 합치기 → 중력 → 연쇄 캐스케이드.
// 2048(전체 슬라이드)·동물합치기(물리 드롭)와 다른 제3의 합치기: "잘 배치해 한 방에 N연쇄".
// 게임 계약: 최고점 localStorage 'candyBest'(숫자 문자열) — 신기록 시 setItem → 포털 후킹 캡처.
//            음소거 'candyMuted'. 진행상황 'candySave'(로컬 이어하기, 동기화 대상 아님).
(() => {
  'use strict';

  // ── 사탕 사다리(티어) ── 작은 사탕 → 큰 사탕. 색은 캔디 파스텔, 토큰 내부 명도 폭 좁게.
  const LADDER = [
    { name:'젤리빈',     c:'#ffd06a', motif:'bean'   },
    { name:'구미',       c:'#ff9a86', motif:'gummy'  },
    { name:'알사탕',     c:'#5fd3ad', motif:'stripe' },
    { name:'막대사탕',   c:'#b79bff', motif:'swirl'  },
    { name:'드롭스',     c:'#5fb8ff', motif:'gem'    },
    { name:'도넛사탕',   c:'#ff9f5a', motif:'donut'  },
    { name:'링사탕',     c:'#ff7aae', motif:'ring'   },
    { name:'별사탕',     c:'#ffc445', motif:'star'   },
    { name:'롤리팝',     c:'#ff5f86', motif:'pop'    },
    { name:'대왕 솜사탕', c:'#ffb8de', motif:'cotton' }, // 최종
  ];
  const MAX = LADDER.length - 1;
  const COLS = 5, ROWS = 7;
  const VAL = LADDER.map((_, i) => Math.pow(2, i + 1));   // 점수 가치 2,4,...,1024
  const SHIMMER_TIER = MAX - 1;                           // 이 티어부터 은은한 반짝임

  // ── 타이밍 ──
  const FALL_MS = 150;     // 드롭 후 첫 병합 판정까지 (낙하 보이게)
  const WAVE_MS = 175;     // 캐스케이드 한 파동 간격 (쾅쾅 리듬)
  const COMBO_WINDOW = 0;  // (연쇄는 같은 드롭 내 파동 카운트)

  // ── DOM ──
  const boardEl = document.getElementById('board');
  const canvas = document.getElementById('g');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const bestPill = document.getElementById('best-pill');
  const muteBtn = document.getElementById('mute');
  const muteUse = document.getElementById('mute-use');
  const comboEl = document.getElementById('combo');
  const comboXEl = document.getElementById('combo-x');
  const hintEl = document.getElementById('hint');
  const nextC = document.getElementById('next-c');
  const overEl = document.getElementById('over');
  const overCandy = document.getElementById('over-candy');
  const overCname = document.getElementById('over-cname');
  const overScoreEl = document.getElementById('over-score');
  const overRecEl = document.getElementById('over-record');
  const overSubEl = document.getElementById('over-sub');
  const againBtn = document.getElementById('btn-again');
  const supportBtn = document.getElementById('btn-support');

  // ── 상태 ──
  let board = [];          // board[r][c] = candy | null  (r=0 위, r=ROWS-1 바닥)
  let cur = 0, next = 0;   // 손에 든 / 다음 사탕 티어
  let scoreVal = 0;
  let best = parseInt(localStorage.getItem('candyBest') || '0', 10) || 0;
  let maxEver = 0;         // 이번 진행에서 만든 최고 티어 (신티어 축하용)
  let muted = localStorage.getItem('candyMuted') === '1';
  let busy = false;        // 캐스케이드 진행 중 입력 잠금
  let over = false;
  let started = false;     // 첫 입력 여부 (힌트 숨김)
  let combo = 0;           // 이번 드롭의 연쇄 파동 수
  let waveTimer = 0;       // ms — 다음 파동까지
  let hoverCol = 2;        // 현재 조준 열
  let shakeAmt = 0;

  // 레이아웃
  let CS = 40, PAD = 12, gridTop = 0, launchH = 40, dpr = 1;

  const particles = [];
  const rings = [];
  const floats = [];

  function newCandy(tier) { return { tier, ax: 0, ay: 0, sq: 0, pop: 0, born: performance.now() }; }

  // ── 사이즈/DPR ──
  function resize() {
    const rect = boardEl.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const W = rect.width, H = rect.height;
    PAD = W * 0.045;
    CS = (W - PAD * 2) / COLS;
    launchH = CS;
    // 그리드를 보드 안에서 세로 중앙쯤(런치 스트립 아래)에 배치
    const gridH = CS * ROWS;
    gridTop = PAD + launchH;
    const bottomPad = H - (gridTop + gridH);
    if (bottomPad < PAD) gridTop = Math.max(launchH, H - PAD - gridH); // 안전: 바닥 여백 확보
  }
  const ccx = (c) => PAD + CS * (c + 0.5);
  const ccy = (r) => gridTop + CS * (r + 0.5);
  const launchY = () => PAD + launchH * 0.5;
  const RAD = () => CS * 0.42;

  // ── 보드 유틸 ──
  function emptyBoard() { return Array.from({ length: ROWS }, () => new Array(COLS).fill(null)); }
  function lowestEmpty(col) { for (let r = ROWS - 1; r >= 0; r--) if (!board[r][col]) return r; return -1; }
  function colFull(col) { return !board[0][col]; } // 잘못된 표기 방지용 — 사용 안 함
  function isColFull(col) { return board[0][col] !== null; }
  function boardMaxTier() { let m = 0; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (board[r][c]) m = Math.max(m, board[r][c].tier); return m; }

  // 스폰: 진행에 맞춰 창이 위로 — 초반 0~2, 후반 중간 티어도 (계속 합칠 수 있게)
  function rndSpawn() {
    const hi = Math.max(2, Math.min(6, boardMaxTier() - 2));
    const lo = Math.max(0, hi - 2);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  // ── 드롭 ──
  function dropAt(col) {
    if (busy || over || col < 0 || col >= COLS) return;
    const row = lowestEmpty(col);
    if (row < 0) { shakeAmt = Math.min(10, shakeAmt + 6); sfxNope(); return; } // 꽉 찬 열 — 관대하게 무시
    if (!started) { started = true; hintEl.classList.add('hide'); }
    const cd = newCandy(cur);
    cd.ay = -(ccy(row) - launchY()) - CS * 0.2;  // 런치 위치에서 떨어지는 모션
    board[row][col] = cd;
    sfxDrop(cur);
    haptic(8);
    // 다음 손패로 회전
    cur = next; next = rndSpawn();
    drawNext();
    // 캐스케이드 시작
    busy = true; combo = 0; waveTimer = FALL_MS;
  }

  // 같은 티어 정직교 연결 컴포넌트(크기≥2) 모두 찾기
  function findGroups() {
    const seen = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
    const groups = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (seen[r][c] || !board[r][c]) continue;
      const tier = board[r][c].tier;
      const stack = [[r, c]], comp = [];
      seen[r][c] = true;
      while (stack.length) {
        const [y, x] = stack.pop(); comp.push([y, x]);
        const nb = [[y-1,x],[y+1,x],[y,x-1],[y,x+1]];
        for (const [ny, nx] of nb) {
          if (ny<0||ny>=ROWS||nx<0||nx>=COLS) continue;
          if (seen[ny][nx] || !board[ny][nx]) continue;
          if (board[ny][nx].tier === tier) { seen[ny][nx] = true; stack.push([ny, nx]); }
        }
      }
      if (comp.length >= 2) groups.push({ tier, cells: comp });
    }
    return groups;
  }

  // 한 파동: 그룹 병합 → 중력. 더 처리할 게 있으면 true.
  function doWave() {
    const groups = findGroups();
    if (!groups.length) return false;
    combo++;
    let bumpedNewTier = false;
    for (const g of groups) {
      // 타깃 = 그룹에서 가장 아래(그리고 그 중 가장 오른쪽) 칸
      let tr = -1, tc = -1;
      for (const [r, c] of g.cells) { if (r > tr || (r === tr && c > tc)) { tr = r; tc = c; } }
      const tx = ccx(tc), ty = ccy(tr);

      if (g.tier >= MAX) {
        // 최종 사탕 2개+ → 잭팟! 싹 비우고 큰 보너스
        for (const [r, c] of g.cells) { spawnSources(ccx(c), ccy(r), LADDER[MAX].c); board[r][c] = null; }
        const gain = VAL[MAX] * 3 * Math.max(1, combo);
        addScore(gain);
        jackpotFx(tx, ty, gain);
        continue;
      }
      const newT = g.tier + 1;
      // 소스 제거(타깃 제외) + 파편
      for (const [r, c] of g.cells) {
        if (r === tr && c === tc) continue;
        spawnSources(ccx(c), ccy(r), LADDER[g.tier].c);
        board[r][c] = null;
      }
      // 타깃을 업그레이드 (통통 팝)
      const nc = board[tr][tc] || newCandy(newT);
      nc.tier = newT; nc.sq = 1; nc.pop = 1; nc.ax = 0; nc.ay = 0;
      board[tr][tc] = nc;

      const gain = VAL[newT] * Math.max(1, combo);
      addScore(gain);
      mergeFx(tx, ty, newT, combo, gain);
      sfxMerge(newT, combo);

      if (newT > maxEver) { maxEver = newT; bumpedNewTier = true; }
    }
    // 콤보 배지
    if (combo >= 2) showCombo(combo);
    if (groups.some(g => g.tier < MAX)) sfxCombo(combo);
    if (bumpedNewTier) newTierFx();
    shakeAmt = Math.min(24, shakeAmt + 2 + combo * 1.6);
    haptic(combo >= 3 ? [10, 24, 10] : 12);

    applyGravity();
    return true;
  }

  // 중력: 각 열의 사탕을 아래로 압축 (이동분은 애니 오프셋으로 떨어지는 모션)
  function applyGravity() {
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][c]) {
          if (write !== r) {
            const cd = board[r][c];
            board[write][c] = cd; board[r][c] = null;
            cd.ay += (ccy(r) - ccy(write));   // 이전(위) 위치에서 내려오는 모션
          }
          write--;
        }
      }
    }
  }

  function finishResolve() {
    busy = false;
    save();
    // 게임오버: 모든 열이 꽉 참
    let full = true;
    for (let c = 0; c < COLS; c++) if (!isColFull(c)) { full = false; break; }
    if (full) endGame();
  }

  // ── 점수 ──
  function addScore(n) {
    scoreVal += n;
    scoreEl.textContent = scoreVal;
    if (scoreVal > best) {
      best = scoreVal;
      bestEl.textContent = best;
      bestPill.classList.remove('pulse'); void bestPill.offsetWidth; bestPill.classList.add('pulse');
      localStorage.setItem('candyBest', String(best)); // 신기록 → 포털 후킹 캡처
    }
  }

  // ── 이펙트 ──
  function spawnSources(x, y, color) {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 3;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, r: 2 + Math.random() * 3, life: 1, color });
    }
  }
  function mergeFx(x, y, tier, combo, gain) {
    rings.push({ x, y, r: RAD(), t: 0, kind: 'pop' });
    if (tier >= 4) rings.push({ x, y, r: RAD() * 0.7, t: 0, kind: 'expand', c: LADDER[tier].c });
    const n = 8 + tier;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5, sp = 1.6 + Math.random() * 3 + tier * 0.2;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, r: 2 + Math.random() * 3, life: 1, color: LADDER[tier].c });
    }
    floats.push({ x, y, t: 0, txt: '+' + gain, big: combo >= 3 || tier >= 6, c: '#ff7a59' });
  }
  function newTierFx() {
    floats.push({ x: ccx(2), y: gridTop + CS * 0.6, t: 0, txt: '새 사탕! ' + LADDER[maxEver].name, big: true, c: '#d9468a', slow: true });
    shakeAmt = Math.min(26, shakeAmt + 8);
    sfxNewTier();
  }
  function jackpotFx(x, y, gain) {
    floats.push({ x, y: y - RAD() - 8, t: 0, txt: '잭팟! +' + gain, big: true, c: '#ff5a2a', slow: true });
    shakeAmt = 26;
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 6;
      const cols = ['#ffd089', '#ff9a6b', '#ffb8de', '#ff7aae', '#ffc445'];
      particles.push({ x: ccx(2), y: ccy(ROWS / 2 | 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, r: 2.5 + Math.random() * 4, life: 1.4, color: cols[(Math.random() * cols.length) | 0], star: Math.random() < 0.5 });
    }
    rings.push({ x, y, r: RAD(), t: 0, kind: 'expand', c: '#ffd089' });
    sfxJackpot();
    haptic([18, 40, 18, 40, 30]);
  }
  function showCombo(n) {
    comboXEl.textContent = 'x' + n;
    comboEl.classList.add('show');
    comboEl.classList.remove('pulse'); void comboEl.offsetWidth; comboEl.classList.add('pulse');
  }
  function hideCombo() { comboEl.classList.remove('show', 'pulse'); }

  // ── 렌더 루프 ──
  let lastT = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(34, now - lastT); lastT = now;
    const k = dt / 16.666;

    // 캐스케이드 스케줄러
    if (busy) {
      waveTimer -= dt;
      if (waveTimer <= 0) {
        const more = doWave();
        if (more) waveTimer = WAVE_MS;
        else { finishResolve(); if (!over) hideCombo(); }
      }
    }
    // 애니 오프셋 감쇠
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cd = board[r][c]; if (!cd) continue;
      cd.ay += (0 - cd.ay) * Math.min(1, 0.28 * k);
      cd.ax += (0 - cd.ax) * Math.min(1, 0.28 * k);
      if (Math.abs(cd.ay) < 0.4) cd.ay = 0;
      if (cd.sq > 0) { cd.sq *= Math.pow(0.86, k); if (cd.sq < 0.02) cd.sq = 0; }
      if (cd.pop > 0) { cd.pop -= 0.06 * k; if (cd.pop < 0) cd.pop = 0; }
    }
    if (shakeAmt > 0) { shakeAmt *= Math.pow(0.84, k); if (shakeAmt < 0.3) shakeAmt = 0; }

    draw(now, dt);
  }

  function draw(now, dt) {
    const k = dt / 16.666;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    if (shakeAmt > 0) ctx.translate((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt);

    // 빈 칸(웰)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = ccx(c), y = ccy(r), s = CS * 0.9;
      roundRect(x - s / 2, y - s / 2, s, s, CS * 0.22);
      ctx.fillStyle = 'rgba(120,85,55,0.07)';
      ctx.fill();
    }

    // 위험: 거의 꽉 찬 열의 맨 위 칸 경고 펄스
    if (!over) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 220);
      for (let c = 0; c < COLS; c++) {
        if (board[1][c] && !busy) { // 맨 위 두 칸 중 위가 차기 직전
          const x = ccx(c), y = ccy(0), s = CS * 0.9;
          ctx.save(); ctx.globalAlpha = 0.18 + pulse * 0.2;
          roundRect(x - s / 2, y - s / 2, s, s, CS * 0.22);
          ctx.fillStyle = '#ff7a59'; ctx.fill(); ctx.restore();
        }
      }
    }

    // 사탕들
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cd = board[r][c]; if (!cd) continue;
      drawCandy(ctx, ccx(c) + cd.ax, ccy(r) + cd.ay, RAD(), cd.tier, { sq: cd.sq, pop: cd.pop, now });
    }

    // 조준 가이드 + 손에 든 사탕(런치)
    if (!over && !busy) {
      const x = ccx(hoverCol);
      // 가이드 라인 + 착지 셀 하이라이트
      const row = lowestEmpty(hoverCol);
      ctx.save();
      ctx.strokeStyle = 'rgba(120,85,55,0.16)'; ctx.lineWidth = 1.4; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(x, launchY() + RAD()); ctx.lineTo(x, row >= 0 ? ccy(row) : gridTop); ctx.stroke();
      ctx.restore();
      if (row >= 0) {
        const s = CS * 0.9;
        ctx.save(); ctx.globalAlpha = 0.5; roundRect(x - s / 2, ccy(row) - s / 2, s, s, CS * 0.22);
        ctx.strokeStyle = LADDER[cur].c; ctx.lineWidth = 2.4; ctx.stroke(); ctx.restore();
      }
      const bob = Math.sin(now / 320) * 2;
      drawCandy(ctx, x, launchY() + bob, RAD(), cur, { now });
    }

    // 링
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i]; g.t += k;
      const dur = g.kind === 'expand' ? 26 : 20, p = g.t / dur;
      if (p >= 1) { rings.splice(i, 1); continue; }
      ctx.save();
      if (g.kind === 'expand') {
        ctx.globalAlpha = (1 - p) * 0.85; ctx.strokeStyle = g.c || '#fff'; ctx.lineWidth = 5 * (1 - p) + 1;
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (1 + p * 2.4), 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.globalAlpha = (1 - p) * 0.7; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * (1 - p);
        ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (1 + p * 0.7), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    // 파편
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * k; p.y += p.vy * k; p.vy += 0.22 * k; p.life -= 0.045 * k;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.life)); ctx.fillStyle = p.color;
      if (p.star) drawStar(p.x, p.y, p.r * 1.6, p.r * 0.7, 5);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    // 떠오르는 점수/콤보 텍스트
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.t += k;
      const dur = f.slow ? 78 : (f.big ? 58 : 42), p = f.t / dur;
      if (p >= 1) { floats.splice(i, 1); continue; }
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p);
      const pop = f.t < 8 ? f.t / 8 : 1, fs = (f.big ? 22 : 15) * (0.6 + pop * 0.5);
      ctx.font = `800 ${fs}px "Pretendard Variable",-apple-system,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.fillStyle = f.c;
      const ty = f.y - p * (f.big ? 44 : 28);
      ctx.strokeText(f.txt, f.x, ty); ctx.fillText(f.txt, f.x, ty);
      ctx.restore();
    }

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawStar(cx, cy, R, r, n) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const rad = i % 2 ? r : R, a = (Math.PI * i) / n - Math.PI / 2;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  }

  // ── 사탕 그리기 (티어별 모티프, 단일 빛 + 바닥 하드섀도) ──
  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = pct / 100;
    r = Math.round(Math.min(255, Math.max(0, r + 255 * f)));
    g = Math.round(Math.min(255, Math.max(0, g + 255 * f)));
    b = Math.round(Math.min(255, Math.max(0, b + 255 * f)));
    return `rgb(${r},${g},${b})`;
  }
  function drawCandy(g, x, y, R, tier, opts = {}) {
    const def = LADDER[tier], col = def.c, now = opts.now || 0;
    const sq = opts.sq > 0 ? Math.sin(opts.sq * Math.PI) * 0.28 : 0;
    const popS = opts.pop > 0 ? 1 + Math.sin(opts.pop * Math.PI) * 0.18 : 1;
    const breathe = Math.sin(now / 640 + tier) * 0.012;
    const sx = (1 + sq + breathe) * popS, sy = (1 - sq + breathe) * popS;
    g.save(); g.translate(x, y); g.scale(sx, sy);

    // 바닥 하드섀도 (블러 0)
    g.save(); g.translate(R * 0.10, R * 0.16); g.fillStyle = 'rgba(120,85,55,0.16)';
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill(); g.restore();

    const isCotton = def.motif === 'cotton';
    if (isCotton) drawCotton(g, R, col, now);
    else {
      // 몸통 디스크 — 단일 색조, 위 살짝 밝게
      const grad = g.createLinearGradient(0, -R, 0, R);
      grad.addColorStop(0, shade(col, 12)); grad.addColorStop(0.55, col); grad.addColorStop(1, shade(col, -10));
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
      g.lineWidth = Math.max(1.4, R * 0.05); g.strokeStyle = 'rgba(120,82,52,0.34)'; g.stroke();
      // 모티프 (디스크 안쪽 클립)
      g.save(); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
      drawMotif(g, R, tier, col, now);
      g.restore();
      // 글로시 하이라이트
      g.save(); g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();
      const hl = g.createRadialGradient(-R * 0.3, -R * 0.42, R * 0.05, -R * 0.3, -R * 0.42, R * 0.85);
      hl.addColorStop(0, 'rgba(255,255,255,0.55)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.12)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hl; g.beginPath(); g.ellipse(-R * 0.28, -R * 0.40, R * 0.62, R * 0.46, -0.35, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, R * 0.07);
      g.beginPath(); g.arc(0, -R * 0.04, R * 0.9, Math.PI * 1.18, Math.PI * 1.82); g.stroke();
      g.restore();
    }

    // 상위 티어 은은한 반짝임 (기대감)
    if (tier >= SHIMMER_TIER) {
      const sh = 0.35 + 0.35 * Math.sin(now / 260 + tier);
      g.save(); g.globalAlpha = sh; g.strokeStyle = 'rgba(255,205,120,0.95)';
      g.lineWidth = Math.max(1.6, R * 0.06); g.beginPath(); g.arc(0, 0, R + 1.5, 0, Math.PI * 2); g.stroke(); g.restore();
    }
    g.restore();
  }

  function drawMotif(g, R, tier, col, now) {
    const m = LADDER[tier].motif;
    const dark = shade(col, -22), light = 'rgba(255,255,255,0.7)';
    if (m === 'stripe') {
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = R * 0.26;
      for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(-R, i * R * 0.5 - R); g.lineTo(R, i * R * 0.5 + R); g.stroke(); }
    } else if (m === 'swirl' || m === 'pop') {
      const turns = m === 'pop' ? 3.4 : 2.6, n = 60;
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = m === 'pop' ? R * 0.22 : R * 0.16;
      g.beginPath();
      for (let i = 0; i <= n; i++) { const t = i / n, a = t * Math.PI * 2 * turns, rr = t * R; const px = Math.cos(a) * rr, py = Math.sin(a) * rr; i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
    } else if (m === 'gem') {
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = R * 0.04;
      for (let i = 0; i < 6; i++) { const a = (Math.PI * 2 * i) / 6; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * R, Math.sin(a) * R); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.moveTo(0, -R * 0.5); g.lineTo(R * 0.4, -R * 0.1); g.lineTo(0, R * 0.1); g.lineTo(-R * 0.4, -R * 0.1); g.closePath(); g.fill();
    } else if (m === 'donut' || m === 'ring') {
      g.fillStyle = m === 'donut' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.96)';
      g.beginPath(); g.arc(0, 0, R * (m === 'donut' ? 0.34 : 0.4), 0, Math.PI * 2); g.fill();
      // 스프링클
      const cols = ['#ff7aae', '#ffc445', '#5fb8ff', '#5fd3ad'];
      for (let i = 0; i < 7; i++) { const a = (Math.PI * 2 * i) / 7 + 0.4; const rr = R * 0.66; g.save(); g.translate(Math.cos(a) * rr, Math.sin(a) * rr); g.rotate(a); g.fillStyle = cols[i % cols.length]; g.fillRect(-R * 0.04, -R * 0.12, R * 0.08, R * 0.24); g.restore(); }
    } else if (m === 'star') {
      g.fillStyle = 'rgba(255,255,255,0.92)'; drawStar5(g, 0, 0, R * 0.62, R * 0.28);
      g.fillStyle = shade(col, -8); drawStar5(g, 0, 0, R * 0.44, R * 0.18);
    } else if (m === 'gummy') {
      g.fillStyle = 'rgba(255,255,255,0.32)';
      g.beginPath(); g.ellipse(R * 0.18, R * 0.22, R * 0.5, R * 0.36, 0.4, 0, Math.PI * 2); g.fill();
    }
    // bean: 모티프 없음(매끈)
  }
  function drawStar5(g, cx, cy, R, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const rad = i % 2 ? r : R, a = (Math.PI * i) / 5 - Math.PI / 2; const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fill();
  }
  function drawCotton(g, R, col, now) {
    // 솜사탕: 파스텔 구름 퍼프 여러 개
    const puffs = [[0, -R * 0.25, R * 0.6], [-R * 0.5, 0, R * 0.55], [R * 0.5, 0, R * 0.55], [-R * 0.25, R * 0.35, R * 0.5], [R * 0.25, R * 0.35, R * 0.5], [0, R * 0.1, R * 0.6]];
    const cols = ['#ffc4e3', '#ffd6ec', '#d7c4ff', '#bfe3ff'];
    for (let i = 0; i < puffs.length; i++) {
      const [px, py, pr] = puffs[i];
      const grad = g.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.5, cols[i % cols.length]); grad.addColorStop(1, shade(cols[i % cols.length], -8));
      g.fillStyle = grad; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(150,110,160,0.3)'; g.lineWidth = R * 0.04;
    for (const [px, py, pr] of puffs) { g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.stroke(); }
  }

  function drawNext() {
    const g = nextC.getContext('2d');
    const w = nextC.width;
    g.clearRect(0, 0, w, w);
    g.save(); g.translate(w / 2, w / 2 + 1);
    drawCandy(g, 0, 0, w * 0.36, next, {});
    g.restore();
  }

  // ── 게임오버 ──
  function endGame() {
    if (over) return;
    over = true;
    const isRec = scoreVal >= best && scoreVal > 0;
    overScoreEl.textContent = scoreVal;
    overSubEl.textContent = '최고 ' + best + '점';
    overCname.textContent = LADDER[maxEver].name;
    overRecEl.classList.toggle('show', isRec);
    // 도달한 최고 사탕 그리기
    const g = overCandy.getContext('2d'); const w = overCandy.width;
    g.clearRect(0, 0, w, w); g.save(); g.translate(w / 2, w / 2 + 2); drawCandy(g, 0, 0, w * 0.38, maxEver, {}); g.restore();
    overEl.classList.add('show');
    sfxOver(); haptic([30, 60, 30]);
    localStorage.removeItem('candySave');
    if (window.GamePortal && GamePortal.shareResult) GamePortal.shareResult();
    if (window.GamePortal) setTimeout(() => GamePortal.openSupport(), 1000);
  }

  function reset() {
    overEl.classList.remove('show');
    board = emptyBoard();
    scoreVal = 0; scoreEl.textContent = '0';
    maxEver = 0; combo = 0; busy = false; over = false; started = false; shakeAmt = 0;
    particles.length = 0; rings.length = 0; floats.length = 0; hideCombo();
    hintEl.classList.remove('hide');
    cur = rndSpawn(); next = rndSpawn();
    drawNext();
    bestEl.textContent = best;
  }

  // ── 이어하기 저장/복원 ──
  function save() {
    if (over) return;
    try {
      const b = board.map(row => row.map(cd => cd ? cd.tier : -1));
      localStorage.setItem('candySave', JSON.stringify({ b, cur, next, s: scoreVal, m: maxEver }));
    } catch (_) {}
  }
  function load() {
    try {
      const raw = localStorage.getItem('candySave'); if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.b) || d.b.length !== ROWS) return false;
      board = d.b.map(row => row.map(t => t >= 0 ? newCandy(t) : null));
      cur = d.cur || 0; next = d.next || 0; scoreVal = d.s || 0; maxEver = d.m || 0;
      scoreEl.textContent = scoreVal; started = scoreVal > 0 || board.some(r => r.some(Boolean));
      if (started) hintEl.classList.add('hide');
      drawNext();
      return true;
    } catch (_) { return false; }
  }

  // ── 입력 ── 열을 톡 (한 손)
  function colFromX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const vx = (clientX - rect.left) / rect.width * (PAD * 2 + CS * COLS);
    return Math.max(0, Math.min(COLS - 1, Math.floor((vx - PAD) / CS)));
  }
  let down = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (over) return; audioInit(); down = true; hoverCol = colFromX(e.clientX);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', (e) => { hoverCol = colFromX(e.clientX); });
  canvas.addEventListener('pointerup', (e) => { if (!down) return; down = false; hoverCol = colFromX(e.clientX); dropAt(hoverCol); });
  canvas.addEventListener('pointercancel', () => { down = false; });
  // 키보드(데스크톱 보조): 1~5 열, 좌우+스페이스
  window.addEventListener('keydown', (e) => {
    if (over) { if (e.key === 'Enter' || e.key === ' ') { audioInit(); reset(); } return; }
    if (e.key >= '1' && e.key <= '5') { audioInit(); dropAt(+e.key - 1); }
    else if (e.key === 'ArrowLeft') hoverCol = Math.max(0, hoverCol - 1);
    else if (e.key === 'ArrowRight') hoverCol = Math.min(COLS - 1, hoverCol + 1);
    else if (e.key === ' ' || e.key === 'ArrowDown') { audioInit(); dropAt(hoverCol); }
  });

  // ── 버튼 ──
  function refreshMute() { muteUse.setAttribute('href', muted ? '#p-speaker-slash' : '#p-speaker-high'); }
  muteBtn.addEventListener('click', () => { muted = !muted; localStorage.setItem('candyMuted', muted ? '1' : '0'); refreshMute(); audioInit(); if (!muted) sfxDrop(2); });
  againBtn.addEventListener('click', () => { audioInit(); reset(); });
  if (supportBtn) supportBtn.addEventListener('click', () => { if (window.GamePortal) GamePortal.openSupport(); });

  // ── 사운드 (Web Audio 합성) ──
  let actx = null, amaster = null;
  function audioInit() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); amaster = actx.createGain(); amaster.gain.value = muted ? 0 : 0.9; amaster.connect(actx.destination); }
      catch (_) { return; }
    }
    if (actx.state === 'suspended' || actx.state === 'interrupted') actx.resume();
    if (amaster) amaster.gain.value = muted ? 0 : 0.9;
  }
  function tone(freq, dur, type = 'sine', peak = 0.2, slideTo = null) {
    if (!actx || muted) return;
    const t = actx.currentTime, o = actx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(amaster); o.start(t); o.stop(t + dur + 0.02);
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function sfxDrop(t) { tone(360 - t * 12, 0.09, 'sine', 0.15, 220 - t * 8); }
  function sfxNope() { tone(180, 0.12, 'sawtooth', 0.12, 120); }
  function sfxMerge(tier, combo) { const base = 58 + tier * 2.4 + combo * 1.2; tone(mtof(base), 0.13, 'triangle', 0.22, mtof(base + 7)); tone(mtof(base + 12), 0.11, 'sine', 0.1); }
  function sfxCombo(n) { if (n >= 2 && actx && !muted) tone(mtof(70 + n * 2), 0.1, 'square', 0.08); }
  function sfxNewTier() { if (!actx || muted) return;[72, 76, 79, 84].forEach((m, i) => setTimeout(() => tone(mtof(m), 0.26, 'triangle', 0.2), i * 65)); }
  function sfxJackpot() { if (!actx || muted) return;[72, 76, 79, 84, 88, 91].forEach((m, i) => setTimeout(() => tone(mtof(m), 0.32, 'triangle', 0.22), i * 70)); }
  function sfxOver() { if (!actx || muted) return;[60, 56, 51].forEach((m, i) => setTimeout(() => tone(mtof(m), 0.32, 'sawtooth', 0.16, mtof(m - 5)), i * 110)); }
  function haptic(p) { if (navigator.vibrate && !muted) { try { navigator.vibrate(p); } catch (_) {} } }

  // ── 부팅 ──
  function boot() {
    resize();
    refreshMute();
    bestEl.textContent = best;
    if (!load()) reset();
    requestAnimationFrame(frame);
  }
  let rRaf = 0;
  function schedResize() { cancelAnimationFrame(rRaf); rRaf = requestAnimationFrame(() => { resize(); drawNext(); }); }
  window.addEventListener('resize', schedResize);
  window.addEventListener('orientationchange', schedResize);
  if (window.ResizeObserver && boardEl) new ResizeObserver(schedResize).observe(boardEl);
  setTimeout(schedResize, 300);
  document.addEventListener('visibilitychange', () => { if (document.hidden && actx) actx.suspend && actx.suspend(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
