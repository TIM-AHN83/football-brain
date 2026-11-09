// 게임 규칙: 공격(랠리 여러 번 + 슛) · 레벨 · 점수 · 훈련장 4종 · 두뇌 지수
import * as THREE from 'three';
import { Footballer } from './player.js';
import { PITCH } from './world.js';
import { parseCall } from './voice.js';

const NUMS = [7, 10, 11, 9, 8, 17, 19, 14, 22, 23, 6, 4, 20, 21, 18, 16, 13, 3, 2, 5];
const START_Z = 36, SHOT_Z = -PITCH.HL + 21;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function weighted(w) {
  const tot = Object.values(w).reduce((a, b) => a + b, 0); let r = Math.random() * tot;
  for (const [k, v] of Object.entries(w)) { if ((r -= v) <= 0) return k; }
  return Object.keys(w)[0];
}

export function levelSpec(L) {
  return {
    flashMs: Math.max(170, 920 - 75 * (L - 1)),
    decisionMs: Math.max(1150, 2900 - 150 * (L - 1)),
    ahead: Math.min(27, 14.5 + 1.1 * L),
    lane: Math.min(10, 4 + 0.55 * L),
    rallies: L <= 2 ? 3 : L <= 5 ? 4 : 5,
    badges: L <= 3 ? 'always' : L <= 6 ? 'rally' : 'attack',
    shuffle: L >= 7,
    tod: L <= 3 ? 'day' : L <= 6 ? 'dusk' : 'night',
    mult: 1 + 0.15 * (L - 1),
    build: L <= 2 ? [1500, 2300] : [1000, 1900],
    types: L <= 2 ? { pass: 1 } : L === 3 ? { pass: .8, both: .2 } : L === 4 ? { pass: .65, both: .15, shoulder: .2 }
      : L === 5 ? { pass: .55, both: .15, shoulder: .15, whistle: .15 } : { pass: .5, both: .15, shoulder: .2, whistle: .15 },
  };
}

export const MODES = {
  challenge: { title: '챌린지', ranked: true, lives: 3, shots: true },
  flash:     { title: '플래시 패스', lives: 0, total: 12, types: { pass: 1 } },
  shoulder:  { title: '어깨 체크 360', lives: 0, total: 10, types: { shoulder: 1 } },
  brake:     { title: '판단 브레이크', lives: 0, total: 14, types: { pass: .4, both: .3, whistle: .3 } },
  mot:       { title: '등번호 추적', lives: 0, total: 8 },
};

export class Game {
  constructor({ world, ui, audio, sensors, opts }) {
    this.world = world; this.ui = ui; this.audio = audio; this.sensors = sensors; this.opts = opts;
    this.me = { x: 0, z: START_Z, v: 0, bobPhase: 0, sideT: 0, side: 0 };
    this.mates = NUMS.slice(0, 5).map((n, i) => new Footballer('home', n, { skin: i }));
    this.defs = [4, 5, 3, 2].map((n, i) => new Footballer('away', n, { skin: i + 2 }));
    this.keeper = new Footballer('keeper', 1, { ring: false, scale: 1.04 });
    for (const p of [...this.mates, ...this.defs, this.keeper]) { world.scene.add(p.group); p.setVisible(false); }
    this.ball = world.ball;
    this.clock = 0; this.timers = []; this.phase = 'idle'; this.paused = false;
    this.look = { yaw: 0, drag: 0, dragAt: 0, key: 0, armed: false };
    this.ballState = 'carry'; this.ballRel = 1.3; this.ballSpeed = 0; this.fl = null; this.holder = null;
    this._v = new THREE.Vector3(); this._q = new THREE.Vector3();
  }

  // ---------- 타이머 ----------
  after(ms, fn) { const t = { at: this.clock + ms, fn }; this.timers.push(t); return t; }
  cancel(t) { const i = this.timers.indexOf(t); if (i >= 0) this.timers.splice(i, 1); }
  runTimers() {
    for (let guard = 0; guard < 20; guard++) {
      const due = this.timers.filter(t => t.at <= this.clock);
      if (!due.length) return;
      this.timers = this.timers.filter(t => t.at > this.clock);
      due.sort((a, b) => a.at - b.at).forEach(t => t.fn());
    }
  }

  // ---------- 시작 ----------
  start(mode, { level = 1 } = {}) {
    this.mode = mode; this.M = MODES[mode];
    this.timers = []; this.clock = 0; this.paused = false;
    this.level = level; this.score = 0; this.streak = 0; this.lives = this.M.lives; this.count = 0;
    this.stats = { decisions: 0, correct: 0, rts: [], minFlash: null, scans: 0, calls: 0, callChances: 0, goals: 0, shots: 0,
      whistleTotal: 0, whistleOk: 0, bothTotal: 0, bothOk: 0, shoulderTotal: 0, shoulderOk: 0, unseen: 0,
      motTotal: 0, motOk: 0, stepsStart: this.sensors.steps, startLevel: level };
    this.ui.hud(true, mode);
    this.ui.setScore(0); this.ui.setLevel(level); this.ui.setLives(this.lives, this.M.lives); this.ui.setCombo(1);
    this.ui.hint(mode === 'mot' ? 'mot' : 'pass');
    this.ui.attack(0, 0);
    this.world.setExcite(.3, 1);
    if (mode === 'mot') this.motSetup(true); else this.newAttack(true);
    this.phase = 'countdown';
    const steps = ['3', '2', '1'];
    steps.forEach((s, i) => this.after(i * 700, () => { this.ui.center(s, 'gold'); this.audio.beep(false); }));
    this.after(2100, () => {
      this.ui.center(mode === 'mot' ? 'START' : 'KICK OFF', 'gold'); this.audio.whistle(0.45); this.world.setExcite(.6, .5);
      this.startedAt = this.clock;
      if (mode === 'mot') this.motRound(); else this.startRally();
    });
  }

