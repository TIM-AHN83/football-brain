// 기기 점검 (2.3): 설정의 '기기 점검' 또는 주소 끝 ?check
// (1) 기기·로딩 정보 (2) 20초 동안 실제 속도로 자동 플레이 → 화면 초당 장면 수(FPS) (3) 규칙 점검(자동 회귀 시험 24가지, 2.5에서 1:1 대결 2가지 추가)
// 점검 중 바뀐 기기 저장값(기록·성장·연습)은 끝나면 그대로 되돌린다. 랭킹에는 올리지 않는다.
import { store } from './store.js';
import { CONFIG } from './config.js';
import { applyRun } from './career.js';
import { weeklyReport } from './report.js';
import { duelState } from './duel.js';

const P = 'fb1_';
function snapshot() { const s = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(P)) s[k] = localStorage.getItem(k); } return s; }
function restore(s) {
  try {
    const now = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(P)) now.push(k); }
    now.forEach(k => { if (!(k in s)) localStorage.removeItem(k); });
    for (const k in s) localStorage.setItem(k, s[k]);
  } catch (e) { /* 저장 불가 */ }
}

export function deviceInfo(world) {
  let gpu = '';
  try { const gl = world.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { gpu = '?'; }
  const nav = performance.getEntriesByType('navigation')[0];
  const kb = Math.round(performance.getEntriesByType('resource').reduce((s, e) => s + (e.transferSize || 0), 0) / 1024) + Math.round((nav?.transferSize || 0) / 1024);
  const ua = navigator.userAgent, os = /Android [\d.]+/.exec(ua)?.[0] || /iPhone OS [\d_]+/.exec(ua)?.[0]?.replace(/_/g, '.') || /Windows NT [\d.]+|Mac OS X [\d_]+/.exec(ua)?.[0] || '?';
  const br = /SamsungBrowser\/[\d.]+|CriOS\/[\d.]+|Chrome\/[\d.]+|Version\/[\d.]+ Mobile\/\w+ Safari|Firefox\/[\d.]+|KAKAOTALK|Instagram/.exec(ua)?.[0] || '?';
  return {
    os, browser: br, gpu: String(gpu).slice(0, 80), cores: navigator.hardwareConcurrency || null, mem: navigator.deviceMemory || null,
    screen: `${screen.width}×${screen.height}@${(devicePixelRatio || 1).toFixed(2)}`, view: `${innerWidth}×${innerHeight}`,
    loadMs: Math.round(window.__fbTitleAt || 0), transferKB: kb, quality: world.qName, dpr: world.dpr,
  };
}

// 실제 속도 자동 플레이 (매 프레임 부른다): 정답 · 둘러보기 꾹 · 2대1 원 · 스루패스 타이밍 · 기울 때 반대 구석 슛
export function autoBot(g) {
  return () => {
    const r = g.rally; if (!r) return;
    if (g.phase === 'teach') document.querySelector('#teach-go')?.click();
    if (g.phase === 'scan' && r.scan && r.scan.startAt != null) { const t = g.clock - r.scan.startAt; g.holdLook(t < 300 ? null : t < 1000 ? 'L' : t < 1700 ? 'R' : null); }
    if (g.phase === 'decide' && !r._bot) {
      let go = g.clock - r.onsetAt > 380;
      if (r.kind === 'wall') go = Math.hypot(g.presser.pos.x - g.me.x, g.presser.pos.z - g.me.z) < 3.6;
      if (r.kind === 'thru') go = r.running && g.clock - r.runAt > 200;
      if (r.answer === 'none') go = false;
      if (go) { r._bot = true; g.onInput(r.answer, performance.now()); }
    }
    if (r.kind === 'shot' && g.phase === 'shotDecide' && !r._bot) {
      const lean = g.keeperLean(), el = g.clock - (r._t0 ??= g.clock);
      if (lean || el > r.windowMs * .6) { r._bot = true; g.onSwipe({ key: lean < 0 ? 'R' : 'L', t: performance.now() }); }
    }
  };
}

// 20초 동안 실제 속도로 플레이하며 프레임 간격을 잰다
export function measureFps(seconds, onTick) {
  return new Promise(res => {
    const gaps = []; let last = performance.now(), done = false; const start = last, end = last + seconds * 1000;
    const finish = (stalled) => {
      if (done) return; done = true;
      const g = gaps.slice(5).sort((a, b) => a - b), avg = g.length ? g.reduce((s, x) => s + x, 0) / g.length : 0;
      res({ fps: avg ? Math.round(1000 / avg) : 0, low: avg ? Math.round(1000 / (g[Math.floor(g.length * .99)] || avg)) : 0, frames: g.length, hidden: document.hidden || stalled });
    };
    const f = (now) => {
      if (done) return;
      gaps.push(now - last); last = now; onTick && onTick((now - start) / (seconds * 1000));
      if (now < end) requestAnimationFrame(f); else finish(false);
    };
    requestAnimationFrame(f);
    setTimeout(() => finish(true), seconds * 1000 + 4000); // 화면이 안 그려지면(다른 앱으로 갔을 때 등) 멈추지 않게
  });
}

// 규칙 점검: 게임 코드를 빠르게(1/60초씩) 돌려 정해 둔 상황마다 결과가 맞는지 본다
export function regression(game, world) {
  const out = [], ok = (name, pass, detail = '') => out.push({ name, pass: !!pass, detail });
  const step = (n = 1) => { for (let i = 0; i < n; i++) { game.update(1 / 60); world.update(1 / 60); } };
  const until = (cond, max = 60 * 20) => { for (let i = 0; i < max; i++) { if (cond()) return true; step(); } return false; };
  const dist = () => Math.hypot(game.presser.pos.x - game.me.x, game.presser.pos.z - game.me.z);
  const origPlan = game.fwdPlan.bind(game), origAngle = game.pickShotAngle.bind(game);
  const plan = (block) => (r) => { r.practice = null; r.block = block; r.fwdSide = 1; r.blockSide = -1; r.answer = block === 'both' ? 'R' : 'C'; r.ok = block === 'side' ? ['R'] : block === 'none' ? ['L', 'R'] : []; };
  const fresh = (level, kind, ready) => {
    game.quit(); game.start('challenge', { level }); game.event = null; game.forceKind = kind;
    return until(() => game.rally && game.rally.kind === kind && (ready ? ready(game.rally) : game.phase === 'decide'));
  };
  const act = (input) => { game.onInput(input, performance.now()); return game.rally; };
  const settle = (s = 3.5) => step(Math.round(60 * s));
  try {
    // 1~2 패스
    let r; fresh(1, 'pass'); r = act(game.rally.answer); ok('패스: 빈 친구 → 정답 1칸', r.correct && r.step === 1);
    fresh(1, 'pass'); r = act(game.rally.answer === 'L' ? 'R' : 'L'); settle(); ok('패스: 막힌 쪽 → 가로채기, 목숨 −1', !r.correct && game.lives === 2);
    // 3~6 전진 패스 (세 경우를 고정해서)
    game.fwdPlan = plan('side'); fresh(2, 'fwd'); r = act('C'); ok('전진: 앞길 비면 가운데 = 최고 2칸', r.correct && r.grade === 'best' && r.step === 2);
    game.fwdPlan = plan('side'); fresh(2, 'fwd'); r = act('R'); ok('전진: 빈 옆 = 괜찮음 1칸', r.correct && r.grade === 'ok' && r.step === 1);
    game.fwdPlan = plan('side'); fresh(2, 'fwd'); r = act('L'); ok('전진: 막힌 옆 → 가로채기', !r.correct);
    game.fwdPlan = plan('both'); fresh(2, 'fwd'); r = act('C'); const m1 = !r.correct;
    game.fwdPlan = plan('both'); fresh(2, 'fwd'); r = act('R'); ok('전진: 앞길 막히면 빈 옆이 최고', m1 && r.correct && r.grade === 'best');
    game.fwdPlan = origPlan;
    let best = 0; for (let i = 0; i < 3000; i++) { const x = { practice: null }; origPlan(x); if (['L', 'C', 'R'][Math.floor(Math.random() * 3)] === x.answer) best++; }
    ok('찍기 방지: 무작위 최고 선택 28~38%', best / 3000 > .28 && best / 3000 < .38, `${Math.round(best / 30)}%`);
    // 7 둘러보기 (양쪽 다 보기)
    fresh(3, 'scan', (r) => game.phase === 'scan' && r.scan.startAt != null);
    for (const z of ['L', 'R']) { game.holdLook(z); step(45); } game.holdLook(null);
    until(() => game.phase === 'decide'); r = act(game.rally.answer); ok('둘러보기: 양쪽 보고 ✔ 쪽 → 2칸', r.correct && r.step === 2);
    // 8 돌파
    fresh(5, 'both'); r = act('C'); ok('돌파: 양쪽 막힘 → 가운데 2칸', r.correct && r.step === 2);
    // 9~10 2대1
    fresh(7, 'wall'); r = act(game.rally.answer); ok('2대1: 너무 빨리 → 실패', !r.correct && r.early);
    fresh(7, 'wall', () => game.phase === 'decide' && dist() < 3.6); r = act(game.rally.answer); ok('2대1: 원 안에서 → 2칸', r.correct && r.step === 2, `${dist().toFixed(1)}m`);
    // 11~13 스루패스
    fresh(9, 'thru'); r = act('C'); ok('스루패스: 뛰기 전 → 실패', !r.correct && r.early);
    fresh(9, 'thru', (r) => r.running && game.clock - r.runAt > 150); r = act('C'); ok('스루패스: 뛰는 순간 → 2칸', r.correct && r.grade === 'best' && r.step === 2);
    fresh(9, 'thru'); r = act('L'); ok('스루패스: 옆 = 안전 1칸', r.correct && r.grade === 'ok');
    // 14~15 슛 (정면 · 사선): 기울 때 반대 구석
    for (const a of [0, -1]) {
      game.pickShotAngle = () => a; game.quit(); game.start('shoot', { level: 3 }); game.event = null;
      let goals = 0;
      for (let n = 0; n < 3; n++) {
        until(() => game.phase === 'shotDecide', 60 * 15); const sr = game.rally;
        until(() => game.keeperLean() || game.clock - (sr._t0 ??= game.clock) > sr.windowMs * .6, 60 * 6);
        game.onSwipe({ key: game.keeperLean() < 0 ? 'R' : 'L', t: performance.now() }); settle(1.8);
        if (sr.shot && (sr.shot.out === 'goal' || sr.shot.out === 'postIn')) goals++;
        until(() => game.phase === 'shotRun' || game.phase === 'shotSet' || game.phase === 'over', 60 * 6);
      }
      ok(`슛(${a ? '사선' : '정면'}): 기울 때 반대 구석 → 골`, goals >= 2, `${goals}/3`);
    }
    game.pickShotAngle = origAngle;
    // 16 공격 칸 → 슛
    game.quit(); game.start('challenge', { level: 1 }); game.event = null;
    for (let n = 0; n < 3; n++) { until(() => game.phase === 'decide'); act(game.rally.answer); until(() => game.phase !== 'resolve', 60 * 6); }
    until(() => game.phase && game.phase.startsWith('shot'), 60 * 8);
    ok('공격 칸 3칸 → 1:1 슛', game.phase && game.phase.startsWith('shot'));
    // 2.4 골키퍼 속임수 · 역습 찬스 조건 · 훈련장 2대1
    game.quit(); game.start('shoot', { level: 9 }); game.event = null; until(() => game.phase === 'shotDecide', 60 * 15);
    game.keeper.anim = null; game.keeper.shift(1, .28, .5); game.keeper.anim.fake = true; step(12);
    ok('골키퍼 속임수: 작은 기울기는 역동작이 아님', game.keeperLean() === 0 && game.keeperFake() === 1);
    const fastWith = (okN) => { game.quit(); game.start('challenge', { level: 4 }); game.event = null; until(() => game.phase === 'build'); game.rallyN = 2; game.atk = { rts: [.2, .25], ok: okN }; game.shotRun(); return game.fastShot; };
    ok('역습 찬스: 옆으로 돌리면 없음 · 빠르고 앞으로면 있음', !fastWith(1) && fastWith(0));
    game.quit(); game.start('wall', { level: 1 }); game.event = null;
    until(() => game.rally && game.rally.kind === 'wall' && game.phase === 'decide' && dist() < 3.6, 60 * 25);
    r = act(game.rally?.answer); ok('훈련장 2대1: 원 안에서 → 성공', r && r.correct);
    // 2.5 1:1 대결: 같은 번호(씨앗)면 두 폰이 같은 장면 · 결과 판정
    const scenes = (seed) => {
      game.quit(); game.start('duel', { level: 7, duel: { seed, onRound() {} } }); game.event = null;
      const s = [];
      for (let a = 0; a < 3; a++) for (let n = 0; n < 3; n++) { game.round = { kind: 'atk', i: a }; game.rallyN = n; game.reseed(game.rtag() + 'r' + n); const x = game.makeRally(); s.push([x.kind, x.side, x.answer, x.block || '', Math.round(x.build)].join('/')); }
      game.round = { kind: 'atk', i: 1 }; game.reseed(game.rtag() + 's'); s.push('shot' + game.pickShotAngle());
      return s.join(' ');
    };
    const s1 = scenes('chk-a'), s2 = scenes('chk-a'), s3 = scenes('chk-b');
    ok('1:1 대결: 같은 번호면 같은 장면 · 다른 번호면 다른 장면', s1 === s2 && s1 !== s3);
    const G = (a) => a.map(g => ({ goal: !!g, pts: 100 }));
    const d1 = duelState(G([1, 0, 1, 0, 1, 0, 0, 0]), G([0, 1, 0, 1, 0, 0, 0, 0])), d2 = duelState(G([1, 0, 0, 0, 0, 0, 0, 0]), G([0, 1, 0, 0, 0, 0, 0, 0]));
    const d3 = duelState(G([1, 0, 0, 0, 0, 0, 0, 0, 1, 1]), G([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]));
    ok('1:1 대결: 3:2 승리 · 동점은 승부차기 · 승부차기 2:0이면 끝', d1.over && d1.win === 1 && !d2.over && d2.next?.kind === 'pk' && d3.over && d3.by === 'pk');
    // 성장·리포트 계산 (저장값은 끝나고 되돌린다)
    const c = applyRun({ mode: 'challenge', score: 4000, level: 4, goals: 3, fwdPasses: 4, scanSeen: 2, wrongfoot: 1, fastAttacks: 1, bestStreak: 6, axes: {} });
    const rep = weeklyReport(store.get('history', []), 4);
    ok('선수 성장·부모 리포트 계산', c.gain >= 100 && rep && typeof rep.games === 'number', `+${c.gain}XP`);
    world.render(); ok('3D 화면 그리기', world.renderer.info.render.calls > 0, `${world.renderer.info.render.calls} draw`);
  } catch (e) {
    ok('점검 중 오류', false, String(e && e.message || e).slice(0, 120));
  } finally {
    game.fwdPlan = origPlan; game.pickShotAngle = origAngle; game.quit();
  }
  return out;
}

// 전체 점검: 저장값 보관 → 연습 끝낸 상태로 → FPS → 규칙 점검 → 저장값 되돌림
export async function runCheck({ game, world, ui, setState, setBot, fast, onProgress }) {
  const snap = snapshot();
  try {
    store.set('taught', ['pass', 'fwd', 'scan', 'blind', 'both', 'switch', 'wall', 'thru', 'shot', 'whistle']);
    store.set('practice', { fwd: 2, scan: 2, blind: 2, both: 2, wall: 2, thru: 2 }); store.set('tutDone', true);
    const info = deviceInfo(world);
    let perf = null;
    if (!fast) {
      onProgress && onProgress('실제 속도로 20초 플레이하며 화면 속도를 재는 중…');
      ui.go('none'); game.endCinematic(); game.event = null; game.opts.voice = game.opts.motion = game.opts.gyro = false;
      game.start('challenge', { level: 3 }); setState('play'); setBot(autoBot(game));
      perf = await measureFps(20, (k) => onProgress && onProgress(`실제 속도로 플레이하며 화면 속도를 재는 중… ${Math.min(100, Math.round(k * 100))}%`));
      setBot(null); perf.dpr = world.dpr; perf.level = game.level;
    }
    setState('check'); onProgress && onProgress('규칙 점검 중…');
    await new Promise(r => setTimeout(r, 50));
    const t0 = performance.now(), tests = regression(game, world), ms = Math.round(performance.now() - t0);
    const sw = { k: store.get('swipeK', 1), n: store.get('swipes', []).length };
    return { version: CONFIG.version, info, perf, tests, pass: tests.filter(t => t.pass).length, total: tests.length, ms, swipe: sw };
  } finally {
    const sw = { k: localStorage.getItem(P + 'swipeK'), s: localStorage.getItem(P + 'swipes') };
    restore(snap);
    if (sw.k != null) localStorage.setItem(P + 'swipeK', sw.k); // 슛 힘 보정은 이 기기 값이라 남겨 둔다
    if (sw.s != null) localStorage.setItem(P + 'swipes', sw.s);
  }
}

export function reportText(res) {
  const i = res.info, p = res.perf;
  const lines = [
    `축구 두뇌 훈련 기기 점검 · ${res.version}`,
    `기기: ${i.os} · ${i.browser} · 화면 ${i.screen} · 코어 ${i.cores ?? '?'} · 메모리 ${i.mem ?? '?'}GB`,
    `그래픽: ${i.gpu} · 품질 ${i.quality} · 해상도 배율 ${i.dpr}`,
    `로딩: 처음 화면까지 ${(i.loadMs / 1000).toFixed(1)}초 · 받은 양 ${i.transferKB}KB`,
    p ? `화면 속도: 평균 ${p.fps}fps · 가장 느린 1% ${p.low}fps · 끝 배율 ${p.dpr}${p.hidden ? ' (화면이 가려져 있었음)' : ''}` : '화면 속도: (빠른 점검이라 건너뜀)',
    `슛 힘 보정: ×${res.swipe.k} (쓸기 ${res.swipe.n}번)`,
    `규칙 점검: ${res.pass}/${res.total} 통과 (${res.ms}ms)`,
    ...res.tests.filter(t => !t.pass).map(t => `  ✖ ${t.name} ${t.detail}`),
  ];
  return lines.join('\n');
}
