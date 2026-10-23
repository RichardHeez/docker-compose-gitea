// Pure show-state helpers shared by the console and the phone remote.
import { resetTimer, startTimer, stopTimer } from './timers.js';

// State patch for clearing a layer ("audio" has no state; the console fades its player).
export function clearPatch(kind, s) {
  const hideProps = { props: (s.props || []).map((p) => ({ ...p, visible: false })) };
  const hideMsg = { message: { ...(s.message || {}), visible: false } };
  switch (kind) {
    case 'all': return { live: null, black: false, clear: false, logo: false, clearMedia: true, ...hideProps, ...hideMsg };
    case 'slide': return { live: null };
    case 'media': return { clearMedia: !s.clearMedia };
    case 'props': return hideProps;
    case 'messages': return hideMsg;
    default: return {};
  }
}

export function lookPatch(s, lookId) {
  const look = (s.looks || []).find((l) => l.id === lookId);
  if (!look) return {};
  return { channels: s.channels.map((c) => { const saved = look.channels.find((x) => x.id === c.id); return saved ? { ...c, ...saved.settings } : c; }) };
}

// Everything a macro does, as one state patch plus follow-ups.
export function macroPatch(s, m) {
  const a = m.actions || {};
  const patch = {};
  if (a.look) Object.assign(patch, lookPatch(s, a.look));
  for (const k of a.clear || []) Object.assign(patch, clearPatch(k, { ...s, ...patch }));
  if (a.timer && a.timerAction) {
    const fn = { start: startTimer, stop: stopTimer, reset: resetTimer, restart: (t) => startTimer(resetTimer(t)) }[a.timerAction];
    if (fn) patch.timers = (patch.timers || s.timers).map((t) => (t.id === a.timer ? fn(t) : t));
  }
  if (a.announcements) patch.announcements = { ...s.announcements, playing: a.announcements === 'play', index: a.announcements === 'play' ? 0 : s.announcements?.index || 0, startedAt: Date.now() };
  if (a.message) patch.message = { text: a.message, style: s.message?.style || 'lower', visible: true };
  return { patch, goto: a.goto ? s.service[Number(a.goto) - 1] || null : null, fadeAudio: (a.clear || []).includes('audio') || (a.clear || []).includes('all') };
}
