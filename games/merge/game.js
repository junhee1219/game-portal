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
  const PAIR_BIAS = 3;              // 지급 시 트레이에 낱개로 보유한 종류의 가중치 배율 (융합 만남 빈도 ↑)
  // 가중 랜덤 풀 (합 100): 자석 25 · 폭탄 20 · 콤보연장 13 · 와일드 12 · 흔들기 12 · 집게 10 · 승급 8
  const ITEM_POOL = [
    { kind:'magnet',  w:25 },
    { kind:'bomb',    w:20 },
    { kind:'surge',   w:13 },
    { kind:'wild',    w:12 },
    { kind:'shake',   w:12 },
    { kind:'tongs',   w:10 },
    { kind:'promote', w:8  },
  ];
  // 아이템 정의: 아이콘(2층 시스템)·색조·조준형 여부·라벨(낱개/강화판)
  const ITEM_DEF = {
    bomb:    { icon:'#g-vortex',              color:'#7b5cff', aim:true,  label:'소용돌이', label2:'대폭탄'     },
    magnet:  { icon:'#p-magnet',              color:'#e5484d', aim:false, label:'자석',     label2:'슈퍼자석'   },
    shake:   { icon:'#p-arrows-out-cardinal', color:'#e8912a', aim:false, label:'흔들기',   label2:'대흔들기'   },
    tongs:   { icon:'#p-hand-grabbing',       color:'#1f9e58', aim:true,  label:'집게',     label2:'황금집게'   },
    wild:    { icon:'#p-star',                color:'#e0a020', aim:false, label:'와일드',   label2:'와일드 2연' },
    promote: { icon:'#p-arrow-fat-up',        color:'#2f80ed', aim:true,  label:'승급',     label2:'특급 승급'  },
    surge:   { icon:'#p-lightning',           color:'#c2298a', aim:false, label:'콤보연장', label2:'대연장'     },
  };
  const itemLabel = (it) => (it.lv === 2 ? ITEM_DEF[it.kind].label2 : ITEM_DEF[it.kind].label);
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
  // ── 콤보연장(번개) ── 일정 시간 콤보 창이 넓어져 연쇄를 이어 붙일 여유
  const SURGE_DUR = 8000;           // 지속 시간(ms)
  const COMBO_WINDOW_SURGE = 1560;  // 지속 중 콤보 창 (기본 COMBO_WINDOW 520의 3배)
  // ── 아이템 융합 (같은 종류 낱개 2개 → 강화판 1개. 2단계까지, 반드시 플레이어 탭) ──
  //   낱개 2번 쓰기 vs 강화판 1번 세게 쓰기 = 기회비용 결정. 자동 융합 금지.
  const BLAST_R2 = 0.55;            // 대폭탄 반경
  const CLUTTER_MAX_TIER2 = 2;      // 대폭탄이 지우는 최대 티어 (rabbit까지)
  const MAGNET_DUR2 = 2200;         // 슈퍼자석 지속
  const MAGNET_ACCEL2 = 3.2;        // 슈퍼자석 세기
  const SHAKE_BOOST2 = 1.6;         // 대흔들기 임펄스·상한 배율
  const TONGS_USES2 = 2;            // 황금집게 사용 횟수(연속 2마리)
  const WILD_DROPS2 = 2;            // 와일드 2연 — 별 동물로 바뀌는 드롭 수
  const PROMOTE_STEP2 = 2;          // 특급 승급 — 올려주는 티어 수
  const SURGE_DUR2 = 12000;         // 대연장 지속 (+ 콤보 배율 2부터 시작)
  // ── 귀속 연출 ── 아이템이 유발한 합체에 원인 라벨을 띄워 인과를 읽히게
  const SHAKE_CAUSE_MS = 2000;      // 흔들기 후 이 시간 내 합체는 흔들기 공로로 표시
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
  const fuseChipEl = document.getElementById('fuse-chip');
  const fuseIcoEl = fuseChipEl.querySelector('.fc-ico svg use');
  const fuseTxtEl = fuseChipEl.querySelector('.fc-t');

  // 동물 이미지를 담은 작은 HTML (HTML 칩/미리보기/진화표용)
  function glyphSvg(tier, px) {
    return `<img src="animals/${LADDER[tier].img}.svg" alt="" style="width:${px}px;height:${px}px;display:block;" draggable="false">`;
  }
  function setNextGlyph(tier) {
    // 와일드가 2개 이상 남았으면 '다음'도 별 동물 — 미리 보이게
    if (wildDrops > 1) { nextFaceEl.innerHTML = `<svg class="ki" style="width:18px;height:18px;color:${ITEM_DEF.wild.color}"><use href="#p-star"/></svg>`; return; }
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
  let tray = [];                // 획득 아이템 {kind, lv(1|2), uses}[] (최대 TRAY_MAX)
  let aimKind = null;           // 조준 중인 아이템 kind ('bomb'|'tongs'|'promote') 또는 null
  let aimIndex = -1;            // 조준 중인 트레이 인덱스
  let aimLv = 1;                // 조준 중인 아이템 단계 (강화판이면 2)
  let aimPX = W / 2;            // 조준 포인터 x (자유)
  let aimPY = W * 0.6;          // 조준 포인터 y (자유)
  let fuseKind = null;          // 지금 융합 가능한 아이템 kind (칩 표시 중) 또는 null
  let magnetUntil = 0;          // 자석 효과 종료 시각(performance.now)
  let magnetAccel = MAGNET_ACCEL; // 이번 자석의 세기 (강화판이면 MAGNET_ACCEL2)
  let magnetMerges = 0;         // 이번 자석이 만든 합체 수 (귀속 라벨 "자석 ×N")
  let shakeCauseUntil = 0;      // 흔들기 공로 인정 종료 시각
  let wildDrops = 0;            // 앞으로 별 동물로 나갈 드롭 수
  let surgeUntil = 0;           // 콤보연장 종료 시각
  let surgeLv = 1;              // 이번 콤보연장 단계 (2면 콤보 배율 2부터)
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
    if (aimKind) chargeLabelEl.textContent = itemLabel({ kind: aimKind, lv: aimLv }) + ' 조준 · 판을 탭';
    else if (wildDrops > 0) chargeLabelEl.textContent = '별 동물 ' + wildDrops + '개 대기';
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
    tray.push({ kind, lv: 1, uses: 1 });
    renderTray(tray.length - 1);   // 방금 칸 pop 애니
    floatTexts.push({ x: W / 2, y: DROP_Y + 30, t: 0, txt: ITEM_DEF[kind].label + ' 획득!', big: false, c: ITEM_DEF[kind].color });
    sfxItem(); haptic([8, 24]);
  }
  function pickItem() {
    // 짝 보정: 트레이에 낱개(lv1)로 들고 있는 종류는 가중치 ×PAIR_BIAS —
    // 융합(같은 것 2개)을 실플레이 한 판 안에서 만날 수 있게. 7종 다양성은 유지.
    const held = new Set(tray.filter(it => it.lv === 1).map(it => it.kind));
    const w = (it) => held.has(it.kind) ? it.w * PAIR_BIAS : it.w;
    let total = 0; for (const it of ITEM_POOL) total += w(it);
    let r = Math.random() * total;
    for (const it of ITEM_POOL) { if ((r -= w(it)) < 0) return it.kind; }
    return ITEM_POOL[0].kind;
  }
  // 트레이 렌더 (popIdx = 방금 채워진 칸이면 등장 애니)
  function renderTray(popIdx) {
    for (let i = 0; i < slotEls.length; i++) {
      const el = slotEls[i];
      const it = tray[i];
      el.classList.remove('pop');
      if (it) {
        const d = ITEM_DEF[it.kind];
        el.classList.add('filled');
        el.classList.toggle('lv2', it.lv === 2);
        el.classList.toggle('aiming', aimKind !== null && aimIndex === i);
        el.style.color = d.color;
        // 강화판은 금테 + ×N 뱃지 (황금집게는 남은 사용 횟수를 그대로 보여준다)
        const badge = it.lv === 2 ? '<i class="lvb">×' + (it.kind === 'tongs' ? it.uses : 2) + '</i>' : '';
        el.innerHTML = '<svg><use href="' + d.icon + '"/></svg>' + badge;
        el.setAttribute('aria-label', itemLabel(it) + ' 사용');
        if (i === popIdx) { void el.offsetWidth; el.classList.add('pop'); }
      } else {
        el.classList.remove('filled', 'aiming', 'lv2');
        el.style.color = '';
        el.innerHTML = '';
        el.setAttribute('aria-label', '빈 아이템 칸');
      }
    }
    refreshFuse();
  }
  // 융합 가능한 kind (낱개 2개 이상) — 없으면 null
  function fusableKind() {
    const cnt = {};
    for (const it of tray) {
      if (it.lv !== 1) continue;                 // 강화판끼리는 더 융합 안 됨(2단계까지)
      cnt[it.kind] = (cnt[it.kind] || 0) + 1;
      if (cnt[it.kind] >= 2) return it.kind;
    }
    return null;
  }
  // 융합 칩 표시/숨김 — 결과 아이콘·이름 미리보기
  function refreshFuse() {
    const k = (running && !gameOver) ? fusableKind() : null;
    fuseKind = k;
    if (!k) { fuseChipEl.hidden = true; return; }
    const d = ITEM_DEF[k];
    fuseChipEl.hidden = false;
    fuseChipEl.style.color = d.color;
    fuseIcoEl.setAttribute('href', d.icon);
    fuseTxtEl.textContent = d.label2 + ' 만들기';
    fuseChipEl.setAttribute('aria-label', d.label2 + ' 만들기');
  }
  // 융합 실행: 같은 종류 낱개 2개 → 강화판 1개 (2칸 → 1칸)
  function fuseItems() {
    if (gameOver || !running) return;
    const k = fusableKind();
    if (!k) return;
    audioInit();
    const idx = [];
    for (let i = 0; i < tray.length && idx.length < 2; i++) if (tray[i].lv === 1 && tray[i].kind === k) idx.push(i);
    if (idx.length < 2) return;
    aimKind = null; aimIndex = -1; aimLv = 1;     // 융합 대상이 조준 중이었을 수 있다
    const d = ITEM_DEF[k];
    tray.splice(idx[1], 1);
    tray[idx[0]] = { kind: k, lv: 2, uses: k === 'tongs' ? TONGS_USES2 : 1 };
    floatTexts.push({ x: W / 2, y: DROP_Y + 30, t: 0, txt: d.label2 + ' 완성!', big: true, c: d.color });
    const before = tray.length;
    tryGrantItem();                               // 칸이 하나 비었으니 대기 중 만충이면 즉시 지급
    if (tray.length === before) renderTray(idx[0]);
    refreshCharge();
    sfxFuse(); haptic([10, 20, 10, 30]);
  }
  // 트레이 아이템 사용: 조준형이면 조준 모드 진입, 즉발형이면 즉시 실행
  function useItem(idx) {
    if (gameOver || !running) return;
    const it = tray[idx];
    if (!it) return;
    audioInit();
    if (aimKind !== null) {          // 이미 조준 중
      if (aimIndex === idx) { cancelAim(); return; }   // 같은 칸 다시 탭 → 취소
      cancelAim();                    // 다른 칸 → 조준 전환
    }
    if (ITEM_DEF[it.kind].aim) {
      aimKind = it.kind; aimIndex = idx; aimLv = it.lv;
      aimPX = W / 2; aimPY = H * 0.55;
      haptic(10);
    } else {
      if (it.kind === 'magnet') activateMagnet(it.lv);
      else if (it.kind === 'shake') activateShake(it.lv);
      else if (it.kind === 'wild') activateWild(it.lv);
      else if (it.kind === 'surge') activateSurge(it.lv);
      removeItem(idx);
    }
    renderTray(); refreshCharge();
  }
  function cancelAim() { aimKind = null; aimIndex = -1; aimLv = 1; renderTray(); refreshCharge(); }
  // 트레이에서 아이템 소비 → 조준 해제 → 대기 중 만충 지급 반영
  function removeItem(idx) {
    tray.splice(idx, 1);
    aimKind = null; aimIndex = -1; aimLv = 1;
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
    b.wild = false;     // 별 동물(와일드) — 처음 닿은 동물과 무조건 합체
    b.merged = false;
    b.born = performance.now();
    b.spawnAt = b.born;
    b.squash = 0;     // 머지 직후 통통 스쿼시(0~1, 감쇠)
    b.spin = 0;
    bodies.add(b);
    World.add(world, b);
    return b;
  }

  // ── 충돌: 같은 티어끼리 머지 (dedup 큐). 별 동물(와일드)은 티어 무관 합체 ──
  const mergeQueue = [];
  function onCollide(ev) {
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.tier === undefined || b.tier === undefined) continue; // 벽
      if (a.merged || b.merged) continue;       // 이미 소비됨 → 스킵 (THE 수박게임 버그 방어)
      let nt, cause = null;
      if (a.wild || b.wild) {
        const host = a.wild ? b : a;             // 별이 닿은 상대 (둘 다 별이면 b 기준)
        if (host.tier >= MAX_TIER) continue;     // 최종 동물과는 합쳐지지 않음 → 별은 그대로 대기
        nt = host.tier + 1;
        cause = '와일드!';
      } else {
        if (a.tier !== b.tier) continue;
        if (a.tier >= MAX_TIER) continue;        // 최종 동물은 더 안 합쳐짐
        nt = a.tier + 1;
      }
      a.merged = true; b.merged = true;          // 즉시 플래그 → 같은 틱 다른 페어가 재사용 못함
      mergeQueue.push({ a, b, nt, cause });
    }
  }

  function processMerges() {
    while (mergeQueue.length) {
      const m = mergeQueue.shift();
      const mx = (m.a.position.x + m.b.position.x) / 2;
      const my = (m.a.position.y + m.b.position.y) / 2;
      removeBody(m.a); removeBody(m.b);
      doMerge(m.nt, mx, my, m.cause, ITEM_DEF.wild.color);
    }
  }

  // 합체 성사 처리 — 일반 합체·와일드·승급이 공유(점수·콤보·충전·연출·사운드).
  // cause 를 주면 그 원인 라벨을, 없으면 진행 중인 아이템 효과를 귀속 표시한다.
  function doMerge(nt, mx, my, cause, causeColor) {
    const nb = makeAnimal(nt, mx, my);
    nb.squash = 1;                              // 통통 튀는 스쿼시 시작
    // 살짝 위로 톡 — 손맛
    Body.setVelocity(nb, { x: (Math.random()-0.5)*1.5, y: -2.2 });

    // 콤보: 직전 합체로부터 콤보 창 안이면 누적
    bumpCombo();
    const mult = comboCount >= 2 ? comboCount : 1;  // 2연쇄부터 배율
    const gain = TIER_SCORE[nt] * mult;
    addScore(gain);
    // 아이템 게이지 충전: 고티어·콤보일수록 많이, 저티어 잔챙이는 조금
    addCharge(chargeGain(nt, comboCount));

    // 최고 동물 갱신 → 새 단계면 풍경/배경음/효과음 진화 + 배너
    if (nt > maxTierEver) { maxTierEver = nt; const ns = stageForTier(nt); if (ns > stageIdx) setStage(ns, true); }

    // 이펙트 — 티어 클수록 화려: 파티클·링·흔들림 비례
    burst(mx, my, LADDER[nt].c, nt);
    popRings.push({ x:mx, y:my, r:LADDER[nt].r*W, t:0, kind:'pop' });
    if (nt >= 5) popRings.push({ x:mx, y:my, r:LADDER[nt].r*W*0.6, t:0, kind:'expand', c:LADDER[nt].c });
    addShake(2 + nt * 0.9);
    floatTexts.push({ x:mx, y:my, t:0, txt:'+'+gain, big: nt>=6, c:'#ff7a59' });
    // 귀속 라벨 — "왜 이게 합쳐졌는지"를 한 줄로 (인과 판독성)
    const at = cause ? { txt: cause, c: causeColor } : attribution();
    if (at) floatTexts.push({ x:mx, y:my - 20, t:0, txt:at.txt, big:false, c:at.c });

    // 사운드 + 햅틱 (티어/콤보 높을수록 음 높게)
    sfxMerge(nt + (mult > 1 ? 2 : 0));
    haptic(nt >= 6 ? [12,30,12] : 14);

    // 잭팟: 최종 동물(bear) 탄생 → 대형 보너스 + 화면 가득 축하
    if (nt === MAX_TIER) jackpot(mx, my);
    return nb;
  }
  // 지금 합체의 공로자 — 자석 지속 중이면 누적 카운트, 흔들기 직후면 흔들기
  function attribution() {
    const now = performance.now();
    if (now < magnetUntil) { magnetMerges++; return { txt: '자석 ×' + magnetMerges, c: ITEM_DEF.magnet.color }; }
    if (now < shakeCauseUntil) return { txt: '흔들기!', c: ITEM_DEF.shake.color };
    return null;
  }

  // ── 콤보 ──
  function bumpCombo() {
    const now = performance.now();
    const surging = now < surgeUntil;
    if (comboTimer > 0) comboCount++;
    else comboCount = (surging && surgeLv === 2) ? 2 : 1;   // 대연장: 배율 2부터 시작
    comboTimer = surging ? COMBO_WINDOW_SURGE : COMBO_WINDOW;
    if (comboCount >= 2) {
      comboXEl.textContent = 'x' + comboCount;
      comboEl.classList.add('show');
      comboEl.classList.toggle('surge', surging);
      comboEl.classList.remove('pulse');
      void comboEl.offsetWidth;            // reflow → 애니 재시작
      comboEl.classList.add('pulse');
      haptic(8);
    }
  }
  function clearCombo() {
    comboCount = 0; comboTimer = 0;
    comboEl.classList.remove('show', 'pulse', 'surge');
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
  function detonate(cx, cy, lv) {
    cx = Math.max(0, Math.min(W, cx));
    cy = Math.max(0, Math.min(H, cy));
    const big = lv === 2;
    const R = (big ? BLAST_R2 : BLAST_R) * W;
    const maxT = big ? CLUTTER_MAX_TIER2 : CLUTTER_MAX_TIER;
    const R2 = R * R;
    // 반경 내 저티어 동물만 수집 (물리 정합: 수집 후 일괄 removeBody)
    const victims = [];
    for (const o of bodies) {
      if (o.special || o.tier === undefined) continue;   // 벽/비동물 제외
      if (o.wild) continue;                              // 아껴둔 별 동물은 내 폭탄에 안 날아감
      if (o.tier > maxT) continue;                       // 큰 동물은 안 건드림
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
    const bombName = big ? '대폭탄!' : '소용돌이!';
    floatTexts.push({ x: cx, y: cy, t: 0, txt: victims.length ? (bombName + ' +' + gain + ' (' + victims.length + ')') : '허탕!', big: true, c: ITEM_DEF.bomb.color });
    addShake(14 + Math.min(victims.length, 8));
    sfxVacuum(victims.length);
    haptic([15, 30, 15, 30, 20]);
  }

  // ── 자석: MAGNET_DUR 동안 같은 티어끼리 서로 끌어당김 → 충돌 → 자연 합체 ──
  function activateMagnet(lv) {
    const big = lv === 2;
    magnetUntil = performance.now() + (big ? MAGNET_DUR2 : MAGNET_DUR);
    magnetAccel = big ? MAGNET_ACCEL2 : MAGNET_ACCEL;
    magnetMerges = 0;                            // 귀속 라벨 "자석 ×N" 카운트 리셋
    popRings.push({ x: W / 2, y: H * 0.5, r: W * 0.2, t: 0, kind: 'expand', c: ITEM_DEF.magnet.color });
    floatTexts.push({ x: W / 2, y: H * 0.32, t: 0, txt: big ? '슈퍼자석!' : '자석!', big: true, c: ITEM_DEF.magnet.color });
    sfxMagnet(); haptic([10, 20, 10]);
  }
  // 매 틱 호출: 같은 티어 바디쌍에게 서로를 향한 가속. 질량무관·속도상한으로 폭주 방지.
  function applyMagnet() {
    // 티어별 그룹핑 (MAX_TIER·벽 제외)
    const groups = {};
    for (const o of bodies) {
      if (o.tier === undefined || o.tier >= MAX_TIER || o.merged) continue;
      if (o.wild) continue;                 // 별 동물은 티어 짝 개념이 없다
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
        const f = magnetAccel * a.mass;    // accel = f/mass = magnetAccel (질량 무관)
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
  function activateShake(lv) {
    const k = lv === 2 ? SHAKE_BOOST2 : 1;
    const kickX = SHAKE_KICK_X * k, kickUp = SHAKE_KICK_UP * k, cap = SHAKE_SPEED_CAP * k;
    for (const o of bodies) {
      if (o.tier === undefined) continue;
      const nx = o.velocity.x + (Math.random() - 0.5) * 2 * kickX;
      const ny = o.velocity.y - Math.random() * kickUp;
      // 속도 상한으로 통 밖 이탈 방지
      const cx = Math.max(-cap, Math.min(cap, nx));
      const cy = Math.max(-cap, Math.min(cap, ny));
      Body.setVelocity(o, { x: cx, y: cy });
      if (o.spawnAt) o.spawnAt = performance.now();   // 재정착 유예 — 흔든 직후 오판정 방지
    }
    shakeCauseUntil = performance.now() + SHAKE_CAUSE_MS;   // 이후 합체는 흔들기 공로
    addShake(22 * k);
    floatTexts.push({ x: W / 2, y: H * 0.32, t: 0, txt: lv === 2 ? '대흔들기!' : '흔들기!', big: true, c: ITEM_DEF.shake.color });
    sfxShake(); haptic([12, 18, 12, 18]);
  }

  // ── 와일드: 다음 드롭이 별 동물 → 처음 닿은 동물과 무조건 합체(그 티어+1) ──
  function activateWild(lv) {
    wildDrops = lv === 2 ? WILD_DROPS2 : 1;
    setNextGlyph(nextTier);
    floatTexts.push({ x: W / 2, y: H * 0.32, t: 0, txt: lv === 2 ? '와일드 2연!' : '와일드!', big: true, c: ITEM_DEF.wild.color });
    popRings.push({ x: W / 2, y: DROP_Y, r: W * 0.12, t: 0, kind: 'expand', c: ITEM_DEF.wild.color });
    sfxWild(); haptic([8, 16, 8]);
  }

  // ── 콤보연장: 일정 시간 콤보 창을 넓혀 연쇄를 이어 붙일 여유를 준다 ──
  function activateSurge(lv) {
    surgeUntil = performance.now() + (lv === 2 ? SURGE_DUR2 : SURGE_DUR);
    surgeLv = lv;
    floatTexts.push({ x: W / 2, y: H * 0.32, t: 0, txt: lv === 2 ? '대연장!' : '콤보연장!', big: true, c: ITEM_DEF.surge.color });
    popRings.push({ x: W / 2, y: H * 0.5, r: W * 0.22, t: 0, kind: 'expand', c: ITEM_DEF.surge.color });
    sfxSurge(); haptic([8, 14, 8, 14]);
  }

  // ── 승급: 조준한 동물을 티어+1(강화판 +2)로 교체. 합체와 같은 점수·콤보·연출 ──
  function promoteAt(px, py, lv) {
    const target = bodyAt(px, py);
    if (!target || target.tier === undefined) return false;
    if (target.tier >= MAX_TIER) return false;         // 최종 동물은 대상 아님 → 허탕(아이템 유지)
    const nt = Math.min(MAX_TIER, target.tier + (lv === 2 ? PROMOTE_STEP2 : 1));
    const tx = target.position.x, ty = target.position.y;
    removeBody(target);
    popRings.push({ x: tx, y: ty, r: LADDER[nt].r * W * 0.7, t: 0, kind: 'expand', c: ITEM_DEF.promote.color });
    doMerge(nt, tx, ty, lv === 2 ? '특급 승급!' : '승급!', ITEM_DEF.promote.color);
    sfxPromote();
    return true;
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
    if (wildDrops > 0) { b.wild = true; wildDrops--; refreshCharge(); }   // 이번 드롭은 별 동물
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
    charge = 0; tray = []; aimKind = null; aimIndex = -1; aimLv = 1; magnetUntil = 0;
    magnetAccel = MAGNET_ACCEL; magnetMerges = 0; shakeCauseUntil = 0;
    wildDrops = 0; surgeUntil = 0; surgeLv = 1;
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
      if (wildDrops > 0) drawWild(cx, DROP_Y + bob, curTier, 0, canDrop ? 1 : 0.55, now);
      else drawAnimal(cx, DROP_Y + bob, curTier, 0, canDrop ? 1 : 0.55, 0, now);
    }

    // 조준 모드(폭탄): 착탄 반경 조준경 + 중심 소용돌이 마커
    if (running && !gameOver && aimKind === 'bomb') {
      const R = (aimLv === 2 ? BLAST_R2 : BLAST_R) * W;
      const maxT = aimLv === 2 ? CLUTTER_MAX_TIER2 : CLUTTER_MAX_TIER;
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
        if (b.special || b.wild || b.tier === undefined || b.tier > maxT) continue;
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

    // 동물들 + 특수
    for (const b of bodies) {
      if (b.squash > 0) b.squash *= Math.pow(0.86, dt / 16.666);
      if (b.squash < 0.02) b.squash = 0;
      if (b.special) { b.spin += dt / 16.666 * 0.16; drawSpecial(b.position.x, b.position.y, b.spin, now); }
      else if (b.wild) drawWild(b.position.x, b.position.y, b.tier, b.squash, 1, now);
      else drawAnimal(b.position.x, b.position.y, b.tier, b.angle, 1, b.squash, now);
    }

    // 조준 모드(집게·승급): 손가락 아래 동물 하이라이트 → 릴리즈 시 제거/승급.
    // 동물 그린 뒤에 얹는다 — X·화살표 표식이 동물 그림에 묻히면 무엇을 하는 아이템인지 안 읽힌다.
    if (running && !gameOver && (aimKind === 'tongs' || aimKind === 'promote')) {
      const col = ITEM_DEF[aimKind].color;
      const cx = Math.max(0, Math.min(W, aimPX)), cy = Math.max(0, Math.min(H, aimPY));
      const target = bodyAt(cx, cy);
      const pulse = 0.5 + 0.5 * Math.sin(now / 200);
      if (target) {
        const br = LADDER[target.tier].r * W;
        const tx = target.position.x, ty = target.position.y;
        ctx.save();
        ctx.globalAlpha = 0.55 + pulse * 0.4;
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.arc(tx, ty, br + 4, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 0.85; ctx.lineWidth = 3.5;
        const m = br * 0.5;
        if (aimKind === 'tongs') {
          // X 표식(제거 대상)
          ctx.beginPath(); ctx.moveTo(tx - m, ty - m); ctx.lineTo(tx + m, ty + m);
          ctx.moveTo(tx + m, ty - m); ctx.lineTo(tx - m, ty + m); ctx.stroke();
        } else {
          // 위 화살표(한 단계 위로) + 승급 후 크기 미리보기 링
          const nt = Math.min(MAX_TIER, target.tier + (aimLv === 2 ? PROMOTE_STEP2 : 1));
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(tx, ty + m); ctx.lineTo(tx, ty - m);
          ctx.moveTo(tx - m * 0.7, ty - m * 0.35); ctx.lineTo(tx, ty - m); ctx.lineTo(tx + m * 0.7, ty - m * 0.35);
          ctx.stroke();
          ctx.globalAlpha = 0.35 + pulse * 0.25; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
          ctx.beginPath(); ctx.arc(tx, ty, LADDER[nt].r * W, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }
      // 손가락 위치 십자선 (대상 없어도 조준 중임을 표시)
      ctx.save();
      ctx.globalAlpha = 0.4 + pulse * 0.3;
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(cx - 16, cy); ctx.lineTo(cx + 16, cy);
      ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy + 16);
      ctx.stroke();
      ctx.restore();
    }

    // 콤보연장 지속 중 — 화면 가장자리 은은한 글로우 (활성 표시)
    if (running && now < surgeUntil) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);
      const fade = Math.min(1, (surgeUntil - now) / 700);      // 끝나기 직전 사그라짐
      const a = (0.14 + pulse * 0.10) * fade;
      const th = W * 0.17;
      const col = ITEM_DEF.surge.color;
      ctx.save();
      ctx.globalAlpha = a;
      const edges = [
        [0, 0, 0, th, 0, 0, W, th],                 // top
        [0, H, 0, H - th, 0, H - th, W, th],        // bottom
        [0, 0, th, 0, 0, 0, th, H],                 // left
        [W, 0, W - th, 0, W - th, 0, th, H],        // right
      ];
      for (const e of edges) {
        const g = ctx.createLinearGradient(e[0], e[1], e[2], e[3]);
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(e[4], e[5], e[6], e[7]);
      }
      ctx.restore();
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

  // 별 동물(와일드) — 금색 원 + 5각 별. 무엇에든 붙는다는 걸 모양만으로 알게.
  function drawWild(x, y, tier, squash, alpha, now) {
    const r = LADDER[tier].r * W;
    const sq = squash > 0 ? Math.sin(squash * Math.PI) * 0.30 : 0;
    const breathe = Math.sin(now / 480) * 0.02;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(1 + sq + breathe, 1 - sq + breathe);
    // 바닥 하드섀도
    ctx.save(); ctx.translate(r * 0.10, r * 0.15);
    ctx.fillStyle = 'rgba(120,85,55,0.18)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // 몸통 — 금색 단일 색조, 명도 폭 좁게
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, '#ffe9b0'); g.addColorStop(0.55, '#ffd166'); g.addColorStop(1, '#f0b429');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1.4, r * 0.055);
    ctx.strokeStyle = 'rgba(140,95,20,0.45)'; ctx.stroke();
    // 크리스프 윗 림
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath(); ctx.arc(0, -r * 0.04, r * 0.92, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke();
    ctx.restore();
    // 별 (천천히 회전 + 반짝임)
    ctx.save();
    ctx.rotate(Math.sin(now / 900) * 0.22);
    ctx.fillStyle = '#fffdf5';
    drawStar(0, 0, r * 0.72, r * 0.31, 5);          // path 유지 → 같은 경로에 외곽선
    ctx.strokeStyle = 'rgba(160,110,20,0.35)'; ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.stroke();
    ctx.restore();
    // 반짝 테두리 (기대감)
    const sh = 0.4 + 0.4 * Math.sin(now / 200);
    ctx.globalAlpha = alpha * sh;
    ctx.strokeStyle = 'rgba(255,214,102,0.95)';
    ctx.lineWidth = Math.max(1.8, r * 0.08);
    ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, Math.PI * 2); ctx.stroke();
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
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {} // 이미 해제된 포인터 등 캡처 불가 시 무시
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
      detonate(aimPX, aimPY, aimLv);
      removeItem(aimIndex);           // 폭탄은 항상 소비(허탕 포함)
    } else if (aimKind === 'tongs') {
      aimPX = aimX; aimPY = toVirtY(e.clientY);
      if (pluckAt(aimPX, aimPY)) {    // 명중 시에만 소비, 허탕이면 조준 유지
        const it = tray[aimIndex];
        // 황금집게: 1탭 후에도 조준을 유지하고 남은 횟수만 줄인다 (2마리 연속)
        if (it && it.lv === 2 && it.uses > 1) { it.uses--; renderTray(); refreshCharge(); }
        else removeItem(aimIndex);
      }
    } else if (aimKind === 'promote') {
      aimPX = aimX; aimPY = toVirtY(e.clientY);
      if (promoteAt(aimPX, aimPY, aimLv)) removeItem(aimIndex);   // 명중 시에만 소비
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
  // 융합 칩 탭 — 같은 아이템 2개를 강화판 1개로 (자동 융합 없음)
  fuseChipEl.addEventListener('click', fuseItems);

  // ── 아이템 도감 (opt-in 상세 설명 — 직관 우선, 파고들고 싶은 사람용) ──
  // 효과 텍스트는 여기 한 곳에만. 이름/색/아이콘은 ITEM_DEF에서 가져와 싱크 유지.
  const GUIDE_TEXT = {
    bomb:    { d: '탭한 곳 주변의 잔챙이(쥐·햄스터)만 싹 지워요',            d2: '반경이 커지고 토끼까지 지워요' },
    magnet:  { d: '잠깐 동안 같은 동물끼리 서로 끌려가 합쳐져요',             d2: '더 오래, 더 세게 끌어당겨요' },
    shake:   { d: '판 전체를 흔들어 낀 동물이 자리를 다시 잡아요',            d2: '1.6배 세게 흔들어요' },
    tongs:   { d: '탭한 동물 하나를 집어내요 (큰 동물도 가능)',               d2: '2마리를 연속으로 집어내요' },
    wild:    { d: '다음에 떨어지는 별 동물은 처음 닿는 동물과 무조건 합쳐져요', d2: '다음 2번이 별 동물이 돼요' },
    promote: { d: '탭한 동물이 한 단계 큰 동물로 변해요',                    d2: '두 단계 커져요' },
    surge:   { d: '잠깐 동안 콤보가 훨씬 쉽게 이어져요',                     d2: '더 길게 + 콤보가 ×2부터 시작해요' },
  };
  const guideEl = document.getElementById('guide');
  const helpBtn = document.getElementById('help-btn');
  (function buildGuide() {
    const list = document.getElementById('guide-list');
    list.innerHTML = ITEM_POOL.map(({ kind }) => {
      const def = ITEM_DEF[kind], t = GUIDE_TEXT[kind];
      return '<div class="g-item">' +
        '<span class="gi" style="color:' + def.color + '"><svg><use href="' + def.icon + '"/></svg></span>' +
        '<span class="gt">' +
          '<div class="gname">' + def.label + ' <span class="gaim">· ' + (def.aim ? '탭해서 조준' : '탭하면 바로 발동') + '</span></div>' +
          '<div class="gdesc">' + t.d + '</div>' +
          '<div class="glv2">×2 <b>' + def.label2 + '</b> — ' + t.d2 + '</div>' +
        '</span></div>';
    }).join('');
  })();
  helpBtn.addEventListener('click', () => { guideEl.hidden = false; });
  document.getElementById('guide-close').addEventListener('click', () => { guideEl.hidden = true; });
  guideEl.addEventListener('click', (e) => { if (e.target === guideEl) guideEl.hidden = true; }); // 바깥 탭으로 닫기

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
  // 융합 — 두 음이 하나로 모이는 상승 3음 (강화판 완성)
  function sfxFuse() {
    if (!actx || muted) return;
    [67, 71, 79].forEach((m, i) => setTimeout(() => tone(mtof(m), 0.16, 'triangle', 0.18, mtof(m + 5)), i * 70));
  }
  // 와일드 — 반짝이는 고음 2음
  function sfxWild() {
    if (!actx || muted) return;
    tone(mtof(88), 0.1, 'sine', 0.14, mtof(93));
    setTimeout(() => tone(mtof(95), 0.14, 'sine', 0.1), 80);
  }
  // 승급 — 위로 쭉 올라가는 스윕
  function sfxPromote() {
    if (!actx || muted) return;
    tone(mtof(62), 0.22, 'triangle', 0.2, mtof(76));
    setTimeout(() => tone(mtof(79), 0.14, 'sine', 0.12), 120);
  }
  // 콤보연장 — 지잉 하는 전기음
  function sfxSurge() {
    if (!actx || muted) return;
    tone(300, 0.28, 'sawtooth', 0.12, 900);
    setTimeout(() => tone(mtof(83), 0.2, 'triangle', 0.14, mtof(88)), 140);
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
