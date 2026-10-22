// Timers & clocks (shared by console, outputs and remote).
// A timer is { id, name, mode: 'countdown' | 'until' | 'countup', duration (s), target ('HH:MM'), running, startedAt (ms), elapsed (ms) }.
// Values are computed from server time, so every screen shows the same number without per-second updates.

let offset = 0; // server clock minus this device's clock
export const syncClock = (serverNow) => { if (serverNow) offset = serverNow - Date.now(); };
export const now = () => Date.now() + offset;

function targetMs(target, t) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(target || '').trim());
  if (!m) return t;
  const d = new Date(t); d.setHours(Number(m[1]), Number(m[2]), Number(m[3] || 0), 0);
  // More than an hour past today's time? Then it means the same time tomorrow (e.g. Sunday's 10:00 set on Saturday night).
  if (d.getTime() < t - 3600_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Milliseconds remaining (countdown / until) or elapsed (countup). Negative = overrun.
export function timerValue(timer, at = now()) {
  if (!timer) return 0;
  const elapsed = (timer.elapsed || 0) + (timer.running && timer.startedAt ? at - timer.startedAt : 0);
  if (timer.mode === 'countup') return elapsed;
  if (timer.mode === 'until') return targetMs(timer.target, at) - at;
  return (Number(timer.duration) || 0) * 1000 - elapsed;
}

export function formatMs(ms) {
  const neg = ms < 0; let s = Math.floor(Math.abs(ms) / 1000);
  if (!neg && ms % 1000 > 0 && ms > 0) s = Math.ceil(ms / 1000); // countdowns show 5:00 until it really ticks
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  return (neg ? '−' : '') + body;
}
export const timerText = (timer, at) => formatMs(timerValue(timer, at));
export const timerOver = (timer, at) => timer?.mode !== 'countup' && timerValue(timer, at) < 0;

// Actions return a new timer object (state is kept on the server).
export function startTimer(t) { return t.running ? t : { ...t, running: true, startedAt: now() }; }
export function stopTimer(t) { return !t.running ? t : { ...t, running: false, elapsed: (t.elapsed || 0) + (now() - t.startedAt), startedAt: 0 }; }
export function resetTimer(t) { return { ...t, running: false, startedAt: 0, elapsed: 0 }; }

// "{timer}" = first running timer, "{timer:Name}" = timer by name, "{clock}" = time of day.
export function fillTokens(text, timers = [], at = now()) {
  return String(text || '')
    .replace(/\{clock\}/gi, () => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{timer(?::([^}]+))?\}/gi, (m, name) => {
      const t = name ? timers.find((x) => x.name.toLowerCase() === name.trim().toLowerCase()) : timers.find((x) => x.running || x.mode === 'until');
      return t ? timerText(t, at) : '';
    });
}

export const DEFAULT_TIMERS = [
  { id: 't1', name: 'Service starts', mode: 'until', target: '10:00', duration: 0, running: false, startedAt: 0, elapsed: 0 },
  { id: 't2', name: 'Countdown', mode: 'countdown', target: '', duration: 300, running: false, startedAt: 0, elapsed: 0 },
  { id: 't3', name: 'Sermon', mode: 'countup', target: '', duration: 0, running: false, startedAt: 0, elapsed: 0 },
];

// Show "until" timers on the stage only when they matter: within 3 hours before, up to 15 minutes after.
export const timerRelevant = (t, at = now()) => t.running || (t.mode === 'until' && timerValue(t, at) < 3 * 3600_000 && timerValue(t, at) > -15 * 60_000);
