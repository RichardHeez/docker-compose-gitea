// Lumen Scripture Show server.
// - Serves the operator console and output pages
// - Proxies + caches Bible text from bolls.life (hundreds of translations, many languages)
// - Hosts imported/offline Bibles from data/bibles
// - Keeps the shared show state and pushes it to every output via Server-Sent Events
// - AI endpoints (Claude) for live scripture detection and presentation generation

import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { BOOKS, bookById } from './public/js/books.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, 'public');
const DATA = process.env.DATA_DIR || path.join(here, 'data');
const CACHE = path.join(DATA, 'cache');
const BIBLES = path.join(DATA, 'bibles');
const BUILTIN_BIBLES = path.join(here, 'bibles');
const PORT = Number(process.env.PORT || 4848);
const UPSTREAM = process.env.BIBLE_API || 'https://bolls.life';
const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const CHANNEL_COUNT = Math.max(6, Number(process.env.CHANNELS || 8));

await fs.mkdir(CACHE, { recursive: true });
await fs.mkdir(BIBLES, { recursive: true });

// ---------------------------------------------------------------- show state
const THEMES = ['aurora', 'midnight', 'sunrise', 'forest', 'ocean', 'paper', 'black'];
const MODES = ['full', 'lower', 'stage', 'chroma', 'alpha', 'confidence'];
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
  service: [],       // playlist items
  channels: Array.from({ length: CHANNEL_COUNT }, (_, i) => defaultChannel(i)),
};

const STATE_FILE = path.join(DATA, 'state.json');
try {
  const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  state = { ...state, ...saved, version: 0 };
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
function merge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(target[k])) merge(target[k], v);
    else target[k] = v;
  }
  return target;
}

const sseClients = new Set();
function broadcast() {
  state.version++;
  const msg = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const res of sseClients) res.write(msg);
  persist();
}
setInterval(() => { for (const res of sseClients) res.write(': ping\n\n'); }, 25000);

function sanitizePatch(p) {
  const out = {};
  for (const k of ['translation', 'live', 'next', 'black', 'clear', 'logo', 'logoText', 'stageMessage', 'service']) if (k in p) out[k] = p[k];
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
  const r = await fetch(UPSTREAM + p, { headers: { 'user-agent': 'LumenScriptureShow/1.0' }, signal: AbortSignal.timeout(15000) });
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

async function readBody(req, limit = 60e6) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 }); chunks.push(c); }
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

function lanUrls() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' }); return res.end(); }

    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      res.write(`retry: 1500\nevent: state\ndata: ${JSON.stringify(state)}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, state);
    if (p === '/api/state' && req.method === 'POST') {
      merge(state, sanitizePatch(await readBody(req)));
      broadcast();
      return send(res, 200, { ok: true, version: state.version });
    }
    if (p === '/api/info') return send(res, 200, { ai: aiEnabled, model: aiEnabled ? AI_MODEL : null, lan: lanUrls(), port: PORT, channels: state.channels.length, themes: THEMES, modes: MODES });
    if (p === '/api/translations') return send(res, 200, await getTranslations());

    let m;
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
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'not found', 'text/plain');
    console.error(p, e.message);
    send(res, e.status || 502, { error: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Lumen Scripture Show  →  http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  On your network       →  ${u}`);
  console.log(`  Output channels       →  ${state.channels.length}  (e.g. http://localhost:${PORT}/output.html?ch=1)`);
  console.log(`  AI assist             →  ${aiEnabled ? 'on (' + AI_MODEL + ')' : 'off — set ANTHROPIC_API_KEY to enable'}\n`);
});
