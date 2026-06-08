// GAME-KIT 오디오 — Web Audio 합성 SFX 엔진 팩토리 (외부 에셋 없음)
// 사용:  const A = createGameAudio('myGameMuted');
//        document.addEventListener('pointerdown', () => A.init(), {passive:true}); // iOS unlock
//        A.uiClick(); A.success(); ...
// 게임 고유 사운드가 필요하면 A.parts(env/osc/noise)로 직접 합성한다.
function createGameAudio(storageKey) {
  let ctx = null;
  let master, sfx, comp;
  let noiseBuf = null;
  let muted = localStorage.getItem(storageKey) === '1';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function ensureCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 5;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    sfx = ctx.createGain(); sfx.gain.value = 0.9;
    sfx.connect(master);
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  // 반드시 사용자 제스처 안에서 — iOS는 전화/시리에 뺏기면 'interrupted'가 되므로 그것도 복구
  function init() {
    ensureCtx();
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume();
  }

  function setMuted(m) {
    muted = m;
    localStorage.setItem(storageKey, m ? '1' : '0');
    if (ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
  }

  function env(g, t, a, peak, d, sustain = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
  }
  function osc(type, freq, t) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    return o;
  }
  function noise(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    s.start(t); s.stop(t + dur + 0.05);
    return s;
  }

  // ── 공용 SFX ──
  function uiClick() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = osc('sine', 660, t);
    const g = ctx.createGain();
    env(g, t, 0.002, 0.12, 0.07);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.09);
  }

  function select() { // 무언가 집었을 때 "팅"
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = osc('triangle', 880, t);
    o.frequency.exponentialRampToValueAtTime(1175, t + 0.05);
    const g = ctx.createGain();
    env(g, t, 0.002, 0.22, 0.11);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.14);
  }

  function deselect() { // 내려놓기
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = osc('triangle', 660, t);
    o.frequency.exponentialRampToValueAtTime(440, t + 0.07);
    const g = ctx.createGain();
    env(g, t, 0.002, 0.14, 0.09);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.12);
  }

  function success() { // 한 단위 완성 — 상승 아르페지오
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 4, 7, 12].forEach((iv, i) => {
      const tt = t + i * 0.06;
      const o = osc('triangle', mtof(79 + iv), tt);
      const g = ctx.createGain();
      env(g, tt, 0.003, 0.2, 0.24);
      o.connect(g); g.connect(sfx);
      o.start(tt); o.stop(tt + 0.3);
    });
  }

  function bad() { // 무효 동작 "퉁"
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = osc('sawtooth', 170, t);
    o.frequency.exponentialRampToValueAtTime(75, t + 0.13);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain();
    env(g, t, 0.003, 0.22, 0.14);
    o.connect(f); f.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.18);
  }

  function win() { // 클리어 팡파레
    if (!ctx) return;
    const t = ctx.currentTime;
    [60, 64, 67, 72, 76].forEach((m, i) => {
      const tt = t + i * 0.1;
      const o = osc('square', mtof(m), tt);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 2600;
      const g = ctx.createGain();
      env(g, tt, 0.005, 0.16, 0.36);
      o.connect(f); f.connect(g); g.connect(sfx);
      o.start(tt); o.stop(tt + 0.45);
    });
    [72, 76, 79].forEach((m) => {
      const tt = t + 0.5;
      const o = osc('triangle', mtof(m), tt);
      const g = ctx.createGain();
      env(g, tt, 0.01, 0.13, 0.8);
      o.connect(g); g.connect(sfx);
      o.start(tt); o.stop(tt + 0.95);
    });
  }

  function star(i) { // 별 획득 — 갈수록 음이 올라가는 팝
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = 84 + i * 4;
    const o = osc('sine', mtof(m), t);
    o.frequency.exponentialRampToValueAtTime(mtof(m + 7), t + 0.09);
    const g = ctx.createGain();
    env(g, t, 0.003, 0.26, 0.22);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.28);
  }

  function record() { // 신기록 글리산도
    if (!ctx) return;
    const t = ctx.currentTime;
    [76, 80, 83, 88, 92].forEach((m, i) => {
      const tt = t + i * 0.07;
      const o = osc('triangle', mtof(m), tt);
      const g = ctx.createGain();
      env(g, tt, 0.004, 0.15, 0.26);
      o.connect(g); g.connect(sfx);
      o.start(tt); o.stop(tt + 0.3);
    });
  }

  function whoosh() { // 휙 이동
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = noise(t, 0.22);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.6;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2800, t + 0.16);
    const g = ctx.createGain();
    env(g, t, 0.01, 0.18, 0.18);
    s.connect(f); f.connect(g); g.connect(sfx);
  }

  return {
    init, setMuted, get muted() { return muted; },
    get ctx() { return ctx; },
    uiClick, select, deselect, success, bad, win, star, record, whoosh,
    parts: { env, osc, noise, mtof, get sfx() { return sfx; } }, // 게임 고유 사운드 합성용
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted')) ctx.resume(); },
  };
}

if (typeof window !== 'undefined') window.createGameAudio = createGameAudio;
if (typeof module !== 'undefined') module.exports = createGameAudio;
