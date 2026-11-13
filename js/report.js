// 부모 리포트 (2.3): 이 기기의 기록으로 최근 7일과 그 전 7일을 비교한다. 서버로 보내지 않는다.
import { AXES, TIPS } from './ui.js';

const D = 864e5;
const LADDER = [[2, '↑ 전진 패스'], [3, '둘러보기'], [4, '기억으로 패스'], [5, '드리블 돌파'], [6, '수비 이동'], [7, '2대1 벽 패스'], [9, '스루패스 타이밍']];
const avg = (a, f) => { const v = a.map(f).filter(x => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

export function weeklyReport(history, maxLv, now = Date.now()) {
  const cur = history.filter(h => h.t >= now - 7 * D && h.mode !== 'tutorial'), prev = history.filter(h => h.t >= now - 14 * D && h.t < now - 7 * D && h.mode !== 'tutorial');
  const days = new Set(cur.map(h => new Date(h.t).toDateString())).size;
  const minutes = Math.max(cur.length ? 1 : 0, Math.round(cur.reduce((s, h) => s + (h.dur || 120), 0) / 60));
  const pick = (a) => ({
    bi: avg(a, h => h.bi), acc: avg(a, h => h.accuracy), rt: avg(a.filter(h => h.avgRt > 0), h => h.avgRt),
    ax: Object.fromEntries(AXES.map(([k]) => [k, avg(a.filter(h => h.ax && h.ax[k] != null), h => h.ax[k])])),
  });
  const c = pick(cur), p = pick(prev);
  // 많이 는 능력 (지난주보다) · 더 연습할 능력 (이번 주 가장 낮은 것, 음성 콜·휘슬처럼 안 쓴 건 빼고)
  let up = null, weak = null;
  for (const [k, label] of AXES) {
    const a = c.ax[k], b = p.ax[k];
    if (a != null && b != null && (!up || a - b > up.d)) up = { k, label, d: a - b };
    if (a != null && (!weak || a < weak.v)) weak = { k, label, v: a };
  }
  if (up && up.d < .03) up = null;
  const next = LADDER.find(([l]) => l > (maxLv || 1));
  return {
    games: cur.length, gamesPrev: prev.length, days, minutes, cur: c, prev: p, up, weak,
    tip: TIPS[weak?.k] || TIPS.judge, next: next ? { lv: next[0], name: next[1] } : null,
    challenge: cur.filter(h => h.mode === 'challenge').length, best: cur.reduce((m, h) => Math.max(m, h.mode === 'challenge' ? h.score : 0), 0),
  };
}

// 카카오톡 등으로 보낼 리포트 그림 (1080×1350)
export async function reportCard(r, nick) {
  const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#16264a'); bg.addColorStop(1, '#0b1428'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffc93c'; g.fillRect(80, 90, 12, 120);
  g.fillStyle = '#f4f6fb'; g.font = '400 70px "Black Han Sans",sans-serif'; g.fillText('축구 두뇌 훈련', 120, 150);
  g.fillStyle = '#a9b6d3'; g.font = '700 40px "Noto Sans KR",sans-serif'; g.fillText(`${nick || '우리 아이'} · 이번 주 부모 리포트`, 122, 205);
  const line = (y, k, v, col = '#f4f6fb') => { g.fillStyle = '#a9b6d3'; g.font = '700 38px "Noto Sans KR",sans-serif'; g.fillText(k, 120, y); g.fillStyle = col; g.font = '800 46px "Noto Sans KR",sans-serif'; g.fillText(v, 470, y); };
  const delta = (a, b, unit = '', inv = false) => a == null || b == null ? '' : (() => { const d = Math.round(a - b); if (!d) return ' (지난주와 같음)'; return ` (지난주보다 ${(inv ? -d : d) > 0 ? '+' : ''}${inv ? -d : d}${unit})`; })();
  let y = 330;
  line(y, '연습한 날', `${r.days}일 · ${r.games}판 · 약 ${r.minutes}분`); y += 90;
  line(y, '두뇌 지수', r.cur.bi != null ? `${Math.round(r.cur.bi)}${delta(r.cur.bi, r.prev.bi)}` : '–', '#ffc93c'); y += 90;
  line(y, '판단 정확도', r.cur.acc != null ? `${Math.round(r.cur.acc)}%${delta(r.cur.acc, r.prev.acc, '%')}` : '–'); y += 90;
  line(y, '반응 속도', r.cur.rt != null ? `${Math.round(r.cur.rt)}ms${r.prev.rt != null ? ` (${Math.round(r.cur.rt - r.prev.rt) <= 0 ? '빨라짐 ' : '느려짐 '}${Math.abs(Math.round(r.cur.rt - r.prev.rt))}ms)` : ''}` : '–'); y += 90;
  line(y, '많이 는 능력', r.up ? `${r.up.label} +${Math.round(r.up.d * 100)}` : '다음 주에 비교해요', '#38d27a'); y += 90;
  line(y, '더 연습할 능력', r.weak ? r.weak.label : '–', '#ff8a7a'); y += 110;
  g.fillStyle = 'rgba(255,201,60,.12)'; g.fillRect(80, y - 60, 920, 260); g.fillStyle = '#ffc93c'; g.font = '800 38px "Noto Sans KR",sans-serif'; g.fillText('운동장에서 해 볼 한 가지', 120, y);
  g.fillStyle = '#f4f6fb'; g.font = '700 36px "Noto Sans KR",sans-serif';
  const words = r.tip.replace(/^운동장에서:\s*/, '').split(' '); let ln = '', ly = y + 60;
  for (const w of words) { if (g.measureText(ln + w).width > 840) { g.fillText(ln, 120, ly); ly += 52; ln = ''; } ln += w + ' '; }
  g.fillText(ln, 120, ly);
  g.fillStyle = '#a9b6d3'; g.font = '700 32px "Noto Sans KR",sans-serif';
  g.fillText('하루 10~15분, 주 3~4일이면 충분해요.', 120, 1200); g.fillText('@halftime.parenttalk · 하프타임 부모 상담소', 120, 1260);
  return await new Promise(res => cv.toBlob(res, 'image/png'));
}
