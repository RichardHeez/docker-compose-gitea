// Show-control actions shared by the console and the phone remote.
import { bookById } from './books.js';
import { chapter, paginate, postJson } from './render.js';

// Compare items ignoring per-showing fields (page, highlights).
const core = (i) => { if (!i) return i; const { page, pages, highlight, ...rest } = i; return rest; };
export const sameItem = (a, b) => JSON.stringify(core(a)) === JSON.stringify(core(b));
export const serviceIndex = (S, item) => S.service.findIndex((s) => sameItem(s, item));

export function nextOf(S, item) {
  if (!item) return null;
  const i = serviceIndex(S, item);
  if (i >= 0 && S.service[i + 1]) return S.service[i + 1];
  if (item.kind === 'scripture') {
    const r = item.ref; const s = r.verseStart || 1; const e = r.verseEnd || s;
    return { kind: 'scripture', ref: { ...r, verseStart: e + 1, verseEnd: e + 1 + (e - s) } };
  }
  return null;
}

export const push = (patch) => postJson('/api/state', patch);

export async function goLive(S, item, { page = 0 } = {}) {
  if (!item) return null;
  const live = await paginate({ ...core(item), page, highlight: [] }, S);
  if (page < 0) live.page = live.pages - 1;
  await push({ live, next: nextOf(S, live), black: false, clear: false, logo: false });
  return live;
}

export async function serviceStep(S, d) {
  if (!S.service.length) return null;
  const i = serviceIndex(S, S.live);
  if (i < 0 && d < 0) return null;
  const n = i < 0 ? 0 : Math.min(S.service.length - 1, Math.max(0, i + d));
  if (n === i) return null;
  return goLive(S, S.service[n]);
}

// Next/previous screen: pages of a long passage first, then the next verses (or service item).
export async function step(S, d) {
  const live = S.live;
  if (!live) return serviceStep(S, d);
  const pages = live.pages || 1, page = live.page || 0;
  if (pages > 1 && page + d >= 0 && page + d < pages) {
    const moved = { ...live, page: page + d, highlight: [] };
    await push({ live: moved });
    return moved;
  }
  if (serviceIndex(S, live) >= 0) return serviceStep(S, d);
  if (live.kind !== 'scripture') return null; // end of a song/slide that isn't in the service: stay put

  const r = live.ref;
  const s = r.verseStart || 1; const e = r.verseEnd || s; const len = e - s + 1;
  const ns = s + d * len;
  let ref = { ...r, verseStart: ns, verseEnd: ns + len - 1 };
  try {
    const verses = await chapter(S.translation, r.book, r.chapter);
    const max = verses.length ? verses[verses.length - 1].verse : 999;
    if (ns > max) {
      if (r.chapter >= bookById(r.book).chapters) return null;
      ref = { book: r.book, chapter: r.chapter + 1, verseStart: 1, verseEnd: len };
    } else if (ns < 1) {
      if (r.chapter <= 1) return null;
      const pv = await chapter(S.translation, r.book, r.chapter - 1);
      const last = pv[pv.length - 1]?.verse || 1;
      ref = { book: r.book, chapter: r.chapter - 1, verseStart: Math.max(1, last - len + 1), verseEnd: last };
    } else ref.verseEnd = Math.min(ref.verseEnd, max);
  } catch { /* offline: step blindly */ }
  return goLive(S, { kind: 'scripture', ref }, { page: d < 0 ? -1 : 0 });
}

export async function toggleHighlight(S, word) {
  if (!S.live) return;
  const hl = new Set(S.live.highlight || []);
  hl.has(word) ? hl.delete(word) : hl.add(word);
  await push({ live: { ...S.live, highlight: [...hl] } });
}
