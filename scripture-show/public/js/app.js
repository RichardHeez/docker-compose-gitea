// Operator console.
import { BOOKS, bookById, formatRef, parseFollowUp, parseReferences, refKey } from './books.js';
import { FONTS, api, langCode, autoScale, bookName, books, buildSlide, chapter, normWord, paginate, passage, postJson, resolveSlide, show, splitWords, translationInfo, translations } from './render.js';
import * as control from './control.js';
import { arrangeSections, groupColor, lyricsToText, parseLyrics, sectionNames, slidesFor, songSummary, splitPastedSongs } from './songs.js';
import * as tools from './showtools.js';
import * as triggers from './triggers.js';
import * as designer from './designer.js';
import * as songtl from './songtimeline.js';
import { hasRole } from './design.js';
import { listCameras, updateTimers } from './render.js';
import { PhraseRecognizer } from './khaya.js';
import { langKey, setCustomWords } from './langs.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('f8.' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('f8.' + k, JSON.stringify(v)); } catch {} } };

let S = null;                 // shared server state
let info = { ai: false, lan: [], themes: [], modes: [] };
const view = { book: 43, chapter: 3, testament: 'NT', verses: [], anchor: null, sel: null };
let preview = null;           // item in preview
let extraNames = {};          // book names in the current translation (for typed/spoken refs)
let trLang = '';              // language code of the current translation
let speechNames = {};         // book names in the preacher's language (from Bibles in that language)
let trOptionsHtml = '';

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'toast'; }, 2600);
}
const push = (patch) => control.push(patch).catch((e) => toast(e.message, true));
const desktop = window.f8Desktop || null; // present when running inside the desktop app
let mediaList = [];

// ---------------------------------------------------------------- state sync
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    const prev = S; S = JSON.parse(e.data);
    if (!prev) firstState();
    if (!prev || prev.translation !== S.translation) onTranslationChanged();
    const designsChanged = !prev || JSON.stringify(prev.designs) !== JSON.stringify(S.designs);
    if (designsChanged || JSON.stringify(prev.channels) !== JSON.stringify(S.channels)) renderChannels();
    if (prev && designsChanged && preview) setPreview(preview); // designs/templates may change the preview
    if (!prev || JSON.stringify(prev.service) !== JSON.stringify(S.service)) renderService();
    if (!prev || JSON.stringify(prev.live) !== JSON.stringify(S.live)) onLiveChanged(prev?.live);
    if (!prev || JSON.stringify(prev.customWords) !== JSON.stringify(S.customWords)) { setCustomWords(S.customWords); loadCustomWordsForm(); }
    if (!prev || prev.songLines !== S.songLines) { $('#songLines').value = S.songLines || 4; $('#songLinesLabel').textContent = S.songLines || 4; renderSongSlides(); }
    if (!prev || prev.ccliLicense !== S.ccliLicense) $('#ccliLicense').value = S.ccliLicense || '';
    if (!prev || JSON.stringify(prev.live) !== JSON.stringify(S.live)) markLiveSongSlide();
    if (!prev || prev.splitChars !== S.splitChars) { $('#splitChars').value = S.splitChars; $('#splitLabel').textContent = S.splitChars || 'off —'; }
    renderOverlayButtons();
    show.state = S;
    tools.onState(S, prev);
    triggers.onState(S, prev);
    designer.onState(S, prev);
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
  trLang = t.lang;
  $('#trLabel').textContent = t.id;
  $('#trButton').title = `${t.name}${t.language ? ' · ' + t.language : ''}`;
  try {
    const list = await books(S.translation);
    extraNames = Object.fromEntries(list.map((b) => [b.name, b.id]));
  } catch { extraNames = {}; }
  if (t.lang && !store.get('speechLangSet', false) && [...$('#speechLang').options].some((o) => o.value === t.lang)) $('#speechLang').value = t.lang;
  loadSpeechNames();
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
  if (item.kind === 'media') return `${item.mediaType === 'video' ? '🎬' : '🖼'} ${item.name}`;
  if (item.kind === 'song') return `🎵 ${item.title} · ${item.slides?.[item.page || 0]?.label || ''}`;
  if (item.kind === 'camera') return `🎥 ${item.name}`;
  if (item.kind === 'design') return `✦ ${item.name}`;
  if (!item.ref) return '';
  return formatRef(item.ref, await bookName(S.translation, item.ref.book));
}

async function setPreview(item) {
  preview = item;
  const ch = S.channels.find((c) => c.id === Number($('#liveMonitorCh').value)) || S.channels[0];
  const cfg = { ...ch, mode: ch.mode === 'stage' || ch.mode === 'confidence' ? 'full' : ch.mode };
  const paged = await paginate(item, S);
  $('#previewLabel').innerHTML = esc(await itemLabel(item)) + (paged.pages > 1 ? `<span class="pg-badge">${paged.pages} screens</span>` : '');
  const slide = await resolveSlide(paged, cfg, S);
  if (preview !== item) return;
  show(previewHost, buildSlide(slide, cfg, S, { preview: true }), 'cut');
}

function goLive(item = preview) {
  if (!item) return toast('Nothing in preview — pick a verse first');
  control.goLive(S, item).catch((e) => toast(e.message, true));
}

// Keep the verse list following whatever is live.
function follow(item) {
  if (item?.kind !== 'scripture') return;
  const r = item.ref;
  if (r.book !== view.book || r.chapter !== view.chapter) loadChapter(r.book, r.chapter, { select: [r.verseStart, r.verseEnd] });
  else { view.sel = [r.verseStart, r.verseEnd]; renderVerses(); }
}

async function stepLive(delta) {
  const item = await control.step(S, delta).catch((e) => toast(e.message, true));
  if (item && !(item.pages > 1 && control.sameItem(item, S.live))) { follow(item); setPreview(item); }
}

async function onLiveChanged(prev) {
  const live = S.live;
  $('#liveLabel').textContent = await itemLabel(live);
  renderVerses();
  renderService();
  // page controls for split passages
  $('#pageCtl').hidden = !(live?.pages > 1);
  if (live?.pages > 1) $('#pgLabel').textContent = `Screen ${live.page + 1} of ${live.pages}`;
  $('#mediaCtl').hidden = !(live?.kind === 'media' && live.mediaType === 'video');
  // clickable words of what is on screen, for highlighting
  if (live?.kind === 'scripture') {
    passage(S.translation, live.ref).then((p) => {
      const words = splitWords(p.verses.flatMap((v) => v.text.split(/\s+/).filter(Boolean).map((w) => ({ w }))), live.pages || 1)[live.page || 0] || [];
      const hl = new Set((live.highlight || []).map(normWord));
      $('#wordStrip').innerHTML = words.map((x) => `<span data-w="${esc(x.w)}" class="${hl.has(normWord(x.w)) ? 'on' : ''}">${esc(x.w)}</span>`).join('');
    }).catch(() => { $('#wordStrip').innerHTML = ''; });
  } else $('#wordStrip').innerHTML = '';
  if (control.sameItem(prev, live)) return; // only a page/highlight change
  if (live && $('#autoSpeak').checked) speakItem(live);
}

function renderOverlayButtons() {
  $('#btnBlack').classList.toggle('on', !!S.black);
  $('#btnClear').classList.toggle('on', !!S.clear);
  $('#btnLogo').classList.toggle('on', !!S.logo);
}

