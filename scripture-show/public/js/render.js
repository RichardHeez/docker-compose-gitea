// Shared slide resolution + rendering for output windows and console monitors.
import { bookById, formatRef, refKey } from './books.js';

export const api = async (p, opts) => {
  const r = await fetch(p, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
};

// Language name (as listed by the Bible source) -> BCP-47 code for voices & speech recognition.
export const LANG_CODES = {
  english: 'en-US', spanish: 'es-ES', español: 'es-ES', portuguese: 'pt-BR', português: 'pt-BR', french: 'fr-FR', français: 'fr-FR',
  german: 'de-DE', deutsch: 'de-DE', italian: 'it-IT', italiano: 'it-IT', dutch: 'nl-NL', nederlands: 'nl-NL', russian: 'ru-RU', русский: 'ru-RU',
  ukrainian: 'uk-UA', українська: 'uk-UA', polish: 'pl-PL', polski: 'pl-PL', czech: 'cs-CZ', slovak: 'sk-SK', romanian: 'ro-RO', hungarian: 'hu-HU',
  greek: 'el-GR', hebrew: 'he-IL', עברית: 'he-IL', arabic: 'ar-SA', العربية: 'ar-SA', persian: 'fa-IR', farsi: 'fa-IR', turkish: 'tr-TR',
  chinese: 'zh-CN', 中文: 'zh-CN', japanese: 'ja-JP', 日本語: 'ja-JP', korean: 'ko-KR', 한국어: 'ko-KR', vietnamese: 'vi-VN', thai: 'th-TH',
  indonesian: 'id-ID', malay: 'ms-MY', tagalog: 'fil-PH', filipino: 'fil-PH', hindi: 'hi-IN', bengali: 'bn-IN', tamil: 'ta-IN', telugu: 'te-IN',
  malayalam: 'ml-IN', kannada: 'kn-IN', marathi: 'mr-IN', gujarati: 'gu-IN', punjabi: 'pa-IN', urdu: 'ur-PK', nepali: 'ne-NP', swahili: 'sw-KE',
  amharic: 'am-ET', yoruba: 'yo-NG', igbo: 'ig-NG', hausa: 'ha-NG', zulu: 'zu-ZA', afrikaans: 'af-ZA', swedish: 'sv-SE', norwegian: 'nb-NO',
  danish: 'da-DK', finnish: 'fi-FI', icelandic: 'is-IS', estonian: 'et-EE', latvian: 'lv-LV', lithuanian: 'lt-LT', bulgarian: 'bg-BG',
  serbian: 'sr-RS', croatian: 'hr-HR', slovenian: 'sl-SI', albanian: 'sq-AL', armenian: 'hy-AM', georgian: 'ka-GE', latin: 'la',
};
export const langCode = (language) => {
  const k = String(language || '').toLowerCase();
  return LANG_CODES[k] || LANG_CODES[k.split(/[\s(,]/)[0]] || '';
};

// ---------------------------------------------------------------- data
const chapterCache = new Map();
const bookCache = new Map();
let translationIndex = null;

export async function translations() {
  if (!translationIndex) translationIndex = api('/api/translations').catch((e) => { translationIndex = null; throw e; });
  return translationIndex;
}
export async function translationInfo(id) {
  const langs = await translations().catch(() => []);
  for (const l of langs) for (const t of l.translations) if (t.id === id) return { ...t, language: l.language, lang: langCode(l.language) };
  return { id, name: id, language: '', lang: '', dir: 'ltr' };
}
export async function books(tr) {
  if (!bookCache.has(tr)) bookCache.set(tr, api(`/api/books/${encodeURIComponent(tr)}`).catch((e) => { bookCache.delete(tr); throw e; }));
  return bookCache.get(tr);
}
export async function bookName(tr, id) {
  try { return (await books(tr)).find((b) => b.id === Number(id))?.name || bookById(id)?.name; } catch { return bookById(id)?.name; }
}
export async function chapter(tr, book, ch) {
  const k = `${tr}/${book}/${ch}`;
  if (!chapterCache.has(k)) chapterCache.set(k, api(`/api/chapter/${encodeURIComponent(tr)}/${book}/${ch}`).catch((e) => { chapterCache.delete(k); throw e; }));
  return chapterCache.get(k);
}
export async function passage(tr, ref) {
  const [verses, name, info] = await Promise.all([chapter(tr, ref.book, ref.chapter), bookName(tr, ref.book), translationInfo(tr)]);
  const start = ref.verseStart || 1;
  const end = ref.verseStart ? (ref.verseEnd || start) : start;
  const picked = verses.filter((v) => v.verse >= start && v.verse <= end);
  return { reference: formatRef({ ...ref, verseStart: start, verseEnd: end }, name), translation: tr, dir: info.dir, lang: info.lang, verses: picked };
}

// Turn the shared "live" item into a concrete slide for one channel.
export async function resolveSlide(item, channel, state) {
  if (!item) return { kind: 'blank' };
  if (item.kind === 'text') return { kind: 'text', title: item.title || '', body: item.body || '' };
  if (item.kind !== 'scripture' || !item.ref) return { kind: 'blank' };
  const tr = channel?.translation || state.translation;
  const slide = { kind: 'scripture', heading: item.heading || '' };
  try { slide.primary = await passage(tr, item.ref); }
  catch (e) {
    slide.primary = { reference: formatRef(item.ref), translation: tr, verses: [], error: e.message };
  }
  if (channel?.secondary && channel.secondary !== tr) {
    try { slide.secondary = await passage(channel.secondary, item.ref); } catch { /* optional */ }
  }
  return slide;
}
export const slideKey = (item, channel, state) => JSON.stringify([
  item?.kind, refKey(item?.ref), item?.title, item?.body, channel?.translation || state.translation, channel?.secondary,
]);

// ---------------------------------------------------------------- rendering
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function verseHtml(p, showNumbers) {
  if (p.error && !p.verses.length) return `<span class="err">${esc(p.reference)} — not available in ${esc(p.translation)}</span>`;
  return p.verses.map((v) => (showNumbers || p.verses.length > 1 ? `<sup>${v.verse}</sup>` : '') + esc(v.text)).join(' ');
}

// Builds the DOM for a slide inside `layer`. `opts.overlay` = black/clear/logo flags.
export function buildSlide(slide, channel = {}, state = {}, opts = {}) {
  const mode = channel.mode || 'full';
  const el = document.createElement('div');
  const transparent = mode === 'alpha';
  el.className = `slide mode-${mode} theme-${channel.theme || 'aurora'} align-${channel.align || 'center'}`;
  if (transparent) el.classList.add('transparent');
  if (channel.textColor) el.style.setProperty('--text', channel.textColor);
  el.style.setProperty('--scale', channel.fontScale || 1);
  const bg = channel.background && mode !== 'alpha' && mode !== 'chroma'
    ? (/\.(mp4|webm|mov)(\?|$)/i.test(channel.background)
      ? `<video class="bg-media" src="${esc(channel.background)}" autoplay muted loop playsinline></video>`
      : `<div class="bg-media" style="background-image:url('${esc(channel.background)}')"></div>`)
    : '';
  const isStage = mode === 'stage' || mode === 'confidence';

  if (opts.black && !isStage) { el.classList.add('is-black'); el.innerHTML = ''; return el; }

  let body = '';
  if (opts.logo && !isStage) {
    body = `<div class="logo"><div class="logo-mark">✦</div><div class="logo-text">${esc(state.logoText || '')}</div></div>`;
  } else if (opts.clear || slide.kind === 'blank') {
    body = '';
  } else if (slide.kind === 'text') {
    body = `<div class="box"><div class="title fit">${esc(slide.title)}</div>${slide.body ? `<div class="subtitle">${esc(slide.body)}</div>` : ''}</div>`;
  } else if (slide.kind === 'scripture') {
    const p = slide.primary, s = slide.secondary;
    const ref = channel.showReference !== false ? `<div class="ref">${esc(p.reference)}<span class="tr">${esc(p.translation)}</span></div>` : '';
    const sec = s ? `<div class="secondary" dir="${s.dir || 'auto'}" lang="${esc(s.lang)}">${verseHtml(s, channel.showVerseNumbers)}<div class="ref small">${esc(s.reference)}<span class="tr">${esc(s.translation)}</span></div></div>` : '';
    body = `<div class="box${s ? ' parallel' : ''}">
      <div class="verse fit" dir="${p.dir || 'auto'}" lang="${esc(p.lang)}">${verseHtml(p, channel.showVerseNumbers)}</div>
      ${sec}${mode === 'lower' || mode === 'chroma' || mode === 'alpha' ? '' : ref}
    </div>${mode === 'lower' || mode === 'chroma' || mode === 'alpha' ? ref : ''}`;
  }

  if (isStage) {
    const msg = state.stageMessage ? `<div class="stage-msg">${esc(state.stageMessage)}</div>` : '';
    const status = opts.black ? 'BLACK' : opts.logo ? 'LOGO' : opts.clear ? 'CLEAR' : 'LIVE';
    const next = opts.nextLabel ? `<div class="stage-next"><span>NEXT</span>${esc(opts.nextLabel)}</div>` : '';
    el.innerHTML = `<div class="stage-bar"><div class="clock" data-clock></div><div class="status s-${status.toLowerCase()}">${status}</div></div>
      ${msg}<div class="stage-body">${body}</div>${next}`;
  } else {
    el.innerHTML = `<div class="bg">${bg}</div><div class="frame">${body}</div>`;
  }
  return el;
}

// Shrinks `.fit` text until the slide content fits its frame.
export function fitSlide(el) {
  const frame = el.querySelector('.frame, .stage-body');
  const box = el.querySelector('.box');
  const fit = el.querySelector('.fit');
  if (!frame || !box || !fit) return;
  const base = el.classList.contains('mode-lower') || el.classList.contains('mode-chroma') || el.classList.contains('mode-alpha') ? 3.2 : 5.6;
  let lo = 1.2, hi = base, best = lo;
  const cs = getComputedStyle(frame);
  const availH = frame.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const availW = frame.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const fits = () => box.scrollHeight <= availH * 0.98 && box.scrollWidth <= availW * 1.01;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    fit.style.fontSize = `calc(var(--u) * ${mid} * var(--scale))`;
    if (fits()) { best = mid; lo = mid; } else hi = mid;
  }
  fit.style.fontSize = `calc(var(--u) * ${best} * var(--scale))`;
}

// Keeps `--u` (1% of width) in sync with the host size so layouts scale anywhere.
export function autoScale(host) {
  const update = () => host.style.setProperty('--u', `${host.clientWidth / 100}px`);
  update();
  new ResizeObserver(() => { update(); host.querySelectorAll('.slide').forEach(fitSlide); }).observe(host);
}

// Cross-fades a new slide into `host`.
export function show(host, el, transition = 'fade') {
  const old = [...host.querySelectorAll('.slide')];
  el.classList.add('entering');
  host.appendChild(el);
  fitSlide(el);
  document.fonts?.ready.then(() => el.isConnected && fitSlide(el)); // re-fit once web fonts arrive
  el.querySelectorAll('[data-clock]').forEach(tickClock);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.remove('entering');
    if (transition === 'cut') old.forEach((o) => o.remove());
    else old.forEach((o) => { o.classList.add('leaving'); setTimeout(() => o.remove(), 600); });
  }));
}

function tickClock(node) {
  const t = () => { if (!node.isConnected) return clearInterval(id); node.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  const id = setInterval(t, 1000); t();
}
