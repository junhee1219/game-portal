// VASE — 게임 본체 (UI / 애니메이션 / 파티클 / 진행 저장)
// 순수 규칙·솔버는 core.js(VaseCore), 효과음은 audio.js(VaseAudio)에 있다.
// localStorage 키는 같은 origin의 다른 게임과 충돌하지 않게 전부 vase 접두사.
(() => {
  const C = VaseCore;
  const A = VaseAudio;
  const CAP = C.CAP;

  // 기본 8색: 파랑, 빨강, 보라, 노랑, 초록, 검정, 흰색, 주황
  // 확장 4색(lv30+): 시안, 핑크, 라임, 갈색 — 색 수는 colorsFor(level)가 정한다(최대 12)
  const COLORS = ['#3b82f6', '#ef4444', '#8b5cf6', '#facc15', '#22c55e', '#3d4654', '#eef2f7', '#f97316',
    '#22d3ee', '#ec4899', '#84cc16', '#a16207'];
  // 어두운 색(검정=5, 갈색=11)은 그라데이션 대비를 키워 빈 병과 확실히 구분되게
  const SHADE_HI = { 5: 1.65, 11: 1.45 }, SHADE_LO = { 5: 1.0, 11: 0.82 };

  // 최고 도달 레벨에 따라 진화하는 물친구 (game-icons 심볼: [기준레벨, 심볼id, 이름, 색])
  const EVOS = [
    [1, 'g-drop', '물방울', '#6fc3ff'],
    [5, 'g-bubbles', '방울방울', '#7fe3d6'],
    [10, 'g-tropical-fish', '열대어', '#ffab5e'],
    [15, 'g-octopus', '문어', '#c08bff'],
    [20, 'g-dolphin', '돌고래', '#6fa9ff'],
    [25, 'g-shark-fin', '상어', '#9fb4c8'],
    [30, 'g-sperm-whale', '고래', '#7f9fd0'],
    [40, 'g-dragon-head', '드래곤', '#8fdc7a'],
    // Lv55 반전: 서사시 정점(드래곤) → 말랑 귀여움. 이후 점점 더 귀엽게.
    [55, 'g-sheep', '양', '#f3e2cf'],
    [70, 'g-rabbit', '토끼', '#ffb3c7'],
    [85, 'g-cat', '고양이', '#cbb6e0'],
    [100, 'g-chicken', '병아리', '#ffd84d'],
  ];
  const getMaxClear = () => parseInt(localStorage.getItem('vaseMaxClear') || '0', 10) || 0;
  function evoFor(maxClear) {
    let e = EVOS[0];
    for (const ev of EVOS) if (maxClear + 1 >= ev[0]) e = ev;
    return e;
  }
  function nextEvo(maxClear) {
    for (const ev of EVOS) if (maxClear + 1 < ev[0]) return ev;
    return null;
  }
  function setEvoIcon(el, ev) {
    el.style.fill = ev[3];
    el.querySelector('use').setAttribute('href', '#' + ev[1]);
  }

  // 레벨마다 도는 배경 테마 — 단일 색조의 차분한 다크 톤 (액체가 주인공)
  const THEMES = [
    { base: '#232c39', deep: '#1a212c', vig: '#151b24' }, // 잉크 네이비
    { base: '#1e3431', deep: '#172825', vig: '#12211f' }, // 딥 틸
    { base: '#2f2622', deep: '#251d1a', vig: '#1f1815' }, // 에스프레소
    { base: '#253124', deep: '#1d261c', vig: '#182117' }, // 포레스트
    { base: '#2b2c3e', deep: '#222333', vig: '#1c1d2b' }, // 슬레이트
    { base: '#34262f', deep: '#291e25', vig: '#22191f' }, // 플럼
    { base: '#203040', deep: '#192633', vig: '#14202b' }, // 딥 오션
    { base: '#342a1e', deep: '#292117', vig: '#231c13' }, // 앰버 브라운
  ];
  function applyTheme(lv) {
    const t = THEMES[(lv - 1) % THEMES.length];
    const s = document.documentElement.style;
    s.setProperty('--base', t.base); s.setProperty('--deep', t.deep); s.setProperty('--vig', t.vig);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t.deep;
  }

  // ── 상태 ──
  let tubes = [], selected = null, moves = 0, level = 1, history = [], busy = false;
  let par = 0;          // 3★ 기준 (솔버 풀이 길이)
  let fillAmt = [];     // 화면에 그릴 액체량(연속값, 붓기 보간용)
  let wave = [];        // 수면 출렁 진폭/위상
  let bubbles = [];     // 병 속 기포
  let hiddenBelow = []; // ② 병별 가려진 바닥 칸 수(0=안 가림). 단조 감소 — 한 번 본 칸은 계속 보임
  let levelHasHidden = false, hiddenIntroShown = false;
  let pour = null;      // 붓기 진행 상태
  let hintTimer = null;
  let tubeDirty = [];   // 변화 있는 병만 다시 그린다 (유휴 시 CPU 절약)
  let fxDrawn = false;  // fx 캔버스에 지울 내용이 남아있는지
  let bubbleTimer = 800; // 기포 스폰 타이머(ms)
  let levelStart = 0;   // 레벨 시작 시각 (클리어 소요 시간 표시용)

  // ── DOM ──
  const board = document.getElementById('board');
  const clearEl = document.getElementById('clear');
  const toastEl = document.getElementById('toast');
  const starEls = [...document.querySelectorAll('#stars .k-star')];
  const recordEl = document.getElementById('clear-record');

  const fx = document.getElementById('fx');
  const fctx = fx.getContext('2d');
  function fitFx() {
    fx.width = innerWidth * devicePixelRatio;
    fx.height = innerHeight * devicePixelRatio;
    fctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  // ── 저장 (vase 접두사 필수: cube/gateway와 같은 origin) ──
  const loadJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } };
  const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const totalStars = () => Object.values(loadJSON('vaseStars')).reduce((a, b) => a + b, 0);

  const vibrate = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* iOS 미지원 */ } };

  // ── 색 유틸: 세그먼트 그라데이션용 밝기 조절 ──
  const shadeCache = {};
  function shade(hex, f) {
    const key = hex + f;
    if (shadeCache[key]) return shadeCache[key];
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const m = (x) => Math.max(0, Math.min(255, Math.round(x * f)));
    return (shadeCache[key] = `rgb(${m(r)},${m(g)},${m(b)})`);
  }

  // ── 보드 크기: 가로/세로 둘 다 맞게 병 크기를 계산 (모바일 우선) ──
  // 열 수는 CSS 미디어쿼리(가로모드 8열)와 동기화되게 computed style에서 읽는다
  function fitBoard() {
    const bw = board.clientWidth, bh = board.clientHeight;
    if (!bw || !bh) return;
    const n = tubes.length || 12;
    // 병 수에 따라 열 수 결정 (lv30+ 최대 22병 대응). 가로모드는 한 줄에 더 많이.
    const landscape = window.matchMedia && window.matchMedia('(max-height:520px)').matches;
    let cols;
    if (landscape) cols = Math.min(n, n > 16 ? 11 : 8);
    else if (n <= 12) cols = 4;
    else if (n <= 18) cols = 5;
    else cols = 6;
    board.style.gridTemplateColumns = `repeat(${cols},1fr)`;
    const rows = Math.ceil(n / cols);
    const gap = 12;
    const w = Math.max(24, Math.min(52,
      (bw - gap * (cols - 1) - 8) / cols,
      (bh - gap * (rows - 1) - 14) / rows / 3.4));
    board.style.setProperty('--w', w.toFixed(1) + 'px');
  }

  // ── 새 게임 ──
  function newGame(lv) {
    level = lv;
    moves = 0; selected = null; history = []; busy = false; pour = null;
    clearEl.classList.remove('show');
    applyTheme(lv);
    const numColors = C.colorsFor(level);
    const gen = C.generateLevel(level, numColors, { nodeBudget: 80000 });
    tubes = gen.tubes;
    par = gen.par;
    levelStart = Date.now();
    fillAmt = tubes.map((t) => t.length);
    wave = tubes.map(() => ({ a: 0, p: Math.random() * 6.28 }));
    bubbles = tubes.map(() => []);
    // ② 숨겨진 층: lv30+ 일부 병의 바닥 칸을 가린다(맨 위 1칸만 보임). 생성/솔버는 완전정보라 영향 없음.
    hiddenBelow = tubes.map(() => 0);
    const hiddenCount = level < 30 ? 0 : Math.min(2 + Math.floor((level - 30) / 3), 8);
    levelHasHidden = false;
    if (hiddenCount > 0) {
      const cand = [];
      tubes.forEach((t, i) => { if (t.length > 1) cand.push(i); }); // 1칸짜리는 가릴 게 없음
      for (let i = cand.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [cand[i], cand[j]] = [cand[j], cand[i]]; }
      cand.slice(0, hiddenCount).forEach((i) => { hiddenBelow[i] = tubes[i].length - 1; });
      levelHasHidden = cand.length > 0 && hiddenCount > 0;
    }
    localStorage.setItem('vaseLevel', String(level));
    updateHUD(); render();
    if (levelHasHidden && !hiddenIntroShown) {
      hiddenIntroShown = true;
      setTimeout(() => toast('가려진 병이 생겼어요 — 위를 비우면 아래가 드러나요!', 3200), 500);
    }
  }

  function updateHUD() {
    document.getElementById('level').textContent = level;
    document.getElementById('moves').textContent = moves;
    document.getElementById('par').textContent = '≤' + (levelHasHidden ? Math.ceil(par * 1.5) : par);
    document.getElementById('total-stars').textContent = totalStars();
    setEvoIcon(document.getElementById('evo-icon'), evoFor(getMaxClear()));
  }

  function fmtTime(ms) {
    const s = Math.max(1, Math.round(ms / 1000));
    const m = (s / 60) | 0;
    return m ? `${m}분 ${s % 60}초` : `${s}초`;
  }

  // ── 토스트 ──
  let toastTimer = null;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2000);
  }

  // ── 병 DOM ──
  function render() {
    board.innerHTML = '';
    tubes.forEach((tube, idx) => {
      const el = document.createElement('div');
      el.className = 'tube';
      if (idx === selected) el.classList.add('selected');
      if (C.isComplete(tube)) {
        el.classList.add('complete');
        const cork = document.createElement('div'); // 완성된 병은 마개로 봉인
        cork.className = 'cork';
        el.appendChild(cork);
      }
      const glass = document.createElement('div'); // 유리 글린트 (액체가 가림 → 빈 곳 표시)
      glass.className = 'glass';
      const sheen = document.createElement('div');
      sheen.className = 'sheen';
      sheen.style.animationDelay = `-${((idx * 0.83) % 4.6).toFixed(2)}s`;
      glass.appendChild(sheen);
      el.appendChild(glass);
      const cv = document.createElement('canvas');
      cv.className = 'liq';
      el.appendChild(cv);
      el.dataset.idx = idx;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(idx); });
      board.appendChild(el);
    });
    fitBoard();
    layoutLiquidCanvases();
  }

  function layoutLiquidCanvases() {
    [...board.children].forEach((el) => {
      const cv = el.querySelector('canvas.liq');
      const r = el.getBoundingClientRect();
      cv.width = Math.max(1, r.width * devicePixelRatio);
      cv.height = Math.max(1, r.height * devicePixelRatio);
    });
    tubeDirty = tubes.map(() => true); // 캔버스 리사이즈는 내용을 지우므로 전부 다시
  }

  // ── 한 병의 액체 그리기: 세그먼트 그라데이션 + 출렁이는 수면 + 기포 ──
  function drawTube(idx, dt) {
    const el = board.children[idx]; if (!el) return;
    const cv = el.querySelector('canvas.liq'); const ctx = cv.getContext('2d');
    const W = cv.width / devicePixelRatio, H = cv.height / devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const tube = tubes[idx];
    const amt = fillAmt[idx];
    const incomingIdx = (pour && pour.to === idx) ? pour.colorIdx : null;
    if (amt <= 0.001 && tube.length === 0) { bubbles[idx].length = 0; return; }

    const unitH = H / CAP;
    const mask = hiddenBelow[idx] || 0;   // ② 바닥 mask칸은 색 대신 ?(MASK=-1)로
    // 같은 색 연속 칸은 경계 없는 한 덩어리(run)로 합쳐 그린다 (가려진 칸은 색 무관하게 한 덩어리)
    const runs = [];
    let remain = amt;
    for (let i = 0; i < tube.length && remain > 0.001; i++) {
      const u = Math.min(1, remain);
      const c = (i < mask) ? -1 : tube[i];
      if (runs.length && runs[runs.length - 1].c === c) runs[runs.length - 1].u += u;
      else runs.push({ c, u });
      remain -= u;
    }
    // 붓는 중 받는 병: 들어오는 색을 위에 미리 채움 (같은 색이면 윗 덩어리에 합침)
    if (remain > 0.001 && incomingIdx !== null) {
      if (runs.length && runs[runs.length - 1].c === incomingIdx) runs[runs.length - 1].u += remain;
      else runs.push({ c: incomingIdx, u: remain });
      remain = 0;
    }
    let y = H;
    runs.forEach((r, i) => {
      const segH = r.u * unitH;
      const top = y - segH;
      if (r.c === -1) {
        // ② 가려진 칸: 중립 회색 + 물음표 (색·수면·기포 대신 마스킹)
        const grad = ctx.createLinearGradient(0, top, 0, y);
        grad.addColorStop(0, '#5b6470'); grad.addColorStop(1, '#474e58');
        ctx.fillStyle = grad;
        ctx.fillRect(0, top, W, segH + 0.5);
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        ctx.font = `700 ${Math.round(unitH * 0.46)}px -apple-system, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const cells = Math.max(1, Math.round(r.u));
        for (let k = 0; k < cells; k++) ctx.fillText('?', W / 2, y - (k + 0.5) * unitH);
        y = top;
        return;
      }
      const c = COLORS[r.c];
      const grad = ctx.createLinearGradient(0, top, 0, y);
      grad.addColorStop(0, shade(c, SHADE_HI[r.c] || 1.14));
      grad.addColorStop(1, shade(c, SHADE_LO[r.c] || 0.8));
      ctx.fillStyle = grad;
      ctx.fillRect(0, top, W, segH + 0.5);
      // 색이 바뀌는 지점에만 경계선 살짝
      if (i > 0) { ctx.globalAlpha = 0.25; ctx.fillStyle = shade(c, 0.55); ctx.fillRect(0, y - 0.8, W, 1); ctx.globalAlpha = 1; }
      y = top;
    });

    // 수면: 사인 웨이브 + 하이라이트
    const surfaceY = H - amt * unitH;
    const w = wave[idx];
    if (amt > 0.02 && runs.length) {
      const topC = runs[runs.length - 1].c;
      const sc = COLORS[topC];
      ctx.fillStyle = shade(sc, SHADE_HI[topC] ? 1.4 : 1.05);
      ctx.beginPath();
      ctx.moveTo(0, surfaceY + 4);
      const amp = w.a;
      for (let x = 0; x <= W; x += 2) ctx.lineTo(x, surfaceY + Math.sin(x * 0.18 + w.p) * amp);
      ctx.lineTo(W, surfaceY + 4);
      ctx.closePath();
      ctx.fill();
      // 표면 하이라이트
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, surfaceY);
      for (let x = 0; x <= W; x += 2) ctx.lineTo(x, surfaceY + Math.sin(x * 0.18 + w.p) * amp);
      ctx.lineTo(W, surfaceY); ctx.lineTo(W, surfaceY + 2);
      for (let x = W; x >= 0; x -= 2) ctx.lineTo(x, surfaceY + 2 + Math.sin(x * 0.18 + w.p) * amp);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;

      // 기포: 액체 속에서 천천히 올라와 수면에서 사라진다 (스폰은 loop의 타이머가 담당)
      const bs = bubbles[idx];
      for (let i = bs.length - 1; i >= 0; i--) {
        const b = bs[i];
        b.y += b.v * dt / 1000;
        const by = H - b.y;
        if (by < surfaceY + 2) { bs.splice(i, 1); continue; }
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(b.x * W, by, b.r, 0, 6.28);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // 왼쪽 광택
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#fff';
    ctx.fillRect(4, surfaceY + 3, 4, Math.max(0, H - surfaceY - 6));
    ctx.globalAlpha = 1;
  }

  // ── 입력 ──
  function onTap(idx) {
    if (busy) return;
    A.init();
    if (selected === null) {
      if (!tubes[idx].length) return;
      if (C.isComplete(tubes[idx])) return; // 마개로 닫힌 병은 선택 불가
      selected = idx;
      A.select(); vibrate(8);
      render(); return;
    }
    if (selected === idx) { selected = null; A.deselect(); render(); return; }
    if (C.canPour(tubes, selected, idx)) {
      const from = selected; selected = null;
      startPour(from, idx);
    } else {
      A.bad(); vibrate(50);
      const el = board.children[idx];
      if (el) el.classList.add('shake');
      // busy 가드: 이 타이머가 진행 중인 붓기 애니메이션의 DOM을 날리지 않게
      setTimeout(() => { if (!busy) { selected = tubes[idx].length ? idx : null; render(); } }, 300);
    }
  }

  // ── 붓기 ──
  function startPour(from, to) {
    const a = tubes[from], b = tubes[to];
    const n = Math.min(C.topCount(a), CAP - b.length);
    history.push({ t: tubes.map((x) => x.slice()), m: moves });
    const color = COLORS[C.topColor(a)];
    busy = true;
    render(); // selected 해제 반영
    const fromEl = board.children[from], toEl = board.children[to];
    const fr = fromEl.getBoundingClientRect(), tr = toEl.getBoundingClientRect();
    const goLeft = (fr.left + fr.width / 2) > (tr.left + tr.width / 2);
    const tilt = goLeft ? -80 : 80;
    const targetCenterX = tr.left + tr.width / 2;
    const targetX = targetCenterX - (fr.left + fr.width / 2);
    const targetY = (tr.top - fr.height * 0.30) - fr.top;
    fromEl.style.zIndex = 60;
    fromEl.style.transition = 'transform .4s cubic-bezier(.45,0,.25,1)';
    fromEl.style.transformOrigin = 'top center';
    fromEl.style.transform = `translate(${targetX}px,${targetY}px) rotate(${tilt}deg)`;

    pour = {
      from, to, units: n, color, colorIdx: C.topColor(a),
      tiltDelay: 400, dur: 140 * n + 220, elapsed: 0, streaming: false,
      spoutX: targetCenterX,
      srcStart: fillAmt[from], dstStart: fillAmt[to],
      srcEnd: fillAmt[from] - n, dstEnd: fillAmt[to] + n,
      toRect: tr,
    };
    vibrate(12);
    setTimeout(() => {
      if (pour) {
        pour.streaming = true;
        A.pour(pour.dur / 1000, n);
      }
    }, pour.tiltDelay);
    setTimeout(() => finishPour(from, to, n), pour.tiltDelay + pour.dur + 180);
  }

  function finishPour(from, to, n) {
    if (!pour) return;
    fillAmt[from] = pour.srcEnd; fillAmt[to] = pour.dstEnd;
    for (let i = 0; i < n; i++) tubes[to].push(tubes[from].pop());
    // ② from 병의 위를 비웠으니 새 top 칸이 드러난다 (단조 감소 — 다시 가려지지 않음)
    hiddenBelow[from] = Math.min(hiddenBelow[from], Math.max(0, tubes[from].length - 1));
    moves++;
    pour = null;
    updateHUD();
    render();
    busy = false;
    if (C.isComplete(tubes[to])) {
      const el = board.children[to];
      if (el) {
        el.classList.add('complete');
        const r = el.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + 6, COLORS[tubes[to][0]], 26);
      }
      A.tubeDone(); vibrate([20, 30, 45]);
    }
    if (C.isWin(tubes)) { onWin(); return; }
    // 막힘 감지: 가능한 수가 하나도 없으면 알려준다
    if (!anyMoveExists()) { toast('막혔어요! 되돌리기로 살려보세요'); A.bad(); }
  }

  function anyMoveExists() {
    for (let i = 0; i < tubes.length; i++) {
      for (let j = 0; j < tubes.length; j++) {
        if (C.canPour(tubes, i, j) && !C.isComplete(tubes[i])) return true;
      }
    }
    return false;
  }

  // ── 클리어 ──
  function onWin() {
    busy = true;
    const stars = C.starsFor(moves, par, levelHasHidden);  // ② 숨김 레벨은 3★ 기준 완화
    const elapsed = Date.now() - levelStart;
    // 진행 저장 (별/베스트는 더 좋아진 경우만 갱신)
    const starsMap = loadJSON('vaseStars');
    if (!starsMap[level] || stars > starsMap[level]) { starsMap[level] = stars; saveJSON('vaseStars', starsMap); }
    const bestMap = loadJSON('vaseBest');
    const isRecord = !bestMap[level] || moves < bestMap[level];
    if (isRecord) { bestMap[level] = moves; saveJSON('vaseBest', bestMap); }
    // 최고 도달 레벨 갱신 + 진화 체크
    const maxBefore = getMaxClear();
    if (level > maxBefore) localStorage.setItem('vaseMaxClear', String(level));
    const evolved = evoFor(getMaxClear())[1] !== evoFor(maxBefore)[1];
    localStorage.setItem('vaseLevel', String(level + 1)); // 클리어 화면에서 나가도 다음 레벨부터
    updateHUD();

    setTimeout(() => { A.win(); vibrate([30, 50, 30, 50, 90]); startWinFx(); }, 320);
    setTimeout(() => {
      document.getElementById('clear-level').textContent = level;
      document.getElementById('clear-time').textContent = fmtTime(elapsed);
      document.getElementById('clear-moves').textContent = moves;
      document.getElementById('clear-par').textContent = '≤' + par;
      starEls.forEach((s) => s.classList.remove('on'));
      recordEl.classList.remove('show');
      clearEl.classList.add('show');
      for (let i = 0; i < stars; i++) {
        setTimeout(() => { starEls[i].classList.add('on'); A.star(i); vibrate(18); }, 380 + i * 340);
      }
      if (isRecord) {
        setTimeout(() => { recordEl.classList.add('show'); A.record(); }, 380 + stars * 340 + 120);
      }
      if (evolved) {
        setTimeout(() => {
          toast(`물친구가 ${evoFor(getMaxClear())[2]}(으)로 진화했어요!`, 3000);
          A.record(); vibrate([20, 40, 20, 40, 60]);
        }, 380 + stars * 340 + 600);
      }
    }, 780);
  }

  document.getElementById('btn-next').addEventListener('click', () => {
    A.init(); A.uiClick();
    newGame(level + 1);
  });

  // ── 레벨 선택: 깬 레벨 + 다음 레벨까지 선택 가능, 물친구 진화 전시 ──
  const levelsModal = document.getElementById('levels');
  function closeLevels() { levelsModal.classList.add('hidden'); }
  function openLevels() {
    const maxClear = getMaxClear();
    const starsMap = loadJSON('vaseStars');
    setEvoIcon(document.getElementById('evo-emoji'), evoFor(maxClear));
    const nx = nextEvo(maxClear);
    document.getElementById('evo-text').innerHTML = nx
      ? `최고 Lv${maxClear || 0} 클리어<br>Lv${nx[0]} 도달하면 ${nx[2]}(으)로 진화!`
      : `최고 Lv${maxClear} 클리어 · 최종 진화 완료!`;
    const grid = document.getElementById('level-grid');
    grid.innerHTML = '';
    for (let lv = 1; lv <= maxClear + 1; lv++) {
      const b = document.createElement('button');
      b.className = 'lv-chip' + (lv === level ? ' cur' : '');
      b.innerHTML = `${lv}<span class="chip-stars">${'★'.repeat(starsMap[lv] || 0) || '·'}</span>`;
      b.addEventListener('click', () => { closeLevels(); A.uiClick(); newGame(lv); });
      grid.appendChild(b);
    }
    for (let k = 0; k < 2; k++) { // 잠긴 다음 레벨 살짝 보여주기
      const b = document.createElement('button');
      b.className = 'lv-chip lock';
      b.innerHTML = '<svg class="ki sm" style="opacity:.75"><use href="#p-lock"/></svg><span class="chip-stars">·</span>';
      grid.appendChild(b);
    }
    levelsModal.classList.remove('hidden');
    const cur = grid.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }
  document.getElementById('level-btn').addEventListener('click', () => {
    if (busy) return;
    A.init(); A.uiClick();
    openLevels();
  });
  document.getElementById('levels-close').addEventListener('click', closeLevels);
  levelsModal.addEventListener('click', (e) => { if (e.target === levelsModal) closeLevels(); });

  // ── 비밀 작업실: 타이틀 5연타로 열림 (진행 내보내기/가져오기 + 레벨 점프) ──
  const SAVE_KEYS = ['vaseLevel', 'vaseMaxClear', 'vaseStars', 'vaseBest', 'vaseMuted'];
  const secretModal = document.getElementById('secret');
  function checksum(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function exportCode() {
    const data = {};
    for (const k of SAVE_KEYS) {
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    return 'VASE1.' + b64 + '.' + checksum(b64);
  }
  function importCode(code) {
    const m = String(code).trim().match(/^VASE1\.([A-Za-z0-9+/=]+)\.([a-z0-9]+)$/);
    if (!m || checksum(m[1]) !== m[2]) return false;
    let data;
    try { data = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { return false; }
    if (!data || typeof data !== 'object') return false;
    for (const k of SAVE_KEYS) if (data[k] !== undefined) localStorage.setItem(k, String(data[k]));
    return true;
  }
  let titleTaps = [];
  document.querySelector('h1').addEventListener('pointerdown', () => {
    const now = Date.now();
    titleTaps = titleTaps.filter((t) => now - t < 1600);
    titleTaps.push(now);
    if (titleTaps.length >= 5) {
      titleTaps = [];
      A.init(); A.tubeDone(); vibrate([20, 30, 20]);
      document.getElementById('exp-code').value = '';
      document.getElementById('imp-code').value = '';
      secretModal.classList.remove('hidden');
    }
  });
  document.getElementById('btn-export').addEventListener('click', () => {
    document.getElementById('exp-code').value = exportCode();
    A.uiClick();
  });
  document.getElementById('btn-copy').addEventListener('click', async () => {
    const ta = document.getElementById('exp-code');
    if (!ta.value) ta.value = exportCode();
    try {
      await navigator.clipboard.writeText(ta.value);
      toast('복사 완료! 다른 기기에서 붙여넣으세요');
    } catch (e) {
      ta.focus(); ta.select(); // 클립보드 권한이 없으면 직접 복사하게 선택만
      toast('길게 눌러 복사하세요');
    }
    A.uiClick();
  });
  document.getElementById('btn-import').addEventListener('click', () => {
    const ok = importCode(document.getElementById('imp-code').value);
    if (!ok) { toast('코드가 올바르지 않아요'); A.bad(); return; }
    A.tubeDone();
    toast('가져오기 완료! 잠시만요…');
    setTimeout(() => location.reload(), 700); // 저장값 기준으로 깔끔하게 재시작
  });
  document.getElementById('btn-jump').addEventListener('click', () => {
    const lv = parseInt(document.getElementById('jump-lv').value, 10);
    if (!Number.isFinite(lv) || lv < 1 || lv > 999) { toast('1~999 레벨로만 점프할 수 있어요'); A.bad(); return; }
    secretModal.classList.add('hidden');
    A.uiClick();
    newGame(lv);
    toast(`Lv${lv}로 점프!`);
  });
  document.getElementById('secret-close').addEventListener('click', () => secretModal.classList.add('hidden'));
  secretModal.addEventListener('click', (e) => { if (e.target === secretModal) secretModal.classList.add('hidden'); });

  // ── 간식 사주기: game-kit snack.js 모듈 (PC fallback 모달 포함) ──
  initSnack(document.getElementById('snack-mount'));

  // ── 파티클 (fx 캔버스, 화면 좌표) ──
  let parts = [];      // {kind, x,y,vx,vy,g,life,age,color,size,rot,vr,sway}
  let confettiLeft = 0;

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * 6.28, sp = 60 + Math.random() * 220;
      parts.push({
        kind: 'spark', x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 80,
        g: 420, life: 0.55 + Math.random() * 0.5, age: 0,
        color: Math.random() < 0.3 ? '#ffd66b' : color,
        size: 1.5 + Math.random() * 2.5,
      });
    }
  }

  function startWinFx() {
    confettiLeft = 150;
    // 화면 곳곳 별 폭죽
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        burst(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.15 + Math.random() * 0.4),
          COLORS[(Math.random() * COLORS.length) | 0], 30);
      }, i * 280);
    }
  }

  function spawnConfetti() {
    const n = Math.min(confettiLeft, 4);
    for (let i = 0; i < n; i++) {
      parts.push({
        kind: 'confetti',
        x: Math.random() * innerWidth, y: -14 - Math.random() * 30,
        vx: 0, vy: 60 + Math.random() * 110,
        g: 70, life: 4, age: 0,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        size: 5 + Math.random() * 5,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 8,
        sway: 1.5 + Math.random() * 2.5,
      });
    }
    confettiLeft -= n;
  }

  function updateParticles(dt) {
    const s = dt / 1000;
    if (confettiLeft > 0) spawnConfetti();
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += s;
      if (p.age > p.life || p.y > innerHeight + 30) { parts.splice(i, 1); continue; }
      p.vy += p.g * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
      if (p.kind === 'confetti') {
        p.x += Math.sin(p.age * p.sway * 2) * 40 * s;
        p.rot += p.vr * s;
        fctx.save();
        fctx.translate(p.x, p.y);
        fctx.rotate(p.rot);
        fctx.globalAlpha = Math.min(1, (p.life - p.age) / 0.8);
        fctx.fillStyle = p.color;
        fctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        fctx.restore();
      } else { // spark, droplet
        fctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        fctx.fillStyle = p.color;
        fctx.beginPath();
        fctx.arc(p.x, p.y, p.size, 0, 6.28);
        fctx.fill();
        fctx.globalAlpha = 1;
      }
    }
  }

  // ── 연속 물줄기 (원본 유지: 위는 굵고 아래로 가늘어짐 + 미세 흔들림) ──
  function drawStream(x, topY, surfY, color) {
    const len = surfY - topY;
    if (len <= 2) return;
    const t = performance.now() * 0.012;
    fctx.save();
    fctx.beginPath();
    const steps = 14;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const yy = topY + len * f;
      const wob = Math.sin(t + f * 4) * 1.1 * (1 - f * 0.4);
      const wHere = 4.2 - f * 2.7;
      fctx.lineTo(x + wob - wHere, yy);
    }
    for (let s = steps; s >= 0; s--) {
      const f = s / steps;
      const yy = topY + len * f;
      const wob = Math.sin(t + f * 4) * 1.1 * (1 - f * 0.4);
      const wHere = 4.2 - f * 2.7;
      fctx.lineTo(x + wob + wHere, yy);
    }
    fctx.closePath();
    const grad = fctx.createLinearGradient(0, topY, 0, surfY);
    grad.addColorStop(0, color + 'cc');
    grad.addColorStop(1, color);
    fctx.fillStyle = grad;
    fctx.shadowColor = color; fctx.shadowBlur = 6;
    fctx.fill();
    // 착수 지점 출렁
    fctx.shadowBlur = 0;
    fctx.globalAlpha = 0.85;
    fctx.fillStyle = color;
    const sw = 4 + Math.sin(t * 2) * 1.5;
    fctx.beginPath();
    fctx.ellipse(x, surfY, sw, 2.4, 0, 0, Math.PI * 2);
    fctx.fill();
    fctx.globalAlpha = 1;
    fctx.restore();
  }

  // ── 메인 루프 ──
  // 유휴 시 CPU를 쓰지 않게: fx 레이어는 그릴 게 있을 때만, 병은 변화가 있는 것만 다시 그린다
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(40, now - last); last = now;
    for (let i = 0; i < wave.length; i++) { wave[i].p += dt * 0.012; wave[i].a *= 0.94; }

    // 기포 스폰: 가끔 아무 병에서나 보글 (은은한 생동감, 병당 최대 3개)
    bubbleTimer -= dt;
    if (bubbleTimer <= 0) {
      bubbleTimer = 500 + Math.random() * 1100;
      const idx = (Math.random() * tubes.length) | 0;
      if (fillAmt[idx] > 0.6 && bubbles[idx].length < 3) {
        const el = board.children[idx];
        const unitH = el ? el.clientHeight / CAP : 40;
        bubbles[idx].push({ x: 0.2 + Math.random() * 0.6, y: 2 + Math.random() * (fillAmt[idx] * unitH * 0.5), r: 0.8 + Math.random() * 1.4, v: 8 + Math.random() * 12 });
      }
    }

    // fx 레이어 (물줄기/파티클/컨페티) — 활동 있을 때만 그리고, 끝나면 한 번 지운다
    const fxActive = !!pour || parts.length > 0 || confettiLeft > 0;
    if (fxActive || fxDrawn) {
      fctx.clearRect(0, 0, innerWidth, innerHeight);
      fxDrawn = fxActive;
    }

    if (pour && pour.streaming) {
      pour.elapsed += dt;
      const prog = Math.min(1, pour.elapsed / pour.dur);
      fillAmt[pour.from] = pour.srcStart + (pour.srcEnd - pour.srcStart) * prog;
      fillAmt[pour.to] = pour.dstStart + (pour.dstEnd - pour.dstStart) * prog;
      const toEl = board.children[pour.to];
      if (toEl) {
        const tr = pour.toRect;
        const innerTop = tr.top + 2, innerBot = tr.bottom - 4, hh = innerBot - innerTop;
        const surfY = innerBot - (fillAmt[pour.to] / CAP) * hh;
        const sx = pour.spoutX;
        drawStream(sx, tr.top - 6, surfY, pour.color);
        // 착수 스플래시 물방울
        if (Math.random() < 0.3) {
          parts.push({
            kind: 'droplet',
            x: sx + (Math.random() - 0.5) * 8, y: surfY,
            vx: (Math.random() - 0.5) * 90, vy: -(50 + Math.random() * 120),
            g: 620, life: 0.45 + Math.random() * 0.25, age: 0,
            color: pour.color, size: 1.2 + Math.random() * 1.6,
          });
        }
        wave[pour.to].a = Math.min(5, wave[pour.to].a + 0.6);
      }
    }

    if (fxActive) updateParticles(dt);

    for (let i = 0; i < tubes.length; i++) {
      const animating = (pour && (pour.from === i || pour.to === i))
        || wave[i].a > 0.004 || bubbles[i].length > 0 || tubeDirty[i];
      if (animating) { drawTube(i, dt); tubeDirty[i] = false; }
    }
    requestAnimationFrame(loop);
  }

  // ── 버튼들 ──
  document.getElementById('undo').addEventListener('click', () => {
    if (busy) return;
    A.init();
    if (!history.length) { toast('되돌릴 게 없어요'); return; }
    const h = history.pop();
    tubes = h.t; moves = h.m;
    fillAmt = tubes.map((t) => t.length);
    selected = null;
    A.uiClick(); vibrate(10);
    updateHUD(); render();
  });

  document.getElementById('new').addEventListener('click', () => {
    if (busy) return;
    A.init(); A.uiClick();
    newGame(level);
  });

  // 힌트: 솔버가 실제 풀이의 첫 수를 알려준다
  document.getElementById('hint').addEventListener('click', () => {
    if (busy) return;
    A.init(); A.uiClick();
    clearTimeout(hintTimer);
    const r = C.solve(tubes, 25000);
    if (r.solved && r.moves.length) {
      const [f, t] = r.moves[0];
      render();
      board.children[f].classList.add('selected');
      board.children[t].classList.add('hint-target');
      hintTimer = setTimeout(() => { if (!busy) render(); }, 950);
    } else if (!r.exhausted) {
      toast('여기선 못 풀어요 — 되돌리기!');
      A.bad();
    } else {
      // 탐색 예산 초과(드묾): 일단 가능한 수 하나라도
      outer: for (let i = 0; i < tubes.length; i++) {
        for (let j = 0; j < tubes.length; j++) {
          if (C.canPour(tubes, i, j) && !C.isComplete(tubes[i])) {
            render();
            board.children[i].classList.add('selected');
            board.children[j].classList.add('hint-target');
            hintTimer = setTimeout(() => { if (!busy) render(); }, 950);
            break outer;
          }
        }
      }
    }
  });

  const muteBtn = document.getElementById('mute');
  function refreshMute() {
    document.querySelector('#mute-icon use').setAttribute('href', A.muted ? '#p-speaker-slash' : '#p-speaker-high');
  }
  muteBtn.addEventListener('click', () => {
    A.init();
    A.setMuted(!A.muted);
    refreshMute();
    if (!A.muted) A.uiClick();
  });
  refreshMute();

  // ── 시스템 ──
  addEventListener('resize', () => {
    fitFx(); fitBoard(); layoutLiquidCanvases();
    fxDrawn = true; // fx 캔버스 백버퍼가 리셋됐으니 다음 프레임에 정리
    // 붓는 중 회전/리사이즈: 물줄기 좌표를 새 위치로 갱신
    if (pour) {
      const toEl = board.children[pour.to];
      if (toEl) {
        pour.toRect = toEl.getBoundingClientRect();
        pour.spoutX = pour.toRect.left + pour.toRect.width / 2;
      }
    }
  });
  document.addEventListener('visibilitychange', () => { document.hidden ? A.suspend() : A.resume(); });
  document.addEventListener('pointerdown', () => A.init(), { passive: true });
  board.addEventListener('contextmenu', (e) => e.preventDefault());

  // QA용 디버그 훅 (게임 동작엔 영향 없음)
  window.__vase = {
    core: C,
    get state() { return { tubes: tubes.map((t) => t.slice()), moves, level, par, busy }; },
    setBoard(t) {
      tubes = t.map((x) => x.slice());
      fillAmt = tubes.map((x) => x.length);
      wave = tubes.map(() => ({ a: 0, p: 0 }));
      bubbles = tubes.map(() => []);
      selected = null; history = []; busy = false; pour = null;
      render();
    },
    setPar(p) { par = p; updateHUD(); },
    newGame: (lv) => newGame(lv || level),
  };

  // ── 시작 ──
  fitFx();
  const savedLevel = parseInt(localStorage.getItem('vaseLevel') || '1', 10);
  // 옛 저장 호환: vaseLevel까지 도달했다면 그 전 레벨까지는 깬 것
  if (Number.isFinite(savedLevel) && savedLevel - 1 > getMaxClear()) {
    localStorage.setItem('vaseMaxClear', String(savedLevel - 1));
  }
  newGame(Number.isFinite(savedLevel) && savedLevel > 0 ? savedLevel : 1);
  requestAnimationFrame(loop);
})();
