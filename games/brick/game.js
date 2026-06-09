/* 벽돌 깨기 (brick) — 브레이크아웃. 자체 물리(원↔AABB 반사), 파티클, 파워업.
   원본 무수정 원칙: portal.js 미주입. 최고점 brickBest, 음소거 brickMuted. */
(() => {
  'use strict';

  // ── 캔버스 / 좌표계 ──────────────────────────────────────────
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('wrap');
  // 논리 해상도(세로 우선). 실제 픽셀은 DPR 곱.
  const W = 360, H = 560;
  let DPR = 1;

  function fit() {
    // 사용 가능한 영역에 9:14 비율 유지하며 맞춤
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    let cw = availW, ch = cw * (H / W);
    if (ch > availH) { ch = availH; cw = ch * (W / H); }
    const stage = document.getElementById('stage');
    stage.style.width = cw + 'px';
    stage.style.height = ch + 'px';
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  // ── 사운드 (WebAudio, 라이브러리 없음) ───────────────────────
  let muted = localStorage.getItem('brickMuted') === '1';
  let actx = null;
  function ensureAudio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') actx.resume();
  }
  function beep(freq, dur, type, vol) {
    if (muted || !actx) return;
    try {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      const t = actx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + (dur || 0.08) + 0.02);
    } catch (e) {}
  }
  const snd = {
    paddle: () => beep(440, 0.06, 'triangle', 0.16),
    wall: () => beep(300, 0.04, 'sine', 0.10),
    brick: (n) => beep(520 + n * 40, 0.06, 'square', 0.12),
    power: () => { beep(660, 0.08, 'triangle', 0.18); setTimeout(() => beep(880, 0.10, 'triangle', 0.18), 70); },
    loseLife: () => beep(160, 0.30, 'sawtooth', 0.16),
    stage: () => { beep(523, 0.1, 'triangle', 0.18); setTimeout(() => beep(659, 0.1, 'triangle', 0.18), 90); setTimeout(() => beep(784, 0.16, 'triangle', 0.2), 180); },
    over: () => { beep(330, 0.18, 'sawtooth', 0.16); setTimeout(() => beep(220, 0.3, 'sawtooth', 0.16), 150); },
  };
  function vibe(ms) { if (!muted && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }

  const muteUse = document.getElementById('mute-use');
  function refreshMute() {
    muteUse.setAttribute('href', muted ? '#p-speaker-slash' : '#p-speaker-high');
  }
  document.getElementById('mute').addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem('brickMuted', muted ? '1' : '0');
    refreshMute();
    if (!muted) { ensureAudio(); beep(660, 0.07, 'triangle', 0.16); }
  });
  refreshMute();

  // ── 파스텔 팔레트 (단일 색조 톤, 명도폭 좁게) ────────────────
  // 색 매치 보너스: 한 행에 같은 색만 다 깨면 보너스
  const BRICK_COLORS = [
    { fill: '#ff9bb0', edge: '#e06b86', name: 'pink' },
    { fill: '#8fd3ff', edge: '#4ea3df', name: 'blue' },
    { fill: '#ffd27a', edge: '#e0a338', name: 'amber' },
    { fill: '#9be8b4', edge: '#54bd7e', name: 'mint' },
    { fill: '#c5a8ff', edge: '#9166e0', name: 'lilac' },
    { fill: '#ffb38a', edge: '#df8048', name: 'peach' },
  ];

  // ── 게임 상태 ────────────────────────────────────────────────
  let score = 0, lives = 3, level = 1;
  let best = parseInt(localStorage.getItem('brickBest') || '0', 10) || 0;
  let running = false;     // 공이 살아 움직이는가
  let mode = 'start';      // start | playing | dead | over | clear
  let bricks = [];
  let balls = [];
  let powerups = [];
  let particles = [];
  let paddle = { x: W / 2, w: 86, h: 14, y: H - 36 };
  let basePaddleW = 86;
  let widePaddleUntil = 0;
  let pierceUntil = 0;
  let stuckToPaddle = true; // 발사 전 공이 패들에 붙어 있음
  let shakeUntil = 0, shakeMag = 0;

  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const overlay = document.getElementById('overlay');
  const card = document.getElementById('card');
  const toast = document.getElementById('toast');

  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
  }

  function renderLives() {
    let html = '';
    const total = Math.max(lives, 0);
    for (let i = 0; i < 3; i++) {
      html += '<svg class="ki' + (i < total ? '' : ' gone') + '"><use href="#p-heart"/></svg>';
    }
    // 라이프가 3 초과면 숫자로 보조
    if (lives > 3) html += '<b style="font-size:12px;margin-left:2px;color:#ff7a93">x' + lives + '</b>';
    livesEl.innerHTML = html;
  }
  function setScore(v) { score = v; scoreEl.textContent = score; }

  // ── 레벨 생성 ────────────────────────────────────────────────
  function buildLevel(lv) {
    bricks = [];
    const cols = 8;
    const rows = Math.min(4 + Math.floor(lv / 2), 8);
    const pad = 6, top = 56, side = 14;
    const bw = (W - side * 2 - pad * (cols - 1)) / cols;
    const bh = 20;
    for (let r = 0; r < rows; r++) {
      const color = BRICK_COLORS[r % BRICK_COLORS.length];
      for (let c = 0; c < cols; c++) {
        // 위쪽 행일수록 단단(2히트) 확률 높음
        const tough = lv >= 3 && r < 2 && Math.random() < 0.35;
        // 군데군데 빈 칸 (lv 올라갈수록 덜)
        if (lv >= 4 && Math.random() < 0.12) continue;
        bricks.push({
          x: side + c * (bw + pad), y: top + r * (bh + pad),
          w: bw, h: bh, color, row: r,
          hp: tough ? 2 : 1, max: tough ? 2 : 1, alive: true,
        });
      }
    }
  }

  function spawnBall(fromPaddle) {
    const speed = 4.4 + level * 0.35; // 점점 빨라짐
    if (fromPaddle) {
      balls.push({ x: paddle.x, y: paddle.y - 12, dx: 0, dy: 0, r: 7, speed, stuck: true });
    } else {
      const ang = (-Math.PI / 2) + (Math.random() - 0.5) * 0.6;
      balls.push({ x: W / 2, y: H / 2, dx: Math.cos(ang) * speed, dy: Math.sin(ang) * speed, r: 7, speed, stuck: false });
    }
  }

  function resetForLife() {
    balls = [];
    powerups = [];
    paddle.w = basePaddleW;
    widePaddleUntil = 0; pierceUntil = 0;
    spawnBall(true);
    stuckToPaddle = true;
  }

  function startLevel(lv) {
    level = lv;
    buildLevel(lv);
    resetForLife();
    mode = 'playing';
    running = true;
    overlay.classList.add('hidden');
  }

  function newGame() {
    setScore(0);
    lives = 3;
    renderLives();
    level = 1;
    startLevel(1);
  }

  // ── 파워업 ───────────────────────────────────────────────────
  const POWER = {
    multi: { color: '#8fd3ff', edge: '#4ea3df', label: '멀티볼' },
    wide: { color: '#9be8b4', edge: '#54bd7e', label: '긴 패들' },
    pierce: { color: '#ffd27a', edge: '#e0a338', label: '관통볼' },
    life: { color: '#ff9bb0', edge: '#e06b86', label: '+1 라이프' },
  };
  function maybeDropPower(x, y) {
    if (Math.random() < 0.13) {
      const keys = ['multi', 'wide', 'pierce', 'life'];
      // life는 드물게
      let type = keys[Math.floor(Math.random() * keys.length)];
      if (type === 'life' && Math.random() < 0.6) type = keys[Math.floor(Math.random() * 3)];
      powerups.push({ x, y, w: 26, h: 26, type, vy: 2.0, rot: 0 });
    }
  }
  function applyPower(type) {
    snd.power(); vibe([12, 30, 12]);
    if (type === 'multi') {
      const cur = balls.filter((b) => !b.stuck);
      const src = cur.length ? cur : balls;
      const add = [];
      src.slice(0, 3).forEach((b) => {
        for (let k = 0; k < 2; k++) {
          const ang = Math.atan2(b.dy, b.dx) + (k ? 0.4 : -0.4);
          add.push({ x: b.x, y: b.y, dx: Math.cos(ang) * b.speed, dy: Math.sin(ang) * b.speed, r: b.r, speed: b.speed, stuck: false });
        }
      });
      balls = balls.concat(add).slice(0, 9);
      showToast('멀티볼!');
    } else if (type === 'wide') {
      paddle.w = Math.min(basePaddleW * 1.6, 150);
      widePaddleUntil = performance.now() + 9000;
      showToast('패들이 길어졌다');
    } else if (type === 'pierce') {
      pierceUntil = performance.now() + 7000;
      showToast('관통볼!');
    } else if (type === 'life') {
      lives++; renderLives();
      showToast('+1 라이프');
    }
  }

  // ── 파티클 (벽돌 파편) ───────────────────────────────────────
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3.5;
      particles.push({
        x, y, dx: Math.cos(a) * sp, dy: Math.sin(a) * sp - 1,
        size: 2 + Math.random() * 4, life: 1, color,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  // ── 입력 (패들 드래그) ───────────────────────────────────────
  let dragging = false;
  function canvasX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }
  function movePaddle(clientX) {
    const x = canvasX(clientX);
    paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, x));
  }
  function launchStuck() {
    if (!stuckToPaddle) return;
    let any = false;
    balls.forEach((b) => {
      if (b.stuck) {
        const ang = (-Math.PI / 2) + (Math.random() - 0.5) * 0.4;
        b.dx = Math.cos(ang) * b.speed; b.dy = Math.sin(ang) * b.speed; b.stuck = false; any = true;
      }
    });
    if (any) { stuckToPaddle = false; snd.paddle(); }
  }
  canvas.addEventListener('pointerdown', (e) => {
    ensureAudio();
    if (mode !== 'playing') return;
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    movePaddle(e.clientX);
    launchStuck();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || mode !== 'playing') return;
    movePaddle(e.clientX);
    if (stuckToPaddle) balls.forEach((b) => { if (b.stuck) { b.x = paddle.x; b.y = paddle.y - 12; } });
    e.preventDefault();
  });
  function endDrag() { dragging = false; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ── 물리: 공↔AABB 반사 ──────────────────────────────────────
  function collideBrick(b, br) {
    // 가장 가까운 점
    const nx = Math.max(br.x, Math.min(b.x, br.x + br.w));
    const ny = Math.max(br.y, Math.min(b.y, br.y + br.h));
    const dx = b.x - nx, dy = b.y - ny;
    if (dx * dx + dy * dy > b.r * b.r) return false;
    // 관통볼이면 반사 생략하고 통과
    const pierce = performance.now() < pierceUntil;
    if (!pierce) {
      // 침투 방향 판정: 겹친 폭이 작은 축으로 반사
      const overlapX = (b.r + br.w / 2) - Math.abs(b.x - (br.x + br.w / 2));
      const overlapY = (b.r + br.h / 2) - Math.abs(b.y - (br.y + br.h / 2));
      if (overlapX < overlapY) {
        b.dx = -b.dx;
        b.x += b.dx > 0 ? overlapX : -overlapX;
      } else {
        b.dy = -b.dy;
        b.y += b.dy > 0 ? overlapY : -overlapY;
      }
    }
    return true;
  }

  function hitBrick(br, b) {
    br.hp--;
    if (br.hp > 0) {
      snd.brick(0); burst(b.x, b.y, br.color.fill, 4);
      return;
    }
    br.alive = false;
    setScore(score + 10 * level);
    snd.brick(br.row); vibe(10);
    burst(br.x + br.w / 2, br.y + br.h / 2, br.color.fill, 12);
    maybeDropPower(br.x + br.w / 2, br.y + br.h / 2);
    checkRowBonus(br);
  }

  function checkRowBonus(br) {
    // 같은 행 + 같은 색이 전부 사라졌으면 보너스
    const sameRow = bricks.filter((x) => x.row === br.row);
    if (sameRow.length && sameRow.every((x) => !x.alive)) {
      setScore(score + 50 * level);
      showToast('색 매치 +' + (50 * level));
      beep(900, 0.12, 'triangle', 0.16);
    }
  }

  function loseLife() {
    lives--;
    renderLives();
    snd.loseLife(); vibe([40, 30, 40]);
    shakeUntil = performance.now() + 320; shakeMag = 8;
    if (lives <= 0) { gameOver(); return; }
    resetForLife();
  }

  function gameOver() {
    mode = 'over'; running = false;
    snd.over();
    let isRec = false;
    if (score > best) { best = score; localStorage.setItem('brickBest', String(best)); isRec = true; }
    showCard(
      '<h2>게임 오버</h2>' +
      '<p>이번 점수</p><div class="big">' + score + '</div>' +
      (isRec ? '<span id="rec" class="show"><svg class="ki"><use href="#p-trophy"/></svg>신기록!</span>'
             : '<p style="margin-top:8px">최고 ' + best + '점</p>') +
      '<br><button class="btn" id="again">다시 하기</button>',
    );
    document.getElementById('again').addEventListener('click', () => { ensureAudio(); newGame(); });
  }

  function levelClear() {
    mode = 'clear'; running = false;
    setScore(score + 100); // 클리어 보너스
    snd.stage();
    showCard(
      '<h2>스테이지 ' + level + ' 클리어!</h2>' +
      '<p>다음 스테이지는 더 빨라져요</p>' +
      '<div class="big">' + score + '</div>' +
      '<button class="btn" id="next">다음 스테이지</button>',
    );
    document.getElementById('next').addEventListener('click', () => { ensureAudio(); startLevel(level + 1); });
  }

  function showCard(html) {
    card.innerHTML = html;
    overlay.classList.remove('hidden');
  }

  function showStart() {
    let legend = '';
    Object.keys(POWER).forEach((k) => {
      legend += '<span><i style="background:' + POWER[k].color + ';border:1px solid ' + POWER[k].edge + '"></i>' + POWER[k].label + '</span>';
    });
    showCard(
      '<h2>벽돌 깨기</h2>' +
      '<p>패들을 좌우로 끌어 공을 튕기고<br>위쪽 벽돌을 모두 깨세요</p>' +
      '<div class="legend">' + legend + '</div>' +
      '<button class="btn" id="play">시작</button>' +
      '<div class="hint">화면을 탭하면 공이 발사돼요 · 최고 ' + best + '점</div>',
    );
    document.getElementById('play').addEventListener('click', () => { ensureAudio(); newGame(); });
  }

  // ── 업데이트 루프 ────────────────────────────────────────────
  function update() {
    const now = performance.now();
    if (widePaddleUntil && now > widePaddleUntil) { paddle.w = basePaddleW; widePaddleUntil = 0; }

    if (running) {
      // 공
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b.stuck) { b.x = paddle.x; b.y = paddle.y - 12; continue; }
        b.x += b.dx; b.y += b.dy;
        // 벽
        if (b.x - b.r < 0) { b.x = b.r; b.dx = -b.dx; snd.wall(); }
        if (b.x + b.r > W) { b.x = W - b.r; b.dx = -b.dx; snd.wall(); }
        if (b.y - b.r < 0) { b.y = b.r; b.dy = -b.dy; snd.wall(); }
        // 패들
        if (b.dy > 0 && b.y + b.r >= paddle.y && b.y - b.r <= paddle.y + paddle.h &&
            b.x >= paddle.x - paddle.w / 2 - b.r && b.x <= paddle.x + paddle.w / 2 + b.r) {
          // 패들 위치로 반사각 제어
          const rel = (b.x - paddle.x) / (paddle.w / 2); // -1..1
          const ang = (-Math.PI / 2) + rel * (Math.PI / 3); // ±60°
          const sp = b.speed;
          b.dx = Math.cos(ang) * sp; b.dy = Math.sin(ang) * sp;
          if (b.dy > -1.2) b.dy = -1.2; // 항상 위로
          b.y = paddle.y - b.r - 0.5;
          snd.paddle(); vibe(6);
        }
        // 바닥 — 공 소실
        if (b.y - b.r > H) { balls.splice(i, 1); continue; }
        // 벽돌
        for (let j = 0; j < bricks.length; j++) {
          const br = bricks[j];
          if (!br.alive) continue;
          if (collideBrick(b, br)) { hitBrick(br, b); break; }
        }
      }
      if (balls.length === 0) loseLife();
      else if (bricks.every((x) => !x.alive)) levelClear();
    }

    // 파워업 낙하
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy; p.rot += 0.05;
      if (p.y - p.h / 2 < paddle.y + paddle.h && p.y + p.h / 2 > paddle.y &&
          Math.abs(p.x - paddle.x) < paddle.w / 2 + p.w / 2) {
        applyPower(p.type); powerups.splice(i, 1); continue;
      }
      if (p.y - p.h / 2 > H) powerups.splice(i, 1);
    }

    // 파티클
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.dx; pt.y += pt.dy; pt.dy += 0.18; pt.rot += pt.vr;
      pt.life -= 0.028;
      if (pt.life <= 0) particles.splice(i, 1);
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    const now = performance.now();
    let ox = 0, oy = 0;
    if (now < shakeUntil) {
      const m = shakeMag * ((shakeUntil - now) / 320);
      ox = (Math.random() - 0.5) * m; oy = (Math.random() - 0.5) * m;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);

    // 벽돌
    bricks.forEach((br) => {
      if (!br.alive) return;
      const dim = br.hp < br.max ? 0.62 : 1;
      ctx.globalAlpha = dim;
      // 하드 섀도 (블러 0) — 사탕이 놓인 느낌
      ctx.fillStyle = 'rgba(70,60,105,0.16)';
      roundRect(br.x + 1.5, br.y + 2.5, br.w, br.h, 5); ctx.fill();
      // 본체
      ctx.fillStyle = br.color.fill;
      roundRect(br.x, br.y, br.w, br.h, 5); ctx.fill();
      // 크리스프 윗 림
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(br.x + 5, br.y + 1.2); ctx.lineTo(br.x + br.w - 5, br.y + 1.2); ctx.stroke();
      // 외곽
      ctx.strokeStyle = br.color.edge; ctx.lineWidth = 1.2;
      roundRect(br.x, br.y, br.w, br.h, 5); ctx.stroke();
      // 2히트 표시: 작은 균열 점
      if (br.hp < br.max) {
        ctx.fillStyle = 'rgba(70,60,105,0.30)';
        ctx.fillRect(br.x + br.w / 2 - 4, br.y + br.h / 2 - 1, 8, 2);
      }
      ctx.globalAlpha = 1;
    });

    // 파티클
    particles.forEach((pt) => {
      ctx.globalAlpha = Math.max(pt.life, 0);
      ctx.save();
      ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot);
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size);
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    // 파워업 (도형: 둥근 사각 + 점/막대 기호, 이모지 아님)
    powerups.forEach((p) => {
      const def = POWER[p.type];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = 'rgba(70,60,105,0.16)';
      roundRect(-p.w / 2 + 1.5, -p.h / 2 + 2.5, p.w, p.h, 7); ctx.fill();
      ctx.fillStyle = def.color;
      roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 7); ctx.fill();
      ctx.strokeStyle = def.edge; ctx.lineWidth = 1.4;
      roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 7); ctx.stroke();
      // 기호
      ctx.fillStyle = def.edge; ctx.strokeStyle = def.edge; ctx.lineWidth = 2.2;
      if (p.type === 'multi') {
        ctx.beginPath(); ctx.arc(-4, 0, 3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(4, -2, 3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(4, 4, 3, 0, 7); ctx.fill();
      } else if (p.type === 'wide') {
        ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(-8, 4); ctx.moveTo(8, -4); ctx.lineTo(8, 4); ctx.stroke();
      } else if (p.type === 'pierce') {
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-4, 3); ctx.lineTo(0, 7); ctx.lineTo(4, 3); ctx.stroke();
      } else if (p.type === 'life') {
        // 작은 하트 도형
        ctx.beginPath();
        ctx.moveTo(0, 5);
        ctx.bezierCurveTo(-7, -2, -4, -7, 0, -3);
        ctx.bezierCurveTo(4, -7, 7, -2, 0, 5);
        ctx.fill();
      }
      ctx.restore();
    });

    // 패들
    const px = paddle.x - paddle.w / 2, py = paddle.y;
    ctx.fillStyle = 'rgba(70,60,105,0.18)';
    roundRect(px + 1.5, py + 2.5, paddle.w, paddle.h, 7); ctx.fill();
    const grad = ctx.createLinearGradient(0, py, 0, py + paddle.h);
    grad.addColorStop(0, '#9fb6ff'); grad.addColorStop(1, '#7c93f0');
    ctx.fillStyle = grad;
    roundRect(px, py, paddle.w, paddle.h, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px + 7, py + 1.4); ctx.lineTo(px + paddle.w - 7, py + 1.4); ctx.stroke();
    ctx.strokeStyle = '#5b6fd0'; ctx.lineWidth = 1.2;
    roundRect(px, py, paddle.w, paddle.h, 7); ctx.stroke();

    // 공
    const pierce = now < pierceUntil;
    balls.forEach((b) => {
      ctx.fillStyle = 'rgba(70,60,105,0.16)';
      ctx.beginPath(); ctx.arc(b.x + 1, b.y + 2, b.r, 0, 7); ctx.fill();
      ctx.fillStyle = pierce ? '#ffd27a' : '#ff7a93';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
      // 윗 림 하이라이트
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.4, 0, 7); ctx.fill();
      ctx.strokeStyle = pierce ? '#e0a338' : '#e0617c'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.stroke();
    });

    ctx.restore();
  }

  // ── 메인 루프 ────────────────────────────────────────────────
  let last = 0;
  function loop(ts) {
    // 고정 스텝 누적(프레임 독립적인 속도)
    if (!last) last = ts;
    let dt = ts - last; last = ts;
    if (dt > 50) dt = 50; // 탭 전환 후 점프 방지
    const steps = Math.max(1, Math.round(dt / 16.67));
    for (let s = 0; s < steps; s++) update();
    draw();
    requestAnimationFrame(loop);
  }

  // ── 초기화 ───────────────────────────────────────────────────
  window.addEventListener('resize', fit);
  fit();
  renderLives();
  setScore(0);
  showStart();
  requestAnimationFrame(loop);

  // sw 등록 (NOOP sw — stale 캐시 없음)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
