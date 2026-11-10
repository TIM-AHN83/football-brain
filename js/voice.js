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

// 마이크·음성 인식이 안 될 때 이유별 안내 문구
export function micHelp(err, env = {}) {
  const { samsung, ios } = env;
  switch (err) {
    case 'not-allowed': case 'denied': case 'NotAllowedError': case 'SecurityError':
      return ios ? '마이크가 막혀 있어요. 주소창의 "가가" → 웹사이트 설정 → 마이크를 "허용"으로 바꾼 뒤 다시 눌러 주세요.'
        : '마이크가 막혀 있어요. 주소창 왼쪽 자물쇠(또는 ⓘ) → 권한 → 마이크를 "허용"으로 바꾼 뒤 다시 눌러 주세요.';
    case 'service-not-allowed':
      return samsung ? '삼성 인터넷이 음성 인식을 막고 있어요. 아래 "크롬으로 열기"로 열면 잘 돼요.'
        : ios ? '음성 인식이 꺼져 있어요. 설정 → 일반 → 키보드 → 받아쓰기를 켜 주세요.' : '이 브라우저는 음성 인식을 막고 있어요. 크롬으로 열어 주세요.';
    case 'audio-capture': case 'nomic': case 'NotFoundError': case 'NotReadableError':
      return '마이크를 쓸 수 없어요. 통화·녹음 중인 앱을 닫고 다시 해 주세요.';
    case 'network':
      return samsung ? '음성 인식 서버에 연결이 안 돼요. 삼성 인터넷에서 자주 생겨요 — "크롬으로 열기"로 열어 주세요.' : '음성 인식 서버에 연결이 안 돼요. 와이파이나 데이터 연결을 확인해 주세요.';
    case 'silent':
      return samsung ? '말소리를 못 받았어요. 삼성 인터넷에선 음성 인식이 안 될 때가 있어요 — "크롬으로 열기"로 열면 잘 돼요.'
        : '말소리를 못 받았어요. 폰에 가까이 대고 조금 크게 "10번 패스!"라고 말해 보세요.';
    case 'inapp':
      return '인스타·카톡 앱 안에서는 음성 인식이 안 돼요. 오른쪽 위 메뉴 → "다른 브라우저로 열기"로 열어 주세요.';
    case 'unsupported':
      return '이 브라우저는 음성 인식을 지원하지 않아요. 크롬(안드로이드)이나 사파리(아이폰)로 열어 주세요.';
    default:
      return `음성 인식이 안 돼요(${err}). 크롬 최신 버전으로 열어 주세요.`;
  }
}

export class Voice {
  constructor({ inApp = false } = {}) {
    // 앱 안 브라우저(인스타·카톡)는 음성 인식 기능이 있는 척하지만 실제로는 안 된다
    this.supported = !!SR && !inApp; this.inApp = inApp; this.running = false; this.want = false; this.blocked = false;
    this.onText = null; this.onState = null; this.lastErr = ''; this.netErrs = [];
  }
  reset() { this.blocked = false; this.lastErr = ''; this.netErrs = []; }
  // 마이크 허락 받기: 버튼을 누른 순간에 부른다 (허락 창이 다른 화면 전환에 가려지지 않게 먼저)
  async ensurePermission() {
    try {
      const st = await navigator.permissions?.query({ name: 'microphone' });
      if (st?.state === 'granted') return 'granted';
      if (st?.state === 'denied') { this.lastErr = 'not-allowed'; return 'denied'; }
    } catch (e) { /* 이 브라우저는 권한 조회를 못 함 → 바로 물어본다 */ }
    if (!navigator.mediaDevices?.getUserMedia) return 'unknown';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop()); // 바로 놓아 줘야 음성 인식이 마이크를 쓸 수 있다
      return 'granted';
    } catch (e) {
      this.lastErr = e.name || 'error';
      return (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : (e.name === 'NotFoundError' ? 'nomic' : 'error');
    }
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
        if (e.error === 'no-speech' || e.error === 'aborted') return; // 조용했을 뿐 → 다시 듣기
        this.lastErr = e.error;
        let stop = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error);
        if (e.error === 'network') { // 서버 연결 실패가 15초 안에 3번이면 멈춘다 (무한 재시도 방지)
          const now = Date.now(); this.netErrs = this.netErrs.filter(t => now - t < 15000); this.netErrs.push(now);
          stop = this.netErrs.length >= 3;
        }
        if (stop) { this.blocked = true; this.want = false; this.onState && this.onState('blocked', e.error); }
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
