// Shared slide resolution + rendering for output windows, console monitors and the remote.
import { bookById, formatRef, refKey } from './books.js';

// ---------------------------------------------------------------- API (with optional control PIN)
const PIN_KEY = 'f8.pin';
export const getPin = () => { try { return localStorage.getItem(PIN_KEY) || ''; } catch { return ''; } };
export const setPin = (v) => { try { localStorage.setItem(PIN_KEY, v); } catch {} };

export const api = async (p, opts = {}) => {
  const headers = { ...(opts.headers || {}) };
  if ((opts.method || 'GET') !== 'GET' && getPin()) headers['x-f8-pin'] = getPin();
  const r = await fetch(p, { ...opts, headers });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401 && body.pin) {
    const pin = prompt('Enter the control PIN for this F8 server');
    if (pin) { setPin(pin); return api(p, opts); }
  }
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
};
export const postJson = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

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

export const FONTS = {
  '': 'Theme default',
  'Playfair Display': 'Playfair Display (serif)',
  'Lora': 'Lora (serif)',
  'Merriweather': 'Merriweather (serif)',
  'Noto Serif': 'Noto Serif (many languages)',
  'Inter': 'Inter (sans)',
  'Montserrat': 'Montserrat (sans)',
  'Noto Sans': 'Noto Sans (many languages)',
  'Oswald': 'Oswald (condensed)',
  'Georgia': 'Georgia (system)',
  'Arial': 'Arial (system)',
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

// ---------------------------------------------------------------- long-passage splitting
// Words of a passage, each tagged with its verse number when it starts a verse.
function wordsOf(verses) {
  const out = [];
  for (const v of verses) v.text.split(/\s+/).filter(Boolean).forEach((w, i) => out.push({ w, v: i === 0 ? v.verse : null }));
  return out;
}

// Splits words into `n` screens of similar length, preferring breaks after punctuation.
export function splitWords(words, n) {
  if (n <= 1 || words.length < n * 3) return [words];
  const lens = words.map((x) => x.w.length + 1);
  const total = lens.reduce((a, b) => a + b, 0);
  const cuts = [];
  let acc = 0; const pos = []; // char offset after each word
  lens.forEach((l) => { acc += l; pos.push(acc); });
  for (let k = 1; k < n; k++) {
    const ideal = (total * k) / n; const window = total / n * 0.45;
    let best = -1, bestScore = Infinity;
    for (let i = (cuts.at(-1) ?? -1) + 2; i < words.length - 1; i++) {
      const d = Math.abs(pos[i] - ideal);
      if (d > window) { if (pos[i] > ideal) break; else continue; }
      // Distance from the ideal point plus a penalty for breaking mid-thought.
      const punct = /[.;:!?]["'”’)]?$/.test(words[i].w) ? 0.2 : /[,—–]["'”’)]?$/.test(words[i].w) ? 0.5 : 1;
      const verseStart = words[i + 1]?.v ? 0.1 : 1;
      const score = d + Math.min(punct, verseStart) * (total / n) * 0.35;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) best = pos.findIndex((p) => p >= ideal);
    cuts.push(best);
  }
  const pages = []; let start = 0;
  for (const c of cuts) { pages.push(words.slice(start, c + 1)); start = c + 1; }
  pages.push(words.slice(start));
  return pages.filter((p) => p.length);
}

// How many screens an item needs (decided once, from the main translation, so every channel stays in step).
export async function paginate(item, state) {
  if (item?.kind === 'song') { const pages = Math.max(1, item.slides?.length || 1); return { ...item, pages, page: Math.max(0, Math.min(item.page || 0, pages - 1)) }; }
  if (item?.kind !== 'scripture' || !state.splitChars) return { ...item, pages: 1, page: item?.page || 0 };
  try {
    const p = await passage(state.translation, item.ref);
    const len = p.verses.reduce((n, v) => n + v.text.length + 1, 0);
    const pages = Math.max(1, Math.ceil(len / state.splitChars));
    return { ...item, pages, page: Math.min(item.page || 0, pages - 1) };
  } catch { return { ...item, pages: 1, page: 0 }; }
}

// Turn the shared "live" item into a concrete slide for one channel.
export async function resolveSlide(item, channel, state) {
  if (!item) return { kind: 'blank' };
  if (item.kind === 'text') return { kind: 'text', title: item.title || '', body: item.body || '' };
  if (item.kind === 'song') {
    const page = Math.max(0, Math.min(item.page || 0, (item.slides?.length || 1) - 1));
    const cur = item.slides?.[page] || { label: '', lines: [] };
    return { kind: 'song', title: item.title || '', artist: item.artist || '', ccli: item.ccli || '', license: state.ccliLicense || '',
      label: cur.label, lines: cur.lines, page, pages: item.slides?.length || 1, next: item.slides?.[page + 1] || null };
  }
  if (item.kind === 'media') return { kind: 'media', url: item.url, mediaType: item.mediaType, name: item.name, fit: item.fit || 'contain', loop: item.loop !== false };
  if (item.kind !== 'scripture' || !item.ref) return { kind: 'blank' };
  const tr = channel?.translation || state.translation;
  const pages = item.pages || 1; const page = Math.min(item.page || 0, pages - 1);
  const slide = { kind: 'scripture', heading: item.heading || '', pages, page, highlight: item.highlight || [] };
  const cut = (p) => { p.words = splitWords(wordsOf(p.verses), pages)[page] || []; return p; };
  try { slide.primary = cut(await passage(tr, item.ref)); }
  catch (e) { slide.primary = { reference: formatRef(item.ref), translation: tr, verses: [], words: [], error: e.message }; }
  if (channel?.secondary && channel.secondary !== tr) {
    try { slide.secondary = cut(await passage(channel.secondary, item.ref)); } catch { /* optional */ }
  }
  return slide;
}
export const slideKey = (item, channel, state) => JSON.stringify([
  item?.kind, refKey(item?.ref), item?.title, item?.body, item?.url, item?.fit, item?.page, item?.pages, item?.highlight, item?.songId, item?.slides?.length,
  state.ccliLicense,
  channel?.translation || state.translation, channel?.secondary,
]);

// ---------------------------------------------------------------- rendering
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const normWord = (w) => String(w).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');

function wordsHtml(p, showNumbers, highlight) {
  if (p.error && !p.words.length) return `<span class="err">${esc(p.reference)} — not available in ${esc(p.translation)}</span>`;
  const hl = new Set((highlight || []).map(normWord));
  const multi = p.verses.length > 1;
  return p.words.map((x) => {
    const num = x.v && (showNumbers || multi) ? `<sup>${x.v}</sup>` : '';
    const word = hl.has(normWord(x.w)) ? `<mark class="hl">${esc(x.w)}</mark>` : esc(x.w);
    return num + word;
  }).join(' ');
}

function backgroundHtml(channel, mode) {
  if (mode === 'alpha' || mode === 'chroma') return '';
  const b = channel.background;
  if (!b) return '';
  const fit = channel.bgFit === 'contain' ? 'contain' : 'cover';
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(b)
    ? `<video class="bg-media" src="${esc(b)}" style="object-fit:${fit}" autoplay muted loop playsinline></video>`
    : `<div class="bg-media" style="background-image:url('${esc(b)}');background-size:${fit}"></div>`;
}

function styleVars(el, channel) {
  const set = (k, v) => el.style.setProperty(k, v);
  if (channel.textColor) set('--text', channel.textColor);
  set('--scale', channel.fontScale || 1);
  if (channel.fontFamily) set('--font', `'${channel.fontFamily}', Georgia, sans-serif`);
  set('--outline', `${(Number(channel.outline) || 0) * 0.03}`);
  set('--shadow', `${(Number(channel.shadow ?? 5)) / 10}`);
  set('--lh', channel.lineHeight || 1.28);
  set('--bg-blur', `${Number(channel.bgBlur) || 0}`);
  set('--bg-bright', `${(Number(channel.bgBrightness) || 100) / 100}`);
  set('--bg-dim', `${(Number(channel.bgDim) || 0) / 100}`);
  set('--bg-tint', channel.bgTint || '#000');
  set('--bg-tint-amt', `${(Number(channel.bgTintAmount) || 0) / 100}`);
}

// Builds the DOM for a slide. `opts` = { black, clear, logo, nextLabel, preview }.
export function buildSlide(slide, channel = {}, state = {}, opts = {}) {
  const mode = channel.mode || 'full';
  const overlay = mode === 'lower' || mode === 'chroma' || mode === 'alpha';
  const isStage = mode === 'stage' || mode === 'confidence';
  const el = document.createElement('div');
  el.className = `slide mode-${mode} theme-${channel.theme || 'aurora'} align-${channel.align || 'center'}`;
  if (mode === 'alpha') el.classList.add('transparent');
  if (channel.uppercase) el.classList.add('upper');
  if (channel.fontFamily) el.classList.add('custom-font');
  if (Number(channel.outline) > 0) el.classList.add('outlined');
  styleVars(el, channel);

  if (opts.black && !isStage) { el.classList.add('is-black'); return el; }

  let body = '';
  let media = '';
  if (opts.logo && !isStage) {
    body = `<div class="logo"><div class="logo-mark">✦</div><div class="logo-text">${esc(state.logoText || '')}</div></div>`;
  } else if (opts.clear || slide.kind === 'blank') {
    body = '';
  } else if (slide.kind === 'media') {
    if (isStage) body = `<div class="box"><div class="title fit">🎬 ${esc(slide.name || 'Media')}</div></div>`;
    else if (!overlay && channel.showMedia !== false) {
      const fit = slide.fit === 'cover' ? 'cover' : 'contain';
      media = slide.mediaType === 'video'
        ? `<video class="live-media" src="${esc(slide.url)}" style="object-fit:${fit}" autoplay playsinline ${slide.loop ? 'loop' : ''} ${channel.mediaAudio && !opts.preview ? '' : 'muted'}></video>`
        : `<img class="live-media" src="${esc(slide.url)}" style="object-fit:${fit}" alt="">`;
    }
  } else if (slide.kind === 'song') {
    // Lyrics: each line kept whole, the block auto-sized to fill the frame.
    const lines = slide.lines.map((l) => `<span class="ln">${esc(l)}</span>`).join('');
    const credit = [slide.title, slide.artist].filter(Boolean).join(' — ')
      + (slide.ccli ? ` · CCLI Song #${slide.ccli}` : '') + (slide.license ? ` · CCLI Licence #${slide.license}` : '');
    const showCredit = channel.showReference !== false && (slide.page === 0 || slide.page === slide.pages - 1);
    const footer = showCredit && credit ? `<div class="song-credit">${esc(credit)}</div>` : '';
    body = isStage
      ? `<div class="box"><div class="song-label">${esc(slide.label)} · ${slide.page + 1}/${slide.pages}</div><div class="lyrics fit">${lines}</div></div>`
      : `<div class="box song"><div class="lyrics fit">${lines}</div>${overlay ? '' : footer}</div>`;
    if (isStage && slide.next) opts = { ...opts, nextLabel: `${slide.next.label}: ${slide.next.lines[0] || ''}` };
  } else if (slide.kind === 'text') {
    body = `<div class="box"><div class="title fit">${esc(slide.title)}</div>${slide.body ? `<div class="subtitle">${esc(slide.body)}</div>` : ''}</div>`;
  } else if (slide.kind === 'scripture') {
    const p = slide.primary, s = slide.secondary;
    const pageTag = slide.pages > 1 ? `<span class="pg">${slide.page + 1}/${slide.pages}</span>` : '';
    const ref = channel.showReference !== false ? `<div class="ref">${esc(p.reference)}<span class="tr">${esc(p.translation)}</span>${pageTag}</div>` : '';
    const sec = s ? `<div class="secondary" dir="${s.dir || 'auto'}" lang="${esc(s.lang)}">${wordsHtml(s, channel.showVerseNumbers, slide.highlight)}<div class="ref small">${esc(s.reference)}<span class="tr">${esc(s.translation)}</span></div></div>` : '';
    body = `<div class="box${s ? ' parallel' : ''}">
      <div class="verse fit" dir="${p.dir || 'auto'}" lang="${esc(p.lang)}">${wordsHtml(p, channel.showVerseNumbers, slide.highlight)}</div>
      ${sec}${overlay ? '' : ref}
    </div>${overlay ? ref : ''}`;
  }

  if (isStage) {
    const msg = state.stageMessage ? `<div class="stage-msg">${esc(state.stageMessage)}</div>` : '';
    const status = opts.black ? 'BLACK' : opts.logo ? 'LOGO' : opts.clear ? 'CLEAR' : 'LIVE';
    const next = opts.nextLabel ? `<div class="stage-next"><span>NEXT</span>${esc(opts.nextLabel)}</div>` : '';
    el.innerHTML = `<div class="stage-bar"><div class="clock" data-clock></div><div class="status s-${status.toLowerCase()}">${status}</div></div>
      ${msg}<div class="stage-body">${body}</div>${next}`;
  } else {
    el.innerHTML = `<div class="bg"><div class="bg-layer">${backgroundHtml(channel, mode)}</div><div class="bg-tint"></div><div class="bg-dim"></div></div>`
      + (media ? `<div class="media-layer">${media}</div>` : `<div class="frame">${body}</div>`);
  }
  return el;
}

// Shrinks `.fit` text until the slide content fits its frame.
export function fitSlide(el) {
  const frame = el.querySelector('.frame, .stage-body');
  const box = el.querySelector('.box');
  const fit = el.querySelector('.fit');
  if (!frame || !box || !fit) return;
  const overlay = el.classList.contains('mode-lower') || el.classList.contains('mode-chroma') || el.classList.contains('mode-alpha');
  const base = fit.classList.contains('lyrics') ? (overlay ? 3.6 : 7) : overlay ? 3.2 : 5.6;
  const cs = getComputedStyle(frame);
  const availH = frame.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const availW = frame.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const fits = () => box.scrollHeight <= availH * 0.98 && box.scrollWidth <= availW * 1.01 && fit.scrollWidth <= availW * (fit.classList.contains('lyrics') ? 0.97 : 1.01);
  const largest = () => {
    let lo = 1.2, hi = base, best = lo;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      fit.style.fontSize = `calc(var(--u) * ${mid} * var(--scale))`;
      if (fits()) { best = mid; lo = mid; } else hi = mid;
    }
    return best;
  };
  let best;
  if (fit.classList.contains('lyrics')) {
    // Keep every sung line on one row, sized to the longest line. Only if that would make the
    // text too small to read does a long line wrap (balanced) onto two rows.
    el.classList.add('nowrap');
    best = largest();
    if (best < (overlay ? 2.4 : 3.6)) { el.classList.remove('nowrap'); best = largest(); }
  } else best = largest();
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
    const drop = (o) => { o.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); }); o.remove(); };
    if (transition === 'cut') old.forEach(drop);
    else old.forEach((o) => { o.classList.add('leaving'); setTimeout(() => drop(o), 600); });
  }));
}

function tickClock(node) {
  const t = () => { if (!node.isConnected) return clearInterval(id); node.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  const id = setInterval(t, 1000); t();
}
