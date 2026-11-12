// 게임 규칙: 공격(랠리 여러 번 + 슛) · 레벨 · 점수 · 훈련장 4종 · 두뇌 지수
import * as THREE from 'three';
import { Footballer } from './player.js';
import { PITCH } from './world.js';
import { parseCall } from './voice.js';
import { shiftAmount } from './people.js';
import { store } from './store.js';

const NUMS = [7, 10, 11, 9, 8, 17, 19, 14, 22, 23, 6, 4, 20, 21, 18, 16, 13, 3, 2, 5];
const START_Z = 36, SHOT_Z = -PITCH.HL + 21; // 랠리는 페널티 박스 앞(SHOT_Z)까지
const SPOT_Z = -PITCH.HL + 10.5, KEEPER_Z = -PITCH.HL + 1.1; // 1:1 슛은 골대 10m 앞에서
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
    // 레벨마다 새 기술 하나 (처음 나올 때 그림 카드 → 연습 2번): LV2 둘러보기(보면서 패스) · LV3 기억으로 패스(화면 가림)
    // · LV4 드리블 돌파 · LV5 수비 이동 · LV7 친구 자리 바꾸기. 휘슬은 챌린지에서 빼고 훈련장 '판단 브레이크'에만 둔다.
    types: L === 1 ? { pass: 1 } : L === 2 ? { pass: .5, scan: .5 } : L === 3 ? { pass: .45, scan: .55 }
      : L === 4 ? { pass: .4, scan: .35, both: .25 } : { pass: .35, scan: .45, both: .2 },
  };
}