  newAttack(first = false) {
    const S = levelSpec(this.level);
    this.spec = S; this.rallyIdx = 0; this.attackSize = this.M.shots ? S.rallies : 0;
    this.world.setTimeOfDay(this.mode === 'challenge' ? S.tod : (this.level <= 4 ? 'day' : this.level <= 8 ? 'dusk' : 'night'));
    this.me.x = 0; this.me.z = START_Z; this.me.side = 0; this.me.sideT = 0;
    this.world.rig.position.set(0, 0, START_Z);
    const nums = shuffle(NUMS).slice(0, 2);
    this.mates.forEach((m, i) => {
      m.setVisible(i < 2); m.setBlank(false); m.showBadge(false); m.setRing(true, '#ffc93c');
      if (i < 2) { m.setNumber(nums[i]); m.rel = new THREE.Vector3((i ? 1 : -1) * S.lane, 0, -S.ahead); m.place(this.me.x + m.rel.x, this.me.z + m.rel.z); m.group.rotation.y = Math.PI; }
    });
    this.defs.forEach(d => { d.setVisible(false); d.glow(0); });
    this.presser = this.defs[3]; this.presser.setVisible(true); this.presser.setRing(false);
    this.presser.place(rnd(-1.5, 1.5), START_Z - 11, 0, START_Z); this.presser.maxSpeed = 3;
    this.keeper.setVisible(this.M.shots); this.keeper.place(0, -PITCH.HL + 0.7, 0, 0); this.keeper.face = new THREE.Vector3(0, 0, 0);
    this.ballCarry();
    if (this.M.shots) this.ui.attack(this.attackSize, 0);
    if (S.badges === 'attack' || first) this.showBadges(2200);
    if (!first) { this.ui.flash(false); }
  }

  showBadges(ms) {
    this.mates.forEach(m => m.group.visible && m.showBadge(true));
    if (this.badgeTimer) this.cancel(this.badgeTimer);
    if (ms) this.badgeTimer = this.after(ms, () => { if (this.spec.badges !== 'always') this.mates.forEach(m => m.showBadge(false)); });
  }

  // ---------- 랠리 ----------
  makeRally() {
    const S = this.spec;
    const kind = weighted(this.M.types || S.types);
    const side = Math.random() < .5 ? -1 : 1;
    const r = { kind, side, flashMs: S.flashMs, windowMs: S.decisionMs, scanned: false, seen: kind !== 'shoulder', voiceOpen: true };
    if (kind === 'pass') r.answer = side < 0 ? 'R' : 'L';
    else if (kind === 'both') r.answer = 'C';
    else if (kind === 'shoulder') { r.answer = side < 0 ? 'R' : 'L'; r.windowMs = S.decisionMs + 1700; }
    else if (kind === 'whistle') { r.answer = 'none'; r.windowMs = Math.round(S.decisionMs * .85); }
    return r;
  }

  startRally() {
    if (this.phase === 'over') return;
    const S = this.spec, r = this.rally = this.makeRally();
    this.phase = 'build'; r.startAt = this.clock;
    if (this.M.shots) this.ui.attack(this.attackSize, this.rallyIdx);
    if (S.badges === 'always') this.showBadges(0);
    else if (S.badges === 'rally') this.showBadges(1300);
    // 등번호 섞기 (레벨 7+): 배지가 꺼진 뒤 두 친구가 X자로 엇갈려 뛴다
    if (S.shuffle && Math.random() < .5) this.after(1000, () => { const [a, b] = this.mates; [a.rel, b.rel] = [b.rel, a.rel]; });
    // 압박 수비 위치
    if (r.kind !== 'shoulder') {
      const p = this.presser; p.setVisible(true);
      if (p.pos.z > this.me.z - 6 || Math.abs(p.pos.x - this.me.x) > 3) p.place(this.me.x + rnd(-.3, .3), this.me.z - 12, this.me.x, this.me.z);
      p.maxSpeed = 2.5;
    } else this.presser.setVisible(false);
    const build = rnd(...S.build);
    this.after(build, () => this.onset());
  }

  laneSpot(side, f) {
    const m = this.mateOnSide(side);
    const tx = m ? m.pos.x : this.me.x + side * this.spec.lane, tz = m ? m.pos.z : this.me.z - this.spec.ahead;
    // 패스 길 위, 친구 쪽에 가깝게 (가운데 압박 수비와 헷갈리지 않도록 바깥으로 1m 더)
    return new THREE.Vector3(this.me.x + (tx - this.me.x) * f + side * rnd(.6, 1.4), 0, this.me.z + (tz - this.me.z) * f);
  }
  mateOnSide(side) { const [a, b] = this.mates; const left = a.pos.x <= b.pos.x ? a : b, right = left === a ? b : a; return side < 0 ? left : right; }

