// Operator console.
import { BOOKS, bookById, formatRef, parseReferences, refKey } from './books.js';
import { api, autoScale, bookName, books, buildSlide, chapter, langCode, passage, resolveSlide, show, translationInfo, translations } from './render.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('lumen.' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('lumen.' + k, JSON.stringify(v)); } catch {} } };

let S = null;                 // shared server state
let info = { ai: false, lan: [], themes: [], modes: [] };
const view = { book: 43, chapter: 3, testament: 'NT', verses: [], anchor: null, sel: null };
let preview = null;           // item in preview
let extraNames = {};          // book names in the current translation (for typed/spoken refs)
let trOptionsHtml = '';

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'toast'; }, 2600);
}
const push = (patch) => api('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).catch((e) => toast(e.message, true));

// ---------------------------------------------------------------- state sync
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    const prev = S; S = JSON.parse(e.data);
    if (!prev) firstState();
    if (!prev || prev.translation !== S.translation) onTranslationChanged();
    if (!prev || JSON.stringify(prev.channels) !== JSON.stringify(S.channels)) renderChannels();
    if (!prev || JSON.stringify(prev.service) !== JSON.stringify(S.service)) renderService();
    if (!prev || JSON.stringify(prev.live) !== JSON.stringify(S.live)) onLiveChanged(prev?.live);
    renderOverlayButtons();
  });
  es.onerror = () => toast('Reconnecting to server…', true);
}

function firstState() {
  $('#logoText').value = S.logoText || '';
  $('#stageMsg').value = S.stageMessage || '';
  const ch = store.get('monitorCh', 1);
  $('#liveMonitorCh').innerHTML = S.channels.map((c) => `<option value="${c.id}">Ch ${c.id}</option>`).join('');
  $('#liveMonitorCh').value = ch;
  $('#liveFrame').src = `/output.html?ch=${ch}&embed`;
  const last = store.get('view', null);
  if (last) Object.assign(view, last);
  if (S.live) setTimeout(() => setPreview(S.live), 0);
  view.testament = view.book <= 39 ? 'OT' : 'NT';
}

// ---------------------------------------------------------------- translations
async function onTranslationChanged() {
  const t = await translationInfo(S.translation);
  $('#trLabel').textContent = t.id;
  $('#trButton').title = `${t.name}${t.language ? ' · ' + t.language : ''}`;
  try {
    const list = await books(S.translation);
    extraNames = Object.fromEntries(list.map((b) => [b.name, b.id]));
  } catch { extraNames = {}; }
  if (t.lang && !store.get('speechLangSet', false)) $('#speechLang').value = t.lang;
  renderBooks();
  loadChapter(view.book, view.chapter, { keepSelection: true });
  if (preview) setPreview(preview);
}

function buildTrOptions(langs) {
  trOptionsHtml = langs.map((l) => `<optgroup label="${esc(l.language)}">${l.translations.map((t) => `<option value="${esc(t.id)}">${esc(t.id)} — ${esc(t.name)}</option>`).join('')}</optgroup>`).join('');
}

