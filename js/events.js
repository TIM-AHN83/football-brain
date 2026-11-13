// 주간 이벤트 (2.1): 매주 월요일 0시(한국 시간)에 바뀐다. 랭킹 주간과 같은 주.
// 그 주에는 모두에게 같은 보너스가 붙어 랭킹은 공평하다. 클럽 팀 점수에도 그대로 들어간다.
export const EVENTS = [
  { id: 'fwd', ico: '⬆️', name: '전진 패스 주간', desc: '↑ 전진 패스 보너스 2배', mission: { t: '이번 주 ↑ 전진 패스 25번', need: 25, get: s => s.fwdPasses || 0 } },
  { id: 'scan', ico: '👀', name: '둘러보기 주간', desc: '양쪽 다 보고 패스 보너스 2배', mission: { t: '이번 주 둘러보고 패스 15번', need: 15, get: s => s.scanSeen || 0 } },
  { id: 'fast', ico: '⚡', name: '역습 주간', desc: '역습 골 보너스 2배', mission: { t: '이번 주 ⚡ 역습 찬스 6번', need: 6, get: s => s.fastAttacks || 0 } },
  { id: 'keeper', ico: '🧠', name: '골키퍼 속이기 주간', desc: '역동작 골 보너스 2배', mission: { t: '이번 주 역동작 골 8번', need: 8, get: s => s.wrongfoot || 0 } },
];
export const WEEKLY_XP = 150;

export function weekInfo(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600e3), dow = (kst.getUTCDay() + 6) % 7; // 0 = 월요일
  const mon = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - dow);
  const idx = Math.floor(mon / (7 * 864e5)), ev = EVENTS[((idx % EVENTS.length) + EVENTS.length) % EVENTS.length];
  return { key: new Date(mon).toISOString().slice(0, 10), ev, daysLeft: 7 - dow };
}
