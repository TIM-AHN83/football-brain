// 실사풍 선수 몸: Quaternius Universal Base Characters + Universal Animation Library (둘 다 CC0)
// 작업/사람모델/make_players.py 가 만든 assets/people/players.glb 를 불러와
// 선수마다 뼈대를 복제하고, 유니폼(상의·반바지·양말·축구화·등번호)을 셰이더로 입힌다.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/addons/utils/SkeletonUtils.js';

let ASSET = null, LOADING = null;

export function loadPeople(url = './assets/people/players.glb') {
  if (LOADING) return LOADING;
  LOADING = new GLTFLoader().loadAsync(url).then(async (gltf) => {
    const ex = gltf.scene.userData || {};
    const tex = {};
    for (const [k, i] of Object.entries(ex.textures || {})) tex[k] = await gltf.parser.getDependency('texture', i);
    if (tex.skinLight) tex.skinLight.colorSpace = THREE.SRGBColorSpace;
    const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
    let body = null; gltf.scene.traverse(o => { if (o.isSkinnedMesh && o.name === 'Body') body = o; });
    if (!body) throw new Error('players.glb: Body 없음');
    const g = body.geometry; // 유니폼 영역 값 (이름 앞 밑줄을 뺀다)
    g.setAttribute('kitA', g.getAttribute('_kita')); g.setAttribute('kitB', g.getAttribute('_kitb'));
    g.deleteAttribute('_kita'); g.deleteAttribute('_kitb');
    ASSET = { scene: gltf.scene, clips, speeds: ex.speeds || {}, tex, kitScale: ex.kitScale || 4 };
    return ASSET;
  });
  LOADING.catch(e => console.warn('사람 모델을 못 불러와 단순 모델로 표시', e));
  return LOADING;
}
export const peopleReady = () => !!ASSET;

// 피부톤 (텍스처 평균색 #a67350 을 이 색으로 바꾼다) · 머리색
const SKIN_TONES = ['#e3b38f', '#d6a07a', '#b97e58', '#8a5838', '#ebc29f', '#60402a'];
const HAIR_COLS = ['#1d1612', '#2e2018', '#4a3020', '#121212', '#6b4a2a', '#2a2622'];
const TEX_SKIN = new THREE.Color('#a67350'), TEX_HAIR = 0.27;

// 등번호 그림 (투명 배경)
function numberTexture(n, kit) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  if (n != null) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 190px "Barlow Condensed","Arial Narrow",sans-serif';
    g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = kit.numStroke; g.strokeText(String(n), 128, 136);
    g.fillStyle = kit.num; g.fillText(String(n), 128, 136);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const VERT_HEAD = /* glsl */`
attribute vec4 kitA;
attribute vec2 kitB;
varying vec4 vKitA;
varying vec2 vKitB;
varying vec3 vRest;
varying vec3 vRestN;
uniform float uKitScale;
`;
const FRAG_HEAD = /* glsl */`
varying vec4 vKitA;
varying vec2 vKitB;
varying vec3 vRest;
varying vec3 vRestN;
uniform vec3 uShirt, uTrim, uShorts, uSocks, uBoots, uGlow, uSkinTint;
uniform sampler2D uNumTex;
uniform float uNumOn;
float kitEdge(float v) { float w = max(fwidth(v), 1e-4) * 0.8; return smoothstep(-w, w, v); }
float band(float v, float a, float b) { return kitEdge(v - a) * (1.0 - kitEdge(v - b)); }
vec4 numAt(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(uNumTex, uv);
}
`;
const FRAG_KIT = /* glsl */`
diffuseColor.rgb *= uSkinTint;
float mShirt = kitEdge(vKitA.x), mShorts = kitEdge(vKitA.y), mSocks = kitEdge(vKitA.z), mBoots = kitEdge(vKitA.w);
float skinLum = dot(diffuseColor.rgb / max(uSkinTint, vec3(0.05)), vec3(0.2126, 0.7152, 0.0722));
float folds = mix(1.0, clamp(skinLum / 0.2, 0.8, 1.12), 0.1);
vec3 shirtCol = uShirt;
// 옆구리 줄 (몸 옆면을 향한 곳)
float sideN = normalize(vRestN).x * sign(vRest.x); // 바깥쪽을 향할수록 1
float sideBand = kitEdge(sideN - 0.975) * (1.0 - kitEdge(vRest.y - 1.30)) * kitEdge(vRest.y - 0.99) * step(abs(vRest.x), 0.26);
shirtCol = mix(shirtCol, uTrim, sideBand);
// 목둘레·소매 끝 띠
float trimBand = max(1.0 - kitEdge(vKitB.x - 0.014), 1.0 - kitEdge(vKitB.y - 0.018));
shirtCol = mix(shirtCol, uTrim, trimBand);
// 등번호(등) · 작은 번호(오른쪽 가슴) · 엠블럼(왼쪽 가슴)
if (uNumOn > 0.5) {
  float back = 1.0 - smoothstep(-0.085, -0.045, vRest.z);
  vec4 nb = numAt(vec2(0.5 - vRest.x / 0.25, (vRest.y - 1.105) / 0.25));
  shirtCol = mix(shirtCol, nb.rgb, nb.a * back);
  float front = smoothstep(0.035, 0.075, vRest.z);
  vec4 nf = numAt(vec2(0.5 + (vRest.x + 0.088) / 0.085, (vRest.y - 1.285) / 0.085));
  shirtCol = mix(shirtCol, nf.rgb, nf.a * front);
}
{
  float front = smoothstep(0.035, 0.075, vRest.z);
  vec2 cp = vec2(vRest.x - 0.088, vRest.y - 1.33);
  float shield = max(abs(cp.x) - 0.022, (cp.y < 0.0 ? length(cp * vec2(1.0, 0.85)) - 0.026 : abs(cp.y) - 0.022));
  float sw = max(fwidth(shield), 1e-4);
  shirtCol = mix(shirtCol, uTrim, (1.0 - smoothstep(-sw, sw, shield)) * front);
  shirtCol = mix(shirtCol, uShirt, (1.0 - smoothstep(-sw, sw, shield + 0.006)) * front);
}
vec3 shortsCol = mix(uShorts, uTrim, kitEdge(sideN - 0.95) * step(0.12, abs(vRest.x)));
vec3 sockCol = mix(uSocks, uTrim, band(vKitA.z, 0.018, 0.028) + band(vKitA.z, 0.036, 0.046));
vec3 bootCol = mix(uBoots, vec3(0.86), 1.0 - kitEdge(vRest.y - 0.018));
float mCloth = max(mShirt, mShorts);
vec3 clothCol = mix(shortsCol, shirtCol * folds, mShirt);
vec3 kc = mix(diffuseColor.rgb, clothCol, mCloth);
kc = mix(kc, sockCol, mSocks * (1.0 - mCloth));
kc = mix(kc, bootCol, mBoots);
float vClothAll = max(max(mCloth, mSocks), mBoots);
diffuseColor.rgb = kc;
`;