// Parse a typed reference and preview it.
async function quickRef(text, live = false) {
  let refs = parseReferences(text, extraNames, 'en');
  if (!refs.length) refs = parseReferences(text, extraNames, trLang || 'en');
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
const MODE_LABELS = { full: 'Full screen', lower: 'Lower third', stage: 'Stage display', chroma: 'Lower third · green key', alpha: 'Lower third · transparent', confidence: 'Confidence monitor', announce: 'Announcements loop' };
const THEMES = ['aurora', 'midnight', 'sunrise', 'forest', 'ocean', 'paper', 'black'];
const openCh = new Set(store.get('openCh', []));

const sel = (k, value, options) => `<select data-k="${k}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const range = (k, value, min, max, step = 1) => `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${value}">`;
const check = (k, on, label) => `<label class="check"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}> ${label}</label>`;

function renderChannels() {
  $('#chCount').textContent = `${S.channels.length} output channels`;
  const focused = document.activeElement?.closest?.('.ch');
  if (focused && $('#channels').contains(focused) && document.activeElement.matches('input[type=text],input:not([type]),input[type=url]')) return; // don't clobber typing
  const bgOptions = [['', 'Theme only'], ...mediaList.filter((m) => m.type !== 'audio').map((m) => [m.url, `${m.type === 'video' ? '🎬' : '🖼'} ${m.name}`]), ...cameras.map((cam) => [`camera:${cam.label}`, `🎥 Live: ${cam.label}`])];
  $('#channels').innerHTML = S.channels.map((c) => {
    const custom = c.background && !mediaList.some((m) => m.url === c.background) && !(c.background.startsWith('camera:') && cameras.some((cam) => `camera:${cam.label}` === c.background));
    return `
    <div class="ch ${c.enabled ? '' : 'off'} ${openCh.has(c.id) ? 'open' : ''}" data-id="${c.id}">
      <div class="ch-head" data-toggle>
        <span class="ch-num">${c.id}</span>
        <span class="ch-name"><b>${esc(c.name)}</b><span>${MODE_LABELS[c.mode] || c.mode} · ${esc(c.translation || S.translation)}${c.secondary ? ' + ' + esc(c.secondary) : ''}${ndiOn.has(c.id) ? ' · NDI' : ''}</span></span>
        <button class="btn ghost sm" data-act="open" title="Open output window">Open</button>
        <label class="switch" title="Enabled" onclick="event.stopPropagation()"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''}><span></span></label>
      </div>
      <div class="ch-body">
        <label class="full">Name<input data-k="name" value="${esc(c.name)}"></label>
        <label>Layout${sel('mode', c.mode, Object.entries(MODE_LABELS))}</label>
        <label>Theme${sel('theme', c.theme, THEMES.map((t) => [t, t]))}</label>
        <label>Translation<select data-k="translation" data-val="${esc(c.translation)}"><option value="">Follow main (${esc(S.translation)})</option>${trOptionsHtml}</select></label>
        <label>Parallel translation<select data-k="secondary" data-val="${esc(c.secondary)}"><option value="">None</option>${trOptionsHtml}</select></label>

        <h5>Text</h5>
        <label>Font${sel('fontFamily', c.fontFamily, Object.entries(FONTS))}</label>
        <label>Text color<input type="color" data-k="textColor" value="${c.textColor || '#ffffff'}"></label>
        <label>Size ${range('fontScale', c.fontScale, 0.5, 1.6, 0.05)}</label>
        <label>Line spacing ${range('lineHeight', c.lineHeight || 1.28, 1, 1.8, 0.02)}</label>
        <label>Outline ${range('outline', c.outline || 0, 0, 10)}</label>
        <label>Shadow ${range('shadow', c.shadow ?? 5, 0, 10)}</label>
        <label class="full">Template${sel('template', c.template || '', [['', 'Standard layout'], ...(S.designs || []).filter((d) => hasRole(d, 'body')).map((d) => [d.id, d.name])])}</label>
        <label>Align${sel('align', c.align, [['center', 'center'], ['left', 'left']])}</label>
        <label>Transition${sel('transition', c.transition, [['fade', 'Fade'], ['dissolve', 'Dissolve'], ['push', 'Push'], ['zoom', 'Zoom'], ['blur', 'Blur'], ['cut', 'Cut']])}</label>
        ${check('showReference', c.showReference !== false, 'Show reference')}
        ${check('showVerseNumbers', c.showVerseNumbers, 'Verse numbers')}
        ${check('uppercase', c.uppercase, 'UPPERCASE')}

        <h5>Background</h5>
        <label class="full">Image / video<select data-k="background">${bgOptions.map(([v, l]) => `<option value="${esc(v)}" ${v === c.background ? 'selected' : ''}>${esc(l)}</option>`).join('')}${custom ? `<option value="${esc(c.background)}" selected>URL: ${esc(c.background)}</option>` : ''}</select></label>
        <label class="full">…or a URL<input type="url" data-k="background" value="${custom ? esc(c.background) : ''}" placeholder="https://…/background.mp4"></label>
        <label>Fit${sel('bgFit', c.bgFit || 'cover', [['cover', 'fill screen'], ['contain', 'fit whole image']])}</label>
        <label>Blur ${range('bgBlur', c.bgBlur || 0, 0, 30)}</label>
        <label>Brightness ${range('bgBrightness', c.bgBrightness || 100, 30, 150)}</label>
        <label>Darken ${range('bgDim', c.bgDim || 0, 0, 90)}</label>
        <label>Tint color<input type="color" data-k="bgTint" value="${c.bgTint || '#000000'}"></label>
        <label>Tint amount ${range('bgTintAmount', c.bgTintAmount || 0, 0, 80)}</label>

        <h5>Projection: span, edge blend, mask</h5>
        <label>Span across${sel('spanCount', c.spanCount || 1, [[1, '1 screen'], [2, '2 projectors'], [3, '3 projectors'], [4, '4 projectors']])}</label>
        <label>This is screen${sel('spanIndex', c.spanIndex || 1, [[1, '1 (left)'], [2, '2'], [3, '3'], [4, '4']])}</label>
        <label>Overlap / blend ${range('spanOverlap', c.spanOverlap || 0, 0, 40)}</label>
        <label>Blend curve ${range('blendGamma', c.blendGamma || 2.2, 1, 3, 0.1)}</label>
        <label>Mask top % ${range('maskTop', c.maskTop || 0, 0, 45)}</label>
        <label>Mask bottom % ${range('maskBottom', c.maskBottom || 0, 0, 45)}</label>
        <label>Mask left % ${range('maskLeft', c.maskLeft || 0, 0, 45)}</label>
        <label>Mask right % ${range('maskRight', c.maskRight || 0, 0, 45)}</label>
        <label>Rounded corners ${range('maskRadius', c.maskRadius || 0, 0, 50)}</label>
        ${check('testPattern', c.testPattern, 'Test pattern (line up projectors)')}

        <h5>Media</h5>
        ${check('showMedia', c.showMedia !== false, 'Show full-screen media')}
        ${check('mediaAudio', c.mediaAudio, 'Play video sound')}
        ${check('showProps', c.showProps !== false, 'Show props')}
        ${check('showMessages', c.showMessages !== false, 'Show messages')}
        ${desktop ? `<div class="ndi"><label class="switch"><input type="checkbox" data-act="ndi" ${ndiOn.has(c.id) ? 'checked' : ''}><span></span></label> NDI output <span class="muted small">“F8 Ch ${c.id}”</span></div>` : ''}
        <div class="actions">
          <button class="btn sm" data-act="screen">Open on screen…</button>
          <button class="btn ghost sm" data-act="copy">Copy URL (OBS)</button>
          <button class="btn ghost sm" data-act="identify">Identify</button>
          <button class="btn ghost sm" data-act="reset-bg">Reset background</button>
        </div>
      </div>
    </div>`;
  }).join('');
  $$('#channels select[data-val]').forEach((s) => { s.value = s.dataset.val; });
}

function updateChannel(id, patch) {
  const channels = S.channels.map((c) => (c.id === id ? { ...c, ...patch } : c));
  S.channels = channels; // optimistic
  push({ channels });
}

const outputUrl = (id) => `${location.origin}/output.html?ch=${id}`;
const ndiOn = new Set();

function chooseScreen(id, screens) {
  return new Promise((resolve) => {
    $('#screenTitle').textContent = `Open channel ${id} on…`;
    $('#screenList').innerHTML = screens.map((s, i) => `<button data-i="${i}"><b>${esc(s.label)}</b><small>${s.width}×${s.height}${s.primary ? ' · this screen' : ''}</small></button>`).join('')
      + '<button data-i="-1"><b>Window</b><small>A normal window you can drag anywhere</small></button>';
    const dlg = $('#screenDialog');
    const done = (v) => { dlg.close(); resolve(v); };
    $('#screenList').onclick = (e) => { const b = e.target.closest('button'); if (b) done(Number(b.dataset.i)); };
    $('#screenClose').onclick = () => done(null);
    dlg.showModal();
  });
}

async function openChannel(id, pickScreen = false) {
  if (desktop) {
    const displays = await desktop.displays();
    if (!pickScreen) return desktop.openOutput(id, null);
    const i = await chooseScreen(id, displays);
    if (i === null) return;
    return desktop.openOutput(id, i >= 0 ? displays[i].id : null);
  }
  let features = 'popup,width=960,height=540';
  if (pickScreen && 'getScreenDetails' in window) {
    try {
      const sd = await window.getScreenDetails();
      const screens = sd.screens.map((s, i) => ({ label: s.label || `Screen ${i + 1}`, width: s.width, height: s.height, primary: s.isPrimary, s }));
      const i = await chooseScreen(id, screens);
      if (i === null) return;
      const s = screens[i]?.s;
      if (s) features = `popup,fullscreen,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`;
    } catch { toast('Screen access was not allowed — opening a normal window'); }
  } else if (pickScreen) toast('This browser cannot pick screens — drag the window to the projector and double-click it');
  if (!window.open(outputUrl(id), `f8-ch-${id}`, features)) toast('Pop-up blocked — allow pop-ups for this site', true);
}

// ---------------------------------------------------------------- media library
async function loadMedia() {
  mediaList = await api('/api/media').catch(() => []);
  const chOpts = S ? S.channels.map((c) => `<option value="${c.id}">Ch ${c.id} · ${esc(c.name)}</option>`).join('') : '';
  $('#mediaGrid').innerHTML = mediaList.length ? mediaList.map((m, i) => `
    <div class="media-item" data-i="${i}">
      <div class="thumb ${m.type === 'audio' ? 'audio' : ''}" ${m.type === 'image' ? `style="background-image:url('${esc(m.url)}')"` : ''}>${m.type === 'video' ? `<video src="${esc(m.url)}#t=1" preload="metadata" muted></video>` : m.type === 'audio' ? '<div class="note">♪</div>' : ''}<span class="kind">${m.type}</span></div>
      <div class="name" title="${esc(m.name)}">${esc(m.name)}</div>
      ${m.type === 'audio' ? `<div class="acts"><button class="btn sm" data-act="play">▶ Play</button><button class="btn ghost sm" data-act="del" title="Delete">✕</button></div>` : `<div class="acts">
        <button class="btn live sm" data-act="live">Live</button>
        <button class="btn ghost sm" data-act="loop" title="Add to the announcements loop">⟳</button>
        <button class="btn ghost sm" data-act="preview">Preview</button>
        <button class="btn ghost sm" data-act="service">＋</button>
        <button class="btn ghost sm" data-act="del" title="Delete">✕</button>
        <select data-act="bg"><option value="">Set as background…</option><option value="all">All full-screen channels</option>${chOpts}</select>
      </div>`}
    </div>`).join('') : '<p class="muted small">No media yet.</p>';
  if (S) renderChannels();
  tools.refreshProps();
  songtl.render();
}

// ---- live video input
let cameras = [];
const cameraItem = (cam) => ({ kind: 'camera', name: cam.label, device: cam.label, fit: 'cover', mirror: $('#camMirror').checked });
async function findCameras() {
  $('#camList').innerHTML = '<p class="muted small">Looking for cameras…</p>';
  try { cameras = await listCameras(); }
  catch (e) { cameras = []; toast(`Cameras: ${e.message}`, true); }
  const chOpts = S.channels.map((c) => `<option value="${c.id}">Ch ${c.id} · ${esc(c.name)}</option>`).join('');
  $('#camList').innerHTML = cameras.map((c, i) => `<div class="cam-row" data-i="${i}"><b>🎥 ${esc(c.label)}</b>
      <button class="btn live sm" data-act="live">Live</button><button class="btn ghost sm" data-act="preview">Preview</button><button class="btn ghost sm" data-act="service">＋</button>
      <select data-act="bg"><option value="">Use as background…</option><option value="all">All full-screen channels</option>${chOpts}</select></div>`).join('')
    || '<p class="muted small">No cameras found. Plug in a camera or capture card and allow camera access.</p>';
}

const mediaItem = (m) => ({ kind: 'media', url: m.url, mediaType: m.type, name: m.name, fit: $('#mediaFit').value, loop: true });

async function uploadFiles(files) {
  for (const f of files) {
    $('#uploadStatus').textContent = `Uploading ${f.name}…`;
    try { await api('/api/media', { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name) }, body: f }); }
    catch (e) { toast(`${f.name}: ${e.message}`, true); }
  }
  $('#uploadStatus').textContent = '';
  loadMedia();
}

