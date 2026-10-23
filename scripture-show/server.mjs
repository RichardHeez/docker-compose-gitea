// F8 Scripture Presenter server.
// - Serves the operator console and output pages
// - Proxies + caches Bible text from bolls.life (hundreds of translations, many languages)
// - Hosts imported/offline Bibles from data/bibles
// - Keeps the shared show state and pushes it to every output via Server-Sent Events
// - AI endpoints (Claude) for live scripture detection and presentation generation

import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { BOOKS, bookById } from './public/js/books.js';
import { lyricsToText } from './public/js/songs.js';
import { DEFAULT_TIMERS } from './public/js/timers.js';
import { STARTER_DESIGNS, cleanDesign } from './public/js/design.js';
import { cleanTimeline } from './public/js/timeline.js';
import { importSongFiles } from './lib/importers.mjs';
import { runAction, ACTIONS_HELP } from './lib/actions.mjs';
import { parseLevels, sendLevels } from './lib/artnet.mjs';
import { pcoClient, planToService } from './lib/pco.mjs';
import { QUALITY, hasFfmpeg, recordingName, startEncoder, startPassthrough } from './lib/encoder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Read keys from .env next to this file (Docker does this itself; this covers `npm start`).
try { process.loadEnvFile(path.join(here, '.env')); } catch { /* no .env */ }
const PUBLIC = path.join(here, 'public');
const DATA = process.env.DATA_DIR || path.join(here, 'data');
const CACHE = path.join(DATA, 'cache');
const BIBLES = path.join(DATA, 'bibles');
const BUILTIN_BIBLES = path.join(here, 'bibles');
const MEDIA = path.join(DATA, 'media');
const CONTROL_PIN = process.env.CONTROL_PIN || '';

// Khaya (GhanaNLP) speech-to-text for Akan/Twi, Fante, Ga, Ewe, Dagbani … Every setting can be overridden
// in case GhanaNLP changes its API: endpoint, key header and the language codes it expects.
// Planning Center Online — a Personal Access Token (Application ID + Secret).
const PCO = { appId: process.env.PCO_APP_ID || '', secret: process.env.PCO_SECRET || '', base: process.env.PCO_API_BASE || 'https://api.planningcenteronline.com' };
const pco = () => (PCO.appId && PCO.secret ? pcoClient(PCO) : null);

const KHAYA = {
  key: process.env.KHAYA_API_KEY || '',
  url: process.env.KHAYA_ASR_URL || 'https://translation-api.ghananlp.org/asr/v1/transcribe',
  header: process.env.KHAYA_KEY_HEADER || 'Ocp-Apim-Subscription-Key',
  langParam: process.env.KHAYA_LANG_PARAM || 'language',
  // F8 language -> Khaya code (from Khaya's language list: eng, twi, ewe, gaa, fat, yor, dag, kik, gur, luo, mer, kus)
  langs: { en: 'eng', ak: 'twi', tw: 'twi', twi: 'twi', fat: 'fat', ee: 'ewe', ewe: 'ewe', gaa: 'gaa', yo: 'yor', yor: 'yor', dag: 'dag',
    ki: 'kik', kik: 'kik', gur: 'gur', luo: 'luo', mer: 'mer', kus: 'kus', ...JSON.parse(process.env.KHAYA_LANGS || '{}') },
};
const khayaLang = (lang) => KHAYA.langs[String(lang || '').toLowerCase().split(/[-_]/)[0]] || 'twi';

async function khayaTranscribe(audio, contentType, lang) {
  const url = `${KHAYA.url}${KHAYA.url.includes('?') ? '&' : '?'}${KHAYA.langParam}=${encodeURIComponent(khayaLang(lang))}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { [KHAYA.header]: KHAYA.key, 'content-type': contentType || 'audio/wav', 'cache-control': 'no-cache' },
    body: audio,
    signal: AbortSignal.timeout(30000),
  });
  const raw = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Khaya ${r.status}: ${raw.slice(0, 200)}`), { status: 502 });
  // The response may be a JSON string, a JSON object, or plain text.
  let text = raw;
  try {
    const j = JSON.parse(raw);
    text = typeof j === 'string' ? j : j.text ?? j.transcription ?? j.transcript ?? j.result ?? j.output ?? j.data?.text ?? raw;
  } catch { /* plain text */ }
  return String(text).trim();
}
const PORT = Number(process.env.PORT || 4848);
const UPSTREAM = process.env.BIBLE_API || 'https://bolls.life';
// Online lyrics: LRCLIB (free, open, no key) with lyrics.ovh as a fallback.
const LRCLIB = process.env.LYRICS_API || 'https://lrclib.net';
const LYRICS_OVH = process.env.LYRICS_OVH_API || 'https://api.lyrics.ovh';
const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const CHANNEL_COUNT = Math.max(6, Number(process.env.CHANNELS || 8));

await fs.mkdir(CACHE, { recursive: true });
await fs.mkdir(BIBLES, { recursive: true });
await fs.mkdir(MEDIA, { recursive: true });

