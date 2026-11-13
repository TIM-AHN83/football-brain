// 효과음: 전부 Web Audio로 직접 합성 (저작권 문제 없음)
// web/sfx/<이름>.mp3 파일을 넣으면 합성음 대신 그 파일을 쓴다 (crowd, kick, whistle, cheer, groan, net)
import { CONFIG } from './config.js';
const FILES = (CONFIG.sfx || []).filter(n => ['crowd', 'kick', 'whistle', 'cheer', 'groan', 'net'].includes(n));

export class AudioFX {
  constructor() { this.ctx = null; this.mode = 'on'; this.buf = {}; this.duck = 1; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.comp = c.createDynamicsCompressor();
      // 리미터 하나만 (브라우저 압축기는 자동 보정 이득이 있어 두 단을 쓰면 소리가 커진다)
      this.comp.threshold.value = -6; this.comp.knee.value = 0; this.comp.ratio.value = 20; this.comp.attack.value = .002; this.comp.release.value = .1;
      this.master.connect(this.comp); this.comp.connect(c.destination);
      this.noise = this.makeNoise(2, false); // 킥·골망·발소리처럼 짧은 소리에만 쓴다
      this.setMode(this.mode); this.loadFiles();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setMode(m) { this.mode = m; if (this.master) this.master.gain.value = m === 'off' ? 0 : m === 'quiet' ? .4 : .9; }
  setDuck(on) { this.duck = on ? .45 : 1; this.crowdLevel(this._ex ?? .3); }
  // 관중 녹음(web/sfx/crowd.mp3)이 있으면 경기 분위기(0~1)에 따라 웅성거림 → 함성으로 커진다
  crowdLevel(v) {
    this._ex = v; if (!this.crowdGain || !this.ctx) return;
    this.crowdGain.gain.setTargetAtTime((.22 + .38 * Math.min(1, v)) * this.duck, this.ctx.currentTime, .35);
  }

  makeNoise(sec, pink) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (!pink) { d[i] = w; continue; }
      b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852; b3 = .8665 * b3 + w * .3104856;
      b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898; d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
    }
    return b;
  }
  async loadFiles() {
    for (const f of FILES) {
      try {
        const r = await fetch(`sfx/${f}.mp3`); if (!r.ok) continue;
        this.buf[f] = await this.ctx.decodeAudioData(await r.arrayBuffer());
        if (f === 'crowd') this.startCrowd();
      } catch (e) { /* 파일 없음 → 합성음 */ }
    }
  }
  playBuf(name, gain = 1, rate = 1) {
    const b = this.buf[name]; if (!b || !this.ctx) return false;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = b; s.playbackRate.value = rate; g.gain.value = gain;
    s.connect(g); g.connect(this.master); s.start(); return true;
  }
  env(node, t, a, peak, d, end = 0.0001) { const g = node.gain; g.cancelScheduledValues(0); g.setValueAtTime(0.0001, this.ctx.currentTime); g.setValueAtTime(0.0001, t); g.exponentialRampToValueAtTime(peak, t + a); g.exponentialRampToValueAtTime(end, t + a + d); }
  src(buf, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }
  filt(type, f, Q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }

  // 관중 배경: 실제 녹음 파일(web/sfx/crowd.mp3)이 있을 때만 튼다.
  // (예전에는 잡음을 걸러 만든 웅성거림을 계속 틀었는데, 크기가 오르내려 파도 소리처럼 들려서 2026-11-10 뺐다)
  startCrowd() {
    const c = this.ctx; if (!c || !this.buf.crowd) return;
    if (this.crowdNodes) { this.crowdNodes.forEach(n => { try { n.stop(); } catch (e) { /* 이미 멈춤 */ } }); }
    this.crowdGain = this.crowdGain || c.createGain(); this.crowdGain.gain.value = .36 * this.duck; this.crowdGain.connect(this.master);
    const s = this.src(this.buf.crowd, true); s.connect(this.crowdGain); s.start(); this.crowdNodes = [s];
  }

  // 골 환호: 부모들의 '와!' (모음 '아' 울림통을 거친 목소리 여러 개, 잡음 없음)
  cheer(power = 1) {
    if (!this.ctx) return; if (this.playBuf('cheer', .9 * power)) return;
    const c = this.ctx, t = c.currentTime;
    const bus = c.createGain(); bus.gain.value = 6.6 * power; // 가장 큰 1초 RMS ≈ -18.5 dBFS (예전 환호 -17.3과 비슷하게), 피크 -1.8 이하
    // 모음 '아'의 울림(포먼트 800·1200·2600Hz)
    [[800, 6, 1], [1200, 7, .55], [2600, 9, .18]].forEach(([f, q, v]) => {
      const bp = this.filt('bandpass', f, q), g = c.createGain(); g.gain.value = v; bus.connect(bp); bp.connect(g); g.connect(this.master);
    });
    for (let i = 0; i < 9; i++) {
      const o = c.createOscillator(), og = c.createGain(), vib = c.createOscillator(), vg = c.createGain();
      const f0 = (i % 3 === 0 ? 300 : 200) + Math.random() * 120, t0 = t + Math.random() * .12;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * .85, t0); o.frequency.linearRampToValueAtTime(f0 * 1.12, t0 + .35); o.frequency.linearRampToValueAtTime(f0 * .95, t0 + 1.4);
      vib.frequency.value = 5 + Math.random() * 2; vg.gain.value = f0 * .025; vib.connect(vg); vg.connect(o.frequency);
      o.connect(og); og.connect(bus); this.env(og, t0, .12, .11, 1.25); o.start(t0); o.stop(t0 + 1.6); vib.start(t0); vib.stop(t0 + 1.6);
    }
  }
  groan() {
    if (!this.ctx) return; if (this.playBuf('groan', .8)) return;
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 6; i++) {
      const o = c.createOscillator(), g = c.createGain(), lp = this.filt('lowpass', 650, 1.5);
      const f0 = 210 + Math.random() * 60; o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * .78, t + 1.4);
      o.connect(lp); lp.connect(g); g.connect(this.master); this.env(g, t + Math.random() * .1, .25, .14, 1.2); o.start(t); o.stop(t + 1.8);
    }
  }
  whistle(len = .4) {
    if (!this.ctx) return; if (this.playBuf('whistle', .6)) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), o2 = c.createOscillator(), trem = c.createOscillator(), tg = c.createGain(), g = c.createGain(), bp = this.filt('bandpass', 2900, 4);
    o.frequency.value = 2870; o2.frequency.value = 2930; trem.frequency.value = 34; tg.gain.value = .45;
    const am = c.createGain(); am.gain.value = .55;
    trem.connect(tg); tg.connect(am.gain);
    o.connect(am); o2.connect(am); am.connect(bp); bp.connect(g); g.connect(this.master);
    const n = this.src(this.noise), nf = this.filt('bandpass', 3000, 6), ng = c.createGain(); ng.gain.value = .25; n.connect(nf); nf.connect(ng); ng.connect(g);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.19, t + .02); g.gain.setValueAtTime(.19, t + len); g.gain.exponentialRampToValueAtTime(.0001, t + len + .06);
    [o, o2, trem, n].forEach(x => { x.start(t); x.stop(t + len + .1); });
  }
  kick(p = 1) {
    if (!this.ctx) return; if (this.playBuf('kick', .8 * p, .95 + Math.random() * .1)) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(52, t + .12);
    o.connect(g); g.connect(this.master); this.env(g, t, .004, 2.6 * p, .14); o.start(t); o.stop(t + .2);
    const n = this.src(this.noise), hp = this.filt('highpass', 1400), ng = c.createGain(); n.connect(hp); hp.connect(ng); ng.connect(this.master); this.env(ng, t, .002, 1.1 * p, .04); n.start(t); n.stop(t + .08);
  }
  touch(p = .5) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(115, t); o.frequency.exponentialRampToValueAtTime(70, t + .06);
    o.connect(g); g.connect(this.master); this.env(g, t, .003, 1.35 * p, .07); o.start(t); o.stop(t + .1);
  }
  net() {
    if (!this.ctx) return; if (this.playBuf('net', .8)) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.src(this.noise), f = this.filt('bandpass', 2400, .8), g = c.createGain(); f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(900, t + .4);
    n.connect(f); f.connect(g); g.connect(this.master); this.env(g, t, .01, 2.0, .45); n.start(t); n.stop(t + .5);
  }
  whoosh() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.src(this.noise), f = this.filt('bandpass', 600, 2), g = c.createGain(); f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2200, t + .25);
    n.connect(f); f.connect(g); g.connect(this.master); this.env(g, t, .08, 3.0, .25); n.start(t); n.stop(t + .4);
  }
  steps() { // 뒤에서 다가오는 발소리
    if (!this.ctx) return;
    const c = this.ctx;
    for (let i = 0; i < 4; i++) {
      const t = c.currentTime + i * .18, n = this.src(this.noise), f = this.filt('lowpass', 380), g = c.createGain();
      n.connect(f); f.connect(g); g.connect(this.master); this.env(g, t, .005, 1.8, .07); n.start(t); n.stop(t + .1);
    }
  }
  tone(freq, dur, type = 'sine', vol = .25, when = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(this.master); this.env(g, t, .006, vol, dur); o.start(t); o.stop(t + dur + .05);
  }
  ok() { this.tone(880, .12, 'triangle', .57); this.tone(1320, .18, 'triangle', .52, .07); }
  bad() { this.tone(170, .28, 'square', .33); this.tone(120, .3, 'square', .28, .08); }
  tick() { this.tone(1700, .03, 'square', 1.1); }
  beep(go) { this.tone(go ? 990 : 660, go ? .35 : .12, 'triangle', 1.8); }
  call() { this.tone(1046, .08, 'sine', .63); this.tone(1568, .14, 'sine', .56, .06); }
  level() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .16, 'triangle', .5, i * .09)); }
  say(text) { // 코치 목소리 (기기 내장 음성)
    try {
      if (this.mode === 'off' || !window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 1.25; u.volume = this.mode === 'quiet' ? .5 : 1;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* 음성 합성 없음 */ }
  }
}