// ---------------------------------------------------------------- service
function renderService() {
  if (!S) return;
  $('#service').innerHTML = S.service.length ? S.service.map((it, i) => `
    <li class="svc ${control.sameItem(it, S.live) ? 'live' : ''}" data-i="${i}">
      <span class="idx">${i + 1}</span>
      <div class="meta" data-act="preview"><b>${esc(it.kind === 'text' ? it.title : it.kind === 'media' ? it.name : it.kind === 'song' ? `🎵 ${it.title}` : (it.heading ? it.heading + ' — ' : '') + formatRef(it.ref))}</b><div class="txt">${esc(it.kind === 'text' ? it.body || 'Text slide' : it.kind === 'media' ? (it.mediaType === 'video' ? 'Video' : 'Image') : it.kind === 'song' ? `Song · ${it.slides?.length || 0} slides${it.artist ? ' · ' + it.artist : ''}` : 'Scripture')}</div>${it.notes ? `<div class="notes">📝 ${esc(it.notes)}</div>` : ''}</div>
      <button class="btn live sm" data-act="live">Live</button>
      ${it.timeline?.audio ? '<button class="x" data-act="tl" title="Go live and play its timeline track">♪</button>' : ''}
      <button class="x" data-act="notes" title="Stage notes (shown only on the stage display)">✎</button>
      <button class="x" data-act="loop" title="Add to the announcements loop">⟳</button>
      <button class="x" data-act="up" title="Move up">↑</button>
      <button class="x" data-act="del" title="Remove">✕</button>
    </li>`).join('') : '<li class="muted small">Your service is empty. Add verses with “＋ Service”, or let AI build one.</li>';
}
const setService = (service) => push({ service });
async function serviceStep(d) {
  const item = await control.serviceStep(S, d).catch((e) => toast(e.message, true));
  if (item) { follow(item); setPreview(item); }
}

