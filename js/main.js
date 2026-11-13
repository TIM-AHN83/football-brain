// 시작점: 로딩 → 타이틀(경기장 연출) → 준비(권한·안전) → 게임 → 결과·랭킹·공유
import { World } from './world.js';
import { Game, MODES } from './game.js';
import { UI, shareCard } from './ui.js';
import { AudioFX } from './audio.js';
import { Voice, micHelp, parseCall } from './voice.js';
import { Sensors } from './sensors.js';
import { Gestures } from './input.js';
import { Board } from './leaderboard.js';
import { CONFIG } from './config.js';
import { store, deviceId, getProfile, setProfile, getSettings, setSettings, addHistory, AGE_LABEL } from './store.js';
import { startTestPanel } from './testpanel.js';
import { loadPeople } from './people.js';
import { ClubUI, getClub, cleanCode, renderClubRanking } from './club.js';
import { load as loadCareer, todayMissions, streakNow, kitOf, setKitChoice, startLevelFor, setCont, applyRun, MISSIONS, titleOf, xpNeed, weatherFor, setWeatherChoice, weekState } from './career.js';
import { weekInfo } from './events.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const ui = new UI();
const settings = getSettings();
// 2.0: 조작 단순화 — 기존 사용자도 음성 콜·발 센서·폰 돌리기를 한 번 꺼 준다 (원하면 '더 재미있게'에서 다시 켬)
if (!store.get('mig_v2', false)) { settings.voice = false; settings.motion = false; settings.gyro = false; setSettings(settings); store.set('mig_v2', true); store.set('mig_voice1', true); }
const UA = navigator.userAgent;
const isMobile = matchMedia('(pointer:coarse)').matches || /Android|iPhone|iPad/i.test(UA);
const inApp = /Instagram|FBAN|FBAV|KAKAOTALK|NAVER\(inapp|Line\/|DaumApps|everytimeApp/i.test(UA);
const isAndroid = /Android/i.test(UA), isSamsung = /SamsungBrowser/i.test(UA);
const isIOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isChromeAndroid = isAndroid && /Chrome\//.test(UA) && !/SamsungBrowser|EdgA|OPR|Whale|NAVER|; wv\)/i.test(UA);
const ENV = { samsung: isSamsung, ios: isIOS };
const chromeIntent = () => `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`;
const secure = window.isSecureContext;
const PREVIEW = !!window.FB_PREVIEW; // Claude 미리보기 링크: 마이크·센서·온라인 랭킹·공유가 막혀 있음
const params = new URLSearchParams(location.search);
if (params.get('c')) store.set('code', params.get('c').slice(0, 16));
if (params.get('club')) store.set('pendingClub', cleanCode(params.get('club'))); // 카카오톡 등으로 받은 클럽 초대 링크
const club = new ClubUI({ ui, preview: PREVIEW, needProfile: () => openProfile('club'), openRanking: (tab) => openRanking(tab) });
let inviteShown = false;
const bootFill = $('#boot-fill'), bootMsg = $('#boot-msg');
const progress = (p, m) => { bootFill.style.width = p + '%'; if (m) bootMsg.textContent = m; window.__fbLog?.(`BOOT ${p}% ${m || ''}`); };

let world, game, audio, voice, sensors, gestures;
let state = 'boot', pendingMode = null, lastMode = 'challenge', lastSummary = null, wakeLock = null, lastHeard = '';
if (params.has('test')) startTestPanel(() => ({ voice, sensors, world, heard: lastHeard, state }));

async function boot() {
  window.__fbBooted = true; // 게임 코드가 떴다 → index.html 의 로딩 감시를 끈다
  // 실사풍 선수 모델(약 1MB)은 글꼴·경기장과 함께 미리 받기 시작한다. 그래픽 '낮음'이거나 ?simple 이면 단순 모델
  const simplePeople = settings.quality === 'low' || params.has('simple');
  const peopleP = simplePeople ? Promise.resolve(null) : loadPeople().catch(() => null);
  progress(15, '글꼴 준비 중…');
  try {
    await Promise.race([
      Promise.all(['800 40px "Barlow Condensed"', 'italic 800 40px "Barlow Condensed"', '40px "Black Han Sans"', '700 20px "Noto Sans KR"'].map(f => document.fonts.load(f, '0하'))),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* 글꼴 없이 진행 */ }
  progress(35, '경기장 짓는 중…');
  await new Promise(r => setTimeout(r, 30));
  const q = settings.quality === 'auto' ? (isMobile ? 'mid' : 'high') : settings.quality;
  try { world = new World($('#gl'), q); }
  catch (e) { bootMsg.textContent = '이 기기에서 3D 그래픽(WebGL)을 켤 수 없어요. 크롬이나 사파리 최신 버전으로 열어 주세요.'; console.error(e); window.__fbLog?.('ERR WebGL ' + e); return; }
  const photosReady = world.preload(['day']); // 하늘 사진·잔디 (타이틀과 첫 경기는 낮)
  progress(60, '선수 모델 불러오는 중…');
  await Promise.race([peopleP, new Promise(r => setTimeout(r, 12000))]); // 너무 느리면 단순 모델로 시작
  progress(80, '선수 입장 중…');
  audio = new AudioFX(); audio.setMode(settings.sound);
  voice = new Voice({ inApp }); sensors = new Sensors();
  game = new Game({ world, ui, audio, sensors, opts: { voice: settings.voice, motion: settings.motion, gyro: settings.gyro } });
  game.onEnd = onEnd;
  game.setKit(kitOf().kit); // 선수 레벨로 해금한 유니폼 색
  world.setWeather(weatherFor()); // 선수 레벨로 해금한 날씨
  game.onTutorialDone = (finished) => { // 따라 하기가 끝나면(또는 건너뛰면) 챌린지로 안내
    endSession(); store.set('tutDone', true); showTitle();
    if (finished) { game.setTaught('pass'); game.setTaught('shot'); } // 따라 하기에서 배운 기술은 카드를 다시 띄우지 않는다
    $('#tutdone-title').textContent = finished ? '준비 끝! 🎉' : '언제든 다시 따라 할 수 있어요';
    ui.open('scr-tutdone');
  };
  gestures = new Gestures($('#touch-layer'), {
    zones: () => game.zones(),
    onTap: (zone, t, n) => { if (!game.swipeMode()) ui.zoneFlash(zone, n); game.onInput(zone, t); },
    swipeMode: () => game.swipeMode(),
    holdMode: () => game.holdMode(), onHold: (zone) => game.holdLook(zone), // 둘러보기: 화면 한쪽을 꾹 = 그쪽 보기
    onSwipe: (sw) => { ui.swipeTrail(sw); game.onSwipe(sw); },
    onLook: (dx) => { game.look.drag -= dx * 0.0065; game.look.dragAt = performance.now(); },
    onLookKey: (v) => { game.look.key = v; },
    onPause: () => { if (state === 'play') pauseGame(); },
  });
  voice.onText = (all, final, best) => {
    lastHeard = best;
    if (state !== 'play') { if (state === 'mictest' && micOut && best) { micHeard = best; micOut.textContent = `들리는 중: "${best}"`; } return; }
    const hit = game.mode === 'mot' ? game.onVoiceMot(all) : game.onVoice(all);
    ui.voice(best, hit);
  };
  voice.onState = (s) => {
    if (state === 'play') ui.mic(s === 'blocked' ? null : s);
    if (s === 'blocked' && state === 'play') ui.toast(micHelp(voice.lastErr, ENV) + ' (이번 판은 음성 콜 없이 진행)', 6500);
  };
  window.FB = { world, game, voice, sensors, ui, audio }; // 테스트용
  window.addEventListener('resize', () => world.resize());
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pauseGame(); });
  progress(90, '하늘·잔디 사진 불러오는 중…');
  await Promise.race([photosReady, new Promise(r => setTimeout(r, 8000))]); // 느린 망이면 그림 하늘로 먼저 시작
  requestAnimationFrame(loop);
  progress(100, '킥오프 준비 완료');
  setTimeout(showTitle, 250);
  setTimeout(() => world.loadEnv('dusk'), 1500); setTimeout(() => world.loadEnv('night'), 4000); // 해 질 녘·야간 하늘은 뒤에서 미리 받아 둔다
  if (!PREVIEW) Board.init();
  if (inApp && !PREVIEW) showInApp();
  $('#ver-line').textContent = `버전 ${CONFIG.version} · 시범 운영(베타)`;
}

// ---------- 매 프레임 ----------
let last = performance.now(), perf = { t: 0, n: 0, sum: 0 };
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  if (state === 'play' || state === 'paused') game.update(dt); else if (state !== 'boot') game.cinematic(dt, now / 1000);
  world.update(dt); world.render();
  if ((perf.cx = (perf.cx || 0) + dt) > .25) { perf.cx = 0; audio?.crowdLevel(world.excite); } // 관중 녹음이 있으면 분위기 따라 크기
  // 느린 기기면 해상도를 자동으로 낮춘다
  if (settings.quality === 'auto' && state === 'play') {
    perf.sum += dt; perf.n++;
    if (perf.n >= 120) {
      const avg = perf.sum / perf.n; perf.sum = 0; perf.n = 0;
      if (avg > 0.024 && world.dpr > 0.75) world.setDpr(Math.max(0.75, world.dpr - 0.25));
      else if (avg < 0.014 && world.dpr < Math.min(window.devicePixelRatio || 1, world.q.dpr)) world.setDpr(Math.min(world.q.dpr, world.dpr + 0.25));
    }
  }
}

