// 동물 합치기 (merge) — 수박게임류 드롭 머지. matter.js 물리 + 자체 rAF 렌더.
// 게임 계약: 최고점수 localStorage 'mergeBest'(숫자 문자열), 음소거 'mergeMuted'.
//            신기록 시 반드시 setItem('mergeBest', String(score)) → 포털 후킹이 캡처.
(() => {
  'use strict';
  const { Engine, World, Bodies, Body, Composite, Events } = Matter;

  // ── 동물 사다리(티어) ── 작은 친구 → 큰 친구. 인덱스가 곧 티어.
  // radius는 통 폭(가상 단위 W) 대비 비율. 색은 파스텔 단일 채도, 명도 폭 좁게.
  const W = 360; // 가상 좌표계 폭 (실제 렌더는 DPR 스케일)
  const LADDER = [
    { e:'🐭', r:0.072, c:'#f5d9c2' }, // 0
    { e:'🐹', r:0.090, c:'#fbd3a8' }, // 1
    { e:'🐰', r:0.110, c:'#fde2d0' }, // 2
    { e:'🐱', r:0.132, c:'#ffd9a0' }, // 3
    { e:'🐶', r:0.156, c:'#ffcf9a' }, // 4
    { e:'🦊', r:0.182, c:'#ffba7a' }, // 5
    { e:'🐯', r:0.210, c:'#ffc96b' }, // 6
    { e:'🐮', r:0.240, c:'#ffe0b0' }, // 7
    { e:'🐷', r:0.272, c:'#ffc7cf' }, // 8
    { e:'🐼', r:0.305, c:'#f0e6dc' }, // 9
    { e:'🐻', r:0.340, c:'#e9c39a' }, // 10 (최종)
  ];
  const MAX_TIER = LADDER.length - 1;
  // 점수: 합쳐서 생긴 동물의 티어 가치 (수박게임식: 티어 n 생성 시 가산)
  const TIER_SCORE = LADDER.map((_, i) => (i * (i + 1)) / 2 * 1 + i); // 부드럽게 증가
  // 떨어뜨릴 때 등장 가능한 티어 (작은 5종만 — 검증된 진행)
  const SPAWN_MAX = 4;

  // ── DOM ──
  const wrap = document.getElementById('wrap');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const nextFaceEl = document.querySelector('#next .nface');
  const muteBtn = document.getElementById('mute');
  const overEl = document.getElementById('over');
  const overScoreEl = document.getElementById('over-score');
  const overBestEl = document.getElementById('over-best');
  const overRecEl = document.getElementById('over-record');
  const overFaceEl = document.getElementById('over-face');
  const evoRow = document.getElementById('evo-row');
  const againBtn = document.getElementById('btn-again');

  // ── 상태 ──
  let engine, world;
  let scoreVal = 0;
  let best = parseInt(localStorage.getItem('mergeBest') || '0', 10) || 0;
  let muted = localStorage.getItem('mergeMuted') === '1';
  let H = W * 7 / 5;             // 가상 높이 (aspect 5:7)
  let scale = 1;                 // 가상 → 실제 픽셀
  const WALL = 0;                // 벽 두께(시각상 0, 캔버스 가장자리)
  const DROP_Y = W * 0.13;       // 드롭 라인 y
  const DEATH_Y = W * 0.20;      // 위험선 y (이 위로 오래 머물면 게임오버)
  let aimX = W / 2;              // 현재 조준 x
  let nextTier = rndSpawn();     // 다음 떨어뜨릴 티어
  let curTier = rndSpawn();      // 지금 손에 든(조준 중) 티어
  let canDrop = true;            // 드롭 쿨다운
  let dropCooldownUntil = 0;
  let running = false;
  let gameOver = false;
  const bodies = new Set();      // 살아있는 동물 바디
  const particles = [];          // 합치기 팡 파티클
  const popRings = [];           // 합칠 때 통통 링
  let overflowSince = 0;         // 위험선 초과 시작 시각(연속 측정)

  function rndSpawn() { return Math.floor(Math.random() * SPAWN_MAX); }

  // ── 사이즈/DPR ──
  function resize() {
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    // 가상 폭 W가 캔버스 폭에 맞도록 scale 결정 → 가상*scale = 실제픽셀
    scale = canvas.width / W;
    H = canvas.height / scale;
  }

  // ── 물리 월드 구성 ──
  function buildWorld() {
    engine = Engine.create();
    engine.gravity.y = 1.15;
    world = engine.world;
    // 벽: 좌/우/바닥 (가상 좌표). 두껍게 바깥으로 빼서 새지 않게.
    const t = 60;
    const opt = { isStatic: true, restitution: 0.1, friction: 0.6 };
    World.add(world, [
      Bodies.rectangle(-t/2, H/2, t, H*2, opt),          // left
      Bodies.rectangle(W + t/2, H/2, t, H*2, opt),        // right
      Bodies.rectangle(W/2, H + t/2, W*2, t, opt),        // floor
    ]);
    Events.on(engine, 'collisionStart', onCollide);
  }

  // ── 동물 바디 생성 ──
  function makeAnimal(tier, x, y, opts = {}) {
    const r = LADDER[tier].r * W;
    const b = Bodies.circle(x, y, r, {
      restitution: 0.18,
      friction: 0.55,
      frictionStatic: 0.7,
      density: 0.0011,
      ...opts,
    });
    b.tier = tier;
    b.merged = false;
    b.born = performance.now();
    b.spawnAt = b.born;
    b.squash = 0;     // 머지 직후 통통 스쿼시(0~1, 감쇠)
    bodies.add(b);
    World.add(world, b);
    return b;
  }

  // ── 충돌: 같은 티어끼리 머지 (dedup 큐) ──
  const mergeQueue = [];
  function onCollide(ev) {
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.tier === undefined || b.tier === undefined) continue; // 벽
      if (a.tier !== b.tier) continue;
      if (a.merged || b.merged) continue;       // 이미 소비됨 → 스킵 (THE 수박게임 버그 방어)
      if (a.tier >= MAX_TIER) continue;          // 최종 동물은 더 안 합쳐짐
      a.merged = true; b.merged = true;          // 즉시 플래그 → 같은 틱 다른 페어가 재사용 못함
      mergeQueue.push([a, b]);
    }
  }

  function processMerges() {
    if (!mergeQueue.length) return;
    while (mergeQueue.length) {
      const [a, b] = mergeQueue.shift();
      const nt = a.tier + 1;
      const mx = (a.position.x + b.position.x) / 2;
      const my = (a.position.y + b.position.y) / 2;
      removeBody(a); removeBody(b);
      const nb = makeAnimal(nt, mx, my);
      nb.squash = 1;                              // 통통 튀는 스쿼시 시작
      // 살짝 위로 톡 — 손맛
      Body.setVelocity(nb, { x: (Math.random()-0.5)*1.5, y: -2.2 });
      // 점수
      addScore(TIER_SCORE[nt]);
      // 이펙트
      burst(mx, my, LADDER[nt].c, nt);
      popRings.push({ x:mx, y:my, r:LADDER[nt].r*W, t:0 });
      // 사운드 + 햅틱 (티어 높을수록 음 높게)
      sfxMerge(nt);
      haptic(nt >= 6 ? [12,30,12] : 14);
      if (nt === MAX_TIER) { sfxBig(); haptic([20,40,20,40,30]); }
    }
  }

  function removeBody(b) {
    bodies.delete(b);
    World.remove(world, b);
  }

  function addScore(n) {
    scoreVal += n;
    scoreEl.textContent = scoreVal;
    if (scoreVal > best) {
      best = scoreVal;
      bestEl.textContent = best;
      // 게임 계약: 신기록은 반드시 plain 문자열로 setItem (포털 후킹이 캡처)
      localStorage.setItem('mergeBest', String(best));
    }
  }

  // ── 드롭 ──
  function dropAt(x) {
    if (!running || gameOver || !canDrop) return;
    const r = LADDER[curTier].r * W;
    const cx = Math.max(r + 4, Math.min(W - r - 4, x));
    const b = makeAnimal(curTier, cx, DROP_Y);
    Body.setVelocity(b, { x: 0, y: 0 });
    sfxDrop(curTier);
    haptic(8);
    // 다음으로 회전
    curTier = nextTier;
    nextTier = rndSpawn();
    nextFaceEl.textContent = LADDER[nextTier].e;
    // 쿨다운: 다음 동물이 스폰존을 통과할 시간 확보 (스팸 드롭 → 즉시 오버 방지)
    canDrop = false;
    dropCooldownUntil = performance.now() + 420;
  }

  // ── 게임오버 판정: 위험선 위에 "정착한" 바디가 연속 1s 이상 ──
  function checkOver(now) {
    let danger = false;
    for (const b of bodies) {
      if (b.merged) continue;
      if (now - b.spawnAt < 700) continue;          // 갓 떨어진 건 통과 중 → 무시
      const r = LADDER[b.tier].r * W;
      const top = b.position.y - r;
      const settled = Math.abs(b.velocity.y) < 1.4 && Math.abs(b.velocity.x) < 1.4;
      if (top < DEATH_Y && settled) { danger = true; break; }
    }
    if (danger) {
      if (!overflowSince) overflowSince = now;
      else if (now - overflowSince > 1000) endGame();
    } else {
      overflowSince = 0;
    }
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    running = false;
    const isRecord = scoreVal >= best && scoreVal > 0;
    // best는 addScore에서 이미 갱신·저장됨. 신기록 배지는 이번 판이 best와 같을 때.
    overScoreEl.textContent = scoreVal;
    overBestEl.textContent = best;
    overRecEl.classList.toggle('show', isRecord && scoreVal === best);
    // 최고 도달 티어 표시
    let topTier = 0;
    for (const b of bodies) if (b.tier > topTier) topTier = b.tier;
    overFaceEl.textContent = LADDER[topTier].e;
    overEl.classList.add('show');
    sfxOver();
    haptic([30,60,30]);
  }

  function reset() {
    overEl.classList.remove('show');
    if (world) { World.clear(world, false); Engine.clear(engine); }
    bodies.clear(); particles.length = 0; popRings.length = 0; mergeQueue.length = 0;
    scoreVal = 0; scoreEl.textContent = '0';
    bestEl.textContent = best;
    overflowSince = 0; gameOver = false; canDrop = true;
    curTier = rndSpawn(); nextTier = rndSpawn();
    nextFaceEl.textContent = LADDER[nextTier].e;
    buildWorld();
    running = true;
  }

  // ── 파티클(팡) ──
  function burst(x, y, color, tier) {
    const n = 8 + tier * 2;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const sp = 1.5 + Math.random() * 3 + tier * 0.2;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1,
        r: 2 + Math.random() * 3 + tier * 0.3,
        life: 1, color,
      });
    }
  }

  // ── 렌더 루프 ──
  let lastT = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(33, now - lastT); lastT = now;

    if (running) {
      // 쿨다운 해제
      if (!canDrop && now >= dropCooldownUntil) canDrop = true;
      Engine.update(engine, 16.666);
      processMerges();
      checkOver(now);
    }
    draw(now, dt);
  }

  function draw(now, dt) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);

    // 위험선 (점선) — 데스라인
    ctx.save();
    ctx.strokeStyle = 'rgba(255,122,89,0.55)';
    ctx.lineWidth = 1.6; ctx.setLineDash([7, 6]);
    ctx.beginPath(); ctx.moveTo(0, DEATH_Y); ctx.lineTo(W, DEATH_Y); ctx.stroke();
    ctx.restore();

    // 조준 가이드 + 손에 든 동물 (떨어뜨리기 전)
    if (running && !gameOver) {
      const r = LADDER[curTier].r * W;
      const cx = Math.max(r + 4, Math.min(W - r - 4, aimX));
      // 가이드 라인
      ctx.save();
      ctx.strokeStyle = 'rgba(120,85,55,0.18)';
      ctx.lineWidth = 1.4; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(cx, DROP_Y + r); ctx.lineTo(cx, H); ctx.stroke();
      ctx.restore();
      const bob = canDrop ? Math.sin(now / 300) * 2 : 0;
      drawAnimal(cx, DROP_Y + bob, curTier, 0, canDrop ? 1 : 0.55);
    }

    // 동물들
    for (const b of bodies) {
      if (b.squash > 0) b.squash *= Math.pow(0.86, dt / 16.666);
      if (b.squash < 0.02) b.squash = 0;
      drawAnimal(b.position.x, b.position.y, b.tier, b.angle, 1, b.squash);
    }

    // 통통 링
    for (let i = popRings.length - 1; i >= 0; i--) {
      const ring = popRings[i];
      ring.t += dt / 16.666;
      const p = ring.t / 22;
      if (p >= 1) { popRings.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.7;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * (1 - p);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r * (1 + p * 0.7), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 파티클
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life -= 0.045 * (dt / 16.666);
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawAnimal(x, y, tier, angle, alpha, squash = 0) {
    const def = LADDER[tier];
    const r = def.r * W;
    // 스쿼시: 잠깐 가로로 납작했다 통통 (탄성)
    const sq = squash > 0 ? Math.sin(squash * Math.PI) * 0.22 : 0;
    const sx = 1 + sq, sy = 1 - sq;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(sx, sy);

    // 바닥 하드섀도 (블러 0) — "놓여 있는" 느낌
    ctx.save();
    ctx.translate(r * 0.12, r * 0.16);
    ctx.fillStyle = 'rgba(120,85,55,0.16)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 몸통: 단일 색조 + 명도 폭 좁은 그라데이션 (위 살짝 밝게)
    const lighter = shade(def.c, 9);
    const darker = shade(def.c, -7);
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, lighter);
    g.addColorStop(0.55, def.c);
    g.addColorStop(1, darker);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // 외곽선 중립 다크 한 색
    ctx.lineWidth = Math.max(1.2, r * 0.05);
    ctx.strokeStyle = 'rgba(90,70,55,0.32)';
    ctx.stroke();
    // 크리스프 윗 림
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath(); ctx.arc(0, -r * 0.04, r * 0.92, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.restore();

    // 이모지 얼굴
    ctx.font = `${r * 1.18}px "Apple Color Emoji","Segoe UI Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.e, 0, r * 0.04);

    ctx.restore();
  }

  // 색 명도 조정 (퍼센트) — 명도 폭 좁게 유지용
  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = pct / 100;
    r = Math.round(Math.min(255, Math.max(0, r + 255 * f)));
    g = Math.round(Math.min(255, Math.max(0, g + 255 * f)));
    b = Math.round(Math.min(255, Math.max(0, b + 255 * f)));
    return `rgb(${r},${g},${b})`;
  }

  // ── 입력 (pointer) — 손가락 좌우 조준, 떼면 드롭 ──
  let pointerDown = false;
  function toVirtX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (gameOver) return;
    audioInit();
    pointerDown = true;
    aimX = toVirtX(e.clientX);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointerDown) { aimX = toVirtX(e.clientX); return; }
    aimX = toVirtX(e.clientX);
  });
  function release(e) {
    if (!pointerDown) return;
    pointerDown = false;
    aimX = toVirtX(e.clientX);
    dropAt(aimX);
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });

  // ── 음소거 / 버튼 ──
  function refreshMute() { muteBtn.textContent = muted ? '🔇' : '🔊'; }
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem('mergeMuted', muted ? '1' : '0'); // lww 동기화 대상
    refreshMute();
    audioInit();
    if (!muted) sfxDrop(2);
  });
  againBtn.addEventListener('click', () => { audioInit(); reset(); });

  // ── 진화 사다리 미니 전시(게임오버 카드) ──
  function buildEvoRow() {
    evoRow.innerHTML = '';
    LADDER.forEach((d, i) => {
      const sp = document.createElement('span');
      sp.textContent = d.e;
      evoRow.appendChild(sp);
      if (i < MAX_TIER) {
        const ar = document.createElement('span');
        ar.className = 'arr'; ar.textContent = '›';
        evoRow.appendChild(ar);
      }
    });
  }

  // ── 사운드 (Web Audio 합성, 외부 에셋 없음) ──
  let actx = null, amaster = null;
  function audioInit() {
    if (!actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        amaster = actx.createGain();
        amaster.gain.value = muted ? 0 : 0.9;
        amaster.connect(actx.destination);
      } catch (_) { return; }
    }
    if (actx.state === 'suspended' || actx.state === 'interrupted') actx.resume();
    if (amaster) amaster.gain.value = muted ? 0 : 0.9;
  }
  function tone(freq, dur, type = 'sine', peak = 0.2, slideTo = null) {
    if (!actx || muted) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(amaster);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function sfxDrop(tier) { tone(420 - tier * 18, 0.1, 'sine', 0.16, 230 - tier * 10); }
  function sfxMerge(tier) {
    // 티어 높을수록 음 높게 — "올라가는 보상" 느낌
    const base = 60 + tier * 2.5;
    tone(mtof(base), 0.14, 'triangle', 0.22, mtof(base + 7));
    tone(mtof(base + 12), 0.12, 'sine', 0.1);
  }
  function sfxBig() {
    if (!actx || muted) return;
    [72, 76, 79, 84].forEach((m, i) => setTimeout(() => tone(mtof(m), 0.3, 'triangle', 0.2), i * 70));
  }
  function sfxOver() {
    if (!actx || muted) return;
    [60, 56, 51].forEach((m, i) => setTimeout(() => tone(mtof(m), 0.32, 'sawtooth', 0.16, mtof(m - 5)), i * 110));
  }
  function haptic(p) { if (navigator.vibrate && !muted) { try { navigator.vibrate(p); } catch (_) {} } }

  // ── 부팅 ──
  function boot() {
    resize();
    buildEvoRow();
    refreshMute();
    bestEl.textContent = best;
    nextFaceEl.textContent = LADDER[nextTier].e;
    reset();
    requestAnimationFrame(frame);
  }
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(resize);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && actx) actx.suspend && actx.suspend(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