// ---------------------------------------------------------------- show state
const THEMES = ['aurora', 'midnight', 'sunrise', 'forest', 'ocean', 'paper', 'black'];
const MODES = ['full', 'lower', 'stage', 'chroma', 'alpha', 'confidence', 'announce'];
const defaultChannel = (i) => ({
  id: i + 1,
  name: ['Main Screen', 'Livestream', 'Stage Display', 'Lower Third (OBS)', 'Lobby', 'Overflow', 'Translation 2', 'Translation 3'][i] || `Channel ${i + 1}`,
  enabled: true,
  mode: ['full', 'lower', 'stage', 'alpha', 'full', 'full', 'full', 'full'][i] || 'full',
  translation: '',            // '' = follow operator translation
  secondary: '',              // optional parallel translation
  theme: ['aurora', 'black', 'black', 'black', 'ocean', 'midnight', 'forest', 'sunrise'][i] || 'aurora',
  background: '',             // custom image/video URL
  fontScale: 1,
  textColor: '',
  align: 'center',
  showReference: true,
  showVerseNumbers: false,
  transition: 'fade',
  // text style
  fontFamily: '',             // '' = theme default
  outline: 0,                 // text outline width (0-10)
  shadow: 5,                  // text shadow strength (0-10)
  uppercase: false,
  lineHeight: 1.28,
  // background edits
  bgFit: 'cover',             // cover | contain
  bgBlur: 0,                  // 0-30
  bgDim: 0,                   // 0-90 (% black overlay)
  bgBrightness: 100,          // 30-150 (%)
  bgTint: '#000000',
  bgTintAmount: 0,            // 0-80 (%)
  // media
  showMedia: i !== 1 && i !== 3,   // lower-third/overlay channels skip full-screen media
  mediaAudio: i === 0,             // only one screen should play video sound
  showProps: true,                 // logo bugs / overlays
  showMessages: i !== 2,           // operator messages (stage gets its own stage message)
});

let state = {
  version: 0,
  translation: 'KJV',
  live: null,        // { kind:'scripture', ref:{book,chapter,verseStart,verseEnd} } | { kind:'text', title, body }
  next: null,        // next item (for stage displays)
  black: false,
  clear: false,
  logo: false,
  logoText: 'Welcome',
  stageMessage: '',
  splitChars: 240,   // split long passages into screens of ~N characters (0 = never split)
  songLines: 4,      // lyric lines per slide
  // ProPresenter-style layers & tools
  timers: DEFAULT_TIMERS,
  message: { text: '', visible: false, style: 'lower' },                 // lower | ticker | top
  props: [],         // [{ id, name, kind: 'media'|'text', url, text, position, size, opacity, visible }]
  announcements: { items: [], seconds: 8, playing: false, index: 0, startedAt: 0 },
  looks: [],         // [{ id, name, channels: [...] }]
  macros: [],        // [{ id, name, color, actions: [...] }]
  clearMedia: false, // hide backgrounds & media on every screen
  audioCmd: null,    // { id, action: 'fade' } — tells the console's audio player to fade (from triggers/macros)
  dmx: { host: '', universe: 0 },  // Art-Net lighting node
  midiMap: [],       // [{ msg: 'note:60' | 'cc:20', action: 'next' }]
  designs: STARTER_DESIGNS, // slide editor: custom slides & templates (see public/js/design.js)
  ccliLicense: '',   // church's CCLI licence number, shown on song slides
  customWords: {},   // church-added words per language: { ak: { books: {Yohane: 43}, numbers: {dunsia: 16}, chapter: [...], verse: [...] } }
  service: [],       // playlist items
  channels: Array.from({ length: CHANNEL_COUNT }, (_, i) => defaultChannel(i)),
};

const STATE_FILE = path.join(DATA, 'state.json');
try {
  const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  state = { ...state, ...saved, version: 0 };
  if (!Array.isArray(state.timers) || !state.timers.length) state.timers = DEFAULT_TIMERS;
  if (!Array.isArray(state.designs)) state.designs = STARTER_DESIGNS;
  // keep at least CHANNEL_COUNT channels, fill in any new fields
  state.channels = Array.from({ length: Math.max(CHANNEL_COUNT, saved.channels?.length || 0) },
    (_, i) => ({ ...defaultChannel(i), ...(saved.channels?.[i] || {}), id: i + 1 }));
} catch { /* first run */ }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { version, ...rest } = state;
    fs.writeFile(STATE_FILE, JSON.stringify(rest, null, 2)).catch((e) => console.error('save failed', e));
  }, 400);
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const sseClients = new Set();
function broadcast() {
  state.version++;
  state.serverNow = Date.now(); // lets every screen show the same timer values
  const msg = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const res of sseClients) res.write(msg);
  persist();
}
setInterval(() => { for (const res of sseClients) res.write(': ping\n\n'); }, 25000);

// Announcements loop: advance on the server so lobby screens keep cycling even if no console is open.
setInterval(() => {
  const a = state.announcements;
  if (!a?.playing || !a.items?.length) return;
  if (Date.now() - (a.startedAt || 0) >= Math.max(2, Number(a.seconds) || 8) * 1000) {
    state.announcements = { ...a, index: ((a.index || 0) + 1) % a.items.length, startedAt: Date.now() };
    broadcast();
  }
}, 500);

function sanitizePatch(p) {
  const out = {};
  for (const k of ['translation', 'live', 'next', 'black', 'clear', 'logo', 'logoText', 'stageMessage', 'service', 'splitChars', 'mediaCmd', 'customWords', 'songLines', 'ccliLicense',
    'timers', 'message', 'props', 'announcements', 'looks', 'macros', 'clearMedia', 'audioCmd', 'dmx', 'midiMap']) if (k in p) out[k] = p[k];
  if (Array.isArray(p.designs)) out.designs = p.designs.slice(0, 300).map(cleanDesign).filter(Boolean);
  if (Array.isArray(p.channels)) {
    out.channels = state.channels.map((c, i) => {
      const n = p.channels.find((x) => Number(x.id) === c.id) || p.channels[i];
      if (!n) return c;
      const merged = { ...c, ...n, id: c.id };
      if (!MODES.includes(merged.mode)) merged.mode = c.mode;
      merged.fontScale = Math.min(3, Math.max(0.3, Number(merged.fontScale) || 1));
      return merged;
    });
  }
  return out;
}