// ---------- 타이틀 ----------
function showTitle() {
  state = 'title'; ui.go('scr-title'); renderPlayerCard(); club.refreshCard(); renderCareerCard();
  const first = !store.get('tutDone', false) && !store.get('history', []).length; // 처음 온 사람: 30초 따라 하기를 먼저
  $('#btn-tutorial').hidden = !first; $('#btn-challenge').classList.toggle('btn-primary', !first);
  if (store.get('pendingClub', '') && !inviteShown && !PREVIEW) { inviteShown = true; setTimeout(() => club.open(), 600); } // 초대 링크로 들어왔으면 클럽 화면을 연다
  const best = store.get('best', null);
  $('#best-line').textContent = best ? `내 최고 ${best.score.toLocaleString('ko-KR')}점 · LV ${best.level} · 두뇌 지수 ${best.bi}` : '아직 기록이 없어요 · 첫 챌린지에 도전!';
}
function renderPlayerCard() {
  const p = getProfile();
  $('#pc-num').textContent = p?.num || 7;
  $('#pc-nick').textContent = p?.nick || '선수 등록';
  $('#pc-sub').textContent = p ? [AGE_LABEL[p.age], p.team].filter(Boolean).join(' · ') : '닉네임·나이대를 정해 주세요';
}

// ---------- 내 성장 (선수 레벨·오늘의 미션·배지·유니폼) ----------
function renderCareerCard() {
  const c = loadCareer(), mis = todayMissions(c), st = streakNow(c), next = mis.ids.find(id => !mis.done.includes(id));
  $('#cr-lv').textContent = c.lv;
  $('#cr-title').textContent = `오늘의 미션 ${mis.done.length}/3` + (st > 1 ? ` · 🔥 ${st}일 연속` : '');
  $('#cr-sub').textContent = next ? `다음: ${MISSIONS[next].t} · 선수 Lv ${c.lv} ${titleOf(c.lv)}` : `오늘 미션 끝! · 다음 레벨까지 ${xpNeed(c.lv) - c.xp} XP`;
  const w = weekState(c), el = $('#event-line'); // 이번 주 이벤트 (월요일 0시에 바뀜)
  el.hidden = false; el.textContent = `${w.ev.ico} 이번 주 ${w.ev.name} · ${w.ev.desc}${w.done ? ' · 주간 미션 완료 ✅' : ''}`;
}
function openCareer() {
  const c = loadCareer();
  ui.renderCareerSheet(c, todayMissions(c), streakNow(c), store.get('best', null), (id) => {
    if (setKitChoice(id)) { game.setKit(kitOf().kit); openCareer(); ui.toast('유니폼을 바꿨어요 · 친구들 옷 색이 바뀌어요'); }
  }, weekState(c), (id) => {
    if (setWeatherChoice(id)) { world.setWeather(weatherFor()); openCareer(); ui.toast(id === 'random' ? '판마다 날씨가 바뀌어요' : '경기장 날씨를 바꿨어요'); }
  });
  ui.open('scr-career');
}
$('#btn-career').addEventListener('click', openCareer);
$('#res-career').addEventListener('click', (e) => { if (e.target.closest('#btn-res-career')) openCareer(); });

