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

  // ── 아이템 시스템: 충전 게이지로 벌고(반-지배), 획득 종류는 랜덤, 트레이(3칸)에 쌓아 언제 쓸지 선택 ──
  // ▼▼▼ 튜닝 상수 (다음 플레이 후 조정) ▼▼▼
  const CHARGE_FULL = 50;           // 게이지 만충 값 (만충 시 랜덤 아이템 1개 트레이에 추가·게이지 0)
  //   합체 1회당 충전 = (생성티어+1) × (콤보≥2면 1.5). 저티어 합체는 조금·고티어/콤보는 많이
  //   → 잔챙이 파밍으론 여전히 느리게(반-스팸). 괜찮게 플레이해 ~15-18합체당 아이템 1개.
  const chargeGain = (newTier, combo) => (newTier + 1) * (combo >= 2 ? 1.5 : 1);
  const TRAY_MAX = 3;               // 트레이 최대 칸 수 (가득이면 게이지는 만충에서 대기)
  // 가중 랜덤 풀: 자석 35 · 폭탄 30 · 흔들기 20 · 집게 15
  const ITEM_POOL = [
    { kind:'magnet', w:35 },
    { kind:'bomb',   w:30 },
    { kind:'shake',  w:20 },
    { kind:'tongs',  w:15 },
  ];
  // 아이템 정의: 아이콘(2층 시스템)·색조·조준형 여부·라벨
  const ITEM_DEF = {
    bomb:   { icon:'#g-vortex',              color:'#7b5cff', aim:true,  label:'소용돌이' },
    magnet: { icon:'#p-magnet',              color:'#e5484d', aim:false, label:'자석'   },
    shake:  { icon:'#p-arrows-out-cardinal', color:'#e8912a', aim:false, label:'흔들기' },
    tongs:  { icon:'#p-hand-grabbing',       color:'#1f9e58', aim:true,  label:'집게'   },
  };
  // ── 폭탄(소용돌이) ──
  const CLUTTER_MAX_TIER = 1;       // 폭탄이 지우는 최대 티어 (0=mouse,1=hamster까지 = 잔챙이만)
  const BLAST_R = 0.40;             // 착탄 반경 (통 폭 W 대비 비율)
  // ── 자석 ── 같은 티어끼리 서로 끌어당김 → 충돌 → 자연 합체
  const MAGNET_DUR = 1300;          // 지속 시간(ms) — 낀 것이 짝까지 이동할 시간
  const MAGNET_ACCEL = 2.4;         // 끌어당김 세기(중력 대비 배율, gravity.y=1.15) — 질량 무관(force=accel*mass*0.001). 쌓인 더미 뚫을 만큼 세게
  const MAGNET_MAX_SPEED = 11;      // 자석 중 속도 상한(물리 폭주 방지)
  const MAGNET_RANGE = 1.1;         // 끌어당김 유효 거리(통 폭 W 대비) — 판 전역 짝 탐색
  // ── 흔들기 ── 판 전체에 짧은 임펄스 → 낀 것 재정착 → 우연 합체
  const SHAKE_KICK_X = 4.0;         // 좌우 임펄스 최대(가상단위/frame)
  const SHAKE_KICK_UP = 2.6;        // 위로 톡(가상단위/frame)
  const SHAKE_SPEED_CAP = 9;        // 흔들기 후 속도 상한(통 밖 이탈 방지)
  // ▲▲▲ 튜닝 상수 ▲▲▲
  const SPECIAL_R = 0.088;        // 소용돌이 글리프(착탄 마커) 반지름 (통 폭 대비)
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
  const chargeEl = document.getElementById('charge');
  const chargeFillEl = document.getElementById('charge-fill');
  const chargeLabelEl = document.getElementById('charge-label');
  const slotEls = Array.from(document.querySelectorAll('#tray .slot'));

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
  let aimX = W / 2;              // 현재 조준 x (드롭용)
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
  // 아이템 시스템 (충전 게이지 + 트레이 + 조준)
  let charge = 0;               // 0 → CHARGE_FULL
  let tray = [];                // 획득 아이템 kind[] (최대 TRAY_MAX)
  let aimKind = null;           // 조준 중인 아이템 kind ('bomb'|'tongs') 또는 null
  let aimIndex = -1;            // 조준 중인 트레이 인덱스
  let aimPX = W / 2;            // 조준 포인터 x (자유)
  let aimPY = W * 0.6;          // 조준 포인터 y (자유)
  let magnetUntil = 0;          // 자석 효과 종료 시각(performance.now)
  // 화면 흔들림 (canvas translate — 레이아웃 건드리지 않음)
  let shakeAmt = 0;              // 남은 흔들림 강도(px, 가상)
  // 진행 단계 (최고 동물 티어 기준) — 배경/배경음/효과음이 함께 진화 → "다음엔 뭐가?" 기대감
  let maxTierEver = 0;
  let stageBanner = null, stageFlash = null;

  function rndSpawn() { return Math.floor(Math.random() * SPAWN_MAX); }
  function addShake(px) { shakeAmt = Math.min(26, shakeAmt + px); }

  // ── 충전 게이지 + 트레이 UI ──
  function refreshCharge() {
    const pct = Math.max(0, Math.min(100, (charge / CHARGE_FULL) * 100));
    chargeFillEl.style.width = pct + '%';
    const trayFull = tray.length >= TRAY_MAX;
    const full = charge >= CHARGE_FULL;
    chargeEl.classList.toggle('full', full && trayFull);
    if (aimKind) chargeLabelEl.textContent = ITEM_DEF[aimKind].label + ' 조준 · 판을 탭';
    else if (full && trayFull) chargeLabelEl.textContent = '칸 비우면 획득';
    else chargeLabelEl.textContent = '충전 ' + Math.floor(pct) + '%';
  }
  function addCharge(n) {
    charge = Math.min(CHARGE_FULL, charge + n);
    tryGrantItem();       // 만충 & 빈 칸 있으면 즉시 아이템 지급
    refreshCharge();
  }
  // 만충 + 트레이 여유 → 가중 랜덤 아이템 1개 지급, 게이지 0. (트레이 가득이면 만충에서 대기)
  function tryGrantItem() {
    if (charge < CHARGE_FULL || tray.length >= TRAY_MAX) return;
    charge = 0;
    const kind = pickItem();
    tray.push(kind);
    renderTray(tray.length - 1);   // 방금 칸 pop 애니
    floatTexts.push({ x: W / 2, y: DROP_Y + 30, t: 0, txt: ITEM_DEF[kind].label + ' 획득!', big: false, c: ITEM_DEF[kind].color });
    sfxItem(); haptic([8, 24]);
  }
  function pickItem() {
    let total = 0; for (const it of ITEM_POOL) total += it.w;
    let r = Math.random() * total;
    for (const it of ITEM_POOL) { if ((r -= it.w) < 0) return it.kind; }
    return ITEM_POOL[0].kind;
  }
  // 트레이 렌더 (popIdx = 방금 채워진 칸이면 등장 애니)
  function renderTray(popIdx) {
    for (let i = 0; i < slotEls.length; i++) {
      const el = slotEls[i];
      const kind = tray[i];
      el.classList.remove('pop');
      if (kind) {
        const d = ITEM_DEF[kind];
        el.classList.add('filled');
        el.classList.toggle('aiming', aimKind !== null && aimIndex === i);
        el.style.color = d.color;
        el.innerHTML = '<svg><use href="' + d.icon + '"/></svg>';
        el.setAttribute('aria-label', d.label + ' 사용');
        if (i === popIdx) { void el.offsetWidth; el.classList.add('pop'); }
      } else {
        el.classList.remove('filled', 'aiming');
        el.style.color = '';
        el.innerHTML = '';
        el.setAttribute('aria-label', '빈 아이템 칸');
      }
    }
  }
  // 트레이 아이템 사용: 조준형이면 조준 모드 진입, 즉발형이면 즉시 실행
  function useItem(idx) {
    if (gameOver || !running) return;
    const kind = tray[idx];
    if (!kind) return;
    audioInit();
    if (aimKind !== null) {          // 이미 조준 중
      if (aimIndex === idx) { cancelAim(); return; }   // 같은 칸 다시 탭 → 취소
      cancelAim();                    // 다른 칸 → 조준 전환
    }
    if (ITEM_DEF[kind].aim) {
      aimKind = kind; aimIndex = idx;
      aimPX = W / 2; aimPY = H * 0.55;
      haptic(10);
    } else {
      if (kind === 'magnet') activateMagnet();
      else if (kind === 'shake') activateShake();
      removeItem(idx);
    }
    renderTray(); refreshCharge();
  }
  function cancelAim() { aimKind = null; aimIndex = -1; renderTray(); refreshCharge(); }
  // 트레이에서 아이템 소비 → 조준 해제 → 대기 중 만충 지급 반영
  function removeItem(idx) {
    tray.splice(idx, 1);
    aimKind = null; aimIndex = -1;
    tryGrantItem();
    renderTray(); refreshCharge();
  }

  // ── 진행 단계: 최고 동물이 오를수록 풍경(배경)·배경음(코드)·효과음이 진화 ──
  const STAGES = [
    { tier: 0, name: '아침 들판',   base: '#fff3e6', deep: '#ffe7d2', vig: '#fcdcc1', glow: '#ffcf9a', chord: [174.61, 261.63, 349.23] },
    { tier: 4, name: '한낮 과수원', base: '#fff0e2', deep: '#ffe0c2', vig: '#ffd2a8', glow: '#ffba7a', chord: [196.00, 293.66, 392.00] },
    { tier: 6, name: '노을 언덕',   base: '#fff0ec', deep: '#ffdcc6', vig: '#ffc6a8', glow: '#ff9a6b', chord: [220.00, 329.63, 440.00] },
    { tier: 8, name: '황혼 정원',   base: '#fdedf0', deep: '#ffd6cf', vig: '#ffc2b0', glow: '#ff7aae', chord: [233.08, 349.23, 466.16] },
    { tier: 9, name: '별빛 정원',   base: '#f3eefc', deep: '#e9dcf6', vig: '#dccaf0', glow: '#b79bff', chord: [261.63, 392.00, 523.25] },
  ];
  let theme = STAGES[0];
  let stageIdx = 0;
  function stageForTier(t) { let i = 0; for (let k = 0; k < STAGES.length; k++) if (t >= STAGES[k].tier) i = k; return i; }
  function applyStageCss() {
    const r = document.documentElement.style;
    r.setProperty('--base', theme.base); r.setProperty('--deep', theme.deep); r.setProperty('--vig', theme.vig);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', theme.deep);
  }
  function setStage(i, celebrate) {
    i = Math.max(0, Math.min(STAGES.length - 1, i));
    const changed = i !== stageIdx;
    stageIdx = i; theme = STAGES[i];
    applyStageCss(); ambientChord(theme.chord);
    if (celebrate && changed) {
      const nx = STAGES[i + 1];
      stageBanner = { t: 0, name: theme.name, nextTier: nx ? nx.tier : -1 };
      stageFlash = { t: 0, c: theme.glow };
      stageUpSfx(theme.chord); addShake(9);
    }
  }

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
      // 소용돌이 게이지 충전: 고티어·콤보일수록 많이, 저티어 잔챙이는 조금
      addCharge(chargeGain(nt, comboCount));

      // 최고 동물 갱신 → 새 단계면 풍경/배경음/효과음 진화 + 배너
      if (nt > maxTierEver) { maxTierEver = nt; const ns = stageForTier(nt); if (ns > stageIdx) setStage(ns, true); }

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

  // ── 소용돌이 폭탄 착탄: 반경 내 저티어(≤CLUTTER_MAX_TIER)만 소거 ──
  // 조준=에이전시, 저티어 한정=내 큰 진행은 안 날림. 배출구지 지우개 아님(near-miss 유지).
  function detonate(cx, cy) {
    cx = Math.max(0, Math.min(W, cx));
    cy = Math.max(0, Math.min(H, cy));
    const R = BLAST_R * W;
    const R2 = R * R;
    // 반경 내 저티어 동물만 수집 (물리 정합: 수집 후 일괄 removeBody)
    const victims = [];
    for (const o of bodies) {
      if (o.special || o.tier === undefined) continue;   // 벽/비동물 제외
      if (o.tier > CLUTTER_MAX_TIER) continue;           // 큰 동물은 안 건드림
      const dx = o.position.x - cx, dy = o.position.y - cy;
      if (dx * dx + dy * dy <= R2) victims.push(o);
    }
    let total = 0;
    for (const v of victims) {
      const vx = v.position.x, vy = v.position.y;
      // 중심으로 빨려드는 파티클
      for (let i = 0; i < 6; i++) {
        particles.push({ x: vx, y: vy, vx: (cx - vx) * 0.04, vy: (cy - vy) * 0.04, r: 2 + Math.random() * 3, life: 0.9, color: LADDER[v.tier].c });
      }
      removeBody(v);
      total += Math.max(1, TIER_SCORE[v.tier]);          // 소량 점수
    }
    const gain = Math.round(total);
    if (gain > 0) addScore(gain);
    // 강한 버스트 연출 (흡수 이펙트 재사용)
    popRings.push({ x: cx, y: cy, r: R * 0.5, t: 0, kind: 'expand', c: '#7b5cff' });
    popRings.push({ x: cx, y: cy, r: R * 0.28, t: -6, kind: 'expand', c: '#b89bff' });
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, r: 2 + Math.random() * 3.5, life: 1.1, color: i % 2 ? '#b89bff' : '#ffd089' });
    }
    floatTexts.push({ x: cx, y: cy, t: 0, txt: victims.length ? ('소용돌이! +' + gain + ' (' + victims.length + ')') : '허탕!', big: true, c: '#7b5cff' });
    addShake(14 + Math.min(victims.length, 8));
    sfxVacuum(victims.length);
    haptic([15, 30, 15, 30, 20]);
  }

  // ── 자석: MAGNET_DUR 동안 같은 티어끼리 서로 끌어당김 → 충돌 → 자연 합체 ──
  function activateMagnet() {
    magnetUntil = performance.now() + MAGNET_DUR;
    popRings.push({ x: W / 2, y: H * 0.5, r: W * 0.2, t: 0, kind: 'expand', c: ITEM_DEF.magnet.color });
    floatTexts.push({ x: W / 2, y: H * 0.32, t: 0, txt: '자석!', big: true, c: ITEM_DEF.magnet.color });
    sfxMagnet(); haptic([10, 20, 10]);
  }
  // 매 틱 호출: 같은 티어 바디쌍에게 서로를 향한 가속. 질량무관·속도상한으로 폭주 방지.
  function applyMagnet() {
    // 티어별 그룹핑 (MAX_TIER·벽 제외)
    const groups = {};
    for (const o of bodies) {
      if (o.tier === undefined || o.tier >= MAX_TIER || o.merged) continue;
      (groups[o.tier] || (groups[o.tier] = [])).push(o);
    }
    const range2 = (MAGNET_RANGE * W) * (MAGNET_RANGE * W);
    for (const t in groups) {
      const g = groups[t];
      if (g.length < 2) continue;
      for (const a of g) {
        // 가장 가까운 같은 티어 짝을 향해 당김
        let best = null, bd2 = Infinity;
        for (const b of g) {
          if (b === a) continue;
          const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bd2) { bd2 = d2; best = b; }
        }
        if (!best || bd2 > range2) continue;
        const dx = best.position.x - a.position.x, dy = best.position.y - a.position.y;
        const dist = Math.sqrt(bd2) || 1;
        const f = MAGNET_ACCEL * a.mass;   // accel = f/mass = MAGNET_ACCEL (질량 무관)
        Body.applyForce(a, a.position, { x: (dx / dist) * f * 0.001, y: (dy / dist) * f * 0.001 });
      }
    }
    // 속도 상한 (폭주·통 밖 이탈·NaN 방지)
    for (const o of bodies) {
      if (o.tier === undefined) continue;
      const v = o.velocity, sp = Math.hypot(v.x, v.y);
      if (sp > MAGNET_MAX_SPEED) { const k = MAGNET_MAX_SPEED / sp; Body.setVelocity(o, { x: v.x * k, y: v.y * k }); }
    }
  }

  // ── 흔들기: 판 전체에 짧은 임펄스(좌우+살짝 위) → 낀 것 재정착 → 우연 합체 ──
  function activateShake() {
    for (const o of bodies) {
      if (o.tier === undefined) continue;
      const nx = o.velocity.x + (Math.random() - 0.5) * 2 * SHAKE_KICK_X;
      const ny = o.velocity.y - Math.random() * SHAKE_KICK_UP;
      // 속도 상한으로 통 밖 이탈 방지
      const cx = Math.max(-SHAKE_SPEED_CAP, Math.min(SHAKE_SPEED_CAP, nx));
      const cy = Math.max(-SHAKE_SPEED_CAP, Math.min(SHAKE_SPEED_CAP, ny));
      Body.setVelocity(o, { x: cx, y: cy });
      if (o.spawnAt) o.spawnAt = performance.now();   // 재정착 유예 — 흔든 직후 오판정 방지
    }
    addShake(22);
    floatTexts.push({ x: W / 2, y: H * 0.32, t: 0, txt: '흔들기!', big: true, c: ITEM_DEF.shake.color });
    sfxShake(); haptic([12, 18, 12, 18]);
  }

  // ── 집게: 조준한 동물 하나 제거(티어 무관, 최종 포함). 명중 시 true ──
  function pluckAt(px, py) {
    const target = bodyAt(px, py);
    if (!target) return false;
    const tx = target.position.x, ty = target.position.y;
    const col = LADDER[target.tier] ? LADDER[target.tier].c : '#fff';
    removeBody(target);
    // 팡 연출
    popRings.push({ x: tx, y: ty, r: (LADDER[target.tier] ? LADDER[target.tier].r * W : 20), t: 0, kind: 'pop' });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
      particles.push({ x: tx, y: ty, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, r: 2 + Math.random() * 3, life: 1, color: i % 2 ? col : ITEM_DEF.tongs.color });
    }
    floatTexts.push({ x: tx, y: ty, t: 0, txt: '집게!', big: false, c: ITEM_DEF.tongs.color });
    addShake(6); sfxPluck(); haptic([12, 20]);
    return true;
  }
  // 좌표를 포함하는 최상위(가장 위) 동물 바디 찾기 — 겹치면 가장 나중(위) 것 우선
  function bodyAt(px, py) {
    let found = null;
    for (const o of bodies) {
      if (o.tier === undefined) continue;
      const dx = o.position.x - px, dy = o.position.y - py;
      const r = LADDER[o.tier].r * W;
      if (dx * dx + dy * dy <= r * r) found = o;   // 나중 순회(위 레이어) 우선
    }
    return found;
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
    if (!running || gameOver || !canDrop || aimKind) return;
    const r = LADDER[curTier].r * W;
    const cx = Math.max(r + 4, Math.min(W - r - 4, x));
    const b = makeAnimal(curTier, cx, DROP_Y);
    Body.setVelocity(b, { x: 0, y: 0 });
    sfxDrop(curTier);
    haptic(8);
    // 다음으로 회전
    curTier = nextTier;
    nextTier = rndSpawn();
    setNextGlyph(nextTier);
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
    aimKind = null; aimIndex = -1; renderTray(); refreshCharge();   // 조준 중 사망해도 UI 잠기지 않게
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
    floatTexts.length = 0;
    scoreVal = 0; scoreEl.textContent = '0';
    bestEl.textContent = best;
    overflowSince = 0; gameOver = false; canDrop = true;
    shakeAmt = 0; clearCombo();
    charge = 0; tray = []; aimKind = null; aimIndex = -1; magnetUntil = 0;
    renderTray(); refreshCharge();
    maxTierEver = 0; stageBanner = null; stageFlash = null;
    setStage(0, false);
    curTier = rndSpawn(); nextTier = rndSpawn();
    setNextGlyph(nextTier);
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
      if (now < magnetUntil) applyMagnet();   // 자석 지속 중: 같은 티어 끌어당김
      Engine.update(engine, 16.666);
      processMerges();
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

    // 조준 가이드 + 손에 든 동물 (떨어뜨리기 전) — 조준 모드일 땐 숨김
    if (running && !gameOver && !aimKind) {
      const r = LADDER[curTier].r * W;
      const cx = Math.max(r + 4, Math.min(W - r - 4, aimX));
      // 가이드 라인
      ctx.save();
      ctx.strokeStyle = 'rgba(120,85,55,0.18)';
      ctx.lineWidth = 1.4; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(cx, DROP_Y + r); ctx.lineTo(cx, H); ctx.stroke();
      ctx.restore();
      const bob = canDrop ? Math.sin(now / 300) * 2 : 0;
      drawAnimal(cx, DROP_Y + bob, curTier, 0, canDrop ? 1 : 0.55, 0, now);
    }

    // 조준 모드(폭탄): 착탄 반경 조준경 + 중심 소용돌이 마커
    if (running && !gameOver && aimKind === 'bomb') {
      const R = BLAST_R * W;
      const cx = Math.max(0, Math.min(W, aimPX)), cy = Math.max(0, Math.min(H, aimPY));
      const pulse = 0.5 + 0.5 * Math.sin(now / 220);
      ctx.save();
      // 반경 채움 (은은한 보라 틴트)
      ctx.globalAlpha = 0.10 + pulse * 0.06;
      ctx.fillStyle = '#7b5cff';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      // 반경 링 (점선, 맥동)
      ctx.globalAlpha = 0.5 + pulse * 0.35;
      ctx.strokeStyle = '#7b5cff'; ctx.lineWidth = 2.4; ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // 반경 내 저티어 하이라이트 (지워질 대상 표시)
      for (const b of bodies) {
        if (b.special || b.tier === undefined || b.tier > CLUTTER_MAX_TIER) continue;
        const dx = b.position.x - cx, dy = b.position.y - cy;
        if (dx * dx + dy * dy > R * R) continue;
        const br = LADDER[b.tier].r * W;
        ctx.save();
        ctx.globalAlpha = 0.5 + pulse * 0.4;
        ctx.strokeStyle = '#7b5cff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.position.x, b.position.y, br + 2, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // 중심 소용돌이 마커 (기존 글리프 재사용)
      drawSpecial(cx, cy, now / 500, now);
    }

    // 조준 모드(집게): 손가락 아래 동물 하이라이트 → 릴리즈 시 그놈 제거
    if (running && !gameOver && aimKind === 'tongs') {
      const cx = Math.max(0, Math.min(W, aimPX)), cy = Math.max(0, Math.min(H, aimPY));
      const target = bodyAt(cx, cy);
      const pulse = 0.5 + 0.5 * Math.sin(now / 200);
      if (target) {
        const br = LADDER[target.tier].r * W;
        ctx.save();
        ctx.globalAlpha = 0.55 + pulse * 0.4;
        ctx.strokeStyle = ITEM_DEF.tongs.color; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.arc(target.position.x, target.position.y, br + 4, 0, Math.PI * 2); ctx.stroke();
        // X 표식(제거 대상)
        ctx.setLineDash([]); ctx.globalAlpha = 0.85; ctx.lineWidth = 3.5;
        const m = br * 0.5, tx = target.position.x, ty = target.position.y;
        ctx.beginPath(); ctx.moveTo(tx - m, ty - m); ctx.lineTo(tx + m, ty + m);
        ctx.moveTo(tx + m, ty - m); ctx.lineTo(tx - m, ty + m); ctx.stroke();
        ctx.restore();
      }
      // 손가락 위치 십자선 (대상 없어도 조준 중임을 표시)
      ctx.save();
      ctx.globalAlpha = 0.4 + pulse * 0.3;
      ctx.strokeStyle = ITEM_DEF.tongs.color; ctx.lineWidth = 1.6; ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(cx - 16, cy); ctx.lineTo(cx + 16, cy);
      ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy + 16);
      ctx.stroke();
      ctx.restore();
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

    // 단계 진입 — 풍경이 바뀌는 색 플래시
    if (stageFlash) {
      stageFlash.t += dt / 16.666; const p = stageFlash.t / 42;
      if (p >= 1) stageFlash = null;
      else { ctx.save(); ctx.globalAlpha = (1 - p) * 0.5; const gr = ctx.createRadialGradient(W/2, H*0.42, 0, W/2, H*0.42, W*0.85); gr.addColorStop(0, stageFlash.c); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    }
    // 단계 진입 배너 — "새 풍경 · {이름}" + 다음 티저(기대감)
    if (stageBanner) {
      stageBanner.t += dt / 16.666; const p = stageBanner.t / 150;
      if (p >= 1) stageBanner = null;
      else {
        const ap = p < 0.12 ? p / 0.12 : 1, fade = p > 0.78 ? 1 - (p - 0.78) / 0.22 : 1;
        ctx.save(); ctx.globalAlpha = fade; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const yy = H * 0.30, sc = 0.62 + ap * 0.48;
        ctx.lineJoin = 'round'; ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.font = `800 ${(26 * sc).toFixed(1)}px "Pretendard Variable",-apple-system,sans-serif`;
        ctx.strokeText('새 풍경 · ' + stageBanner.name, W / 2, yy); ctx.fillStyle = '#6a4a36'; ctx.fillText('새 풍경 · ' + stageBanner.name, W / 2, yy);
        const sub = stageBanner.nextTier >= 0 ? '더 큰 동물을 만들면 또 바뀌어요' : '마지막 풍경 — 최고예요!';
        ctx.font = `700 14px "Pretendard Variable",sans-serif`; ctx.lineWidth = 3.5;
        ctx.strokeText(sub, W / 2, yy + 26); ctx.fillStyle = 'rgba(106,74,54,0.85)'; ctx.fillText(sub, W / 2, yy + 26);
        ctx.restore();
      }
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
  function toVirtY(clientY) {
    const rect = canvas.getBoundingClientRect();
    return ((clientY - rect.top) / rect.height) * H;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (gameOver) return;
    audioInit();
    pointerDown = true;
    aimX = toVirtX(e.clientX);
    if (aimKind) { aimPX = aimX; aimPY = toVirtY(e.clientY); }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    aimX = toVirtX(e.clientX);
    if (aimKind) { aimPX = aimX; aimPY = toVirtY(e.clientY); }
  });
  function release(e) {
    if (!pointerDown) return;
    pointerDown = false;
    aimX = toVirtX(e.clientX);
    if (aimKind === 'bomb') {
      aimPX = aimX; aimPY = toVirtY(e.clientY);
      detonate(aimPX, aimPY);
      removeItem(aimIndex);           // 폭탄은 항상 소비(허탕 포함)
    } else if (aimKind === 'tongs') {
      aimPX = aimX; aimPY = toVirtY(e.clientY);
      if (pluckAt(aimPX, aimPY)) removeItem(aimIndex);   // 명중 시에만 소비, 허탕이면 조준 유지
    } else {
      dropAt(aimX);
    }
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });

  // 트레이 칸 탭 — 아이템 사용(조준형이면 조준 모드 진입)
  slotEls.forEach((el) => {
    el.addEventListener('click', () => { useItem(parseInt(el.dataset.i, 10)); });
  });

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
    startAmbient();
  }
  // 단계 앰비언트 패드 — 3음 코드, 단계 오르면 코드가 바뀐다(배경음 진화). amaster가 음소거 게이트.
  let aamb = null, ambOsc = [], ambStarted = false, ambChord = [174.61, 261.63, 349.23];
  function startAmbient() {
    if (ambStarted || !actx) return; ambStarted = true;
    aamb = actx.createGain(); aamb.gain.value = 0; aamb.connect(amaster);
    ambChord.forEach((f, i) => {
      const o = actx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = actx.createGain(); g.gain.value = i === 0 ? 0.5 : 0.24;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      o.connect(lp); lp.connect(g); g.connect(aamb); o.start(); ambOsc.push(o);
    });
    aamb.gain.setTargetAtTime(0.05, actx.currentTime, 2.0);
  }
  function ambientChord(ch) {
    ambChord = ch.slice(0, 3);
    if (!actx) return; startAmbient();
    const t = actx.currentTime;
    ambOsc.forEach((o, i) => { if (ambChord[i]) o.frequency.setTargetAtTime(ambChord[i], t, 1.0); });
    if (aamb) aamb.gain.setTargetAtTime(0.05, t, 1.5);
  }
  function stageUpSfx(ch) {
    if (!actx || muted) return; const notes = ch || ambChord;
    notes.forEach((f, i) => setTimeout(() => tone(f * 2, 0.5, 'triangle', 0.13), i * 90));
    setTimeout(() => tone(notes[notes.length - 1] * 4, 0.4, 'sine', 0.05, notes[notes.length - 1] * 6), 220);
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
    if (stageIdx > 0) tone(mtof(base + 12 + stageIdx * 2), 0.10, 'sine', 0.05); // 단계별 음색 변화
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
  // 아이템 획득 — 밝게 올라가는 2음(선물 도착)
  function sfxItem() {
    if (!actx || muted) return;
    tone(mtof(72), 0.12, 'triangle', 0.18, mtof(76));
    setTimeout(() => tone(mtof(79), 0.16, 'sine', 0.14, mtof(84)), 90);
  }
  // 자석 — 붕- 하는 저역 험 + 위로 스윕(끌어당김)
  function sfxMagnet() {
    if (!actx || muted) return;
    tone(120, 0.5, 'sine', 0.16, 300);
    tone(180, 0.4, 'triangle', 0.08, 360);
  }
  // 흔들기 — 짧은 러블(덜덜)
  function sfxShake() {
    if (!actx || muted) return;
    for (let i = 0; i < 5; i++) setTimeout(() => tone(90 + Math.random() * 60, 0.06, 'square', 0.08), i * 45);
  }
  // 집게 — 톡! 하고 뽑는 소리
  function sfxPluck() {
    if (!actx || muted) return;
    tone(mtof(84), 0.08, 'triangle', 0.16, mtof(72));
    setTimeout(() => tone(mtof(64), 0.1, 'sine', 0.1), 40);
  }
  function haptic(p) { if (navigator.vibrate && !muted) { try { navigator.vibrate(p); } catch (_) {} } }

  // ── 부팅 ──
  function boot() {
    preloadAnimals();
    resize();
    buildEvoRow();
    buildEvo();
    refreshMute();
    renderTray();
    refreshCharge();
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
