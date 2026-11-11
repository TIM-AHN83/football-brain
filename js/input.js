// 화면 누르는 위치로 고르기: 왼쪽 / (가운데) / 오른쪽 + 옆으로 끌어 둘러보기 + 키보드
// 1.3.0부터 탭 횟수(한 번·두 번)·꾹 누르기 대신 누른 자리로 정한다. 반응 시간은 손가락이 닿은 순간 기준.
// 1.6.0: 슛 장면(swipeMode)에서는 위로 쓸어 올리기 = 슛 (방향·빠르기를 onSwipe 로 넘긴다)
export const CENTER = [0.35, 0.65]; // 3칸일 때 가운데 칸 (화면 폭 비율)

export class Gestures {
  constructor(el, { onTap, onLook, onLookKey, onPause, zones, swipeMode, onSwipe }) {
    this.el = el; this.onTap = onTap; this.onLook = onLook; this.onLookKey = onLookKey; this.onPause = onPause;
    this.swipeMode = swipeMode || (() => false); this.onSwipe = onSwipe;
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
    this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moveT: null, drag: false, lastX: e.clientX, ...this.zoneAt(e.clientX) };
  }
  pm(e) {
    const d = this.down; if (!d || d.id !== e.pointerId) return;
    if (this.swipeMode()) { if (d.moveT == null && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moveT = performance.now(); return; } // 슛: 둘러보기 대신 쓸기
    if (!d.drag && Math.abs(e.clientX - d.x) > this.dragPx) d.drag = true;
    if (d.drag) { this.onLook(e.clientX - d.lastX); d.lastX = e.clientX; }
  }
  pu(e, cancel) {
    const d = this.down; if (!d || d.id !== e.pointerId) return;
    this.down = null;
    if (cancel) return;
    if (this.swipeMode()) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (-dy > 30) { // 위로 쓸어 올림 = 슛. dt = 손가락이 움직이기 시작한 때부터 뗄 때까지
        if (this.enabled && this.onSwipe) this.onSwipe({ dx, dy, dt: Math.max(16, performance.now() - (d.moveT ?? d.t)), x0: d.x, y0: d.y, x1: e.clientX, y1: e.clientY, t: d.t, W: window.innerWidth, H: window.innerHeight });
      } else if (Math.hypot(dx, dy) < this.dragPx) this.emit(d.zone, d.t, d.n); // 톡 누르기 → 쓸어 올리라는 안내
      return;
    }
    if (d.drag) return; // 끌기는 둘러보기
    this.emit(d.zone, d.t, d.n);
  }
  kd(e) {
    if (e.repeat || !this.enabled) { if (e.key === 'Escape') this.onPause && this.onPause(); return; }
    const k = e.key.toLowerCase(), now = performance.now(), n = this.zones();
    if (this.swipeMode() && /^(arrowleft|a|arrowright|d|arrowup|w| )$/.test(k)) { // 컴퓨터 슛: ← ↑ → = 왼쪽 구석·가운데·오른쪽 구석
      e.preventDefault(); this.onSwipe && this.onSwipe({ key: k === 'arrowleft' || k === 'a' ? 'L' : k === 'arrowright' || k === 'd' ? 'R' : 'C', t: now }); return;
    }
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