// 시트 닫기 버튼
$$('[data-close]').forEach(b => b.addEventListener('click', () => ui.close(b.closest('.screen').id)));
$$('.sheet-screen').forEach(s => s.addEventListener('click', (e) => { if (e.target === s && s.id !== 'scr-pause') ui.close(s.id); }));

// 세그먼트 버튼 공통
function seg(id, value, onChange) {
  const el = $('#' + id);
  const set = (v) => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
  set(value);
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { set(b.dataset.v); onChange && onChange(b.dataset.v); }));
  return { set, get: () => el.querySelector('button.on')?.dataset.v };
}

// ---------- 선수 등록 ----------
let ageSeg;
function openProfile(next) {
  const p = getProfile() || { nick: '', age: 'u10', team: '', num: 7 };
  $('#in-nick').value = p.nick; $('#in-team').value = p.team || ''; $('#in-num').value = p.num || 7;
  if (!ageSeg) ageSeg = seg('seg-age', p.age); else ageSeg.set(p.age);
  pendingMode = next || null;
  ui.open('scr-profile');
}
$('#btn-player').addEventListener('click', () => openProfile());
$('#profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nick = $('#in-nick').value.trim().replace(/[<>]/g, '');
  if (!nick) { ui.toast('닉네임을 적어 주세요'); return; }
  const num = Math.max(1, Math.min(99, parseInt($('#in-num').value, 10) || 7));
  setProfile({ nick: nick.slice(0, 12), age: ageSeg.get() || 'u10', team: $('#in-team').value.trim().replace(/[<>]/g, '').slice(0, 16), num });
  renderPlayerCard(); ui.close('scr-profile');
  if (pendingMode === 'club') { pendingMode = null; club.open(); }
  else if (pendingMode) { const m = pendingMode; pendingMode = null; openSetup(m); }
});