// ---------------------------------------------------------------- bible data
const memo = new Map();
async function cached(file, maxAgeMs, loader) {
  if (memo.has(file)) {
    const m = memo.get(file);
    if (Date.now() - m.t < maxAgeMs) return m.v;
  }
  try {
    const st = await fs.stat(file);
    if (Date.now() - st.mtimeMs < maxAgeMs) {
      const v = JSON.parse(await fs.readFile(file, 'utf8'));
      memo.set(file, { t: Date.now(), v });
      return v;
    }
  } catch { /* not cached */ }
  try {
    const v = await loader();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(v));
    memo.set(file, { t: Date.now(), v });
    return v;
  } catch (e) {
    // Upstream unreachable: fall back to stale cache if we have one.
    if (existsSync(file)) return JSON.parse(await fs.readFile(file, 'utf8'));
    throw e;
  }
}

async function upstream(p) {
  const r = await fetch(UPSTREAM + p, { headers: { 'user-agent': 'F8ScripturePresenter/1.0' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`upstream ${r.status} for ${p}`);
  return r.json();
}

// Local Bibles: JSON { meta:{short_name, full_name, language, dir}, books:{ "43": { "3": { "16": "text" } } } }
const localBibles = new Map();
async function loadLocalBibles() {
  localBibles.clear();
  for (const dir of [BUILTIN_BIBLES, BIBLES]) {
    let files = [];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      try {
        const b = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        if (b?.meta?.short_name && b.books) localBibles.set(b.meta.short_name, b);
      } catch (e) { console.warn('skip bible', f, e.message); }
    }
  }
}
await loadLocalBibles();

// Accept a few common shapes and turn them into the local format.
function normalizeImport(raw, meta) {
  const books = {};
  const put = (b, c, v, t) => { ((books[b] ||= {})[c] ||= {})[v] = String(t).trim(); };
  if (raw?.books && isObj(raw.books)) return { meta: { ...raw.meta, ...meta }, books: raw.books };
  const rows = Array.isArray(raw) ? raw : raw?.verses || raw?.resultset?.row;
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (Array.isArray(r?.field)) { const [, b, c, v, t] = r.field; put(b, c, v, t); continue; } // scrollmapper
      const b = r.book_id ?? r.bookid ?? r.book; const c = r.chapter; const v = r.verse; const t = r.text;
      const bid = Number.isFinite(Number(b)) ? Number(b) : BOOKS.find((x) => x.name.toLowerCase() === String(b).toLowerCase())?.id;
      if (bid && c && v && t) put(bid, c, v, t);
    }
  } else if (Array.isArray(raw?.books)) { // [{name, chapters:[[...verses]]}]
    raw.books.forEach((bk, i) => (bk.chapters || []).forEach((ch, ci) => ch.forEach((t, vi) => put(i + 1, ci + 1, vi + 1, t))));
  }
  return { meta: { ...(raw?.meta || {}), ...meta }, books };
}

const cleanText = (t) => String(t || '')
  .replace(/<S>.*?<\/S>/gi, '').replace(/<sup>.*?<\/sup>/gi, '')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

async function getTranslations() {
  let remote = [];
  try {
    remote = await cached(path.join(CACHE, 'languages.json'), 24 * 3600e3, () => upstream('/static/bolls/app/views/languages.json'));
  } catch (e) { console.warn('translations unavailable:', e.message); }
  const langs = (Array.isArray(remote) ? remote : []).map((l) => ({
    language: l.language,
    translations: (l.translations || []).map((t) => ({ id: t.short_name, name: t.full_name, dir: t.dir || 'ltr', source: 'online' })),
  }));
  for (const b of localBibles.values()) {
    const lang = b.meta.language || 'Imported';
    let group = langs.find((l) => l.language === lang);
    if (!group) langs.unshift(group = { language: lang, translations: [] });
    if (!group.translations.some((t) => t.id === b.meta.short_name)) {
      group.translations.unshift({ id: b.meta.short_name, name: b.meta.full_name || b.meta.short_name, dir: b.meta.dir || 'ltr', source: 'local' });
    }
  }
  return langs;
}

async function getBooks(tr) {
  const local = localBibles.get(tr);
  const fallback = () => BOOKS.map((b) => ({ id: b.id, name: b.name, chapters: b.chapters }));
  if (local) {
    return BOOKS.map((b) => ({ id: b.id, name: local.meta.bookNames?.[b.id] || b.name, chapters: b.chapters, available: !!local.books[b.id] }));
  }
  try {
    const list = await cached(path.join(CACHE, safe(tr), 'books.json'), 7 * 24 * 3600e3, () => upstream(`/get-books/${encodeURIComponent(tr)}/`));
    return list.map((b) => ({ id: b.bookid, name: b.name, chapters: b.chapters }));
  } catch { return fallback(); }
}

const safe = (s) => String(s).replace(/[^\w.-]/g, '_');

async function getChapter(tr, book, chapter) {
  const local = localBibles.get(tr);
  if (local) {
    const ch = local.books[book]?.[chapter];
    if (!ch) throw Object.assign(new Error(`${tr} has no ${bookById(book)?.name || book} ${chapter} (offline Bible)`), { status: 404 });
    return Object.entries(ch).map(([v, t]) => ({ verse: Number(v), text: cleanText(t) })).sort((a, b) => a.verse - b.verse);
  }
  const raw = await cached(path.join(CACHE, safe(tr), `${book}-${chapter}.json`), 365 * 24 * 3600e3,
    () => upstream(`/get-text/${encodeURIComponent(tr)}/${book}/${chapter}/`));
  return raw.map((v) => ({ verse: v.verse, text: cleanText(v.text) })).filter((v) => v.text);
}

