// 한 손 탭 제스처: 한 번 탭 / 두 번 탭 / 꾹 누르기 / 옆으로 끌어 둘러보기 + 키보드
export class Gestures {
  constructor(el, { onTap, onLook, onLookKey, onPause }) {
    this.el = el; this.onTap = onTap; this.onLook = onLook; this.onLookKey = onLookKey; this.onPause = onPause;
    this.dbl = 280; this.holdMs = 400; this.dragPx = 26; this.enabled = false;
    this.down = null; this.pending = null; this.firstT = 0;
    el.addEventListener('pointerdown', e => this.pd(e));
    el.addEventListener('pointermove', e => this.pm(e));
    el.addEventListener('pointerup', e => this.pu(e));
    el.addEventListener('pointercancel', e => this.pu(e, true));
    el.addEventListener('contextmenu', e => e.preventDefault());
    this.keys = new Set();
    window.addEventListener('keydown', e => this.kd(e));
    window.addEventListener('keyup', e => this.ku(e));
  }
  emit(kind, t) { if (this.enabled) this.onTap(kind, t); }
  pd(e) {
    if (!this.enabled || (this.down && this.down.id !== e.pointerId)) return;
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    const now = performance.now();
    if (this.pending) { // 두 번째 탭 → 바로 '두 번 탭'
      clearTimeout(this.pending); this.pending = null;
      this.down = { id: e.pointerId, x: e.clientX, t: now, consumed: true, lastX: e.clientX };
      this.emit('double', this.firstT);
      return;
    }
    this.down = { id: e.pointerId, x: e.clientX, t: now, consumed: false, drag: false, lastX: e.clientX };
    this.holdTimer = setTimeout(() => { if (this.down && !this.down.drag && !this.down.consumed) { this.down.consumed = true; this.emit('hold', this.down.t); } }, this.holdMs);
  }
  pm(e) {
    const d = this.down; if (!d || d.id !== e.pointerId) return;
    if (!d.consumed && Math.abs(e.clientX - d.x) > this.dragPx) { d.drag = true; clearTimeout(this.holdTimer); }
    if (d.drag) { this.onLook(e.clientX - d.lastX); d.lastX = e.clientX; }
  }
  pu(e, cancel) {
    const d = this.down; if (!d || d.id !== e.pointerId) return;
    clearTimeout(this.holdTimer); this.down = null;
    if (cancel || d.consumed || d.drag) return;
    this.firstT = d.t;
    this.pending = setTimeout(() => { this.pending = null; this.emit('single', this.firstT); }, this.dbl);
  }
  kd(e) {
    if (e.repeat || !this.enabled) { if (e.key === 'Escape') this.onPause && this.onPause(); return; }
    const k = e.key.toLowerCase(), now = performance.now();
    if (k === 'arrowleft' || k === 'a') this.emit('single', now);
    else if (k === 'arrowright' || k === 'd') this.emit('double', now);
    else if (k === 'arrowup' || k === 'w' || k === ' ') { e.preventDefault(); this.emit('hold', now); }
    else if (k === 'q' || k === 'e') { this.keys.add(k); this.onLookKey((this.keys.has('q') ? 1.3 : 0) - (this.keys.has('e') ? 1.3 : 0)); }
    else if (k === 'escape' || k === 'p') this.onPause && this.onPause();
  }
  ku(e) {
    const k = e.key.toLowerCase();
    if (k === 'q' || k === 'e') { this.keys.delete(k); this.onLookKey((this.keys.has('q') ? 1.3 : 0) - (this.keys.has('e') ? 1.3 : 0)); }
  }
  reset() { clearTimeout(this.pending); clearTimeout(this.holdTimer); this.pending = null; this.down = null; }
}