  onset() {
    const r = this.rally; if (!r || this.phase !== 'build') return;
    this.phase = 'decide'; r.onsetAt = this.clock; r.onsetReal = performance.now();
    const S = this.spec;
    const flashDef = (d, spot, ms) => {
      d.setVisible(true); d.setRing(S.mult < 1.5, '#ff4d3a'); d.place(spot.x, spot.z, this.me.x, this.me.z);
      d.glow(.9); this.after(90, () => d.glow(0));
      this.after(ms, () => { if (!r.resolved || r.interceptBy !== d) d.setVisible(false); });
    };
    if (r.kind === 'pass') { r.flashDef = this.defs[0]; flashDef(this.defs[0], this.laneSpot(r.side, rnd(.55, .78)), r.flashMs); this.audio.tick(); }
    else if (r.kind === 'both') {
      this.stats.bothTotal++;
      flashDef(this.defs[0], this.laneSpot(-1, rnd(.55, .78)), r.flashMs); flashDef(this.defs[1], this.laneSpot(1, rnd(.55, .78)), r.flashMs); this.audio.tick();
    } else if (r.kind === 'whistle') {
      this.stats.whistleTotal++;
      this.audio.whistle(0.5); this.ui.callout('휘슬! 멈춤', 'warn', 900);
      flashDef(this.defs[0], this.laneSpot(r.side, rnd(.5, .7)), r.flashMs);
    } else if (r.kind === 'shoulder') {
      this.stats.shoulderTotal++;
      const d = this.defs[2]; d.setVisible(true); d.setRing(true, '#ff4d3a');
      d.place(this.me.x + r.side * rnd(6.5, 8), this.me.z + rnd(-1.5, 1), this.me.x, this.me.z);
      d.maxSpeed = 2.2; r.sideDef = d;
      this.ui.callout('어깨 체크! 뒤를 봐', 'warn', 1400); this.ui.edges(true); this.audio.say('뒤!'); this.audio.steps();
    }
    if (r.kind !== 'shoulder') { this.pressSpeed = Math.max(2.4, (Math.abs(this.presser.pos.z - this.me.z) - 1.2) / (r.windowMs / 1000) - this.me.v + 1.2); }
    this.ui.timer(1);
    r.expire = this.after(r.windowMs, () => this.resolve(null));
  }

  onInput(kind, tReal) {
    if (this.paused) return;
    if (this.phase === 'shotDecide') return this.resolveShot(kind, tReal);
    if (this.phase === 'build' && this.rally && !this.rally.early) { this.rally.early = true; this.ui.callout('아직! 보고 판단해요', 'warn', 700); return; }
    if (this.phase !== 'decide') return;
    this.resolve(kind, tReal);
  }

  resolve(kind, tReal) {
    const r = this.rally; if (!r || r.resolved || this.phase !== 'decide') return;
    if (r.expire) this.cancel(r.expire);
    r.resolved = true; this.phase = 'resolve'; this.ui.timer(null); this.ui.edges(false);
    const input = kind === 'single' ? 'L' : kind === 'double' ? 'R' : kind === 'hold' ? 'C' : null;
    const rt = tReal ? Math.max(0, Math.round(tReal - r.onsetReal)) : null;
    r.input = input; r.rt = rt;
    this.stats.decisions++; this.count++;
    let correct = input === r.answer || (r.answer === 'none' && input === null);
    r.correct = correct;
    const mult = this.spec.mult;
    if (correct) {
      this.stats.correct++; this.streak++;
      if (r.answer !== 'none') {
        if (rt != null) this.stats.rts.push(rt);
        if (r.kind === 'pass' || r.kind === 'both') this.stats.minFlash = Math.min(this.stats.minFlash ?? 9999, r.flashMs);
      }
      if (r.kind === 'whistle') this.stats.whistleOk++;
      if (r.kind === 'both') this.stats.bothOk++;
      if (r.kind === 'shoulder') { this.stats.shoulderOk++; if (!r.seen) this.stats.unseen++; }
      const speed = rt != null ? clamp(1 - rt / r.windowMs, 0, 1) : 0.5;
      let pts = (100 + 100 * speed) * mult;
      if (r.scanned) pts += 40 * mult;
      if (r.kind === 'shoulder' && !r.seen) pts *= 0.3;
      pts = Math.round(pts * this.combo());
      this.addScore(pts);
      this.audio.ok(); this.world.setExcite(.35, .3);
      const label = r.answer === 'none' ? '멈춤 성공' : r.answer === 'C' ? '돌파!' : (r.answer === 'L' ? '← 패스' : '패스 →');
      this.ui.pop(`+${pts}`, 'good'); this.ui.pop(rt != null ? `${label} · ${rt}ms` : label, 'small');
      if (r.scanned) this.ui.pop('스캔 보너스', 'small gold');
      if (r.kind === 'shoulder' && !r.seen) this.ui.pop('다음엔 돌아보고 판단!', 'small');
      if (r.answer === 'L' || r.answer === 'R') { this.stats.callChances++; r.receiver = this.mateOnSide(r.answer === 'L' ? -1 : 1); r.receiverNum = r.receiver.number; }
      this.playCorrect(r);
    } else {
      this.streak = 0;
      this.audio.bad(); this.audio.groan(); this.ui.flash(true);
      const why = input === null ? '늦었어요!' : r.answer === 'none' ? '휘슬엔 멈춰요' : r.answer === 'C' ? '양쪽 다 막혔어요' : '막힌 쪽이에요';
      this.ui.center('MISS', 'bad'); this.ui.pop(why, 'small bad');
      this.playWrong(r);
    }
    this.ui.setCombo(this.combo());
    this.after(1800, () => { r.voiceOpen = false; });
    this.checkCall();
  }

  combo() { return 1 + 0.1 * Math.min(this.streak, 10); }
  addScore(p) { this.score += p; this.ui.setScore(this.score); }

