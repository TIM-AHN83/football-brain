// 3D 경기장: 잔디·라인·골대·관중석(관중 수천 명)·지붕 조명·LED 광고판·하늘·조명 프리셋
import * as THREE from 'three';
import * as TX from './textures.js';

export const PITCH = { W: 68, L: 105, HW: 34, HL: 52.5 };
export const EYE = 1.5;          // 유소년 눈높이 (m)
export const QUALITY = {
  low:  { dpr: 1,    shadow: false, shadowSize: 512,  crowd: .32, aa: false },
  mid:  { dpr: 1.5,  shadow: true,  shadowSize: 1024, crowd: .65, aa: false },
  high: { dpr: 2,    shadow: true,  shadowSize: 2048, crowd: 1,   aa: true  },
};
const TOD = {
  day:   { top: '#2c6ad0', hor: '#cfe6ff', sun: '#fff3df', sunI: 2.7, hs: '#d6e9ff', hg: '#2d5a2a', hI: .95, fog: '#c3dbf2', exp: 1.0,  dir: [-0.45, 0.8, 0.35], flood: 0,   crowd: 1.0, sunDisk: 1, clouds: .9, stars: 0 },
  dusk:  { top: '#1f2b58', hor: '#ff9b5e', sun: '#ffc08a', sunI: 1.9, hs: '#ffbe8f', hg: '#2a3a22', hI: .7,  fog: '#d38e6c', exp: 1.08, dir: [-0.75, 0.22, -0.6], flood: .55, crowd: .82, sunDisk: 1, clouds: .7, stars: 0 },
  night: { top: '#02040b', hor: '#132341', sun: '#eef3ff', sunI: 2.5, hs: '#6c86b6', hg: '#13240f', hI: .55, fog: '#0b1426', exp: 1.18, dir: [0.25, 0.85, 0.3],   flood: 1,   crowd: .62, sunDisk: 0, clouds: 0,  stars: 1 },
};

// 둥근 사각형 둘레 점 (바깥쪽 법선 포함)
function rrLoop(a, b, r, step = 2, arcSeg = 12) {
  const pts = [];
  const line = (x1, z1, x2, z2, nx, nz) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / step));
    for (let i = 0; i < n; i++) { const t = i / n; pts.push({ x: x1 + (x2 - x1) * t, z: z1 + (z2 - z1) * t, nx, nz }); }
  };
  const arc = (cx, cz, a0, a1) => {
    for (let i = 0; i < arcSeg; i++) { const t = a0 + (a1 - a0) * i / arcSeg; pts.push({ x: cx + r * Math.cos(t), z: cz + r * Math.sin(t), nx: Math.cos(t), nz: Math.sin(t) }); }
  };
  line(a, b - r, a, -(b - r), 1, 0);            arc(a - r, -(b - r), 0, -Math.PI / 2);
  line(a - r, -b, -(a - r), -b, 0, -1);          arc(-(a - r), -(b - r), -Math.PI / 2, -Math.PI);
  line(-a, -(b - r), -a, b - r, -1, 0);          arc(-(a - r), b - r, Math.PI, Math.PI / 2);
  line(-(a - r), b, a - r, b, 0, 1);             arc(a - r, b - r, Math.PI / 2, 0);
  let s = 0;
  for (let i = 0; i < pts.length; i++) { pts[i].s = s; const n = pts[(i + 1) % pts.length]; s += Math.hypot(n.x - pts[i].x, n.z - pts[i].z); }
  return pts;
}

export class World {
  constructor(canvas, qualityName = 'mid') {
    this.qName = qualityName; this.q = QUALITY[qualityName];
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.aa, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = this.q.shadow; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    r.setPixelRatio(this.dpr);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#c3dbf2', 110, 520);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
    // 카메라 리그: rig(위치·진행방향) → yaw(둘러보기) → bob(흔들림) → camera(내려다보기)
    this.rig = new THREE.Group(); this.yaw = new THREE.Group(); this.bob = new THREE.Group();
    this.rig.add(this.yaw); this.yaw.add(this.bob); this.bob.add(this.camera);
    this.camera.position.y = EYE; this.scene.add(this.rig);
    this.pitchDown = -0.27;
    this.time = 0; this.excite = 0; this.exciteTarget = 0.08;

    this.buildLights(); this.buildSky(); this.buildPitch(); this.buildGoals(); this.buildStands(); this.buildBoards(); this.buildBall(); this.buildBoots();
    this.setTimeOfDay('day');
    this.resize();
  }

