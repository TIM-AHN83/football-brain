// 절차적(코드로 그리는) 텍스처 모음 — 외부 이미지 없이 경기장 질감을 만든다
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function rand(seed) { // 결정적 난수 (매번 같은 경기장)
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function finish(c, { repeat = false, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// 잔디: 깎은 줄무늬(길이 방향 20줄) + 경기장 밖 런오프
export function grassStripes(fieldW, fieldL, totalW, totalL) {
  const px = 6; // px per meter
  const [c, g] = canvas(Math.round(totalW * px), Math.round(totalL * px));
  const r = rand(7);
  g.fillStyle = '#2c6e33'; g.fillRect(0, 0, c.width, c.height);
  const x0 = (totalW - fieldW) / 2 * px, z0 = (totalL - fieldL) / 2 * px;
  const bands = 20, bh = fieldL * px / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = i % 2 ? '#3d8a3e' : '#347d37';
    g.fillRect(x0 - 3 * px, z0 + i * bh, fieldW * px + 6 * px, bh + 1);
  }
  // 런오프 줄무늬 연장(살짝 어둡게)
  for (let i = -3; i < bands + 3; i++) {
    if (i >= 0 && i < bands) continue;
    g.fillStyle = i % 2 ? '#357a37' : '#2f7133';
    g.fillRect(0, z0 + i * bh, c.width, bh + 1);
  }
  // 골문 앞·센터 마모 자국
  const wear = (cx, cz, rx, rz, a) => {
    const grd = g.createRadialGradient(cx, cz, 0, cx, cz, Math.max(rx, rz));
    grd.addColorStop(0, `rgba(110,98,60,${a})`); grd.addColorStop(1, 'rgba(110,98,60,0)');
    g.save(); g.translate(cx, cz); g.scale(rx / Math.max(rx, rz), rz / Math.max(rx, rz)); g.translate(-cx, -cz);
    g.fillStyle = grd; g.fillRect(cx - rx * 2, cz - rz * 2, rx * 4, rz * 4); g.restore();
  };
  wear(c.width / 2, z0 + 3 * px, 9 * px, 4 * px, .35);
  wear(c.width / 2, z0 + fieldL * px - 3 * px, 9 * px, 4 * px, .35);
  wear(c.width / 2, c.height / 2, 6 * px, 6 * px, .12);
  // 얼룩
  for (let i = 0; i < 900; i++) {
    const x = r() * c.width, y = r() * c.height, s = 4 + r() * 30;
    g.fillStyle = `rgba(${r() < .5 ? '20,50,20' : '90,130,60'},${.03 + r() * .05})`;
    g.beginPath(); g.ellipse(x, y, s, s * (.4 + r() * .6), r() * 3, 0, 7); g.fill();
  }
  return finish(c, { aniso: 16 });
}

// 잔디 결(반복 타일) — 회색조, 셰이더에서 곱해 쓴다
export function grassDetail() {
  const [c, g] = canvas(256, 256);
  const r = rand(11);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const x = r() * 256, y = r() * 256, l = 2 + r() * 6, v = 90 + r() * 90 | 0;
    g.strokeStyle = `rgba(${v},${v},${v},.55)`; g.lineWidth = .7 + r() * .8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 2, y - l); g.stroke();
  }
  // 타일 경계 매끄럽게: 가장자리 복사
  const img = g.getImageData(0, 0, 256, 256);
  g.globalAlpha = .5; g.drawImage(c, 128, 0, 128, 256, 0, 0, 128, 256); g.drawImage(c, 0, 0, 128, 256, 128, 0, 128, 256); g.globalAlpha = 1;
  void img;
  return finish(c, { repeat: true, srgb: false, aniso: 16 });
}

// 관중석 계단 의자 (색 블록)
export function seatTexture(primary = '#16264a', accent = '#ffc93c') {
  const [c, g] = canvas(512, 64);
  for (let i = 0; i < 32; i++) {
    g.fillStyle = (i % 8 === 0) ? accent : primary;
    g.fillRect(i * 16 + 1, 8, 14, 40);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(i * 16 + 1, 44, 14, 6);
  }
  return finish(c, { repeat: true });
}

// LED 광고판 — 가로로 흐르는 글자
export function ledBoard(messages) {
  const [c, g] = canvas(2048, 96);
  const segW = c.width / messages.length;
  messages.forEach((m, i) => {
    g.fillStyle = m.bg; g.fillRect(i * segW, 0, segW, 96);
    g.fillStyle = m.fg;
    g.font = m.font || 'italic 800 58px "Barlow Condensed","Arial Narrow",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(m.text, i * segW + segW / 2, 50);
  });
  // LED 도트 격자
  g.fillStyle = 'rgba(0,0,0,.22)';
  for (let y = 0; y < 96; y += 4) g.fillRect(0, y, c.width, 1);
  for (let x = 0; x < c.width; x += 4) g.fillRect(x, 0, 1, 96);
  return finish(c, { repeat: true });
}