// ---------- 시작 준비 ----------
let setupMode = 'challenge', setupLevel = 1;
const startSeg = seg('seg-start', loadCareer().cont ? 'cont' : '1', v => setCont(v === 'cont'));
const challengeStart = () => { const sl = startLevelFor(); return sl > 1 && loadCareer().cont ? sl : 1; }; // 이어 하기: 최고 레벨 −2
function openSetup(mode, level = 1) {
  setupMode = mode; setupLevel = level;
  const sl = startLevelFor(); $('#start-row').hidden = !(mode === 'challenge' && sl > 1);
  $('#start-lv').textContent = sl; startSeg.set(loadCareer().cont ? 'cont' : '1');
  $('#setup-opts').open = !!(settings.voice || settings.motion || settings.gyro);
  $('#setup-title').textContent = mode === 'challenge' ? '킥오프 준비' : `훈련 준비 · ${MODES[mode].title}`;
  $('#tg-voice').checked = settings.voice && voice.supported && !PREVIEW; $('#tg-voice').disabled = !voice.supported || PREVIEW;
  $('#tg-motion').checked = settings.motion && !PREVIEW; $('#tg-gyro').checked = settings.gyro && !PREVIEW;
  $('#tg-motion').disabled = $('#tg-gyro').disabled = PREVIEW;
  const warns = [];
  if (PREVIEW) warns.push('미리보기 링크라서 마이크·센서가 꺼져 있어요. 화면 왼쪽·가운데·오른쪽 누르기와 화면 끌기로 해 보세요. 정식 주소에서는 음성 콜과 발 센서가 모두 켜져요.');
  else if (!voice.supported) warns.push(micHelp(inApp ? 'inapp' : 'unsupported', ENV) + ' 음성 콜 없이 진행해요.');
  $('#mic-check').hidden = !voice.supported || PREVIEW;
  if (!secure && !PREVIEW) warns.push('보안 연결(https)이 아니라서 센서와 마이크가 막혀요. https 주소로 열어 주세요.');
  if (!isMobile) warns.push('컴퓨터에서는 ← → ↑ 키와 마우스 끌기로 할 수 있어요.');
  $('#setup-warn').hidden = !warns.length; $('#setup-warn').innerHTML = warns.join('<br>');
  $('#code-row').hidden = !(mode === 'challenge' && Board.requireCode);
  $('#in-code').value = store.get('code', '');
  ui.open('scr-setup');
}
$('#btn-challenge').addEventListener('click', () => { if (!getProfile()) return openProfile('challenge'); openSetup('challenge'); });

// ---------- 30초 따라 하기 (등록·권한 없이 바로) ----------
function startTutorial() {
  audio.unlock(); audio.crowdOn(true); ['scr-howto', 'scr-tutdone'].forEach(id => ui.close(id));
  game.opts.voice = false; game.opts.motion = false; game.opts.gyro = false; game.event = null;
  ui.go('none'); game.endCinematic(); game.look.drag = 0; game.look.key = 0;
  lastMode = 'tutorial'; game.start('tutorial'); ui.mic(null);
  gestures.enabled = true; gestures.reset(); state = 'play';
}
$('#btn-tutorial').addEventListener('click', startTutorial);
$('#btn-tut-again').addEventListener('click', startTutorial);
$('#btn-tut-again2').addEventListener('click', startTutorial);
$('#btn-tut-skip').addEventListener('click', () => { if (state === 'play') game.tutDone(false); });
$('#btn-tut-home').addEventListener('click', () => ui.close('scr-tutdone'));
$('#btn-tut-challenge').addEventListener('click', () => { ui.close('scr-tutdone'); if (!getProfile()) return openProfile('challenge'); openSetup('challenge'); });
// 의견 보내기 → 인스타 DM
$$('.fb-link').forEach(a => { a.href = `https://ig.me/m/${CONFIG.instagram}`; });
$('#btn-kickoff').addEventListener('click', kickoff);