  playCorrect(r) {
    const next = () => this.afterRally(true);
    if (r.answer === 'L' || r.answer === 'R') {
      const m = r.receiver; this.world.kickBoot(r.answer === 'L' ? -1 : 1, 1.1); this.audio.kick(.8);
      const T = clamp(this._dist(m) / 17, .55, 1.3);
      const to = m.pos.clone().addScaledVector(m.vel, T); to.y = 0.11;
      this.ballFly(to, T, .25, () => {
        this.ballHold(m); this.audio.touch();
        this.after(380, () => {
          this.audio.kick(.55);
          const back = new THREE.Vector3(this.me.x + 0.12, .11, this.me.z - 3.6);
          this.ballFly(back, .8, .12, () => { this.ballCarry(1.1); this.audio.touch(); this.after(250, next); });
        });
      });
    } else if (r.answer === 'C') {
      this.me.side = Math.random() < .5 ? -1 : 1; this.me.sideT = 1;
      this.presser.tackle(0, 1); this.audio.whoosh(); this.ballSpeed = this.me.v + 3.2;
      this.after(1100, () => { this.presser.place(this.me.x + rnd(-6, 6), this.me.z + 14); this.presser.setVisible(false); next(); });
    } else if (r.answer === 'none') {
      this.after(700, next);
    } else this.after(600, next);
    if (r.sideDef) this.after(600, () => r.sideDef.setVisible(false));
  }

  playWrong(r) {
    const lose = () => this.afterRally(false);
    if (r.kind === 'pass' && r.input && r.input !== 'C') { // 막힌 쪽 패스 → 가로채기
      const d = r.flashDef || this.defs[0]; r.interceptBy = d;
      d.setVisible(true); d.glow(.6); this.world.kickBoot(r.input === 'L' ? -1 : 1, 1); this.audio.kick(.7);
      const to = d.pos.clone(); to.y = .11;
      this.ballFly(to, clamp(this._dist(d) / 15, .4, 1), .15, () => { this.ballHold(d); this.audio.touch(); d.moveTo(d.pos.x + rnd(-4, 4), d.pos.z + 25, 6.5); this.after(1300, lose); });
    } else if (r.kind === 'shoulder' && r.sideDef) {
      const d = r.sideDef; d.moveTo(this.me.x, this.me.z - 1, 7); this.after(450, () => { d.tackle((this.me.x - d.pos.x) * .1, 0); this.ballHold(d); this.after(1100, lose); });
    } else { // 시간 초과·휘슬 반칙·잘못된 돌파 → 압박 수비가 뺏음
      const p = this.presser; p.setVisible(true); p.moveTo(this.me.x, this.me.z - 1.2, 8);
      this.after(380, () => { p.tackle(0, .4); this.ballHold(p); this.audio.touch(); if (r.answer === 'none' && r.input) this.audio.whistle(0.3); this.after(1100, lose); });
    }
    this.defs.forEach(d => { if (d !== r.interceptBy && d !== r.sideDef && d !== this.presser) d.setVisible(false); });
  }

  afterRally(ok) {
    if (this.phase === 'over') return;
    this.defs.forEach(d => { if (d !== this.presser) d.setVisible(false); });
    if (this.mode === 'challenge') {
      if (!ok) {
        this.lives--; this.ui.setLives(this.lives, this.M.lives);
        if (this.lives <= 0) return this.endRun();
        this.ui.callout('공을 뺏겼어요 · 다시 공격', 'threat', 1500);
        this.phase = 'turnover';
        return this.after(1300, () => { this.newAttack(); this.after(700, () => this.startRally()); });
      }
      this.rallyIdx++;
      if (this.rallyIdx >= this.attackSize) return this.shotRun();
      return this.startRally();
    }
    // 훈련장
    if (ok && this.mode === 'flash' && this.stats.correct % 3 === 0) this.levelUp(false);
    if (this.count >= this.M.total) return this.endRun();
    if (!ok) { this.newAttack(); return this.after(900, () => this.startRally()); }
    if (this.me.z < SHOT_Z + 10) { this.newAttack(); return this.after(700, () => this.startRally()); }
    this.startRally();
  }

  levelUp(announce = true) {
    this.level++; this.ui.setLevel(this.level);
    const prevTod = this.spec?.tod;
    this.spec = levelSpec(this.level);
    if (announce) { this.ui.center(`LEVEL ${this.level}`, 'gold'); this.audio.level(); }
    const notes = { 3: '양쪽 다 막히면 꾹! 드리블 돌파', 4: '어깨 체크 등장 · 폰을 돌려 뒤를 봐요', 5: '휘슬이 울리면 아무것도 누르지 마요', 7: '친구들이 자리를 바꿔요 · 등번호를 기억!' };
    if (this.mode === 'challenge' && notes[this.level]) this.after(900, () => this.ui.callout(notes[this.level], 'warn', 2600));
    if (this.mode === 'challenge' && prevTod && prevTod !== this.spec.tod) this.after(600, () => this.ui.callout(this.spec.tod === 'dusk' ? '해 질 녘 경기' : '야간 경기 · 조명 ON', '', 1600));
  }