// ---------------------------------------------------------------- songs & lyrics
let song = null;          // song open in the editor: { id?, title, artist, ccli, lyrics, source }
let songSlides = [];      // its slides at the current lines-per-slide
let songTimer = null;

const songItem = (sg, page = 0) => ({ kind: 'song', songId: sg.id || '', title: sg.title || 'Untitled', artist: sg.artist || '', ccli: sg.ccli || '',
  slides: slidesFor(arrangeSections(parseLyrics(sg.lyrics), sg.arrangement), S.songLines || 4), page, ...(sg.timeline?.audio ? { timeline: sg.timeline } : {}) });

function readSongForm() {
  if (!song) return null;
  Object.assign(song, { title: $('#sgTitle').value.trim(), artist: $('#sgArtist').value.trim(), ccli: $('#sgCcli').value.trim(), lyrics: $('#sgLyrics').value,
    arrangement: $('#sgArr').value.split(',').map((x) => x.trim()).filter(Boolean) });
  return song;
}

function openSong(sg) {
  song = { ...sg };
  $('#songEditor').hidden = false;
  $('#songEdTitle').textContent = song.id ? 'Song' : 'New song';
  $('#sgTitle').value = song.title || ''; $('#sgArtist').value = song.artist || ''; $('#sgCcli').value = song.ccli || '';
  $('#sgLyrics').value = song.lyrics || '';
  $('#sgArr').value = (song.arrangement || []).join(', ');
  $('#sgDelete').hidden = !song.id || String(song.id).startsWith('pd-');
  $('#sgSource').textContent = song.source && !['library'].includes(song.source)
    ? `Source: ${song.source}. Check the words before projecting — online lyrics can contain mistakes. Your church needs a licence (e.g. CCLI) to project copyrighted songs.` : '';
  renderSongSlides();
  $('#songEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSongSlides() {
  if (!song || !S) return;
  readSongForm();
  const parsed = parseLyrics(song.lyrics);
  songSlides = slidesFor(arrangeSections(parsed, song.arrangement), S.songLines || 4);
  $('#sgGroups').innerHTML = sectionNames(parsed).map((n) => `<button type="button" data-g="${esc(n)}" style="--gc:${groupColor(n)}">${esc(n)}</button>`).join('');
  $('#sgCount').textContent = `${songSlides.length} slide${songSlides.length === 1 ? '' : 's'}`;
  $('#sgSlides').innerHTML = songSlides.map((sl, i) => `<div class="song-slide" data-i="${i}" style="--gc:${groupColor(sl.label)}"><div class="lbl">${esc(sl.label)}${songtl.cueBadge(i)}</div>${sl.lines.map(esc).join('<br>')}</div>`).join('')
    || '<p class="muted small">Paste or type the lyrics above.</p>';
  markLiveSongSlide();
  songtl.render();
}

function markLiveSongSlide() {
  const live = S?.live;
  $$('#sgSlides .song-slide').forEach((el) => el.classList.toggle('live',
    !!(live?.kind === 'song' && song && live.title === (song.title || 'Untitled') && (live.songId || '') === (song.id || '') && Number(el.dataset.i) === (live.page || 0))));
}

async function searchSongs() {
  const q = $('#songQ').value.trim();
  const box = $('#songResults');
  const hit = (r, online) => `<div class="song-hit" data-${online ? 'online' : 'id'}="${esc(online ? `${r.provider}::${r.id}` : r.id)}">
      <div class="meta"><b>${esc(r.title)}</b><small>${esc([r.artist, r.album].filter(Boolean).join(' · ') || r.preview || '')}</small></div>
      <span class="src ${online ? 'online' : ''}">${online ? 'online' : r.source === 'built-in' ? 'hymn' : 'library'}</span></div>`;
  let local = [];
  try { local = await api(`/api/songs?q=${encodeURIComponent(q)}`); } catch (e) { toast(e.message, true); }
  box.innerHTML = `<h4>Your library</h4>${local.map((r) => hit(r, false)).join('') || '<p class="muted small">No saved songs match.</p>'}`
    + (q && $('#songOnline').checked ? '<h4>Online</h4><div id="songOnlineList"><p class="muted small">Searching online lyrics…</p></div>' : '');
  if (!q || !$('#songOnline').checked) return;
  try {
    const online = await api(`/api/lyrics/search?q=${encodeURIComponent(q)}`);
    if ($('#songQ').value.trim() !== q) return;
    $('#songOnlineList').innerHTML = online.map((r) => hit(r, true)).join('') || '<p class="muted small">Nothing found online. Try the song title plus the artist, or paste the lyrics with “＋ New song”.</p>';
  } catch (e) { $('#songOnlineList').innerHTML = `<p class="muted small">Online lyrics are unavailable right now (${esc(e.message)}).</p>`; }
}

// ---- import from other presentation software
let importFound = [];
async function importSongFilesFromUser(files) {
  if (!files.length) return;
  const batch = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  $('#importReview').hidden = true; $('#importErrors').innerHTML = '';
  try {
    let done = 0;
    for (const f of files) {
      $('#importStatus').textContent = `Uploading ${f.name} (${++done}/${files.length})…`;
      await api(`/api/songs/upload?batch=${batch}`, { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name) }, body: f });
    }
    $('#importStatus').textContent = 'Reading songs…';
    const r = await postJson(`/api/songs/import?batch=${batch}`, {});
    showImportReview(r.songs, r.errors);
  } catch (e) { $('#importStatus').textContent = `Import failed: ${e.message}`; }
}

function showImportReview(found, errors = []) {
    importFound = found;
    $('#importErrors').innerHTML = errors.map((e) => `<div class="import-err">✗ ${esc(e.file.replace(/^\d+~/, ''))}: ${esc(e.error)}</div>`).join('');
    const dups = importFound.filter((x) => x.duplicate).length;
    $('#importStatus').textContent = importFound.length
      ? `Found ${importFound.length} song${importFound.length === 1 ? '' : 's'}${dups ? ` (${dups} already in your library)` : ''}. Untick any you don't want, then Import.`
      : 'No songs found in those files.';
    $('#importList').innerHTML = importFound.map((x, i) => `<label class="import-row"><input type="checkbox" data-i="${i}" ${x.duplicate ? '' : 'checked'}>
      <div class="meta"><b>${esc(x.title)}</b><small>${esc([x.artist, x.ccli ? `CCLI ${x.ccli}` : '', `${x.sections} section${x.sections === 1 ? "" : "s"}`, x.source].filter(Boolean).join(' · '))}</small></div>
      ${x.duplicate ? '<span class="dup">already saved</span>' : ''}</label>`).join('');
    $('#importReview').hidden = !importFound.length;
    updateImportCount();
}
function updateImportCount() {
  const n = $$('#importList input:checked').length;
  $('#importCount').textContent = `${n} selected`;
  $('#importGo').textContent = `Import ${n} song${n === 1 ? '' : 's'}`;
  $('#importGo').disabled = !n;
}

