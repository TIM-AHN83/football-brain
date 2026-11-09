// 휴대폰 시험용 표시판: 주소 끝에 ?test 를 붙이면 화면 왼쪽에 마이크·센서·화면 상태가 보인다.
// 무엇이 되고 안 되는지 화면을 찍어 보내면 바로 고칠 수 있다.
import { parseCall } from './voice.js';

export function startTestPanel(get) {
  const errs = window.__fbErrs || (window.__fbErrs = []);
  if (!window.__fbErrHook) {
    window.__fbErrHook = true;
    addEventListener('error', (e) => errs.push(e.message || '파일을 못 불러옴'), true);
    addEventListener('unhandledrejection', (e) => errs.push('P: ' + (e.reason?.message || e.reason)));
  }
  const el = document.createElement('div');
  el.id = 'testpanel';
  // 위쪽 하늘 부분에 둔다 (가운데에 두면 왼쪽 패스길의 수비수를 가린다)
  el.style.cssText = 'position:fixed;left:6px;top:calc(env(safe-area-inset-top,0px) + 70px);z-index:60;max-width:64vw;padding:5px 7px;border-radius:6px;'
    + 'background:rgba(0,0,0,.55);color:#e8f0ff;font:10.5px/1.4 ui-monospace,Menlo,Consolas,monospace;'
    + 'pointer-events:none;white-space:pre-wrap;word-break:break-all';
  document.body.appendChild(el);

  let frames = 0, t0 = performance.now(), shake = 0;
  const tick = () => { frames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const ok = (b) => (b ? 'O' : 'X');

  setInterval(() => {
    const now = performance.now(), fps = Math.round((frames * 1000) / (now - t0)); frames = 0; t0 = now;
    const { voice, sensors, world, heard, state } = get();
    if (!voice || !sensors) { el.textContent = `준비 중… https ${ok(isSecureContext)}`; return; }
    const p = heard ? parseCall(heard) : null;
    shake = Math.max(sensors.peak || 0, shake * 0.75); sensors.peak = 0; // 최근 흔들림 최고값을 천천히 줄이며 보여 준다
    el.textContent = [
      `[시험] https ${ok(isSecureContext)} · 화면 ${state}`,
      `음성 지원 ${ok(voice.supported)} · ${voice.blocked ? '막힘' : voice.running ? '듣는 중' : '꺼짐'}${voice.lastErr ? ' · ' + voice.lastErr : ''}`,
      `들린 말: ${heard || '-'}`,
      p ? `해석: ${p.num ?? '?'}번${p.pass ? ' 패스' : ''}${p.carry ? ' 돌파' : ''}${p.shoot ? ' 슛' : ''}` : '',
      `걸음 센서 ${ok(sensors.hasMotion)} · ${sensors.steps}걸음 · 분당 ${sensors.cadence}`,
      `  흔들림 ${shake.toFixed(2)} (1.15↑ = 한 걸음)`,
      `방향 센서 ${ok(sensors.hasOrient)} · ${Math.round(sensors.yaw * 57.3)}°`,
      `${fps}fps · 해상도 x${world ? world.dpr : '-'}`,
      ...errs.slice(-3).map((e) => '! ' + String(e).slice(0, 90)),
    ].filter(Boolean).join('\n');
  }, 300);
}
