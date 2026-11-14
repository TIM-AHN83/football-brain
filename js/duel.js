// 1:1 대결 (2.5): 친구와 각자 폰으로 같은 장면을 동시에 한다.
// - 방 번호(4자리)로 만난다. 번호를 아는 친구만 들어오고, 방장이 상대 닉네임을 보고 '경기 시작'을 눌러야 시작한다.
// - Supabase Realtime 방송 채널로 두 폰만 주고받는다(닉네임·등번호·점수). 서버에 저장하지 않고 채팅도 없다.
// - 경기: 공격 8번(전반 4 · 후반 4, 후반은 레벨 +1). 골을 더 넣으면 승리, 동점이면 승부차기 3번(그래도 같으면 한 번씩 더, 최대 8번).
// - 두 폰은 같은 '씨앗'으로 같은 장면을 받고(game.js reseed), 공격마다 두 사람이 다 끝내야 다음 공격이 시작된다.
// - 메시지가 빠져도 되게: 내 상태 전체(지금까지 결과)를 2초마다 다시 보낸다.
import { CONFIG } from './config.js';

export const ROUNDS = 8, HALF = 4, PK_MIN = 3, PK_MAX = 8;
const PING_WAIT = 1000, PING_PLAY = 2000, LOST_LOBBY = 15000, LOST_PLAY = 30000;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
const cleanNick = (s) => String(s || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 12) || '친구';
export const cleanRoom = (s) => String(s || '').replace(/\D/g, '').slice(0, 4);
const verNum = (v) => String(v || '').split(' ')[0];
const HOW = { goal: '⚽', save: '🧤', miss: '✕', lost: '✕' };
const HOW_TXT = { goal: '골!', save: '골키퍼가 막음', miss: '슛 놓침', lost: '공 뺏김' };

// ---------- 결과 판정 (두 폰이 같은 자료로 똑같이 계산) ----------
// me / op: 라운드 번호(공격 0~7, 승부차기 8~) → { goal, pts }
export function duelState(me, op) {
  let n = 0; while (me[n] && op[n]) n++; // 둘 다 끝낸 라운드 수
  const goals = (a, from, to) => { let k = 0; for (let i = from; i < to; i++) if (a[i]?.goal) k++; return k; };
  const pts = (a) => a.reduce((s, x) => s + (x?.pts || 0), 0);
  const g = [goals(me, 0, Math.min(n, ROUNDS)), goals(op, 0, Math.min(n, ROUNDS))];
  const pkN = Math.max(0, n - ROUNDS), pk = [goals(me, ROUNDS, n), goals(op, ROUNDS, n)];
  let over = false, win = 0, by = null;
  if (n >= ROUNDS) {
    if (g[0] !== g[1]) { over = true; win = g[0] > g[1] ? 1 : -1; by = 'goals'; }
    else if (pkN > 0 && (pkN < PK_MIN ? Math.abs(pk[0] - pk[1]) > PK_MIN - pkN : pk[0] !== pk[1])) { over = true; win = pk[0] > pk[1] ? 1 : -1; by = 'pk'; } // 따라잡을 수 없으면 일찍 끝
    else if (pkN >= PK_MAX) { over = true; win = Math.sign(pts(me) - pts(op)); by = 'pts'; }
  }
  return { n, goals: g, pk, pkN, over, win, by, next: over ? null : n < ROUNDS ? { kind: 'atk', i: n } : { kind: 'pk', i: n - ROUNDS } };
}
export const roundIndex = (res) => res.k === 'pk' ? ROUNDS + res.i : res.i;
export const levelFor = (base, next) => next.kind === 'atk' && next.i < HALF ? base : base + 1; // 후반·승부차기는 +1

