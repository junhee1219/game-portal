// ORBIT 사운드 — WebAudio 합성음(에셋 없음). orbitMuted 키 존중.
const Sound = (() => {
  let ctx = null;
  let muted = localStorage.getItem('orbitMuted') === '1';

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, gain, slideTo) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.18, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  return {
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      localStorage.setItem('orbitMuted', muted ? '1' : '0');
      if (!muted) tone(660, 0.08, 'sine', 0.14);
      return muted;
    },
    unlock() { ac(); },
    drop() { tone(280, 0.07, 'triangle', 0.12); },
    // 합체: 단계(tier)가 높을수록 음정이 올라감 + 콤보 시 살짝 더 위로
    merge(tier, combo) {
      const base = 320 + tier * 42 + (combo - 1) * 30;
      tone(base, 0.12, 'sine', 0.16, base * 1.5);
    },
    blackhole() {
      // 빨아들이는 하강 스윕
      tone(520, 0.45, 'sawtooth', 0.14, 70);
    },
    big() { tone(180, 0.18, 'triangle', 0.2, 90); },
    over() {
      tone(330, 0.18, 'sine', 0.16, 110);
      setTimeout(() => tone(220, 0.3, 'sine', 0.16, 70), 140);
    },
    rec() { tone(660, 0.1, 'sine', 0.16); setTimeout(() => tone(990, 0.16, 'sine', 0.16), 110); },
  };
})();