async function kickoff() {
  const btn = $('#btn-kickoff'); btn.disabled = true;
  try {
    audio.unlock(); audio.crowdOn(true); // 관중 소리는 경기 중에만
    // 음성이 안 되는 브라우저(앱 안 등)에서 꺼진 스위치를 저장하면, 나중에 크롬으로 열어도 계속 꺼져 있게 된다 → 쓸 수 있을 때만 저장
    if (!PREVIEW) { if (voice.supported) settings.voice = $('#tg-voice').checked; settings.motion = $('#tg-motion').checked; settings.gyro = $('#tg-gyro').checked; setSettings(settings); }
    else { settings.voice = settings.motion = settings.gyro = false; }
    if ($('#in-code').value) store.set('code', $('#in-code').value.trim().slice(0, 16));
    game.opts.voice = settings.voice && voice.supported; game.opts.motion = settings.motion; game.opts.gyro = settings.gyro;
    if (isMobile && (settings.motion || settings.gyro) && secure) await sensors.request({ motion: settings.motion, orient: settings.gyro }); // 아이폰: 버튼 누른 순간에만 물어볼 수 있어 먼저
    voice.reset();
    if (game.opts.voice) { // 마이크 허락을 먼저 받는다 (전체 화면 전환이 허락 창을 가리지 않게)
      const p = await voice.ensurePermission();
      if (p === 'denied' || p === 'nomic') { game.opts.voice = false; ui.toast(micHelp(p, ENV) + ' (이번 판은 음성 콜 없이 진행)', 6500); }
    }
    if (game.opts.voice) { voice.start(); audio.setDuck(true); }
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) { wakeLock = null; }
    if (isMobile && document.documentElement.requestFullscreen && !document.fullscreenElement && isAndroid) document.documentElement.requestFullscreen().catch(() => {});
    setTimeout(() => sensors.calibrate(), 600);
    ui.close('scr-setup'); ui.go('none');
    game.endCinematic(); game.look.drag = 0; game.look.key = 0;
    lastMode = setupMode;
    game.event = weekInfo().ev.id; world.setWeather(weatherFor()); // 이번 주 이벤트 보너스 · 날씨 ('랜덤'이면 판마다)
    game.start(setupMode, { level: setupMode === 'challenge' ? challengeStart() : setupLevel });
    ui.mic(game.opts.voice ? 'live' : null);
    gestures.enabled = true; gestures.reset(); state = 'play';
  } finally { btn.disabled = false; }
}

// ---------- 일시정지 ----------
function pauseGame() { if (state !== 'play') return; state = 'paused'; game.pause(true); gestures.enabled = false; ui.open('scr-pause'); }
$('#btn-pause').addEventListener('click', pauseGame);
$('#btn-resume').addEventListener('click', () => { ui.close('scr-pause'); game.pause(false); gestures.enabled = true; gestures.reset(); state = 'play'; });
$('#btn-quit').addEventListener('click', () => { ui.close('scr-pause'); endSession(); game.quit(); showTitle(); });
function endSession() { gestures.enabled = false; voice.stop(); audio.setDuck(false); audio.crowdOn(false); ui.mic(null); try { wakeLock?.release(); } catch (e) { /* 무시 */ } wakeLock = null; }

// ---------- 결과 ----------
function onEnd(sum) {
  endSession(); lastSummary = sum; state = 'result';
  lastBest = addHistory(sum);
  ui.renderResult(sum); ui.go('scr-result');
  try { ui.renderCareerLine(applyRun(sum)); } catch (e) { console.error(e); ui.renderCareerLine(null); } // 경험치·미션·배지
  $('#btn-submit').hidden = true; $('#btn-submit').disabled = false;
  $('#submit-msg').textContent = sum.ranked ? '' : '훈련장 기록은 랭킹에 들어가지 않아요.';
  renderResRank(null);
  $('#scr-result').scrollTop = 0;
  // 챌린지 기록은 개인 랭킹에 자동 등록 (클럽 회원이면 팀 점수에도 같이). 개발용 ?demo 화면은 실제 랭킹에 올리지 않는다
  if (sum.ranked && params.get('demo')) { renderResRank({ err: '데모 화면 · 등록 안 함' }); $('#submit-msg').textContent = '개발용 데모 화면이라 랭킹에 올리지 않았어요.'; }
  else if (sum.ranked) submitScore();
}
// 결과 화면의 개인 랭킹 · 팀 랭킹 두 칸 (누르면 그 랭킹을 연다)
let lastBest = false;
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderResRank(o) {
  const el = $('#res-rank'); el.hidden = !o; if (!o) return;
  const c = getClub(), fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
  const solo = o.sending ? '<b>…</b><small>올리는 중</small>'
    : o.res ? `<b>${o.res.rank_week}위</b><small>이번 주 · 전체 ${o.res.rank_all}위${o.best ? ' · 내 최고 기록!' : ''}</small>`
    : `<b>–</b><small>${escH(o.err || '')}</small>`;
  const team = !c ? '<b>클럽 가입</b><small>판마다 팀 점수도 같이 쌓여요</small>'
    : o.sending ? `<b>…</b><small>${escH(c.name)}</small>`
    : o.res && o.res.club ? `<b>${o.res.club_rank ?? '–'}위</b><small>${escH(c.name)} · 이번 주 팀 점수 ${fmt(o.res.club_points)}</small>`
    : `<b>–</b><small>${escH(c.name)}</small>`;
  el.innerHTML = `<button type="button" class="rr" data-k="solo"><span class="rr-k">개인 랭킹</span>${solo}</button>`
    + `<button type="button" class="rr team" data-k="team"><span class="rr-k">팀 랭킹</span>${team}</button>`;
  el.querySelectorAll('.rr').forEach(b => b.addEventListener('click', () => { if (b.dataset.k === 'team' && !getClub()) club.open(); else openRanking(b.dataset.k); }));
}
const SUBMIT_MSG = { not_ready: '온라인 랭킹을 준비하고 있어요. 기록은 이 기기에 저장했어요.', network: '인터넷 연결을 확인하고 다시 눌러 주세요.', code: '챌린지 코드가 맞지 않아요. 인스타 DM으로 받은 코드를 넣어 주세요.',
  rate: '조금 뒤에 다시 등록해 주세요.', implausible: '기록을 확인할 수 없어요.', word: '닉네임에 쓸 수 없는 말이 있어요. 선수 등록에서 바꿔 주세요.', nick: '닉네임을 확인해 주세요.' };
