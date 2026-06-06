// VASE — 오디오 엔진 (전부 Web Audio 합성, 외부 에셋 없음)
// 주의: AudioContext는 반드시 사용자 제스처 안에서 init()을 불러 unlock해야 한다 (iOS)
// localStorage 키는 같은 origin의 다른 게임과 충돌하지 않게 vase 접두사 사용
const VaseAudio = (() => {
  let ctx = null;
  let master, sfx, comp;
  let noiseBuf = null;
  let muted = localStorage.getItem('vaseMuted') === '1';

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
    // 공유 노이즈 버퍼 (2초)
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  // 사용자 제스처 안에서 호출 — iOS/크롬 unlock
  // iOS는 전화/시리에 오디오를 뺏기면 'interrupted' 상태가 되므로 그것도 복구
  function init() {
    ensureCtx();
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') ctx.resume();
  }

  function setMuted(m) {
    muted = m;
    localStorage.setItem('vaseMuted', m ? '1' : '0');
    if (ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
  }

  // ── 합성 유틸 ──
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

  // ── SFX ──
  // 병 선택: 유리 "팅" — 살짝 위로 휘는 음정
  function select() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = osc('triangle', 880, t);
    o.frequency.exponentialRampToValueAtTime(1175, t + 0.05);
    const g = ctx.createGain();
    env(g, t, 0.002, 0.22, 0.11);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.14);
    const o2 = osc('sine', 1760, t); // 유리 배음
    const g2 = ctx.createGain();
    env(g2, t, 0.001, 0.08, 0.07);
    o2.connect(g2); g2.connect(sfx);
    o2.start(t); o2.stop(t + 0.09);
  }

  // 선택 해제: 아래로 똑
  function deselect() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = osc('triangle', 660, t);
    o.frequency.exponentialRampToValueAtTime(440, t + 0.07);
    const g = ctx.createGain();
    env(g, t, 0.002, 0.14, 0.09);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.12);
  }

  // 물 붓는 소리: 대역필터 노이즈(졸졸) + 음정 오르는 "보글" 방울들
  // durSec 동안 이어지고, units가 많을수록 보글이 많아진다
  function pour(durSec, units) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = Math.max(0.25, durSec);
    // 졸졸 본체
    const s = noise(t, dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(1500, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.17, t + 0.06);
    g.gain.setValueAtTime(0.17, t + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // 출렁이는 진폭 LFO
    const lfo = osc('sine', 11, t);
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.06;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    lfo.start(t); lfo.stop(t + dur);
    s.connect(bp); bp.connect(lp); lp.connect(g); g.connect(sfx);
    // 보글 방울: 물이 차오를수록 음정이 올라간다 (병이 차는 느낌)
    const blubs = 3 + (units | 0) * 2;
    for (let i = 0; i < blubs; i++) {
      const bt = t + 0.08 + (dur - 0.18) * (i / blubs) + Math.random() * 0.04;
      const base = 300 + 260 * (i / blubs) + Math.random() * 60;
      const o = osc('sine', base, bt);
      o.frequency.exponentialRampToValueAtTime(base * 2.1, bt + 0.06);
      const bg = ctx.createGain();
      env(bg, bt, 0.004, 0.10, 0.07);
      o.connect(bg); bg.connect(sfx);
      o.start(bt); o.stop(bt + 0.12);
    }
  }

  // 병 하나 완성: 반짝이는 상승 아르페지오
  function tubeDone() {
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 4, 7, 12].forEach((iv, i) => {
      const tt = t + i * 0.06;
      const o = osc('triangle', mtof(79 + iv), tt);
      const g = ctx.createGain();
      env(g, tt, 0.003, 0.20, 0.24);
      o.connect(g); g.connect(sfx);
      o.start(tt); o.stop(tt + 0.3);
    });
    // 유리 차임 배음
    const o2 = osc('sine', mtof(103), t + 0.18);
    const g2 = ctx.createGain();
    env(g2, t + 0.18, 0.002, 0.07, 0.3);
    o2.connect(g2); g2.connect(sfx);
    o2.start(t + 0.18); o2.stop(t + 0.52);
  }

  // 잘못된 이동: 둔탁한 "퉁"
  function bad() {
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

  // 클리어 팡파레: 밝은 코드 진행 + 반짝임
  function win() {
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
    // 마지막 화음 지속
    [72, 76, 79].forEach((m) => {
      const tt = t + 0.5;
      const o = osc('triangle', mtof(m), tt);
      const g = ctx.createGain();
      env(g, tt, 0.01, 0.13, 0.8);
      o.connect(g); g.connect(sfx);
      o.start(tt); o.stop(tt + 0.95);
    });
    // 반짝이 노이즈
    const s = noise(t + 0.45, 0.55);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 8000;
    const g = ctx.createGain();
    env(g, t + 0.45, 0.02, 0.06, 0.5);
    s.connect(hp); hp.connect(g); g.connect(sfx);
  }

  // 별 획득: 별마다 음이 올라가는 "팝"
  function star(i) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = 84 + i * 4;
    const o = osc('sine', mtof(m), t);
    o.frequency.exponentialRampToValueAtTime(mtof(m + 7), t + 0.09);
    const g = ctx.createGain();
    env(g, t, 0.003, 0.26, 0.22);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.28);
    const s = noise(t, 0.1); // 톡 터지는 입자감
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6000;
    const g2 = ctx.createGain();
    env(g2, t, 0.001, 0.05, 0.08);
    s.connect(hp); hp.connect(g2); g2.connect(sfx);
  }

  // 신기록: 위로 쭉 반짝이는 글리산도
  function record() {
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

  function uiClick() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = osc('sine', 660, t);
    const g = ctx.createGain();
    env(g, t, 0.002, 0.12, 0.07);
    o.connect(g); g.connect(sfx);
    o.start(t); o.stop(t + 0.09);
  }

  return {
    init, setMuted, get muted() { return muted; },
    get ctx() { return ctx; },
    select, deselect, pour, tubeDone, bad, win, star, record, uiClick,
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted')) ctx.resume(); },
  };
})();

if (typeof window !== 'undefined') window.VaseAudio = VaseAudio;
