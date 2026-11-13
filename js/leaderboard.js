// 온라인 랭킹 (Supabase 함수 fb_config / fb_submit / fb_top)과 클럽 대항전 (fb_club_*, supabase/fb_clubs.sql).
// 연결이 안 되면 기기 안 기록만 보여준다.
import { CONFIG } from './config.js';

async function rpc(fn, body, ms = 7000) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${CONFIG.supabase.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', signal: ctl.signal,
      headers: { apikey: CONFIG.supabase.key, Authorization: `Bearer ${CONFIG.supabase.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) { const e = new Error('http'); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(tm); }
}
const why = (e) => (e && (e.status === 404 || e.status === 400)) ? 'not_ready' : 'network';

export const Board = {
  state: 'unknown', requireCode: false,
  async init() {
    try { const c = await rpc('fb_config', {}, 5000); this.state = 'online'; this.requireCode = !!(c && c.require_code); }
    catch (e) { this.state = why(e); }
    return this.state;
  },
  async submit(entry) {
    try { const res = await rpc('fb_submit', { p: entry }); return res || { ok: false, error: 'network' }; }
    catch (e) { return { ok: false, error: why(e) }; }
  },
  async top(period = 'week', age = 'all') {
    try { const rows = await rpc('fb_top', { p_period: period, p_age: age, p_limit: 50 }); this.state = 'online'; return { ok: true, rows }; }
    catch (e) { return { ok: false, error: why(e) }; }
  },
  // ---------- 클럽 대항전 ----------
  async call(fn, body) {
    try { return (await rpc(fn, body)) || { ok: false, error: 'network' }; }
    catch (e) { return { ok: false, error: why(e) }; }
  },
  // 시범 운영 익명 통계 (2.3, supabase/fb_stats.sql): 랭킹과 다른 무작위 번호(statId)로만 보낸다. 실패해도 게임에는 영향 없음
  log(kind, data, statId, version) {
    rpc('fb_log', { p: { device: statId, kind, data: data || {}, v: version || '' } }, 5000).catch(() => {});
  },
  clubCreate(name, device, nick) { return this.call('fb_club_create', { p: { name, device, nick } }); },
  clubJoin(code, device, nick) { return this.call('fb_club_join', { p: { code, device, nick } }); },
  clubLeave(device) { return this.call('fb_club_leave', { p: { device } }); },
  clubInfo(code, device) { return this.call('fb_club_info', { p_code: code, p_device: device }); },
  async clubTop(period = 'week') {
    try { const rows = await rpc('fb_club_top', { p_period: period, p_limit: 50 }); return { ok: true, rows }; }
    catch (e) { return { ok: false, error: why(e) }; }
  },
};
