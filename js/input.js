// 화면 누르는 위치로 고르기: 왼쪽 / (가운데) / 오른쪽 + 옆으로 끌어 둘러보기 + 키보드
// 1.3.0부터 탭 횟수(한 번·두 번)·꾹 누르기 대신 누른 자리로 정한다. 반응 시간은 손가락이 닿은 순간 기준.
export const CENTER = [0.35, 0.65]; // 3칸일 때 가운데 칸 (화면 폭 비율)

export class Gestures {
  constructor(el, { onTap, onLook, onLookKey, onPause, zones }) {
    this.el = el; this.onTap = onTap; this.onLook = onLook; this.onLookKey = onLookKey; this.onPause = onPause;
    this.zones = zones || (() => 2); // 2 = 왼쪽·오른쪽 반반, 3 = 왼쪽·가운데·오른쪽
    this.dragPx = 26; this.enabled = false; this.down = null;
    el.addEventListener('pointerdown', e => this.pd(e));
    el.addEventListener('pointermove', e => this.pm(e));
    el.addEventListener('pointerup', e => this.pu(e));
    el.addEventListener('pointercancel', e => this.pu(e, true));
    el.addEventListener('contextmenu', e => e.preventDefault());
    this.keys = new Set();
    window.addEventListener('keydown', e => this.kd(e));
    window.addEventListener('keyup', e => this.ku(e));
  }
  emit(zone, t, n) { if (this.enabled) this.onTap(zone, t, n); }
  zoneAt(x) {
    const r = this.el.getBoundingClientRect(), f = (x - r.left) / Math.max(1, r.width), n = this.zones();
    return { n, zone: n === 3 ? (f < CENTER[0] ? 'L' : f > CENTER[1] ? 'R' : 'C') : (f < .5 ? 'L' : 'R') };
  }
  pd(e) {
    if (!this.enabled || this.down) return; // 한 번에 한 손가락만
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    this.down = { id: e.pointerId, x: e.clientX, t: performance.now(), drag: false, lastX: e.clientX, ...this.zoneAt(e.clientX) };
  }
  pm(e) {
    const d = this.down; if (!d || d.id !== e.pointerId) return;
    if (!d.drag && Math.abs(e.clientX - d.x) > this.dragPx) d.drag = true;
    if (d.drag) { this.onLook(e.clientX - d.lastX); d.lastX = e.clientX; }
  }
  pu(e, cancel) {
    const d = this.down; if (!d || d.id !== e.pointerId) return;
    this.down = null;
    if (cancel || d.drag) return; // 끌기는 둘러보기
    this.emit(d.zone, d.t, d.n);
  }
  kd(e) {
    if (e.repeat || !this.enabled) { if (e.key === 'Escape') this.onPause && this.onPause(); return; }
    const k = e.key.toLowerCase(), now = performance.now(), n = this.zones();
    if (k === 'arrowleft' || k === 'a') this.emit('L', now, n);
    else if (k === 'arrowright' || k === 'd') this.emit('R', now, n);
    else if (k === 'arrowup' || k === 'w' || k === ' ' || k === 'arrowdown' || k === 's') { e.preventDefault(); if (n === 3) this.emit('C', now, n); }
    else if (k === 'q' || k === 'e') { this.keys.add(k); this.onLookKey((this.keys.has('q') ? 1.3 : 0) - (this.keys.has('e') ? 1.3 : 0)); }
    else if (k === 'escape' || k === 'p') this.onPause && this.onPause();
  }
  ku(e) {
    const k = e.key.toLowerCase();
    if (k === 'q' || k === 'e') { this.keys.delete(k); this.onLookKey((this.keys.has('q') ? 1.3 : 0) - (this.keys.has('e') ? 1.3 : 0)); }
  }
  reset() { this.down = null; }
}