function renderTrList(filter = '') {
  translations().then((langs) => {
    const q = filter.trim().toLowerCase();
    let total = 0;
    const html = langs.map((l) => {
      const items = l.translations.filter((t) => !q || l.language.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
      total += items.length;
      if (!items.length) return '';
      return `<div class="tr-lang">${esc(l.language)} · ${items.length}</div>` + items.map((t) =>
        `<div class="tr-item${t.id === S.translation ? ' on' : ''}" data-tr="${esc(t.id)}"><b>${esc(t.id)}</b><span>${esc(t.name)}</span>${t.source === 'local' ? '<em class="local">offline</em>' : ''}</div>`).join('');
    }).join('');
    $('#trList').innerHTML = (q ? '' : `<p class="muted small">${langs.reduce((n, l) => n + l.translations.length, 0)} translations in ${langs.length} languages</p>`) + (html || '<p class="muted">No match.</p>');
  }).catch((e) => { $('#trList').innerHTML = `<p class="muted">Could not load translations: ${esc(e.message)}</p>`; });
  const recent = store.get('recentTr', []);
  $('#trRecent').innerHTML = recent.map((r) => `<button data-tr="${esc(r)}">${esc(r)}</button>`).join('');
}

function chooseTranslation(id) {
  const recent = [id, ...store.get('recentTr', []).filter((x) => x !== id)].slice(0, 8);
  store.set('recentTr', recent);
  push({ translation: id });
  $('#trDialog').close();
}

// ---------------------------------------------------------------- bible browser
async function renderBooks() {
  let list = BOOKS.map((b) => ({ id: b.id, name: b.name, chapters: b.chapters }));
  try { const tb = await books(S.translation); if (tb.length) list = tb.filter((b) => b.id <= 66 || b.name); } catch {}
  const f = $('#bookFilter').value.trim().toLowerCase();
  const shown = list.filter((b) => (f ? b.name.toLowerCase().includes(f) : (b.id <= 39 ? 'OT' : 'NT') === view.testament));
  $('#books').innerHTML = shown.map((b) => `<button data-book="${b.id}" class="${b.id === view.book ? 'on' : ''}" title="${esc(b.name)}">${esc(b.name)}</button>`).join('');
  $$('#testamentTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === view.testament && !f));
}

async function renderChapters() {
  const b = (await books(S.translation).catch(() => [])).find((x) => x.id === view.book) || bookById(view.book);
  const n = b?.chapters || 1;
  $('#chapterTitle').textContent = `${b?.name || ''} · ${n} chapter${n > 1 ? 's' : ''}`;
  $('#chapters').innerHTML = Array.from({ length: n }, (_, i) => `<button data-ch="${i + 1}" class="${i + 1 === view.chapter ? 'on' : ''}">${i + 1}</button>`).join('');
}

async function loadChapter(book, ch, { keepSelection = false, select = null } = {}) {
  view.book = book; view.chapter = ch;
  view.testament = book <= 39 ? 'OT' : 'NT';
  store.set('view', { book, chapter: ch });
  if (!keepSelection) { view.anchor = null; view.sel = null; }
  renderBooks(); renderChapters();
  const name = await bookName(S.translation, book);
  $('#chapterHeading').textContent = `${name} ${ch}`;
  $('#verses').innerHTML = '<li class="empty">Loading…</li>';
  try {
    view.verses = await chapter(S.translation, book, ch);
    if (view.book !== book || view.chapter !== ch) return;
    if (select) { view.anchor = select[0]; view.sel = select; }
    renderVerses();
    if (select) $(`#verses li[data-v="${select[0]}"]`)?.scrollIntoView({ block: 'center' });
  } catch (e) {
    view.verses = [];
    $('#verses').innerHTML = `<li class="empty">Not available in ${esc(S.translation)} — ${esc(e.message)}<br>Try another translation, or import one in Settings.</li>`;
  }
}

function renderVerses() {
  const live = S.live?.kind === 'scripture' ? S.live.ref : null;
  const isLive = (v) => live && live.book === view.book && live.chapter === view.chapter && v >= (live.verseStart || 1) && v <= (live.verseEnd || live.verseStart || 1);
  const [a, b] = view.sel || [];
  const dir = view.verses.dir;
  $('#verses').innerHTML = view.verses.length ? view.verses.map((v) =>
    `<li data-v="${v.verse}" class="${v.verse >= a && v.verse <= b ? 'sel' : ''} ${isLive(v.verse) ? 'live' : ''}" ${dir ? `dir="${dir}"` : ''}><span class="n">${v.verse}</span><span>${esc(v.text)}</span></li>`).join('')
    : '<li class="empty">No verses.</li>';
}

function selectVerses(a, b) {
  view.sel = [Math.min(a, b), Math.max(a, b)];
  renderVerses();
  setPreview({ kind: 'scripture', ref: { book: view.book, chapter: view.chapter, verseStart: view.sel[0], verseEnd: view.sel[1] } });
}

async function search(q) {
  $('#searchResults').innerHTML = '<div class="muted">Searching…</div>';
  try {
    const rows = await api(`/api/search/${encodeURIComponent(S.translation)}?q=${encodeURIComponent(q)}`);
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    $('#searchResults').innerHTML = rows.length ? rows.map((r) =>
      `<div data-ref="${r.book}.${r.chapter}.${r.verse}"><b>${esc(formatRef({ book: r.book, chapter: r.chapter, verseStart: r.verse }))}</b> ${esc(r.text).replace(re, (m) => `<mark>${m}</mark>`)}</div>`).join('')
      : '<div class="muted">No results.</div>';
  } catch (e) { $('#searchResults').innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
}

// ---------------------------------------------------------------- preview / live
const previewHost = $('#previewHost');
autoScale(previewHost);

async function itemLabel(item) {
  if (!item) return '';
  if (item.kind === 'text') return item.title;
  return formatRef(item.ref, await bookName(S.translation, item.ref.book));
}

async function setPreview(item) {
  preview = item;
  const ch = S.channels.find((c) => c.id === Number($('#liveMonitorCh').value)) || S.channels[0];
  const cfg = { ...ch, mode: ch.mode === 'stage' || ch.mode === 'confidence' ? 'full' : ch.mode };
  $('#previewLabel').textContent = await itemLabel(item);
  const slide = await resolveSlide(item, cfg, S);
  if (preview !== item) return;
  show(previewHost, buildSlide(slide, cfg, S, {}), 'cut');
}

function nextOf(item) {
  if (!item) return null;
  const i = S.service.findIndex((s) => JSON.stringify(s) === JSON.stringify(item));
  if (i >= 0 && S.service[i + 1]) return S.service[i + 1];
  if (item.kind === 'scripture') {
    const r = item.ref; const len = (r.verseEnd || r.verseStart || 1) - (r.verseStart || 1);
    const start = (r.verseEnd || r.verseStart || 1) + 1;
    return { kind: 'scripture', ref: { ...r, verseStart: start, verseEnd: start + len } };
  }
  return null;
}

function goLive(item = preview) {
  if (!item) return toast('Nothing in preview — pick a verse first');
  push({ live: item, next: nextOf(item), black: false, clear: false, logo: false });
}

async function stepLive(delta) {
  const live = S.live;
  if (live?.kind !== 'scripture') return;
  const r = live.ref;
  const s = r.verseStart || 1; const e = r.verseEnd || s; const len = e - s + 1;
  let ns = s + delta * len;
  let ref = { ...r, verseStart: ns, verseEnd: ns + len - 1 };
  try {
    const verses = await chapter(S.translation, r.book, r.chapter);
    const max = verses.length ? verses[verses.length - 1].verse : 999;
    if (ns > max) { // roll into next chapter
      const b = bookById(r.book); if (r.chapter >= b.chapters) return;
      ref = { book: r.book, chapter: r.chapter + 1, verseStart: 1, verseEnd: len };
    } else if (ns < 1) {
      if (r.chapter <= 1) return;
      const pv = await chapter(S.translation, r.book, r.chapter - 1);
      const last = pv[pv.length - 1]?.verse || 1;
      ref = { book: r.book, chapter: r.chapter - 1, verseStart: Math.max(1, last - len + 1), verseEnd: last };
    } else ref.verseEnd = Math.min(ref.verseEnd, max);
  } catch {}
  const item = { kind: 'scripture', ref };
  goLive(item);
  if (ref.book !== view.book || ref.chapter !== view.chapter) loadChapter(ref.book, ref.chapter, { select: [ref.verseStart, ref.verseEnd] });
  else { view.sel = [ref.verseStart, ref.verseEnd]; }
  setPreview(item);
}

async function onLiveChanged(prev) {
  $('#liveLabel').textContent = await itemLabel(S.live);
  renderVerses();
  renderService();
  if (S.live && JSON.stringify(prev) !== JSON.stringify(S.live) && $('#autoSpeak').checked) speakItem(S.live);
}

function renderOverlayButtons() {
  $('#btnBlack').classList.toggle('on', !!S.black);
  $('#btnClear').classList.toggle('on', !!S.clear);
  $('#btnLogo').classList.toggle('on', !!S.logo);
}

// Parse a typed reference and preview it.
async function quickRef(text, live = false) {
  const refs = parseReferences(text, extraNames);
  if (!refs.length) {
    if (text.trim().length > 2) { $('#searchInput').value = text; search(text.trim()); toast('No reference found — searching the text instead'); }
    return;
  }
  const r = refs[0];
  const ref = { ...r, verseStart: r.verseStart || 1, verseEnd: r.verseEnd || r.verseStart || 1 };
  await loadChapter(ref.book, ref.chapter, { select: [ref.verseStart, ref.verseEnd] });
  const item = { kind: 'scripture', ref };
  await setPreview(item);
  if (live) goLive(item);
}

// ---------------------------------------------------------------- channels
const MODE_LABELS = { full: 'Full screen', lower: 'Lower third', stage: 'Stage display', chroma: 'Lower third · green key', alpha: 'Lower third · transparent', confidence: 'Confidence monitor' };
const THEMES = ['aurora', 'midnight', 'sunrise', 'forest', 'ocean', 'paper', 'black'];
const openCh = new Set(store.get('openCh', []));

function renderChannels() {
  $('#chCount').textContent = `${S.channels.length} output channels`;
  const focused = document.activeElement?.closest?.('.ch');
  if (focused && $('#channels').contains(focused) && document.activeElement.matches('input[type=text],input:not([type]),input[type=url]')) return; // don't clobber typing
  $('#channels').innerHTML = S.channels.map((c) => `
    <div class="ch ${c.enabled ? '' : 'off'} ${openCh.has(c.id) ? 'open' : ''}" data-id="${c.id}">
      <div class="ch-head" data-toggle>
        <span class="ch-num">${c.id}</span>
        <span class="ch-name"><b>${esc(c.name)}</b><span>${MODE_LABELS[c.mode] || c.mode} · ${esc(c.translation || S.translation)}${c.secondary ? ' + ' + esc(c.secondary) : ''}</span></span>
        <button class="btn ghost sm" data-act="open" title="Open output window">Open</button>
        <label class="switch" title="Enabled" onclick="event.stopPropagation()"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''}><span></span></label>
      </div>
      <div class="ch-body">
        <label class="full">Name<input data-k="name" value="${esc(c.name)}"></label>
        <label>Layout<select data-k="mode">${Object.entries(MODE_LABELS).map(([k, v]) => `<option value="${k}" ${k === c.mode ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Theme<select data-k="theme">${THEMES.map((t) => `<option ${t === c.theme ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Translation<select data-k="translation" data-val="${esc(c.translation)}"><option value="">Follow main (${esc(S.translation)})</option>${trOptionsHtml}</select></label>
        <label>Parallel translation<select data-k="secondary" data-val="${esc(c.secondary)}"><option value="">None</option>${trOptionsHtml}</select></label>
        <label>Text size <input type="range" data-k="fontScale" min="0.5" max="1.6" step="0.05" value="${c.fontScale}"></label>
        <label>Align<select data-k="align"><option ${c.align === 'center' ? 'selected' : ''}>center</option><option ${c.align === 'left' ? 'selected' : ''}>left</option></select></label>
        <label class="full">Background image / video URL<input type="url" data-k="background" value="${esc(c.background)}" placeholder="https://…/background.mp4"></label>
        <label class="check"><input type="checkbox" data-k="showReference" ${c.showReference !== false ? 'checked' : ''}> Show reference</label>
        <label class="check"><input type="checkbox" data-k="showVerseNumbers" ${c.showVerseNumbers ? 'checked' : ''}> Verse numbers</label>
        <label>Transition<select data-k="transition"><option ${c.transition === 'fade' ? 'selected' : ''}>fade</option><option ${c.transition === 'cut' ? 'selected' : ''}>cut</option></select></label>
        <label>Text color<input type="color" data-k="textColor" value="${c.textColor || '#ffffff'}"></label>
        <div class="actions">
          <button class="btn sm" data-act="screen">Open on screen…</button>
          <button class="btn ghost sm" data-act="copy">Copy URL (OBS)</button>
          <button class="btn ghost sm" data-act="identify">Identify</button>
        </div>
      </div>
    </div>`).join('');
  $$('#channels select[data-val]').forEach((s) => { s.value = s.dataset.val; });
}

function updateChannel(id, patch) {
  const channels = S.channels.map((c) => (c.id === id ? { ...c, ...patch } : c));
  S.channels = channels; // optimistic
  push({ channels });
}

const outputUrl = (id) => `${location.origin}/output.html?ch=${id}`;
const windows = {};
async function openChannel(id, pickScreen = false) {
  let features = 'popup,width=960,height=540';
  if (pickScreen && 'getScreenDetails' in window) {
    try {
      const sd = await window.getScreenDetails();
      const list = sd.screens.map((s, i) => `${i + 1}: ${s.label || 'Screen ' + (i + 1)} (${s.width}×${s.height})${s.isPrimary ? ' – primary' : ''}`).join('\n');
      const pick = Number(prompt(`Open channel ${id} on which screen?\n${list}`, String(Math.min(2, sd.screens.length))));
      const s = sd.screens[pick - 1];
      if (s) features = `popup,fullscreen,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`;
    } catch { toast('Screen access was not allowed — opening a normal window'); }
  } else if (pickScreen) toast('Your browser cannot pick screens — drag the window to the projector and double-click it');
  windows[id] = window.open(outputUrl(id), `lumen-ch-${id}`, features);
  if (!windows[id]) toast('Pop-up blocked — allow pop-ups for this site', true);
}

// ---------------------------------------------------------------- service
function renderService() {
  if (!S) return;
  const liveKey = JSON.stringify(S.live);
  $('#service').innerHTML = S.service.length ? S.service.map((it, i) => `
    <li class="svc ${JSON.stringify(it) === liveKey ? 'live' : ''}" data-i="${i}">
      <span class="idx">${i + 1}</span>
      <div class="meta" data-act="preview"><b>${esc(it.kind === 'text' ? it.title : (it.heading ? it.heading + ' — ' : '') + formatRef(it.ref))}</b><div class="txt">${esc(it.kind === 'text' ? it.body || 'Text slide' : 'Scripture')}</div></div>
      <button class="btn live sm" data-act="live">Live</button>
      <button class="x" data-act="up" title="Move up">↑</button>
      <button class="x" data-act="del" title="Remove">✕</button>
    </li>`).join('') : '<li class="muted small">Your service is empty. Add verses with “＋ Service”, or let AI build one.</li>';
}
const setService = (service) => push({ service });
function serviceStep(d) {
  if (!S.service.length) return;
  const i = S.service.findIndex((s) => JSON.stringify(s) === JSON.stringify(S.live));
  const n = Math.min(S.service.length - 1, Math.max(0, i + d));
  if (i < 0 && d < 0) return;
  const item = S.service[i < 0 ? 0 : n];
  goLive(item); setPreview(item);
}

// ---------------------------------------------------------------- voice (TTS)
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices();
  const sel = $('#voiceSel'); const cur = store.get('voice', '');
  sel.innerHTML = '<option value="">Auto (match translation)</option>' + voices.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)} — ${esc(v.lang)}</option>`).join('');
  sel.value = cur;
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

async function speakItem(item) {
  if (!('speechSynthesis' in window) || !item) return;
  speechSynthesis.cancel();
  let text = '', lang = '';
  if (item.kind === 'text') text = `${item.title}. ${item.body || ''}`;
  else {
    const p = await passage(S.translation, item.ref).catch(() => null);
    if (!p) return;
    text = `${p.reference}. ${p.verses.map((v) => v.text).join(' ')}`;
    lang = p.lang;
  }
  const u = new SpeechSynthesisUtterance(text);
  const chosen = voices.find((v) => v.voiceURI === $('#voiceSel').value);
  const auto = lang && (voices.find((v) => v.lang === lang && /natural|neural|premium|enhanced|google/i.test(v.name)) || voices.find((v) => v.lang === lang) || voices.find((v) => v.lang.startsWith(lang.slice(0, 2))));
  if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else if (auto) { u.voice = auto; u.lang = auto.lang; } else if (lang) u.lang = lang;
  u.rate = Number($('#voiceRate').value);
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- listening (speech -> scripture)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, transcript = '', recent = new Map(), aiTimer = null, aiBusy = false, lastAiLen = 0;

const SPEECH_LANGS = ['en-US', 'en-GB', 'en-NG', 'en-IN', 'es-ES', 'es-MX', 'pt-BR', 'pt-PT', 'fr-FR', 'de-DE', 'it-IT', 'nl-NL', 'ru-RU', 'uk-UA', 'pl-PL', 'ro-RO', 'hu-HU', 'cs-CZ', 'el-GR', 'tr-TR', 'ar-SA', 'he-IL', 'fa-IR', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'ml-IN', 'ur-PK', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'vi-VN', 'th-TH', 'id-ID', 'ms-MY', 'fil-PH', 'sw-KE', 'am-ET', 'yo-NG', 'ig-NG', 'ha-NG', 'zu-ZA', 'af-ZA', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI'];
$('#speechLang').innerHTML = SPEECH_LANGS.map((l) => `<option>${l}</option>`).join('');
$('#speechLang').value = store.get('speechLang', 'en-US');

function setMic(on) {
  if (on && !SR) return toast('Speech recognition needs Chrome or Edge', true);
  listening = on;
  $('#micBtn').classList.toggle('on', on);
  $('#micBtn2').textContent = on ? 'Stop listening' : 'Start listening';
  if (on) {
    rec = new SR();
    rec.lang = $('#speechLang').value; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onSpeech(r[0].transcript); else interim += r[0].transcript;
      }
      renderTranscript(interim);
      if (interim) detectLocal(interim, true);
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') { toast('Microphone permission denied', true); setMic(false); } };
    rec.onend = () => { if (listening) try { rec.start(); } catch {} }; // keep going through pauses
    try { rec.start(); } catch {}
    toast('Listening… say a reference like “John 3:16”');
  } else if (rec) { rec.onend = null; rec.stop(); rec = null; }
}

function renderTranscript(interim = '') {
  const tail = transcript.slice(-600);
  $('#transcript').innerHTML = esc(tail) + (interim ? ` <span class="interim">${esc(interim)}</span>` : '') || '<span class="muted">Transcript appears here…</span>';
  $('#transcript').scrollTop = 1e9;
}

function onSpeech(text) {
  transcript += ' ' + text.trim();
  detectLocal(transcript.slice(-160));
  if (info.ai && $('#aiDetect').checked) {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(detectAI, 1200);
  }
}

function detectLocal(text, interim = false) {
  const refs = parseReferences(text, extraNames);
  for (const r of refs) {
    if (interim && !r.verseStart) continue; // wait for the verse number
    addDetection({ ...r, verseStart: r.verseStart || 1, verseEnd: r.verseEnd || r.verseStart || 1, source: 'speech', confidence: r.verseStart ? 1 : 0.8 });
  }
}

async function detectAI() {
  if (aiBusy || transcript.length - lastAiLen < 20) return;
  aiBusy = true; lastAiLen = transcript.length;
  try {
    const { references } = await api('/api/ai/detect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript: transcript.slice(-1500), language: $('#speechLang').value }) });
    for (const r of references) addDetection({ ...r, source: 'ai' });
  } catch (e) { console.warn('AI detect', e); }
  finally { aiBusy = false; }
}

async function addDetection(d) {
  const key = refKey(d);
  const now = Date.now();
  // Same passage within 45s is a repeat; a fuller range replaces a partial one.
  for (const [k, t] of recent) if (now - t > 45000) recent.delete(k);
  if (recent.has(key)) return;
  recent.set(key, now);
  const item = { kind: 'scripture', ref: { book: d.book, chapter: d.chapter, verseStart: d.verseStart, verseEnd: d.verseEnd } };
  const li = document.createElement('li');
  li.className = 'det new';
  li.innerHTML = `<div class="meta"><b>${esc(formatRef(item.ref, await bookName(S.translation, d.book)))}</b><div class="txt">…</div></div>
    <span class="src ${d.source === 'ai' ? 'ai' : ''}">${d.source === 'ai' ? (d.kind || 'AI') : 'heard'}</span>
    <button class="btn live sm">Live</button>`;
  li.querySelector('.meta').onclick = () => { setPreview(item); loadChapter(d.book, d.chapter, { select: [d.verseStart, d.verseEnd] }); };
  li.querySelector('button').onclick = () => { goLive(item); setPreview(item); };
  $('#detections').prepend(li);
  while ($('#detections').children.length > 30) $('#detections').lastChild.remove();
  passage(S.translation, item.ref).then((p) => { li.querySelector('.txt').textContent = p.verses.map((v) => v.text).join(' ') || '(not in this translation)'; }).catch(() => {});
  $('#transcript').innerHTML = $('#transcript').innerHTML; // keep
  if ($('#autoLive').checked && (d.confidence ?? 1) >= 0.75) {
    goLive(item); setPreview(item);
    loadChapter(d.book, d.chapter, { select: [d.verseStart, d.verseEnd] });
  }
}

// ---------------------------------------------------------------- AI presentation builder
async function generate() {
  const prompt = $('#genPrompt').value.trim();
  if (!prompt) return toast('Describe the sermon first');
  $('#genBtn').disabled = true; $('#genStatus').textContent = 'Building your presentation…';
  try {
    const out = await api('/api/ai/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, count: Number($('#genCount').value) }) });
    const items = out.items || [];
    setService([...S.service, ...items]);
    $('#genStatus').textContent = `Added “${out.title}” — ${items.length} slides to your service.`;
    $('#serviceTitle').textContent = out.title || 'Service';
    switchTab('service');
    if (items[0]) setPreview(items[0]);
  } catch (e) { $('#genStatus').textContent = e.message; }
  finally { $('#genBtn').disabled = false; }
}

// ---------------------------------------------------------------- tabs & events
function switchTab(name) {
  $$('#sideTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab-body').forEach((b) => { b.hidden = b.dataset.body !== name; });
  store.set('tab', name);
}

function wire() {
  $('#sideTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); };
  switchTab(store.get('tab', 'channels'));

  $('#quick').onsubmit = (e) => { e.preventDefault(); quickRef($('#quickInput').value); };
  $('#quickLive').onclick = () => quickRef($('#quickInput').value, true);
  $('#quickInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); quickRef($('#quickInput').value, true); } });

  $('#testamentTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; view.testament = b.dataset.t; $('#bookFilter').value = ''; renderBooks(); };
  $('#bookFilter').oninput = renderBooks;
  $('#books').onclick = (e) => { const b = e.target.closest('button'); if (b) loadChapter(Number(b.dataset.book), 1); };
  $('#chapters').onclick = (e) => { const b = e.target.closest('button'); if (b) loadChapter(view.book, Number(b.dataset.ch)); };
  $('#prevCh').onclick = () => { if (view.chapter > 1) loadChapter(view.book, view.chapter - 1); else if (view.book > 1) loadChapter(view.book - 1, bookById(view.book - 1).chapters); };
  $('#nextCh').onclick = () => { if (view.chapter < (bookById(view.book)?.chapters || 1)) loadChapter(view.book, view.chapter + 1); else if (view.book < 66) loadChapter(view.book + 1, 1); };

  $('#verses').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-v]'); if (!li) return;
    const v = Number(li.dataset.v);
    if (e.shiftKey && view.anchor) selectVerses(view.anchor, v); else { view.anchor = v; selectVerses(v, v); }
  });
  $('#verses').addEventListener('dblclick', (e) => { if (e.target.closest('li[data-v]')) goLive(); });
  $('#goLive').onclick = () => goLive();
  $('#addService').onclick = () => { if (preview) { setService([...S.service, preview]); toast('Added to service'); } };
  $('#speakBtn').onclick = () => speakItem(preview);
  $('#speakLive').onclick = () => speakItem(S.live);
  $('#stopSpeak').onclick = () => speechSynthesis.cancel();
  $('#voiceSel').onchange = (e) => store.set('voice', e.target.value);
  $('#autoSpeak').checked = store.get('autoSpeak', false); $('#autoSpeak').onchange = (e) => store.set('autoSpeak', e.target.checked);
  $('#autoLive').checked = store.get('autoLive', false); $('#autoLive').onchange = (e) => store.set('autoLive', e.target.checked);

  $('#searchForm').onsubmit = (e) => { e.preventDefault(); const q = $('#searchInput').value.trim(); if (q) search(q); };
  $('#searchResults').onclick = (e) => {
    const d = e.target.closest('[data-ref]'); if (!d) return;
    const [b, c, v] = d.dataset.ref.split('.').map(Number);
    loadChapter(b, c, { select: [v, v] }).then(() => setPreview({ kind: 'scripture', ref: { book: b, chapter: c, verseStart: v, verseEnd: v } }));
  };

  $('#btnBlack').onclick = () => push({ black: !S.black });
  $('#btnClear').onclick = () => push({ clear: !S.clear });
  $('#btnLogo').onclick = () => push({ logo: !S.logo });
  $('#micBtn').onclick = $('#micBtn2').onclick = () => setMic(!listening);
  $('#speechLang').onchange = (e) => { store.set('speechLang', e.target.value); store.set('speechLangSet', true); if (listening) { setMic(false); setMic(true); } };
  $('#clearDetections').onclick = () => { $('#detections').innerHTML = ''; recent.clear(); transcript = ''; lastAiLen = 0; renderTranscript(); };
  $('#genBtn').onclick = generate;

  // translation dialog
  $('#trButton').onclick = () => { $('#trDialog').showModal(); $('#trSearch').value = ''; renderTrList(); setTimeout(() => $('#trSearch').focus(), 50); };
  $('#trClose').onclick = () => $('#trDialog').close();
  $('#trSearch').oninput = (e) => renderTrList(e.target.value);
  $('#trDialog').onclick = (e) => { const t = e.target.closest('[data-tr]'); if (t) chooseTranslation(t.dataset.tr); };

  // channels
  $('#channels').addEventListener('click', (e) => {
    const ch = e.target.closest('.ch'); if (!ch) return;
    const id = Number(ch.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open') { e.stopPropagation(); return openChannel(id); }
    if (act === 'screen') return openChannel(id, true);
    if (act === 'copy') { navigator.clipboard?.writeText(outputUrl(id)).then(() => toast('URL copied — add it as a Browser Source (1920×1080)')).catch(() => prompt('Copy this URL', outputUrl(id))); return; }
    if (act === 'identify') return new BroadcastChannel('lumen').postMessage({ type: 'identify' });
    if (e.target.closest('[data-toggle]') && !e.target.closest('label,button')) {
      ch.classList.toggle('open');
      ch.classList.contains('open') ? openCh.add(id) : openCh.delete(id);
      store.set('openCh', [...openCh]);
    }
  });
  $('#channels').addEventListener('change', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    const id = Number(e.target.closest('.ch').dataset.id);
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
    updateChannel(id, { [k]: v });
    if (Number($('#liveMonitorCh').value) === id && preview) setPreview(preview);
  });
  $('#identifyAll').onclick = () => new BroadcastChannel('lumen').postMessage({ type: 'identify' });
  $('#openAll').onclick = () => S.channels.filter((c) => c.enabled).forEach((c) => openChannel(c.id));
  $('#liveMonitorCh').onchange = (e) => { store.set('monitorCh', Number(e.target.value)); $('#liveFrame').src = `/output.html?ch=${e.target.value}&embed`; if (preview) setPreview(preview); };

  // service
  $('#service').addEventListener('click', (e) => {
    const li = e.target.closest('.svc'); if (!li) return;
    const i = Number(li.dataset.i); const item = S.service[i];
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'preview') { setPreview(item); if (item.kind === 'scripture') loadChapter(item.ref.book, item.ref.chapter, { select: [item.ref.verseStart, item.ref.verseEnd] }); }
    if (act === 'live') { goLive(item); setPreview(item); }
    if (act === 'del') setService(S.service.filter((_, j) => j !== i));
    if (act === 'up' && i > 0) { const s = [...S.service]; [s[i - 1], s[i]] = [s[i], s[i - 1]]; setService(s); }
  });
  $('#svcClear').onclick = () => { if (confirm('Clear the whole service?')) setService([]); };
  $('#svcNext').onclick = () => serviceStep(1);
  $('#svcPrev').onclick = () => serviceStep(-1);
  $('#textSlideForm').onsubmit = (e) => {
    e.preventDefault(); const t = $('#textSlideInput').value.trim(); if (!t) return;
    const [title, ...rest] = t.split(/\s*\|\s*/);
    const item = { kind: 'text', title, body: rest.join(' ') };
    setService([...S.service, item]); setPreview(item); $('#textSlideInput').value = '';
  };

  // settings
  $('#logoText').onchange = (e) => push({ logoText: e.target.value });
  $('#stageSend').onclick = () => push({ stageMessage: $('#stageMsg').value });
  $('#stageClear').onclick = () => { $('#stageMsg').value = ''; push({ stageMessage: '' }); };
  $('#impBtn').onclick = async () => {
    const f = $('#impFile').files[0]; const short = $('#impShort').value.trim();
    if (!f || !short) return toast('Pick a file and a short name', true);
    $('#impStatus').textContent = 'Importing…';
    try {
      const data = JSON.parse(await f.text());
      const r = await api('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, short_name: short, full_name: $('#impName').value, language: $('#impLang').value }) });
      $('#impStatus').textContent = `Imported ${r.verses.toLocaleString()} verses as ${r.short_name}. Reload to see it in the list.`;
    } catch (e) { $('#impStatus').textContent = e.message; }
  };

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key;
    if (k === '/') { e.preventDefault(); $('#quickInput').focus(); $('#quickInput').select(); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); goLive(); }
    else if (k === 'ArrowRight') { e.preventDefault(); stepLive(1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); stepLive(-1); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      if (!view.verses.length) return;
      const cur = view.sel ? (k === 'ArrowDown' ? view.sel[1] : view.sel[0]) : 0;
      const idx = view.verses.findIndex((v) => v.verse === cur);
      const nv = view.verses[Math.min(view.verses.length - 1, Math.max(0, idx + (k === 'ArrowDown' ? 1 : -1)))]?.verse;
      if (nv) { view.anchor = nv; selectVerses(nv, nv); $(`#verses li[data-v="${nv}"]`)?.scrollIntoView({ block: 'nearest' }); }
    }
    else if (k === 'b' || k === 'B') push({ black: !S.black });
    else if (k === 'c' || k === 'C') push({ clear: !S.clear });
    else if (k === 'l' || k === 'L') push({ logo: !S.logo });
    else if (k === 'm' || k === 'M') setMic(!listening);
    else if (k === 'Escape') push({ black: false, clear: false, logo: false });
    else if (k === 'PageDown') { e.preventDefault(); serviceStep(1); }
    else if (k === 'PageUp') { e.preventDefault(); serviceStep(-1); }
  });
}

// ---------------------------------------------------------------- boot
(async function boot() {
  wire();
  info = await api('/api/info').catch(() => info);
  $('#aiStatus').textContent = info.ai ? 'AI on' : 'AI off';
  $('#aiStatus').classList.toggle('on', !!info.ai);
  $('#aiStatus').title = info.ai ? `Model: ${info.model}` : 'Set ANTHROPIC_API_KEY on the server to enable AI';
  if (!info.ai) { $('#aiDetect').checked = false; $('#aiDetect').disabled = true; $('#genBtn').disabled = true; $('#genStatus').textContent = 'AI is off — start the server with ANTHROPIC_API_KEY set.'; }
  const urls = [location.origin, ...(info.lan || [])];
  $('#lanInfo').innerHTML = urls.map((u) => `<div>Console: ${esc(u)}/</div><div>Output N: ${esc(u)}/output.html?ch=N</div>`).join('<br>');
  translations().then(buildTrOptions).then(() => S && renderChannels()).catch(() => {});
  connect();
})();