// ---------- 연결 ----------
// Supabase Realtime (Phoenix 웹소켓, 공개 방송 채널). 안 되면 false.
class RealtimeNet {
  constructor(room) { this.topic = 'realtime:fbduel-' + room; this.ref = 0; this.joined = false; this.closed = false; this.onMsg = null; this.onDown = null; }
  connect() {
    return new Promise((res) => {
      let done = false; const fin = (ok) => { if (!done) { done = true; clearTimeout(tm); res(ok); } };
      const tm = setTimeout(() => fin(false), 9000);
      let ws;
      try { ws = new WebSocket(`wss://${new URL(CONFIG.supabase.url).host}/realtime/v1/websocket?apikey=${encodeURIComponent(CONFIG.supabase.key)}&vsn=1.0.0`); }
      catch (e) { fin(false); return; }
      this.ws = ws;
      ws.onopen = () => this.push('phx_join', { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: CONFIG.supabase.key }, true);
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (er) { return; }
        if (m.event === 'phx_reply' && m.ref === this.joinRef) { if (m.payload?.status === 'ok') { this.joined = true; fin(true); } else fin(false); return; }
        if (m.event === 'broadcast' && m.topic === this.topic && m.payload?.event === 'm') this.onMsg && this.onMsg(m.payload.payload);
      };
      ws.onclose = () => { const was = this.joined; this.joined = false; clearInterval(this.hb); fin(false); if (was && !this.closed) this.onDown && this.onDown(); };
      ws.onerror = () => {};
      this.hb = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) })); }, 25000);
    });
  }
  push(event, payload, join) {
    const ref = String(++this.ref); if (join) this.joinRef = ref;
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ topic: this.topic, event, payload, ref, join_ref: this.joinRef }));
  }
  send(msg) { if (this.joined) this.push('broadcast', { type: 'broadcast', event: 'm', payload: msg }); }
  close() { this.closed = true; clearInterval(this.hb); try { if (this.joined) this.push('phx_leave', {}); this.ws?.close(); } catch (e) { /* 무시 */ } this.joined = false; }
}
// 시험용: ?duelnet=local 이면 같은 브라우저의 탭끼리 (인터넷 없이)
class LocalNet {
  constructor(room) { this.room = room; this.onMsg = null; this.onDown = null; }
  connect() { this.bc = new BroadcastChannel('fbduel-' + this.room); this.bc.onmessage = (e) => this.onMsg && this.onMsg(e.data); return Promise.resolve(true); }
  send(msg) { this.bc?.postMessage(msg); }
  close() { try { this.bc?.close(); } catch (e) { /* 무시 */ } this.bc = null; }
}