function wireImport() {
  $('#songImport').onclick = () => { $('#importDialog').showModal(); };
  $('#importClose').onclick = () => $('#importDialog').close();
  $('#importFiles').onchange = (e) => { importSongFilesFromUser([...e.target.files]); e.target.value = ''; };
  const dz = $('#importDrop');
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); importSongFilesFromUser([...e.dataTransfer.files]); };
  $('#importList').onchange = updateImportCount;
  $('#pasteRead').onclick = () => {
    const found = splitPastedSongs($('#pasteSongs').value);
    showImportReview(found, found.length ? [] : [{ file: 'Pasted text', error: 'No songs found — start each song with “# Title” or separate songs with a line of ---' }]);
  };
  $('#importAll').onchange = (e) => { $$('#importList input').forEach((c) => { c.checked = e.target.checked; }); updateImportCount(); };
  $('#importGo').onclick = async () => {
    const chosen = $$('#importList input:checked').map((c) => importFound[Number(c.dataset.i)]);
    $('#importGo').disabled = true; $('#importStatus').textContent = 'Saving…';
    try {
      const r = await postJson('/api/songs/bulk', { songs: chosen, skipDuplicates: $('#importSkipDup').checked });
      toast(`Imported ${r.added} song${r.added === 1 ? '' : 's'}${r.skipped ? ` · skipped ${r.skipped}` : ''}`);
      $('#importDialog').close(); $('#importReview').hidden = true; $('#importStatus').textContent = ''; $('#importErrors').innerHTML = '';
      searchSongs();
    } catch (e) { $('#importStatus').textContent = e.message; $('#importGo').disabled = false; }
  };
}

function wireSongs() {
  $('#sgGroups').onclick = (e) => { const b = e.target.closest('[data-g]'); if (!b) return; const cur = $('#sgArr').value.trim(); $('#sgArr').value = cur ? `${cur}, ${b.dataset.g}` : b.dataset.g; renderSongSlides(); };
  $('#sgArr').oninput = () => { clearTimeout(songTimer); songTimer = setTimeout(renderSongSlides, 250); };
  wireImport();
  $('#songSearchForm').onsubmit = (e) => { e.preventDefault(); searchSongs(); };
  let t; $('#songQ').oninput = () => { clearTimeout(t); t = setTimeout(() => { // library is instant, online waits for Enter or a pause
    if ($('#songQ').value.trim().length >= 3) searchSongs(); }, 600); };
  $('#songNew').onclick = () => openSong({ title: '', artist: '', ccli: '', lyrics: '', source: 'library' });
  $('#songClose').onclick = () => { $('#songEditor').hidden = true; song = null; };
  $('#songResults').onclick = async (e) => {
    const el = e.target.closest('.song-hit'); if (!el) return;
    try {
      if (el.dataset.id) return openSong(await api(`/api/songs/${encodeURIComponent(el.dataset.id)}`));
      const [provider, ...rest] = el.dataset.online.split('::');
      el.querySelector('small').textContent = 'Importing lyrics…';
      const got = await api(`/api/lyrics/get?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(rest.join('::'))}`);
      if (!String(got.lyrics || '').trim()) return toast('That result has no lyrics text — try another one', true);
      openSong({ title: got.title, artist: got.artist, ccli: '', source: got.source, lyrics: lyricsToText(parseLyrics(got.lyrics)) });
      toast('Lyrics imported — check them, then Save to library');
    } catch (er) { toast(er.message, true); }
  };
  $('#sgLyrics').oninput = () => { clearTimeout(songTimer); songTimer = setTimeout(renderSongSlides, 250); };
  ['#sgTitle', '#sgArtist', '#sgCcli'].forEach((id) => { $(id).oninput = () => readSongForm(); });
  $('#songLines').oninput = (e) => { $('#songLinesLabel').textContent = e.target.value; };
  $('#songLines').onchange = (e) => push({ songLines: Number(e.target.value) });
  $('#sgTidy').onclick = () => { $('#sgLyrics').value = lyricsToText(parseLyrics($('#sgLyrics').value)); renderSongSlides(); };
  $('#sgSave').onclick = async () => {
    const sg = readSongForm();
    try {
      const saved = await postJson('/api/songs', sg);
      song.id = saved.id; song.source = saved.source; $('#songEdTitle').textContent = 'Song'; $('#sgDelete').hidden = false;
      toast(`Saved “${saved.title}”`); if ($('#songQ').value.trim()) searchSongs();
    } catch (e) { toast(e.message, true); }
  };
  $('#sgDelete').onclick = async () => {
    if (!song?.id || !confirm(`Delete “${song.title}” from the library?`)) return;
    await postJson('/api/songs/delete', { id: song.id }).catch((e) => toast(e.message, true));
    $('#songEditor').hidden = true; song = null; searchSongs();
  };
  $('#sgService').onclick = () => { const sg = readSongForm(); if (!songSlides.length) return toast('Add lyrics first', true); setService([...S.service, songItem(sg)]); toast('Song added to service'); };
  $('#sgLive').onclick = () => { const sg = readSongForm(); if (!songSlides.length) return; const it = songItem(sg); goLive(it); setPreview(it); };
  $('#sgSlides').onclick = (e) => { const el = e.target.closest('.song-slide'); if (el) setPreview(songItem(readSongForm(), Number(el.dataset.i))); };
  $('#sgSlides').ondblclick = (e) => {
    const el = e.target.closest('.song-slide'); if (!el) return;
    const it = songItem(readSongForm(), Number(el.dataset.i));
    control.goLive(S, it, { page: it.page }).catch((er) => toast(er.message, true)); setPreview(it);
  };
  searchSongs();
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
  if (item.kind === 'media' || item.kind === 'song') return;
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

const SPEECH_LANGS = ['en-US', 'en-GB', 'en-NG', 'en-GH', 'en-IN', 'ak-GH', 'fat-GH', 'gaa-GH', 'ee-GH', 'dag-GH', 'gur-GH', 'kus-GH', 'ki-KE', 'luo-KE', 'mer-KE', 'es-ES', 'es-MX', 'pt-BR', 'pt-PT', 'fr-FR', 'de-DE', 'it-IT', 'nl-NL', 'ru-RU', 'uk-UA', 'pl-PL', 'ro-RO', 'hu-HU', 'cs-CZ', 'el-GR', 'tr-TR', 'ar-SA', 'he-IL', 'fa-IR', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'ml-IN', 'ur-PK', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'vi-VN', 'th-TH', 'id-ID', 'ms-MY', 'fil-PH', 'sw-KE', 'am-ET', 'yo-NG', 'ig-NG', 'ha-NG', 'zu-ZA', 'af-ZA', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI'];
const KHAYA_LANGS = ['ak', 'tw', 'fat', 'gaa', 'ee', 'dag', 'gur', 'kus', 'ki', 'luo', 'mer'];
const LANG_NAMES = { 'ak-GH': 'Akan · Twi (Asante, Akuapem)', 'fat-GH': 'Akan · Fante', 'gaa-GH': 'Ga', 'ee-GH': 'Ewe', 'dag-GH': 'Dagbani',
  'gur-GH': 'Gurene (Frafra)', 'kus-GH': 'Kusaal', 'ki-KE': 'Kikuyu', 'luo-KE': 'Luo (Dholuo)', 'mer-KE': 'Kimeru' };
const langLabel = (l) => { if (LANG_NAMES[l]) return `${LANG_NAMES[l]} · ${l}`; try { return `${new Intl.DisplayNames([l], { type: 'language' }).of(l)} · ${l}`; } catch { return l; } };
$('#speechLang').innerHTML = SPEECH_LANGS.map((l) => `<option value="${l}">${esc(langLabel(l))}</option>`).join('');
$('#speechLang').value = store.get('speechLang', 'en-US');

let phraseRec = null;
const engine = () => {
  const e = $('#speechEngine').value;
  if (e !== 'auto') return e;
  return KHAYA_LANGS.includes(speechLang().split('-')[0]) ? 'khaya' : 'browser';
};
function updateEngineNote() {
  const e = engine(); const lang = speechLang().split('-')[0];
  let note = e === 'khaya' ? 'Phrases are sent to Khaya (GhanaNLP) through this server; each one appears after the speaker pauses.' : 'Uses the browser’s own recognition (Chrome or Edge, needs internet).';
  if (e === 'khaya' && !info.khaya) note = '⚠ Khaya is not set up on the server yet — start it with KHAYA_API_KEY (see README).';
  if (e === 'browser' && KHAYA_LANGS.includes(lang)) note = '⚠ Browsers can’t hear this language well — choose Khaya.';
  $('#engineNote').textContent = note;
  $('#cwLang').textContent = langLabel(speechLang());
  loadCustomWordsForm();
}

function setMic(on) {
  if (on && engine() === 'khaya') return setPhraseMic(true);
  if (!on && phraseRec) return setPhraseMic(false);
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
      // While words are still arriving, ignore the last one: "John 3:1…" may still become "John 3:16".
      const settled = /^(zh|ja)/.test(speechLang()) ? interim.replace(/[\d零〇一二两三四五六七八九十百]+$/u, '') : interim.trim().split(/\s+/).slice(0, -1).join(' ');
      if (settled) detectLocal(settled, true);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') { toast('Microphone permission denied', true); setMic(false); }
      if (e.error === 'network' && desktop) { toast('Listening needs Chrome or Edge — open this console in your browser (Help menu)', true); setMic(false); }
    };
    rec.onend = () => { if (listening) try { rec.start(); } catch {} }; // keep going through pauses
    try { rec.start(); } catch {}
    toast('Listening… say a reference like “John 3:16”');
  } else if (rec) { rec.onend = null; rec.stop(); rec = null; }
}

