// 화면·HUD·결과 리포트·랭킹 표시
import { AGE_LABEL } from './store.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const AXES = [['judge', '판단'], ['speed', '속도'], ['vision', '시야'], ['call', '콜'], ['scan', '스캔'], ['brake', '멈춤']];
// 코치 한마디: 가장 약한 능력 → 운동장에서 바로 해 볼 수 있는 한 가지
const TIPS = {
  judge: '운동장에서: 공을 받기 전에 수비가 없는 친구를 먼저 찾아 두세요. 그러면 받자마자 바로 줄 수 있어요.',
  speed: '운동장에서: 결정이 빠르면 수비가 붙기 전에 패스할 수 있어요. 게임에선 보자마자 손가락이 나가게 연습!',
  vision: '운동장에서: 공만 보지 말고 고개를 들어 양쪽 친구를 한 번에 봐요. 멀리 있는 수비도 놓치지 않기.',
  call: '운동장에서: 패스할 때 "7번!"처럼 친구 이름이나 번호를 크게 불러요. 친구가 미리 준비할 수 있어요.',
  scan: '운동장에서: 공이 오기 전에 어깨 너머로 왼쪽·오른쪽을 한 번씩 봐요. 받기 직전에 한 번 더 보면 더 좋아요.',
  brake: '운동장에서: 급할수록 한 번 멈추고 보면 실수가 줄어요. 휘슬이 울리면 바로 멈추는 습관도!',
};
// 새 기술 카드 (레벨에서 처음 나올 때 한 번): 제목 · 하는 법 · 진짜 경기에서
const TEACH = {
  pass: { tag: '기본 기술', title: '빈 친구에게 패스', how: '빨간 수비수가 막은 친구 말고, <em>비어 있는 친구 쪽</em> 화면을 눌러요.', real: '진짜 경기: 수비가 없는 친구에게 주면 공을 뺏기지 않아요.' },
  scan: { tag: '새 기술 · 레벨 2', title: '둘러보기 👀', how: '공이 오기 전에 <em>화면 왼쪽·오른쪽을 꾹</em> 눌러 양옆을 봐요 (폰을 돌려도 돼요). 머리 위 <em>✔ = 빈 친구</em>, ✖ = 막힌 친구. 공이 오면 ✔ 쪽을 톡!', real: '진짜 경기: 공 받기 전에 고개를 돌려 본 선수가 받자마자 좋은 패스를 해요.' },
  blind: { tag: '레벨 업 · 레벨 3', title: '기억으로 패스 🧠', how: '이제 공이 발에 오면 <em>화면이 가려져요</em>. 미리 봐 둔 <em>✔ 친구 쪽</em>을 눌러요.', real: '진짜 경기: 공을 받는 순간엔 공을 봐야 해요. 그래서 미리 봐 둔 그림으로 패스해요.' },
  both: { tag: '새 기술 · 레벨 4', title: '드리블 돌파 💨', how: '양쪽 친구가 <em>둘 다 막히면</em> 줄 곳이 없어요. <em>화면 가운데</em>를 눌러 앞으로 치고 나가요.', real: '진짜 경기: 줄 곳이 없으면 억지로 패스하지 말고, 공을 몰고 빈 공간으로!' },
  switch: { tag: '레벨 업 · 레벨 5', title: '수비가 움직여요 🔄', how: '둘러보는 사이 수비가 <em>다른 친구에게 옮겨 붙을</em> 수 있어요. 공이 오기 직전에 <em>한 번 더</em> 봐요.', real: '진짜 경기: 잘하는 선수는 공 받기 직전에 마지막으로 한 번 더 봐요.' },
  shot: { tag: '마무리', title: '1:1 슛 🥅', how: '공을 골대 <em>구석 쪽으로 쓸어 올려요</em>. 빠르게 쓸수록 세게! 골키퍼가 한쪽으로 기울면 <em>반대 구석</em>.', real: '진짜 경기: 골키퍼가 먼저 움직이면 반대쪽이 비어요.' },
  whistle: { tag: '훈련 규칙', title: '휘슬엔 멈춤 🔔', how: '휘슬이 울리면 <em>아무것도 누르지 말고</em> 기다려요.', real: '진짜 경기: 휘슬이 울리면 바로 멈춰요. 급할 때 멈추는 힘이 실수를 줄여요.' },
};
export function grade(bi) { return bi >= 90 ? '월드클래스' : bi >= 75 ? '국가대표' : bi >= 60 ? '주전' : bi >= 40 ? '유망주' : '루키'; }