  // ---------- 슛 ----------
  shotRun() {
    this.phase = 'shotRun';
    this.ui.attack(this.attackSize, this.attackSize);
    this.ui.callout('슛 찬스! 골키퍼를 봐', 'warn', 1400); this.ui.hint('shot');
    this.mates.forEach((m, i) => { if (i < 2) m.rel.set((i ? 1 : -1) * 9, 0, -6); });
    this.presser.setVisible(false);
    this.after(100, () => this.waitShotSpot());
  }
  waitShotSpot() {
    if (this.me.z > SHOT_Z + 0.5 && this.clock - (this.shotWaitStart ??= this.clock) < 4500) return this.after(80, () => this.waitShotSpot());
    this.shotWaitStart = null;
    this.after(rnd(300, 900), () => this.shotOnset());
  }
  shotOnset() {
    const S = this.spec, side = Math.random() < .5 ? -1 : 1, k = this.keeper;
    this.rally = { kind: 'shot', side, answer: side < 0 ? 'R' : 'L', flashMs: S.flashMs, windowMs: S.decisionMs + 300, voiceOpen: true, onsetReal: performance.now() };
    this.phase = 'shotDecide'; this.stats.shots++;
    // 골키퍼가 한쪽으로 잠깐 쏠렸다 돌아온다 (그쪽을 지키는 중) → 반대쪽으로 슛
    // 화면 기준 왼쪽(-x) = 슈터의 왼쪽
    k.place(side * 1.45, k.pos.z, 0, 0); k.group.rotation.z = -side * .18; k.glow(.5);
    this.after(90, () => k.glow(0));
    this.after(S.flashMs, () => { k.place(0, k.pos.z, 0, 0); k.group.rotation.z = 0; });
    this.ui.timer(1);
    this.rally.expire = this.after(this.rally.windowMs, () => this.resolveShot(null));
  }
  resolveShot(kind, tReal) {
    const r = this.rally; if (!r || r.resolved || this.phase !== 'shotDecide') return;
    if (r.expire) this.cancel(r.expire);
    r.resolved = true; this.phase = 'shotResolve'; this.ui.timer(null);
    const input = kind === 'single' ? 'L' : kind === 'double' ? 'R' : null;
    const rt = tReal ? Math.round(tReal - r.onsetReal) : null;
    const ok = input === r.answer; r.correct = ok;
    this.stats.decisions++; this.count++;
    const k = this.keeper;
    const aimX = input === 'L' ? -2.9 : input === 'R' ? 2.9 : rnd(-1, 1);
    const target = new THREE.Vector3(aimX, ok ? rnd(.6, 1.9) : 1.1, -PITCH.HL - (ok ? 1.4 : -0.6));
    if (input) { this.world.kickBoot(input === 'L' ? -1 : 1, 1.3); this.audio.kick(1); }
    if (ok) {
      this.stats.correct++; this.streak++; if (rt != null) this.stats.rts.push(rt); this.stats.goals++;
      this.stats.minFlash = Math.min(this.stats.minFlash ?? 9999, r.flashMs);
      k.dive(r.side); // 쏠렸던 쪽으로 다이빙 → 반대쪽 골
      const T = .75;
      this.ballFly(target, T, .9, () => {
        this.ballState = 'free'; this.audio.net(); this.audio.cheer(1); this.world.setExcite(1, 2.5);
        const pts = Math.round(300 * this.spec.mult * this.combo()); this.addScore(pts);
        this.ui.center('GOAL!', 'gold'); this.ui.pop(`+${pts}`, 'gold'); if (rt != null) this.ui.pop(`슛 반응 ${rt}ms`, 'small');
        this.mates.forEach(m => m.group.visible && m.celebrate());
        this.after(2400, () => { this.levelUp(true); this.newAttack(); this.ui.hint('pass'); this.after(800, () => this.startRally()); });
      });
    } else {
      this.streak = 0;
      if (input) k.dive(input === 'L' ? -1 : 1); else k.moveTo(0, k.pos.z, 4);
      const T = .7;
      const save = new THREE.Vector3(input ? aimX * .75 : 0, 1, -PITCH.HL + .9);
      this.ballFly(save, T, .6, () => {
        this.audio.groan(); this.audio.bad(); this.ui.center(input ? 'SAVE' : 'MISS', 'bad'); this.ui.pop(input ? '골키퍼가 지킨 쪽이에요' : '슛 타이밍을 놓쳤어요', 'small bad');
        this.ballFly(new THREE.Vector3(rnd(-8, 8), .11, -PITCH.HL + 12), 1, .8, () => { this.ballState = 'free'; });
        this.after(1200, () => {
          this.lives--; this.ui.setLives(this.lives, this.M.lives);
          if (this.lives <= 0) return this.endRun();
          this.newAttack(); this.ui.hint('pass'); this.after(800, () => this.startRally());
        });
      });
    }
    this.ui.setCombo(this.combo());
    this.after(1800, () => { r.voiceOpen = false; });
  }

  // ---------- 음성 콜 ----------
  onVoice(text) {
    const r = this.rally; if (!r || !r.voiceOpen) return false;
    const c = parseCall(text);
    if (c.num != null) r.vNum = c.num;
    if (c.pass) r.vPass = true; if (c.carry) r.vCarry = true; if (c.shoot) r.vShoot = true;
    this.checkCall();
    return c.num != null || c.pass || c.carry || c.shoot;
  }
  checkCall() {
    const r = this.rally; if (!r || r.callDone || !r.resolved || !r.correct) return;
    let bonus = 0, msg = '';
    if (r.answer === 'L' || r.answer === 'R') {
      const numOk = r.vNum != null && r.vNum === r.receiverNum;
      if (numOk && r.vPass) { bonus = 60; msg = `콜 성공! ${r.receiverNum}번 패스`; }
      else if (numOk) { bonus = 40; msg = `${r.receiverNum}번 콜!`; }
      else if (r.vPass && r.vNum == null) { bonus = 15; msg = '패스 콜'; }
    } else if (r.answer === 'C' && r.vCarry) { bonus = 40; msg = '돌파 콜!'; }
    else if (r.kind === 'shot' && r.vShoot) { bonus = 30; msg = '슛 콜!'; }
    if (!bonus) return;
    r.callDone = true;
    const pts = Math.round(bonus * (this.spec?.mult || 1) * this.combo());
    this.addScore(pts); if (bonus >= 40) this.stats.calls++;
    this.ui.pop(`${msg} +${pts}`, 'gold'); this.audio.call();
  }