async function search(tr, q) {
  const local = localBibles.get(tr);
  const needle = q.toLowerCase();
  if (local) {
    const out = [];
    for (const [b, chs] of Object.entries(local.books)) for (const [c, vs] of Object.entries(chs)) for (const [v, t] of Object.entries(vs)) {
      if (String(t).toLowerCase().includes(needle)) out.push({ book: Number(b), chapter: Number(c), verse: Number(v), text: cleanText(t) });
      if (out.length >= 100) return out;
    }
    return out;
  }
  let res;
  try { res = await upstream(`/v2/find/${encodeURIComponent(tr)}?search=${encodeURIComponent(q)}&match_case=false&match_whole=false&limit=100&page=1`); }
  catch { res = await upstream(`/find/${encodeURIComponent(tr)}/?search=${encodeURIComponent(q)}&match_case=false&match_whole=false`); }
  const rows = Array.isArray(res) ? res : res.results || [];
  return rows.slice(0, 100).map((r) => ({ book: r.book, chapter: r.chapter, verse: r.verse, text: cleanText(r.text) }));
}

// ---------------------------------------------------------------- songs & lyrics
const SONGS_FILE = path.join(DATA, 'songs.json');
let songs = [];
try { songs = JSON.parse(readFileSync(SONGS_FILE, 'utf8')); } catch { /* none yet */ }
let builtinSongs = [];
try { builtinSongs = JSON.parse(readFileSync(path.join(here, 'songs', 'hymns.json'), 'utf8')); } catch { /* optional */ }
const saveSongs = () => fs.writeFile(SONGS_FILE, JSON.stringify(songs, null, 1)).catch((e) => console.error('songs save failed', e));
const allSongs = () => [...songs, ...builtinSongs.filter((b) => !songs.some((s) => s.id === b.id))];
const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function searchSongs(q) {
  const words = fold(q).split(' ').filter(Boolean);
  const list = allSongs().map((s) => {
    const title = fold(s.title), meta = fold(`${s.artist} ${s.ccli || ''}`), body = fold(s.lyrics);
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 3; else if (meta.includes(w)) score += 2; else if (body.includes(w)) score += 1; else return null;
    }
    return { song: s, score: score + (title.startsWith(words[0] || '') ? 1 : 0) };
  }).filter(Boolean);
  return list.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title)).slice(0, 50)
    .map(({ song }) => ({ id: song.id, title: song.title, artist: song.artist, source: song.source || 'library', ccli: song.ccli || '' }));
}

// Bulk import from other software: files are uploaded into a batch folder, then parsed together
// (EasyWorship needs two database files at once), reviewed by the operator, then saved.
const IMPORTS = path.join(DATA, 'import');
await fs.rm(IMPORTS, { recursive: true, force: true }).catch(() => {});
const songKey = (title, lyrics) => `${fold(title)}|${fold(String(lyrics || '').split('\n').find((l) => l.trim() && !/^\[.*\]$/.test(l.trim())) || '')}`;
const batchDir = (id) => { if (!/^[a-z0-9]{6,40}$/i.test(String(id || ''))) throw Object.assign(new Error('Bad import batch'), { status: 400 }); return path.join(IMPORTS, id); };

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'F8ScripturePresenter/1.0 (church presentation software)' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Object.assign(new Error(`lyrics service ${r.status}`), { status: r.status === 404 ? 404 : 502 });
  return r.json();
}