export class UI {
  constructor() {
    this.el = {
      hud: $('#hud'), score: $('#hud-score'), level: $('#hud-level'), combo: $('#hud-combo'), lives: $('#hud-lives'), attack: $('#hud-attack'),
      callout: $('#hud-callout'), center: $('#hud-center'), pop: $('#hud-pop'), voice: $('#hud-voice'), timer: $('#hud-timer'), timerBar: $('#hud-timer i'),
      hint: $('#hud-hint'), zone: $('#fx-zone'), blind: $('#fx-blind'), map: $('#scan-map'), tut: $('#tut-card'), tutSwipe: $('#tut-swipe'),
      teach: $('#teach'), chipL: $('#chip-l'), chipR: $('#chip-r'), feet: $('#m-feet'), mic: $('#m-mic'), mot: $('#mot-choices'), edgeL: $('#fx-edge-l'), edgeR: $('#fx-edge-r'), flash: $('#fx-flash'), toast: $('#toast'),
    };
    this._feet = -1;
  }
  // 화면 전환: go = 주 화면(나머지 닫기), open/close = 위에 겹치는 시트
  go(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === id)); }
  open(id) { $('#' + id).classList.add('show'); const f = $('#' + id).querySelector('input:not([type=checkbox])'); if (f && !matchMedia('(pointer:coarse)').matches) setTimeout(() => f.focus({ preventScroll: true }), 50); }
  close(id) { $('#' + id).classList.remove('show'); }
  isOpen(id) { return $('#' + id).classList.contains('show'); }

  hud(on) { this.el.hud.hidden = !on; if (!on) { this.el.voice.classList.remove('show'); this.el.callout.classList.remove('show'); } }
  setScore(n) { this.el.score.textContent = Math.round(n).toLocaleString('ko-KR'); }
  setLevel(n) { this.el.level.textContent = n; }
  setCombo(m) { const on = m > 1.05; this.el.combo.hidden = !on; if (on) this.el.combo.textContent = 'x' + m.toFixed(1); }
  setLives(n, max) { this.el.lives.innerHTML = max ? Array.from({ length: max }, (_, i) => `<i class="${i < n ? '' : 'lost'}"></i>`).join('') : ''; }
  attack(total, idx) {
    if (!total) { this.el.attack.innerHTML = ''; return; }
    let h = ''; for (let i = 0; i < total; i++) h += `<i class="${i < idx ? 'done' : i === idx ? 'cur' : ''}"></i>`;
    h += `<i class="goal" style="${idx >= total ? 'background:var(--sun);border-color:var(--sun)' : ''}"></i>`;
    this.el.attack.innerHTML = h;
  }
  callout(text, cls = '', ms = 1200) {
    const c = this.el.callout; c.textContent = text; c.className = 'callout show ' + cls;
    clearTimeout(this._co); this._co = setTimeout(() => c.classList.remove('show'), ms);
  }
  center(text, cls = '') {
    const c = this.el.center; c.className = 'hud-center'; void c.offsetWidth; c.textContent = text; c.className = 'hud-center show ' + cls;
    clearTimeout(this._ce); this._ce = setTimeout(() => { c.className = 'hud-center'; }, 950);
  }
  pop(text, cls = '') {
    const p = document.createElement('div'); p.className = 'pop ' + cls; p.textContent = text;
    this.el.pop.appendChild(p); setTimeout(() => p.remove(), 1150);
    while (this.el.pop.children.length > 4) this.el.pop.firstChild.remove();
  }
  voice(text, ok) {
    const v = this.el.voice; v.textContent = '🎙 ' + text; v.classList.add('show'); v.classList.toggle('ok', !!ok);
    clearTimeout(this._vo); this._vo = setTimeout(() => v.classList.remove('show'), 1600);
  }
  timer(frac) {
    if (frac == null) { this.el.timer.classList.remove('show'); return; }
    this.el.timer.classList.add('show'); this.el.timerBar.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  }
  edges(on) { this.el.edgeL.classList.toggle('on', on); this.el.edgeR.classList.toggle('on', on); }
  flash(bad) { const f = this.el.flash; f.classList.toggle('bad', !!bad); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60); }
  feet(frac) {
    if (frac == null) { if (this._feet !== -2) { this.el.feet.hidden = true; this._feet = -2; } return; }
    if (Math.abs(frac - this._feet) < .03) return;
    this._feet = frac; this.el.feet.hidden = false; this.el.feet.querySelector('i').style.setProperty('--v', Math.round(frac * 100) + '%');
  }
  mic(state) { const m = this.el.mic; m.hidden = !state || state === 'off'; m.classList.toggle('live', state === 'live'); m.classList.toggle('hear', state === 'hear'); }
  // 아래 안내 줄 = 누르는 자리 (2칸: 왼쪽·오른쪽, 3칸: 왼쪽·가운데·오른쪽)
  hint(mode, zones = 2) {
    const h = this.el.hint;
    h.hidden = mode === 'mot'; this._zones = zones;
    if (mode === 'shot') { h.className = 'hint z1 shot'; h.innerHTML = '<span data-z="S">↑ 골대 쪽으로 쓸어 올려 슛 · 빠르게 쓸수록 세고 높게</span>'; return; }
    h.className = 'hint z' + zones + (mode === 'shot' ? ' shot' : '');
    const cells = mode === 'shot' ? [['L', '← 왼쪽 슛'], ['C', '↑ 칩슛'], ['R', '오른쪽 슛 →']]
      : zones === 3 ? [['L', '← 왼쪽 패스'], ['C', '↑ 돌파'], ['R', '오른쪽 패스 →']] : [['L', '← 왼쪽 패스'], ['R', '오른쪽 패스 →']];
    h.innerHTML = cells.map(([z, t]) => `<span data-z="${z}">${t}</span>`).join('');
  }
  // 누른 칸을 잠깐 밝힌다 (어느 칸이 눌렸는지 바로 보이게)
  zoneFlash(zone, zones) {
    const c = this.el.hint.querySelector(`[data-z="${zone}"]`);
    if (c) { c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit'); }
    const f = this.el.zone; if (!f) return;
    const [a, b] = zones === 3 ? (zone === 'L' ? [0, 35] : zone === 'C' ? [35, 65] : [65, 100]) : (zone === 'L' ? [0, 50] : [50, 100]);
    f.style.left = a + '%'; f.style.width = (b - a) + '%';
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }
  // 30초 따라 하기: 단계 안내 카드 (null 이면 숨김)
  tut(step) {
    const c = this.el.tut; if (!c) return;
    this.el.hud.classList.toggle('tut', step != null);
    if (step == null) { c.hidden = true; this.el.tutSwipe.hidden = true; return; }
    const S = [
      ['패스', '빨간 수비수가 없는 쪽, <em>빈 친구</em> 쪽 화면을 눌러요'],
      ['번쩍 패스', '이번엔 수비수가 <em>잠깐만</em> 보여요. 잘 보고 빈 친구 쪽!'],
      ['슛', '공을 골대 <em>구석</em> 쪽으로 손가락으로 쓸어 올려요'],
      ['골키퍼 속이기', '골키퍼가 한쪽으로 <em>기울면</em> 반대 구석으로 차요'],
    ][step];
    c.hidden = false;
    $('#tut-prog').textContent = `${step + 1} / 4`;
    $('#tut-title').textContent = S[0]; $('#tut-text').innerHTML = S[1];
    this.el.tutSwipe.hidden = step < 2;
  }
  tutPulse(zone) { this.el.hint.querySelector(`[data-z="${zone}"]`)?.classList.add('pulse'); }
  // 새 기술 카드: 그림 + 하는 법 + 진짜 경기에서. onGo = '해 볼게요!' (null 이면 숨김)
  teach(rule, onGo) {
    const t = this.el.teach; if (!t) return;
    if (!rule) { t.hidden = true; return; }
    const c = TEACH[rule] || TEACH.pass;
    $('#teach-tag').textContent = c.tag; $('#teach-title').textContent = c.title;
    $('#teach-how').innerHTML = c.how; $('#teach-real').textContent = '⚽ ' + c.real;
    drawTeach($('#teach-cv'), rule);
    t.hidden = false;
    const go = $('#teach-go'); go.onclick = () => { go.onclick = null; t.hidden = true; onGo && onGo(); };
  }
  // 둘러보기: 화면 양쪽 '꾹 = 그쪽 보기' 칩, 본 쪽은 초록 ✔ (null 이면 숨김)
  scanChips(st) {
    const L = this.el.chipL, R = this.el.chipR; if (!L) return;
    if (!st) { L.hidden = R.hidden = true; return; }
    L.hidden = R.hidden = false;
    L.classList.toggle('seen', !!st.l); R.classList.toggle('seen', !!st.r);
    L.classList.toggle('nudge', !!st.nudge && !st.l); R.classList.toggle('nudge', !!st.nudge && !st.r);
    L.innerHTML = st.l ? '✔ 왼쪽 봤어요' : '◀ 꾹<br>왼쪽 보기'; R.innerHTML = st.r ? '오른쪽 봤어요 ✔' : '꾹 ▶<br>오른쪽 보기';
  }
  // 슛: 쓸어 올린 자국
  swipeTrail(sw) {
    if (sw.x0 == null) return;
    const d = document.createElement('div'), dx = sw.x1 - sw.x0, dy = sw.y1 - sw.y0;
    d.className = 'swipe-trail';
    d.style.cssText = `left:${sw.x0}px;top:${sw.y0}px;width:${Math.hypot(dx, dy)}px;transform:rotate(${Math.atan2(dy, dx)}rad)`;
    this.el.hud.appendChild(d); setTimeout(() => d.remove(), 500);
  }
  // 둘러보기 패스: 공을 받는 순간 화면 가리기
  blind(on) {
    const b = this.el.blind; if (!b) return;
    clearTimeout(this._cut1); clearTimeout(this._cut2); b.classList.remove('cut'); // 장면 넘기기 중이었다면 그만
    b.classList.toggle('on', !!on);
  }
  cut() { // 장면 넘기기: 0.1초 어두워졌다 밝아진다
    const b = this.el.blind; if (!b) return;
    clearTimeout(this._cut1); clearTimeout(this._cut2);
    b.classList.add('on', 'cut');
    this._cut1 = setTimeout(() => b.classList.remove('on'), 110); this._cut2 = setTimeout(() => b.classList.remove('cut'), 500);
  }
  // 정답 미니맵 (위에서 본 그림): 나·친구·수비 자리, 내가 둘러본 범위, 내 패스
  scanMap(m, ms = 2200) {
    const cv = this.el.map; if (!cv) return;
    const g = cv.getContext('2d'), sc = cv.width / 240;
    g.setTransform(sc, 0, 0, sc, 0, 0); g.clearRect(0, 0, 240, 230);
    g.fillStyle = 'rgba(11,20,40,.93)'; g.beginPath(); g.roundRect ? g.roundRect(1, 1, 238, 228, 10) : g.rect(1, 1, 238, 228); g.fill();
    g.strokeStyle = m.ok ? 'rgba(61,220,132,.8)' : 'rgba(255,77,58,.8)'; g.lineWidth = 2; g.stroke();
    const cx = 120, cy = 140, k = 6.4, P = (x, z) => [cx + x * k, cy + z * k]; // z 가 음수 = 앞(위쪽)
    // 내가 본 범위: 둘러본 방향(가장 왼쪽~가장 오른쪽) + 화면 폭
    const a0 = m.yawMin - m.hHalf, a1 = m.yawMax + m.hHalf, R = 100;
    g.beginPath(); g.moveTo(cx, cy);
    for (let i = 0; i <= 48; i++) { const b = a0 + (a1 - a0) * i / 48; g.lineTo(cx - Math.sin(b) * R, cy - Math.cos(b) * R); }
    g.closePath(); g.fillStyle = 'rgba(255,201,60,.17)'; g.fill(); g.strokeStyle = 'rgba(255,201,60,.5)'; g.lineWidth = 1; g.stroke();
    const dot = (x, y, r, fill) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
    // 내 패스
    if (m.pass) {
      const [tx, ty] = P(m.pass.x, m.pass.z), ang = Math.atan2(ty - cy, tx - cx), col = m.ok ? '#3ddc84' : '#ff4d3a';
      const ex = tx - Math.cos(ang) * 13, ey = ty - Math.sin(ang) * 13;
      g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(ex, ey); g.stroke();
      g.beginPath(); g.moveTo(ex + Math.cos(ang) * 6, ey + Math.sin(ang) * 6);
      g.lineTo(ex - Math.cos(ang - .5) * 9, ey - Math.sin(ang - .5) * 9); g.lineTo(ex - Math.cos(ang + .5) * 9, ey - Math.sin(ang + .5) * 9);
      g.closePath(); g.fillStyle = col; g.fill();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const t of m.mates) {
      const [x, y] = P(t.x, t.z);
      if (t.free) { g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.strokeStyle = '#3ddc84'; g.lineWidth = 2; g.stroke(); }
      dot(x, y, 10, '#ffc93c'); g.fillStyle = '#0b1428'; g.font = '800 12px "Barlow Condensed",sans-serif'; g.fillText(t.num, x, y + 1);
    }
    // 수비는 친구 위에 그린다 (붙어 있는 수비가 친구 원에 가려지지 않게)
    for (const d of m.defs) {
      let [x, y] = P(d.x, d.z);
      for (const t of m.mates) { // 친구 원에 겹치면 원 가장자리로 밀어 등번호가 보이게
        const [tx, ty] = P(t.x, t.z), dx = x - tx, dy = y - ty, l = Math.hypot(dx, dy);
        if (l < 17) { const ux = l > .1 ? dx / l : (cx - tx) / (Math.hypot(cx - tx, cy - ty) || 1), uy = l > .1 ? dy / l : (cy - ty) / (Math.hypot(cx - tx, cy - ty) || 1); x = tx + ux * 17; y = ty + uy * 17; }
      }
      dot(x, y, 8, '#f4f6fb'); dot(x, y, 6.5, d.tight ? '#ff4d3a' : 'rgba(255,77,58,.6)');
    }
    dot(cx, cy, 6, '#f4f6fb'); g.beginPath(); g.moveTo(cx, cy - 12); g.lineTo(cx - 4, cy - 6); g.lineTo(cx + 4, cy - 6); g.closePath(); g.fill();
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = m.ok ? '#3ddc84' : '#ff4d3a'; g.font = '700 14px "Noto Sans KR",sans-serif'; g.fillText(m.title || '', 12, 24);
    g.fillStyle = '#a9b6d3'; g.font = '700 11px "Noto Sans KR",sans-serif'; g.fillText('노란 부채꼴 = 내가 둘러본 범위', 12, 218);
    cv.classList.add('show'); clearTimeout(this._map); this._map = setTimeout(() => cv.classList.remove('show'), ms);
  }
  motChoices(nums, cb) {
    const m = this.el.mot; m.hidden = false;
    m.innerHTML = nums.map(n => `<button type="button" data-n="${n}">${n}</button>`).join('');
    m.querySelectorAll('button').forEach(b => b.addEventListener('click', () => cb(+b.dataset.n)));
  }
  motMark(num, ok, right) {
    this.el.mot.querySelectorAll('button').forEach(b => { const n = +b.dataset.n; if (n === right) b.classList.add('right'); else if (n === num && !ok) b.classList.add('wrong'); b.disabled = true; });
  }
  motHide() { this.el.mot.hidden = true; this.el.mot.innerHTML = ''; }
  toast(msg, ms = 2400) { const t = this.el.toast; t.textContent = msg; t.classList.add('show'); clearTimeout(this._to); this._to = setTimeout(() => t.classList.remove('show'), ms); }

  // ---------- 결과 ----------
  drawRadar(cv, axes, opts = {}) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) * (opts.r || .34);
    const css = getComputedStyle(document.documentElement);
    const col = (n, d) => (css.getPropertyValue(n) || d).trim() || d;
    const sun = col('--sun', '#ffc93c'), mist = col('--mist', '#a9b6d3'), chalk = col('--chalk', '#f4f6fb');
    g.clearRect(0, 0, W, H);
    const pt = (i, v) => { const a = -Math.PI / 2 + i / AXES.length * Math.PI * 2; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
    g.lineWidth = 1;
    for (const ring of [.25, .5, .75, 1]) {
      g.beginPath(); AXES.forEach((_, i) => { const [x, y] = pt(i, ring); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
      g.strokeStyle = 'rgba(169,182,211,' + (ring === 1 ? .45 : .18) + ')'; g.stroke();
    }
    AXES.forEach((_, i) => { const [x, y] = pt(i, 1); g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.strokeStyle = 'rgba(169,182,211,.18)'; g.stroke(); });
    g.beginPath(); AXES.forEach(([k], i) => { const [x, y] = pt(i, Math.max(.04, axes[k] ?? 0)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
    g.fillStyle = 'rgba(255,201,60,.28)'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = sun; g.stroke();
    AXES.forEach(([k], i) => { if (axes[k] == null) return; const [x, y] = pt(i, Math.max(.04, axes[k])); g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fillStyle = sun; g.fill(); });
    g.font = `700 ${Math.round(W * .05)}px "Noto Sans KR",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    AXES.forEach(([k, label], i) => {
      const [x, y] = pt(i, 1.24); const v = axes[k];
      g.fillStyle = v == null ? 'rgba(169,182,211,.5)' : chalk; g.fillText(label, x, y - W * .025);
      g.fillStyle = v == null ? 'rgba(169,182,211,.5)' : mist; g.font = `600 ${Math.round(W * .042)}px "Barlow Condensed",sans-serif`;
      g.fillText(v == null ? '–' : Math.round(v * 100), x, y + W * .03); g.font = `700 ${Math.round(W * .05)}px "Noto Sans KR",sans-serif`;
    });
  }

  renderResult(s) {
    $('#res-mode').textContent = s.ranked ? '챌린지 결과' : `훈련장 · ${s.title}`;
    $('#res-score').textContent = s.score.toLocaleString('ko-KR');
    $('#res-sub').textContent = `LV ${s.level} · 정확도 ${s.accuracy}% · ${s.correct}/${s.decisions}`;
    $('#res-bi').textContent = s.brainIndex; $('#res-grade').textContent = grade(s.brainIndex);
    $('#res-bi2').textContent = s.brainIndex; $('#res-grade2').textContent = grade(s.brainIndex);
    const key = [
      ['평균 반응', s.avgRt ? `${s.avgRt}<small>ms</small>` : '–'],
      s.mode === 'challenge' || s.mode === 'shoot' ? ['골', `${s.goals}<small>/${s.shots}</small>`] : s.mode === 'mot' ? ['등번호 기억', `${s.mot[0]}<small>/${s.mot[1]}</small>`] : ['맞힘', `${s.correct}<small>/${s.decisions}</small>`],
      ['둘러보기', s.scanRound && s.scanRound[1] ? `${s.scanRound[0]}<small>/${s.scanRound[1]}</small>` : `${s.scanPerMin}<small>/분</small>`],
    ];
    $('#res-key').innerHTML = key.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    this.drawRadar($('#radar'), s.axes);
    const cells = [
      ['평균 반응', s.avgRt ? `${s.avgRt}<small>ms</small>` : '–'],
      [s.mode === 'mot' ? '등번호 기억' : '최단 플래시', s.mode === 'mot' ? `${s.mot[0]}<small>/${s.mot[1]}</small>` : (s.minFlash ? `${s.minFlash}<small>ms</small>` : '–')],
      ['콜 성공', s.voiceOn ? `${s.calls}<small>/${s.callChances}</small>` : '<small>꺼짐</small>'],
      ['스캔', `${s.scanPerMin}<small>/분</small>`],
      s.mode === 'challenge' || s.mode === 'shoot' ? ['골', `${s.goals}<small>/${s.shots}</small>`]
        : s.mode === 'scan' ? ['둘러보기 패스', `${s.scanRound[0]}<small>/${s.scanRound[1]}</small>`]
        : ['멈춤 성공', s.whistle[1] ? `${s.whistle[0]}<small>/${s.whistle[1]}</small>` : '–'],
      ['발 움직임', s.feetOn ? `${s.stepsPerMin}<small>걸음/분</small>` : '<small>꺼짐</small>'],
    ];
    $('#res-stats').innerHTML = cells.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    let weakest = null, wv = 2;
    for (const [k] of AXES) { const v = s.axes[k]; if (v != null && v < wv) { wv = v; weakest = k; } }
    $('#res-coach').innerHTML = `<b>코치 한마디</b> · ${esc(TIPS[weakest] || TIPS.judge)}`;
  }

  renderRanking(rows, me, emptyMsg) {
    const list = $('#rank-list');
    if (!rows || !rows.length) { list.innerHTML = `<li class="rank-empty" style="display:block">${esc(emptyMsg || '아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!')}</li>`; return; }
    list.innerHTML = rows.map(r => `<li class="${me && r.nick === me ? 'me' : ''}">
      <span class="r">${r.rank}</span>
      <span class="n"><b>${esc(r.nick)}</b><small>${esc([AGE_LABEL[r.age_group] || '', r.team || ''].filter(Boolean).join(' · '))}${r.accuracy != null ? ` · 정확도 ${r.accuracy}%` : ''}</small></span>
      <span class="s">${Number(r.score).toLocaleString('ko-KR')}<small>LV ${r.level}${r.brain_index ? ` · 지수 ${r.brain_index}` : ''}</small></span></li>`).join('');
  }
}

// 인스타 스토리용 결과 카드 (1080×1920)
export async function shareCard(s, profile, url, ui) {
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#16264a'); bg.addColorStop(1, '#0b1428'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // 경기장 라인
  g.strokeStyle = 'rgba(244,246,251,.08)'; g.lineWidth = 6; g.strokeRect(90, 1150, 900, 700); g.beginPath(); g.arc(540, 1150, 170, 0, Math.PI); g.stroke();
  g.fillStyle = '#ffc93c'; g.fillRect(90, 150, 14, 250);
  g.fillStyle = '#f4f6fb'; g.font = 'italic 800 150px "Barlow Condensed",sans-serif'; g.textBaseline = 'alphabetic';
  g.fillText('FOOTBALL', 130, 270); g.fillStyle = '#ffc93c'; g.fillText('BRAIN', 130, 400);
  g.fillStyle = '#f4f6fb'; g.font = '400 54px "Black Han Sans",sans-serif'; g.fillText('축구 두뇌 훈련', 136, 480);
  g.fillStyle = '#a9b6d3'; g.font = '700 40px "Noto Sans KR",sans-serif';
  g.fillText(`${profile?.nick || '선수'} · ${AGE_LABEL[profile?.age] || ''}${profile?.team ? ' · ' + profile.team : ''}`, 136, 580);
  g.fillStyle = '#f4f6fb'; g.font = 'italic 800 230px "Barlow Condensed",sans-serif'; g.fillText(s.score.toLocaleString('ko-KR'), 120, 820);
  g.fillStyle = '#a9b6d3'; g.font = '600 52px "Barlow Condensed",sans-serif'; g.fillText(`LV ${s.level}  ·  정확도 ${s.accuracy}%  ·  반응 ${s.avgRt || '-'}ms`, 136, 900);
  const rc = document.createElement('canvas'); rc.width = 600; rc.height = 600; ui.drawRadar(rc, s.axes, { r: .3 });
  g.drawImage(rc, 60, 960, 600, 600);
  g.fillStyle = '#a9b6d3'; g.font = '700 40px "Noto Sans KR",sans-serif'; g.fillText('축구 두뇌 지수', 700, 1170);
  g.fillStyle = '#ffc93c'; g.font = '800 220px "Barlow Condensed",sans-serif'; g.fillText(String(s.brainIndex), 690, 1370);
  g.fillStyle = '#f4f6fb'; g.font = '400 60px "Black Han Sans",sans-serif'; g.fillText(grade(s.brainIndex), 700, 1450);
  g.fillStyle = '#ffc93c'; g.fillRect(90, 1640, 900, 150);
  g.fillStyle = '#0b1428'; g.font = '400 50px "Black Han Sans",sans-serif'; g.textAlign = 'center'; g.fillText('너도 도전해 봐!  수비수는 0.3초만 보여', 540, 1712);
  g.font = '700 36px "Noto Sans KR",sans-serif'; g.fillText(`@halftime.parenttalk  ·  ${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`, 540, 1768);
  return await new Promise(res => c.toBlob(res, 'image/png'));
}

// 새 기술 카드 그림: 위에서 본 도식 (나 = 흰 점, 노랑 = 우리 편, 빨강 = 수비, 초록 화살표 = 정답)
function drawTeach(cv, rule) {
  const g = cv.getContext('2d'), W = 280, H = 150, k = cv.width / W;
  g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, W, H);
  g.fillStyle = '#1f5a34'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; for (let x = 20; x < W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  const dot = (x, y, r, c) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = c; g.fill(); };
  const mate = (x, y, n) => { dot(x, y, 11, '#ffc93c'); g.fillStyle = '#0b1428'; g.font = '800 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n, x, y + 1); };
  const def = (x, y) => { dot(x, y, 9, '#ffffff'); dot(x, y, 7.5, '#e8402f'); };
  const me = (x, y) => { dot(x, y, 8, '#ffffff'); };
  const mark = (x, y, ok) => { dot(x, y, 8, ok ? '#2fbf6a' : '#e8402f'); g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.lineCap = 'round'; g.beginPath();
    if (ok) { g.moveTo(x - 4, y); g.lineTo(x - 1, y + 3); g.lineTo(x + 4, y - 3); } else { g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3); } g.stroke(); };
  const arrow = (x1, y1, x2, y2, col = '#38d27a', dash = false) => {
    const a = Math.atan2(y2 - y1, x2 - x1); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3.5; g.setLineDash(dash ? [6, 5] : []);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2 - Math.cos(a) * 9, y2 - Math.sin(a) * 9); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - Math.cos(a - .45) * 11, y2 - Math.sin(a - .45) * 11); g.lineTo(x2 - Math.cos(a + .45) * 11, y2 - Math.sin(a + .45) * 11); g.closePath(); g.fill();
  };
  const fan = (cx, cy, a0, a1) => { g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 70, a0, a1); g.closePath(); g.fillStyle = 'rgba(255,201,60,.22)'; g.fill(); };
  const label = (x, y, t, c = '#fff') => { g.fillStyle = c; g.font = '700 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); };
  if (rule === 'shot') {
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(60, 18, 160, 46);
    dot(162, 50, 10, '#8a4dff'); arrow(150, 50, 176, 50, '#ffc93c'); label(163, 76, '기울었다!', '#ffc93c');
    dot(140, 130, 7, '#fff'); arrow(140, 124, 74, 28); label(96, 96, '반대 구석!', '#7dffb0');
    return;
  }
  if (rule === 'pass' || rule === 'both' || rule === 'whistle') {
    me(140, 130); mate(70, 32, 7); mate(210, 32, 10); def(98, 72);
    if (rule === 'both') { def(182, 72); mark(70, 12, false); mark(210, 12, false); arrow(140, 122, 140, 42); label(140, 30, '가운데 = 돌파!', '#7dffb0'); }
    else if (rule === 'whistle') { label(140, 80, '🔔 휘슬 = 멈춤', '#ffc93c'); }
    else { mark(70, 12, false); mark(210, 12, true); arrow(146, 124, 203, 44); }
    return;
  }
  // 둘러보기 계열: 친구가 화면 밖 양옆에
  me(140, 116); mate(28, 104, 7); mate(252, 98, 10); def(58, 108);
  fan(140, 116, Math.PI * .92, Math.PI * 1.22); fan(140, 116, -Math.PI * .22, Math.PI * .08);
  label(140, 136, '👀 꾹 = 그쪽 보기', '#ffc93c');
  if (rule === 'switch') { def(222, 100); arrow(70, 92, 210, 86, '#ff8a7a', true); mark(28, 84, true); mark(252, 78, false); label(140, 66, '수비가 옮겨 붙었다!', '#ff8a7a'); return; }
  mark(28, 84, false); mark(252, 78, true);
  if (rule === 'blind') {
    g.fillStyle = 'rgba(5,10,20,.88)'; g.fillRect(150, 8, 122, 52); label(211, 26, '공이 오면 화면 가림', '#a9b6d3'); label(211, 46, '기억으로 ✔ 쪽!', '#7dffb0');
    arrow(150, 112, 236, 100, '#38d27a', true);
  } else arrow(150, 112, 236, 100);
}
