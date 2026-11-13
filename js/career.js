// 선수 성장 (2.0): 경험치·선수 레벨·칭호 · 오늘의 미션 3개 · 배지 12개 · 연속 출석 · 유니폼 색 해금 · 이어 하기
// 모두 이 기기에 저장한다(fb1_career). 서버·랭킹은 건드리지 않는다.
import { store } from './store.js';

export const xpNeed = (lv) => 100 + 60 * (lv - 1); // 레벨 lv → lv+1 에 필요한 경험치
const TITLES = [[1, '루키'], [3, '유망주'], [5, '주전'], [8, '에이스'], [11, '캡틴'], [15, '레전드']];
export function titleOf(lv) { let t = TITLES[0][1]; for (const [l, n] of TITLES) if (lv >= l) t = n; return t; }

// 우리 편 유니폼 (빨강 = 수비, 보라 = 골키퍼와 헷갈리지 않는 색만). 발밑 링·배지는 늘 금색 = 우리 편
const base = { trim: '#16264a', num: '#16264a', numStroke: '#fff1c4', shorts: '#16264a', boots: '#141414', ring: '#ffc93c' };
export const KITS = [
  { id: 'gold', lv: 1, name: '노랑', kit: { ...base, shirt: '#ffc93c', socks: '#ffc93c' } },
  { id: 'sky', lv: 3, name: '하늘', kit: { ...base, shirt: '#49b6ff', trim: '#ffffff', num: '#ffffff', numStroke: '#0b3a66', shorts: '#ffffff', socks: '#49b6ff' } },
  { id: 'white', lv: 6, name: '하양', kit: { ...base, shirt: '#f2f4f8', socks: '#f2f4f8', numStroke: '#c9d3ea' } },
  { id: 'black', lv: 9, name: '검정·금', kit: { ...base, shirt: '#1d2027', trim: '#ffc93c', num: '#ffc93c', numStroke: '#3a2a00', shorts: '#1d2027', socks: '#1d2027', boots: '#ffc93c' } },
];

// 오늘의 미션: 첫째는 늘 쉬운 '챌린지 2판', 나머지 둘은 날짜로 정해진다(하루 동안 같음). minLv = 챌린지 최고 레벨이 이만큼은 돼야 나온다
export const MISSIONS = {
  plays2:  { t: '챌린지 2판 하기', need: 2, xp: 30, get: s => s.mode === 'challenge' ? 1 : 0 },
  goals3:  { t: '골 3번 넣기', need: 3, xp: 40, get: s => s.goals || 0 },
  fwd4:    { t: '↑ 전진 패스 4번', need: 4, xp: 40, get: s => s.fwdPasses || 0, minLv: 2 },
  scan3:   { t: '👀 둘러보고 패스 3번', need: 3, xp: 45, get: s => s.scanSeen || 0, minLv: 3 },
  wrong1:  { t: '골키퍼 역동작 골 1번', need: 1, xp: 45, get: s => s.wrongfoot || 0 },
  fast1:   { t: '⚡ 역습 찬스 1번', need: 1, xp: 50, get: s => s.fastAttacks || 0, minLv: 2 },
  level4:  { t: '한 판에 레벨 4까지', need: 4, xp: 50, get: s => s.mode === 'challenge' ? s.level : 0, max: true, minLv: 2 },
  streak6: { t: '연속 정답 6번', need: 6, xp: 40, get: s => s.bestStreak || 0, max: true },
  drill1:  { t: '훈련장 1번 끝내기', need: 1, xp: 30, get: s => s.mode !== 'challenge' ? 1 : 0 },
};

export const BADGES = [
  { id: 'goal1', ico: '🥅', name: '첫 골', how: '챌린지에서 골' },
  { id: 'fwd10', ico: '⬆️', name: '전진 패스 10', how: '↑ 전진 패스 모두 10번' },
  { id: 'scan10', ico: '👀', name: '둘러보기 10', how: '둘러보고 패스 모두 10번' },
  { id: 'wrong1', ico: '🧠', name: '골키퍼 속이기', how: '기울 때 반대로 골' },
  { id: 'fast1', ico: '⚡', name: '역습', how: '역습 찬스 만들기' },
  { id: 'lv3', ico: '🥉', name: '레벨 3', how: '챌린지 레벨 3' },
  { id: 'lv5', ico: '🥈', name: '레벨 5', how: '챌린지 레벨 5' },
  { id: 'lv8', ico: '🥇', name: '레벨 8', how: '챌린지 레벨 8' },
  { id: 'streak15', ico: '💯', name: '15연속 정답', how: '한 판에 연속 15번 정답' },
  { id: 'drills', ico: '🏋️', name: '훈련장 완주', how: '훈련장 5종 모두 끝내기' },
  { id: 'day3', ico: '🔥', name: '3일 연속', how: '3일 연속 플레이' },
  { id: 'day7', ico: '🏆', name: '7일 연속', how: '7일 연속 플레이' },
];
const DRILLS = ['flash', 'scan', 'mot', 'shoot', 'brake'];

