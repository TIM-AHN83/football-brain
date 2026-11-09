// 기기 안 저장 (닉네임·설정·내 기록). 개인정보는 저장하지 않는다.
const P = 'fb1_';
export const store = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } },
};
export function deviceId() {
  let id = store.get('device', null);
  if (!id) {
    const a = new Uint8Array(12); (crypto.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256));
    id = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    store.set('device', id);
  }
  return id;
}
export const AGE_LABEL = { u8: 'U-8', u10: 'U-10', u12: 'U-12', u15: 'U-15', open: '일반' };
export function getProfile() { return store.get('profile', null); }
export function setProfile(p) { store.set('profile', p); }
export function getSettings() {
  return Object.assign({ quality: 'auto', sound: 'on', tap: 280, voice: true, motion: true, gyro: true, dlevel: 1 }, store.get('settings', {}));
}
export function setSettings(s) { store.set('settings', s); }
export function addHistory(sum) {
  const h = store.get('history', []);
  h.unshift({ t: Date.now(), mode: sum.mode, score: sum.score, level: sum.level, accuracy: sum.accuracy, avgRt: sum.avgRt, bi: sum.brainIndex });
  store.set('history', h.slice(0, 40));
  if (sum.mode === 'challenge') {
    const best = store.get('best', null);
    if (!best || sum.score > best.score) { store.set('best', { score: sum.score, level: sum.level, bi: sum.brainIndex, t: Date.now() }); return true; }
  }
  return false;
}