  // ---------- 등번호 추적 (훈련 아이디어 2) ----------
  motSetup(first) {
    this.spec = levelSpec(this.level);
    this.world.setTimeOfDay('day');
    this.me.x = 0; this.me.z = 20; this.world.rig.position.set(0, 0, 20);
    this.defs.forEach(d => d.setVisible(false)); this.keeper.setVisible(false);
    this.ballCarry();
    if (first) this.motN = clamp(2 + Math.ceil(this.level / 3), 3, 5);
  }
  motRound() {
    if (this.phase === 'over') return;
    const n = this.motN, nums = shuffle(NUMS).slice(0, n);
    this.phase = 'motShow';
    const spots = shuffle([[-5, -10], [0, -11], [5, -10], [-3, -15], [3, -15], [-7, -14], [7, -14]]).slice(0, n);
    this.mates.forEach((m, i) => {
      const on = i < n; m.setVisible(on); if (!on) return;
      m.setNumber(nums[i]); m.setBlank(false); m.showBadge(true); m.setRing(true, '#ffc93c'); m.rel = null;
      m.place(this.me.x + spots[i][0], this.me.z + spots[i][1], this.me.x, this.me.z); m.face = new THREE.Vector3(this.me.x, 0, this.me.z);
    });
    this.ui.callout('등번호를 기억해요', 'warn', 1800);
    const showMs = Math.max(1100, 2600 - this.level * 120), moveMs = Math.min(7000, 3200 + this.level * 300), speed = Math.min(6.5, 2.6 + this.level * .35);
    this.after(showMs, () => {
      this.phase = 'motMove';
      this.mates.forEach((m, i) => { if (i < n) { m.showBadge(false); m.setBlank(true); } });
      this.audio.whistle(.2);
      const hop = () => {
        if (this.phase !== 'motMove') return;
        this.mates.forEach((m, i) => { if (i < n) m.moveTo(this.me.x + rnd(-8, 8), this.me.z + rnd(-18, -8), speed * rnd(.8, 1.15)); });
        this.after(rnd(700, 1200), hop);
      };
      hop();
      this.after(moveMs, () => {
        this.phase = 'motAsk';
        this.mates.forEach((m, i) => { if (i < n) { m.moveTo(m.pos.x, m.pos.z); } });
        const t = Math.floor(Math.random() * n), target = this.mates[t];
        this.motTarget = target; this.motAskAt = performance.now();
        target.setRing(true, '#ffffff'); target.showBadge(false);
        this.ui.callout('흰 링 친구는 몇 번?', 'warn', 3000); this.audio.tick();
        this.rally = { kind: 'mot', voiceOpen: true };
        this.ui.motChoices(shuffle(nums), (num) => this.motAnswer(num));
      });
    });
  }
  motAnswer(num) {
    if (this.phase !== 'motAsk') return;
    this.phase = 'motReveal';
    const t = this.motTarget, ok = num === t.number, rt = Math.round(performance.now() - this.motAskAt);
    this.stats.decisions++; this.stats.motTotal++; this.count++;
    this.ui.motMark(num, ok, t.number);
    this.mates.forEach(m => { if (m.group.visible) { m.setBlank(false); m.showBadge(true); } });
    if (ok) {
      this.stats.correct++; this.stats.motOk++; this.stats.rts.push(rt); this.streak++;
      const pts = Math.round((150 + 50 * this.motN) * this.combo()); this.addScore(pts);
      this.audio.ok(); this.ui.pop(`+${pts}`, 'good'); this.ui.pop(`정답 · ${(rt / 1000).toFixed(1)}초`, 'small');
      if (this.stats.motOk % 2 === 0) { this.level++; this.ui.setLevel(this.level); if (this.motN < 5 && this.stats.motOk % 4 === 0) this.motN++; }
    } else { this.streak = 0; this.audio.bad(); this.ui.pop(`${t.number}번이었어요`, 'small bad'); }
    this.ui.setCombo(this.combo());
    this.after(1700, () => {
      this.ui.motHide(); t.setRing(true, '#ffc93c');
      if (this.count >= this.M.total) return this.endRun();
      this.motRound();
    });
  }
  onVoiceMot(text) {
    if (this.phase !== 'motAsk') return;
    const c = parseCall(text); if (c.num != null && this.mates.some(m => m.group.visible && m.number === c.num)) this.motAnswer(c.num);
  }

  // ---------- 공 ----------
  ballCarry(rel = 1.3) { this.ballState = 'carry'; this.ballRel = rel; this.ballSpeed = this.me.v; this.holder = null; }
  ballFly(to, T, h, onArrive) { this.ballState = 'flight'; this.fl = { from: this.ball.position.clone(), to: to.clone(), T, t: 0, h, onArrive }; }
  ballHold(p) { this.ballState = 'held'; this.holder = p; }
  _dist(p) { return Math.hypot(p.pos.x - this.me.x, p.pos.z - this.me.z); }

  updateBall(dt) {
    const b = this.ball;
    if (this.ballState === 'carry') {
      const v = this.me.v;
      this.ballSpeed = Math.max(0, this.ballSpeed - 1.7 * dt);
      this.ballRel += (this.ballSpeed - v) * dt;
      if (this.ballRel < 1.0 && v > 0.3) { // 터치
        this.ballSpeed = v + 1.6 + Math.random() * .5; this.touchSide = -(this.touchSide || 1);
        this.world.kickBoot(this.touchSide, .55); this.audio.touch(.5);
      }
      this.ballRel = clamp(this.ballRel, .85, 3.5);
      b.position.set(this.me.x + 0.1, 0.11, this.me.z - this.ballRel);
      b.rotation.x -= this.ballSpeed * dt / 0.11;
    } else if (this.ballState === 'flight') {
      const f = this.fl; f.t += dt;
      const k = clamp(f.t / f.T, 0, 1), e = k;
      const prev = this._q.copy(b.position);
      b.position.lerpVectors(f.from, f.to, e); b.position.y = THREE.MathUtils.lerp(f.from.y, f.to.y, e) + 4 * f.h * k * (1 - k);
      const d = this._v.subVectors(b.position, prev); const len = Math.hypot(d.x, d.z);
      if (len > 1e-5) { const axis = new THREE.Vector3(-d.z, 0, d.x).normalize(); b.rotateOnWorldAxis(axis, len / 0.11); }
      if (k >= 1) { this.ballState = 'still'; const cb = f.onArrive; this.fl = null; cb && cb(); }
    } else if (this.ballState === 'held' && this.holder) {
      const p = this.holder, yaw = p.group.rotation.y;
      b.position.set(p.pos.x + Math.sin(yaw) * .45, .11, p.pos.z + Math.cos(yaw) * .45);
      b.rotation.x += Math.hypot(p.vel.x, p.vel.z) * dt / 0.11;
    } else if (this.ballState === 'free') {
      b.position.y = Math.max(.11, b.position.y - dt * 2);
    }
  }

