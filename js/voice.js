// 음성 콜: 브라우저 음성 인식(Web Speech API) + "7번 패스" 해석
const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

const SINO = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9 };
const NATIVE = [['열하나', 11], ['열한', 11], ['열둘', 12], ['열두', 12], ['열셋', 13], ['열세', 13], ['열넷', 14], ['열네', 14], ['열다섯', 15], ['열여섯', 16],
  ['열일곱', 17], ['열여덟', 18], ['열아홉', 19], ['스물', 20], ['하나', 1], ['한번', 1], ['둘', 2], ['두번', 2], ['셋', 3], ['세번', 3], ['넷', 4], ['네번', 4],
  ['다섯', 5], ['여섯', 6], ['일곱', 7], ['여덟', 8], ['아홉', 9], ['열', 10]];
const NAT_MAP = Object.fromEntries(NATIVE);
const NAT_RE = new RegExp('(' + NATIVE.map(x => x[0]).sort((a, b) => b.length - a.length).join('|') + ')(번)?', 'g');
const EN = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };

function sino(s) {
  if (!s) return null;
  const i = s.indexOf('십');
  if (i < 0) return s.length === 1 ? SINO[s] ?? null : null;
  const tens = i === 0 ? 1 : SINO[s.slice(0, i)];
  const ones = s.slice(i + 1) ? SINO[s.slice(i + 1)] : 0;
  if (tens == null || ones == null) return null;
  return tens * 10 + ones;
}

// 가장 마지막에 말한 번호와 '패스' 여부
export function parseCall(text) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  let num = null, at = -1;
  const take = (v, i) => { if (v != null && v >= 1 && v <= 99 && i >= at) { num = v; at = i; } };
  for (const m of t.matchAll(/(\d{1,2})/g)) take(+m[1], m.index);
  for (const m of t.matchAll(/([일이삼사오육륙칠팔구십]{1,4})\s*번/g)) take(sino(m[1]), m.index);
  const nat = t.replace(/\s/g, '');
  for (const m of nat.matchAll(NAT_RE)) { if (m[1].length > 1 || m[2]) take(NAT_MAP[m[1]], m.index); }
  for (const m of t.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g)) take(EN[m[1]], m.index);
  return {
    num,
    pass: /패스|패쓰|빼스|페스|팻스|파스|pass/.test(t),
    carry: /드리블|간다|돌파|내가|가자|\bgo\b/.test(t),
    shoot: /슛|슈팅|때려|shoot/.test(t),
  };
}

export class Voice {
  constructor() {
    this.supported = !!SR; this.running = false; this.want = false; this.blocked = false;
    this.onText = null; this.onState = null; this.lastErr = '';
  }
  start() {
    if (!this.supported || this.blocked) return false;
    this.want = true;
    if (this.running) return true;
    try {
      const rec = this.rec = new SR();
      rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 3;
      rec.onstart = () => { this.running = true; this.onState && this.onState('live'); };
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const alts = []; for (let j = 0; j < res.length; j++) alts.push(res[j].transcript);
          this.onText && this.onText(alts.join(' | '), res.isFinal, alts[0]);
        }
        this.onState && this.onState('hear');
      };
      rec.onerror = (e) => {
        this.lastErr = e.error;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { this.blocked = true; this.want = false; this.onState && this.onState('blocked'); }
      };
      rec.onend = () => {
        this.running = false;
        if (this.want && !this.blocked) setTimeout(() => this.want && this.start(), 250);
        else this.onState && this.onState('off');
      };
      rec.start();
      return true;
    } catch (err) { this.lastErr = String(err); return false; }
  }
  stop() { this.want = false; try { this.rec && this.rec.stop(); } catch (e) { /* 이미 멈춤 */ } this.running = false; this.onState && this.onState('off'); }
}
