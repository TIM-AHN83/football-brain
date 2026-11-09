// 절차적 축구 선수 모델 + 달리기 애니메이션
import * as THREE from 'three';
import * as TX from './textures.js';

export const KITS = {
  home:   { shirt: '#ffc93c', trim: '#16264a', num: '#16264a', numStroke: '#fff1c4', shorts: '#16264a', socks: '#ffc93c', boots: '#141414', ring: '#ffc93c' },
  away:   { shirt: '#d93a2b', trim: '#ffffff', num: '#ffffff', numStroke: '#7a160c', shorts: '#161616', socks: '#d93a2b', boots: '#f0f0f0', ring: '#ff4d3a' },
  keeper: { shirt: '#8a4dff', trim: '#141414', num: '#ffffff', numStroke: '#36157e', shorts: '#141414', socks: '#8a4dff', boots: '#141414', ring: '#b48cff' },
};
const SKINS = ['#f1c9a5', '#e3b08a', '#c98d66', '#9a6440', '#f5d6b8', '#6e452c'];
const HAIRS = ['#1b1410', '#2b1d14', '#4a3020', '#0d0d0d', '#6b4a2a', '#2a2622'];

let G = null; // 공유 지오메트리
function geos() {
  if (G) return G;
  const cap = (r, l, dy) => new THREE.CapsuleGeometry(r, l, 4, 12).translate(0, dy, 0);
  G = {
    torso: new THREE.CylinderGeometry(0.17, 0.145, 0.5, 24, 1),
    shoulder: new THREE.SphereGeometry(0.078, 14, 10),
    upperArm: cap(0.05, 0.19, -0.14),
    forearm: cap(0.041, 0.17, -0.125),
    hand: new THREE.SphereGeometry(0.044, 10, 8),
    neck: new THREE.CylinderGeometry(0.05, 0.058, 0.09, 12),
    head: new THREE.SphereGeometry(0.105, 22, 16),
    hair: new THREE.SphereGeometry(0.112, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.56),
    pelvis: new THREE.CylinderGeometry(0.152, 0.168, 0.2, 18),
    shortLeg: new THREE.CylinderGeometry(0.088, 0.082, 0.19, 14).translate(0, -0.085, 0),
    thigh: cap(0.067, 0.3, -0.21),
    shin: cap(0.053, 0.31, -0.205),
    boot: new THREE.CapsuleGeometry(0.046, 0.15, 4, 10).rotateX(Math.PI / 2).scale(1, 0.72, 1),
    ring: new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2),
    blob: new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
  };
  return G;
}
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = { ring: TX.ringTexture(), blob: TX.blobShadow(), blank: {} };
  return SHARED;
}

