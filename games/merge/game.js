// 동물 합치기 (merge) — 수박게임류 드롭 머지. matter.js 물리 + 자체 rAF 렌더.
// 게임 계약: 최고점수 localStorage 'mergeBest'(숫자 문자열), 음소거 'mergeMuted'.
//            신기록 시 반드시 setItem('mergeBest', String(score)) → 포털 후킹이 캡처.
(() => {
  'use strict';
  const { Engine, World, Bodies, Body, Composite, Events } = Matter;

  // ── 동물 사다리(티어) ── 작은 친구 → 큰 친구. 인덱스가 곧 티어.
  // radius는 통 폭(가상 단위 W) 대비 비율. 색은 파스텔 단일 채도, 명도 폭 좁게.
  const W = 360; // 가상 좌표계 폭 (실제 렌더는 DPR 스케일)
  // 동물 이미지: Twemoji 동물 얼굴 (CC BY 4.0), animals/NN-<name>.svg. 작은→큰 진화 순서.
  // img = animals/ 파일명(확장자 제외). 티어 인덱스 = 파일 번호 순서.
  // 반지름을 약 14% 줄였다 — 통에 더 많이 들어가 합치기·고티어 진행이 쉬워진다(난이도 완화).
  const LADDER = [
    { img:'01-mouse',   r:0.062, c:'#f5d9c2' }, // 0
    { img:'02-hamster', r:0.077, c:'#fbd3a8' }, // 1
    { img:'03-rabbit',  r:0.095, c:'#fde2d0' }, // 2
    { img:'04-cat',     r:0.113, c:'#ffd9a0' }, // 3
    { img:'05-dog',     r:0.134, c:'#ffcf9a' }, // 4
    { img:'06-fox',     r:0.156, c:'#ffba7a' }, // 5
    { img:'07-tiger',   r:0.180, c:'#ffc96b' }, // 6
    { img:'08-cow',     r:0.206, c:'#ffe0b0' }, // 7
    { img:'09-pig',     r:0.234, c:'#ffc7cf' }, // 8
    { img:'10-panda',   r:0.262, c:'#f0e6dc' }, // 9
    { img:'11-bear',    r:0.292, c:'#e9c39a' }, // 10 (최종)
  ];
  const MAX_TIER = LADDER.length - 1;

  // 동물 이미지 preload → 오프스크린 캔버스에 128px 래스터.
  // Twemoji SVG는 viewBox만 있고 intrinsic width/height가 없어, 직접 drawImage가
  // 빈 화면이 될 수 있다 → 로드되면 128 캔버스에 한 번 그려 그 캔버스를 소스로 쓴다.
  const ANIMAL_CANVAS = new Array(LADDER.length).fill(null);   // tier → HTMLCanvasElement | null
  function preloadAnimals() {
    const RASTER = 128;
    LADDER.forEach((def, tier) => {
      const img = new Image();
      img.width = img.height = RASTER;   // intrinsic size 보강
      img.onload = () => {
        const oc = document.createElement('canvas');
        oc.width = oc.height = RASTER;
        const octx = oc.getContext('2d');
        try { octx.drawImage(img, 0, 0, RASTER, RASTER); } catch (_) { return; }
        ANIMAL_CANVAS[tier] = oc;
      };
      img.src = 'animals/' + def.img + '.svg';
    });
  }

  // 특수아이템(소용돌이) 글리프 — index.html #g-vortex 와 동일 path. (동물은 이미지 사용)
  const GLYPH_P = {};
  const VORTEX_D = "M256 32C132.3 32 32 132.3 32 256s100.3 224 224 224 224-100.3 224-224S379.7 32 256 32zm0 64c25.3 0 49.3 5.6 70.8 15.6-12.5 4.3-25.9 11.4-39.4 21.4-30.2 22.4-58.6 57.3-76.9 99.6-18.3 42.3-24.1 84.9-19.4 117.6 2.1 14.6 6.2 28.1 12.5 39.3C147.8 421 96 344.6 96 256c0-88.4 71.6-160 160-160zm106.7 53.3c25.5 28.4 41.3 65.9 41.3 106.7 0 88.4-71.6 160-160 160-8.9 0-17.7-.7-26.2-2.1 1.4-.9 2.8-1.9 4.2-2.9 30.2-22.4 58.6-57.3 76.9-99.6 18.3-42.3 24.1-84.9 19.4-117.6-2.1-14.6-6.2-28.1-12.5-39.3 19.5-6.9 38.6-9.3 56.9-5.2zM256 176c44.2 0 80 35.8 80 80s-35.8 80-80 80-80-35.8-80-80 35.8-80 80-80z";
  // 점수: 합쳐서 생긴 동물의 티어 가치 (수박게임식: 티어 n 생성 시 가산)
  const TIER_SCORE = LADDER.map((_, i) => (i * (i + 1)) / 2 * 1 + i); // 부드럽게 증가
  // 떨어뜨릴 때 등장 가능한 티어 (작은 5종만 — 검증된 진행)
  const SPAWN_MAX = 4;

  // ── 특수아이템(블랙홀/소용돌이) 밸런스 ──
  // 행성합치기 블랙홀 흡수: 닿은 동물과 같은 종류 전부 흡수. "아주 가끔만" → 보장 간격 + 낮은 확률.
  const SPECIAL_FIRST_GAP = 22;   // 첫 특수는 이만큼 드롭한 뒤부터 후보 (일반 한 판 안에 한 번은 볼 수 있게)
  const SPECIAL_MIN_GAP = 40;     // 특수가 나온 뒤엔 이만큼 지나야 다음 후보 (재등장은 더 드물게)
  const SPECIAL_CHANCE = 0.03;    // 게이트 통과 후 매 드롭 3% → 첫 특수 평균 ~drop 55, 이후 ~70드롭당 1회
  const SPECIAL_R = 0.088;        // 통 폭 대비 반지름 (동물 축소에 맞춰 살짝 줄임)
  // ── 콤보(연쇄) ──
  const COMBO_WINDOW = 520;       // ms 안에 다음 합체가 나면 콤보 유지
  // ── 잭팟(최상위 티어) 보너스 ──
  const JACKPOT_BONUS = 2000;     // 최종 동물(bear) 생성 시 추가 점수
  const SHIMMER_TIER = MAX_TIER - 2; // 이 티어부터 은은한 반짝임 (기대감)

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
  const evoEl = document.getElementById('evo');
  const againBtn = document.getElementById('btn-again');
  const comboEl = document.getElementById('combo');
  const comboXEl = document.getElementById('combo-x');

  // 동물 이미지를 담은 작은 HTML (HTML 칩/미리보기/진화표용)
  function glyphSvg(tier, px) {
    return `<img src="animals/${LADDER[tier].img}.svg" alt="" style="width:${px}px;height:${px}px;display:block;" draggable="false">`;
  }
  function setNextGlyph(tier) {
    if (tier === null) { nextFaceEl.innerHTML = `<svg class="ki" style="width:18px;height:18px;color:#7b5cff"><use href="#g-vortex"/></svg>`; return; }
    nextFaceEl.innerHTML = glyphSvg(tier, 18);
  }
  function setOverGlyph(tier) { overFaceEl.innerHTML = glyphSvg(tier, 54); }

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
  const popRings = [];           // 합칠 때 통통 링 + 확장 링
  const floatTexts = [];         // 점수/콤보 떠오르는 텍스트
  let overflowSince = 0;         // 위험선 초과 시작 시각(연속 측정)
  // 콤보
  let comboCount = 0;            // 현재 연쇄 수
  let comboTimer = 0;            // 콤보 만료 타이머(ms)
  // 특수아이템
  let dropsSinceStart = 0;       // 시작 후 누적 드롭 수 (첫 특수 게이트)
  let dropsSinceSpecial = 999;   // 특수 나온 뒤 드롭 수 (첫 특수는 이 게이트 무시되도록 크게 시작)
  let curSpecial = false;        // 지금 손에 든 게 특수인가
  let nextSpecial = false;       // 다음이 특수인가
  // 화면 흔들림 (canvas translate — 레이아웃 건드리지 않음)
  let shakeAmt = 0;              // 남은 흔들림 강도(px, 가상)

  function rndSpawn() { return Math.floor(Math.random() * SPAWN_MAX); }
  // 다음 손패가 특수가 될지 결정 (게이트 통과 + 낮은 확률)
  function rollSpecial() {
    if (dropsSinceStart < SPECIAL_FIRST_GAP) return false;   // 너무 이른 등장 방지
    if (dropsSinceSpecial < SPECIAL_MIN_GAP) return false;   // 직전 특수 후 충분히 지나야
    return Math.random() < SPECIAL_CHANCE;
  }
  function addShake(px) { shakeAmt = Math.min(26, shakeAmt + px); }

  // 물리 벽 두께 (가상 단위). 좌/우/바닥 정적 바디.
  const WALL_T = 60;
  let wallLeft = null, wallRight = null, wallFloor = null;

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
    // 보드 높이(H)가 레이아웃/리사이즈로 바뀌면 물리 바닥·벽도 따라가야
    // 공이 시각적 바닥 밑으로 빠지지 않는다. (벽은 buildWorld에서 만들고 여기서 위치만 갱신)
    repositionWalls();
  }

  // 좌/우/바닥 정적 바디 위치를 현재 H에 맞춤 (캔버스 가시 영역과 일치)
  function repositionWalls() {
    if (wallFloor) Body.setPosition(wallFloor, { x: W / 2, y: H + WALL_T / 2 });
    if (wallLeft)  Body.setPosition(wallLeft,  { x: -WALL_T / 2, y: H / 2 });
    if (wallRight) Body.setPosition(wallRight, { x: W + WALL_T / 2, y: H / 2 });
  }

  // ── 물리 월드 구성 ──
  function buildWorld() {
    engine = Engine.create();
    engine.gravity.y = 1.15;
    world = engine.world;
    // 벽: 좌/우/바닥 (가상 좌표). 두껍게 바깥으로 빼서 새지 않게.
    const t = WALL_T;
    const opt = { isStatic: true, restitution: 0.1, friction: 0.6 };
    wallLeft  = Bodies.rectangle(-t/2, H/2, t, H*2, opt);          // left
    wallRight = Bodies.rectangle(W + t/2, H/2, t, H*2, opt);        // right
    wallFloor = Bodies.rectangle(W/2, H + t/2, W*2, t, opt);        // floor
    World.add(world, [wallLeft, wallRight, wallFloor]);
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
    b.special = false;
    b.merged = false;
    b.born = performance.now();
    b.spawnAt = b.born;
    b.squash = 0;     // 머지 직후 통통 스쿼시(0~1, 감쇠)
    b.spin = 0;
    bodies.add(b);
    World.add(world, b);
    return b;
  }

  // ── 특수아이템(소용돌이) 바디 — tier 없음. merge 시스템 밖. ──
  function makeSpecial(x, y) {
    const r = SPECIAL_R * W;
    const b = Bodies.circle(x, y, r, {
      restitution: 0.1, friction: 0.6, frictionStatic: 0.8, density: 0.0014,
    });
    b.tier = undefined;   // 사다리 밖
    b.special = true;
    b.consumed = false;   // 한 번 흡수하면 소멸
    b.merged = false;
    b.born = performance.now();
    b.spawnAt = b.born;
    b.squash = 0;
    b.spin = 0;           // 회전 각도(렌더용 소용돌이)
    bodies.add(b);
    World.add(world, b);
    return b;
  }

  // ── 충돌: 같은 티어끼리 머지 (dedup 큐) ──
  const mergeQueue = [];
  const vacuumQueue = [];   // [특수바디, 흡수할 티어]
  function onCollide(ev) {
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      // 특수아이템: tier 있는 동물과 닿으면 그 티어 전부 흡수
      const sp = a.special ? a : (b.special ? b : null);
      if (sp) {
        const other = sp === a ? b : a;
        if (!sp.consumed && other.tier !== undefined && !other.special) {
          sp.consumed = true;          // 즉시 소비 플래그 (재트리거 방지)
          vacuumQueue.push([sp, other.tier]);
        }
        continue;
      }
      if (a.tier === undefined || b.tier === undefined) continue; // 벽
      if (a.tier !== b.tier) continue;
      if (a.merged || b.merged) continue;       // 이미 소비됨 → 스킵 (THE 수박게임 버그 방어)
      if (a.tier >= MAX_TIER) continue;          // 최종 동물은 더 안 합쳐짐
      a.merged = true; b.merged = true;          // 즉시 플래그 → 같은 틱 다른 페어가 재사용 못함
      mergeQueue.push([a, b]);
    }
  }

  function processMerges() {
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

      // 콤보: 직전 합체로부터 COMBO_WINDOW 안이면 누적
      bumpCombo();
      const mult = comboCount >= 2 ? comboCount : 1;  // 2연쇄부터 배율
      const base = TIER_SCORE[nt];
      const gain = base * mult;
      addScore(gain);

      // 이펙트 — 티어 클수록 화려: 파티클·링·흔들림 비례
      burst(mx, my, LADDER[nt].c, nt);
      popRings.push({ x:mx, y:my, r:LADDER[nt].r*W, t:0, kind:'pop' });
      if (nt >= 5) popRings.push({ x:mx, y:my, r:LADDER[nt].r*W*0.6, t:0, kind:'expand', c:LADDER[nt].c });
      addShake(2 + nt * 0.9);
      floatTexts.push({ x:mx, y:my, t:0, txt:'+'+gain, big: nt>=6, c:'#ff7a59' });

      // 사운드 + 햅틱 (티어/콤보 높을수록 음 높게)
      sfxMerge(nt + (mult > 1 ? 2 : 0));
      haptic(nt >= 6 ? [12,30,12] : 14);

      // 잭팟: 최종 동물(bear) 탄생 → 대형 보너스 + 화면 가득 축하
      if (nt === MAX_TIER) jackpot(mx, my);
    }
  }

  // ── 콤보 ──
  function bumpCombo() {
    if (comboTimer > 0) comboCount++; else comboCount = 1;
    comboTimer = COMBO_WINDOW;
    if (comboCount >= 2) {
      comboXEl.textContent = 'x' + comboCount;
      comboEl.classList.add('show');
      comboEl.classList.remove('pulse');
      void comboEl.offsetWidth;            // reflow → 애니 재시작
      comboEl.classList.add('pulse');
      haptic(8);
    }
  }
  function clearCombo() {
    comboCount = 0; comboTimer = 0;
    comboEl.classList.remove('show', 'pulse');
  }

  // ── 잭팟: 최상위 티어 ──
  function jackpot(x, y) {
    addScore(JACKPOT_BONUS);
    floatTexts.push({ x, y: y - LADDER[MAX_TIER].r*W - 10, t:0, txt:'잭팟! +'+JACKPOT_BONUS, big:true, c:'#ff5a2a', jackpot:true });
    addShake(22);
    // 화면 가득 파티클 (사방에서)
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 7;
      const cols = ['#ffd089','#ff9a6b','#ffe2a6','#ffba7a','#ff7a59'];
      particles.push({
        x: W*0.5 + (Math.random()-0.5)*W*0.6,
        y: H*0.5 + (Math.random()-0.5)*H*0.4,
        vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 2,
        r: 2.5 + Math.random()*4, life: 1.4,
        color: cols[(Math.random()*cols.length)|0], star: Math.random()<0.4,
      });
    }
    popRings.push({ x, y, r: LADDER[MAX_TIER].r*W, t:0, kind:'expand', c:'#ffd089' });
    popRings.push({ x, y, r: LADDER[MAX_TIER].r*W*0.5, t:-8, kind:'expand', c:'#ff9a6b' });
    sfxBig();
    haptic([20,40,20,40,40]);
  }

  // ── 특수아이템 흡수 처리 ──
  function processVacuum() {
    while (vacuumQueue.length) {
      const [sp, tier] = vacuumQueue.shift();
      if (!bodies.has(sp)) continue;
      const cx = sp.position.x, cy = sp.position.y;
      // 같은 티어 동물 전부 수집
      const victims = [];
      for (const o of bodies) {
        if (o === sp || o.special || o.tier !== tier) continue;
        victims.push(o);
      }
      // 흡수 연출: 큰 소용돌이 링 + 파티클이 중심으로 빨려듦
      removeBody(sp);
      let total = 0;
      for (const v of victims) {
        const vx = v.position.x, vy = v.position.y;
        removeBody(v);
        total += TIER_SCORE[Math.min(tier + 1, MAX_TIER)];
        // 빨려드는 파티클 (중심 방향)
        for (let i = 0; i < 6; i++) {
          const dx = cx - vx, dy = cy - vy;
          particles.push({ x: vx, y: vy, vx: dx*0.04, vy: dy*0.04, r:2+Math.random()*3, life:0.9, color:LADDER[tier].c });
        }
      }
      const gain = Math.max(total, TIER_SCORE[tier] * 2);
      addScore(gain);
      // 큰 흡수 링 2겹 + 텍스트 + 강한 흔들림
      popRings.push({ x:cx, y:cy, r:SPECIAL_R*W, t:0, kind:'expand', c:'#7b5cff' });
      popRings.push({ x:cx, y:cy, r:SPECIAL_R*W*0.5, t:-6, kind:'expand', c:'#b89bff' });
      for (let i = 0; i < 40; i++) {
        const a = Math.random()*Math.PI*2, s = 2+Math.random()*6;
        particles.push({ x:cx, y:cy, vx:Math.cos(a)*s, vy:Math.sin(a)*s-1.5, r:2+Math.random()*3.5, life:1.1, color:i%2?'#b89bff':LADDER[tier].c });
      }
      floatTexts.push({ x:cx, y:cy, t:0, txt:'흡수! +'+gain+' (' + (victims.length+0) + ')', big:true, c:'#7b5cff' });
      addShake(14 + Math.min(victims.length, 8));
      sfxVacuum(victims.length);
      haptic([15,30,15,30,20]);
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
    if (curSpecial) {
      const r = SPECIAL_R * W;
      const cx = Math.max(r + 4, Math.min(W - r - 4, x));
      const b = makeSpecial(cx, DROP_Y);
      Body.setVelocity(b, { x: 0, y: 0 });
      sfxDrop(0);
      haptic(10);
      dropsSinceSpecial = 0;
    } else {
      const r = LADDER[curTier].r * W;
      const cx = Math.max(r + 4, Math.min(W - r - 4, x));
      const b = makeAnimal(curTier, cx, DROP_Y);
      Body.setVelocity(b, { x: 0, y: 0 });
      sfxDrop(curTier);
      haptic(8);
      dropsSinceSpecial++;
    }
    dropsSinceStart++;
    // 다음으로 회전
    curTier = nextTier; curSpecial = nextSpecial;
    nextTier = rndSpawn();
    nextSpecial = rollSpecial();
    setNextGlyph(nextSpecial ? null : nextTier);
    // 쿨다운: 다음 동물이 스폰존을 통과할 시간 확보 (스팸 드롭 → 즉시 오버 방지)
    canDrop = false;
    dropCooldownUntil = performance.now() + 420;
  }

  // ── 게임오버 판정: 위험선 위에 "정착한" 바디가 연속 1s 이상 ──
  function checkOver(now) {
    let danger = false;
    for (const b of bodies) {
      if (b.merged || b.special) continue;          // 특수는 곧 사라짐 → 게임오버 판정 제외
      if (now - b.spawnAt < 700) continue;          // 갓 떨어진 건 통과 중 → 무시
      const r = LADDER[b.tier].r * W;
      const top = b.position.y - r;
      const settled = Math.abs(b.velocity.y) < 1.4 && Math.abs(b.velocity.x) < 1.4;
      if (top < DEATH_Y && settled) { danger = true; break; }
    }
    if (danger) {
      if (!overflowSince) overflowSince = now;
      else if (now - overflowSince > 1500) endGame();
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
    setOverGlyph(topTier);
    overEl.classList.add('show');
    sfxOver();
    haptic([30,60,30]);
    // 신기록 공유 제안은 게임오버 때만(플레이 중 점수 갱신마다 뜨지 않게) — 이번 판 신기록 있으면 1회.
    if (window.GamePortal && GamePortal.shareResult) GamePortal.shareResult();
    // 게임 끝나면 후원+의견 (포털 공용 모달 — 모든 게임 동일)
    if (window.GamePortal) setTimeout(function () { GamePortal.openSupport(); }, 1000);
  }

  function reset() {
    overEl.classList.remove('show');
    if (world) { World.clear(world, false); Engine.clear(engine); }
    bodies.clear(); particles.length = 0; popRings.length = 0; mergeQueue.length = 0;
    vacuumQueue.length = 0; floatTexts.length = 0;
    scoreVal = 0; scoreEl.textContent = '0';
    bestEl.textContent = best;
    overflowSince = 0; gameOver = false; canDrop = true;
    shakeAmt = 0; clearCombo();
    dropsSinceStart = 0; dropsSinceSpecial = 999;
    curSpecial = false; nextSpecial = false;
    curTier = rndSpawn(); nextTier = rndSpawn();
    setNextGlyph(nextSpecial ? null : nextTier);
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
      processVacuum();
      checkOver(now);
      // 콤보 만료
      if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) clearCombo(); }
    }
    // 흔들림 감쇠 (running 여부와 무관 — 잭팟 후 부드럽게)
    if (shakeAmt > 0) { shakeAmt *= Math.pow(0.82, dt / 16.666); if (shakeAmt < 0.3) shakeAmt = 0; }
    draw(now, dt);
  }

  function draw(now, dt) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);
    // 화면 흔들림 — canvas 평행이동 (레이아웃 무관)
    if (shakeAmt > 0) {
      ctx.translate((Math.random()-0.5)*shakeAmt, (Math.random()-0.5)*shakeAmt);
    }

    // 위험선 (점선) — 데스라인
    ctx.save();
    ctx.strokeStyle = 'rgba(255,122,89,0.55)';
    ctx.lineWidth = 1.6; ctx.setLineDash([7, 6]);
    ctx.beginPath(); ctx.moveTo(0, DEATH_Y); ctx.lineTo(W, DEATH_Y); ctx.stroke();
    ctx.restore();

    // 조준 가이드 + 손에 든 동물 (떨어뜨리기 전)
    if (running && !gameOver) {
      const r = (curSpecial ? SPECIAL_R : LADDER[curTier].r) * W;
      const cx = Math.max(r + 4, Math.min(W - r - 4, aimX));
      // 가이드 라인
      ctx.save();
      ctx.strokeStyle = 'rgba(120,85,55,0.18)';
      ctx.lineWidth = 1.4; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(cx, DROP_Y + r); ctx.lineTo(cx, H); ctx.stroke();
      ctx.restore();
      const bob = canDrop ? Math.sin(now / 300) * 2 : 0;
      if (curSpecial) drawSpecial(cx, DROP_Y + bob, now / 600, now);
      else drawAnimal(cx, DROP_Y + bob, curTier, 0, canDrop ? 1 : 0.55, 0, now);
    }

    // 동물들 + 특수
    for (const b of bodies) {
      if (b.squash > 0) b.squash *= Math.pow(0.86, dt / 16.666);
      if (b.squash < 0.02) b.squash = 0;
      if (b.special) { b.spin += dt / 16.666 * 0.16; drawSpecial(b.position.x, b.position.y, b.spin, now); }
      else drawAnimal(b.position.x, b.position.y, b.tier, b.angle, 1, b.squash, now);
    }

    // 링 (pop=통통 흰 링 / expand=색 확장 링)
    for (let i = popRings.length - 1; i >= 0; i--) {
      const ring = popRings[i];
      ring.t += dt / 16.666;
      if (ring.t < 0) continue;                       // 딜레이된 링
      const dur = ring.kind === 'expand' ? 28 : 22;
      const p = ring.t / dur;
      if (p >= 1) { popRings.splice(i, 1); continue; }
      ctx.save();
      if (ring.kind === 'expand') {
        ctx.globalAlpha = (1 - p) * 0.85;
        ctx.strokeStyle = ring.c || '#ffffff';
        ctx.lineWidth = 5 * (1 - p) + 1;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r * (1 + p * 2.6), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = (1 - p) * 0.7;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3 * (1 - p);
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r * (1 + p * 0.7), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 파티클 (원 + 가끔 별)
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life -= 0.045 * (dt / 16.666);
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      if (p.star) { drawStar(p.x, p.y, p.r * 1.6, p.r * 0.7, 4); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }

    // 떠오르는 점수/콤보 텍스트
    for (let i = floatTexts.length - 1; i >= 0; i--) {
      const f = floatTexts[i];
      f.t += dt / 16.666;
      const p = f.t / (f.big ? 60 : 42);
      if (p >= 1) { floatTexts.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p);
      const pop = f.t < 8 ? f.t / 8 : 1;               // 등장 팝
      const fs = (f.big ? 24 : 16) * (0.6 + pop * 0.5);
      ctx.font = `800 ${fs}px "Pretendard Variable",-apple-system,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.fillStyle = f.c;
      const ty = f.y - p * (f.big ? 46 : 30);
      ctx.strokeText(f.txt, f.x, ty); ctx.fillText(f.txt, f.x, ty);
      ctx.restore();
    }

    ctx.restore();
  }

  // 별 파티클 (잭팟용)
  function drawStar(cx, cy, R, r, n) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const rad = i % 2 ? r : R;
      const a = (Math.PI * i) / n - Math.PI / 2;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  }

  // 특수아이템(소용돌이) — 보라빛 회전 + 빨아들이는 호
  function drawSpecial(x, y, spin, now) {
    const r = SPECIAL_R * W;
    ctx.save();
    ctx.translate(x, y);
    // 바닥 하드섀도
    ctx.save(); ctx.translate(r*0.12, r*0.16); ctx.fillStyle = 'rgba(60,40,90,0.22)';
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill(); ctx.restore();
    // 몸통 (짙은 보라 → 가운데 검정 코어, 행성합치기 블랙홀)
    const g = ctx.createRadialGradient(0,0,r*0.1,0,0,r);
    g.addColorStop(0,'#1c1530'); g.addColorStop(0.55,'#5b3fb0'); g.addColorStop(1,'#9b7dff');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
    ctx.lineWidth = Math.max(1.4, r*0.06); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
    // 회전 소용돌이 글리프
    ctx.save();
    ctx.rotate(spin);
    const gp = GLYPH_P.vortex || (GLYPH_P.vortex = new Path2D(VORTEX_D));
    const gs = (r * 1.7) / 512; ctx.scale(gs, gs); ctx.translate(-256,-256);
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fill(gp);
    ctx.restore();
    // 반짝 코어
    const pulse = 0.5 + 0.5*Math.sin(now/180);
    ctx.globalAlpha = 0.4 + pulse*0.4;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0,0,r*0.14,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function drawAnimal(x, y, tier, angle, alpha, squash = 0, now = 0) {
    const def = LADDER[tier];
    const r = def.r * W;
    // 스쿼시: 잠깐 가로로 납작했다 통통 (탄성 — 더 말랑하게)
    const sq = squash > 0 ? Math.sin(squash * Math.PI) * 0.30 : 0;
    // 살아있는 느낌: 미세한 숨쉬기 (티어별 위상 다르게)
    const breathe = Math.sin(now / 620 + tier * 1.3) * 0.012;
    const sx = 1 + sq + breathe, sy = 1 - sq + breathe;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(sx, sy);

    // 바닥 하드섀도 (블러 0) — "사탕이 바닥에 놓인" 느낌
    ctx.save();
    ctx.translate(r * 0.10, r * 0.15);
    ctx.fillStyle = 'rgba(120,85,55,0.18)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 몸통: 단일 색조 + 명도 폭 좁은 그라데이션 (위 살짝 밝게)
    const lighter = shade(def.c, 10);
    const darker = shade(def.c, -8);
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, lighter);
    g.addColorStop(0.55, def.c);
    g.addColorStop(1, darker);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // 외곽선 — 따뜻한 갈색 한 색 (검정 금지)
    ctx.lineWidth = Math.max(1.4, r * 0.055);
    ctx.strokeStyle = 'rgba(120,82,52,0.40)';
    ctx.stroke();

    // 글로시 하이라이트: 윗쪽 둥근 빛 (사탕/스티커 광택) — 원판 위에 먼저
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    const hl = ctx.createRadialGradient(-r*0.3, -r*0.42, r*0.05, -r*0.3, -r*0.42, r*0.85);
    hl.addColorStop(0, 'rgba(255,255,255,0.55)');
    hl.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath(); ctx.ellipse(-r*0.28, -r*0.40, r*0.66, r*0.48, -0.35, 0, Math.PI*2); ctx.fill();
    // 크리스프 윗 림 (한 줄 빛)
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath(); ctx.arc(0, -r * 0.04, r * 0.92, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke();
    ctx.restore();

    // 동물 얼굴 이미지 (주인공) — 원+광택 위에, 원 지름의 ~78%로 중앙 정렬.
    // 오프스크린 래스터 캔버스를 소스로 사용 (Twemoji SVG intrinsic size 없음 대응).
    const src = ANIMAL_CANVAS[tier];
    if (src) {
      const d = r * 1.56;   // 지름(2r)의 ~78%
      ctx.drawImage(src, -d / 2, -d / 2, d, d);
    }

    // 잭팟 기대감: 상위 티어 은은한 반짝임 테두리
    if (tier >= SHIMMER_TIER) {
      const sh = 0.35 + 0.35 * Math.sin(now / 260 + tier);
      ctx.save();
      ctx.globalAlpha = alpha * sh;
      ctx.strokeStyle = 'rgba(255,200,90,0.9)';
      ctx.lineWidth = Math.max(1.6, r * 0.06);
      ctx.beginPath(); ctx.arc(0, 0, r + 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

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

  // ── 음소거 / 버튼 ── 스피커 글리프 swap (vase 패턴)
  function refreshMute() {
    const u = muteBtn.querySelector('use');
    if (u) u.setAttribute('href', muted ? '#p-speaker-slash' : '#p-speaker-high');
  }
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem('mergeMuted', muted ? '1' : '0'); // lww 동기화 대상
    refreshMute();
    audioInit();
    if (!muted) sfxDrop(2);
  });
  againBtn.addEventListener('click', () => { audioInit(); reset(); });

  // ── 진화 사다리 미니 전시 ──
  // 게임오버 카드(화살표 포함)
  function buildEvoRow() {
    evoRow.innerHTML = '';
    LADDER.forEach((d, i) => {
      const sp = document.createElement('span');
      sp.className = 'e';
      sp.style.background = d.c;
      sp.innerHTML = glyphSvg(i, 15);
      evoRow.appendChild(sp);
      if (i < MAX_TIER) {
        const ar = document.createElement('span');
        ar.className = 'arr'; ar.textContent = '›';
        evoRow.appendChild(ar);
      }
    });
  }
  // 항상 보이는 하단 진화표 (작은→큰 순서, 색 구분 보완)
  function buildEvo() {
    if (!evoEl) return;
    evoEl.innerHTML = LADDER.map((d, i) =>
      `<div class="e${i === MAX_TIER ? ' top' : ''}" title="티어 ${i + 1}" style="background:${d.c}">${glyphSvg(i, 15)}</div>`
    ).join('');
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
    [72, 76, 79, 84, 88].forEach((m, i) => setTimeout(() => tone(mtof(m), 0.34, 'triangle', 0.22), i * 70));
  }
  function sfxVacuum(count) {
    if (!actx || muted) return;
    // 빨아들이는 하강 스윕 + 쾅 (흡수 수만큼 밝게)
    tone(880, 0.35, 'sawtooth', 0.18, 130);
    setTimeout(() => { tone(mtof(64), 0.28, 'triangle', 0.22); tone(mtof(71), 0.26, 'sine', 0.12); }, 260);
  }
  function sfxOver() {
    if (!actx || muted) return;
    [60, 56, 51].forEach((m, i) => setTimeout(() => tone(mtof(m), 0.32, 'sawtooth', 0.16, mtof(m - 5)), i * 110));
  }
  function haptic(p) { if (navigator.vibrate && !muted) { try { navigator.vibrate(p); } catch (_) {} } }

  // ── 부팅 ──
  function boot() {
    preloadAnimals();
    resize();
    buildEvoRow();
    buildEvo();
    refreshMute();
    bestEl.textContent = best;
    reset();
    requestAnimationFrame(frame);
  }
  let resizeRaf = 0;
  function scheduleResize() {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(resize);
  }
  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);
  // PWA standalone 등에서 레이아웃이 로드 후 뒤늦게 커질 때 window 'resize'가 안 와도
  // 보드(wrap) 실제 크기 변화를 직접 감지해 H·바닥 벽을 재동기화 (공이 바닥 밑으로 빠지는 버그 방지).
  if (window.ResizeObserver && wrap) {
    new ResizeObserver(scheduleResize).observe(wrap);
  }
  // standalone 진입 시 dvh가 한 박자 늦게 확정되는 경우 대비한 안전망
  setTimeout(scheduleResize, 300);
  document.addEventListener('visibilitychange', () => { if (document.hidden && actx) actx.suspend && actx.suspend(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
