// 휴대폰 센서: 걸음(가속도계) + 둘러보기 방향(자이로)
import * as THREE from 'three';

const zee = new THREE.Vector3(0, 0, 1), euler = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5));
const quat = new THREE.Quaternion(), fwd = new THREE.Vector3();

export class Sensors {
  constructor() {
    this.steps = 0; this.stepTimes = []; this.hasMotion = false; this.hasOrient = false;
    this.yaw = 0; this.rawYaw = 0; this.yaw0 = null;
    this.mean = 9.8; this.lp = 0; this.above = false; this.lastStep = 0;
    this._m = (e) => this.onMotion(e); this._o = (e) => this.onOrient(e);
  }
  static needsPermission() {
    return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  }
  // iOS는 버튼을 누른 순간에만 권한을 물어볼 수 있다
  async request({ motion, orient }) {
    const out = { motion: !!motion, orient: !!orient };
    try {
      if (motion && typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) out.motion = (await DeviceMotionEvent.requestPermission()) === 'granted';
    } catch (e) { out.motion = false; }
    try {
      if (orient && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) out.orient = (await DeviceOrientationEvent.requestPermission()) === 'granted';
    } catch (e) { out.orient = false; }
    if (out.motion) window.addEventListener('devicemotion', this._m);
    if (out.orient) window.addEventListener('deviceorientation', this._o);
    return out;
  }
  stop() { window.removeEventListener('devicemotion', this._m); window.removeEventListener('deviceorientation', this._o); this.hasMotion = this.hasOrient = false; }

  onMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    this.hasMotion = true;
    const m = Math.hypot(a.x, a.y, a.z);
    this.mean += (m - this.mean) * 0.03;
    const hp = m - this.mean;
    this.lp += (hp - this.lp) * 0.35;
    if (this.lp > (this.peak || 0)) this.peak = this.lp; // 시험 표시판용
    const now = performance.now();
    if (!this.above && this.lp > 1.15 && now - this.lastStep > 240) {
      this.above = true; this.lastStep = now; this.steps++; this.stepTimes.push(now);
      if (this.stepTimes.length > 30) this.stepTimes.shift();
    } else if (this.above && this.lp < 0.35) this.above = false;
  }
  get active() { return performance.now() - this.lastStep < 1400; }
  get cadence() { // 분당 걸음
    const now = performance.now(); const recent = this.stepTimes.filter(t => now - t < 3000);
    return recent.length * 20;
  }

  onOrient(e) {
    if (e.alpha == null) return;
    this.hasOrient = true;
    const D = THREE.MathUtils.DEG2RAD;
    const orient = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    euler.set(e.beta * D, e.alpha * D, -e.gamma * D, 'YXZ');
    quat.setFromEuler(euler); quat.multiply(q1); quat.multiply(q0.setFromAxisAngle(zee, -orient * D));
    fwd.set(0, 0, -1).applyQuaternion(quat);
    if (Math.abs(fwd.y) > 0.92) return; // 폰을 거의 눕히면 방향이 불안정
    this.rawYaw = Math.atan2(-fwd.x, -fwd.z);
    if (this.yaw0 == null) this.yaw0 = this.rawYaw;
    const d = this.rawYaw - this.yaw0;
    this.yaw = Math.atan2(Math.sin(d), Math.cos(d));
  }
  calibrate() { this.yaw0 = this.hasOrient ? this.rawYaw : null; this.yaw = 0; }
}