export class Footballer {
  constructor(kitName, number, opts = {}) {
    const g = geos(); const S = shared();
    this.kitName = kitName; this.kit = KITS[kitName]; this.number = number;
    this.group = new THREE.Group();
    this.pos = this.group.position;
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.face = null; // 바라볼 지점 (멈춰 있을 때)
    this.maxSpeed = opts.maxSpeed || 6.5;
    this.accel = opts.accel || 9;
    this.phase = Math.random() * 6;
    this.scaleK = opts.scale || (0.92 + Math.random() * 0.08);
    this.group.scale.setScalar(this.scaleK);
    this.anim = null; // 특수 동작 (dive, tackle)

    const k = this.kit;
    const skin = SKINS[(opts.skin ?? Math.floor(Math.random() * SKINS.length)) % SKINS.length];
    const hair = HAIRS[Math.floor(Math.random() * HAIRS.length)];
    const M = (c, r = .72, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0, ...extra });
    this.mShirt = M('#ffffff', .78, { map: TX.jersey(k, number) });
    this.mSkin = M(skin, .6); this.mHair = M(hair, .9);
    this.mShorts = M(k.shorts, .7); this.mSocks = M(k.socks, .75); this.mBoots = M(k.boots, .35);
    this.meshes = [];
    const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = false; parent.add(m); this.meshes.push(m); return m;
    };

    // 골반
    this.hips = new THREE.Group(); this.hips.position.y = 0.92; this.group.add(this.hips);
    add(this.hips, g.pelvis, this.mShorts, 0, 0.02, 0).scale.set(1.12, 1, 0.82);
    // 상체
    this.torso = new THREE.Group(); this.torso.position.y = 0.1; this.hips.add(this.torso);
    const t = add(this.torso, g.torso, this.mShirt, 0, 0.25, 0); t.scale.set(1.14, 1, 0.78);
    add(this.torso, g.neck, this.mSkin, 0, 0.54, 0);
    this.head = new THREE.Group(); this.head.position.y = 0.66; this.torso.add(this.head);
    add(this.head, g.head, this.mSkin).scale.set(0.95, 1.1, 1);
    const hr = add(this.head, g.hair, this.mHair, 0, 0.02, -0.006); hr.rotation.x = -0.32; hr.scale.set(0.98, 1.08, 1.04);
    // 팔
    this.arms = [-1, 1].map(s => {
      const sh = new THREE.Group(); sh.position.set(0.2 * s, 0.47, 0); this.torso.add(sh);
      add(sh, g.shoulder, this.mShirt).scale.set(1, .9, .9);
      add(sh, g.upperArm, this.mShirt).rotation.z = 0.12 * s;
      const el = new THREE.Group(); el.position.set(0.035 * s, -0.29, 0); sh.add(el);
      add(el, g.forearm, this.mSkin);
      add(el, g.hand, this.mSkin, 0, -0.27, 0);
      sh.rotation.z = 0.1 * s;
      return { sh, el, s };
    });
    // 다리
    this.legs = [-1, 1].map(s => {
      const th = new THREE.Group(); th.position.set(0.09 * s, -0.02, 0); this.hips.add(th);
      add(th, g.shortLeg, this.mShorts);
      add(th, g.thigh, this.mSkin);
      const kn = new THREE.Group(); kn.position.y = -0.43; th.add(kn);
      add(kn, g.shin, this.mSocks);
      add(kn, g.boot, this.mBoots, 0, -0.43, 0.05);
      return { th, kn, s };
    });

    // 발밑 링 + 블롭 그림자
    this.ringMat = new THREE.MeshBasicMaterial({ map: S.ring, color: k.ring, transparent: true, opacity: .8, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(g.ring, this.ringMat); this.ring.position.y = 0.025; this.ring.renderOrder = 1;
    this.group.add(this.ring); this.ring.visible = opts.ring !== false;
    this.blob = new THREE.Mesh(g.blob, new THREE.MeshBasicMaterial({ map: S.blob, transparent: true, depthWrite: false }));
    this.blob.position.y = 0.02; this.group.add(this.blob);

    // 머리 위 등번호 배지 (화면 크기 고정)
    this.badgeFg = kitName === 'away' ? '#ffffff' : '#0b1428';
    this.badgeMat = new THREE.SpriteMaterial({ map: TX.badge(number, k.ring, this.badgeFg), depthTest: false, sizeAttenuation: false, toneMapped: false });
    this.badge = new THREE.Sprite(this.badgeMat);
    this.badge.scale.set(0.075, 0.075, 1); this.badge.position.y = 2.25; this.badge.renderOrder = 20; this.badge.visible = false;
    this.group.add(this.badge);
  }

  setNumber(n) {
    if (n === this.number && !this._blank) return;
    this.number = n; this._blank = false;
    this.mShirt.map?.dispose(); this.mShirt.map = TX.jersey(this.kit, n); this.mShirt.needsUpdate = true;
    this.badgeMat.map?.dispose(); this.badgeMat.map = TX.badge(n, this.kit.ring, this.badgeFg); this.badgeMat.needsUpdate = true;
  }
  setBlank(on) { // 등번호 지우기 (등번호 추적 훈련)
    if (on === !!this._blank) return;
    this._blank = on;
    const S = shared();
    if (on) {
      if (!S.blank[this.kitName]) S.blank[this.kitName] = TX.jersey(this.kit, null, { blank: true });
      this._numMap = this.mShirt.map; this.mShirt.map = S.blank[this.kitName];
    } else if (this._numMap) { this.mShirt.map = this._numMap; }
    this.mShirt.needsUpdate = true;
  }
  showBadge(on) { this.badge.visible = on; }
  setRing(on, color) { this.ring.visible = on; if (color) this.ringMat.color.set(color); }
  setVisible(on) { this.group.visible = on; }
  glow(amount) { // 순간 번쩍임
    const e = this.mShirt.emissive; e.set(this.kit.shirt).multiplyScalar(amount);
  }
  place(x, z, faceX, faceZ) {
    this.pos.set(x, 0, z); this.target.set(x, 0, z); this.vel.set(0, 0, 0);
    if (faceX != null) this.group.rotation.y = Math.atan2(faceX - x, faceZ - z);
    this.anim = null; this.group.rotation.z = 0; this.group.rotation.x = 0;
  }
  moveTo(x, z, speed) { this.target.set(x, 0, z); if (speed) this.maxSpeed = speed; }

  dive(side) { this.anim = { type: 'dive', t: 0, side, x0: this.pos.x }; }
  tackle(dirX, dirZ) { this.anim = { type: 'tackle', t: 0, dx: dirX, dz: dirZ }; }
  celebrate() { this.anim = { type: 'cheer', t: 0 }; }

  update(dt) {
    if (!this.group.visible) return;
    if (this.anim) return this.updateAnim(dt);
    // 목표 지점으로 부드럽게 이동
    const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.min(this.maxSpeed, dist * 2.2);
    const vx = dist > 1e-3 ? dx / dist * want : 0, vz = dist > 1e-3 ? dz / dist * want : 0;
    const a = Math.min(1, this.accel * dt / Math.max(1, this.maxSpeed));
    this.vel.x += (vx - this.vel.x) * a * 2.2; this.vel.z += (vz - this.vel.z) * a * 2.2;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    // 방향
    let yaw = null;
    if (sp > 0.6) yaw = Math.atan2(this.vel.x, this.vel.z);
    else if (this.face) yaw = Math.atan2(this.face.x - this.pos.x, this.face.z - this.pos.z);
    if (yaw != null) {
      let d = yaw - this.group.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.group.rotation.y += d * Math.min(1, dt * 8);
    }
    this.pose(dt, sp);
  }

  pose(dt, sp) {
    const amp = Math.min(1, sp / 6.5);
    const idle = 1 - Math.min(1, sp / 1.2);
    this.phase += dt * (2.2 + sp * 1.55);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const swing = 0.15 + 0.75 * amp;
    for (const L of this.legs) {
      const p = L.s < 0 ? s : -s, q = L.s < 0 ? c : -c;
      L.th.rotation.x = -p * swing * (1 - idle * .8) - 0.05;
      L.kn.rotation.x = Math.max(0, q) * (0.25 + 1.25 * amp) * (1 - idle * .7) + 0.08;
    }
    for (const A of this.arms) {
      const p = A.s < 0 ? -s : s;
      A.sh.rotation.x = -p * (0.2 + 0.7 * amp) * (1 - idle * .7);
      A.el.rotation.x = -(0.5 + 0.8 * amp);
    }
    this.torso.rotation.x = 0.04 + 0.18 * amp;
    this.hips.position.y = 0.92 - 0.03 * amp + Math.abs(s) * 0.045 * amp + Math.sin(this.phase * .5) * .006 * idle;
    this.head.rotation.x = -0.12 * amp;
  }

  updateAnim(dt) {
    const A = this.anim; A.t += dt;
    if (A.type === 'dive') {
      const k = Math.min(1, A.t / 0.45), e = 1 - (1 - k) ** 3;
      this.pos.x = A.x0 + A.side * 2.4 * e;
      this.pos.y = Math.sin(k * Math.PI) * 0.35;
      this.group.rotation.z = -A.side * 1.25 * e;
      this.arms.forEach(a => { a.sh.rotation.x = 0; a.sh.rotation.z = (a.s) * (0.4 + 2.4 * e); a.el.rotation.x = 0; });
      this.legs.forEach(l => { l.th.rotation.x = -0.2 * e; l.kn.rotation.x = 0.3; });
      if (A.t > 1.6) { this.anim = null; this.pos.y = 0; this.group.rotation.z = 0; }
    } else if (A.type === 'tackle') {
      const k = Math.min(1, A.t / 0.35);
      this.pos.x += A.dx * dt * 7 * (1 - k); this.pos.z += A.dz * dt * 7 * (1 - k);
      this.group.rotation.x = -0.5 * k; this.hips.position.y = 0.92 - 0.35 * k;
      this.legs[1].th.rotation.x = -1.3 * k; this.legs[1].kn.rotation.x = 0.1;
      this.legs[0].th.rotation.x = 0.6 * k; this.legs[0].kn.rotation.x = 1.2 * k;
      if (A.t > 1.1) { this.anim = null; this.group.rotation.x = 0; this.hips.position.y = 0.92; }
    } else if (A.type === 'cheer') {
      this.pos.y = Math.abs(Math.sin(A.t * 7)) * 0.25;
      this.arms.forEach(a => { a.sh.rotation.x = -2.8; a.sh.rotation.z = a.s * 0.35; a.el.rotation.x = -0.3; });
      this.legs.forEach(l => { l.th.rotation.x = 0; l.kn.rotation.x = 0.2; });
      if (A.t > 2.2) { this.anim = null; this.pos.y = 0; }
    }
  }
}
