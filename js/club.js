// 클럽 대항전: 클럽 만들기·가입·나가기, 클럽 화면(팀 점수·순위·팀원 기여·트로피), 타이틀의 클럽 카드, 클럽 순위
// 서버 함수는 supabase/fb_clubs.sql. 팀 점수 = 이번 주 팀원 챌린지 점수 합(한 사람당 하루 최고 5판),
// 지난주 1~3위 클럽(2명 이상 뛴 클럽)은 금·은·동 트로피.
import { Board } from './leaderboard.js';
import { store, deviceId, getProfile, setProfile } from './store.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const ERR = {
  name: '클럽 이름은 2~16자로 지어 주세요.', taken: '이미 있는 클럽 이름이에요. 다른 이름을 써 주세요.', word: '쓸 수 없는 말이 들어 있어요.',
  rate: '클럽은 하루에 3개까지 만들 수 있어요.', no_club: '그 코드의 클럽을 찾지 못했어요. 코드를 다시 확인해 주세요.', full: '클럽 인원이 꽉 찼어요 (60명).',
  nick: '선수 등록에서 닉네임을 먼저 정해 주세요.', device: '기기 정보를 읽지 못했어요. 새로고침해 주세요.', busy: '잠시 뒤에 다시 해 주세요.',
  not_ready: '클럽 대항전을 준비하고 있어요. 조금 뒤에 다시 와 주세요.', network: '인터넷 연결을 확인하고 다시 해 주세요.',
};
export const getClub = () => store.get('club', null);
const setClub = (c) => store.set('club', c);
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
export const inviteUrl = (code) => `${location.origin}${location.pathname}?club=${code}`;
const weekLabel = (d) => { const t = new Date(d + 'T00:00:00'); return `${t.getMonth() + 1}/${t.getDate()} 주`; };

export class ClubUI {
  // ui: UI 객체, preview: 미리보기 링크 여부, needProfile(): 선수 등록 열기, openRanking(tab): 랭킹 열기
  constructor({ ui, preview, needProfile, openRanking }) {
    this.ui = ui; this.preview = preview; this.needProfile = needProfile; this.openRanking = openRanking;
    this.body = $('#club-body'); this.info = null; this.cardAt = 0;
    $('#btn-club').addEventListener('click', () => this.open());
  }
  get pending() { return store.get('pendingClub', ''); }

  // ---------- 타이틀 카드 ----------
  async refreshCard(force = false) {
    const c = getClub(), name = $('#cc-name'), sub = $('#cc-sub');
    if (!c) { name.textContent = '클럽 대항전'; sub.textContent = this.pending ? '초대받은 클럽이 있어요 · 눌러서 가입' : '팀을 만들어 함께 점수를 모아요 · 매주 트로피'; return; }
    name.textContent = c.name;
    if (this.preview) { sub.textContent = '미리보기에서는 팀 점수가 꺼져 있어요'; return; }
    if (!force && Date.now() - this.cardAt < 30000 && this.info) return this.cardText(this.info);
    sub.textContent = '팀 점수 불러오는 중…';
    const info = await Board.clubInfo(c.code, deviceId());
    if (info && info.ok) { this.info = info; this.cardAt = Date.now(); this.cardText(info); }
    else sub.textContent = info?.error === 'no_club' ? '클럽을 찾지 못했어요 · 눌러서 확인' : '이번 주 팀 점수를 모으는 중';
  }
  cardText(info) {
    const t = this.trophyCount(info.trophies);
    $('#cc-sub').textContent = (info.week_points ? `이번 주 ${info.week_rank}위 · ${fmt(info.week_points)}점` : '이번 주 첫 점수를 올려 보세요') + (t.total ? ` · 🏆${t.total}` : '');
  }
  trophyCount(list) { const c = { 1: 0, 2: 0, 3: 0, total: 0 }; (list || []).forEach(t => { c[t.place]++; c.total++; }); return c; }

