// 3D 경기장(실사풍): 실제 하늘 사진(Poly Haven HDRI, CC0)으로 하늘·먼 풍경·하늘빛 조명,
// 사진 잔디(ambientCG, CC0)·조명탑·철망·광고판·벤치·부모 응원석·공. 사진을 못 불러오면 그림 하늘로 대신한다.
import * as THREE from 'three';
import * as TX from './textures.js';

export const PITCH = { W: 68, L: 105, HW: 34, HL: 52.5 };
export const EYE = 1.5;          // 유소년 눈높이 (m)
export const QUALITY = {
  low:  { dpr: 1,    shadow: false, shadowSize: 512,  crowd: .5, aa: false, normal: false },
  mid:  { dpr: 1.5,  shadow: true,  shadowSize: 1024, crowd: .8, aa: false, normal: true },
  high: { dpr: 2,    shadow: true,  shadowSize: 2048, crowd: 1,  aa: true,  normal: true },
};
// 시간대별 조명. top·hor·fog 등은 사진 하늘을 못 불러왔을 때 쓰는 그림 하늘 색
const TOD = {
  day:   { top: '#2c6ad0', hor: '#cfe6ff', sun: '#fff3df', sunI: 3.0, hs: '#d6e9ff', hg: '#2d5a2a', hI: .95, fog: '#c3dbf2', fogN: 90, fogF: 700, envI: 1.0,  dir: [-0.45, 0.8, 0.35], flood: 0,   crowd: 1.0, sunDisk: 1, stars: 0 },
  dusk:  { top: '#1f2b58', hor: '#ff9b5e', sun: '#ffc08a', sunI: 2.7, hs: '#ffbe8f', hg: '#2a3a22', hI: .7,  fog: '#d38e6c', fogN: 70, fogF: 600, envI: 1.5, fill: .45, dir: [-0.75, 0.22, -0.6], flood: .45, crowd: .8,  sunDisk: 1, stars: 0 },
  night: { top: '#02040b', hor: '#132341', sun: '#eef3ff', sunI: 2.4, hs: '#9fb4dc', hg: '#16240f', hI: .55, fog: '#0b1426', fogN: 35, fogF: 330, envI: 2.4, fill: .5,  dir: [0.42, 0.8, 0.3],   flood: 1,   crowd: .62, sunDisk: 0, stars: 1,
           mist: [0.075, 0.085, 0.11] },
};
const ENV_URL = 'assets/env/', TEX_URL = 'assets/tex/';
const loader = new THREE.TextureLoader();
const loadTex = (url, srgb = true) => new Promise((res, rej) => loader.load(url, (t) => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; res(t); }, undefined, () => rej(new Error('불러오기 실패 ' + url))));

export class World {
  constructor(canvas, qualityName = 'mid') {
    this.qName = qualityName; this.q = QUALITY[qualityName];
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.aa, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = this.q.shadow; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr);
    r.setPixelRatio(this.dpr);
    this.aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#c3dbf2', 90, 700);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1500);
    // 카메라 리그: rig(위치·진행방향) → yaw(둘러보기) → bob(흔들림) → camera(내려다보기)
    this.rig = new THREE.Group(); this.yaw = new THREE.Group(); this.bob = new THREE.Group();
    this.rig.add(this.yaw); this.yaw.add(this.bob); this.bob.add(this.camera);
    this.camera.position.y = EYE; this.scene.add(this.rig);
    this.pitchDown = -0.27;
    this.baseFov = 70; this.zoom = 1; this.zoomTarget = 1; this.shakeAmt = 0; // 슛 장면 확대·돌파 순간 넓게·골 흔들림
    this.time = 0; this.excite = 0; this.exciteTarget = 0.08;
    this.envs = {}; this.pmrem = new THREE.PMREMGenerator(r);

