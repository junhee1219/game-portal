/* 행성 합치기 (orbit) — 드롭 머지 + 블랙홀 트위스트.
   물리: matter.js. 손맛: 바운스/안정화 + 합체 팡 파티클 + 콤보 배율 + 화면 흔들림 + vibrate.
   계약: 신기록 시 localStorage.setItem('orbitBest', String(score)); orbitMuted 존중. portal.js 직접 주입 금지. */
(() => {
  'use strict';
  const { Engine, Runner, Bodies, Body, Composite, Events, Sleeping } = Matter;

  // ── 행성 단계 정의 (단색 원 + 부드러운 그라데이션, 이모지 라벨) ──
  // 명도폭 좁은 파스텔. r은 보드 폭 대비 비율(나중에 px 환산).
  const TIERS = [
    { name: '운석',   rr: 0.052, c1: '#bfc6d8', c2: '#9fa8bf', emoji: '🌑', score: 1 },
    { name: '소행성', rr: 0.066, c1: '#c8b6e2', c2: '#a98fd1', emoji: '🪨', score: 3 },
    { name: '달',     rr: 0.083, c1: '#e3e7f2', c2: '#c2cae0', emoji: '🌕', score: 6 },
    { name: '화성',   rr: 0.104, c1: '#f3b89a', c2: '#e09573', emoji: '🔴', score: 10 },
    { name: '지구',   rr: 0.128, c1: '#9fd0f0', c2: '#7bb6e6', emoji: '🌍', score: 16 },
    { name: '해왕성', rr: 0.156, c1: '#9fb6f0', c2: '#7d96e3', emoji: '🔵', score: 24 },
    { name: '천왕성', rr: 0.186, c1: '#a6e6df', c2: '#82d3c9', emoji: '🟢', score: 34 },
    { name: '토성',   rr: 0.220, c1: '#f5d79c', c2: '#e6bd73', emoji: '🪐', score: 50, ring: true },
    { name: '목성',   rr: 0.258, c1: '#f2c2a0', c2: '#e09e76', emoji: '🟠', score: 72 },
    { name: '태양',   rr: 0.300, c1: '#ffe1a6', c2: '#ffcf6e', emoji: '☀️', score: 100, glow: true },
  ];
  const MAX_TIER = TIERS.length - 1;
  const BLACKHOLE = 'bh';

  // 드롭으로 나올 수 있는 최대 단계(처음 몇 개만) — 수박게임 룰
  const SPAWN_MAX = 4;

  // ── DOM ──
  const board = document.getElementById('board');
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const elScore = document.getElementById('score');
  const elBest = document.getElementById('best');
  const elNext = document.getElementById('nextChip');
  const elCombo = document.getElementById('combo');
  const elDanger = document.getElementById('dangerline');
  const muteBtn = document.getElementById('mute');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const ovTitle = document.getElementById('ovTitle');
  const ovScore = document.getElementById('ovScore');
  const ovSub = document.getElementById('ovSub');
  const recmark = document.getElementById('recmark');
  const evoEl = document.getElementById('evo');

  // ── 상태 ──
  let W = 0, H = 0, DPR = 1;
  let WALL = 14;          // 벽 두께
  let DANGER_Y = 0;       // 위험선 y
  let DROP_Y = 0;         // 행성이 매달리는 y
  let engine, runner;
  let bodies = [];        // 살아있는 행성 body 목록
  let score = 0;
  let best = +(localStorage.getItem('orbitBest') || 0);
  let running = false;
  let gameOver = false;
  let canDrop = true;
  let nextTier = 0;
  let nextIsBlackhole = false;
  let aimX = 0;           // 조준 x (월드 좌표)
  let mergeQueue = [];    // afterUpdate에서 처리할 합체 (이벤트 중 월드 변경 금지)
  const consumed = new Set();   // 이번 프레임 소비된 body id (이중 합체 방지)
  let combo = 0;          // 현재 콤보 수
  let comboTimer = 0;     // 콤보 유지 타이머(ms)
  let particles = [];     // 합체 팡 파티클
  let shake = 0;          // 화면 흔들림 강도
  let dangerHold = 0;     // 위험선 초과 누적 시간(ms)
  let lastTs = 0;
  let blackholeCooldown = 0;  // 블랙홀 등장 쿨다운(드롭 횟수 기준)
  let dropCount = 0;

  // ── 별 가루 배경 ──
  function paintStars() {
    const svg = document.getElementById('stars');
    const w = window.innerWidth, h = window.innerHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    let s = '';
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = Math.random() * 1.4 + 0.4;
      const o = Math.random() * 0.4 + 0.15;
      s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#8a9bd6" opacity="${o.toFixed(2)}"/>`;
    }
    svg.innerHTML = s;
  }

  // ── 진화 표 ──
  function paintEvo() {
    evoEl.innerHTML = TIERS.map(t =>
      `<div class="e" title="${t.name}" style="background:radial-gradient(circle at 35% 30%, ${t.c1}, ${t.c2})">${t.emoji}</div>`
    ).join('');
  }

  // ── 캔버스/보드 사이즈 ──
  function fit() {
    const wrap = document.getElementById('wrap');
    const availW = Math.min(wrap.clientWidth, 460);
    const availH = wrap.clientHeight;
    // 세로 우선 비율 ~ 0.78 (가로:세로)
    let w = availW;
    let h = w / 0.72;
    if (h > availH) { h = availH; w = h * 0.72; }
    W = Math.round(w); H = Math.round(h);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    board.style.width = W + 'px';
    board.style.height = H + 'px';
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    DANGER_Y = Math.round(H * 0.16);
    DROP_Y = Math.round(H * 0.075);
    elDanger.style.top = DANGER_Y + 'px';
  }

  function radiusFor(tier) { return Math.max(10, TIERS[tier].rr * W); }

  // ── 물리 세계 ──
  function buildWorld() {
    if (runner) Runner.stop(runner);
    if (engine) Composite.clear(engine.world, false), Engine.clear(engine);
    engine = Engine.create();
    engine.world.gravity.y = 1.0;
    engine.enableSleeping = true;

    const opt = { isStatic: true, restitution: 0.2, friction: 0.6,
      render: { visible: false } };
    const floor = Bodies.rectangle(W / 2, H + WALL / 2 - 1, W * 2, WALL, opt);
    const left = Bodies.rectangle(WALL / 2, H / 2, WALL, H * 2, opt);
    const right = Bodies.rectangle(W - WALL / 2, H / 2, WALL, H * 2, opt);
    floor.label = left.label = right.label = 'wall';
    Composite.add(engine.world, [floor, left, right]);

    runner = Runner.create();
    Events.on(engine, 'collisionStart', onCollision);
    Events.on(engine, 'afterUpdate', onAfterUpdate);
  }

  // ── 행성 생성 ──
  let bodyId = 1;
  function makePlanet(x, y, tier, isBlackhole) {
    const r = isBlackhole ? radiusFor(2) : radiusFor(tier);
    const b = Bodies.circle(x, y, r, {
      restitution: 0.18,
      friction: 0.55,
      frictionStatic: 0.6,
      density: 0.0014,
      slop: 0.02,
    });
    b.plabel = isBlackhole ? BLACKHOLE : tier;
    b.tier = tier;
    b.isBlackhole = !!isBlackhole;
    b.r = r;
    b.uid = bodyId++;
    b.spawnAt = performance.now();
    return b;
  }

  // ── 충돌: 이중 합체 가드 + 큐잉(월드 변경은 afterUpdate에서) ──
  function onCollision(ev) {
    if (!running || gameOver) return;
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.label === 'wall' || b.label === 'wall') continue;
      if (consumed.has(a.uid) || consumed.has(b.uid)) continue;

      // 블랙홀: 닿은 행성과 같은 tier 전부 흡수
      if (a.isBlackhole || b.isBlackhole) {
        const hole = a.isBlackhole ? a : b;
        const hit = a.isBlackhole ? b : a;
        if (hit.isBlackhole) continue; // 블랙홀끼리는 무시
        consumed.add(hole.uid); consumed.add(hit.uid);
        mergeQueue.push({ type: 'blackhole', hole, targetTier: hit.tier, x: hit.position.x, y: hit.position.y });
        continue;
      }

      // 일반 합체: 같은 tier + 최대 미만
      if (a.tier === b.tier && a.tier < MAX_TIER) {
        consumed.add(a.uid); consumed.add(b.uid);
        mergeQueue.push({ type: 'merge', a, b, tier: a.tier });
      }
    }
  }

  function removeBody(b) {
    Composite.remove(engine.world, b);
    const i = bodies.indexOf(b);
    if (i >= 0) bodies.splice(i, 1);
  }

  function onAfterUpdate(ev) {
    if (!mergeQueue.length) { consumed.clear(); return; }
    const q = mergeQueue; mergeQueue = [];
    let merged = false;

    for (const m of q) {
      if (m.type === 'merge') {
        if (!bodies.includes(m.a) || !bodies.includes(m.b)) continue;
        const mx = (m.a.position.x + m.b.position.x) / 2;
        const my = (m.a.position.y + m.b.position.y) / 2;
        const newTier = m.tier + 1;
        removeBody(m.a); removeBody(m.b);
        const np = makePlanet(mx, my, newTier, false);
        bodies.push(np);
        Composite.add(engine.world, np);
        Body.setVelocity(np, { x: 0, y: -1.2 });
        merged = true;

        bumpCombo();
        const gain = TIERS[newTier].score * comboMult();
        addScore(gain);
        burst(mx, my, TIERS[newTier].c1, newTier);
        shake = Math.min(shake + 2 + newTier * 0.5, 14);
        Sound.merge(newTier, combo);
        vibrate(newTier >= 6 ? 30 : 12);
        if (newTier >= 6) Sound.big();
        if (newTier === MAX_TIER) { burst(mx, my, '#ffd86e', MAX_TIER); shake = 16; }
      } else if (m.type === 'blackhole') {
        if (!bodies.includes(m.hole)) continue;
        Sound.blackhole();
        // 흡수 시각효과: 블랙홀 위치로 빨려드는 파티클
        const hx = m.hole.position.x, hy = m.hole.position.y;
        const victims = bodies.filter(b => !b.isBlackhole && b.tier === m.targetTier);
        let absorbed = 0;
        for (const v of victims) {
          burst(v.position.x, v.position.y, TIERS[v.tier].c2, v.tier, true, hx, hy);
          removeBody(v); absorbed++;
        }
        removeBody(m.hole);
        merged = true;
        bumpCombo();
        const gain = (TIERS[m.targetTier].score * absorbed) * comboMult();
        addScore(gain);
        burstRing(hx, hy);
        shake = Math.min(shake + 8, 18);
        vibrate([20, 40, 30]);
      }
    }
    consumed.clear();
    if (merged) refreshNextPreview();
  }

  // ── 콤보 ──
  function bumpCombo() { combo++; comboTimer = 900; flashCombo(); }
  function comboMult() { return combo <= 1 ? 1 : combo; } // 2연쇄=x2, 3연쇄=x3...
  function flashCombo() {
    if (combo >= 2) {
      elCombo.textContent = `${combo} COMBO! x${comboMult()}`;
      elCombo.classList.add('show', 'pulse');
      setTimeout(() => elCombo.classList.remove('pulse'), 360);
    }
  }
  function decayCombo(dt) {
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) { combo = 0; elCombo.classList.remove('show'); }
    }
  }

  // ── 점수 ──
  function addScore(n) {
    score += Math.round(n);
    elScore.textContent = score;
    if (score > best) {
      best = score;
      elBest.textContent = best;
      // 계약: 신기록 시에만 setItem (서빙 후킹이 캡처)
      try { localStorage.setItem('orbitBest', String(best)); } catch (e) {}
    }
  }

  // ── 파티클 (합체 팡 / 흡수) ──
  function burst(x, y, color, tier, suck, tx, ty) {
    const n = 8 + tier;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const sp = 1.5 + Math.random() * 2.5 + tier * 0.2;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 2 + Math.random() * 2.5, color, life: 1,
        suck: !!suck, tx, ty,
      });
    }
  }
  function burstRing(x, y) {
    for (let i = 0; i < 22; i++) {
      const a = (Math.PI * 2 * i) / 22;
      particles.push({
        x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6,
        vx: Math.cos(a) * 4, vy: Math.sin(a) * 4,
        r: 2.5, color: '#3a2f5a', life: 1, ring: true,
      });
    }
  }
  function vibrate(p) { if (!Sound.muted && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} }

  // ── 다음 미리보기 ──
  function pickTier() { return Math.floor(Math.random() * SPAWN_MAX); }
  function refreshNextPreview() {
    if (nextIsBlackhole) {
      elNext.textContent = '🕳️';
      elNext.style.background = 'radial-gradient(circle at 38% 32%, #5a5170, #2c2640)';
      elNext.style.boxShadow = 'inset 0 0 8px #1a1530, 0 0 10px rgba(90,80,130,.5)';
    } else {
      const t = TIERS[nextTier];
      elNext.textContent = t.emoji;
      elNext.style.background = `radial-gradient(circle at 35% 30%, ${t.c1}, ${t.c2})`;
      elNext.style.boxShadow = 'inset 0 2px 4px rgba(255,255,255,.55),0 2px 5px rgba(70,60,105,.18)';
    }
  }
  function rollNext() {
    // 블랙홀: 6번 드롭마다 한 번 정도, 보드에 행성이 충분히 있을 때
    dropCount++;
    if (blackholeCooldown <= 0 && bodies.length >= 5 && Math.random() < 0.5) {
      nextIsBlackhole = true;
      blackholeCooldown = 5 + Math.floor(Math.random() * 3);
    } else {
      nextIsBlackhole = false;
      nextTier = pickTier();
      if (blackholeCooldown > 0) blackholeCooldown--;
    }
    refreshNextPreview();
  }

  // ── 매달린(미리보기) 행성 ──
  let held = null; // {tier,isBlackhole,r}
  function prepHeld() {
    held = nextIsBlackhole
      ? { tier: 2, isBlackhole: true, r: radiusFor(2) }
      : { tier: nextTier, isBlackhole: false, r: radiusFor(nextTier) };
  }

  function clampAim(x, r) {
    return Math.max(WALL + r + 1, Math.min(W - WALL - r - 1, x));
  }

  function drop() {
    if (!running || gameOver || !canDrop || !held) return;
    canDrop = false;
    const x = clampAim(aimX, held.r);
    const b = makePlanet(x, DROP_Y, held.tier, held.isBlackhole);
    bodies.push(b);
    Composite.add(engine.world, b);
    Sound.drop();
    held = null;
    // 다음 굴리고, 낙하 텀 후 다시 드롭 허용 (연타 오염 방지)
    rollNext();
    setTimeout(() => { prepHeld(); canDrop = true; }, 420);
  }

  // ── 입력 (pointer) ──
  function pointerToWorldX(e) {
    const rect = cv.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * W;
  }
  let aiming = false;
  cv.addEventListener('pointerdown', (e) => {
    if (!running || gameOver) return;
    Sound.unlock();
    aiming = true;
    aimX = clampAim(pointerToWorldX(e), held ? held.r : 16);
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  });
  cv.addEventListener('pointermove', (e) => {
    if (!aiming || !running) return;
    aimX = clampAim(pointerToWorldX(e), held ? held.r : 16);
  });
  function release(e) {
    if (!aiming) return;
    aiming = false;
    drop();
  }
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', () => { aiming = false; });

  // ── 게임오버 판정: 위험선 위에 정착한(느린) 행성이 일정시간 지속 ──
  function checkDanger(dt) {
    let over = false;
    for (const b of bodies) {
      if (b.isBlackhole) continue;
      const age = performance.now() - b.spawnAt;
      if (age < 700) continue;                 // 방금 떨어뜨린 건 제외
      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      if (speed > 1.1) continue;                // 아직 움직이는 중이면 제외
      if (b.position.y - b.r < DANGER_Y) { over = true; break; }
    }
    if (over) {
      dangerHold += dt;
      elDanger.classList.add('warn');
      if (dangerHold > 1100) endGame();
    } else {
      dangerHold = Math.max(0, dangerHold - dt * 1.5);
      if (dangerHold < 200) elDanger.classList.remove('warn');
    }
  }

  // ── 렌더 ──
  function drawPlanet(b, x, y, r, tier, isBlackhole, ghost) {
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.55;
    if (isBlackhole) {
      // 블랙홀: 어두운 코어 + 빛 휘는 링 (네온 글로우 아님, 차분히)
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.1, x, y, r);
      g.addColorStop(0, '#2c2640');
      g.addColorStop(0.7, '#3a3358');
      g.addColorStop(1, '#5a5170');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(170,160,210,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.18, r * 0.5, 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }
    const t = TIERS[tier];
    // 본체 그라데이션 (명도폭 좁게)
    const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.34, r * 0.15, x, y, r);
    g.addColorStop(0, t.c1);
    g.addColorStop(1, t.c2);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // 토성 고리
    if (t.ring) {
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(2, r * 0.13);
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.32, r * 0.42, -0.35, 0, Math.PI * 2); ctx.stroke();
    }
    // 크리스프 윗 림 (빛 하나만)
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath(); ctx.arc(x, y, r - 1, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    // 라벨 이모지 (큰 행성만 — 작은 건 뭉개짐)
    if (r > 16) {
      ctx.font = `${Math.round(r * 0.95)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = (ghost ? 0.55 : 1) * 0.92;
      ctx.fillText(t.emoji, x, y + r * 0.04);
    }
    ctx.restore();
  }

  function render(ts) {
    requestAnimationFrame(render);
    const dt = lastTs ? Math.min(ts - lastTs, 50) : 16;
    lastTs = ts;

    if (running && !gameOver) {
      checkDanger(dt);
      decayCombo(dt);
    }

    // 흔들림 오프셋
    let ox = 0, oy = 0;
    if (shake > 0.2) {
      ox = (Math.random() - 0.5) * shake;
      oy = (Math.random() - 0.5) * shake;
      shake *= 0.86;
    } else shake = 0;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);

    // 살아있는 행성
    for (const b of bodies) {
      drawPlanet(b, b.position.x, b.position.y, b.r, b.tier, b.isBlackhole, false);
    }

    // 매달린 미리보기 + 조준선
    if (running && !gameOver && held && canDrop === false) {
      // 떨어지는 중 — 미리보기 숨김
    }
    if (running && !gameOver && held && canDrop) {
      const hx = clampAim(aimX, held.r);
      ctx.save();
      ctx.strokeStyle = 'rgba(120,130,180,.4)';
      ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx, DROP_Y + held.r); ctx.lineTo(hx, H - WALL); ctx.stroke();
      ctx.restore();
      drawPlanet(null, hx, DROP_Y, held.r, held.tier, held.isBlackhole, true);
    }

    // 파티클
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.suck) {
        // 흡수: 목표(블랙홀)로 빨려감
        p.vx += (p.tx - p.x) * 0.06;
        p.vy += (p.ty - p.y) * 0.06;
        p.vx *= 0.9; p.vy *= 0.9;
        p.life -= 0.04;
      } else if (p.ring) {
        p.vx *= 0.92; p.vy *= 0.92; p.life -= 0.045;
      } else {
        p.vy += 0.12; p.vx *= 0.97; p.life -= 0.04;
      }
      p.x += p.vx; p.y += p.vy;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (p.ring ? p.life : 1), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── 흐름 ──
  function startGame() {
    overlay.classList.remove('show');
    fit();
    buildWorld();
    bodies = []; particles = []; mergeQueue = []; consumed.clear();
    score = 0; combo = 0; comboTimer = 0; dangerHold = 0;
    dropCount = 0; blackholeCooldown = 6;
    gameOver = false; running = true; canDrop = true;
    aimX = W / 2;
    elScore.textContent = '0';
    elCombo.classList.remove('show');
    elDanger.classList.remove('warn');
    Runner.run(runner, engine);
    Sound.unlock();
    nextIsBlackhole = false; nextTier = pickTier();
    prepHeld();
    refreshNextPreview();
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true; running = false; canDrop = false;
    Runner.stop(runner);
    Sound.over();
    const isRec = score >= best && score > 0;
    if (isRec) { try { localStorage.setItem('orbitBest', String(score)); } catch (e) {} setTimeout(() => Sound.rec(), 350); }
    setTimeout(() => {
      ovTitle.textContent = '게임 오버';
      recmark.style.display = isRec ? 'block' : 'none';
      ovScore.style.display = 'block'; ovScore.textContent = score;
      ovSub.textContent = isRec ? '새로운 우주 최고 기록!' : `최고 기록 ${best}점`;
      startBtn.textContent = '다시 시작';
      overlay.classList.add('show');
    }, 600);
  }

  // ── 음소거 ──
  function syncMute() { muteBtn.textContent = Sound.muted ? '🔇' : '🔊'; }
  muteBtn.addEventListener('click', () => { Sound.toggle(); syncMute(); });

  startBtn.addEventListener('click', () => { Sound.unlock(); startGame(); });

  // ── 리사이즈 ──
  let rzTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      paintStars();
      if (!running) fit();
      // 진행 중 리사이즈는 비율 변동 위험 → 보드만 유지 (간단히 재맞춤 생략)
    }, 200);
  });

  // ── 초기화 ──
  elBest.textContent = best;
  syncMute();
  paintStars();
  paintEvo();
  fit();
  ovScore.style.display = 'none';
  recmark.style.display = 'none';
  requestAnimationFrame(render);

  // 디버그/테스트용 훅
  window.__orbit = {
    drop(x) { aimX = x == null ? W / 2 : x; drop(); },
    state() { return { score, best, combo, bodies: bodies.length, gameOver, running, nextIsBlackhole }; },
    forceBlackhole() { nextIsBlackhole = true; prepHeld(); refreshNextPreview(); },
  };
})();