async function setPhraseMic(on) {
  if (on) {
    if (!info.khaya) return toast('Khaya is not set up — start the server with KHAYA_API_KEY', true);
    phraseRec = new PhraseRecognizer({
      lang: speechLang(),
      onText: (t) => { onSpeech(t); renderTranscript(); },
      onLevel: (lvl, speaking) => { const m = $('#micLevel'); m.style.width = `${Math.round(lvl * 100)}%`; m.classList.toggle('speaking', speaking); },
      onError: (m) => toast(`Speech: ${m}`, true),
    });
    try { await phraseRec.start(); }
    catch (e) { phraseRec = null; return toast(`Microphone: ${e.message}`, true); }
    listening = true;
    toast('Listening with Khaya… references appear after each pause');
  } else { phraseRec?.stop(); phraseRec = null; listening = false; $('#micLevel').style.width = '0'; }
  $('#micBtn').classList.toggle('on', listening);
  $('#micBtn2').textContent = listening ? 'Stop listening' : 'Start listening';
}

// ---------------------------------------------------------------- custom words (per language, shared on the server)
function loadCustomWordsForm() {
  if (!S) return;
  const c = (S.customWords || {})[langKey(speechLang())] || {};
  $('#cwBooks').value = Object.entries(c.books || {}).map(([n, id]) => `${n} = ${bookById(id)?.name || id}`).join('\n');
  $('#cwNumbers').value = Object.entries(c.numbers || {}).map(([w, n]) => `${w} = ${n}`).join('\n');
  $('#cwChapter').value = (c.chapter || []).join(', ');
  $('#cwVerse').value = (c.verse || []).join(', ');
  $('#cwRange').value = (c.range || []).join(', ');
  $('#cwNext').value = (c.next || []).join(', ');
}
function readCustomWordsForm() {
  const list = (id) => $(id).value.split(',').map((x) => x.trim()).filter(Boolean);
  const pairs = (id) => $(id).value.split('\n').map((l) => l.split('=').map((x) => x.trim())).filter(([a, b]) => a && b);
  const books = {}; const bad = [];
  for (const [name, target] of pairs('#cwBooks')) {
    const id = /^\d+$/.test(target) ? Number(target) : (BOOKS.find((b) => b.name.toLowerCase() === target.toLowerCase())?.id || parseReferences(`${target} 1`, undefined, 'en')[0]?.book);
    if (id && bookById(id)) books[name] = id; else bad.push(target);
  }
  const numbers = {};
  for (const [w, n] of pairs('#cwNumbers')) if (Number(n) > 0) numbers[w] = Number(n);
  return { entry: { books, numbers, chapter: list('#cwChapter'), verse: list('#cwVerse'), range: list('#cwRange'), next: list('#cwNext') }, bad };
}
function tryCustomWords() {
  const text = $('#cwTry').value.trim();
  if (!text) return void ($('#cwResult').textContent = '');
  const refs = parseReferences(text, speechNames, speechLang());
  const f = refs.length ? null : parseFollowUp(text, speechLang());
  $('#cwResult').textContent = refs.length ? `✓ ${refs.map((r) => formatRef(r)).join(' ; ')}`
    : f ? `✓ follow-up: ${f.kind}${f.verseStart ? ` ${f.chapter ? 'chapter ' + f.chapter + ' ' : ''}verse ${f.verseStart}${f.verseEnd !== f.verseStart ? '–' + f.verseEnd : ''}` : ''}` : '✗ no reference recognised';
}

function renderTranscript(interim = '') {
  const tail = transcript.slice(-600);
  $('#transcript').innerHTML = esc(tail) + (interim ? ` <span class="interim">${esc(interim)}</span>` : '') || '<span class="muted">Transcript appears here…</span>';
  $('#transcript').scrollTop = 1e9;
}

let pendingTail = '';   // end of the previous phrase, in case a reference was split across two
let contextRef = null;  // last passage heard, for "verse 17" / "next verse"