function bodyMaterial(base) {
  const m = new THREE.MeshStandardMaterial({ map: base.map, normalMap: base.normalMap, roughness: 0.62, metalness: 0 });
  m.normalScale = new THREE.Vector2(1, 1);
  m.userData.u = {
    uShirt: { value: new THREE.Color() }, uTrim: { value: new THREE.Color() }, uShorts: { value: new THREE.Color() },
    uSocks: { value: new THREE.Color() }, uBoots: { value: new THREE.Color() }, uGlow: { value: new THREE.Color(0, 0, 0) },
    uSkinTint: { value: new THREE.Color(1, 1, 1) }, uNumTex: { value: null }, uNumOn: { value: 1 }, uKitScale: { value: 1 / ASSET.kitScale }, // 파일에는 미터 × kitScale 로 저장
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvKitA = kitA * uKitScale; vKitB = kitB * uKitScale; vRest = position; vRestN = normal;');
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + FRAG_KIT)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, mix(0.86, 0.42, mBoots), vClothAll);')
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps
        .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - 0.97 * vClothAll);'))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * mShirt;');
  };
  m.customProgramCacheKey = () => 'hb-player-body-1';
  return m;
}

const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _ax = new THREE.Vector3();
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
// 골키퍼 옆걸음 진행도 (0~1): 0.22초에 쏠리고, hold 초 뒤 0.3초에 가운데로 돌아온다 (hold 가 null 이면 그대로)
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
export function shiftAmount(A) { return smooth(A.t / 0.22) * (1 - (A.hold == null ? 0 : smooth((A.t - 0.22 - A.hold) / 0.3))); }
export const shiftDone = (A) => A.hold != null && A.t > 0.52 + A.hold;
const LOCO = ['idle', 'walk', 'jog', 'sprint'];
const LOCO_AT = [0, 1.2, 4.2, 7.2]; // 이 속도(m/s)에서 그 동작이 100%