  // ---------- 클럽 화면 ----------
  async open() {
    if (!getProfile()) { this.needProfile(); return; }
    this.ui.open('scr-club');
    await this.render();
  }
  async render() {
    const c = getClub();
    if (this.preview) { this.body.innerHTML = '<p class="sheet-lead">미리보기 링크에서는 클럽 대항전이 꺼져 있어요. 정식 주소에서 열어 주세요.</p>'; return; }
    if (!c) return this.renderJoin();
    this.body.innerHTML = '<p class="sheet-lead">불러오는 중…</p>';
    const info = await Board.clubInfo(c.code, deviceId());
    if (!info || !info.ok) {
      if (info?.error === 'no_club') { setClub(null); return this.renderJoin('클럽을 찾지 못했어요. 다시 가입하거나 새로 만들어 주세요.'); }
      this.body.innerHTML = `<p class="sheet-lead">${esc(ERR[info?.error] || ERR.network)}</p>`; return;
    }
    this.info = info; this.cardAt = Date.now(); this.cardText(info);
    if (info.name !== c.name) setClub({ ...c, name: info.name });
    const t = this.trophyCount(info.trophies), me = info.members.find(m => m.me);
    const gap = info.week_rank === 1 && info.week_points ? '1위를 지키는 중! 이대로 월요일까지 버텨요 🏆'
      : info.gap ? `바로 위 클럽까지 ${fmt(info.gap)}점 — 팀원 한두 판이면 따라잡아요!`
      : '이번 주 첫 점수를 올려 보세요!';
    const trophies = t.total
      ? `<div class="club-trophy"><b>트로피</b> 🥇 ${t[1]} · 🥈 ${t[2]} · 🥉 ${t[3]}<small>${info.trophies.slice(0, 4).map(x => `${weekLabel(x.week)} ${MEDAL[x.place]}`).join(' · ')}</small></div>`
      : '<div class="club-trophy"><b>트로피</b> 아직 없어요<small>이번 주 2명 이상 뛰고 3위 안에 들면, 다음 월요일에 트로피를 받아요.</small></div>';
    const pend = this.pending && this.pending !== c.code
      ? `<div class="club-invite pending"><div><small>다른 클럽 초대를 받았어요</small><b>${esc(this.pending)}</b></div><button class="btn small" id="club-move">그 클럽으로 옮기기</button></div>` : '';
    const top = info.members[0];
    this.body.innerHTML = `
      ${pend}
      <div class="club-head">
        <small>내 클럽 · 회원 ${info.member_count}명</small><b>${esc(info.name)}</b>
        <div class="club-week"><span>이번 주 <em>${info.week_points ? info.week_rank + '위' : '–'}</em></span><span><em>${fmt(info.week_points)}</em> 팀 점수</span></div>
        <p class="club-gap">${esc(gap)}</p>
        ${trophies}
      </div>
      <div class="club-invite"><div><small>초대 코드</small><b>${esc(info.code)}</b></div><button class="btn small btn-primary" id="club-share">초대 링크 보내기</button></div>
      <h3 class="club-h">팀원 기여 · 이번 주${me ? ` <small>나: ${fmt(me.points)}점 · ${me.games}판</small>` : ''}</h3>
      <ol class="rank-list club-members">${info.members.map((m, i) => `<li class="${m.me ? 'me' : ''}">
        <span class="r">${i + 1}</span>
        <span class="n"><b>${m === top && m.points > 0 ? '👑 ' : ''}${esc(m.nick)}</b><small>${m.games ? `이번 주 ${m.games}판 반영` : '이번 주 아직 안 뛰었어요'}</small></span>
        <span class="s">${fmt(m.points)}<small>점</small></span></li>`).join('')}</ol>
      <p class="fine">챌린지 한 판이 끝날 때마다 내 점수가 팀 점수로 자동으로 쌓여요 (한 사람당 하루 최고 5판). 매주 월요일 0시에 새로 시작하고, 지난주 1~3위 클럽은 트로피를 받아요. 👑 = 이번 주 팀 MVP.</p>
      <div class="btn-row"><button class="btn small" id="club-rank">클럽 순위 보기</button><button class="btn small" id="club-leave">클럽 나가기</button></div>`;
    $('#club-share').addEventListener('click', () => this.share(info));
    $('#club-rank').addEventListener('click', () => { this.ui.close('scr-club'); this.openRanking('club'); });
    $('#club-leave').addEventListener('click', () => this.leave());
    $('#club-move')?.addEventListener('click', () => this.join(this.pending));
  }
  renderJoin(msg = '') {
    const pend = this.pending;
    this.body.innerHTML = `
      <p class="sheet-lead">같은 팀 친구들과 클럽을 만들어 함께 점수를 모아요. 챌린지 한 판마다 내 점수가 <b>팀 점수</b>로 쌓이고, 매주 1~3위 클럽은 <b>트로피</b>를 받아요.</p>
      ${msg ? `<p class="warn">${esc(msg)}</p>` : ''}
      ${pend ? `<div class="club-invite pending"><div><small>초대받은 클럽</small><b id="club-pend-name">${esc(pend)}</b></div><button class="btn small btn-primary" id="club-join-pend">가입하기</button></div>` : ''}
      <label class="field"><span>초대 코드로 가입 <small>(6자리)</small></span>
        <input id="club-code" maxlength="6" placeholder="예: AB3K9Q" autocapitalize="characters" value="${esc(pend)}"></label>
      <button class="btn" id="club-join">가입하기</button>
      <label class="field"><span>새 클럽 만들기 <small>(팀 이름 2~16자)</small></span>
        <input id="club-name" maxlength="16" placeholder="예: 하프타임FC U-10"></label>
      <button class="btn btn-primary" id="club-create">클럽 만들기</button>
      <p class="fine">클럽을 만들면 초대 코드와 링크가 생겨요. 카카오톡으로 링크를 보내면 팀원이 눌러서 바로 가입해요.</p>
      <button class="link-btn" id="club-rank2">클럽 순위 보기</button>`;
    $('#club-join').addEventListener('click', () => this.join($('#club-code').value));
    $('#club-create').addEventListener('click', () => this.create($('#club-name').value));
    $('#club-join-pend')?.addEventListener('click', () => this.join(pend));
    $('#club-rank2').addEventListener('click', () => { this.ui.close('scr-club'); this.openRanking('club'); });
    if (pend) Board.clubInfo(pend, deviceId()).then(i => { const el = $('#club-pend-name'); if (el && i?.ok) el.textContent = `${i.name} (${i.code})`; });
  }
  busy(on) { this.body.querySelectorAll('button').forEach(b => { b.disabled = on; }); }
  afterJoin(res, made) {
    setClub({ id: res.id, code: res.code, name: res.name });
    if (this.pending) store.set('pendingClub', '');
    const p = getProfile(); if (p && p.team !== res.name) setProfile({ ...p, team: res.name }); // 프로필의 팀 이름도 클럽 이름으로
    this.ui.toast(made ? `${res.name} 클럽을 만들었어요! 초대 링크를 팀원에게 보내 주세요` : `${res.name} 클럽에 가입했어요!`, 3200);
    this.info = null; this.refreshCard(true); this.render(); this.onChange && this.onChange();
  }
  async join(code) {
    code = cleanCode(code);
    if (code.length !== 6) { this.ui.toast('초대 코드 6자리를 넣어 주세요'); return; }
    this.busy(true);
    const res = await Board.clubJoin(code, deviceId(), getProfile()?.nick || '');
    this.busy(false);
    if (res.ok) this.afterJoin(res, false); else this.ui.toast(ERR[res.error] || ERR.network, 3200);
  }
  async create(name) {
    name = String(name || '').trim().replace(/[<>]/g, '');
    if (name.length < 2) { this.ui.toast(ERR.name); return; }
    this.busy(true);
    const res = await Board.clubCreate(name, deviceId(), getProfile()?.nick || '');
    this.busy(false);
    if (res.ok) this.afterJoin(res, true); else this.ui.toast(ERR[res.error] || ERR.network, 3200);
  }
  async leave() {
    const c = getClub(); if (!c) return;
    if (!confirm(`${c.name} 클럽에서 나갈까요? 지금까지 쌓은 팀 점수는 클럽에 남아요.`)) return;
    this.busy(true); const res = await Board.clubLeave(deviceId()); this.busy(false);
    if (!res.ok) { this.ui.toast(ERR[res.error] || ERR.network); return; }
    setClub(null); this.info = null; this.refreshCard(); this.render(); this.onChange && this.onChange();
  }
  async share(info) {
    const url = inviteUrl(info.code);
    const text = `⚽ 축구 두뇌 훈련 클럽 대항전! "${info.name}" 클럽에 들어와서 같이 팀 점수를 올리자 (초대 코드 ${info.code})`;
    try { if (navigator.share) { await navigator.share({ title: 'FOOTBALL BRAIN 클럽 초대', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); this.ui.toast('초대 문구와 링크를 복사했어요 · 카카오톡에 붙여 넣어 주세요', 3200); }
    catch (e) { prompt('이 링크를 복사해서 보내 주세요', url); }
  }

  // ---------- 게임이 끝났을 때 자동 등록 결과 ----------
  afterSubmit(res) {
    if (!res || !res.ok || !res.club) return '';
    this.info = null; this.cardAt = 0;
    return `팀 점수에 반영! 우리 클럽 이번 주 ${res.club_rank ?? '–'}위 · ${fmt(res.club_points)}점`;
  }
}

// 랭킹 화면의 '클럽' 탭
export function renderClubRanking(list, rows, myId) {
  if (!rows || !rows.length) { list.innerHTML = '<li class="rank-empty" style="display:block">이번 주 아직 팀 점수가 없어요. 클럽을 만들고 첫 점수를 올려 보세요!</li>'; return; }
  list.innerHTML = rows.map(r => {
    const tro = [r.gold && `🥇${r.gold}`, r.silver && `🥈${r.silver}`, r.bronze && `🥉${r.bronze}`].filter(Boolean).join(' ');
    return `<li class="${myId && Number(r.club_id) === Number(myId) ? 'me' : ''}">
      <span class="r">${r.rank}</span>
      <span class="n"><b>${esc(r.name)}</b><small>이번 주 ${r.players}명 뛰었어요 · 회원 ${r.members}명${tro ? ' · ' + tro : ''}</small></span>
      <span class="s">${fmt(r.points)}<small>팀 점수</small></span></li>`;
  }).join('');
}