export const MODES = {
  challenge: { title: '챌린지', ranked: true, lives: 3, shots: true },
  flash:     { title: '플래시 패스', lives: 0, total: 12, types: { pass: 1 } },
  scan:      { title: '둘러보기 패스', lives: 0, total: 10, types: { scan: 1 } },
  brake:     { title: '판단 브레이크', lives: 0, total: 14, types: { pass: .4, both: .3, whistle: .3 } },
  mot:       { title: '등번호 추적', lives: 0, total: 8 },
  shoot:     { title: '1:1 슛', lives: 0, total: 10, shootOnly: true },
  tutorial:  { title: '30초 따라 하기', lives: 0, total: 99, tutorial: true, types: { pass: 1 } }, // 등록 없이 바로: 패스 2번 → 슛 2번
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
      whistleTotal: 0, whistleOk: 0, bothTotal: 0, bothOk: 0, scanTotal: 0, scanOk: 0, scanBoth: 0, unseen: 0,
      motTotal: 0, motOk: 0, stepsStart: this.sensors.steps, startLevel: level };
    this.slow = null; this.burst = 0; this.forceKind = null; this.teaching = false;
    this.ui.hud(true, mode);
    this.ui.setScore(0); this.ui.setLevel(level); this.ui.setLives(this.lives, this.M.lives); this.ui.setCombo(1);
    this.ui.attack(0, 0);
    this.world.setExcite(.3, 1);
    if (mode === 'mot') { this.motSetup(true); this.ui.hint('mot'); } else this.newAttack(true);
    this.phase = 'countdown';
    if (this.M.tutorial) { // 따라 하기: 카운트다운 없이 바로, 단계 안내 카드
      this.tut = { step: 0, tries: 0 }; this.ui.tut(0);
      this.after(600, () => { this.startedAt = this.clock; this.startRally(); });
      return;
    }
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
    this.me.x = 0; this.me.z = START_Z; this.me.side = 0; this.me.sideT = 0; this.burst = 0; this.ui.blind(false); this.ui.scanChips(null);
    this.look.hold = null; this.mates.forEach(m => m.setMark(null));
    this.world.rig.position.set(0, 0, START_Z); this.world.setZoom(1, true);
    const nums = shuffle(NUMS).slice(0, 2);
    this.mates.forEach((m, i) => {
      m.setVisible(i < 2); m.setBlank(false); m.showBadge(false); m.setRing(true, '#ffc93c');
      if (i < 2) { m.setNumber(nums[i]); m.rel = new THREE.Vector3((i ? 1 : -1) * S.lane, 0, -S.ahead); m.place(this.me.x + m.rel.x, this.me.z + m.rel.z); m.group.rotation.y = Math.PI; }
    });
    this.defs.forEach(d => { d.setVisible(false); d.glow(0); });
    this.presser = this.defs[3]; this.presser.setVisible(true); this.presser.setRing(false);
    this.presser.place(rnd(-1.5, 1.5), START_Z - 11, 0, START_Z); this.presser.maxSpeed = 3;
    this.keeper.setVisible(!!(this.M.shots || this.M.shootOnly || this.M.tutorial)); this.keeper.place(0, KEEPER_Z, 0, 0); this.keeper.face = new THREE.Vector3(0, 0, 0);
    this.ballCarry();
    if (this.M.shots) this.ui.attack(this.attackSize, 0);
    this.ui.hint('pass', this.passZones());
    if (S.badges === 'attack' || first) this.showBadges(2200);
    if (!first) { this.ui.flash(false); }
  }

  showBadges(ms) {
    this.mates.forEach(m => m.group.visible && m.showBadge(true));
    if (this.badgeTimer) this.cancel(this.badgeTimer);
    if (ms) this.badgeTimer = this.after(ms, () => { if (this.spec.badges !== 'always') this.mates.forEach(m => m.showBadge(false)); });
  }

  // 화면 칸 수: 돌파(양쪽 막힘)가 나오는 판과 슛은 왼쪽·가운데·오른쪽 3칸, 나머지는 왼쪽·오른쪽 2칸
  passZones() { const t = this.M?.types || this.spec?.types || {}; return t.both ? 3 : 2; }
  zones() { return this.phase && this.phase.startsWith('shot') ? 2 : this.passZones(); }
  swipeMode() { return !!(this.phase && this.phase.startsWith('shot')); } // 슛 장면: 화면을 쓸어 올려 찬다
  holdMode() { return this.phase === 'scanSet' || this.phase === 'scan'; } // 둘러보기: 화면 왼쪽·오른쪽을 꾹 = 그쪽 보기
  holdLook(zone) {
    const r = this.rally, L = this.look;
    if (!zone || zone === 'C' || !r || !r.sideMates) { L.hold = null; return; }
    const m = r.sideMates[zone === 'L' ? -1 : 1];
    L.hold = clamp(Math.atan2(-(m.pos.x - this.me.x), -(m.pos.z - this.me.z)), -1.9, 1.9); // 그쪽 친구를 화면 가운데로
  }

  // ---------- 새 기술 카드 · 연습 (기기에 저장) ----------
  // 카드는 기술마다 한 번. 연습은 그 기술을 2번 성공할 때까지 — 연습 중엔 틀려도 목숨을 잃지 않고 같은 기술을 한 번 더 한다.
  taught(rule) { return store.get('taught', []).includes(rule); }
  setTaught(rule) { const t = store.get('taught', []); if (!t.includes(rule)) { t.push(rule); store.set('taught', t); } }
  practiced(rule) { return (store.get('practice', {})[rule] || 0) >= 2; }
  addPractice(rule) { const pr = store.get('practice', {}); pr[rule] = (pr[rule] || 0) + 1; store.set('practice', pr); }
  // 둘러보기 단계: 연습을 마친 만큼만 어려워진다 (scan 보면서 패스 → blind 화면 가림 → switch 수비 이동)
  scanStage() {
    const Q = this.scanSpec();
    if (!this.practiced('scan')) return 'scan';
    if (Q.blind && !this.practiced('blind')) return 'blind';
    if (Q.switchP > 0) return 'switch';
    return Q.blind ? 'blind' : 'scan';
  }
  ruleOf(r) { return r.kind === 'scan' ? r.stage : r.kind; } // pass · both · whistle · scan · blind · switch
  teach(rule, fn) { // 게임을 멈추고 그림 카드를 보여 준 뒤 '해 볼게요!'를 누르면 이어 간다
    this.phase = 'teach'; this.teaching = true; this.paused = true; this.look.hold = null;
    this.ui.teach(rule, () => { this.setTaught(rule); this.teaching = false; this.paused = false; this.phase = 'build'; fn(); });
  }
  practiceRetry(r) { // 연습에서 틀리면: 목숨 그대로, 같은 기술을 한 번 더
    this.phase = 'turnover';
    this.ui.callout('연습이라 괜찮아요 · 한 번 더!', 'warn', 1600);
    this.after(1300, () => {
      if (this.phase === 'over') return;
      this.ballCarry(); this.mates.forEach(m => m.setMark(null));
      if (r.kind === 'scan') this.scanFormation();
      this.forceKind = r.kind; this.startRally();
    });
  }

  // ---------- 랠리 ----------
  makeRally() {
    const S = this.spec, types = this.M.types || S.types;
    let kind = weighted(types);
    if (!this.M.tutorial) { // 새 기술을 배우는 중이면 그 기술이 나오게 (카드 → 연습 2번 성공까지)
      const stage = types.scan ? this.scanStage() : null;
      if (types.scan && (!this.taught(stage) || (stage !== 'switch' && !this.practiced(stage)))) kind = 'scan';
      else if (types.both && (!this.taught('both') || !this.practiced('both'))) kind = 'both';
    }
    if (this.forceKind) { kind = this.forceKind; this.forceKind = null; } // 연습에서 틀렸으면 같은 기술을 한 번 더
    const side = Math.random() < .5 ? -1 : 1;
    const r = { kind, side, flashMs: S.flashMs, windowMs: S.decisionMs, scanned: false, voiceOpen: true };
    if (kind === 'pass') r.answer = side < 0 ? 'R' : 'L';
    else if (kind === 'both') r.answer = 'C';
    else if (kind === 'scan') { r.stage = this.scanStage(); r.windowMs = r.stage === 'scan' ? 3500 : this.scanSpec().decideMs; } // 정답은 scanStart 에서 정한다
    else if (kind === 'whistle') { r.answer = 'none'; r.windowMs = Math.round(S.decisionMs * .85); }
    // 연습 중인 기술 (틀려도 목숨을 잃지 않는다): 둘러보기 단계 또는 돌파
    r.practice = kind === 'scan' && r.stage !== 'switch' && !this.practiced(r.stage) ? r.stage : kind === 'both' && !this.practiced('both') ? 'both' : null;
    if (r.practice === 'both') r.flashMs = Math.max(r.flashMs, 1600);
    if (r.practice === 'blind') r.windowMs = Math.max(r.windowMs, 3000);
    if (this.M.tutorial) { // 1단계: 수비수가 계속 보이고 시간 제한 없음 / 2단계: 0.9초만 보이고 5초 안에
      r.flashMs = this.tut.step === 0 ? 60000 : 900; r.windowMs = this.tut.step === 0 ? 60000 : 5000;
    }
    return r;
  }

  startRally() {
    if (this.phase === 'over') return;
    const S = this.spec, r = this.rally = this.makeRally();
    this.phase = 'build'; r.startAt = this.clock;
    if (this.M.shots) this.ui.attack(this.attackSize, this.rallyIdx);
    if (S.badges === 'always') this.showBadges(0);
    else if (S.badges === 'rally') this.showBadges(1300);
    if ((this.forceShot && this.M.shots) || this.M.shootOnly || (this.M.tutorial && this.tut.step >= 2)) { this.me.z = Math.min(this.me.z, SHOT_Z + 3); return this.shotRun(); } // 훈련장 1:1 슛, 따라 하기 3·4단계, 개발용 ?shot
    // 새 기술이면 그림 카드로 먼저 알려 준다 (기술마다 한 번)
    const rule = this.M.tutorial ? null : this.ruleOf(r);
    if (rule && !this.taught(rule)) return this.teach(rule, () => this.beginRally(r));
    this.beginRally(r);
  }
  beginRally(r) {
    const S = this.spec;
    if (r.kind === 'scan') return this.scanStart(r);
    if (r.practice) this.ui.callout('연습이에요 · 틀려도 괜찮아요', 'warn', 1300);
    // 등번호 섞기 (레벨 7+): 배지가 꺼진 뒤 두 친구가 X자로 엇갈려 뛴다
    if (S.shuffle && Math.random() < .5) this.after(1000, () => { const [a, b] = this.mates; [a.rel, b.rel] = [b.rel, a.rel]; });
    // 압박 수비 위치
    const p = this.presser; p.setVisible(true);
    if (p.pos.z > this.me.z - 6 || Math.abs(p.pos.x - this.me.x) > 3) p.place(this.me.x + rnd(-.3, .3), this.me.z - 12, this.me.x, this.me.z);
    p.maxSpeed = 2.5;
    const build = this.M.tutorial ? 700 : rnd(...S.build);
    this.after(build, () => this.onset());
  }

  laneSpot(side, f) {
    const m = this.mateOnSide(side);
    const tx = m ? m.pos.x : this.me.x + side * this.spec.lane, tz = m ? m.pos.z : this.me.z - this.spec.ahead;
    // 패스 길 위, 친구 쪽에 가깝게 (가운데 압박 수비와 헷갈리지 않도록 바깥으로 1m 더)
    const z = this.me.z + (tz - this.me.z) * f;
    let dx = (tx - this.me.x) * f + side * rnd(.6, 1.4);
    // 세로 폰은 가로 시야가 좁아(약 51°) 바깥 수비수가 화면 밖으로 나갈 수 있다 → 번쩍이는 동안 화면 폭 75% 안에 보이게
    const cam = this.world.camera, maxTan = Math.tan(cam.fov * Math.PI / 360) * cam.aspect * .75;
    const dz = Math.max(4, (this.me.z - z) - this.me.v * (this.spec.flashMs + 150) / 1000);
    dx = clamp(dx, -maxTan * dz, maxTan * dz);
    return new THREE.Vector3(this.me.x + dx, 0, z);
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
    if (r.kind === 'pass') {
      r.flashDef = this.defs[0]; flashDef(this.defs[0], this.laneSpot(r.side, rnd(.55, .78)), r.flashMs); this.audio.tick();
      if (this.M.tutorial && this.tut.step === 0) this.ui.tutPulse(r.answer); // 처음엔 누를 칸을 깜빡여 준다
    }
    else if (r.kind === 'both') {
      this.stats.bothTotal++;
      flashDef(this.defs[0], this.laneSpot(-1, rnd(.55, .78)), r.flashMs); flashDef(this.defs[1], this.laneSpot(1, rnd(.55, .78)), r.flashMs); this.audio.tick();
      if (r.practice) this.after(Math.min(r.flashMs, 500), () => { this.ui.callout('양쪽 다 막혔다! 가운데 = 돌파', 'warn', 1800); this.ui.tutPulse('C'); });
    } else if (r.kind === 'whistle') {
      this.stats.whistleTotal++;
      this.audio.whistle(0.5); this.ui.callout('휘슬! 멈춤', 'warn', 900);
      flashDef(this.defs[0], this.laneSpot(r.side, rnd(.5, .7)), r.flashMs);
    }
    this.pressSpeed = Math.max(2.4, (Math.abs(this.presser.pos.z - this.me.z) - 1.2) / (r.windowMs / 1000) - this.me.v + 1.2);
    this.ui.timer(1);
    r.expire = this.after(r.windowMs, () => this.resolve(null));
  }

  // kind: 'L' 왼쪽 · 'C' 가운데 · 'R' 오른쪽 (누른 화면 자리)
  onInput(kind, tReal) {
    if (this.paused) return;
    if (kind === 'C' && this.zones() < 3) return;
    if (this.phase && this.phase.startsWith('shot')) { // 슛은 탭이 아니라 쓸어 올리기
      if (this.phase === 'shotDecide' && !this.rally.tapHint) { this.rally.tapHint = true; this.ui.callout('톡 누르지 말고, 골대 쪽으로 쓸어 올려요!', 'warn', 1400); }
      return;
    }
    if ((this.phase === 'build' || this.phase === 'scanSet' || this.phase === 'scan') && this.rally && !this.rally.early) {
      this.rally.early = true; this.ui.callout(this.phase === 'build' ? '아직! 보고 판단해요' : '아직! 공이 오면 패스해요', 'warn', 800); return;
    }
    if (this.phase !== 'decide') return;
    this.resolve(kind, tReal);
  }

  resolve(kind, tReal) {
    const r = this.rally; if (!r || r.resolved || this.phase !== 'decide') return;
    if (r.expire) this.cancel(r.expire);
    r.resolved = true; this.phase = 'resolve'; this.ui.timer(null); this.ui.edges(false);
    const input = kind || null;
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
      if (r.practice) this.addPractice(r.practice); // 연습 성공 기록 (2번이면 연습 끝)
      if (r.kind === 'whistle') this.stats.whistleOk++;
      if (r.kind === 'both') this.stats.bothOk++;
      const speed = rt != null ? clamp(1 - rt / r.windowMs, 0, 1) : 0.5;
      let pts = (100 + 100 * speed) * mult, scanNote = null;
      if (r.scanned) pts += 40 * mult;
      if (r.kind === 'scan') { // 양쪽 다 봤으면 +40, 공 받기 1.2초 안에 한 번 더 봤으면 +40, 하나도 안 보고 맞히면 30%만
        const sc = r.scan, both = sc.seen[-1] && sc.seen[1], late = Math.max(sc.lastSeen[-1] ?? -1e9, sc.lastSeen[1] ?? -1e9) >= r.onsetAt - 1200;
        this.stats.scanOk++;
        if (!sc.seen[-1] && !sc.seen[1]) { pts *= 0.3; this.stats.unseen++; scanNote = '찍었어요? 둘러보고 골라요'; }
        else {
          if (both) { pts += 40 * mult; this.stats.scanBoth++; }
          if (late) pts += 40 * mult;
          scanNote = both && late ? '양쪽 확인 + 막판 확인!' : both ? '양쪽 다 봤어요' : late ? '막판 확인!' : null;
        }
      }
      pts = Math.round(pts * this.combo());
      this.addScore(pts);
      this.audio.ok(); this.world.setExcite(.35, .3);
      const label = r.answer === 'none' ? '멈춤 성공' : r.answer === 'C' ? '드리블 돌파' : (r.answer === 'L' ? '← 패스' : '패스 →');
      this.ui.pop(`+${pts}`, 'good'); this.ui.pop(rt != null ? `${label} · ${rt}ms` : label, 'small');
      if (r.scanned) this.ui.pop('스캔 보너스', 'small gold');
      if (scanNote) this.ui.pop(scanNote, 'small gold');
      if (r.answer === 'L' || r.answer === 'R') { this.stats.callChances++; r.receiver = this.mateOnSide(r.answer === 'L' ? -1 : 1); r.receiverNum = r.receiver.number; }
      if (r.kind === 'scan') this.scanReveal(r, input);
      this.playCorrect(r);
    } else {
      this.streak = 0;
      this.audio.bad(); this.audio.groan(); this.ui.flash(true);
      const why = r.kind === 'scan' ? this.scanWhy(r, input) : input === null ? '늦었어요!' : r.answer === 'none' ? '휘슬엔 멈춰요' : r.answer === 'C' ? '양쪽 다 막히면 가운데 = 돌파' : input === 'C' ? '빈 친구가 있으면 패스!' : '수비가 있는 쪽이에요 · 빈 친구에게!';
      if (r.kind !== 'scan') this.ui.center('MISS', 'bad'); // 둘러보기 패스는 정답 미니맵이 대신 보여 준다
      this.ui.pop(why, 'small bad');
      if (r.kind === 'scan') this.scanReveal(r, input);
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
        if (r.kind === 'scan') this.scanFormation(); // 공을 받은 친구들은 원래 자리로 돌아간다
        this.after(380, () => {
          this.audio.kick(.55);
          const back = new THREE.Vector3(this.me.x + 0.12, .11, this.me.z - 3.6);
          this.ballFly(back, .8, .12, () => { this.ballCarry(1.1); this.audio.touch(); this.after(250, next); });
        });
      });
    } else if (r.answer === 'C') {
      // 드리블 돌파: 압박 수비가 발을 뻗는 순간 반대쪽으로 치고 나간다 (옆으로 크게 빠지며 속도가 붙는다)
      const p = this.presser, s = p.pos.x > this.me.x + .2 ? -1 : p.pos.x < this.me.x - .2 ? 1 : (Math.random() < .5 ? -1 : 1);
      this.me.side = s; this.me.sideT = 1; this.burst = 1; this.ballSpeed = this.me.v + 4.5;
      p.tackle((this.me.x - p.pos.x) * .2, 1); this.audio.whoosh(); this.world.setExcite(.6, .6);
      this.world.setZoom(.84); this.after(700, () => this.world.setZoom(1));
      this.ui.center('돌파!', 'gold');
      this.after(1200, () => { p.place(this.me.x + rnd(-6, 6), this.me.z + 14); p.setVisible(false); next(); });
    } else if (r.answer === 'none') {
      this.after(700, next);
    } else this.after(600, next);
  }

  playWrong(r) {
    const lose = () => this.afterRally(false);
    if (r.kind === 'pass' && r.input && r.input !== 'C') { // 막힌 쪽 패스 → 가로채기
      const d = r.flashDef || this.defs[0]; r.interceptBy = d;
      d.setVisible(true); d.glow(.6); this.world.kickBoot(r.input === 'L' ? -1 : 1, 1); this.audio.kick(.7);
      const to = d.pos.clone(); to.y = .11;
      this.ballFly(to, clamp(this._dist(d) / 15, .4, 1), .15, () => { this.ballHold(d); this.audio.touch(); d.moveTo(d.pos.x + rnd(-4, 4), d.pos.z + 25, 6.5); this.after(1300, lose); });
    } else if (r.kind === 'scan') { // 수비가 붙은 친구에게 패스 → 그 수비가 가로챔 / 시간 초과 → 그 수비가 달려와 뺏음
      const d = r.tight; r.interceptBy = d;
      if (r.input === 'L' || r.input === 'R') {
        this.world.kickBoot(r.input === 'L' ? -1 : 1, 1); this.audio.kick(.7);
        const to = d.pos.clone(); to.y = .11;
        this.ballFly(to, clamp(this._dist(d) / 15, .4, 1), .15, () => { this.ballHold(d); this.audio.touch(); d.moveTo(d.pos.x + rnd(-4, 4), d.pos.z + 25, 6.5); this.after(1300, lose); });
      } else {
        d.moveTo(this.me.x, this.me.z - 1, 8);
        this.after(700, () => { d.tackle((this.me.x - d.pos.x) * .1, 0); this.ballHold(d); this.audio.touch(); this.after(1100, lose); });
      }
    } else { // 시간 초과·휘슬 반칙·잘못된 돌파 → 압박 수비가 뺏음
      const p = this.presser; p.setVisible(true); p.moveTo(this.me.x, this.me.z - 1.2, 8);
      this.after(380, () => { p.tackle(0, .4); this.ballHold(p); this.audio.touch(); if (r.answer === 'none' && r.input) this.audio.whistle(0.3); this.after(1100, lose); });
    }
    this.defs.forEach(d => { if (d !== r.interceptBy && d !== this.presser) d.setVisible(false); });
  }

  afterRally(ok) {
    if (this.phase === 'over') return;
    if (this.M.tutorial) return this.tutAfter(ok);
    this.defs.forEach(d => { if (d !== this.presser) d.setVisible(false); });
    if (this.mode === 'challenge') {
      if (!ok && this.rally?.practice) return this.practiceRetry(this.rally); // 연습 중엔 목숨을 잃지 않는다
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
    const notes = { 7: '친구들이 자리를 바꿔요 · 등번호를 기억!' }; // 새 기술은 그림 카드가 알려 준다
    if (this.mode === 'challenge' && notes[this.level]) this.after(900, () => this.ui.callout(notes[this.level], 'warn', 2600));
    if (this.mode === 'challenge' && prevTod && prevTod !== this.spec.tod) this.after(600, () => this.ui.callout(this.spec.tod === 'dusk' ? '해 질 녘 경기' : '야간 경기 · 조명 ON', '', 1600));
  }

  // ---------- 둘러보기 패스 (LV2~, 훈련장) ----------
  // 앞 친구에게 공을 주고(원) 돌려받기(투) 전 몇 초 동안 폰을 돌려(또는 화면을 끌어) 양옆을 본다.
  // 공이 발에 닿는 순간 화면이 가려지고, 기억만으로 수비가 안 붙은 친구 쪽을 누른다.
  // 실제 선수들이 공 받기 전에 고개를 돌려 주변을 살피는 습관(스캐닝)을 그대로 옮긴 규칙.
  scanSpec() {
    const L = Math.max(2, this.level);
    return {
      ang: L === 2 ? [40, 50] : L === 3 ? [45, 60] : L === 4 ? [55, 75] : L <= 6 ? [65, 95] : [75, 105], // 정면에서 친구까지 각도(°): 클수록 더 돌아봐야 보인다
      scanMs: L === 2 ? 4200 : Math.max(2400, 3800 - 150 * (L - 3)), // 공이 나갔다 돌아오기까지 둘러볼 시간
      decideMs: Math.max(1100, 1900 - 90 * (L - 3)),  // 화면이 가려진 뒤 고를 시간
      blind: L >= 3,                                  // 공이 오면 화면을 가린다 (기억으로 패스)
      loose: L >= 5,                                  // 빈 친구 근처에도 떨어져 있는 수비
      switchP: L >= 7 ? .5 : L >= 5 ? .35 : 0,        // 둘러보는 사이 수비가 다른 친구에게 옮겨 붙을 확률
    };
  }
  scanStart(r) {
    const Q = this.scanSpec(), me = this.me, st = r.stage || 'switch';
    // 단계에 맞춰 어렵게: scan = 화면 안 가림 · blind = 공이 오면 화면 가림 · switch = 수비 이동까지
    const blind = Q.blind && st !== 'scan', switchP = st === 'switch' ? Q.switchP : 0, scanMs = Q.scanMs + (r.practice ? 600 : 0);
    this.stats.scanTotal++;
    this.phase = 'scanSet'; this.presser.setVisible(false);
    const free = Math.random() < .5 ? -1 : 1;
    r.scan = { Q, blind, scanMs, free, seen: {}, lastSeen: {}, yawMin: this.look.yaw, yawMax: this.look.yaw, startAt: null, switchAt: null, switched: false };
    r.answer = free < 0 ? 'L' : 'R';
    // 장면을 잠깐 끊고(0.1초) 새 자리로: 양옆 친구는 옆으로 넓게, 앞 친구는 공을 받은 상태
    this.ui.cut();
    r.sideMates = { [-1]: this.mateOnSide(-1), [1]: this.mateOnSide(1) };
    for (const s of [-1, 1]) {
      const m = r.sideMates[s], th = rnd(...Q.ang) * Math.PI / 180, d = rnd(8.5, 11);
      m.rel = new THREE.Vector3(s * d * Math.sin(th), 0, -d * Math.cos(th));
      m.place(me.x + m.rel.x, me.z + m.rel.z, me.x, me.z);
    }
    // 수비: 막힌 친구 바로 앞(패스 길)에 붙는다. LV4부터는 빈 친구 뒤쪽에도 떨어져 있는 수비가 하나 더
    // 수비는 처음부터 제자리(화면 밖 옆)에 둔다 — 앞에서 뛰어가는 게 보이면 둘러보지 않아도 답을 알게 되므로
    r.tight = this.defs[0]; r.loose = Q.loose && st === 'switch' ? this.defs[1] : null;
    for (const d of [r.tight, r.loose]) if (d) {
      const [x, z] = d === r.tight ? this.scanSpot(r.sideMates[-free].rel, 'tight') : this.scanSpot(r.sideMates[free].rel, 'loose');
      d.setVisible(true); d.setRing(false); d.glow(0); d.maxSpeed = 9;
      d.place(x, z, me.x, me.z); d.face = new THREE.Vector3(me.x, 0, me.z);
    }
    // 앞 친구(벽)에게 공을 준다
    const wall = this.mates[2], used = [r.sideMates[-1].number, r.sideMates[1].number];
    wall.setNumber(shuffle(NUMS).find(n => !used.includes(n)));
    wall.setVisible(true); wall.setBlank(false); wall.showBadge(false); wall.setRing(true, '#ffc93c'); wall.rel = null;
    wall.place(me.x + rnd(-.6, .6), me.z - 10, me.x, me.z); wall.face = new THREE.Vector3(me.x, 0, me.z);
    r.wall = wall; this.ballHold(wall);
    r.sideMates[free].setMark('ok'); r.sideMates[-free].setMark('no'); // 머리 위 ✔ 빈 친구 · ✖ 수비가 붙은 친구
    // 0.4초 뒤부터 둘러보기 시간
    this.after(400, () => {
      if (this.rally !== r || this.phase !== 'scanSet') return;
      this.phase = 'scan'; r.scan.startAt = this.clock;
      r.scan.yawMin = r.scan.yawMax = this.look.yaw;
      this.ui.scanChips({ l: false, r: false, nudge: !!r.practice }); // 화면 양쪽: '꾹 = 그쪽 보기' + 본 쪽 ✔
      this.ui.callout(r.practice ? '화면 양쪽을 꾹 눌러 ✔ 친구를 찾아요' : '둘러봐!', 'warn', r.practice ? 2000 : 900);
      if (Math.random() < switchP) r.scan.switchAt = this.clock + scanMs * rnd(.5, .75);
      // 앞 친구가 돌려준다 (공이 0.9초 동안 굴러 온다)
      this.after(scanMs - 900, () => {
        if (this.rally !== r || this.phase !== 'scan') return;
        this.audio.kick(.5);
        this.ballFly(new THREE.Vector3(me.x + .1, .11, me.z - 1.1 - me.v * .9), .9, .04, () => this.scanArrive(r));
      });
    });
  }
  // 공이 발에 닿았다 → 화면을 가리고 판단 시간 시작
  scanArrive(r) {
    if (this.rally !== r || this.phase !== 'scan') return;
    this.ballCarry(1.1); this.audio.touch(1);
    this.phase = 'decide'; r.onsetAt = this.clock; r.onsetReal = performance.now();
    this.ui.scanChips(null);
    if (r.scan.blind) this.ui.blind(true); else this.ui.callout('✔ 친구 쪽을 눌러요!', 'warn', 1400);
    this.ui.timer(1);
    r.expire = this.after(r.windowMs, () => this.resolve(null));
    const w = r.wall; // 앞 친구는 옆으로 빠진다
    w.moveTo(w.pos.x + (Math.random() < .5 ? -1 : 1) * 10, w.pos.z - 8, 5);
    this.after(2500, () => { if (this.rally === r || this.rally?.wall !== w) w.setVisible(false); });
  }
  // 지금 화면 안에 보이는지 (둘러보기 방향 기준)
  inView(pos) {
    const me = this.me, cam = this.world.camera;
    const ang = Math.atan2(-(pos.x - me.x), -(pos.z - me.z));
    const diff = Math.atan2(Math.sin(ang - this.look.yaw), Math.cos(ang - this.look.yaw));
    return Math.abs(diff) < Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect) * .92;
  }
  scanUpdate(r) {
    const sc = r.scan, me = this.me;
    if (this.phase === 'scan') {
      sc.yawMin = Math.min(sc.yawMin, this.look.yaw); sc.yawMax = Math.max(sc.yawMax, this.look.yaw);
      let changed = false;
      for (const s of [-1, 1]) if (this.inView(r.sideMates[s].pos)) { if (!sc.seen[s]) changed = true; sc.seen[s] = true; sc.lastSeen[s] = this.clock; }
      if (changed) {
        this.ui.scanChips({ l: !!sc.seen[-1], r: !!sc.seen[1], nudge: !!r.practice });
        if (sc.seen[-1] && sc.seen[1] && r.practice) this.ui.callout('좋아요! 공이 오면 ✔ 친구 쪽을 눌러요', '', 1600);
      }
      if (sc.switchAt && !sc.switched && this.clock >= sc.switchAt) { // 수비 이동: 막던 수비는 뒤로 빠지고, 뒤에 있던 수비가 패스 길로 들어온다
        sc.switched = true; sc.switchedAt = this.clock; sc.free = -sc.free; r.answer = sc.free < 0 ? 'L' : 'R';
        [r.tight, r.loose] = [r.loose, r.tight];
        r.sideMates[sc.free].setMark('ok'); r.sideMates[-sc.free].setMark('no');
      }
    }
    if (!['scanSet', 'scan', 'decide'].includes(this.phase)) return;
    r.tight.moveTo(...this.scanSpot(r.sideMates[-sc.free].rel, 'tight'), 9); r.tight.face.set(me.x, 0, me.z);
    if (r.loose) { r.loose.moveTo(...this.scanSpot(r.sideMates[sc.free].rel, 'loose'), 9); r.loose.face.set(me.x, 0, me.z); }
    if (r.wall.face && !r.resolved) r.wall.face.set(me.x, 0, me.z);
  }
  // 수비 자리 (친구가 설 자리 rel 기준): 'tight' = 친구와 나 사이 패스 길(친구에게서 1.4m),
  // 'loose' = 친구보다 22° 앞쪽으로 3.5m 더 먼 곳 — 패스 길이 비어 있는 게 한눈에 보이게
  scanSpot(rel, role) {
    const me = this.me, dl = Math.hypot(rel.x, rel.z) || 1;
    if (role === 'tight') return [me.x + rel.x * (1 - 1.4 / dl), me.z + rel.z * (1 - 1.4 / dl)];
    const s = Math.sign(rel.x) || 1, th = Math.atan2(Math.abs(rel.x), -rel.z) - 22 * Math.PI / 180, d = dl + 3.5;
    return [me.x + s * d * Math.sin(th), me.z - d * Math.cos(th)];
  }
  scanFormation() { // 양옆 친구를 원래 앞쪽 자리로
    const S = this.spec;
    this.mates.forEach(m => m.setMark(null));
    this.mateOnSide(-1).rel = new THREE.Vector3(-S.lane, 0, -S.ahead);
    this.mateOnSide(1).rel = new THREE.Vector3(S.lane, 0, -S.ahead);
  }
  scanWhy(r, input) {
    const sc = r.scan, name = (s) => s < 0 ? '왼쪽' : '오른쪽';
    if (!input) return '늦었어요! 공이 오면 바로 ✔ 친구 쪽을 눌러요';
    if (input === 'C') return '✔ 빈 친구 쪽(왼쪽·오른쪽)을 눌러요';
    const chosen = input === 'L' ? -1 : 1;
    if (!sc.seen[-1] && !sc.seen[1]) return '둘러보지 않고 골랐어요 · 공 오기 전에 화면 양쪽을 꾹!';
    if (sc.switched && (sc.lastSeen[-1] ?? -1) < sc.switchedAt && (sc.lastSeen[1] ?? -1) < sc.switchedAt) return '수비가 옮겨 붙었어요 · 받기 직전에 한 번 더!';
    if (!sc.seen[chosen]) return `${name(chosen)} 친구를 안 보고 골랐어요`;
    return '✖ 수비가 붙은 친구였어요 · ✔ 친구에게!';
  }
  // 정답 미니맵: 친구·수비 자리, 내가 본 범위(노란 부채꼴), 내 패스
  scanReveal(r, input) {
    const sc = r.scan, me = this.me, cam = this.world.camera;
    const rel = (p) => ({ x: p.pos.x - me.x, z: p.pos.z - me.z });
    const chosen = input === 'L' ? -1 : input === 'R' ? 1 : 0;
    this.ui.blind(false);
    this.ui.scanMap({
      yawMin: sc.yawMin, yawMax: sc.yawMax, hHalf: Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect),
      mates: [-1, 1].map(s => ({ ...rel(r.sideMates[s]), num: r.sideMates[s].number, free: s === sc.free })),
      defs: [r.tight, r.loose].filter(Boolean).map(d => ({ ...rel(d), tight: d === r.tight })),
      pass: chosen ? rel(r.sideMates[chosen]) : null, ok: r.correct,
      title: r.correct ? '정답! 빈 친구에게 패스' : !input ? '시간 초과' : '수비가 붙은 친구',
    }, 2200);
  }

  // ---------- 슛 (1:1 찬스, 1.6부터 '쓸어서 차기') ----------
  // 골대 10m 앞에서 공을 골대 쪽으로 쓸어 올려 찬다: 쓸어 올린 방향 = 슛 방향, 빠르기 = 힘(세게 찰수록 높게, 너무 세면 크로스바 위로).
  // 골키퍼는 미리 정하지 않고 가운데에서 버티며 조금씩 다가온다(각도를 좁힘). 가끔 한쪽으로 무게를 싣는데(기울기),
  // 그때 반대 구석으로 차면 역동작으로 반응이 늦고, 기운 쪽으로 차면 바로 막힌다. 공이 출발한 뒤 반응해서 몸을 날린다.
  // 레벨이 오를수록 골키퍼 반응이 빠르고 손이 멀리 닿으며, 기울기는 짧아진다.
  shotRun() {
    if (!this.M.tutorial && !this.taught('shot') && !store.get('tutDone', false)) return this.teach('shot', () => this.shotRun());
    this.phase = 'shotRun'; this.shotEarly = false;
    if (this.M.shots) this.ui.attack(this.attackSize, this.attackSize);
    const first = !this.stats.shots && !this.M.tutorial; // 따라 하기는 안내 카드가 대신 알려 준다
    if (!this.M.tutorial) this.ui.callout(first ? '1:1 찬스! 공을 골대 쪽으로 쓸어 올려 슛' : '1:1 찬스!', 'warn', first ? 2200 : 1400);
    if (first) this.after(1000, () => this.ui.pop('골키퍼가 한쪽으로 기울 때 반대 구석으로!', 'small gold'));
    this.ui.hint('shot');
    this.mates.forEach((m, i) => { if (i < 2 && m.rel) m.rel.set((i ? 1 : -1) * 7, 0, -2); });
    // 둘러보기 패스처럼 천천히 진행된 공격이면 골대에서 멀다 → 화면을 잠깐 끊고 페널티 박스 앞으로 옮긴다
    if (this.me.z > SHOT_Z + 8) {
      this.ui.cut(); this.me.z = SHOT_Z + 3; this.me.v = 4; this.world.rig.position.z = this.me.z;
      this.mates.forEach(m => { if (m.group.visible && m.rel) m.place(this.me.x + m.rel.x, this.me.z + m.rel.z); });
    }
    this.presser.setVisible(false); this.defs.forEach(d => d.setVisible(false));
    const k = this.keeper; k.setVisible(true); k.place(0, KEEPER_Z, 0, 0); k.face = new THREE.Vector3(0, 0, 0);
    // 골대가 화면 폭에 거의 차도록 확대 (세로 폰은 조금, 가로 화면은 많이)
    this.world.setZoom(this.world.zoomToFit(3.66 + .3, SPOT_Z - .8 + PITCH.HL, .93));
    this.world.setExcite(.75, 2); this.audio.whoosh();
    this.after(100, () => this.waitShotSpot());
  }
  waitShotSpot() {
    if (this.phase !== 'shotRun') return;
    if (this.me.z > SPOT_Z + 0.4 && this.clock - (this.shotWaitStart ??= this.clock) < 4500) return this.after(80, () => this.waitShotSpot());
    this.shotWaitStart = null; this.phase = 'shotSet';
    this.after(250, () => this.shotStart());
  }
  // 골키퍼 능력 (레벨별): 반응 시간·다이빙 속도·기울기 길이
  keeperSpec() {
    if (this.M.tutorial) return { rd: .25, vd: 5, cueMs: 2600 }; // 따라 하기: 느린 골키퍼, 오래 기운다
    const L = this.level;
    return { rd: Math.max(.03, .12 - .01 * (L - 1)), vd: Math.min(8.5, 6.5 + .2 * (L - 1)), cueMs: Math.max(350, 1100 - 75 * (L - 1)) };
  }
  shotStart() {
    if (this.phase !== 'shotSet') return;
    const K = this.keeperSpec(), windowMs = this.M.tutorial ? 9000 : Math.max(2300, 3800 - 150 * (this.level - 1));
    const nextCue = this.M.tutorial ? (this.tut.step === 2 ? Infinity : this.clock + 1200) : this.clock + rnd(500, 1200); // 따라 하기 3단계는 기울지 않는다
    this.rally = { kind: 'shot', windowMs, cueMs: K.cueMs, nextCue, cues: 0, voiceOpen: true, onsetReal: performance.now() };
    this.phase = 'shotDecide'; this.stats.shots++;
    this.ui.timer(1);
    this.rally.expire = this.after(windowMs, () => this.resolveShot(null));
  }
  // 슛 기다리는 동안: 골키퍼가 천천히 다가오고, 가끔 한쪽으로 무게를 싣는다
  keeperUpdate(r) {
    const k = this.keeper;
    if (!k.anim) k.moveTo(0, Math.min(KEEPER_Z + 2.6, k.pos.z + 1), .65);
    if (this.clock >= r.nextCue && !k.anim) {
      const side = Math.random() < .5 ? -1 : 1;
      k.shift(side, this.level <= 3 ? .75 : .55, r.cueMs / 1000); r.cues++; // LV1~3은 조금 크게 기운다
      if (this.level <= 3) { k.glow(.3); this.after(160, () => k.glow(0)); } // 처음엔 살짝 번쩍여서 보는 법을 익힌다
      r.nextCue = this.clock + 220 + r.cueMs + 300 + rnd(500, 1100);
    }
  }
  keeperLean() { // 지금 골키퍼가 무게를 실은 쪽 (-1 / 0 / 1)
    const A = this.keeper.anim;
    return A && A.type === 'shift' && shiftAmount(A) > .45 ? A.side : 0;
  }
  // 쓸어 올린 각도 → 골대 위 가로 위치(x, m). 똑바로 위 = 가운데, 약 22~28° 기울이면 구석, 30° 넘으면 골대 밖
  swipeAim(sw) { return clamp(6.4 * Math.tan(Math.atan2(sw.dx, -sw.dy)), -9, 9); }
  // 쓸어 올린 빠르기 → 힘 (0 ~ 1.35). 화면 높이 기준 초당 몇 배를 쓸었는지로 잰다 (휴대폰마다 화면 크기가 달라도 같게)
  shotPower(sw) { const vN = (Math.abs(sw.dy) / sw.H) / (sw.dt / 1000); return clamp(0.2 + (vN - 0.8) * 0.19, 0, 1.35); }

  onSwipe(sw) {
    if (this.paused) return;
    if (this.phase === 'shotDecide') return this.resolveShot(sw);
    if ((this.phase === 'shotRun' || this.phase === 'shotSet') && !this.shotEarly) { this.shotEarly = true; this.ui.callout('아직! 골대 앞까지 달려요', 'warn', 800); }
  }
  resolveShot(sw) {
    const r = this.rally; if (!r || r.resolved || this.phase !== 'shotDecide') return;
    if (r.expire) this.cancel(r.expire);
    r.resolved = true; this.phase = 'shotResolve'; this.ui.timer(null);
    this.stats.decisions++; this.count++;
    if (!sw) { this.streak = 0; r.correct = false; return this.shotTimeout(r); }
    // 방향·힘 (컴퓨터 키보드는 ← ↑ → 로 왼쪽 구석·가운데·오른쪽 구석, 힘 75%)
    const x = sw.key ? (sw.key === 'L' ? -2.9 : sw.key === 'R' ? 2.9 : 0) : this.swipeAim(sw);
    const p = sw.key ? .75 : this.shotPower(sw);
    const rt = Math.max(0, Math.round((sw.t ?? performance.now()) - r.onsetReal));
    const k = this.keeper, K = this.keeperSpec(), HL = PITCH.HL, POST = 3.66, BAR = 2.44;
    const lean = this.keeperLean();
    const y = 0.15 + 2.5 * clamp((p - 0.3) / 0.75, 0, 1.25); // 골라인에서 공 높이: 세게 찰수록 높다
    const s = 11 + 18 * Math.min(p, 1.2);                      // 공 빠르기 (m/s)
    const b0 = this.ball.position.clone(); b0.y = .11;
    const T = Math.hypot(x - b0.x, -HL - b0.z) / s;
    // 골키퍼가 서 있는 줄을 공이 지나는 곳·때
    const f = clamp((b0.z - k.pos.z) / (b0.z + HL), .05, 1), xc = b0.x + (x - b0.x) * f, yc = b0.y + (y - b0.y) * f, tc = T * f;
    const off = Math.abs(xc - k.pos.x), side = Math.sign(xc - k.pos.x) || 1;
    let rd = K.rd; if (lean === side) rd = 0; else if (lean === -side) rd += .25; // 기운 쪽이면 바로, 반대쪽이면 역동작
    let reach = Math.min(3, .9 + Math.max(0, tc - rd) * K.vd);
    if (yc > 2.1 && off > 1.2) reach -= .3; // 높은 구석은 손이 덜 닿는다
    let out;
    if (Math.abs(x) > POST + .15 || y > BAR + .2) out = y > BAR + .2 ? 'over' : 'wide';
    else if (off <= reach - .12) out = 'save';
    else if (off <= reach + .12) out = Math.random() < .5 ? 'save' : 'goal'; // 손끝 승부
    else if (Math.abs(x) > POST - .13 || y > BAR - .13) out = Math.random() < .35 ? 'postIn' : 'post';
    else out = 'goal';
    r.shot = { x, y, p, lean, side, out, rt, xc, off, reach, tc, rd, kx: k.pos.x, kz: k.pos.z, bz: b0.z }; r.correct = out === 'goal' || out === 'postIn';
    this.world.kickBoot(x < 0 ? -1 : 1, 1.3); this.audio.kick(.6 + .45 * Math.min(1, p));
    this.ui.pop(`슛 파워 ${Math.round(Math.min(p, 1.35) * 100)}%`, 'small');
    // 골키퍼: rd 초 뒤 공 쪽으로 몸을 날린다 (정면이면 그 자리에서 잡는다)
    const save = out === 'save';
    this.after(rd * 1000, () => {
      if (off < .55) { if (yc > 1.5) k.catchHigh(k.pos.x); else k.dive(side, .35); }
      else k.dive(side, clamp(save ? off - .25 : reach - .3, .3, 2.7));
    });
    const h = .08 + .25 * (1 - Math.min(1, p));
    if (out === 'goal' || out === 'postIn') {
      const to = out === 'postIn' ? new THREE.Vector3(Math.sign(x) * (POST - .12), y, -HL) : this.netPoint(x, y);
      this.ballFly(to, T, h, () => {
        if (out === 'postIn') { this.audio.kick(1); this.world.shake(.08); this.ballFly(this.netPoint(Math.sign(x) * 2.6, Math.min(y, 1.6)), .25, .05, () => this.shotGoal(r)); }
        else this.shotGoal(r);
      });
      this.after(T * 520, () => { this.slow = { t: 0, dur: .9 }; }); // 공이 골문에 가까워지면 느린 화면
    } else {
      this.streak = 0;
      if (save) {
        const hand = new THREE.Vector3(xc, clamp(yc, .3, 2.3), k.pos.z + .25);
        this.ballFly(hand, Math.max(tc, rd + .3), h * f, () => {
          this.audio.touch(1);
          if (p < .65 && off < 1.6) { this.ballHold(k, yc > 1.4); this.shotMiss(r); } // 잡았다
          else { this.ballFly(new THREE.Vector3(xc + side * 5, .11, k.pos.z + rnd(2, 5)), .8, .7, () => { this.ballState = 'free'; }); this.shotMiss(r); } // 쳐냈다
        });
      } else if (out === 'post') {
        this.ballFly(new THREE.Vector3(clamp(x, -POST + .1, POST - .1), Math.min(y, BAR - .05), -HL), T, h, () => {
          this.audio.kick(1); this.world.shake(.08);
          this.ballFly(new THREE.Vector3(x * .5 + rnd(-2, 2), .11, -HL + rnd(5, 8)), .9, .6, () => { this.ballState = 'free'; });
          this.shotMiss(r);
        });
      } else { // 크로스바 위 · 골대 밖
        const to = out === 'over' ? new THREE.Vector3(x * 1.1, y + 1.2, -HL - 5) : new THREE.Vector3(x * 1.3, y, -HL - 5);
        this.ballFly(to, T * 1.4, h, () => { this.ballState = 'free'; this.shotMiss(r); });
      }
    }
    this.ui.setCombo(this.combo());
    this.after(1800, () => { r.voiceOpen = false; });
    this.checkCall();
  }
  // 공이 골망에 닿는 자리 (뒤 그물은 위에서 아래로 2m 비스듬히 뒤로 간다)
  netPoint(x, y) { return new THREE.Vector3(x, y, -PITCH.HL - 2 * (1 - y / 2.44) + .15); }
  shotGoal(r) {
    const sh = r.shot;
    this.ballState = 'free'; this.world.shake(.14); this.ui.flash(false);
    this.stats.correct++; this.streak++; this.stats.rts.push(sh.rt); this.stats.goals++;
    this.audio.net(); this.audio.cheer(1); this.world.setExcite(1, 2.5);
    const speed = clamp(1 - sh.rt / r.windowMs, 0, 1), mult = this.spec.mult;
    const wrongFoot = sh.lean && sh.lean === -sh.side, corner = Math.abs(sh.x) > 2.6;
    const pts = Math.round(((250 + 150 * speed) + (wrongFoot ? 60 : 0) + (corner ? 40 : 0)) * mult * this.combo()); this.addScore(pts);
    this.ui.setCombo(this.combo());
    this.ui.center('GOAL!', 'gold'); this.ui.pop(`+${pts}`, 'gold');
    this.ui.pop(sh.out === 'postIn' ? '골대 맞고 골!' : wrongFoot ? '역동작! 기운 반대로 골' : corner ? '구석으로 정확하게!' : '골!', 'small gold');
    this.mates.forEach(m => m.group.visible && m.celebrate());
    this.after(2400, () => this.afterShot(true));
  }
  shotMiss(r) {
    const sh = r.shot;
    const why = sh.out === 'over' ? '너무 세게 찼어요 · 크로스바 위로' : sh.out === 'wide' ? '골대 밖으로 나갔어요 · 조금 더 안쪽으로'
      : sh.out === 'post' ? '골대를 맞았어요! 아깝다'
      : sh.lean && sh.lean === sh.side ? '골키퍼가 기운 쪽으로 찼어요 · 반대로!'
      : sh.p < .45 ? '너무 약해요 · 더 빠르게 쓸어요'
      : Math.abs(sh.x) < 1.8 ? '골키퍼 정면이에요 · 구석으로!' : '골키퍼가 막았어요 · 기울 때 반대 구석으로';
    this.audio.groan(); this.audio.bad();
    this.ui.center(sh.out === 'save' ? 'SAVE' : 'MISS', 'bad'); this.ui.pop(why, 'small bad');
    this.after(1300, () => this.afterShot(false));
  }
  shotTimeout(r) { // 시간 초과: 골키퍼가 달려 나와 공을 덮친다
    const k = this.keeper, me = this.me;
    k.anim = null; k.moveTo(me.x, me.z - 1.5, 6.5);
    const d = Math.abs(me.z - 1.5 - k.pos.z);
    this.after(Math.min(1300, d / 6.5 * 1000 + 250), () => {
      k.tackle(0, .4, 1.4); this.ballHold(k); this.audio.touch();
      this.audio.groan(); this.ui.center('MISS', 'bad'); this.ui.pop('슛 타이밍을 놓쳤어요', 'small bad');
      this.after(1300, () => this.afterShot(false));
    });
  }
  afterShot(goal) {
    if (this.phase === 'over') return;
    if (this.M.tutorial) return this.tutAfter(goal);
    if (this.mode === 'challenge') {
      if (goal) { this.levelUp(true); this.newAttack(); return this.after(800, () => this.startRally()); }
      this.lives--; this.ui.setLives(this.lives, this.M.lives);
      if (this.lives <= 0) return this.endRun();
      this.newAttack(); return this.after(800, () => this.startRally());
    }
    // 훈련장 '1:1 슛': 10번, 3골마다 레벨 업(골키퍼가 빨라진다)
    if (goal && this.stats.goals % 3 === 0) this.levelUp(true);
    if (this.count >= this.M.total) return this.endRun();
    this.newAttack(); this.after(700, () => this.startRally());
  }

  // ---------- 30초 따라 하기 ----------
  // 1 패스(수비수가 계속 보임, 누를 칸 깜빡임) → 2 번쩍 패스 → 3 쓸어서 슛(골키퍼 안 기움) → 4 골키퍼가 기울 때 반대 구석.
  // 틀리면 같은 단계를 다시(3번 틀리면 다음으로 넘어가 지루하지 않게). 4단계는 '기울 때 반대로' 넣어야 통과.
  tutAfter(ok) {
    const t = this.tut, sh = this.rally?.shot;
    let pass = ok;
    if (t.step === 3 && ok && !(sh && sh.lean && sh.lean === -sh.side)) { pass = false; this.ui.pop('골! 이번엔 골키퍼가 기울 때 반대로 차 봐요', 'small gold'); }
    t.tries = pass ? 0 : t.tries + 1;
    if (pass || t.tries >= 3) { t.step++; t.tries = 0; if (pass) { this.ui.center('좋아요!', 'good'); this.audio.ok(); } }
    if (t.step >= 4) { this.phase = 'over'; return this.after(1100, () => this.tutDone(true)); }
    this.ui.tut(t.step);
    this.newAttack(); this.after(700, () => this.startRally());
  }
  tutDone(finished) { this.quit(); this.onTutorialDone && this.onTutorialDone(finished); }

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
  ballHold(p, high = false) { this.ballState = 'held'; this.holder = p; this.holdHigh = high; }
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
      if (this.phase === 'shotSet' || this.phase === 'shotDecide') this.ballRel += (1.2 - this.ballRel) * Math.min(1, dt * 3); // 슛 직전엔 공을 발 앞에 둔다
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
      if (this.holdHigh) b.position.set(p.pos.x, p.pos.y + 2.05, p.pos.z + .3); // 골키퍼가 두 손으로 잡음
      else b.position.set(p.pos.x + Math.sin(yaw) * .45, .11, p.pos.z + Math.cos(yaw) * .45);
      b.rotation.x += Math.hypot(p.vel.x, p.vel.z) * dt / 0.11;
    } else if (this.ballState === 'free') {
      b.position.y = Math.max(.11, b.position.y - dt * 2);
    }
  }

  // ---------- 매 프레임 ----------
  update(dt) {
    if (this.paused || this.phase === 'idle') return;
    if (this.slow) { // 골 장면 느린 화면: 0.28배에서 시작해 원래 속도로
      this.slow.t += dt; const k = Math.min(1, this.slow.t / this.slow.dur); dt *= .28 + .72 * k * k; if (k >= 1) this.slow = null;
    }
    this.clock += dt * 1000;
    this.runTimers();
    const me = this.me, S = this.spec || levelSpec(1), r = this.rally;
    // 이동 속도: 발 센서가 켜져 있으면 발을 움직여야 달린다
    let target = 3.2;
    const useFeet = this.opts.motion && this.sensors.hasMotion;
    const feet = useFeet ? (this.sensors.active ? 1 : 0.3) : 1;
    if (r && r.kind === 'scan' && ['scanSet', 'scan', 'decide'].includes(this.phase)) target = 1.5; // 공을 주고받는 동안 천천히
    else if (this.M?.tutorial && !this.swipeMode()) target = 1.0; // 따라 하기 패스는 천천히 (수비수가 화면에서 빠지지 않게)
    else if (this.mode === 'challenge' && ['build', 'decide', 'resolve'].includes(this.phase)) {
      const left = Math.max(1, (this.attackSize - this.rallyIdx));
      target = me.z <= SHOT_Z + 3 ? 0.8 : clamp((me.z - SHOT_Z) / (left * 6), 1.2, 4.6);
    } else if (this.phase === 'shotRun') target = clamp((me.z - SPOT_Z) * 1.4, 1.2, 7);
    else if (this.phase === 'shotSet' || this.phase === 'shotDecide') target = 0.3; // 골대 10m 앞에서 거의 멈춰 골키퍼를 본다
    else if (this.phase === 'shotResolve') target = 0.15;
    else if (this.mode === 'mot') target = 0.6;
    else if (this.phase === 'countdown' || this.phase === 'turnover' || this.phase === 'over') target = 0.6;
    if (this.mode !== 'challenge' && this.me.z < SHOT_Z + 8 && !this.swipeMode()) target = Math.min(target, 1); // 훈련장 패스 연습은 골대 앞에서 천천히 (슛 장면은 제외)
    if (this.burst > 0) { target += 3.5 * this.burst; this.burst = Math.max(0, this.burst - dt * 1.2); } // 돌파 순간 가속
    target *= feet;
    me.v += (target - me.v) * Math.min(1, dt * 2.5);
    if (this.phase === 'shotResolve' || (this.mode === 'mot')) me.v = Math.min(me.v, 1);
    me.z = Math.max(-PITCH.HL + 8.8, me.z - me.v * dt);
    // 옆으로 제치기 (돌파): 약 2.3m 옆으로 빠진다
    if (me.sideT > 0) { me.sideT = Math.max(0, me.sideT - dt * 1.4); me.x += me.side * Math.sin(me.sideT * Math.PI) * dt * 5.2; }
    else me.x += (0 - me.x) * Math.min(1, dt * .6);
    this.world.rig.position.set(me.x, 0, me.z);
    me.bobPhase += me.v * dt * 2.3;
    const bobAmt = Math.min(1, me.v / 3.5);
    this.world.bob.position.set(Math.sin(me.bobPhase) * .018 * bobAmt, Math.abs(Math.sin(me.bobPhase)) * .035 * bobAmt, 0);
    this.world.bob.rotation.z = Math.sin(me.bobPhase) * .008 * bobAmt;

    // 둘러보기 (자이로 / 드래그 / 키보드)
    const L = this.look; let yaw;
    if (L.hold != null) yaw = L.hold; // 둘러보기: 화면 한쪽을 꾹 누르는 동안 그쪽 친구를 본다
    else if (this.opts.gyro && this.sensors.hasOrient) yaw = clamp(this.sensors.yaw, -1.9, 1.9);
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

    // 둘러보기 패스: 무엇을 언제 봤는지 기록하고, 수비 위치를 잡는다
    if (r && r.kind === 'scan' && r.scan) this.scanUpdate(r);
    if (r && r.kind === 'shot' && this.phase === 'shotDecide') this.keeperUpdate(r);

    // 동료·수비 이동
    for (const m of this.mates) {
      if (!m.group.visible || !m.rel) continue;
      if (this.ballState === 'held' && this.holder === m) { m.moveTo(m.pos.x, m.pos.z - me.v * .3, 2); continue; }
      const tx = me.x + m.rel.x + Math.sin(this.clock / 900 + m.number) * .8, tz = me.z + m.rel.z;
      m.moveTo(tx, tz, Math.hypot(tx - m.pos.x, tz - m.pos.z) > 4 ? Math.max(8.5, me.v + 3) : me.v + 3); // 멀리 떨어졌으면 빨리 자리로
    }
    const p = this.presser;
    if (p && p.group.visible && this.ballState !== 'held') {
      if (this.phase === 'build') p.moveTo(me.x + Math.sin(this.clock / 700) * .35, me.z - 10, me.v + 1.5);
      else if (this.phase === 'decide') p.moveTo(me.x, me.z - 1.3, (this.pressSpeed || 3) + me.v);
      p.face = new THREE.Vector3(me.x, 0, me.z);
    }
    for (const pl of [...this.mates, ...this.defs, this.keeper]) pl.update(dt);
    this.keeper.face && this.keeper.face.set(this.ball.position.x, 0, this.ball.position.z);
    this.updateBall(dt);

    // HUD
    if (r && (this.phase === 'decide' || this.phase === 'shotDecide') && r.onsetReal) this.ui.timer(1 - (performance.now() - r.onsetReal) / r.windowMs);
    else if (r && this.phase === 'scan' && r.scan.startAt != null) this.ui.timer(1 - (this.clock - r.scan.startAt) / r.scan.scanMs); // 공이 돌아올 때까지
    this.ui.feet(useFeet ? clamp(this.sensors.cadence / 150, 0, 1) : null);
  }

  // ---------- 타이틀 화면 연출 ----------
  cinematic(dt, t) {
    const w = this.world;
    if (!this._cine) {
      this._cine = true; w.setTimeOfDay('day');
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
      if (this.teaching) return; // 새 기술 카드를 보는 중이면 카드의 '해 볼게요!'로만 이어 간다
      this.paused = false; const d = performance.now() - this.pausedAt;
      if (this.rally?.onsetReal) this.rally.onsetReal += d;
      if (this.motAskAt) this.motAskAt += d;
    }
  }

  quit() {
    this.phase = 'idle'; this.timers = []; this.paused = false; this.rally = null; this.slow = null; this.burst = 0;
    this.world.setZoom(1, true);
    this.ui.hud(false); this.ui.motHide(); this.ui.edges(false); this.ui.timer(null); this.ui.blind(false); this.ui.tut(null);
    this.ui.scanChips(null); this.ui.teach(null); this.teaching = false; this.look.hold = null;
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
      // 스캔: 둘러본 횟수 + (둘러보기 패스가 있었다면) 보고 맞힌 비율
      scan: s.scanTotal ? clamp(s.scans / Math.max(.5, dur / 60) / 18, 0, 1) * .4 + Math.max(0, s.scanOk - s.unseen) / s.scanTotal * .6
        : clamp(s.scans / Math.max(.5, dur / 60) / 18, 0, 1),
      brake: s.whistleTotal ? s.whistleOk / s.whistleTotal : null,
    };
    const W = { judge: .32, speed: .2, vision: .18, call: .1, scan: .1, brake: .1 };
    let num = 0, den = 0; for (const k in W) if (axes[k] != null) { num += axes[k] * W[k]; den += W[k]; }
    const bi = Math.round(clamp(den ? num / den : 0, 0, 1) * 100);
    return {
      mode: this.mode, title: this.M.title, ranked: !!this.M.ranked, score: Math.round(this.score), level: this.level,
      accuracy: Math.round(acc * 100), avgRt, decisions: s.decisions, correct: s.correct, calls: s.calls, callChances: s.callChances,
      goals: s.goals, shots: s.shots, scans: s.scans, scanPerMin: Math.round(s.scans / (dur / 60) * 10) / 10, minFlash: s.minFlash,
      whistle: [s.whistleOk, s.whistleTotal], both: [s.bothOk, s.bothTotal], scanRound: [s.scanOk, s.scanTotal], unseen: s.unseen,
      mot: [s.motOk, s.motTotal], steps, stepsPerMin: Math.round(steps / (dur / 60)), duration: Math.round(dur),
      axes, brainIndex: bi, voiceOn: !!this.opts.voice, feetOn: !!(this.opts.motion && this.sensors.hasMotion),
    };
  }
}