  // ---------- 매 프레임 ----------
  update(dt) {
    if (this.paused || this.phase === 'idle') return;
    this.clock += dt * 1000;
    this.runTimers();
    const me = this.me, S = this.spec || levelSpec(1);
    // 이동 속도: 발 센서가 켜져 있으면 발을 움직여야 달린다
    let target = 3.2;
    const useFeet = this.opts.motion && this.sensors.hasMotion;
    const feet = useFeet ? (this.sensors.active ? 1 : 0.3) : 1;
    if (this.mode === 'challenge' && ['build', 'decide', 'resolve'].includes(this.phase)) {
      const left = Math.max(1, (this.attackSize - this.rallyIdx));
      target = me.z <= SHOT_Z + 3 ? 0.8 : clamp((me.z - SHOT_Z) / (left * 6), 1.2, 4.6);
    } else if (this.phase === 'shotRun') target = 5;
    else if (this.phase === 'shotDecide' || this.phase === 'shotResolve') target = 0.8;
    else if (this.mode === 'mot') target = 0.6;
    else if (this.phase === 'countdown' || this.phase === 'turnover' || this.phase === 'over') target = 0.6;
    if (this.mode !== 'challenge' && this.me.z < SHOT_Z + 8) target = Math.min(target, 1);
    target *= feet;
    me.v += (target - me.v) * Math.min(1, dt * 2.5);
    if (this.phase === 'shotResolve' || (this.mode === 'mot')) me.v = Math.min(me.v, 1);
    me.z -= me.v * dt;
    // 옆으로 제치기 (돌파)
    if (me.sideT > 0) { me.sideT = Math.max(0, me.sideT - dt * 1.4); me.x += me.side * Math.sin(me.sideT * Math.PI) * dt * 3.2; }
    else me.x += (0 - me.x) * Math.min(1, dt * .6);
    this.world.rig.position.set(me.x, 0, me.z);
    me.bobPhase += me.v * dt * 2.3;
    const bobAmt = Math.min(1, me.v / 3.5);
    this.world.bob.position.set(Math.sin(me.bobPhase) * .018 * bobAmt, Math.abs(Math.sin(me.bobPhase)) * .035 * bobAmt, 0);
    this.world.bob.rotation.z = Math.sin(me.bobPhase) * .008 * bobAmt;

    // 둘러보기 (자이로 / 드래그 / 키보드)
    const L = this.look; let yaw;
    if (this.opts.gyro && this.sensors.hasOrient) yaw = clamp(this.sensors.yaw, -1.9, 1.9);
    else {
      if (performance.now() - L.dragAt > 450) L.drag *= Math.pow(0.02, dt);
      yaw = clamp(L.drag + L.key, -1.9, 1.9);
    }
    L.yaw += (yaw - L.yaw) * Math.min(1, dt * 14);
    this.world.yaw.rotation.y = L.yaw;
    if (Math.abs(L.yaw) > .42 && !L.armed) {
      L.armed = true; if (this.stats) this.stats.scans++;
      if (this.rally && this.phase === 'build') this.rally.scanned = true;
    } else if (Math.abs(L.yaw) < .2) L.armed = false;

    // 어깨 체크: 화면 안에 들어왔는지
    const r = this.rally;
    if (r && r.kind === 'shoulder' && r.sideDef && !r.seen && this.phase === 'decide') {
      const d = r.sideDef;
      const ang = Math.atan2(-(d.pos.x - me.x), -(d.pos.z - me.z));
      const diff = Math.atan2(Math.sin(ang - L.yaw), Math.cos(ang - L.yaw));
      const half = THREE.MathUtils.degToRad(this.world.camera.fov / 2) * Math.min(1.6, this.world.camera.aspect) * .9;
      if (Math.abs(diff) < Math.max(.35, half)) { r.seen = true; this.ui.edges(false); this.ui.callout('봤다!', '', 500); }
    }

    // 동료·수비 이동
    for (const m of this.mates) {
      if (!m.group.visible || !m.rel) continue;
      if (this.ballState === 'held' && this.holder === m) { m.moveTo(m.pos.x, m.pos.z - me.v * .3, 2); continue; }
      m.moveTo(me.x + m.rel.x + Math.sin(this.clock / 900 + m.number) * .8, me.z + m.rel.z, me.v + 3);
    }
    const p = this.presser;
    if (p && p.group.visible && this.ballState !== 'held') {
      if (this.phase === 'build') p.moveTo(me.x + Math.sin(this.clock / 700) * .35, me.z - 10, me.v + 1.5);
      else if (this.phase === 'decide') p.moveTo(me.x, me.z - 1.3, (this.pressSpeed || 3) + me.v);
      p.face = new THREE.Vector3(me.x, 0, me.z);
    }
    if (r && r.sideDef && r.sideDef.group.visible && this.phase === 'decide') r.sideDef.moveTo(me.x + r.side * 2, me.z - .5, 2.2 + me.v);
    for (const pl of [...this.mates, ...this.defs, this.keeper]) pl.update(dt);
    this.keeper.face && this.keeper.face.set(this.ball.position.x, 0, this.ball.position.z);
    this.updateBall(dt);

    // HUD
    if (r && (this.phase === 'decide' || this.phase === 'shotDecide') && r.onsetReal) this.ui.timer(1 - (performance.now() - r.onsetReal) / r.windowMs);
    this.ui.feet(useFeet ? clamp(this.sensors.cadence / 150, 0, 1) : null);
  }