function onSpeech(text) {
  transcript += ' ' + text.trim();
  const chunk = `${pendingTail} ${text}`;
  const found = detectLocal(chunk) || detectFollowUp(text);
  pendingTail = found ? '' : text.split(/\s+/).slice(-6).join(' ');
  if (info.ai && $('#aiDetect').checked) {
    clearTimeout(aiTimer);
    aiTimer = setTimeout(detectAI, 1200);
  }
}

const speechLang = () => $('#speechLang').value || 'en-US';

// Book names as the preacher says them: from Bibles in the speech language, plus the current translation.
async function loadSpeechNames() {
  const lang = speechLang().split('-')[0];
  const names = { ...extraNames };
  try {
    const langs = await translations();
    const ids = langs.filter((l) => langCode(l.language).split('-')[0] === lang).flatMap((l) => l.translations.map((t) => t.id)).slice(0, 4);
    for (const id of ids) for (const b of await books(id).catch(() => [])) if (b.id <= 66) names[b.name] = b.id;
  } catch { /* offline: built-in names still work */ }
  speechNames = names;
}

function detectLocal(text, interim = false) {
  const refs = parseReferences(text, speechNames, speechLang());
  let found = false;
  for (const r of refs) {
    if (interim && !r.verseStart) continue; // wait for the verse number
    found = true;
    addDetection({ ...r, verseStart: r.verseStart || 1, verseEnd: r.verseEnd || r.verseStart || 1, source: 'speech', confidence: r.verseStart ? 1 : 0.5, chapterOnly: !r.verseStart });
  }
  return found;
}

