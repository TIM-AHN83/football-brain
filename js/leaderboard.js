// 온라인 랭킹 (Supabase 함수 fb_config / fb_submit / fb_top). 연결이 안 되면 기기 안 기록만 보여준다.
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
};
