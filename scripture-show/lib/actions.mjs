// Server-side show actions, used by hardware triggers (Stream Deck / Bitfocus Companion over HTTP, MIDI, timelines).
// runAction(state, "path", params, deps) -> { patch, sideEffects } where the path is one of:
//   next | prev | clear/all|slide|media|props|messages|audio | black | logo | clear (toggles)
//   macro/<name> | look/<name> | timer/<name>/start|stop|reset|restart | message/show (text=) | message/hide
//   service/<n> | announcements/play|stop
import { clearPatch, lookPatch, macroPatch } from '../public/js/macros.js';
import { resetTimer, startTimer, stopTimer } from '../public/js/timers.js';
import { BOOKS } from '../public/js/books.js';

const strip = (i) => { if (!i) return i; const { page, pages, highlight, ...rest } = i; return rest; };
const same = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const byName = (list, key) => (list || []).find((x) => x.id === key || String(x.name || '').toLowerCase() === String(key || '').toLowerCase());

function nextOf(s, item) {
  if (!item) return null;
  const i = s.service.findIndex((x) => same(x, item));
  if (i >= 0 && s.service[i + 1]) return s.service[i + 1];
  if (item.kind === 'scripture') {
    const r = item.ref; const a = r.verseStart || 1; const e = r.verseEnd || a;
    return { kind: 'scripture', ref: { ...r, verseStart: e + 1, verseEnd: e + 1 + (e - a) } };
  }
  return null;
}

async function pagesFor(s, item, deps) {
  if (item?.kind === 'song') return Math.max(1, item.slides?.length || 1);
  if (item?.kind !== 'scripture' || !s.splitChars) return 1;
  try {
    const verses = await deps.getChapter(s.translation, item.ref.book, item.ref.chapter);
    const len = verses.filter((v) => v.verse >= (item.ref.verseStart || 1) && v.verse <= (item.ref.verseEnd || item.ref.verseStart || 1)).reduce((n, v) => n + v.text.length + 1, 0);
    return Math.max(1, Math.ceil(len / s.splitChars));
  } catch { return 1; }
}

export async function goLivePatch(s, item, deps, page = 0) {
  const pages = await pagesFor(s, item, deps);
  const live = { ...strip(item), pages, page: page < 0 ? pages - 1 : Math.min(page, pages - 1), highlight: [] };
  return { live, next: nextOf(s, live), black: false, clear: false, logo: false, clearMedia: false };
}

async function step(s, d, deps) {
  const live = s.live;
  const serviceAt = (i) => (s.service[i] ? goLivePatch(s, s.service[i], deps) : null);
  if (!live) return d > 0 ? serviceAt(0) : null;
  const pages = live.pages || 1, page = live.page || 0;
  if (pages > 1 && page + d >= 0 && page + d < pages) return { live: { ...live, page: page + d, highlight: [] } };
  const i = s.service.findIndex((x) => same(x, live));
  if (i >= 0) return serviceAt(i + d);
  if (live.kind !== 'scripture') return null;
  const r = live.ref; const a = r.verseStart || 1; const e = r.verseEnd || a; const len = e - a + 1;
  let ref = { ...r, verseStart: a + d * len, verseEnd: a + d * len + len - 1 };
  try {
    const verses = await deps.getChapter(s.translation, r.book, r.chapter);
    const max = verses.at(-1)?.verse || 999;
    if (ref.verseStart > max) {
      if (r.chapter >= (BOOKS.find((b) => b.id === r.book)?.chapters || 1)) return null;
      ref = { book: r.book, chapter: r.chapter + 1, verseStart: 1, verseEnd: len };
    } else if (ref.verseStart < 1) {
      if (r.chapter <= 1) return null;
      const prev = await deps.getChapter(s.translation, r.book, r.chapter - 1);
      const last = prev.at(-1)?.verse || 1;
      ref = { book: r.book, chapter: r.chapter - 1, verseStart: Math.max(1, last - len + 1), verseEnd: last };
    } else ref.verseEnd = Math.min(ref.verseEnd, max);
  } catch { /* step blindly */ }
  return goLivePatch(s, { kind: 'scripture', ref }, deps, d < 0 ? -1 : 0);
}

export async function runAction(s, path, params = {}, deps = {}) {
  const parts = String(path || '').replace(/^\/+|\/+$/g, '').split('/').map((x) => decodeURIComponent(x));
  const [verb, a, b] = parts;
  const out = { patch: null, audio: null, dmx: null };
  switch (verb) {
    case 'next': out.patch = await step(s, 1, deps); break;
    case 'prev': case 'previous': out.patch = await step(s, -1, deps); break;
    case 'black': case 'logo': out.patch = { [verb]: params.on !== undefined ? params.on === 'true' || params.on === '1' : !s[verb] }; break;
    case 'clear':
      if (!a) out.patch = { clear: !s.clear };
      else { out.patch = clearPatch(a, s); if (a === 'all' || a === 'audio') out.audio = 'fade'; }
      break;
    case 'macro': {
      const m = byName(s.macros, a); if (!m) throw new Error(`No macro called “${a}”`);
      const { patch, goto, fadeAudio } = macroPatch(s, m);
      out.patch = patch;
      if (goto) Object.assign(out.patch, await goLivePatch({ ...s, ...patch }, goto, deps));
      if (fadeAudio) out.audio = 'fade';
      if (m.actions?.dmx) out.dmx = m.actions.dmx;
      break;
    }
    case 'look': { const l = byName(s.looks, a); if (!l) throw new Error(`No look called “${a}”`); out.patch = lookPatch(s, l.id); break; }
    case 'timer': {
      const t = byName(s.timers, a); if (!t) throw new Error(`No timer called “${a}”`);
      const fn = { start: startTimer, stop: stopTimer, reset: resetTimer, restart: (x) => startTimer(resetTimer(x)), toggle: (x) => (x.running ? stopTimer(x) : startTimer(x)) }[b || 'toggle'];
      if (!fn) throw new Error('Timer action must be start, stop, reset, restart or toggle');
      out.patch = { timers: s.timers.map((x) => (x.id === t.id ? fn(x) : x)) };
      break;
    }
    case 'message':
      if (a === 'hide') out.patch = clearPatch('messages', s);
      else out.patch = { message: { text: params.text ?? s.message?.text ?? '', style: params.style || s.message?.style || 'lower', visible: true } };
      break;
    case 'service': {
      const item = s.service[Number(a) - 1]; if (!item) throw new Error(`No service item #${a}`);
      out.patch = await goLivePatch(s, item, deps);
      break;
    }
    case 'announcements': out.patch = { announcements: { ...s.announcements, playing: a === 'play', startedAt: Date.now(), index: a === 'play' ? 0 : s.announcements?.index || 0 } }; break;
    default: throw new Error(`Unknown action “${verb}”`);
  }
  return out;
}

export const ACTIONS_HELP = [
  ['next', 'Next slide / verse / service item'], ['prev', 'Previous'], ['clear/all', 'Clear all (also /clear/slide, /media, /props, /messages, /audio)'],
  ['black', 'Toggle black'], ['logo', 'Toggle logo'], ['macro/NAME', 'Run a macro'], ['look/NAME', 'Apply a look'],
  ['timer/NAME/start', 'Timer start (stop, reset, restart, toggle)'], ['message/show?text=…', 'Show a message'], ['message/hide', 'Hide the message'],
  ['service/N', 'Go live with service item N'], ['announcements/play', 'Play the announcements loop (or /stop)'],
];