const pad = (n) => String(n).padStart(2, '0');
export function dayKey(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function seeded(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; }

export function load() {
  const c = store.get('career', null) || {};
  return {
    xp: c.xp || 0, lv: c.lv || 1, maxLv: c.maxLv || (store.get('best', null)?.level || 0),
    tot: Object.assign({ plays: 0, goals: 0, fwd: 0, scan: 0, wrong: 0, fast: 0 }, c.tot),
    badges: c.badges || [], drills: c.drills || [], days: c.days || { last: null, streak: 0 },
    mis: c.mis || null, kit: c.kit || 'gold', cont: c.cont ?? true,
  };
}
function save(c) { store.set('career', c); }

// 오늘의 미션 (없거나 날짜가 바뀌면 새로 고른다)
export function todayMissions(c = load()) {
  const today = dayKey();
  if (c.mis && c.mis.date === today) return c.mis;
  const rand = seeded('fb-' + today), pool = Object.keys(MISSIONS).filter(id => id !== 'plays2' && (MISSIONS[id].minLv || 0) <= Math.max(1, c.maxLv));
  const ids = ['plays2'];
  while (ids.length < 3 && pool.length) ids.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  c.mis = { date: today, ids, prog: {}, done: [] }; save(c);
  return c.mis;
}
export function streakNow(c = load()) { return c.days.last === dayKey() || c.days.last === dayKey(-1) ? c.days.streak : 0; }
export function kitOf(c = load()) { const k = KITS.find(k => k.id === c.kit && c.lv >= k.lv) || KITS[0]; return k; }
export function setKitChoice(id) { const c = load(); const k = KITS.find(k => k.id === id); if (!k || c.lv < k.lv) return false; c.kit = id; save(c); return true; }
export function startLevelFor(c = load()) { return c.maxLv >= 4 ? c.maxLv - 2 : 1; } // 이어 하기: 최고 레벨 −2 (LV4 이상 해 본 사람)
export function setCont(on) { const c = load(); c.cont = !!on; save(c); }

// 한 판이 끝나면: 연속 출석 · 미션 · 누적 기록 · 배지 · 경험치. 결과 화면에 보여 줄 것을 돌려준다
export function applyRun(sum) {
  const c = load(), lv0 = c.lv, today = dayKey();
  if (c.days.last !== today) { c.days.streak = c.days.last === dayKey(-1) ? c.days.streak + 1 : 1; c.days.last = today; }
  const m = todayMissions(c), doneNow = [];
  for (const id of m.ids) {
    if (m.done.includes(id)) continue;
    const M = MISSIONS[id], v = M.get(sum) || 0;
    m.prog[id] = M.max ? Math.max(m.prog[id] || 0, v) : (m.prog[id] || 0) + v;
    if (m.prog[id] >= M.need) { m.done.push(id); doneNow.push(id); }
  }
  const T = c.tot;
  if (sum.mode === 'challenge') { T.plays++; c.maxLv = Math.max(c.maxLv, sum.level); }
  T.goals += sum.mode === 'challenge' ? (sum.goals || 0) : 0; T.fwd += sum.fwdPasses || 0; T.scan += sum.scanSeen || 0;
  T.wrong += sum.wrongfoot || 0; T.fast += sum.fastAttacks || 0;
  if (DRILLS.includes(sum.mode) && !c.drills.includes(sum.mode)) c.drills.push(sum.mode);
  const has = (id) => c.badges.includes(id), newBadges = [];
  const earn = (id, ok) => { if (ok && !has(id)) { c.badges.push(id); newBadges.push(id); } };
  earn('goal1', T.goals >= 1); earn('fwd10', T.fwd >= 10); earn('scan10', T.scan >= 10); earn('wrong1', T.wrong >= 1); earn('fast1', T.fast >= 1);
  earn('lv3', c.maxLv >= 3); earn('lv5', c.maxLv >= 5); earn('lv8', c.maxLv >= 8); earn('streak15', (sum.bestStreak || 0) >= 15);
  earn('drills', DRILLS.every(d => c.drills.includes(d))); earn('day3', c.days.streak >= 3); earn('day7', c.days.streak >= 7);
  // 경험치 = 점수 ÷ 40 (훈련장은 한 판 최대 100 — 챌린지가 중심) + 미션 보상
  const base = Math.min(sum.mode === 'challenge' ? 1e9 : 100, Math.max(0, Math.round((sum.score || 0) / 40))), misXp = doneNow.reduce((a, id) => a + MISSIONS[id].xp, 0), gain = base + misXp;
  c.xp += gain;
  while (c.xp >= xpNeed(c.lv)) { c.xp -= xpNeed(c.lv); c.lv++; }
  const kitsNew = KITS.filter(k => k.lv > lv0 && k.lv <= c.lv);
  save(c);
  return { gain, base, misXp, lv0, lv: c.lv, xp: c.xp, need: xpNeed(c.lv), title: titleOf(c.lv), doneNow, newBadges, kitsNew, streak: c.days.streak, mis: m };
}