    this.buildLights(); this.buildSky(); this.buildGround(); this.buildPitchLines(); this.buildGoals();
    this.buildFences(); this.buildBoards(); this.buildDugouts(); this.buildStand(); this.buildFloodlights();
    this.buildBall(); this.buildBoots(); this.buildPressRing();
    this.setTimeOfDay('day');
    this.resize();
    this._tex = this.loadTextures();
  }

  // ---------- 사진 재료 불러오기 ----------
  // keys 의 하늘과 잔디·공 텍스처가 준비될 때까지 기다린다 (실패해도 그림 하늘로 계속)
  preload(keys = []) { return Promise.all([this._tex, ...keys.map(k => this.loadEnv(k))]); }

  meta() {
    if (!this._meta) this._meta = fetch(ENV_URL + 'env.json').then(r => (r.ok ? r.json() : Promise.reject(new Error('env.json ' + r.status))));
    return this._meta;
  }

  loadEnv(key) {
    if (this.envs[key]) return this.envs[key].promise;
    const e = this.envs[key] = { ready: false };
    e.promise = (async () => {
      const m = (await this.meta()).envs[key];
      const [sky, buf] = await Promise.all([
        loadTex(ENV_URL + m.sky),
        fetch(ENV_URL + m.env).then(r => { if (!r.ok) throw new Error('env ' + r.status); return r.arrayBuffer(); }),
      ]);
      // 하늘 사진: 가까이 크게 보이므로 밉맵 없이(이음새 줄 방지)
      sky.generateMipmaps = false; sky.minFilter = THREE.LinearFilter; sky.wrapS = THREE.RepeatWrapping; sky.wrapT = THREE.ClampToEdgeWrapping;
      sky.needsUpdate = true;
      // 조명용 작은 HDR → 반사·확산광 지도(PMREM)
      const dt = new THREE.DataTexture(new Uint16Array(buf), m.envW, m.envH, THREE.RGBAFormat, THREE.HalfFloatType);
      dt.mapping = THREE.EquirectangularReflectionMapping; dt.colorSpace = THREE.LinearSRGBColorSpace;
      dt.minFilter = dt.magFilter = THREE.LinearFilter; dt.generateMipmaps = false; dt.needsUpdate = true;
      const rt = this.pmrem.fromEquirectangular(dt); dt.dispose();
      const yaw = m.yaw * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), d = m.sun;
      Object.assign(e, { m, sky, env: rt.texture, yaw, sunDir: new THREE.Vector3(d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c).normalize(), ready: true });
      if (this.tod === key) this.applyTod();
      return e;
    })().catch((err) => { e.failed = true; console.warn('하늘 사진 불러오기 실패', key, err); window.__fbLog?.(`ERR sky ${key} ${err}`); });
    return e.promise;
  }

  async loadTextures() {
    const tex = async (name, srgb, rep, aniso = this.aniso) => {
      const t = await loadTex(TEX_URL + name, srgb);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); t.anisotropy = aniso; return t;
    };
    const { TW, TL } = this.ground;
    const jobs = [
      tex('grass_pitch.jpg', true, [TW / 2.4, TL / 2.4]).then(t => { this.pitchMat.map = t; this.pitchMat.color.set('#ffffff'); this.pitchMat.needsUpdate = true; }),
      tex('grass_field.jpg', true, [1600 / 3.2, 1600 / 3.2]).then(t => { this.fieldMat.map = t; this.fieldMat.color.set('#ffffff'); this.fieldMat.needsUpdate = true; }),
      tex('ball.jpg', true, null, 4).then(t => { t.wrapT = THREE.ClampToEdgeWrapping; this.ballMat.map = t; this.ballMat.needsUpdate = true; }),
      tex('ball_bump.jpg', false, null, 4).then(t => { t.wrapT = THREE.ClampToEdgeWrapping; this.ballMat.bumpMap = t; this.ballMat.bumpScale = 2.2; this.ballMat.needsUpdate = true; }),
    ];
    if (this.q.normal) {
      jobs.push(tex('grass_pitch_n.jpg', false, [TW / 2.4, TL / 2.4]).then(t => { this.pitchMat.normalMap = t; this.pitchMat.normalScale.set(.55, .55); this.pitchMat.needsUpdate = true; }));
      jobs.push(tex('grass_field_n.jpg', false, [1600 / 3.2, 1600 / 3.2]).then(t => { this.fieldMat.normalMap = t; this.fieldMat.normalScale.set(.8, .8); this.fieldMat.needsUpdate = true; }));
    }
    const res = await Promise.allSettled(jobs);
    res.filter(x => x.status === 'rejected').forEach(x => { console.warn(x.reason); window.__fbLog?.('ERR tex ' + x.reason); });
  }

  // ---------- 조명 ----------
  buildLights() {
    this.hemi = new THREE.HemisphereLight('#d6e9ff', '#2d5a2a', .95); this.scene.add(this.hemi);
    const s = this.sun = new THREE.DirectionalLight('#fff3df', 2.7);
    s.castShadow = this.q.shadow;
    s.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    const c = s.shadow.camera; c.left = -26; c.right = 26; c.top = 26; c.bottom = -26; c.near = 1; c.far = 200;
    s.shadow.bias = -0.0004; s.shadow.normalBias = 0.03;
    this.scene.add(s); this.scene.add(s.target);
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { map: { value: null }, hasMap: { value: 0 }, crop: { value: .535 }, yaw: { value: 0 },
        top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunCol: { value: new THREE.Color() }, sunAmt: { value: 1 }, stars: { value: 0 }, fogCol: { value: new THREE.Color() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform sampler2D map; uniform float hasMap, crop, yaw, sunAmt, stars; uniform vec3 top, hor, sunCol, sunDir, fogCol; varying vec3 vDir;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vDir);
          if (hasMap > 0.5) {
            // 사진 하늘 (등장방형, 위쪽 crop 만큼만 들어 있음)
            float c = cos(yaw), s = sin(yaw);
            vec3 r = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
            float u = atan(r.z, r.x) * 0.1591549 + 0.5;
            float v = acos(clamp(r.y, -1.0, 1.0)) * 0.3183099;
            gl_FragColor = vec4(texture2D(map, vec2(u, 1.0 - min(v / crop, 1.0))).rgb, 1.0);
            #include <colorspace_fragment>
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, smoothstep(0.0, -0.04, d.y)); // 지평선 아래는 안개 색
          } else {
            float h = d.y;
            vec3 col = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.55));
            col = mix(col, hor * 0.55, smoothstep(0.0, -0.25, h));
            float k = max(dot(d, normalize(sunDir)), 0.0);
            col += sunCol * (pow(k, 900.0) * 6.0 + pow(k, 12.0) * 0.35) * sunAmt;
            if (stars > 0.0) { vec2 g = floor(d.xz / (d.y + 0.35) * 180.0); float st = step(0.9965, h21(g)) * smoothstep(0.05, 0.4, h); col += vec3(st) * stars * 0.9; }
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        }`,
    });
    this.skyMat = mat;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat); this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  // ---------- 잔디 ----------
  buildGround() {
    const { W, L, HW, HL } = PITCH;
    const TW = W + 18, TL = L + 22; // 펜스 안쪽 전체
    this.ground = { TW, TL };
    const macro = TX.pitchMacro(W, L, TW, TL);
    // 경기장 잔디: 사진 잔디 2번(크기·각도 다르게) 섞어 반복 무늬를 숨기고, 깎은 줄무늬는 보는 방향에 따라 밝기가 바뀐다(실제 잔디처럼)
    const mat = this.pitchMat = new THREE.MeshStandardMaterial({ color: '#4f8a3a', roughness: .96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.macroMap = { value: macro };
      sh.uniforms.field = { value: new THREE.Vector2(HW, HL) };
      sh.vertexShader = 'varying vec3 vPos; varying vec2 vUv0;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vUv0 = uv;');
      sh.fragmentShader = 'uniform sampler2D macroMap; uniform vec2 field; varying vec3 vPos; varying vec2 vUv0;\n' + sh.fragmentShader.replace('#include <map_fragment>',
        `#ifdef USE_MAP
           vec3 g1 = texture2D(map, vMapUv).rgb;
           vec3 g2 = texture2D(map, mat2(0.866, 0.5, -0.5, 0.866) * vMapUv * 0.29 + 0.37).rgb;
           diffuseColor.rgb *= mix(g1, g2, 0.42) * vec3(0.92, 1.0, 0.9);
         #endif
         diffuseColor.rgb *= texture2D(macroMap, vUv0).rgb;
         float inF = step(abs(vPos.x), field.x + 3.0) * step(abs(vPos.z), field.y);
         float par = mod(floor((vPos.z + field.y) / (field.y / 10.0)), 2.0) * 2.0 - 1.0;
         vec3 V = normalize(vPos - cameraPosition);
         diffuseColor.rgb *= 1.0 + inF * par * (0.035 + 0.085 * clamp(-V.z * 1.8, -1.0, 1.0));`);
    };
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(TW, TL).rotateX(-Math.PI / 2), mat);
    pitch.receiveShadow = true; this.scene.add(pitch);
    // 펜스 바깥 들판 (멀리서 안개 속으로 하늘 사진의 지평선과 이어진다)
    const fm = this.fieldMat = new THREE.MeshStandardMaterial({ color: '#4a6b33', roughness: 1, metalness: 0 });
    fm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
        `#ifdef USE_MAP
           vec3 a = texture2D(map, vMapUv).rgb, b = texture2D(map, vMapUv * 0.123 + 0.5).rgb;
           diffuseColor.rgb *= mix(a, b, 0.5) * vec3(0.95, 0.97, 0.85);
         #endif`);
    };
    const field = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), fm);
    field.position.y = -0.04; field.receiveShadow = false; this.scene.add(field);
  }

  // ---------- 라인·코너 깃발 ----------
  buildPitchLines() {
    const { HW, HL } = PITCH;
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
      strip(circle(0, g + i * 11, 9.15, (s > 0 ? Math.PI : 0) - a0, (s > 0 ? Math.PI : 0) + a0, 30));
      for (const cx of [-1, 1]) { // 코너 아크: 경기장 안쪽 사분면
        const t0 = cx > 0 ? (s > 0 ? Math.PI : Math.PI * 1.5) : (s > 0 ? Math.PI * 0.5 : 0);
        strip(circle(cx * HW, g, 1, t0, t0 + Math.PI / 2, 10));
      }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const nrm = new Float32Array(P.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    lg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    // 잔디 위에 칠한 페인트: 살짝 비치게
    const lines = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: '#f1f2ec', roughness: .9, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    lines.position.y = 0.012; lines.receiveShadow = true; this.scene.add(lines);

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
    const post = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .3, metalness: .15 });
    const netTex = TX.netTexture();
    const netMat = (rx, ry) => { const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ map: t, color: '#f2f2f2', transparent: true, alphaTest: .25, side: THREE.DoubleSide, roughness: 1, depthWrite: false }); };
    const W = 7.32, H = 2.44, D = 2.0;
    this.goals = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group(); g.position.z = s * HL;
      const cyl = (len, x, y, z, rx, rz) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 14), post); m.position.set(x, y, z); m.rotation.set(rx || 0, 0, rz || 0); m.castShadow = true; g.add(m); return m; };
      cyl(H, -W / 2, H / 2, 0); cyl(H, W / 2, H / 2, 0); cyl(W + 0.12, 0, H, 0, 0, Math.PI / 2);
      const thin = (len, x, y, z, rx, rz) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 8), post); m.position.set(x, y, z); m.rotation.set(rx || 0, 0, rz || 0); g.add(m); };
      thin(W, 0, 0.03, s * D, 0, Math.PI / 2); thin(D, -W / 2, 0.03, s * D / 2, Math.PI / 2); thin(D, W / 2, 0.03, s * D / 2, Math.PI / 2);
      thin(Math.hypot(D, H), -W / 2, H / 2, s * D / 2, -s * Math.atan2(D, H)); thin(Math.hypot(D, H), W / 2, H / 2, s * D / 2, -s * Math.atan2(D, H));
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

  // ---------- 철망 펜스 (골대 뒤는 높은 공막이 그물) ----------
  buildFences() {
    const { TW, TL } = this.ground;
    const X = TW / 2, Z = TL / 2;
    const link = TX.chainLink();
    // 멀리서는 철망이 반투명 막처럼 보이도록 알파 섞기 (alphaTest 면 멀리서 사라지고 기둥만 남는다)
    const mat = (w, h) => { const t = link.clone(); t.needsUpdate = true; t.repeat.set(w / 0.5, h / 0.5); return new THREE.MeshStandardMaterial({ alphaMap: t, color: '#55705c', transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide, roughness: .6, metalness: .3 }); };
    const posts = [];
    const panel = (x1, z1, x2, z2, h) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), mat(len, h));
      m.position.set((x1 + x2) / 2, h / 2, (z1 + z2) / 2); m.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
      this.scene.add(m);
      const n = Math.max(1, Math.round(len / 3));
      for (let i = 0; i <= n; i++) posts.push([x1 + (x2 - x1) * i / n, z1 + (z2 - z1) * i / n, h]);
    };
    const lo = 2.2, hi = 7;
    panel(-X, -Z, -X, Z, lo); panel(X, -Z, X, Z, lo);
    for (const s of [-1, 1]) { panel(-X, s * Z, -16, s * Z, lo); panel(-16, s * Z, 16, s * Z, hi); panel(16, s * Z, X, s * Z, lo); }
    const pg = new THREE.CylinderGeometry(0.03, 0.03, 1, 6).translate(0, 0.5, 0);
    const pi = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: '#9aa39c', roughness: .45, metalness: .6 }), posts.length);
    const o = new THREE.Object3D();
    posts.forEach(([x, z, h], i) => { o.position.set(x, 0, z); o.scale.set(1, h + 0.05, 1); o.updateMatrix(); pi.setMatrixAt(i, o.matrix); });
    this.scene.add(pi);
  }

  // ---------- 광고판 (인쇄 현수막) ----------
  buildBoards() {
    const { HW, HL } = PITCH;
    const tex = TX.ledBoard([
      { text: 'FOOTBALL BRAIN', bg: '#0b1428', fg: '#ffc93c' },
      { text: '하프타임 부모 상담소', bg: '#16264a', fg: '#ffffff', font: '400 54px "Black Han Sans","Noto Sans KR",sans-serif' },
      { text: 'SCAN · CALL · PASS', bg: '#ffc93c', fg: '#0b1428' },
      { text: '@halftime.parenttalk', bg: '#d93a2b', fg: '#ffffff' },
    ], { led: false });
    tex.anisotropy = this.aniso;
    const H = 0.92;
    const backM = new THREE.MeshStandardMaterial({ color: '#1a202b', roughness: .8 });
    const board = (len, x, z, ry) => {
      const t = tex.clone(); t.needsUpdate = true; t.repeat.set(len / 38, 1);
      const front = new THREE.MeshStandardMaterial({ map: t, roughness: .55 });
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
      const box = new THREE.Mesh(new THREE.BoxGeometry(len, H, 0.1), backM); box.position.y = H / 2; box.castShadow = true; g.add(box);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(len, H * 0.88), front); f.position.set(0, H / 2, 0.055); g.add(f);
      this.scene.add(g);
    };
    board(96, -(HW + 4.5), 0, Math.PI / 2); board(96, HW + 4.5, 0, -Math.PI / 2);
    board(26, -17, -(HL + 4.2), 0); board(26, 17, -(HL + 4.2), 0);
    board(26, -17, HL + 4.2, Math.PI); board(26, 17, HL + 4.2, Math.PI);
  }

  // ---------- 벤치 (투명 지붕 덕아웃) ----------
  buildDugouts() {
    const { HW } = PITCH;
    const frame = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: .35, metalness: .7 });
    const glass = new THREE.MeshStandardMaterial({ color: '#a9c4d8', roughness: .08, metalness: .1, transparent: true, opacity: .32, side: THREE.DoubleSide, depthWrite: false });
    const seat = new THREE.MeshStandardMaterial({ color: '#16264a', roughness: .5 });
    for (const z of [-8, 8]) {
      const g = new THREE.Group(); g.position.set(-(HW + 6.6), 0, z); g.rotation.y = Math.PI / 2;
      const W = 6, D = 1.7, H = 2.1;
      const bar = (w, h, d, x, y, zz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frame); m.position.set(x, y, zz); m.castShadow = true; g.add(m); };
      for (const x of [-W / 2, W / 2]) { bar(.06, H, .06, x, H / 2, -D / 2); bar(.06, H * .8, .06, x, H * .4, D / 2); }
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(W, D + .2), glass); roof.rotation.x = -Math.PI / 2 + 0.12; roof.position.set(0, H * .92, 0); g.add(roof);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), glass); back.position.set(0, H / 2, -D / 2); g.add(back);
      for (const x of [-W / 2, W / 2]) { const sd = new THREE.Mesh(new THREE.PlaneGeometry(D, H * .85), glass); sd.rotation.y = Math.PI / 2; sd.position.set(x, H * .43, 0); g.add(sd); }
      const bench = new THREE.Mesh(new THREE.BoxGeometry(W - .4, .42, .5), seat); bench.position.set(0, .21, -D / 2 + .35); bench.castShadow = true; g.add(bench);
      this.scene.add(g);
    }
  }

  // ---------- 부모 응원석 (펜스 밖 왼쪽, 작은 계단 스탠드) ----------
  buildStand() {
    const { TW } = this.ground;
    const x0 = -(TW / 2 + 4.8), rows = 7, depth = .8, rise = .42, len = 54;
    const conc = new THREE.MeshStandardMaterial({ color: '#8a8f97', roughness: .9 });
    const seatM = new THREE.MeshStandardMaterial({ color: '#2a4a8a', roughness: .6 });
    for (let i = 0; i < rows; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(depth, rise * (i + 1), len), conc);
      step.position.set(x0 - i * depth - depth / 2, rise * (i + 1) / 2, 0); step.receiveShadow = true; this.scene.add(step);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(.32, .06, len - .6), seatM);
      bench.position.set(x0 - i * depth - depth * .62, rise * (i + 1) + .03, 0); this.scene.add(bench);
    }
    const roofY = rows * rise + 3.4;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(rows * depth + 1.6, .14, len + 1), new THREE.MeshStandardMaterial({ color: '#d9dde3', roughness: .5, metalness: .4 }));
    roof.position.set(x0 - rows * depth / 2 + .2, roofY, 0); roof.rotation.z = -0.06; roof.castShadow = true; this.scene.add(roof);
    for (const z of [-len / 2, -len / 6, len / 6, len / 2]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, roofY, 8), new THREE.MeshStandardMaterial({ color: '#b9bec6', metalness: .6, roughness: .4 }));
      c.position.set(x0 - rows * depth + .2, roofY / 2, z); this.scene.add(c);
    }
    // 관중 (한 번에 그리는 인스턴스 납작 인형)
    const dummy = new THREE.Object3D(), mats = [], cols = [], seeds = [];
    const pal = ['#ffc93c', '#16264a', '#f4f6fb', '#d93a2b', '#2e7bd6', '#1b1b1b', '#8a8f9c', '#2fa35a', '#c9a27a', '#5b6b8a'].map(c => new THREE.Color(c));
    let rnd = 4242; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < rows; i++) {
      for (let z = -len / 2 + .5; z < len / 2 - .5; z += .62) {
        if (R() > .5 * this.q.crowd + .05) continue;
        dummy.position.set(x0 - i * depth - depth * .55, rise * (i + 1) + .38, z + (R() - .5) * .2);
        dummy.rotation.set(0, Math.PI / 2, 0);
        const sc = .9 + R() * .18; dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); mats.push(dummy.matrix.clone());
        const c = pal[Math.floor(R() * pal.length)]; cols.push(c.r, c.g, c.b); seeds.push(R());
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
          c *= (0.55 + 0.35 * smoothstep(0.0, 0.7, m.y)) * (0.78 + 0.3 * fract(vSeed * 3.1)) * uLight * 0.8;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const crowd = new THREE.InstancedMesh(pg, this.crowdMat, mats.length);
    mats.forEach((m, i) => crowd.setMatrixAt(i, m));
    this.scene.add(crowd); this.crowdCount = mats.length;
  }

  // ---------- 조명탑 6개 (낮엔 꺼져 있고, 해 질 녘·밤에 켜진다) ----------
  buildFloodlights() {
    const { TW } = this.ground;
    const poleM = new THREE.MeshStandardMaterial({ color: '#9aa1aa', roughness: .4, metalness: .7 });
    const headM = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: .6, metalness: .5 });
    const lampTex = TX.lampPanel();
    this.lampMat = new THREE.MeshStandardMaterial({ map: lampTex, emissiveMap: lampTex, emissive: '#fff5e6', emissiveIntensity: 0, roughness: .35 });
    this.glowMat = new THREE.SpriteMaterial({ map: TX.glowTexture(), color: '#fff3e0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false });
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uAmt: { value: 0 }, uCol: { value: new THREE.Color('#dfe8ff') } },
      vertexShader: `varying float vT; varying float vEdge;
        void main(){ vT = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal); vEdge = abs(dot(n, normalize(-mv.xyz)));
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uAmt; uniform vec3 uCol; varying float vT; varying float vEdge;
        void main(){ float a = pow(vT, 1.6) * pow(vEdge, 1.4) * 0.11 * uAmt; gl_FragColor = vec4(uCol * a, a); }`,
    });
    this.glows = new THREE.Group(); this.beams = new THREE.Group();
    const H = 20, X = TW / 2 + 3;
    for (const sx of [-1, 1]) for (const z of [-40, 0, 40]) {
      const g = new THREE.Group(); g.position.set(sx * X, 0, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.16, .32, H, 10), poleM); pole.position.y = H / 2; pole.castShadow = true; g.add(pole);
      const head = new THREE.Group(); head.position.set(0, H, 0);
      head.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; head.rotateX(0.42); g.add(head);
      const box = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, .3), headM); head.add(box);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), this.lampMat); panel.position.z = .16; head.add(panel);
      this.scene.add(g);
      const hp = new THREE.Vector3(); head.getWorldPosition(hp); g.updateMatrixWorld(true); head.getWorldPosition(hp);
      const s = new THREE.Sprite(this.glowMat); s.position.copy(hp); s.scale.set(16, 16, 1); this.glows.add(s);
      // 빛줄기 (안개 속 빛기둥 느낌)
      const tgt = new THREE.Vector3(-sx * 6, 0, z * 0.75);
      const dir = tgt.clone().sub(hp); const len = dir.length(); dir.normalize();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 11, len, 20, 1, true), this.beamMat);
      beam.position.copy(hp).addScaledVector(dir, len / 2);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      this.beams.add(beam);
    }
    this.scene.add(this.glows); this.scene.add(this.beams);
  }
  setFlood(v) {
    this.lampMat.emissiveIntensity = v * 6;
    this.glowMat.opacity = v * .95; this.glows.visible = v > .05;
    this.beamMat.uniforms.uAmt.value = this.tod === 'night' ? v : v * .25; this.beams.visible = v > .05;
  }

  buildBall() {
    this.ballMat = new THREE.MeshPhysicalMaterial({ map: TX.ballTexture(), roughness: .4, metalness: 0, clearcoat: .35, clearcoatRoughness: .3 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 48, 32), this.ballMat);
    this.ball.castShadow = true; this.ball.position.set(0, 0.11, -1.4);
    this.scene.add(this.ball);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: TX.blobShadow(), transparent: true, depthWrite: false }));
    sh.position.y = 0.015; this.ballShadow = sh; this.scene.add(sh);
  }

  // 1인칭 발 (FPS 무기처럼 화면 아래에서 들어옴)
  buildBoots() {
    const sock = new THREE.MeshStandardMaterial({ color: '#ffc93c', roughness: .8 });
    const boot = new THREE.MeshStandardMaterial({ color: '#16264a', roughness: .32, metalness: .1 });
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
  // ---------- 날씨 (2.1, 선수 레벨로 해금): 비 · 눈. 알갱이는 경기장에 고정, 카메라 둘레 상자 안에서 되풀이 ----------
  setWeather(kind) {
    const w = kind === 'rain' || kind === 'snow' ? kind : 'clear';
    if (w === this.weather && (w === 'clear' || this.wx)) return;
    this.weather = w;
    if (this.wx) { this.scene.remove(this.wx); this.wx.geometry.dispose(); this.wx.material.dispose(); this.wx = null; }
    if (w !== 'clear') {
      const rain = w === 'rain', N = rain ? 1300 : 900, B = { x: 34, y: 14, z: 34 };
      const seed = new Float32Array(N * 3), g = new THREE.BufferGeometry();
      for (let i = 0; i < N; i++) { seed[i * 3] = (Math.random() - .5) * B.x; seed[i * 3 + 1] = Math.random() * B.y; seed[i * 3 + 2] = (Math.random() - .5) * B.z; }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * (rain ? 6 : 3)), 3));
      const o = rain ? new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c9d5e6', transparent: true, opacity: .42, depthWrite: false }))
        : new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: .1, map: this.snowTex(), transparent: true, opacity: .95, depthWrite: false }));
      o.frustumCulled = false; o.renderOrder = 3; o.userData = { seed, N, B, rain }; this.wx = o; this.scene.add(o); this.updateWeather(0);
    }
    this.applyTod();
  }
  snowTex() {
    if (this._snow) return this._snow;
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.5, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return (this._snow = new THREE.CanvasTexture(c));
  }
  updateWeather(dt) {
    const o = this.wx; if (!o) return;
    const { seed, N, B, rain } = o.userData, a = o.geometry.attributes.position.array, p = this.rig.position, vy = rain ? 15 : 1.2;
    const W = (v, L) => ((v + L / 2) % L + L) % L - L / 2;
    for (let i = 0; i < N; i++) {
      const j = i * 3; let y = seed[j + 1] - vy * dt; if (y < 0) y += B.y; seed[j + 1] = y;
      if (!rain) seed[j] += Math.sin(this.time * .8 + i) * .35 * dt; // 눈은 살랑살랑
      const x = p.x + W(seed[j] - p.x, B.x), z = p.z + W(seed[j + 2] - p.z, B.z);
      if (rain) { const k = i * 6; a[k] = x; a[k + 1] = y; a[k + 2] = z; a[k + 3] = x + .03; a[k + 4] = y + .55; a[k + 5] = z; }
      else { a[j] = x; a[j + 1] = y; a[j + 2] = z; }
    }
    o.geometry.attributes.position.needsUpdate = true;
  }

  // 2대1 벽 패스: 내 둘레 4.4m 노란 원 (수비가 들어오면 초록)
  buildPressRing() {
    const m = new THREE.Mesh(new THREE.RingGeometry(4.28, 4.5, 80).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffc93c', transparent: true, opacity: .8, depthWrite: false, toneMapped: false, fog: false }));
    m.position.y = .035; m.renderOrder = 2; m.visible = false; this.rig.add(m); this.pressRing = m;
  }
  setPressRing(state) { const m = this.pressRing; if (!m) return; m.visible = !!state; if (state) m.material.color.set(state === 'go' ? '#38d27a' : '#ffc93c'); }
  kickBoot(side, amount = 1) { const b = this.boots[side < 0 ? 0 : 1]; b.userData.kick = 1; b.userData.amt = amount; }

  // ---------- 시간대 ----------
  setTimeOfDay(name) {
    this.tod = TOD[name] ? name : 'day';
    this.applyTod();
    if (!this.envs[this.tod]) this.loadEnv(this.tod);
  }
  applyTod() {
    const T = TOD[this.tod], E = this.envs[this.tod], photo = !!(E && E.ready);
    const u = this.skyMat.uniforms;
    u.hasMap.value = photo ? 1 : 0;
    if (photo) { u.map.value = E.sky; u.crop.value = E.m.crop; u.yaw.value = E.yaw; }
    u.top.value.set(T.top); u.hor.value.set(T.hor); u.sunCol.value.set(T.sun); u.sunAmt.value = T.sunDisk; u.stars.value = T.stars;
    // 해 (밤에는 조명탑 쪽에서 오는 빛)
    this.sunDir = (photo && this.tod !== 'night') ? E.sunDir.clone() : new THREE.Vector3(...T.dir).normalize();
    if (this.sunDir.y < 0.3) { this.sunDir.y = 0.3; this.sunDir.normalize(); } // 해가 너무 낮으면 그림자가 끝없이 길어진다
    u.sunDir.value.copy(this.sunDir);
    if (photo && this.tod !== 'night') this.sun.color.setRGB(...E.m.sunColor); else this.sun.color.set(T.sun);
    this.sun.intensity = T.sunI;
    // 하늘빛 조명 (사진 하늘에서)
    this.scene.environment = photo ? E.env : null;
    this.scene.environmentIntensity = T.envI;
    this.scene.environmentRotation.set(0, photo ? E.yaw : 0, 0);
    this.hemi.color.set(T.hs); this.hemi.groundColor.set(T.hg);
    this.hemi.intensity = photo ? (T.fill ?? 0) : T.hI; // 역광일 때 선수가 까맣게 보이지 않게 보조광
    // 안개: three.js 는 화면 색(sRGB)으로 바꾼 뒤 안개를 섞으므로 sRGB 값을 그대로 넣는다
    const f = this.scene.fog.color;
    if (photo) {
      const fc = T.mist ? E.m.fog.map((c, i) => c * .3 + T.mist[i] * .7) : E.m.fog;
      f.setRGB(fc[0], fc[1], fc[2], THREE.LinearSRGBColorSpace);
    } else f.set(T.fog).convertLinearToSRGB();
    u.fogCol.value.copy(f);
    this.scene.fog.near = T.fogN; this.scene.fog.far = T.fogF;
    this.renderer.toneMappingExposure = 1;
    // 날씨 (2.1): 비는 어둡고 안개가 가깝게, 눈은 하얀 안개
    if (this.weather === 'rain') { this.scene.fog.near *= .45; this.scene.fog.far *= .4; this.sun.intensity *= .4; this.renderer.toneMappingExposure = .84; f.lerp(new THREE.Color('#7d8794'), .5); }
    else if (this.weather === 'snow') { this.scene.fog.near *= .5; this.scene.fog.far *= .5; this.sun.intensity *= .65; f.lerp(new THREE.Color('#e3e9f0'), .55); }
    u.fogCol.value.copy(f);
    this.setFlood(T.flood);
    this.crowdMat.uniforms.uLight.value = T.crowd;
  }

  // 슛 장면: 골대 폭(halfW, m)이 거리 dist 에서 화면 폭의 frac 만큼 차게 하는 확대 배율
  zoomToFit(halfW, dist, frac = .88) {
    const hHalf = Math.tan(this.baseFov * Math.PI / 360) * this.camera.aspect;
    return Math.max(1, Math.min(1.5, hHalf / (halfW / dist / frac)));
  }
  setZoom(z, snap = false) { this.zoomTarget = z; if (snap) { this.zoom = z; this.applyFov(); } }
  applyFov() {
    this.camera.fov = 2 * Math.atan(Math.tan(this.baseFov * Math.PI / 360) / this.zoom) * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
  }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); } // 골이 들어갈 때 화면 흔들림

  setExcite(v, hold = 0) { this.excite = Math.max(this.excite, v); this.exciteHold = hold; }

  resize() {
    const w = window.innerWidth || 390, h = window.innerHeight || 844; // 2.5: 화면 크기가 0(숨은 탭·전환 중)이면 폰 비율로 — 0/0 이면 선수 자리가 NaN 이 된다
    this.renderer.setSize(w, h, false);
    const asp = w / h; this.camera.aspect = asp;
    if (asp < 1) { // 세로 화면: 가로 시야 ~52°, 세로 최대 92°
      const hf = 54 * Math.PI / 180;
      this.baseFov = Math.min(92, 2 * Math.atan(Math.tan(hf / 2) / asp) * 180 / Math.PI);
      this.pitchDown = -0.27;
    } else { this.baseFov = 58; this.pitchDown = -0.16; }
    this.applyFov();
  }
  setDpr(d) { this.dpr = d; this.renderer.setPixelRatio(d); this.resize(); }

  update(dt) {
    this.time += dt;
    if (this.exciteHold > 0) this.exciteHold -= dt; else this.excite += (this.exciteTarget - this.excite) * Math.min(1, dt * 1.2);
    this.crowdMat.uniforms.uTime.value = this.time; this.crowdMat.uniforms.uExcite.value = this.excite;
    this.flags.forEach((f, i) => { f.rotation.y = Math.sin(this.time * 2 + i * 1.7) * .25; });
    // 하늘·그림자 카메라 따라가기
    const p = this.rig.position;
    this.sky.position.copy(p);
    const fwd = new THREE.Vector3(0, 0, -12).applyQuaternion(this.rig.quaternion);
    this.sun.target.position.set(p.x + fwd.x, 0, p.z + fwd.z);
    this.sun.position.set(this.sun.target.position.x + this.sunDir.x * 90, this.sunDir.y * 90, this.sun.target.position.z + this.sunDir.z * 90);
    this.camera.rotation.x = this.pitchDown;
    if (Math.abs(this.zoomTarget - this.zoom) > 1e-3) { this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 3.2); this.applyFov(); }
    if (this.shakeAmt > 0.002) {
      this.shakeAmt *= Math.pow(0.004, dt);
      this.camera.position.set((Math.random() - .5) * this.shakeAmt, EYE + (Math.random() - .5) * this.shakeAmt, 0);
    } else if (this.shakeAmt) { this.shakeAmt = 0; this.camera.position.set(0, EYE, 0); }
    for (const b of this.boots) {
      const u = b.userData;
      if (u.kick > 0) {
        u.kick = Math.max(0, u.kick - dt * 3.2);
        const k = Math.sin((1 - u.kick) * Math.PI) * (u.amt || 1);
        b.position.set(u.base.x - u.side * 0.06 * k, 0.02 * k, u.base.z - 1.15 * k);
        b.rotation.x = -0.5 * k;
      } else b.position.lerp(u.base, Math.min(1, dt * 10));
    }
    this.updateWeather(dt);
    this.ballShadow.position.x = this.ball.position.x; this.ballShadow.position.z = this.ball.position.z;
    const bh = this.ball.position.y; this.ballShadow.scale.setScalar(1 + bh * 0.6); this.ballShadow.material.opacity = Math.max(0.15, 1 - bh * 0.5);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
