// 블록 팡 — 우드블록/블록블라스트류 퍼즐
// 게임 계약: 신기록 시 localStorage.setItem('blockBest', String(score)) (서빙 후킹이 리더보드 캡처)
//            음소거 키 blockMuted ('1'/'0'). portal.js·후원 UI는 서빙이 주입.
(() => {
  'use strict';

  const N = 8;                 // 8x8 그리드
  const PALETTE = [            // 파스텔 단색 (검보라/네온 금지)
    '#7eb6f0', // 스카이블루
    '#f5a8c0', // 핑크
    '#9fd9a8', // 민트그린
    '#f6c982', // 살구
    '#b6a7ef', // 라일락
    '#7fd6cf', // 청록
    '#f29a9a', // 코랄
  ];
  const BOMB_COLOR = '#8f8caf';

  // 조각 정의 (셀 상대좌표). 폴리오미노 — 너무 크지 않게.
  const SHAPES = [
    [[0,0]],                                   // 1
    [[0,0],[0,1]],                             // 2 가로
    [[0,0],[1,0]],                             // 2 세로
    [[0,0],[0,1],[0,2]],                       // 3 가로
    [[0,0],[1,0],[2,0]],                       // 3 세로
    [[0,0],[0,1],[1,0],[1,1]],                 // 2x2
    [[0,0],[0,1],[0,2],[0,3]],                 // 4 가로
    [[0,0],[1,0],[2,0],[3,0]],                 // 4 세로
    [[0,0],[0,1],[1,1]],                       // L작은
    [[0,1],[1,0],[1,1]],                       // 미러
    [[0,0],[1,0],[1,1]],
    [[0,0],[0,1],[1,0]],
    [[0,0],[1,0],[2,0],[2,1]],                 // L
    [[0,1],[1,1],[2,0],[2,1]],                 // J
    [[0,0],[0,1],[0,2],[1,1]],                 // T
    [[1,0],[1,1],[1,2],[0,1]],                 // T뒤
    [[0,1],[0,2],[1,0],[1,1]],                 // S
    [[0,0],[0,1],[1,1],[1,2]],                 // Z
    [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]],     // 2x3
    [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]],     // 3x2
    [[0,0],[0,1],[0,2],[1,0],[2,0]],           // 큰 L 코너
  ];

  // ── 상태 ──
  let grid;                    // grid[r][c] = null | {color, bomb}
  let tray;                    // [3] of {cells:[[r,c]], color, bomb} | null
  let score = 0;
  let best = +(localStorage.getItem('blockBest') || 0) || 0;
  let over = false;

  // ── DOM ──
  const boardEl = document.getElementById('board');
  const trayEl = document.getElementById('tray');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const ghostEl = document.getElementById('ghost');
  const ghostGp = ghostEl.querySelector('.gp');
  const overEl = document.getElementById('over');
  const comboEl = document.getElementById('combo');
  const fx = document.getElementById('fx');
  const fxctx = fx.getContext('2d');

  let cellEls = [];            // cellEls[r][c]
  let cellPx = 40;             // 한 칸 px (레이아웃 후 측정)
  let gap = 4;

  // ── 오디오 (Web Audio 합성, 외부 에셋 없음) ──
  const Audio = (() => {
    let ctx = null, master;
    let muted = localStorage.getItem('blockMuted') === '1';
    function ensure(){
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    }
    function init(){ ensure(); if (ctx.state !== 'running') ctx.resume(); }
    function setMuted(m){ muted = m; localStorage.setItem('blockMuted', m ? '1':'0'); if (ctx) master.gain.setTargetAtTime(m?0:1, ctx.currentTime, .02); }
    function isMuted(){ return muted; }
    function tone(freq, t0, dur, type, peak){
      if (!ctx || muted) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak || .25, t0 + .008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + .02);
    }
    return {
      init, setMuted, isMuted,
      place(){ if(!ctx) return; const t=ctx.currentTime; tone(330,t,.08,'triangle',.18); tone(440,t+.02,.07,'sine',.12); },
      bad(){ if(!ctx) return; const t=ctx.currentTime; tone(150,t,.16,'sawtooth',.12); },
      clear(n){ if(!ctx) return; const t=ctx.currentTime; const base=520; for(let i=0;i<Math.max(1,n);i++){ tone(base*Math.pow(1.18,i), t+i*.05, .22, 'triangle', .2); tone(base*1.5*Math.pow(1.18,i), t+i*.05, .18, 'sine', .1);} },
      bomb(){ if(!ctx) return; const t=ctx.currentTime; tone(90,t,.3,'sawtooth',.25); tone(70,t+.02,.35,'square',.12); },
      gameover(){ if(!ctx) return; const t=ctx.currentTime; [392,330,262].forEach((f,i)=>tone(f,t+i*.14,.3,'triangle',.18)); },
    };
  })();

  const vibrate = (p) => { if (!Audio.isMuted() && navigator.vibrate) try{ navigator.vibrate(p); }catch(e){} };

  // ── 그리드 초기화 + 렌더 셸 ──
  function buildBoard(){
    boardEl.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
    boardEl.style.gridTemplateRows = `repeat(${N}, 1fr)`;
    boardEl.innerHTML = '';
    cellEls = [];
    for (let r=0;r<N;r++){
      cellEls[r]=[];
      for (let c=0;c<N;c++){
        const d=document.createElement('div');
        d.className='cell';
        boardEl.appendChild(d);
        cellEls[r][c]=d;
      }
    }
  }

  function sizeBoard(){
    // 보드를 화면 폭/높이에 맞춰 정사각 칸으로
    const maxW = Math.min(window.innerWidth - 20, 480);
    const stage = document.getElementById('stage');
    const availH = stage.clientHeight - 16;
    let side = Math.min(maxW, availH);
    side = Math.max(240, side);
    cellPx = Math.floor((side - 12 - gap*(N-1)) / N);
    const boardSide = cellPx*N + gap*(N-1) + 12;
    boardEl.style.width = boardSide+'px';
    boardEl.style.height = boardSide+'px';
    renderTray();
  }

  function renderGrid(){
    for (let r=0;r<N;r++) for (let c=0;c<N;c++){
      const cell = cellEls[r][c];
      const g = grid[r][c];
      cell.classList.remove('drop-ok','drop-bad');
      const existing = cell.querySelector('.blk');
      if (g){
        if (!existing){
          const b=document.createElement('div');
          b.className='blk';
          cell.appendChild(b);
          paintBlk(b,g);
        } else paintBlk(existing,g);
      } else if (existing){
        existing.remove();
      }
    }
  }
  function paintBlk(b,g){
    b.style.background = g.bomb ? BOMB_COLOR : g.color;
    b.classList.toggle('bomb', !!g.bomb);
  }

  // ── 트레이 ──
  function newPiece(){
    const sh = SHAPES[(Math.random()*SHAPES.length)|0];
    const color = PALETTE[(Math.random()*PALETTE.length)|0];
    const bomb = Math.random() < 0.07;   // 가끔 폭탄 (단일 셀에만 표식)
    return { cells: sh.map(([r,c])=>[r,c]), color, bomb };
  }
  function refillTray(){
    tray = [newPiece(), newPiece(), newPiece()];
  }
  function pieceDims(p){
    let mr=0,mc=0; for(const [r,c] of p.cells){ if(r>mr)mr=r; if(c>mc)mc=c; }
    return [mr+1, mc+1];
  }
  function renderTray(){
    const pcSize = Math.max(15, Math.floor(cellPx*0.62));
    for (let i=0;i<3;i++){
      const slot = trayEl.querySelector(`.slot[data-slot="${i}"]`);
      slot.innerHTML='';
      const p = tray[i];
      if (!p) continue;
      const [rows,cols] = pieceDims(p);
      const grid2 = document.createElement('div');
      grid2.className='piece'; grid2.dataset.idx=i;
      grid2.style.gridTemplateColumns = `repeat(${cols}, ${pcSize}px)`;
      grid2.style.gridTemplateRows = `repeat(${rows}, ${pcSize}px)`;
      const set = new Set(p.cells.map(([r,c])=>r+'_'+c));
      for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
        const cd=document.createElement('div');
        if (set.has(r+'_'+c)){
          cd.className='pc';
          cd.style.background = p.bomb ? BOMB_COLOR : p.color;
          cd.style.position='relative';
          if (p.bomb){ cd.classList.add('bomb'); decorateBomb(cd, pcSize); }
        } else {
          cd.style.visibility='hidden';
        }
        cd.style.width=pcSize+'px'; cd.style.height=pcSize+'px';
        grid2.appendChild(cd);
      }
      slot.appendChild(grid2);
      attachDrag(grid2, i);
    }
  }
  function decorateBomb(el, sz){
    const d=document.createElement('div');
    const r=Math.round(sz*0.5);
    d.style.cssText=`position:absolute;left:25%;top:25%;width:50%;height:50%;border-radius:50%;background:radial-gradient(circle at 38% 32%,rgba(255,255,255,.9),rgba(255,255,255,.15) 55%,transparent 60%),rgba(40,38,60,.78);box-shadow:0 0 0 2px rgba(255,255,255,.35);`;
    el.appendChild(d);
  }

  // ── 배치 가능 판정 ──
  function canPlaceAt(p, br, bc){
    for (const [dr,dc] of p.cells){
      const r=br+dr, c=bc+dc;
      if (r<0||r>=N||c<0||c>=N) return false;
      if (grid[r][c]) return false;
    }
    return true;
  }
  function canPlaceAnywhere(p){
    const [rows,cols]=pieceDims(p);
    for (let r=0;r<=N-rows;r++) for (let c=0;c<=N-cols;c++) if (canPlaceAt(p,r,c)) return true;
    return false;
  }
  function anyMoveLeft(){
    return tray.some(p => p && canPlaceAnywhere(p));
  }

  // ── 배치 실행 ──
  function place(idx, br, bc){
    const p = tray[idx];
    if (!p || !canPlaceAt(p, br, bc)) return false;
    const placed=[];
    for (const [dr,dc] of p.cells){
      const r=br+dr,c=bc+dc;
      grid[r][c]={color:p.color, bomb:false};
      placed.push([r,c]);
    }
    // 폭탄: 조각의 첫 셀을 폭탄으로 (배치 점수만, 줄 클리어 때 주변 제거)
    let bombCell=null;
    if (p.bomb){ const [dr,dc]=p.cells[0]; bombCell=[br+dr,bc+dc]; grid[bombCell[0]][bombCell[1]].bomb=true; }

    tray[idx]=null;
    score += p.cells.length;            // 놓은 칸 수만큼 기본 점수
    Audio.place();
    vibrate(12);
    renderGrid();
    placed.forEach(([r,c])=>{ const b=cellEls[r][c].querySelector('.blk'); if(b){ b.classList.add('spawn'); setTimeout(()=>b.classList.remove('spawn'),200);} });

    resolveClears(bombCell);
    updateScore();

    // 트레이 비면 리필
    if (tray.every(t=>!t)) refillTray();
    renderTray();

    // 게임오버 판정 (배치 후 + 리필 후 모두 커버)
    if (!anyMoveLeft()) endGame();
    return true;
  }

  // ── 줄 클리어 + 폭탄 + 콤보 ──
  function resolveClears(bombCell){
    const fullRows=[], fullCols=[];
    for (let r=0;r<N;r++) if (grid[r].every(x=>x)) fullRows.push(r);
    for (let c=0;c<N;c++){ let f=true; for(let r=0;r<N;r++) if(!grid[r][c]){f=false;break;} if(f) fullCols.push(c); }

    // 폭탄: 클리어되는 줄 안에 폭탄이 있으면 주변 3x3 제거
    const toClear = new Set();
    fullRows.forEach(r=>{ for(let c=0;c<N;c++) toClear.add(r+'_'+c); });
    fullCols.forEach(c=>{ for(let r=0;r<N;r++) toClear.add(r+'_'+c); });

    let bombExploded=false;
    if (toClear.size){
      // 클리어 셀 중 폭탄이 있으면 3x3 확장
      const bombs=[];
      toClear.forEach(k=>{ const [r,c]=k.split('_').map(Number); if(grid[r][c]&&grid[r][c].bomb) bombs.push([r,c]); });
      bombs.forEach(([br,bc])=>{
        bombExploded=true;
        for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){ const r=br+dr,c=bc+dc; if(r>=0&&r<N&&c>=0&&c<N&&grid[r][c]) toClear.add(r+'_'+c); }
      });
    }

    if (toClear.size===0) return;

    const lines = fullRows.length + fullCols.length;
    // 콤보 배율: 동시에 2줄+ 클리어 시
    const mult = lines>=2 ? lines : 1;
    const gained = toClear.size * 10 * mult + (bombExploded?50:0);
    score += gained;

    // 애니메이션 + 파티클
    const centers=[];
    toClear.forEach(k=>{
      const [r,c]=k.split('_').map(Number);
      const b=cellEls[r][c].querySelector('.blk');
      if (b){ b.classList.add('clearing'); }
      centers.push(cellCenter(r,c, grid[r][c]));
      grid[r][c]=null;
    });

    if (bombExploded) Audio.bomb();
    Audio.clear(lines);

    // 화면 흔들림 — 줄 수에 비례
    boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake');
    vibrate(lines>=2 ? [0,30,40,30] : 25);

    // 파티클
    burst(centers);

    // 콤보 텍스트
    if (lines>=2){
      showCombo(lines, mult);
    }

    // 실제 DOM 제거는 애니 후
    setTimeout(()=>{ toClear.forEach(k=>{ const [r,c]=k.split('_').map(Number); const cell=cellEls[r][c]; const b=cell.querySelector('.blk'); if(b) b.remove(); }); }, 330);
  }

  function showCombo(lines, mult){
    comboEl.textContent = lines>=3 ? `${lines}줄 콤보! ×${mult}` : `콤보 ×${mult}`;
    comboEl.style.color = lines>=3 ? '#f29a4a' : '#7c7af0';
    comboEl.classList.remove('show'); void comboEl.offsetWidth; comboEl.classList.add('show');
  }

  // ── 점수 ──
  function updateScore(){
    scoreEl.textContent = score;
    if (score > best){
      best = score;
      bestEl.textContent = best;
      // 신기록 → 서빙 후킹이 리더보드 캡처
      localStorage.setItem('blockBest', String(best));
    }
  }

  // ── 파티클 (fx 캔버스) ──
  let parts=[];
  function resizeFx(){ fx.width=innerWidth*devicePixelRatio; fx.height=innerHeight*devicePixelRatio; fx.style.width=innerWidth+'px'; fx.style.height=innerHeight+'px'; fxctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
  function cellCenter(r,c,g){
    const rect=cellEls[r][c].getBoundingClientRect();
    return { x:rect.left+rect.width/2, y:rect.top+rect.height/2, color:(g&&!g.bomb)?g.color:'#9aa0d8' };
  }
  function burst(centers){
    for (const ct of centers){
      const n=5;
      for (let i=0;i<n;i++){
        const a=Math.random()*Math.PI*2, sp=2+Math.random()*4;
        parts.push({ x:ct.x, y:ct.y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-2, life:1, color:ct.color, size:3+Math.random()*4 });
      }
    }
    if (!rafOn){ rafOn=true; requestAnimationFrame(tick); }
  }
  let rafOn=false;
  function tick(){
    fxctx.clearRect(0,0,innerWidth,innerHeight);
    parts = parts.filter(p=>p.life>0);
    for (const p of parts){
      p.vy += 0.28; p.x+=p.vx; p.y+=p.vy; p.life-=0.024;
      fxctx.globalAlpha=Math.max(0,p.life);
      fxctx.fillStyle=p.color;
      const s=p.size;
      const rr=2;
      fxctx.beginPath();
      fxctx.roundRect ? fxctx.roundRect(p.x-s/2,p.y-s/2,s,s,rr) : fxctx.rect(p.x-s/2,p.y-s/2,s,s);
      fxctx.fill();
    }
    fxctx.globalAlpha=1;
    if (parts.length){ requestAnimationFrame(tick); } else { rafOn=false; fxctx.clearRect(0,0,innerWidth,innerHeight); }
  }

  // ── 드래그 (pointer) ──
  let drag=null;
  function attachDrag(el, idx){
    el.addEventListener('pointerdown', (e)=>{
      if (over || !tray[idx]) return;
      Audio.init();
      e.preventDefault();
      const p=tray[idx];
      const [rows,cols]=pieceDims(p);
      // 고스트 빌드 (보드 칸 크기로)
      ghostGp.style.gridTemplateColumns=`repeat(${cols}, ${cellPx}px)`;
      ghostGp.style.gridTemplateRows=`repeat(${rows}, ${cellPx}px)`;
      ghostGp.innerHTML='';
      const set=new Set(p.cells.map(([r,c])=>r+'_'+c));
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
        const cd=document.createElement('div');
        if(set.has(r+'_'+c)){ cd.className='gc'; cd.style.background=p.bomb?BOMB_COLOR:p.color; }
        cd.style.width=cellPx+'px'; cd.style.height=cellPx+'px';
        ghostGp.appendChild(cd);
      }
      ghostEl.style.display='block';
      el.classList.add('dragging');
      drag={ idx, p, rows, cols,
        // 고스트 앵커: 손가락이 조각 중앙-아래쪽에 오게 (손가락에 가려지지 않도록 위로 띄움)
        offX: cols*cellPx/2, offY: rows*cellPx + 18 };
      el.setPointerCapture(e.pointerId);
      moveGhost(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove', (e)=>{ if(!drag||drag.idx!==idx) return; e.preventDefault(); moveGhost(e.clientX,e.clientY); });
    el.addEventListener('pointerup', (e)=>{ if(!drag||drag.idx!==idx) return; e.preventDefault(); endDrag(e.clientX,e.clientY); });
    el.addEventListener('pointercancel', ()=>{ if(drag&&drag.idx===idx) cancelDrag(); });
  }
  function ghostTopLeft(px,py,d){ d=d||drag; return { x:px-d.offX, y:py-d.offY }; }
  function targetCell(px,py,d){
    const tl=ghostTopLeft(px,py,d);
    // 고스트 좌상단이 가리키는 보드 칸
    const brect=boardEl.getBoundingClientRect();
    const innerX = tl.x - (brect.left+6);
    const innerY = tl.y - (brect.top+6);
    const c=Math.round(innerX/(cellPx+gap));
    const r=Math.round(innerY/(cellPx+gap));
    return [r,c];
  }
  function moveGhost(px,py){
    const tl=ghostTopLeft(px,py);
    ghostEl.style.transform=`translate(${tl.x}px,${tl.y}px)`;
    // 하이라이트
    clearHover();
    const [r,c]=targetCell(px,py);
    if (canPlaceAt(drag.p,r,c)){
      for(const [dr,dc] of drag.p.cells) cellEls[r+dr][c+dc].classList.add('drop-ok');
    }
  }
  function clearHover(){
    for(let r=0;r<N;r++)for(let c=0;c<N;c++) cellEls[r][c].classList.remove('drop-ok','drop-bad');
  }
  function endDrag(px,py){
    const d=drag; cleanupDrag();
    const [r,c]=targetCell(px,py,d);
    if (canPlaceAt(d.p, r, c)){
      place(d.idx, r, c);
    } else {
      Audio.bad();
      vibrate(8);
    }
  }
  function cancelDrag(){ cleanupDrag(); }
  function cleanupDrag(){
    if (!drag) return;
    document.querySelectorAll('.piece.dragging').forEach(e=>e.classList.remove('dragging'));
    ghostEl.style.display='none';
    clearHover();
    drag=null;
  }

  // ── 게임오버 / 시작 ──
  function endGame(){
    over=true;
    Audio.gameover();
    vibrate([0,40,60,40,60]);
    const isRec = score>=best && score>0;
    document.getElementById('over-score').textContent=score;
    document.getElementById('over-best').textContent='최고 '+best+'점';
    const rec=document.getElementById('over-record');
    rec.classList.toggle('show', isRec);
    setTimeout(()=>overEl.classList.add('show'), 350);
    // 신기록 공유 제안은 게임오버 때만(플레이 중 점수 갱신마다 뜨지 않게) — 이번 판 신기록 있으면 1회.
    if (window.GamePortal && GamePortal.shareResult) GamePortal.shareResult();
    // 게임 끝나면 후원+의견 (포털 공용 모달 — 모든 게임 동일)
    if (window.GamePortal) setTimeout(function(){ GamePortal.openSupport(); }, 1100);
  }
  function start(){
    grid=Array.from({length:N},()=>Array(N).fill(null));
    refillTray();
    score=0; over=false;
    overEl.classList.remove('show');
    buildBoard();
    sizeBoard();
    renderGrid();
    renderTray();
    updateScore();
    bestEl.textContent=best;
  }

  // ── 음소거 토글 (스프라이트 스피커 아이콘 href swap) ──
  function refreshMute(){
    document.getElementById('mute-use').setAttribute('href', Audio.isMuted() ? '#p-speaker-slash' : '#p-speaker-high');
  }
  document.getElementById('mute').addEventListener('click', ()=>{
    Audio.init();
    Audio.setMuted(!Audio.isMuted());
    refreshMute();
    if (!Audio.isMuted()) Audio.place();
  });
  document.getElementById('btn-again').addEventListener('click', ()=>{ Audio.init(); start(); });

  window.addEventListener('resize', ()=>{ resizeFx(); sizeBoard(); });

  // 시작
  resizeFx();
  refreshMute();
  start();
})();