  // ---------- 조명 ----------
  buildLights() {
    this.hemi = new THREE.HemisphereLight('#d6e9ff', '#2d5a2a', .95); this.scene.add(this.hemi);
    const s = this.sun = new THREE.DirectionalLight('#fff3df', 2.7);
    s.castShadow = this.q.shadow;
    s.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    const c = s.shadow.camera; c.left = -26; c.right = 26; c.top = 26; c.bottom = -26; c.near = 1; c.far = 160;
    s.shadow.bias = -0.0004; s.shadow.normalBias = 0.03;
    this.scene.add(s); this.scene.add(s.target);
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunCol: { value: new THREE.Color() }, sunAmt: { value: 1 }, stars: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top, hor, sunCol, sunDir; uniform float sunAmt, stars; varying vec3 vDir;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main(){
          float h = vDir.y;
          vec3 col = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.55));
          col = mix(col, hor * 0.55, smoothstep(0.0, -0.25, h));
          float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunCol * (pow(d, 900.0) * 6.0 + pow(d, 12.0) * 0.35) * sunAmt;
          if (stars > 0.0) { vec2 g = floor(vDir.xz / (vDir.y + 0.35) * 180.0); float s = step(0.9965, h21(g)) * smoothstep(0.05, 0.4, h); col += vec3(s) * stars * 0.9; }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.skyMat = mat;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat); this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    const ct = TX.cloudTexture(); ct.repeat.set(3, 1);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide, opacity: .8 });
    this.clouds = new THREE.Mesh(new THREE.CylinderGeometry(700, 700, 300, 40, 1, true), this.cloudMat);
    this.clouds.position.y = 120; this.clouds.renderOrder = -9; this.scene.add(this.clouds);
  }

  // ---------- 잔디와 라인 ----------
  buildPitch() {
    const { W, L, HW, HL } = PITCH;
    const TW = W + 18, TL = L + 22;
    const stripes = TX.grassStripes(W, L, TW, TL);
    const detail = TX.grassDetail(); detail.repeat.set(TW / 2.2, TL / 2.2);
    const mat = new THREE.MeshStandardMaterial({ map: stripes, roughness: .93, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.uniforms.detailRep = { value: new THREE.Vector2(TW / 2.2, TL / 2.2) };
      sh.fragmentShader = 'uniform sampler2D detailMap; uniform vec2 detailRep;\n' + sh.fragmentShader.replace('#include <map_fragment>',
        `#include <map_fragment>
         float dg = texture2D(detailMap, vMapUv * detailRep).r;
         float dg2 = texture2D(detailMap, vMapUv * detailRep * 0.21 + 0.37).r;
         diffuseColor.rgb *= mix(0.78, 1.18, dg) * mix(0.9, 1.08, dg2);`);
    };
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(TW, TL).rotateX(-Math.PI / 2), mat);
    grass.receiveShadow = true; this.scene.add(grass);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(260, 300).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a4150', roughness: .95 }));
    apron.position.y = -0.03; apron.receiveShadow = true; this.scene.add(apron);

    // 라인 (하나의 지오메트리로 합침)
    const P = [], w = 0.12;
    const strip = (pts, closed = false) => {
      const n = pts.length;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l * w / 2, nz = dx / l * w / 2;
        const ex = dx / l * w / 2, ez = dz / l * w / 2; // 이음새 겹침
        const A1 = [a[0] + nx - ex, a[1] + nz - ez], A2 = [a[0] - nx - ex, a[1] - nz - ez];
        const B1 = [b[0] + nx + ex, b[1] + nz + ez], B2 = [b[0] - nx + ex, b[1] - nz + ez];
        P.push(A1[0], 0, A1[1], B1[0], 0, B1[1], B2[0], 0, B2[1], A1[0], 0, A1[1], B2[0], 0, B2[1], A2[0], 0, A2[1]);
      }
    };
    const circle = (cx, cz, r, a0 = 0, a1 = Math.PI * 2, seg = 72) => {
      const pts = []; for (let i = 0; i <= seg; i++) { const t = a0 + (a1 - a0) * i / seg; pts.push([cx + r * Math.sin(t), cz + r * Math.cos(t)]); }
      return pts;
    };
    const disc = (cx, cz, r) => { for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, b = (i + 1) / 16 * Math.PI * 2; P.push(cx, 0, cz, cx + r * Math.sin(b), 0, cz + r * Math.cos(b), cx + r * Math.sin(a), 0, cz + r * Math.cos(a)); } };
    strip([[-HW, -HL], [HW, -HL], [HW, HL], [-HW, HL]], true);
    strip([[-HW, 0], [HW, 0]]);
    strip(circle(0, 0, 9.15), false); disc(0, 0, 0.16);
    for (const s of [-1, 1]) {
      const g = s * HL, i = -s;
      strip([[-20.16, g], [-20.16, g + i * 16.5], [20.16, g + i * 16.5], [20.16, g]]);
      strip([[-9.16, g], [-9.16, g + i * 5.5], [9.16, g + i * 5.5], [9.16, g]]);
      disc(0, g + i * 11, 0.14);
      const a0 = Math.acos(5.5 / 9.15);
      const arc = circle(0, g + i * 11, 9.15, (s > 0 ? Math.PI : 0) - a0, (s > 0 ? Math.PI : 0) + a0, 30);
      strip(arc);
      for (const cx of [-1, 1]) { // 코너 아크: 경기장 안쪽 사분면
        const t0 = cx > 0 ? (s > 0 ? Math.PI : Math.PI * 1.5) : (s > 0 ? Math.PI * 0.5 : 0);
        strip(circle(cx * HW, g, 1, t0, t0 + Math.PI / 2, 10));
      }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); lg.computeVertexNormals();
    // 법선이 아래로 향한 삼각형도 있을 수 있어 위쪽으로 고정
    const nrm = lg.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const lines = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: '#f2f3ee', roughness: .85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    lines.position.y = 0.012; lines.receiveShadow = true; this.scene.add(lines);

    // 코너 플래그
    const pole = new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6).translate(0, 0.75, 0);
    const flag = new THREE.PlaneGeometry(0.4, 0.28).translate(0.2, 1.36, 0);
    const pm = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: .5 }), fm = new THREE.MeshStandardMaterial({ color: '#ffc93c', side: THREE.DoubleSide, roughness: .8 });
    this.flags = [];
    for (const x of [-HW, HW]) for (const z of [-HL, HL]) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const p = new THREE.Mesh(pole, pm); p.castShadow = true; g.add(p);
      const f = new THREE.Mesh(flag, fm); f.castShadow = true; g.add(f); this.flags.push(f);
      this.scene.add(g);
    }
  }

  buildGoals() {
    const { HL } = PITCH;
    const post = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .35, metalness: .1 });
    const netTex = TX.netTexture();
    const netMat = (rx, ry) => { const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ map: t, color: '#ffffff', transparent: true, alphaTest: .25, side: THREE.DoubleSide, roughness: 1, depthWrite: false }); };
    const W = 7.32, H = 2.44, D = 2.0;
    this.goals = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group(); g.position.z = s * HL;
      const cyl = (len, x, y, z, rx, rz) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 12), post); m.position.set(x, y, z); m.rotation.set(rx || 0, 0, rz || 0); m.castShadow = true; g.add(m); return m; };
      cyl(H, -W / 2, H / 2, 0); cyl(H, W / 2, H / 2, 0); cyl(W + 0.12, 0, H, 0, 0, Math.PI / 2);
      const thin = (len, x, y, z, rx, rz) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 8), post); m.position.set(x, y, z); m.rotation.set(rx || 0, 0, rz || 0); g.add(m); };
      thin(W, 0, 0.03, s * D, 0, Math.PI / 2); thin(D, -W / 2, 0.03, s * D / 2, Math.PI / 2); thin(D, W / 2, 0.03, s * D / 2, Math.PI / 2);
      thin(Math.hypot(D, H), -W / 2, H / 2, s * D / 2, -s * Math.atan2(D, H)); thin(Math.hypot(D, H), W / 2, H / 2, s * D / 2, -s * Math.atan2(D, H));
      // 그물: 뒤(경사면) + 옆 두 장
      const back = new THREE.Mesh(new THREE.PlaneGeometry(W, Math.hypot(D, H)), netMat(W / 0.9, Math.hypot(D, H) / 0.9));
      back.position.set(0, H / 2, s * D / 2); back.rotation.x = -s * Math.atan2(D, H); g.add(back);
      const sideGeo = new THREE.BufferGeometry();
      sideGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, H, 0, 0, 0, s * D], 3));
      sideGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, H / 0.9, D / 0.9, 0], 2));
      sideGeo.computeVertexNormals();
      for (const x of [-W / 2, W / 2]) { const m = new THREE.Mesh(sideGeo, netMat(1, 1)); m.position.x = x; g.add(m); }
      this.goals.push(g); this.scene.add(g);
    }
  }

  // ---------- 관중석 ----------
  buildStands() {
    const A0 = PITCH.HW + 10, B0 = PITCH.HL + 12.5, R0 = 15;
    const rows = 24, depth = 0.86, rise = 0.46, y0 = 1.35;
    const base = rrLoop(A0, B0, R0, 2.2, 12);
    const N = base.length, total = base[N - 1].s + Math.hypot(base[0].x - base[N - 1].x, base[0].z - base[N - 1].z);
    const pos = [], col = [];
    const cSeat = new THREE.Color('#1f3261'), cSeat2 = new THREE.Color('#25407a'), cGold = new THREE.Color('#e9b52e'), cCon = new THREE.Color('#5d6474'), cConD = new THREE.Color('#3b414e'), cAisle = new THREE.Color('#7a8090');
    const quad = (a, b, c, d, color) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b); };
    const at = (p, d, y) => [p.x + p.nx * d, y, p.z + p.nz * d];
    const isAisle = (s) => (s % 24) < 1.3;
    const yTop = y0 + rows * rise, dEnd = rows * depth;
    for (let k = 0; k < N; k++) {
      const A = base[k], B = base[(k + 1) % N];
      const aisle = isAisle(A.s);
      quad(at(A, 0, 0), at(B, 0, 0), at(B, 0, y0), at(A, 0, y0), cConD); // 앞 벽
      for (let i = 0; i < rows; i++) {
        const d = i * depth, y = y0 + i * rise;
        quad(at(A, d, y), at(B, d, y), at(B, d, y + rise), at(A, d, y + rise), cCon);
        const sec = Math.floor(A.s / 24) % 5 === 2 && i > 6 && i < 18 && (i % 3 === 0);
        const seat = aisle ? cAisle : (sec ? cGold : (Math.floor(A.s / 24) % 2 ? cSeat : cSeat2));
        quad(at(A, d, y + rise), at(B, d, y + rise), at(B, d + depth, y + rise), at(A, d + depth, y + rise), seat);
      }
      quad(at(A, dEnd, yTop), at(B, dEnd, yTop), at(B, dEnd, yTop + 5.2), at(A, dEnd, yTop + 5.2), cConD); // 뒤 벽
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const stands = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide }));
    stands.receiveShadow = true; this.scene.add(stands);

    // 지붕 + 조명 띠
    const rp = [], rl = [];
    const yR = yTop + 5.2, dIn = 6.5;
    for (let k = 0; k < N; k++) {
      const A = base[k], B = base[(k + 1) % N];
      const a1 = at(A, dIn, yR - 0.9), b1 = at(B, dIn, yR - 0.9), a2 = at(A, dEnd + 0.4, yR), b2 = at(B, dEnd + 0.4, yR);
      rp.push(...a1, ...b1, ...b2, ...a1, ...b2, ...a2);
      const l1 = at(A, dIn - 0.05, yR - 1.55), l2 = at(B, dIn - 0.05, yR - 1.55), l3 = at(B, dIn - 0.05, yR - 0.9), l4 = at(A, dIn - 0.05, yR - 0.9);
      rl.push(...l1, ...l2, ...l3, ...l1, ...l3, ...l4);
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.computeVertexNormals();
    const roof = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: '#2a3140', roughness: .7, metalness: .3, side: THREE.DoubleSide }));
    this.scene.add(roof);
    const lgeo = new THREE.BufferGeometry(); lgeo.setAttribute('position', new THREE.Float32BufferAttribute(rl, 3));
    this.roofLightMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, toneMapped: false });
    this.scene.add(new THREE.Mesh(lgeo, this.roofLightMat));
    // 조명 번짐 스프라이트
    const glowTex = TX.glowTexture();
    this.glowMat = new THREE.SpriteMaterial({ map: glowTex, color: '#fff6e6', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false });
    this.glows = new THREE.Group();
    for (let k = 0; k < N; k += 7) {
      const A = base[k]; const s = new THREE.Sprite(this.glowMat);
      const p = at(A, dIn - 0.3, yR - 1.1); s.position.set(...p); s.scale.set(9, 9, 1); this.glows.add(s);
    }
    this.scene.add(this.glows);

    // 관중 (인스턴스)
    const dens = this.q.crowd, spacing = 0.58 / Math.sqrt(dens);
    const dummy = new THREE.Object3D();
    const mats = [], cols = [], seeds = [];
    const shirtPal = ['#ffc93c', '#16264a', '#ffc93c', '#f4f6fb', '#d93a2b', '#2e7bd6', '#1b1b1b', '#ffc93c', '#16264a', '#8a8f9c', '#2fa35a'].map(c => new THREE.Color(c));
    let rnd = 12345; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < rows; i++) {
      const d = i * depth + depth * 0.5, y = y0 + (i + 1) * rise;
      for (let k = 0; k < N; k++) {
        const A = base[k], B = base[(k + 1) % N];
        if (isAisle(A.s)) continue;
        const ax = A.x + A.nx * d, az = A.z + A.nz * d, bx = B.x + B.nx * d, bz = B.z + B.nz * d;
        const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / spacing);
        for (let j = 0; j < n; j++) {
          if (R() < 0.14) continue;
          const t = (j + 0.5) / n;
          const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          const nx = A.nx + (B.nx - A.nx) * t, nz = A.nz + (B.nz - A.nz) * t;
          dummy.position.set(x, y + 0.36, z); dummy.rotation.set(0, Math.atan2(-nx, -nz), 0);
          const sc = 0.92 + R() * 0.16; dummy.scale.set(sc, sc, sc); dummy.updateMatrix();
          mats.push(dummy.matrix.clone());
          const c = shirtPal[Math.floor(R() * shirtPal.length)]; cols.push(c.r, c.g, c.b); seeds.push(R());
        }
      }
    }
    const pg = new THREE.PlaneGeometry(0.52, 0.74);
    pg.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(cols), 3));
    pg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
    this.crowdMat = new THREE.ShaderMaterial({
      fog: true, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uExcite: { value: 0 }, uLight: { value: 1 } }]),
      vertexShader: `attribute vec3 aColor; attribute float aSeed; uniform float uTime, uExcite;
        varying vec2 vUv; varying vec3 vColor; varying float vSeed;
        #include <fog_pars_vertex>
        void main(){
          vUv = uv; vColor = aColor; vSeed = aSeed;
          vec3 p = position;
          float jump = max(0.0, sin(uTime * (7.0 + aSeed * 5.0) + aSeed * 60.0)) * uExcite * 0.42;
          p.y += jump + sin(uTime * 1.4 + aSeed * 30.0) * 0.012;
          p.x += sin(uTime * 1.1 + aSeed * 17.0) * 0.025;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uLight, uExcite; varying vec2 vUv; varying vec3 vColor; varying float vSeed;
        #include <fog_pars_fragment>
        float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
        void main(){
          vec2 m = vUv * vec2(0.52, 0.74);
          float head = length((m - vec2(0.26, 0.6)) * vec2(1.0, 0.92)) - 0.095;
          float body = sdBox(m - vec2(0.26, 0.2), vec2(0.2, 0.25), 0.09);
          float armUp = uExcite * step(0.5, fract(vSeed * 13.0));
          float arms = min(sdBox(m - vec2(0.07, 0.48), vec2(0.035, 0.16), 0.03), sdBox(m - vec2(0.45, 0.48), vec2(0.035, 0.16), 0.03));
          if (armUp < 0.5) arms = 1.0;
          float d = min(min(head, body), arms);
          if (d > 0.0) discard;
          vec3 skins[3]; skins[0] = vec3(0.86, 0.62, 0.48); skins[1] = vec3(0.62, 0.42, 0.3); skins[2] = vec3(0.95, 0.76, 0.62);
          vec3 skin = skins[int(fract(vSeed * 7.0) * 2.99)];
          vec3 c = (head < 0.0 || arms < 0.0) ? skin : vColor;
          if (head < 0.0 && m.y > 0.62) c = vec3(0.08, 0.06, 0.05);
          c *= (0.62 + 0.38 * smoothstep(0.0, 0.7, m.y)) * (0.78 + 0.3 * fract(vSeed * 3.1)) * uLight;
          gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const crowd = new THREE.InstancedMesh(pg, this.crowdMat, mats.length);
    mats.forEach((m, i) => crowd.setMatrixAt(i, m));
    crowd.frustumCulled = false; this.scene.add(crowd);
    this.crowdCount = mats.length;
  }

  buildBoards() {
    const { HW, HL } = PITCH;
    const led = this.led = TX.ledBoard([
      { text: 'FOOTBALL BRAIN', bg: '#0b1428', fg: '#ffc93c' },
      { text: '하프타임 부모 상담소', bg: '#16264a', fg: '#ffffff', font: '400 54px "Black Han Sans","Noto Sans KR",sans-serif' },
      { text: 'SCAN · CALL · PASS', bg: '#ffc93c', fg: '#0b1428' },
      { text: '@halftime.parenttalk', bg: '#d93a2b', fg: '#ffffff' },
    ]);
    led.repeat.set(2.5, 1);
    const front = new THREE.MeshBasicMaterial({ map: led, toneMapped: false });
    const backM = new THREE.MeshStandardMaterial({ color: '#141a26', roughness: .8 });
    const H = 0.92;
    const board = (len, x, z, ry) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
      const box = new THREE.Mesh(new THREE.BoxGeometry(len, H, 0.12), backM); box.position.y = H / 2; box.castShadow = true; g.add(box);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(len, H * 0.86), front); f.position.set(0, H / 2, 0.065); g.add(f);
      this.scene.add(g);
    };
    board(96, -(HW + 4.5), 0, Math.PI / 2); board(96, HW + 4.5, 0, -Math.PI / 2);
    board(26, -17, -(HL + 4.2), 0); board(26, 17, -(HL + 4.2), 0);
    board(26, -17, HL + 4.2, Math.PI); board(26, 17, HL + 4.2, Math.PI);
  }

  buildBall() {
    const m = new THREE.MeshStandardMaterial({ map: TX.ballTexture(), roughness: .42, metalness: 0 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 32, 20), m);
    this.ball.castShadow = true; this.ball.position.set(0, 0.11, -1.4);
    this.scene.add(this.ball);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.blobShadow(), transparent: true, depthWrite: false }));
    sh.position.y = 0.015; this.ballShadow = sh; this.scene.add(sh);
  }

  // 1인칭 발 (FPS 무기처럼 화면 아래에서 들어옴)
  buildBoots() {
    const sock = new THREE.MeshStandardMaterial({ color: '#ffc93c', roughness: .75 });
    const boot = new THREE.MeshStandardMaterial({ color: '#16264a', roughness: .35, metalness: .1 });
    const sole = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .5 });
    this.boots = [-1, 1].map(s => {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.17, 4, 12).rotateX(Math.PI / 2).scale(1, .7, 1), boot); b.position.set(0, 0.045, 0.02); b.castShadow = true; g.add(b);
      const so = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.015, 0.25), sole); so.position.set(0, 0.008, 0.02); g.add(so);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.42, 4, 10).translate(0, 0.3, 0), sock); leg.rotation.x = -0.35; leg.position.z = 0.08; leg.castShadow = true; g.add(leg);
      g.userData = { side: s, kick: 0, base: new THREE.Vector3(0.13 * s, 0, 0.25) };
      g.position.copy(g.userData.base); g.rotation.y = Math.PI;
      this.rig.add(g); return g;
    });
  }
  kickBoot(side, amount = 1) { const b = this.boots[side < 0 ? 0 : 1]; b.userData.kick = 1; b.userData.amt = amount; }

  // ---------- 조명 프리셋 ----------
  setTimeOfDay(name) {
    const T = TOD[name] || TOD.day; this.tod = name;
    this.skyMat.uniforms.top.value.set(T.top); this.skyMat.uniforms.hor.value.set(T.hor);
    this.skyMat.uniforms.sunCol.value.set(T.sun); this.skyMat.uniforms.sunAmt.value = T.sunDisk;
    this.skyMat.uniforms.stars.value = T.stars;
    this.sunDir = new THREE.Vector3(...T.dir).normalize();
    this.skyMat.uniforms.sunDir.value.copy(this.sunDir);
    this.sun.color.set(T.sun); this.sun.intensity = T.sunI;
    this.hemi.color.set(T.hs); this.hemi.groundColor.set(T.hg); this.hemi.intensity = T.hI;
    this.scene.fog.color.set(T.fog);
    this.renderer.toneMappingExposure = T.exp;
    this.roofLightMat.color.setScalar(0.25 + T.flood * 2.2);
    this.glowMat.opacity = T.flood; this.glows.visible = T.flood > 0.05;
    this.cloudMat.opacity = T.clouds; this.clouds.visible = T.clouds > 0;
    this.crowdMat.uniforms.uLight.value = T.crowd;
  }

  setExcite(v, hold = 0) { this.excite = Math.max(this.excite, v); this.exciteHold = hold; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const asp = w / h; this.camera.aspect = asp;
    if (asp < 1) { // 세로 화면: 가로 시야 ~52°, 세로 최대 92°
      const hf = 54 * Math.PI / 180;
      this.camera.fov = Math.min(92, 2 * Math.atan(Math.tan(hf / 2) / asp) * 180 / Math.PI);
      this.pitchDown = -0.27;
    } else { this.camera.fov = 58; this.pitchDown = -0.16; }
    this.camera.updateProjectionMatrix();
  }
  setDpr(d) { this.dpr = d; this.renderer.setPixelRatio(d); this.resize(); }

  update(dt) {
    this.time += dt;
    // 관중 들썩임
    if (this.exciteHold > 0) this.exciteHold -= dt; else this.excite += (this.exciteTarget - this.excite) * Math.min(1, dt * 1.2);
    this.crowdMat.uniforms.uTime.value = this.time; this.crowdMat.uniforms.uExcite.value = this.excite;
    this.led.offset.x = (this.time * 0.035) % 1;
    for (const f of this.flags) f.rotation.y = Math.sin(this.time * 2 + f.id) * .25;
    // 하늘·그림자 카메라 따라가기
    const p = this.rig.position;
    this.sky.position.copy(p); this.clouds.position.x = p.x; this.clouds.position.z = p.z; this.clouds.rotation.y = this.time * 0.004;
    const fwd = new THREE.Vector3(0, 0, -12).applyQuaternion(this.rig.quaternion);
    this.sun.target.position.set(p.x + fwd.x, 0, p.z + fwd.z);
    this.sun.position.set(this.sun.target.position.x + this.sunDir.x * 80, this.sunDir.y * 80, this.sun.target.position.z + this.sunDir.z * 80);
    this.camera.rotation.x = this.pitchDown;
    // 발 차기 애니메이션
    for (const b of this.boots) {
      const u = b.userData;
      if (u.kick > 0) {
        u.kick = Math.max(0, u.kick - dt * 3.2);
        const k = Math.sin((1 - u.kick) * Math.PI) * (u.amt || 1);
        b.position.set(u.base.x - u.side * 0.06 * k, 0.02 * k, u.base.z - 1.15 * k);
        b.rotation.x = -0.5 * k;
      } else b.position.lerp(u.base, Math.min(1, dt * 10));
    }
    this.ballShadow.position.x = this.ball.position.x; this.ballShadow.position.z = this.ball.position.z;
    const bh = this.ball.position.y; this.ballShadow.scale.setScalar(1 + bh * 0.6); this.ballShadow.material.opacity = Math.max(0.15, 1 - bh * 0.5);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