  // ---------- 타이틀 화면 연출 ----------
  cinematic(dt, t) {
    const w = this.world;
    if (!this._cine) {
      this._cine = true; w.setTimeOfDay('dusk');
      this.mates.forEach((m, i) => { m.setVisible(i < 3); m.setBlank(false); m.showBadge(false); m.setRing(false); m.rel = null; m.place(-6 + i * 6, -2 - i * 3); });
      this.defs.forEach((d, i) => { d.setVisible(i < 2); d.setRing(false); d.place(-3 + i * 7, -10); });
      this.keeper.setVisible(true); this.keeper.place(0, -PITCH.HL + .7, 0, 0);
      this.ball.position.set(0, .11, 0); this.ballState = 'still';
    }
    const a = t * 0.06;
    w.rig.position.set(Math.sin(a) * 22, 2.4, 6 + Math.cos(a) * 18);
    w.yaw.rotation.y = a + Math.PI * 0.08; w.bob.position.set(0, 0, 0);
    [...this.mates, ...this.defs].forEach((p, i) => {
      if (!p.group.visible) return;
      if (Math.random() < dt * .4) p.moveTo(rnd(-14, 14), rnd(-24, 6), rnd(2, 5));
      p.update(dt);
    });
    this.keeper.face = new THREE.Vector3(0, 0, 0); this.keeper.update(dt);
  }
  endCinematic() {
    this._cine = false; this.world.rig.position.y = 0;
  }

  pause(on) {
    if (this.phase === 'idle' || this.phase === 'over') return;
    if (on && !this.paused) { this.paused = true; this.pausedAt = performance.now(); }
    else if (!on && this.paused) {
      this.paused = false; const d = performance.now() - this.pausedAt;
      if (this.rally?.onsetReal) this.rally.onsetReal += d;
      if (this.motAskAt) this.motAskAt += d;
    }
  }

  quit() {
    this.phase = 'idle'; this.timers = []; this.paused = false; this.rally = null;
    this.ui.hud(false); this.ui.motHide(); this.ui.edges(false); this.ui.timer(null);
    [...this.mates, ...this.defs, this.keeper].forEach(p => p.setVisible(false));
    this.world.yaw.rotation.y = 0;
  }

  endRun() {
    if (this.phase === 'over') return;
    this.phase = 'over'; this.ui.timer(null); this.ui.edges(false); this.ui.motHide();
    this.ui.center(this.mode === 'challenge' ? 'FULL TIME' : 'FINISH', 'gold'); this.audio.whistle(0.3); this.after(380, () => this.audio.whistle(0.3)); this.after(760, () => this.audio.whistle(0.9));
    const sum = this.summary();
    this.after(2200, () => { this.quit(); this.onEnd && this.onEnd(sum); });
  }

  summary() {
    const s = this.stats, dur = Math.max(1, (this.clock - (this.startedAt || 0)) / 1000);
    const acc = s.decisions ? s.correct / s.decisions : 0;
    const avgRt = s.rts.length ? Math.round(s.rts.reduce((a, b) => a + b, 0) / s.rts.length) : 0;
    const steps = this.sensors.steps - s.stepsStart;
    const axes = {
      judge: acc,
      speed: s.rts.length ? clamp((1500 - avgRt) / 1100, 0, 1) : 0,
      vision: s.minFlash != null ? clamp((920 - s.minFlash) / 750, 0, 1) * .8 + acc * .2 : (this.mode === 'mot' ? (s.motTotal ? s.motOk / s.motTotal : 0) : 0),
      call: this.opts.voice && s.callChances ? clamp(s.calls / s.callChances, 0, 1) : null,
      scan: clamp(s.scans / Math.max(.5, dur / 60) / 18, 0, 1),
      brake: s.whistleTotal ? s.whistleOk / s.whistleTotal : null,
    };
    const W = { judge: .32, speed: .2, vision: .18, call: .1, scan: .1, brake: .1 };
    let num = 0, den = 0; for (const k in W) if (axes[k] != null) { num += axes[k] * W[k]; den += W[k]; }
    const bi = Math.round(clamp(den ? num / den : 0, 0, 1) * 100);
    return {
      mode: this.mode, title: this.M.title, ranked: !!this.M.ranked, score: Math.round(this.score), level: this.level,
      accuracy: Math.round(acc * 100), avgRt, decisions: s.decisions, correct: s.correct, calls: s.calls, callChances: s.callChances,
      goals: s.goals, shots: s.shots, scans: s.scans, scanPerMin: Math.round(s.scans / (dur / 60) * 10) / 10, minFlash: s.minFlash,
      whistle: [s.whistleOk, s.whistleTotal], both: [s.bothOk, s.bothTotal], shoulder: [s.shoulderOk, s.shoulderTotal], unseen: s.unseen,
      mot: [s.motOk, s.motTotal], steps, stepsPerMin: Math.round(steps / (dur / 60)), duration: Math.round(dur),
      axes, brainIndex: bi, voiceOn: !!this.opts.voice, feetOn: !!(this.opts.motion && this.sensors.hasMotion),
    };
  }
}