// ---------- 대결 진행 + 화면 ----------
export class DuelUI {
  // ui: UI, preview: 미리보기 링크, profile(): {nick,num}, myLevel(): 대결 레벨 후보, getGame(): Game,
  // startMatch({seed, level, onRound}): 게임 시작, track(kind, data), local: 시험용 연결
  constructor({ ui, preview, profile, myLevel, getGame, startMatch, track, local }) {
    Object.assign(this, { ui, preview, profile, myLevel, getGame, startMatch, track: track || (() => {}), local: !!local });
    this.id = rid(); this.reset();
    this.body = $('#duel-body');
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'duel-code') { e.preventDefault(); this.join(e.target.value); } });
    this.body.addEventListener('input', (e) => { if (e.target.id === 'duel-code') e.target.value = cleanRoom(e.target.value); });
    $('#scr-duel [data-close]')?.addEventListener('click', () => this.leave());
    setInterval(() => this.tick(), 1000);
  }
  reset() {
    this.st = 'menu'; this.role = null; this.room = null; this.opp = null; this.m = null; this.again = false; this.leaving = false; this.err = null; this.joinAt = 0; this.hinted = false; this._resMsg = null;
  }
  get active() { return !!this.net; } // 방에 들어가 있다
  get playing() { return !!(this.m && !this.m.over); }

  // 처음 화면의 '친구와 1:1 대결' (room 이 있으면 그 방으로 바로)
  open(room) {
    if (this.preview) { this.ui.toast('미리보기 링크에서는 1:1 대결이 꺼져 있어요'); return; }
    if (!this.net) { this.reset(); }
    this.ui.open('scr-duel'); this.render();
    if (room && !this.net) this.join(room);
  }
  onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a;
    if (a === 'host') this.host();
    else if (a === 'join') this.join($('#duel-code')?.value);
    else if (a === 'start') this.hostStart();
    else if (a === 'invite') this.invite();
    else if (a === 'leave') { this.leave(); this.render(); }
    else if (a === 'menu') { this.leave(); this.reset(); this.render(); }
  }

  // ---------- 방 ----------
  async connect(room, role) {
    this.close(); this.reset(); this.room = room; this.role = role; this.st = 'connecting'; this.render();
    const net = this.local ? new LocalNet(room) : new RealtimeNet(room);
    net.onMsg = (msg) => this.onMsg(msg);
    net.onDown = () => this.reconnect();
    const ok = await net.connect();
    if (this.room !== room) { net.close(); return false; } // 그사이 나갔다
    if (!ok) { net.close(); this.fail('net'); return false; }
    this.net = net; this.st = role === 'host' ? 'host' : 'join'; this.joinAt = Date.now();
    this.send(); this.render();
    return true;
  }
  host() { this.connect(String(1000 + Math.floor(Math.random() * 9000)), 'host'); }
  join(v) {
    const room = cleanRoom(v);
    if (room.length !== 4) { this.ui.toast('방 번호 4자리를 넣어 주세요'); return; }
    this.connect(room, 'guest');
  }
  rehost() { if (this.role === 'host' && !this.opp) { this.close(); this.host(); } } // 같은 번호 방이 이미 있다 → 새 번호
  async reconnect() { // 연결이 끊기면 3번까지 다시 (그사이 결과는 다음 상태 메시지로 다시 맞춰진다)
    const room = this.room; if (!room || this.leaving) return;
    for (let k = 0; k < 3; k++) {
      await new Promise(r => setTimeout(r, 1500 * (k + 1)));
      if (this.room !== room || this.leaving) return;
      const net = this.local ? new LocalNet(room) : new RealtimeNet(room);
      net.onMsg = (msg) => this.onMsg(msg); net.onDown = () => this.reconnect();
      if (await net.connect()) { if (this.room !== room) { net.close(); return; } this.net = net; this.send(); return; }
      net.close();
    }
  }
  close() { if (this.net) { this.net.onDown = null; this.net.close(); } this.net = null; }
  leave() { // 나가기: 상대에게 알리고 연결을 끊는다
    if (!this.net) return;
    this.leaving = true; this.send();
    const net = this.net; this.net = null; net.onDown = null; setTimeout(() => net.close(), 300);
    this.room = null; this.opp = null; if (this.m) this.m.over = true;
  }
  fail(code) {
    this.close(); this.st = 'error';
    this.err = { net: '인터넷 연결을 확인하고 다시 해 주세요.', full: '그 방에는 이미 두 사람이 있어요. 번호를 확인해 주세요.' }[code] || '연결하지 못했어요.';
    this.render();
  }

  // ---------- 주고받기 ----------
  snap() {
    const p = this.profile() || {}, m = this.m;
    return { t: 'st', f: this.id, to: this.opp?.id || null, role: this.role, nick: p.nick || '친구', num: p.num || 7, lvl: this.myLevel(), v: CONFIG.version,
      mid: m?.mid || null, seed: m?.seed || null, level: m?.level || null, res: m ? m.me.map(x => x ? [x.goal ? 1 : 0, x.pts, x.how] : 0) : [],
      again: !!this.again, bye: !!this.leaving };
  }
  send() { if (this.net) { this.net.send(this.snap()); this.lastSend = Date.now(); } }
  onMsg(msg) {
    if (!msg || msg.f === this.id || this.leaving) return;
    if (msg.t === 'full') { if (msg.to === this.id && !this.opp) this.fail('full'); return; }
    if (msg.t !== 'st') return;
    if (msg.to && msg.to !== this.id) { if (this.role === 'guest' && !this.opp && msg.role === 'host') this.fail('full'); return; } // 방장이 이미 다른 친구와
    if (!this.opp) {
      if (msg.bye) return;
      if (msg.role === this.role) { if (this.role === 'host') this.rehost(); return; }
      this.opp = { id: msg.f }; this.st = this.m?.over ? 'after' : 'paired'; this.ui.toast(`${cleanNick(msg.nick)} 연결됐어요!`); setTimeout(() => this.send(), 50);
    } else if (msg.f !== this.opp.id) { if (this.role === 'host') this.net?.send({ t: 'full', f: this.id, to: msg.f }); return; }
    const o = this.opp, wasAgain = o.again;
    Object.assign(o, { nick: cleanNick(msg.nick), num: Math.max(1, Math.min(99, +msg.num || 7)), lvl: Math.max(1, Math.min(99, +msg.lvl || 1)), v: String(msg.v || ''), again: !!msg.again, seen: Date.now() });
    if (msg.bye) return this.oppLeft();
    if (this.role === 'guest' && msg.mid && msg.seed && (!this.m || this.m.mid !== msg.mid)) this.begin({ mid: String(msg.mid), seed: String(msg.seed), level: +msg.level || 1 });
    if (this.m && msg.mid === this.m.mid) {
      const op = (msg.res || []).map((x, i) => Array.isArray(x) ? { goal: !!x[0], pts: +x[1] || 0, how: HOW[x[2]] ? x[2] : 'miss', i } : null);
      const fresh = op.findIndex((x, i) => x && !this.m.op[i]);
      this.m.op = op;
      if (fresh >= 0 && !this.m.me[fresh] && this.playing) this.note(`${o.nick} ${HOW[op[fresh].how]} ${HOW_TXT[op[fresh].how]}`, 2200); // 친구가 먼저 끝냈다
      this.progress();
    }
    if (this.role === 'host' && this.again && o.again && !wasAgain && this.m?.over) setTimeout(() => this.hostStart(true), 600); // 둘 다 '다시 붙기'
    if (!this.playing && this.ui.isOpen('scr-duel')) this.render();
    if (this.m?.over && !this.playing) this.renderResultNote();
  }
  tick() {
    if (!this.net) return;
    const play = this.playing, now = Date.now();
    if (now - (this.lastSend || 0) >= (this.opp && (play || this.m) ? PING_PLAY : PING_WAIT)) this.send();
    if (this.opp && now - (this.opp.seen || now) > (play ? LOST_PLAY : LOST_LOBBY)) this.oppLeft(true);
    else if (play && this.opp && now - (this.opp.seen || now) > 8000) this.note(`${this.opp.nick} 연결을 기다리는 중… (${Math.round((LOST_PLAY - (now - this.opp.seen)) / 1000)}초)`, 1100);
    if (this.st === 'join' && !this.opp && now - this.joinAt > 6000 && !this.hinted) { this.hinted = true; this.render(); }
  }
  oppLeft(timeout) {
    const nick = this.opp?.nick || '친구';
    if (this.playing) { this.finish(timeout ? 'lost' : 'left'); this.opp = null; this._resMsg = timeout ? `${nick}와 연결이 끊겼어요` : `${nick}가 나갔어요`; return; }
    this.opp = null;
    if (this.m?.over) { this.renderResultNote(`${nick}가 나갔어요`); return; }
    if (this.role === 'host') { this.st = 'host'; this.ui.toast(timeout ? `${nick} 연결이 끊겼어요` : `${nick}가 나갔어요 · 다른 친구를 기다려요`, 2600); }
    else { this.close(); this.st = 'error'; this.err = timeout ? '방장과 연결이 끊겼어요.' : '방장이 방을 닫았어요.'; }
    this.render();
  }

  // ---------- 경기 ----------
  hostStart(again) {
    if (this.role !== 'host' || !this.opp || this.playing) return;
    if (verNum(this.opp.v) !== verNum(CONFIG.version)) { this.ui.toast('두 폰의 게임 버전이 달라요 · 둘 다 새로고침해 주세요', 3000); return; }
    const level = Math.max(1, Math.min(8, Math.min(this.myLevel(), this.opp.lvl)));
    this.begin({ mid: rid(), seed: rid(), level });
  }
  begin({ mid, seed, level }) {
    this.again = false; if (this.opp) this.opp.again = false;
    this.m = { mid, seed, level, me: [], op: [], shown: 0, over: false, board: null };
    this.st = 'play'; this.ui.close('scr-duel'); this.send();
    this.startMatch({ seed, level, onRound: (res) => this.onRound(res) });
    this.board();
  }
  onRound(res) { // 내 공격(또는 승부차기) 하나가 끝났다
    const m = this.m; if (!m || m.over) return;
    m.me[roundIndex(res)] = { goal: res.goal, pts: res.pts, how: res.how };
    this.send(); this.progress();
  }
  progress() {
    const m = this.m, g = this.getGame(); if (!m || m.over) return;
    const s = duelState(m.me, m.op); this.board(s);
    if (s.n > m.shown) { // 둘 다 끝낸 공격이 하나 늘었다 → 비교 → 다음 공격
      m.shown = s.n; this.wait(null);
      const i = s.n - 1, a = m.me[i], b = m.op[i], pk = i >= ROUNDS;
      g.ui.center(pk ? `${s.pk[0]} : ${s.pk[1]}` : `${s.goals[0]} : ${s.goals[1]}`, 'gold');
      g.ui.callout(`나 ${HOW[a.how]} · ${this.opp?.nick || '친구'} ${HOW[b.how]}`, a.goal && !b.goal ? 'warn' : b.goal && !a.goal ? 'threat' : '', 1700);
      if (s.over) { g.after(1900, () => this.finish('done')); return; }
      const nx = s.next, lv = levelFor(m.level, nx), half = nx.kind === 'atk' && nx.i === HALF, pk0 = nx.kind === 'pk' && nx.i === 0;
      if (half) g.after(1800, () => { g.ui.center('HALF TIME', 'gold'); g.audio.whistle(.4); g.ui.callout(`후반전 · LV ${lv} · 수비가 더 빨라요`, 'warn', 2000); });
      if (pk0) g.after(1800, () => { g.ui.center('승부차기', 'gold'); g.audio.whistle(.4); g.ui.callout(`${s.goals[0]} : ${s.goals[1]} 동점! 한 번씩 차요`, 'warn', 2000); });
      g.after(half || pk0 ? 4200 : 2200, () => { if (this.m === m && !m.over) g.duelNext({ ...nx, level: lv }); });
    } else if (m.me[s.n] && !m.op[s.n]) this.wait(`${this.opp?.nick || '친구'} ${s.n >= ROUNDS ? '승부차기' : '공격'} 중… ⏳`);
  }
  finish(reason) {
    const m = this.m, g = this.getGame(); if (!m || m.over) return;
    m.over = true; this.st = 'after'; this.wait(null);
    const s = duelState(m.me, m.op), nick = this.opp?.nick || '친구';
    const win = reason === 'left' ? 1 : reason === 'lost' ? 0 : s.win;
    const result = { opp: nick, oppNum: this.opp?.num || 7, me: s.goals[0], op: s.goals[1], pk: s.pkN ? s.pk : null, win, by: reason === 'done' ? s.by : reason, reason,
      rounds: m.me.map(x => x?.how || null), oppRounds: m.op.slice(0, Math.max(s.n, m.me.length)).map(x => x?.how || null), level: m.level, n: s.n,
      pts: [m.me, m.op].map(a => a.slice(0, s.n).reduce((t, x) => t + (x?.pts || 0), 0)) };
    this.send();
    g.duelFinish(result);
  }
  rematch() {
    if (!this.net || !this.opp) { this.ui.toast('친구가 나갔어요 · 처음 화면에서 방을 다시 만들어요', 2600); return false; }
    this.again = true; this.send(); this.track('again', { mode: 'duel' });
    if (this.role === 'host' && this.opp.again) this.hostStart(true);
    else this.renderResultNote();
    return true;
  }

  // ---------- 화면 ----------
  render() {
    const B = this.body; if (!B) return;
    const me = this.profile() || {}, o = this.opp;
    let h = '';
    if (this.st === 'menu') {
      h = `<p class="duel-intro">각자 폰으로 <b>같은 장면</b>을 동시에! 공격 8번(전반 4 · 후반 4) 골을 더 넣으면 승리, 동점이면 승부차기.</p>
        <button type="button" class="btn btn-primary" data-a="host"><span>방 만들기</span><small>번호 4자리를 친구에게 알려 줘요</small></button>
        <div class="duel-join"><input id="duel-code" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="방 번호 4자리" aria-label="방 번호"><button type="button" class="btn" data-a="join">들어가기</button></div>
        <p class="fine">번호를 아는 친구만 들어와요 · 채팅 없음 · 닉네임·등번호·점수만 두 폰끼리 주고받고 저장하지 않아요. 두 폰 모두 인터넷이 필요해요.</p>`;
    } else if (this.st === 'connecting') {
      h = `<p class="duel-wait-big">연결하는 중…</p><button type="button" class="btn" data-a="menu">취소</button>`;
    } else if (this.st === 'host') {
      h = `<p class="fine center">친구 폰에서 '⚔ 1:1 대결' → 이 번호를 넣고 '들어가기'</p>
        <div class="duel-room" aria-label="방 번호">${esc(this.room)}</div>
        <button type="button" class="btn btn-primary" data-a="invite"><span>초대 링크 보내기</span><small>카톡·문자로 보내면 누르자마자 들어와요</small></button>
        <p class="duel-wait-big">친구를 기다리는 중… <i class="duel-dots"></i></p>
        <button type="button" class="btn" data-a="leave">방 닫기</button>`;
    } else if (this.st === 'join') {
      h = `<p class="duel-wait-big">방 ${esc(this.room)} 찾는 중… <i class="duel-dots"></i></p>
        ${this.hinted ? '<p class="fine center">아직 방이 안 보여요 · 번호가 맞는지, 친구가 방을 열어 두었는지 확인해요</p>' : ''}
        <button type="button" class="btn" data-a="menu">다른 번호 넣기</button>`;
    } else if (this.st === 'paired' && o) {
      const vbad = o.v && verNum(o.v) !== verNum(CONFIG.version), lv = Math.max(1, Math.min(8, Math.min(this.myLevel(), o.lvl || 1)));
      h = `<div class="duel-vs"><span><b>${esc(me.nick || '나')}</b><small>${esc(me.num || 7)}번</small></span><em>VS</em><span><b>${esc(o.nick || '친구')}</b><small>${esc(o.num || 7)}번</small></span></div>
        ${vbad ? `<p class="duel-warn">두 폰의 게임 버전이 달라요 (나 ${esc(verNum(CONFIG.version))} · 친구 ${esc(verNum(o.v))}). 둘 다 새로고침해 주세요.</p>` : ''}
        <p class="fine center">LV ${lv} 경기 (두 사람 중 낮은 레벨) · 후반 LV ${lv + 1} · 공격 8번</p>
        ${this.role === 'host' ? `<button type="button" class="btn btn-primary" data-a="start" ${vbad ? 'disabled' : ''}><span>경기 시작</span><small>누르면 두 폰 모두 3초 뒤 킥오프</small></button>`
          : `<p class="duel-wait-big">방장이 시작하면 바로 킥오프! <i class="duel-dots"></i></p>`}
        <button type="button" class="btn" data-a="leave">나가기</button>`;
    } else if (this.st === 'error') {
      h = `<p class="duel-warn">${esc(this.err || '연결하지 못했어요.')}</p><button type="button" class="btn btn-primary" data-a="menu">처음으로</button>`;
    } else {
      h = `<p class="duel-wait-big">경기 중이에요</p><button type="button" class="btn" data-a="leave">나가기</button>`;
    }
    B.innerHTML = h;
  }
  async invite() {
    const url = `${location.origin}${location.pathname}?duel=${this.room}`, nick = this.profile()?.nick || '친구';
    const text = `⚽ ${nick}의 1:1 축구 두뇌 대결! 방 번호 ${this.room} · 누르면 바로 들어와요 👉 ${url}`;
    this.track('share', { mode: 'duel' });
    try {
      if (navigator.share) { await navigator.share({ title: 'FOOTBALL BRAIN 1:1 대결', text }); return; }
      await navigator.clipboard.writeText(text); this.ui.toast('초대 문구를 복사했어요 · 카톡에 붙여 넣어요');
    } catch (e) { if (e?.name !== 'AbortError') this.ui.toast(`방 번호 ${this.room}을 친구에게 알려 주세요`, 3000); }
  }
  // 경기 중 점수판 (처음 화면 왼쪽 위 점수 자리)
  board(s) {
    const el = $('#duel-board'), hud = $('#hud'); if (!el) return;
    const on = !!this.m && this.st === 'play'; el.hidden = !on; hud?.classList.toggle('duel', on); if (!on) return;
    s = s || duelState(this.m.me, this.m.op);
    const me = this.profile() || {}, pk = s.n >= ROUNDS && !s.over;
    $('#db-me-n').textContent = me.nick || '나'; $('#db-op-n').textContent = this.opp?.nick || '친구';
    $('#db-me').textContent = s.goals[0]; $('#db-op').textContent = s.goals[1];
    const k = s.n + 1, lv = levelFor(this.m.level, s.next || { kind: 'pk', i: 0 });
    $('#db-rd').textContent = s.over ? '경기 끝' : pk ? `승부차기 ${s.pk[0]}:${s.pk[1]}` : `${k <= HALF ? '전반' : '후반'} ${((k - 1) % HALF) + 1}/${HALF} · LV ${lv}`;
  }
  note(text, ms = 2000) { const el = $('#duel-note'); if (!el) return; el.textContent = text; el.classList.add('show'); clearTimeout(this._nt); this._nt = setTimeout(() => el.classList.remove('show'), ms); }
  wait(text) { const el = $('#duel-wait'); if (!el) return; el.hidden = !text; if (text) el.textContent = text; }
  hudOff() { $('#duel-board') && ($('#duel-board').hidden = true); $('#hud')?.classList.remove('duel'); this.wait(null); }

  // 결과 화면 (game summary.duel)
  renderResult(d) {
    const box = $('#res-duel'); if (!box) return;
    box.hidden = !d; if (!d) return;
    const head = d.win > 0 ? '승리! 🏆' : d.win < 0 ? '아쉬운 패배' : '무승부';
    $('#res-mode').textContent = '1:1 대결 결과';
    $('#res-score').textContent = `${d.me} : ${d.op}`;
    $('#res-sub').textContent = `${head} · 🆚 ${d.opp} · LV ${d.level}`;
    const chips = (arr, from, to) => { let h = ''; for (let i = from; i < to; i++) { const x = arr[i]; h += `<i class="${x === 'goal' ? 'g' : x ? 'x' : 'e'}">${x ? HOW[x] : '·'}</i>`; } return h; };
    const n = Math.max(ROUNDS, d.rounds.length, d.oppRounds.length);
    const pkLine = d.pk ? `<p class="duel-pk">승부차기 ${d.pk[0]} : ${d.pk[1]}</p>` : '';
    const why = d.reason === 'left' ? `<p class="duel-warn">${esc(d.opp)}가 경기 중에 나갔어요 · 기권승</p>` : d.reason === 'lost' ? '<p class="duel-warn">연결이 끊겨서 경기를 여기서 끝냈어요</p>'
      : d.by === 'pts' ? `<p class="fine center">승부차기도 같아서 판단 점수로 정했어요 (${(d.pts?.[0] || 0).toLocaleString('ko-KR')} : ${(d.pts?.[1] || 0).toLocaleString('ko-KR')})</p>` : '';
    box.innerHTML = `${why}<div class="duel-rows">
      <div class="duel-row"><b>${esc(this.profile()?.nick || '나')}</b><span>${chips(d.rounds, 0, ROUNDS)}${n > ROUNDS ? '<em>|</em>' + chips(d.rounds, ROUNDS, n) : ''}</span></div>
      <div class="duel-row"><b>${esc(d.opp)}</b><span>${chips(d.oppRounds, 0, ROUNDS)}${n > ROUNDS ? '<em>|</em>' + chips(d.oppRounds, ROUNDS, n) : ''}</span></div>
    </div>${pkLine}<p class="fine center" id="duel-res-note"></p>`;
    this.renderResultNote();
  }
  renderResultNote(msg) {
    const el = $('#duel-res-note'), btn = $('#btn-again'); if (!el) return;
    if (msg) this._resMsg = msg;
    const gone = !this.net || !this.opp;
    el.textContent = gone ? (this._resMsg || '친구가 나갔어요 · 처음 화면에서 방을 다시 만들 수 있어요')
      : this.again && !this.opp.again ? `${this.opp.nick}가 '다시 붙기'를 누르면 바로 시작해요`
      : this.opp.again && !this.again ? `${this.opp.nick}가 한 판 더 하재요! '다시 붙기'를 눌러요` : '같은 친구와 바로 한 판 더 할 수 있어요';
    if (btn && this.st === 'after') { btn.disabled = gone || this.again; btn.querySelector('span').textContent = this.again && !gone ? '기다리는 중…' : '다시 붙기'; }
  }
}