export class Person {
  constructor(owner, kit, number, opts = {}) {
    const A = ASSET;
    this.owner = owner; this.kit = kit;
    this.root = cloneSkinned(A.scene);
    this.bones = {}; this.meshes = {};
    this.root.traverse(o => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) { this.meshes[o.name] = o; o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; }
    });
    const body = this.meshes.Body;
    this.mat = bodyMaterial(body.material);
    body.material = this.mat;
    const u = this.mat.userData.u;
    u.uShirt.value.set(kit.shirt); u.uTrim.value.set(kit.trim); u.uShorts.value.set(kit.shorts);
    u.uSocks.value.set(kit.socks); u.uBoots.value.set(kit.boots);
    const si = (opts.skin ?? Math.floor(Math.random() * SKIN_TONES.length)) % SKIN_TONES.length;
    const sc = new THREE.Color(SKIN_TONES[si]);
    u.uSkinTint.value.setRGB(sc.r / TEX_SKIN.r, sc.g / TEX_SKIN.g, sc.b / TEX_SKIN.b);
    // 머리카락: 두 가지 중 하나, 색은 선수마다
    const hairKeys = Object.keys(this.meshes).filter(k => k.startsWith('Hair_'));
    const pick = hairKeys[(opts.hair ?? Math.floor(Math.random() * hairKeys.length)) % hairKeys.length];
    const hc = new THREE.Color(HAIR_COLS[Math.floor(Math.random() * HAIR_COLS.length)]).multiplyScalar(1 / TEX_HAIR);
    for (const k of hairKeys) {
      const m = this.meshes[k]; m.visible = k === pick;
      if (m.visible) { m.material = m.material.clone(); m.material.color.copy(hc); }
    }
    this.setNumber(number);
    this.owner.group.add(this.root);
    // 동작
    this.mixer = new THREE.AnimationMixer(this.root);
    this.act = {};
    for (const [k, clip] of Object.entries(A.clips)) {
      const a = this.mixer.clipAction(clip); a.enabled = true; a.setEffectiveWeight(0); a.play();
      if (LOCO.includes(k) && k !== 'idle') a.timeScale = 0; // 걸음 동작은 같은 발걸음 위상으로 직접 맞춘다
      this.act[k] = a;
    }
    this.act.idle.time = Math.random() * this.act.idle.getClip().duration;
    this.phase = Math.random();
    this.speeds = A.speeds;
  }

  setNumber(n) {
    const u = this.mat.userData.u;
    u.uNumTex.value?.dispose(); u.uNumTex.value = numberTexture(n, this.kit);
  }
  setBlank(on) { this.mat.userData.u.uNumOn.value = on ? 0 : 1; }
  glow(amount) { this.mat.userData.u.uGlow.value.set(this.kit.shirt).multiplyScalar(amount); }

  // 속도에 맞춰 서기 → 걷기 → 조깅 → 전력질주를 섞는다
  pose(dt, sp) {
    const w = [0, 0, 0, 0];
    if (sp <= LOCO_AT[0]) w[0] = 1;
    else if (sp >= LOCO_AT[3]) w[3] = 1;
    else for (let i = 0; i < 3; i++) if (sp >= LOCO_AT[i] && sp < LOCO_AT[i + 1]) { const t = (sp - LOCO_AT[i]) / (LOCO_AT[i + 1] - LOCO_AT[i]); w[i] = 1 - t; w[i + 1] = t; }
    // 발걸음 위상: 섞인 동작들의 평균 걸음 빠르기로 진행
    let rate = 0, wsum = 0;
    for (let i = 1; i < 4; i++) {
      if (!w[i]) continue;
      const k = LOCO[i], dur = this.act[k].getClip().duration, nat = this.speeds[k] || 1;
      const ts = THREE.MathUtils.clamp(sp / nat, i === 1 ? 0.7 : 0.72, i === 1 ? 1.6 : 1.3);
      rate += w[i] * ts / dur; wsum += w[i];
    }
    if (wsum > 0) this.phase = (this.phase + dt * rate / wsum) % 1;
    for (let i = 0; i < 4; i++) {
      const a = this.act[LOCO[i]];
      a.setEffectiveWeight(w[i]);
      if (i > 0) a.time = this.phase * a.getClip().duration;
    }
    this.act.jump.setEffectiveWeight(0); this.act.dance.setEffectiveWeight(0);
    this.mixer.update(dt);
    this.root.position.y = 0;
  }

  // 모델 공간 축을 기준으로 뼈를 더 굽힌다 (동작 위에 덧입히기)
  bend(name, axis, ang) {
    const b = this.bones[name]; if (!b || !ang) return;
    b.parent.updateWorldMatrix(true, false);
    b.parent.getWorldQuaternion(_qp);
    this.root.getWorldQuaternion(_qr);
    _qp.premultiply(_qr.invert()).invert();
    _ax.copy(AX[axis]).applyQuaternion(_qp);
    _q.setFromAxisAngle(_ax, ang);
    b.quaternion.premultiply(_q);
    b.updateMatrixWorld(true);
  }

  // 특수 동작 (다이빙·태클·환호): 기본 자세 위에 뼈를 덧굽힌다. 끝나면 true
  special(A, dt) {
    const o = this.owner;
    const only = (k, wgt = 1) => { for (const [n, a] of Object.entries(this.act)) a.setEffectiveWeight(n === k ? wgt : 0); };
    this.root.position.y = 0; // 낮추는 동작(태클·옆걸음)은 매 프레임 다시 정한다
    if (A.type === 'dive') {
      const k = Math.min(1, A.t / 0.45), e = 1 - (1 - k) ** 3;
      only('jump'); this.mixer.update(dt);
      o.pos.x = A.x0 + A.side * (A.dist ?? 2.4) * e;
      o.pos.y = Math.sin(k * Math.PI) * 0.35;
      o.group.rotation.z = -A.side * 1.25 * e;
      this.bend('upperarm_l', 'z', (0.6 + 1.3 * e)); this.bend('upperarm_r', 'z', -(0.6 + 1.3 * e));
      this.bend('thigh_l', 'z', 0.25 * e); this.bend('thigh_r', 'z', -0.25 * e);
      if (A.t > 1.6) { o.pos.y = 0; o.group.rotation.z = 0; return true; }
    } else if (A.type === 'tackle') {
      // 슬라이딩 태클: 몸을 뒤로 눕히고 앞발은 쭉, 뒷다리는 접어 미끄러진다
      const k = Math.min(1, A.t / 0.3), e = k * k * (3 - 2 * k);
      only('idle'); this.mixer.update(dt);
      o.pos.x += A.dx * dt * 7 * (1 - k); o.pos.z += A.dz * dt * 7 * (1 - k);
      this.root.position.y = -0.68 * e;
      this.bend('pelvis', 'x', -0.75 * e);
      this.bend('spine_02', 'x', 0.35 * e);
      this.bend('thigh_r', 'x', -0.85 * e);
      this.bend('thigh_l', 'x', 0.15 * e); this.bend('calf_l', 'x', 1.7 * e); this.bend('thigh_l', 'z', 0.35 * e);
      this.bend('upperarm_l', 'z', 0.7 * e); this.bend('upperarm_r', 'z', -0.7 * e);
      this.bend('upperarm_l', 'x', 0.5 * e); this.bend('upperarm_r', 'x', 0.5 * e);
      if (A.t > (A.hold ?? 1.1)) { this.root.position.set(0, 0, 0); return true; }
    } else if (A.type === 'shift') {
      // 골키퍼 옆걸음: 무릎을 굽혀 낮추고 팔을 벌린 채 한쪽으로 쏠린다
      const e = shiftAmount(A);
      only('idle'); this.mixer.update(dt);
      o.pos.x = A.x0 + A.side * A.dist * e;
      o.group.rotation.z = -A.side * 0.2 * e;
      this.root.position.y = -0.1 * e;
      this.bend('thigh_l', 'x', -0.45 * e); this.bend('thigh_r', 'x', -0.45 * e);
      this.bend('calf_l', 'x', 0.9 * e); this.bend('calf_r', 'x', 0.9 * e);
      this.bend('spine_02', 'x', 0.3 * e);
      this.bend('upperarm_l', 'z', 0.85 * e); this.bend('upperarm_r', 'z', -0.85 * e);
      this.bend('lowerarm_l', 'x', -0.5 * e); this.bend('lowerarm_r', 'x', -0.5 * e);
      if (shiftDone(A)) { o.group.rotation.z = 0; this.root.position.y = 0; return true; }
    } else if (A.type === 'catch') {
      // 높은 공을 뛰어올라 두 손으로 잡는다
      only('jump'); this.mixer.update(dt);
      const k = Math.min(1, A.t / 0.5), up = Math.min(1, A.t / 0.2);
      o.pos.y = Math.sin(k * Math.PI) * 0.45;
      if (A.x1 != null) o.pos.x = A.x0 + (A.x1 - A.x0) * smooth(A.t / 0.4);
      o.group.rotation.z = 0;
      this.bend('upperarm_l', 'z', 2.6 * up); this.bend('upperarm_r', 'z', -2.6 * up);
      this.bend('lowerarm_l', 'z', 0.25 * up); this.bend('lowerarm_r', 'z', -0.25 * up);
      if (A.t > 1.4) { o.pos.y = 0; return true; }
    } else if (A.type === 'cheer') {
      only('idle'); this.mixer.update(dt);
      o.pos.y = Math.abs(Math.sin(A.t * 7)) * 0.25;
      const up = Math.min(1, A.t / 0.25);
      this.bend('upperarm_l', 'z', 2.5 * up); this.bend('upperarm_r', 'z', -2.5 * up);
      this.bend('lowerarm_l', 'z', 0.3 * up); this.bend('lowerarm_r', 'z', -0.3 * up);
      if (A.t > 2.2) { o.pos.y = 0; return true; }
    }
    return false;
  }
}