// Follow-ups that only make sense next to the passage already in use:
// "verse 17", "verses 18 to 20", "chapter 4 verse 2", "next verse", "previous verse".
function detectFollowUp(text) {
  const ctx = S.live?.kind === 'scripture' ? S.live.ref : contextRef;
  if (!ctx) return false;
  const f = parseFollowUp(text, speechLang());
  if (!f) return false;
  const end = ctx.verseEnd || ctx.verseStart || 0, start = ctx.verseStart || 1;
  if (f.kind === 'next') addDetection({ book: ctx.book, chapter: ctx.chapter, verseStart: end + 1, verseEnd: end + 1, source: 'speech', confidence: 0.9, force: true });
  else if (f.kind === 'prev') { if (start <= 1) return true; addDetection({ book: ctx.book, chapter: ctx.chapter, verseStart: start - 1, verseEnd: start - 1, source: 'speech', confidence: 0.9, force: true }); }
  else if (f.kind === 'chapter') { if (f.chapter > bookById(ctx.book).chapters) return false; addDetection({ book: ctx.book, chapter: f.chapter, verseStart: f.verseStart, verseEnd: f.verseEnd, source: 'speech', confidence: 0.9 }); }
  else addDetection({ book: ctx.book, chapter: ctx.chapter, verseStart: f.verseStart, verseEnd: f.verseEnd, source: 'speech', confidence: 0.9 });
  return true;
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
  contextRef = { book: d.book, chapter: d.chapter, verseStart: d.verseStart, verseEnd: d.verseEnd };
  const key = refKey(d) + (d.chapterOnly ? '*' : ''); // "Psalm 23" then "verse 1" are different events
  const now = Date.now();
  // Same passage within 45s is a repeat; a fuller range replaces a partial one.
  for (const [k, t] of recent) if (now - t > 45000) recent.delete(k);
  if (recent.has(key) && !d.force) return;
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
  // Don't shrink the screen when the preacher mentions a verse that is already showing.
  const lr = S.live?.kind === 'scripture' ? S.live.ref : null;
  const alreadyShowing = lr && lr.book === d.book && lr.chapter === d.chapter && d.verseStart >= lr.verseStart && d.verseEnd <= (lr.verseEnd || lr.verseStart);
  if ($('#autoLive').checked && (d.confidence ?? 1) >= 0.75 && !alreadyShowing) {
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
  const setAuto = (on) => { $('#autoLive').checked = on; $('#autoBtn').classList.toggle('on', on); store.set('autoLive', on); };
  setAuto(store.get('autoLive', false));
  $('#autoLive').onchange = (e) => setAuto(e.target.checked);
  $('#autoBtn').onclick = () => { setAuto(!$('#autoLive').checked); toast($('#autoLive').checked ? 'AUTO on — heard scripture goes straight to the screens' : 'AUTO off — heard scripture waits in the Detected list'); };
  window.__f8Hear = onSpeech; // used by tests to simulate the preacher

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
  $('#speechLang').onchange = (e) => { store.set('speechLang', e.target.value); store.set('speechLangSet', true); loadSpeechNames(); updateEngineNote(); if (listening) { setMic(false); setTimeout(() => setMic(true), 100); } };
  $('#speechEngine').value = store.get('speechEngine', 'auto');
  $('#speechEngine').onchange = (e) => { store.set('speechEngine', e.target.value); updateEngineNote(); if (listening) { setMic(false); setTimeout(() => setMic(true), 100); } };
  $('#cwToggle').onclick = () => { $('#cwBody').hidden = !$('#cwBody').hidden; };
  $('#cwTry').oninput = tryCustomWords;
  $('#cwSave').onclick = async () => {
    const { entry, bad } = readCustomWordsForm();
    const all = { ...(S.customWords || {}), [langKey(speechLang())]: entry };
    await push({ customWords: all });
    $('#cwStatus').textContent = bad.length ? `Saved. Unknown books: ${bad.join(', ')}` : 'Saved ✓';
    setTimeout(tryCustomWords, 300);
  };
  $('#clearDetections').onclick = () => { $('#detections').innerHTML = ''; recent.clear(); transcript = ''; pendingTail = ''; contextRef = null; lastAiLen = 0; renderTranscript(); };
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
    if (act === 'identify') return new BroadcastChannel('f8').postMessage({ type: 'identify' });
    if (act === 'reset-bg') return updateChannel(id, { background: '', bgBlur: 0, bgDim: 0, bgBrightness: 100, bgTintAmount: 0, bgFit: 'cover' });
    if (e.target.closest('[data-toggle]') && !e.target.closest('label,button')) {
      ch.classList.toggle('open');
      ch.classList.contains('open') ? openCh.add(id) : openCh.delete(id);
      store.set('openCh', [...openCh]);
    }
  });
  $('#channels').addEventListener('change', (e) => {
    const id = Number(e.target.closest('.ch')?.dataset.id);
    if (e.target.dataset.act === 'ndi') {
      e.target.checked ? ndiOn.add(id) : ndiOn.delete(id);
      desktop.ndi(id, e.target.checked).then((r) => r?.error && (toast(r.error, true), ndiOn.delete(id), renderChannels()));
      return;
    }
    const k = e.target.dataset.k; if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
    updateChannel(id, { [k]: v });
    if (Number($('#liveMonitorCh').value) === id && preview) setPreview(preview);
  });
  $('#channels').addEventListener('input', (e) => { // live preview of sliders while dragging
    if (e.target.type !== 'range') return;
    const ch = S.channels.find((c) => c.id === Number(e.target.closest('.ch').dataset.id));
    if (ch) { ch[e.target.dataset.k] = Number(e.target.value); if (preview && Number($('#liveMonitorCh').value) === ch.id) setPreview(preview); }
  });
  $('#identifyAll').onclick = () => new BroadcastChannel('f8').postMessage({ type: 'identify' });
  $('#openAll').onclick = () => S.channels.filter((c) => c.enabled).forEach((c) => openChannel(c.id));
  $('#liveMonitorCh').onchange = (e) => { store.set('monitorCh', Number(e.target.value)); $('#liveFrame').src = `/output.html?ch=${e.target.value}&embed`; if (preview) setPreview(preview); };

  // service
  $('#service').addEventListener('click', (e) => {
    const li = e.target.closest('.svc'); if (!li) return;
    const i = Number(li.dataset.i); const item = S.service[i];
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'preview') { setPreview(item); follow(item); }
    if (act === 'live') { goLive(item); setPreview(item); follow(item); }
    if (act === 'del') setService(S.service.filter((_, j) => j !== i));
    if (act === 'up' && i > 0) { const s = [...S.service]; [s[i - 1], s[i]] = [s[i], s[i - 1]]; setService(s); }
    if (act === 'loop') tools.addAnnouncement(item);
    if (act === 'tl') songtl.play(item);
    if (act === 'notes') {
      const notes = prompt('Stage notes for this item (only the stage display shows them):', item.notes || '');
      if (notes !== null) {
        const updated = { ...item, notes: notes.trim() };
        setService(S.service.map((x, j) => (j === i ? updated : x)));
        if (control.sameItem(item, S.live)) push({ live: { ...S.live, notes: updated.notes } });
      }
    }
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

  // live tools
  $('#pgPrev').onclick = () => stepLive(-1);
  $('#pgNext').onclick = () => stepLive(1);
  $('#mPlay').onclick = () => push({ mediaCmd: { id: Date.now(), action: 'toggle' } });
  $('#mRestart').onclick = () => push({ mediaCmd: { id: Date.now(), action: 'restart' } });
  $('#wordStrip').onclick = (e) => { const w = e.target.closest('[data-w]'); if (w) control.toggleHighlight(S, w.dataset.w); };

  // media
  $('#camFind').onclick = findCameras;
  $('#camList').addEventListener('click', (e) => {
    const row = e.target.closest('.cam-row'); const act = e.target.closest('button[data-act]')?.dataset.act; if (!row || !act) return;
    const item = cameraItem(cameras[Number(row.dataset.i)]);
    if (act === 'live') { goLive(item); setPreview(item); }
    if (act === 'preview') setPreview(item);
    if (act === 'service') { setService([...S.service, item]); toast('Camera added to service'); }
  });
  $('#camList').addEventListener('change', (e) => {
    if (e.target.dataset.act !== 'bg' || !e.target.value) return;
    const cam = cameras[Number(e.target.closest('.cam-row').dataset.i)]; const target = e.target.value;
    push({ channels: S.channels.map((c) => ((target === 'all' ? c.mode === 'full' : c.id === Number(target)) ? { ...c, background: `camera:${cam.label}` } : c)) });
    toast('Live video set as background'); e.target.value = '';
  });
  $('#mediaFile').onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ''; };
  const dz = $('#dropZone');
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); uploadFiles([...e.dataTransfer.files]); };
  $('#mediaGrid').addEventListener('click', async (e) => {
    const el = e.target.closest('.media-item'); const act = e.target.closest('button[data-act]')?.dataset.act;
    if (!el || !act) return;
    const m = mediaList[Number(el.dataset.i)]; const item = mediaItem(m);
    if (act === 'live') { goLive(item); setPreview(item); }
    if (act === 'play') tools.playAudio(m);
    if (act === 'loop') tools.addAnnouncement(item);
    if (act === 'preview') setPreview(item);
    if (act === 'service') { setService([...S.service, item]); toast('Added to service'); }
    if (act === 'del' && confirm(`Delete ${m.name}?`)) { await postJson('/api/media/delete', { name: m.name }).catch((er) => toast(er.message, true)); loadMedia(); }
  });
  $('#mediaGrid').addEventListener('change', (e) => {
    if (e.target.dataset.act !== 'bg' || !e.target.value) return;
    const m = mediaList[Number(e.target.closest('.media-item').dataset.i)];
    const target = e.target.value;
    const channels = S.channels.map((c) => (target === 'all' ? c.mode === 'full' : c.id === Number(target)) ? { ...c, background: m.url } : c);
    push({ channels }); toast('Background set'); e.target.value = '';
  });

  // settings
  $('#splitChars').oninput = (e) => { $('#splitLabel').textContent = Number(e.target.value) || 'off —'; };
  $('#splitChars').onchange = (e) => push({ splitChars: Number(e.target.value) });
  $('#logoText').onchange = (e) => push({ logoText: e.target.value });
  $('#ccliLicense').onchange = (e) => push({ ccliLicense: e.target.value.trim() });
  tools.initShowTools({ $, $$, esc, push, toast, postJson, getS: () => S, goLive: (item) => control.goLive(S, item), setPreview, media: () => mediaList });
  songtl.init({ $, $$, esc, toast, push, getS: () => S, getSong: () => song, getSlides: () => songSlides, songItem, media: () => mediaList,
    goLive: (item) => control.goLive(S, item), audio: tools.getAudio, playAudio: tools.playAudio, fadeAudio: tools.fadeAudio,
    nextServiceItem: () => serviceStep(1), onChange: () => renderSongSlides() });
  designer.initDesigner({ $, $$, esc, push, toast, getS: () => S, goLive: (item) => control.goLive(S, item), setPreview, media: () => mediaList, addToService: (item) => setService([...S.service, item]) });
  triggers.initTriggers({ $, $$, esc, push, toast, getS: () => S, fadeAudio: tools.fadeAudio });
  setInterval(() => updateTimers(previewHost, S), 250);
  wireSongs();
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
    if (songtl.isRecording() && (k === 'ArrowRight' || k === ' ' || k === 'Enter')) { e.preventDefault(); songtl.tap(); return; }
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
    else if (/^F[1-6]$/.test(k)) { e.preventDefault(); tools.clearLayer(['all', 'slide', 'media', 'props', 'messages', 'audio'][Number(k.slice(1)) - 1]); }
  });
}

// ---------------------------------------------------------------- boot
(async function boot() {
  wire();
  info = await api('/api/info').catch(() => info);
  $('#aiStatus').textContent = info.ai ? 'AI on' : 'AI off';
  $('#aiStatus').classList.toggle('on', !!info.ai);
  $('#aiStatus').title = info.ai ? `Model: ${info.model}` : 'Set ANTHROPIC_API_KEY on the server to enable AI';
  updateEngineNote();
  if (!info.ai) { $('#aiDetect').checked = false; $('#aiDetect').disabled = true; $('#genBtn').disabled = true; $('#genStatus').textContent = 'AI is off — start the server with ANTHROPIC_API_KEY set.'; }
  const urls = [location.origin, ...(info.lan || [])];
  $('#lanInfo').innerHTML = urls.map((u) => `<div>Console: ${esc(u)}/</div><div>Output N: ${esc(u)}/output.html?ch=N</div>`).join('<br>');
  translations().then(buildTrOptions).then(() => S && renderChannels()).catch(() => {});
  if (info.pinRequired) await postJson('/api/pin', {}).catch(() => {}); // asks for the PIN once
  connect();
  loadMedia();
  if (desktop) desktop.ndiStatus?.().then((ids) => { (ids || []).forEach((i) => ndiOn.add(i)); if (S) renderChannels(); });
})();