// Online search -> [{ provider, id, title, artist, album, duration, preview }]
async function searchOnline(q) {
  const out = [];
  try {
    const rows = await getJson(`${LRCLIB}/api/search?q=${encodeURIComponent(q)}`);
    for (const r of (Array.isArray(rows) ? rows : [])) {
      if (r.instrumental || !(r.plainLyrics || r.syncedLyrics)) continue;
      out.push({ provider: 'lrclib', id: String(r.id), title: r.trackName || r.name, artist: r.artistName, album: r.albumName, duration: r.duration,
        preview: String(r.plainLyrics || '').split('\n').filter(Boolean).slice(0, 2).join(' / ') });
    }
  } catch (e) { console.warn('lrclib search failed:', e.message); }
  if (out.length < 5) {
    try {
      const r = await getJson(`${LYRICS_OVH}/suggest/${encodeURIComponent(q)}`);
      for (const x of (r.data || []).slice(0, 15)) {
        out.push({ provider: 'ovh', id: `${x.artist?.name}|${x.title}`, title: x.title, artist: x.artist?.name, album: x.album?.title, duration: x.duration, preview: '' });
      }
    } catch (e) { console.warn('lyrics.ovh search failed:', e.message); }
  }
  // drop duplicates (same title + artist), keep the first (LRCLIB has the lyrics inline)
  const seen = new Set();
  return out.filter((x) => { const k = fold(`${x.title}|${x.artist}`); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 30);
}

async function fetchOnline(provider, id) {
  if (provider === 'lrclib') {
    const r = await getJson(`${LRCLIB}/api/get/${encodeURIComponent(id)}`);
    const lyrics = r.plainLyrics || String(r.syncedLyrics || '').replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*/g, '');
    return { title: r.trackName || r.name, artist: r.artistName, album: r.albumName, lyrics, source: 'LRCLIB' };
  }
  if (provider === 'ovh') {
    const [artist, ...rest] = String(id).split('|'); const title = rest.join('|');
    const r = await getJson(`${LYRICS_OVH}/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    return { title, artist, lyrics: String(r.lyrics || '').replace(/^Paroles de la chanson.*\n/i, ''), source: 'lyrics.ovh' };
  }
  throw Object.assign(new Error('Unknown lyrics provider'), { status: 400 });
}

// ---------------------------------------------------------------- AI (Claude)
const aiEnabled = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const claude = aiEnabled ? new Anthropic() : null;
const BOOK_LIST = BOOKS.map((b) => `${b.id}=${b.name}`).join(', ');

async function askClaude({ system, user, schema, effort = 'low', maxTokens = 4000 }) {
  const response = await claude.beta.messages.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  });
  if (response.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined this request.'), { status: 422 });
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

const REF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['book', 'chapter', 'verse_start', 'verse_end'],
  properties: {
    book: { type: 'integer', description: 'Book number 1-66' },
    chapter: { type: 'integer' },
    verse_start: { type: 'integer' },
    verse_end: { type: 'integer' },
  },
};

async function aiDetect(transcript, language) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['references'],
    properties: {
      references: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['book', 'chapter', 'verse_start', 'verse_end', 'confidence', 'kind'],
          properties: {
            ...REF_SCHEMA.properties,
            confidence: { type: 'number', description: '0 to 1' },
            kind: { type: 'string', enum: ['cited', 'quoted', 'alluded'] },
          },
        },
      },
    },
  };
  const out = await askClaude({
    system: `You assist a church media operator during a live sermon. You receive a rolling speech-to-text transcript (it may be in ${language || 'any language'}, may contain recognition errors, and spoken numbers).
Find Bible passages the speaker is referencing RIGHT NOW: explicit citations ("turn to John three sixteen", "Juan capítulo tres"), and verses they are quoting or closely paraphrasing even without a citation.
Focus on the most recent part of the transcript. Ignore vague topics that are not a specific passage. Keep ranges short (the exact verses spoken, max 6 verses).
Use standard Protestant book numbering: ${BOOK_LIST}. Return an empty list when nothing specific is referenced.`,
    user: `Transcript (most recent at the end):\n"""${transcript.slice(-1500)}"""`,
    schema,
    effort: 'low',
    maxTokens: 2000,
  });
  return (out.references || []).filter((r) => bookById(r.book) && r.chapter >= 1 && r.chapter <= bookById(r.book).chapters)
    .map((r) => ({ book: r.book, chapter: r.chapter, verseStart: r.verse_start, verseEnd: Math.max(r.verse_start, r.verse_end), confidence: r.confidence, kind: r.kind }));
}

async function aiGenerate(prompt, count = 8) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['title', 'items'],
    properties: {
      title: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['type', 'heading', 'body', 'book', 'chapter', 'verse_start', 'verse_end'],
          properties: {
            type: { type: 'string', enum: ['title', 'scripture'] },
            heading: { type: 'string', description: 'Short slide heading or point' },
            body: { type: 'string', description: 'For title slides: one short line. Empty for scripture.' },
            ...REF_SCHEMA.properties,
          },
        },
      },
    },
  };
  const out = await askClaude({
    system: `You build scripture presentations for church services. Given a sermon topic, outline, or notes, produce an ordered presentation: an opening title slide, then the most relevant Bible passages (accurate references only, 1-5 verses each), optionally with short section title slides between points.
For title slides set book, chapter, verse_start, verse_end to 0. Book numbering: ${BOOK_LIST}. Never invent verse text; only give references.`,
    user: `Build a presentation with about ${count} scripture slides for:\n${prompt}`,
    schema,
    effort: 'medium',
    maxTokens: 8000,
  });
  const items = (out.items || []).map((it) => it.type === 'scripture' && bookById(it.book)
    ? { kind: 'scripture', heading: it.heading, ref: { book: it.book, chapter: it.chapter, verseStart: it.verse_start, verseEnd: Math.max(it.verse_start, it.verse_end) } }
    : { kind: 'text', title: it.heading, body: it.body })
    .filter((it) => it.kind === 'text' || (it.ref.chapter >= 1 && it.ref.chapter <= bookById(it.ref.book).chapters));
  return { title: out.title, items };
}

// ---------------------------------------------------------------- http
const MEDIA_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac' };
async function listMedia() {
  const files = await fs.readdir(MEDIA).catch(() => []);
  const out = [];
  for (const f of files) {
    const type = MEDIA_TYPES[path.extname(f).toLowerCase()];
    if (!type) continue;
    const st = await fs.stat(path.join(MEDIA, f));
    out.push({ name: f, url: `/media/${encodeURIComponent(f)}`, type: type.split('/')[0] === 'audio' ? 'audio' : type.startsWith('video') ? 'video' : 'image', size: st.size, added: st.mtimeMs });
  }
  return out.sort((a, b) => b.added - a.added);
}

// Streams a file with HTTP Range support (needed for video seeking).
async function serveFile(req, res, file, type) {
  const st = await fs.stat(file);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' };
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    return pipeline(createReadStream(file, { start, end }), res).catch(() => {});
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  return pipeline(createReadStream(file), res).catch(() => {});
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

// Recording sessions fed by browser screen capture; stop any that go quiet (tab closed, network gone).
const recSessions = new Map();
const pickInfo = (i) => ({ started: i.started, bytes: i.bytes, error: i.error, file: i.file ? path.basename(i.file) : '', streaming: i.streaming, ended: i.ended });
setInterval(() => {
  for (const [id, r] of recSessions) if (Date.now() - r.last > 20000) { recSessions.delete(id); r.enc.stop(); console.log(`recording ${id} stopped: no data for 20 s`); }
}, 5000);
async function readRaw(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('Too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}

async function readBody(req, limit = 60e6) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 }); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

function lanUrls() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${listenPort}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-f8-pin, x-filename', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }
    if (req.method === 'POST' && CONTROL_PIN && req.headers['x-f8-pin'] !== CONTROL_PIN) return send(res, 401, { error: 'PIN required', pin: true });

    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      state.serverNow = Date.now();
      res.write(`retry: 1500\nevent: state\ndata: ${JSON.stringify(state)}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, state);
    if (p === '/api/state' && req.method === 'POST') {
      Object.assign(state, sanitizePatch(await readBody(req))); // top-level keys are replaced whole
      broadcast();
      return send(res, 200, { ok: true, version: state.version });
    }
    if (p === '/api/info') return send(res, 200, { ai: aiEnabled, model: aiEnabled ? AI_MODEL : null, lan: lanUrls(), port: listenPort, channels: state.channels.length, themes: THEMES, modes: MODES, pinRequired: !!CONTROL_PIN, khaya: !!KHAYA.key, pco: !!pco() });
    if (p === '/api/pin' && req.method === 'POST') return send(res, 200, { ok: true }); // PIN already checked above

    // songs library + online lyrics
    if (p === '/api/songs' && req.method === 'GET') return send(res, 200, searchSongs(url.searchParams.get('q') || ''));
    if ((m = p.match(/^\/api\/songs\/([^/]+)$/)) && req.method === 'GET') {
      const song = allSongs().find((x) => x.id === decodeURIComponent(m[1]));
      return song ? send(res, 200, song) : send(res, 404, { error: 'Song not found' });
    }
    if (p === '/api/songs' && req.method === 'POST') {
      const b = await readBody(req);
      const title = String(b.title || '').trim().slice(0, 200);
      if (!title || !String(b.lyrics || '').trim()) return send(res, 400, { error: 'A song needs a title and lyrics' });
      const id = b.id && !String(b.id).startsWith('pd-') ? String(b.id) : `song-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const song = { id, title, artist: String(b.artist || '').slice(0, 200), ccli: String(b.ccli || '').slice(0, 20), lyrics: String(b.lyrics).slice(0, 50000),
        source: String(b.source || 'library').slice(0, 40), updated: Date.now(),
        arrangement: Array.isArray(b.arrangement) ? b.arrangement.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 60) : [],
        ...(cleanTimeline(b.timeline) ? { timeline: cleanTimeline(b.timeline) } : {}) };
      songs = [song, ...songs.filter((x) => x.id !== id)];
      await saveSongs();
      return send(res, 200, song);
    }
    if (p === '/api/songs/delete' && req.method === 'POST') {
      const { id } = await readBody(req);
      songs = songs.filter((x) => x.id !== id); await saveSongs();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/songs/upload' && req.method === 'POST') {
      const dir = batchDir(url.searchParams.get('batch'));
      await fs.mkdir(dir, { recursive: true });
      const name = path.basename(decodeURIComponent(String(req.headers['x-filename'] || 'file'))).replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'file';
      const n = (await fs.readdir(dir)).length;
      await pipeline(req, createWriteStream(path.join(dir, `${String(n).padStart(4, '0')}~${name}`)));
      return send(res, 200, { ok: true });
    }
    if (p === '/api/songs/import' && req.method === 'POST') {
      const dir = batchDir(url.searchParams.get('batch'));
      const names = await fs.readdir(dir).catch(() => []);
      const files = await Promise.all(names.map(async (f) => ({ name: f.replace(/^\d+~/, ''), buf: await fs.readFile(path.join(dir, f)) })));
      await fs.rm(dir, { recursive: true, force: true });
      const { songs: found, errors } = await importSongFiles(files);
      const existing = new Set(allSongs().map((x) => songKey(x.title, x.lyrics)));
      const out = found.map((x) => {
        const lyrics = lyricsToText(x.sections);
        return { title: x.title, artist: x.artist || '', ccli: String(x.ccli || ''), copyright: x.copyright || '', source: x.source, lyrics,
          sections: x.sections.length, duplicate: existing.has(songKey(x.title, lyrics)) };
      });
      return send(res, 200, { songs: out, errors });
    }
    if (p === '/api/songs/bulk' && req.method === 'POST') {
      const { songs: incoming = [], skipDuplicates = true } = await readBody(req, 200e6);
      const existing = new Set(allSongs().map((x) => songKey(x.title, x.lyrics)));
      let added = 0, skipped = 0; const now = Date.now();
      const fresh = [];
      for (const [i, x] of incoming.entries()) {
        const title = String(x.title || '').trim().slice(0, 200); const lyrics = String(x.lyrics || '').slice(0, 50000);
        if (!title || !lyrics.trim()) { skipped++; continue; }
        const key = songKey(title, lyrics);
        if (skipDuplicates && existing.has(key)) { skipped++; continue; }
        existing.add(key);
        fresh.push({ id: `song-${now.toString(36)}${i.toString(36)}${Math.random().toString(36).slice(2, 5)}`, title, artist: String(x.artist || '').slice(0, 200),
          ccli: String(x.ccli || '').slice(0, 20), copyright: String(x.copyright || '').slice(0, 300), lyrics, source: String(x.source || 'import').slice(0, 40), updated: now });
        added++;
      }
      songs = [...fresh, ...songs];
      await saveSongs();
      return send(res, 200, { added, skipped });
    }
    if (p === '/api/lyrics/search') return send(res, 200, await searchOnline(url.searchParams.get('q') || ''));
    if (p === '/api/lyrics/get') return send(res, 200, await fetchOnline(url.searchParams.get('provider'), url.searchParams.get('id')));

    // Hardware triggers: Stream Deck / Bitfocus Companion / MIDI / any HTTP client.  e.g. POST /api/trigger/next
    if (p.startsWith('/api/trigger')) {
      if (req.method === 'GET' && CONTROL_PIN && url.searchParams.get('pin') !== CONTROL_PIN) return send(res, 401, { error: 'PIN required (add ?pin=…)' });
      const action = p.slice('/api/trigger'.length).replace(/^\//, '');
      if (!action) return send(res, 200, { actions: ACTIONS_HELP.map(([path, what]) => ({ url: `/api/trigger/${path}`, what })) });
      const params = Object.fromEntries(url.searchParams);
      if (req.method === 'POST') Object.assign(params, await readBody(req).catch(() => ({})));
      const result = await runAction(state, action, params, { getChapter }).catch((e) => { throw Object.assign(e, { status: 400 }); });
      if (result.dmx && state.dmx?.host) { try { sendLevels(state.dmx, parseLevels(result.dmx)); } catch (e) { console.warn('dmx', e.message); } }
      const patch = { ...(result.patch || {}) };
      if (result.audio) patch.audioCmd = { id: Date.now(), action: result.audio };
      if (Object.keys(patch).length) { Object.assign(state, sanitizePatch(patch)); broadcast(); }
      return send(res, 200, { ok: true, action, changed: Object.keys(patch) });
    }
    // Recording & streaming from a browser screen capture (WebM chunks → ffmpeg → MP4 file and/or RTMP)
    if (p === '/api/rec/status' && req.method === 'GET') {
      return send(res, 200, { ffmpeg: await hasFfmpeg(), sessions: [...recSessions.entries()].map(([id, r]) => ({ id, label: r.label, record: r.record, stream: r.stream, ...pickInfo(r.enc.info()) })) });
    }
    if (p === '/api/rec/start' && req.method === 'POST') {
      const b = await readBody(req);
      const q = QUALITY[b.quality] || QUALITY['1080p'];
      const record = b.record !== false; const rtmp = String(b.rtmp || '').trim();
      if (!record && !rtmp) return send(res, 400, { error: 'Choose recording, streaming or both' });
      const ff = await hasFfmpeg();
      if (rtmp && !ff) return send(res, 400, { error: 'Streaming needs ffmpeg on the server (it is included in the Docker image and the desktop app)' });
      await fs.mkdir(MEDIA, { recursive: true });
      const label = String(b.label || 'F8').slice(0, 40);
      const file = record ? path.join(MEDIA, recordingName(label, ff ? 'mp4' : 'webm')) : '';
      let enc;
      try {
        enc = ff ? await startEncoder({ input: 'webm', ...q, bitrate: Number(b.bitrate) || q.bitrate, hasAudio: !!b.hasAudio, file, rtmp })
          : startPassthrough(file);
      } catch (e) { return send(res, 400, { error: e.message }); }
      const id = Math.random().toString(36).slice(2, 10);
      recSessions.set(id, { enc, label, record, stream: !!rtmp, last: Date.now() });
      return send(res, 200, { id, file: file ? path.basename(file) : '', ffmpeg: ff });
    }
    if (p === '/api/rec/chunk' && req.method === 'POST') {
      const r = recSessions.get(url.searchParams.get('id') || '');
      if (!r) return send(res, 404, { error: 'Recording not found — it may have stopped' });
      const buf = await readRaw(req, 50e6);
      r.last = Date.now();
      const info = r.enc.info();
      if (info.error) return send(res, 500, { error: info.error });
      if (buf.length && !r.enc.write(buf) && r.enc.proc) await new Promise((ok) => { r.enc.proc.stdin.once('drain', ok); setTimeout(ok, 2000); }); // let ffmpeg catch up
      return send(res, 200, pickInfo(r.enc.info()));
    }
    if (p === '/api/rec/stop' && req.method === 'POST') {
      const { id } = await readBody(req);
      const r = recSessions.get(id); if (!r) return send(res, 200, { ok: true });
      recSessions.delete(id);
      const info = await r.enc.stop();
      return send(res, 200, { ok: true, ...pickInfo(info) });
    }

    // Planning Center Online
    if (p === '/api/pco/plans' && req.method === 'GET') {
      const c = pco(); if (!c) return send(res, 400, { error: 'Planning Center is not set up: add PCO_APP_ID and PCO_SECRET to .env' });
      try { return send(res, 200, { plans: await c.plans() }); } catch (e) { return send(res, 502, { error: e.message }); }
    }
    if (p === '/api/pco/import' && req.method === 'POST') {
      const c = pco(); if (!c) return send(res, 400, { error: 'Planning Center is not set up: add PCO_APP_ID and PCO_SECRET to .env' });
      const b = await readBody(req);
      let plan;
      try { plan = await c.plan(String(b.serviceTypeId || ''), String(b.planId || '')); } catch (e) { return send(res, 502, { error: e.message }); }
      const { service, songs: found, skipped } = planToService(plan, { songLines: state.songLines || 4 });
      // keep the plan's songs in the library (update the copy from an earlier import)
      for (const sg of found) {
        const old = songs.find((x) => (sg.pcoSongId && x.pcoSongId === sg.pcoSongId) || (x.title.toLowerCase() === sg.title.toLowerCase() && (x.ccli || '') === sg.ccli));
        const id = old?.id || `song-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const saved = { ...(old || {}), ...sg, id, updated: Date.now(), ...(old?.timeline ? { timeline: old.timeline } : {}) };
        songs = [saved, ...songs.filter((x) => x.id !== id)];
        for (const it of service) if (it.kind === 'song' && it.title === sg.title && it.pcoSongId === sg.pcoSongId && !it.songId) {
          it.songId = id; if (saved.timeline?.audio) it.timeline = saved.timeline;
        }
      }
      if (found.length) await saveSongs();
      state.service = b.mode === 'append' ? [...state.service, ...service] : service;
      broadcast();
      const a = plan.plan?.attributes || {};
      return send(res, 200, { title: [a.dates, a.title].filter(Boolean).join(' · '), items: service.length, songs: found.length, skipped });
    }

    if (p === '/api/dmx' && req.method === 'POST') {
      const { levels, host, universe } = await readBody(req);
      const target = { host: host || state.dmx?.host, universe: universe ?? state.dmx?.universe ?? 0 };
      return send(res, 200, sendLevels(target, typeof levels === 'string' ? parseLevels(levels) : levels || {}));
    }

    if (p === '/api/asr' && req.method === 'POST') {
      if (!KHAYA.key) return send(res, 503, { error: 'Khaya is not set up: start the server with KHAYA_API_KEY' });
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 15e6) return send(res, 413, { error: 'Audio too long' }); chunks.push(c); }
      const text = await khayaTranscribe(Buffer.concat(chunks), req.headers['content-type'], url.searchParams.get('lang'));
      return send(res, 200, { text });
    }
    if (p === '/api/media' && req.method === 'GET') return send(res, 200, await listMedia());
    if (p === '/api/media' && req.method === 'POST') {
      const original = decodeURIComponent(String(req.headers['x-filename'] || 'upload'));
      const ext = path.extname(original).toLowerCase();
      if (!MEDIA_TYPES[ext]) return send(res, 415, { error: 'Use an image (png, jpg, gif, webp, avif), video (mp4, webm, mov) or audio (mp3, m4a, wav, ogg, flac).' });
      const base = safe(path.basename(original, path.extname(original))).slice(0, 60) || 'media';
      let name = base + ext; let n = 1;
      while (existsSync(path.join(MEDIA, name))) name = `${base}-${++n}${ext}`;
      await pipeline(req, createWriteStream(path.join(MEDIA, name)));
      return send(res, 200, (await listMedia()).find((m) => m.name === name));
    }
    if (p === '/api/media/delete' && req.method === 'POST') {
      const { name } = await readBody(req);
      const file = path.join(MEDIA, path.basename(String(name || '')));
      if (file.startsWith(MEDIA + path.sep)) await fs.unlink(file).catch(() => {});
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/media/')) {
      const name = path.basename(decodeURIComponent(p.slice(7)));
      const type = MEDIA_TYPES[path.extname(name).toLowerCase()];
      if (!type) return send(res, 404, 'not found', 'text/plain');
      return await serveFile(req, res, path.join(MEDIA, name), type);
    }
    if (p === '/api/translations') return send(res, 200, await getTranslations());

    if ((m = p.match(/^\/api\/books\/([^/]+)$/))) return send(res, 200, await getBooks(decodeURIComponent(m[1])));
    if ((m = p.match(/^\/api\/chapter\/([^/]+)\/(\d+)\/(\d+)$/))) return send(res, 200, await getChapter(decodeURIComponent(m[1]), Number(m[2]), Number(m[3])));
    if ((m = p.match(/^\/api\/search\/([^/]+)$/))) return send(res, 200, await search(decodeURIComponent(m[1]), url.searchParams.get('q') || ''));

    if (p === '/api/import' && req.method === 'POST') {
      const body = await readBody(req);
      const short = safe(body.short_name || '').slice(0, 24);
      if (!short) return send(res, 400, { error: 'short_name required' });
      const bible = normalizeImport(body.data, { short_name: short, full_name: body.full_name || short, language: body.language || 'Imported', dir: body.dir || 'ltr' });
      const count = Object.values(bible.books).reduce((n, chs) => n + Object.values(chs).reduce((k, vs) => k + Object.keys(vs).length, 0), 0);
      if (!count) return send(res, 400, { error: 'No verses found. Supported: {books:{book:{chapter:{verse:text}}}}, [{book,chapter,verse,text}], scrollmapper JSON.' });
      await fs.writeFile(path.join(BIBLES, `${short}.json`), JSON.stringify(bible));
      await loadLocalBibles();
      return send(res, 200, { ok: true, short_name: short, verses: count });
    }

    if (p === '/api/ai/detect' && req.method === 'POST') {
      if (!aiEnabled) return send(res, 503, { error: 'AI disabled: set ANTHROPIC_API_KEY on the server' });
      const { transcript, language } = await readBody(req);
      return send(res, 200, { references: await aiDetect(String(transcript || ''), language) });
    }
    if (p === '/api/ai/generate' && req.method === 'POST') {
      if (!aiEnabled) return send(res, 503, { error: 'AI disabled: set ANTHROPIC_API_KEY on the server' });
      const { prompt, count } = await readBody(req);
      return send(res, 200, await aiGenerate(String(prompt || '').slice(0, 20000), Math.min(30, Number(count) || 8)));
    }

    // static
    let file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
    if (p === '/output' || p === '/stage') file = path.join(PUBLIC, 'output.html');
    if (p === '/remote') file = path.join(PUBLIC, 'remote.html');
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'not found', 'text/plain');
    console.error(p, e.message);
    send(res, e.status || 502, { error: e.message });
  }
});