// 유니폼: CylinderGeometry UV 기준 u=0 앞, u=0.5 등
export function jersey(kit, number, { blank = false } = {}) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = kit.shirt; g.fillRect(0, 0, 256, 256);
  // 옆구리 라인과 미세 패턴
  g.fillStyle = kit.trim;
  g.fillRect(56, 0, 8, 256); g.fillRect(192, 0, 8, 256);
  g.fillStyle = 'rgba(255,255,255,.05)';
  for (let y = 0; y < 256; y += 6) g.fillRect(0, y, 256, 2);
  // 목 칼라
  g.fillStyle = kit.trim; g.fillRect(0, 0, 256, 10);
  if (!blank && number != null) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 132px "Barlow Condensed","Arial Narrow",sans-serif';
    g.lineWidth = 10; g.strokeStyle = kit.numStroke; g.strokeText(String(number), 128, 128);
    g.fillStyle = kit.num; g.fillText(String(number), 128, 128);
    g.font = '800 44px "Barlow Condensed","Arial Narrow",sans-serif';
    g.lineWidth = 5; g.strokeText(String(number), 0, 92); g.fillText(String(number), 0, 92);
    g.strokeText(String(number), 256, 92); g.fillText(String(number), 256, 92);
  }
  return finish(c, { aniso: 4 });
}

// 머리 위 등번호 배지
export function badge(number, color = '#ffc93c', fg = '#0b1428') {
  const [c, g] = canvas(128, 128);
  g.fillStyle = color;
  g.beginPath(); g.moveTo(24, 6); g.lineTo(104, 6); g.lineTo(122, 24); g.lineTo(122, 98); g.lineTo(64, 124); g.lineTo(6, 98); g.lineTo(6, 24); g.closePath(); g.fill();
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 76px "Barlow Condensed","Arial Narrow",sans-serif';
  g.fillText(String(number), 64, 62);
  return finish(c, { aniso: 1 });
}

// 발밑 링
export function ringTexture() {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 30, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(.55, 'rgba(255,255,255,.95)');
  grd.addColorStop(.75, 'rgba(255,255,255,.95)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return finish(c, { aniso: 1 });
}

// 부드러운 빛 번짐 (조명 글로우)
export function glowTexture() {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(.18, 'rgba(255,250,235,.85)');
  grd.addColorStop(.45, 'rgba(255,240,210,.22)'); grd.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return finish(c, { aniso: 1 });
}

// 발밑 그림자 (블롭)
export function blobShadow() {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return finish(c, { aniso: 1, srgb: false });
}

// 축구공: 등장방형(equirect) 위에 현대식 패널 디자인
export function ballTexture() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#f4f5f7'; g.fillRect(0, 0, 512, 256);
  const r = rand(3);
  const blob = (cx, cy, s, col) => {
    g.fillStyle = col; g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + .3;
      const x = cx + Math.cos(a) * s * 1.25, y = cy + Math.sin(a) * s * .9; // 위아래 압축 보정
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.fill();
  };
  const spots = [[64, 128], [192, 128], [320, 128], [448, 128], [0, 128], [512, 128], [128, 40], [384, 40], [128, 216], [384, 216], [256, 40], [256, 216], [0, 40], [512, 40], [0, 216], [512, 216]];
  spots.forEach(([x, y], i) => blob(x, y, 22 + r() * 4, i % 3 === 0 ? '#ffc93c' : '#16264a'));
  // 솔기
  g.strokeStyle = 'rgba(30,40,60,.35)'; g.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    g.beginPath(); const x = r() * 512, y = r() * 256; g.moveTo(x, y);
    g.quadraticCurveTo(x + (r() - .5) * 120, y + (r() - .5) * 80, x + (r() - .5) * 160, y + (r() - .5) * 90); g.stroke();
  }
  // 극지방 단색
  g.fillStyle = '#16264a'; g.fillRect(0, 0, 512, 8); g.fillRect(0, 248, 512, 8);
  return finish(c, { aniso: 4 });
}

// 골망
export function netTexture() {
  const [c, g] = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  return finish(c, { repeat: true, aniso: 4 });
}

// 하늘에 깔 구름 띠
export function cloudTexture() {
  const [c, g] = canvas(1024, 256);
  const r = rand(21);
  g.clearRect(0, 0, 1024, 256);
  for (let i = 0; i < 140; i++) {
    const x = r() * 1024, y = 60 + r() * 140, s = 20 + r() * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    grd.addColorStop(0, `rgba(255,255,255,${.12 + r() * .18})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(x, y, s * 2.2, s * .6, 0, 0, 7); g.fill();
  }
  return finish(c, { repeat: true, aniso: 1 });
}