async function submitScore() {
  const p = getProfile(), s = lastSummary; if (!p || !s) return;
  if (PREVIEW) { renderResRank({ err: '미리보기에선 꺼짐' }); $('#submit-msg').textContent = '미리보기 링크에서는 온라인 랭킹이 꺼져 있어요. 기록은 이 기기에 저장했어요.'; return; }
  const btn = $('#btn-submit'); btn.disabled = true; btn.hidden = true;
  $('#submit-msg').textContent = ''; renderResRank({ sending: true });
  const res = await Board.submit({ nick: p.nick, team: p.team || null, age: p.age, score: s.score, level: s.level, accuracy: s.accuracy, avg_rt: Math.min(9999, s.avgRt),
    calls: s.calls, goals: s.goals, brain_index: s.brainIndex, device: deviceId(), code: store.get('code', ''), club: getClub()?.code || '' });
  if (res.ok) {
    club.afterSubmit(res); renderResRank({ res, best: lastBest });
    ui.toast(res.club ? `개인 이번 주 ${res.rank_week}위 · 팀 ${res.club_rank ?? '–'}위` : `개인 이번 주 ${res.rank_week}위!`, 3000);
  } else {
    renderResRank({ err: '아직 못 올렸어요' });
    btn.hidden = false; btn.disabled = res.error === 'not_ready' || res.error === 'implausible';
    $('#submit-msg').textContent = SUBMIT_MSG[res.error] || '등록하지 못했어요.';
  }
}
$('#btn-submit').addEventListener('click', () => submitScore());
$('#btn-again').addEventListener('click', () => { showTitle(); openSetup(lastMode, setupLevel); });
$('#btn-home').addEventListener('click', showTitle);
$('#btn-share').addEventListener('click', async () => {
  const s = lastSummary; if (!s) return;
  if (PREVIEW) { ui.toast('미리보기 링크에서는 공유가 막혀 있어요'); return; }
  const url = location.origin + location.pathname;
  const text = `축구 두뇌 지수 ${s.brainIndex}점! FOOTBALL BRAIN 챌린지 ${s.score.toLocaleString('ko-KR')}점 (LV ${s.level}) — 너도 도전해 봐 👉 ${url}`;
  try {
    const blob = await shareCard(s, getProfile(), url, ui);
    const file = new File([blob], 'football-brain.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'FOOTBALL BRAIN', text }); return; }
    if (navigator.share) { await navigator.share({ title: 'FOOTBALL BRAIN', text, url }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'football-brain.png'; document.body.appendChild(a); a.click(); a.remove();
    try { await navigator.clipboard.writeText(text); ui.toast('결과 카드를 저장하고 문구를 복사했어요'); } catch (e) { ui.toast('결과 카드를 저장했어요'); }
  } catch (e) { if (e && e.name !== 'AbortError') ui.toast('공유하지 못했어요'); }
});

// ---------- 훈련장 ----------
const dSeg = seg('seg-dlevel', settings.dlevel || 1, v => { settings.dlevel = +v; setSettings(settings); });
$('#btn-drills').addEventListener('click', () => ui.open('scr-drills'));
$$('.drill').forEach(b => b.addEventListener('click', () => { ui.close('scr-drills'); openSetup(b.dataset.drill, +(dSeg.get() || 1)); }));

// ---------- 하는 법 ----------
$('#btn-howto').addEventListener('click', () => ui.open('scr-howto'));
$('#btn-info').addEventListener('click', () => ui.open('scr-info'));

// ---------- 랭킹 ----------
// 개인 랭킹(한 사람당 최고 기록 1개)과 팀 랭킹(클럽 팀 점수)을 나눠서 보여 준다. 챌린지 한 판은 둘 다에 들어간다.
let rKind = 'solo', rPeriod = 'week', rAge = 'all';
// 코치 목표 기록: 실제 선수가 아니라 '다음 목표'. 랭킹이 비어 보이지 않게 함께 보여 준다 (🎯 표시로 구분)
const TARGETS = [
  { name: '유망주', score: 3000, hint: '레벨 3까지 · 앞이 비면 ↑ 전진 패스' },
  { name: '주전', score: 10000, hint: '레벨 5까지 · 둘러보고 기억으로 패스' },
  { name: '국가대표', score: 25000, hint: '레벨 8까지 · ⚡ 역습 찬스로 골' },
];
const pSeg = seg('seg-period', rPeriod, v => { rPeriod = v; loadRanking(); });
const kSeg = seg('seg-kind', rKind, v => { rKind = v; if (rKind === 'team' && rPeriod === 'me') { rPeriod = 'week'; pSeg.set('week'); } loadRanking(); });
seg('seg-rage', rAge, v => { rAge = v; loadRanking(); });
$('#btn-ranking').addEventListener('click', () => openRanking('solo', 'week'));
function openRanking(kind = 'solo', period = 'week') {
  rKind = kind === 'team' ? 'team' : 'solo'; rPeriod = period; kSeg.set(rKind); pSeg.set(rPeriod);
  ui.open('scr-ranking'); loadRanking();
}
async function loadRanking() {
  const note = $('#rank-note'), me = getProfile()?.nick;
  $('#seg-period [data-v="me"]').hidden = rKind === 'team';
  $('#seg-rage').hidden = rKind === 'team' || rPeriod === 'me';
  if (rKind === 'team') { // 팀 랭킹 (클럽 대항전)
    if (PREVIEW) { note.textContent = '미리보기 링크에서는 클럽 대항전이 꺼져 있어요.'; ui.renderRanking([], null, '정식 주소에서 열려요.'); return; }
    note.textContent = '불러오는 중…';
    const period = rPeriod, res = await Board.clubTop(period);
    if (rKind !== 'team' || period !== rPeriod) return; // 그사이 다른 탭을 눌렀으면 버린다
    if (res.ok) {
      note.textContent = period === 'week' ? '팀 점수 = 이번 주 팀원 챌린지 점수 합 (한 사람당 하루 5판). 월요일 0시에 새로 시작, 1~3위는 트로피!' : '지금까지 쌓인 팀 점수 합과 받은 트로피.';
      renderClubRanking($('#rank-list'), res.rows, getClub()?.id, period);
    } else { note.textContent = res.error === 'not_ready' ? '클럽 대항전을 준비하고 있어요.' : '인터넷 연결을 확인해 주세요.'; ui.renderRanking([], null, '팀 랭킹을 불러오지 못했어요.'); }
    return;
  }
  if (rPeriod === 'me') {
    const h = store.get('history', []).filter(x => x.mode === 'challenge').sort((a, b) => b.score - a.score).slice(0, 20);
    note.textContent = '이 기기에 저장된 내 챌린지 기록이에요.';
    ui.renderRanking(h.map((x, i) => ({ rank: i + 1, nick: new Date(x.t).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }), score: x.score, level: x.level, accuracy: x.accuracy, brain_index: x.bi })), null, '아직 챌린지 기록이 없어요.');
    return;
  }
  if (PREVIEW) { note.textContent = '미리보기 링크에서는 온라인 랭킹이 꺼져 있어요. "내 기록"에서 이 기기의 기록을 볼 수 있어요.'; ui.renderRanking([], null, '정식 주소에서 랭킹이 열려요.'); return; }
  note.textContent = '불러오는 중…';
  const period = rPeriod, age = rAge;
  const res = await Board.top(period, age);
  if (rKind !== 'solo' || period !== rPeriod || age !== rAge) return; // 그사이 다른 탭을 눌렀으면 늦게 온 결과는 버린다
  if (res.ok) {
    const ev = weekInfo().ev;
    note.textContent = (rPeriod === 'week' ? `챌린지가 끝나면 자동으로 올라가요. 매주 월요일 0시(한국 시간)에 새로 시작, 한 사람당 최고 기록 1개. 이번 주: ${ev.ico} ${ev.name}(${ev.desc}).` : '역대 최고 기록. 한 사람당 1개.') + ' 🎯 = 코치 목표(실제 선수 아님).';
    ui.renderRanking(res.rows, me, '아직 이번 주 기록이 없어요. 코치 목표부터 넘어 보세요!', TARGETS);
  }
  else { note.textContent = res.error === 'not_ready' ? '온라인 랭킹을 준비하고 있어요. 지금은 "내 기록"만 볼 수 있어요.' : '인터넷 연결을 확인해 주세요.'; ui.renderRanking([], null, '랭킹을 불러오지 못했어요.'); }
}
void pSeg;

// ---------- 설정 ----------
$('#btn-settings').addEventListener('click', () => ui.open('scr-settings'));
seg('seg-quality', settings.quality, v => { settings.quality = v; setSettings(settings); ui.toast('다음에 게임을 열 때 적용돼요'); });
seg('seg-sound', settings.sound, v => { settings.sound = v; setSettings(settings); audio.setMode(v); audio.unlock(); audio.ok(); });
// ---------- 마이크 확인 (시작 준비 화면·설정 화면 공통) ----------
let micOut = null, micHeard = '', micTimer = null;
async function micCheck(out, chromeBtn) {
  chromeBtn.hidden = true; out.classList.remove('ok', 'bad');
  if (!voice.supported) { out.textContent = micHelp(inApp ? 'inapp' : 'unsupported', ENV); out.classList.add('bad'); return; }
  voice.stop(); voice.reset(); clearTimeout(micTimer);
  out.textContent = '마이크를 써도 되는지 물어보면 "허용"을 눌러 주세요…';
  const p = await voice.ensurePermission();
  if (p === 'denied' || p === 'nomic') { out.textContent = micHelp(p, ENV); out.classList.add('bad'); return; }
  micOut = out; micHeard = ''; state = 'mictest';
  out.textContent = '듣는 중… "10번 패스!"라고 말해 보세요 🎙';
  voice.start();
  micTimer = setTimeout(() => {
    voice.stop(); if (state === 'mictest') state = 'title';
    if (micHeard) {
      const c = parseCall(micHeard);
      out.textContent = c.num ? `잘 들려요 ✅ "${micHeard}" → ${c.num}번${c.pass ? ' 패스' : ''}` : `들려요 ✅ "${micHeard}" — 번호를 또렷하게 말하면 콜 성공!`;
      out.classList.add('ok');
    } else {
      out.textContent = micHelp(voice.lastErr || 'silent', ENV); out.classList.add('bad');
      if (isAndroid && !isChromeAndroid) { chromeBtn.href = chromeIntent(); chromeBtn.hidden = false; }
    }
    window.__fbLog?.(`MIC ${micHeard ? 'OK ' + micHeard : 'FAIL ' + (voice.lastErr || 'silent')}`);
  }, 6000);
}
$('#btn-miccheck').addEventListener('click', () => micCheck($('#miccheck-out'), $('#btn-openchrome')));
$('#btn-mictest').addEventListener('click', () => micCheck($('#mic-out'), $('#btn-openchrome2')));

// ---------- 인앱 브라우저 ----------
function showInApp() {
  const box = $('#inapp'); box.hidden = false;
  if (/Android/i.test(UA)) {
    const a = $('#inapp-open'); a.hidden = false;
    a.href = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`;
    $('#inapp-how').innerHTML = '아래 버튼으로 크롬에서 열거나, 오른쪽 위 ⋮ → <u>다른 브라우저로 열기</u>를 눌러 주세요.';
  } else if (/KAKAOTALK/i.test(UA)) {
    location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
  }
  $('#inapp-close').addEventListener('click', () => { box.hidden = true; });
}

// 개발용 화면 미리보기: ?demo=result | play&lv=7 | mot | howto | drills | ranking | settings | setup
async function demo(which) {
  const lv = +(params.get('lv') || 1);
  if (which === 'card') { // 공유 카드 미리보기
    await demo('result');
    const blob = await shareCard(lastSummary, getProfile() || { nick: '슛돌이7', age: 'u10', team: '하프타임FC' }, location.origin + location.pathname, ui);
    const img = document.createElement('img'); img.src = URL.createObjectURL(blob);
    img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:99';
    document.body.appendChild(img);
  } else if (which === 'result') {
    onEnd({ mode: 'challenge', title: '챌린지', ranked: true, score: 18420, level: 6, accuracy: 82, avgRt: 612, decisions: 28, correct: 23, calls: 9, callChances: 14,
      goals: 5, shots: 6, scans: 21, scanPerMin: 7.4, minFlash: 470, whistle: [2, 3], both: [3, 4], scanRound: [4, 5], unseen: 0, mot: [0, 0], steps: 380, stepsPerMin: 134,
      duration: 170, axes: { judge: .82, speed: .81, vision: .71, call: .64, scan: .41, brake: .67 }, brainIndex: 74, voiceOn: true, feetOn: true });
  } else if (which === 'tutorial') { startTutorial();
  } else if (which === 'play' || which === 'mot' || which === 'scan' || which === 'shoot') {
    if (!getProfile()) setProfile({ nick: '미리보기', age: 'u10', team: '', num: 7 });
    ui.go('none'); game.endCinematic(); game.opts.voice = false; game.event = weekInfo().ev.id;
    game.forceShot = params.has('shot'); // 개발용: ?demo=play&shot (슛 장면으로 바로)
    game.start(which === 'play' ? 'challenge' : which, { level: lv });
    if (which === 'play') { game.level = lv; game.newAttack(true); }
    gestures.enabled = true; state = 'play';
  } else if (which === 'career') { openCareer();
  } else if (['howto', 'drills', 'ranking', 'settings', 'setup', 'profile', 'info'].includes(which)) {
    if (which === 'setup') openSetup('challenge'); else if (which === 'profile') openProfile(); else if (which === 'ranking') openRanking(params.get('kind') || 'solo'); else ui.open('scr-' + which);
  }
}

// 개발용: ?debug 에서 v 키로 음성 입력 흉내 (콘솔에서 window.__fb 로 게임 상태 보기)
if (params.has('debug')) window.addEventListener('keydown', (e) => {
  if (e.key === 'v' && state === 'play') { const t = prompt('들린 말 (예: 7번 패스)'); if (t) voice.onText(t, true, t); }
});

const booted = boot();
if (params.has('debug')) booted.then(() => { window.__fb = { game, world, ui, Board, club }; });
if (params.get('demo')) booted.then(() => setTimeout(() => demo(params.get('demo')), 700));