// Listen on PORT; if it is taken, try the next few ports. `ready` resolves with the port in use.
let listenPort = PORT;
export const ready = new Promise((resolve, reject) => {
  let tries = 0;
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries++ < 10) { listenPort++; server.listen(listenPort, '0.0.0.0'); }
    else reject(e);
  });
  server.on('listening', () => {
    console.log(`\n  F8 Scripture Presenter  →  http://localhost:${listenPort}`);
    for (const u of lanUrls()) console.log(`  On your network         →  ${u}   (phone remote: ${u}/remote)`);
    console.log(`  Output channels         →  ${state.channels.length}  (e.g. http://localhost:${listenPort}/output.html?ch=1)`);
    console.log(`  AI assist               →  ${aiEnabled ? 'on (' + AI_MODEL + ')' : 'off — set ANTHROPIC_API_KEY to enable'}`);
    console.log(`  Khaya speech (Akan…)    →  ${KHAYA.key ? 'on' : 'off — set KHAYA_API_KEY to hear Akan/Twi, Fante, Ga, Ewe preachers'}`);
    console.log(`  Control PIN             →  ${CONTROL_PIN ? 'required' : 'off (set CONTROL_PIN to protect the console)'}\n`);
    resolve(listenPort);
  });
  server.listen(listenPort, '0.0.0.0');
});
