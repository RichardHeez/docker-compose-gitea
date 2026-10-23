// ProPresenter-style show tools for the console: clear layers, timers, messages, props,
// announcements loop, looks, macros and the audio player.
import { formatRef } from './books.js';
import { clearPatch as baseClear, lookPatch as baseLook, macroPatch } from './macros.js';
import { fillTokens, now, resetTimer, startTimer, stopTimer, syncClock, timerOver, timerText } from './timers.js';

let ctx = null;          // { $, $$, esc, push, toast, getS, goLive, setPreview, media }
const uid = () => Math.random().toString(36).slice(2, 9);
// Changes sent but not yet confirmed by the server, so quick successive clicks build on each other
// without touching the console's own copy of the state.
let pending = {};
const S = () => { const s = ctx.getS(); return s ? { ...s, ...pending } : s; };

// ---------------------------------------------------------------- audio (plays on this computer)
const audio = new Audio();
audio.preload = 'auto';
let fadeTimer = null;
export const getAudio = () => audio;
export function playAudio(m, { loop, from } = {}) {
  clearInterval(fadeTimer);
  audio.src = m.url; audio.loop = loop ?? ctx.$('#audioLoop').checked; audio.volume = Number(ctx.$('#audioVol').value);
  if (from) audio.currentTime = from;
  audio.play().catch((e) => ctx.toast(`Audio: ${e.message}`, true));
  ctx.$('#audioTitle').textContent = `♪ ${m.name}`;
}
export function fadeAudio(ms = 2500) {
  if (audio.paused) return;
  clearInterval(fadeTimer);
  const start = audio.volume, t0 = Date.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms);
    audio.volume = start * (1 - k);
    if (k >= 1) { clearInterval(fadeTimer); audio.pause(); audio.volume = Number(ctx.$('#audioVol').value); ctx.$('#audioTitle').textContent = 'Nothing playing'; }
  }, 50);
}

// ---------------------------------------------------------------- clear layers
// Returns a state patch (so macros can combine several actions into one update).
export function clearPatch(kind, s = S()) {
  if (kind === 'all' || kind === 'audio') fadeAudio();
  return baseClear(kind, s);
}
export const clearLayer = (kind) => { const p = clearPatch(kind); if (Object.keys(p).length) ctx.push(p); };

// ---------------------------------------------------------------- timers
const pushTimers = (timers) => ctx.push({ timers });
const updTimer = (id, fn) => pushTimers(S().timers.map((t) => (t.id === id ? fn(t) : t)));
const parseDuration = (v) => { const p = String(v).trim().split(':').map(Number); return p.some(Number.isNaN) ? 0 : p.reduce((a, b) => a * 60 + b, 0); };
const fmtDuration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function renderTimers() {
  const { $, esc } = ctx;
  if ($('#timerList').contains(document.activeElement)) return; // don't rebuild while typing
  $('#timerList').innerHTML = (S().timers || []).map((t) => `
    <div class="timer-row ${t.running ? 'running' : ''}" data-id="${esc(t.id)}">
      <div class="cfg">
        <input data-f="name" value="${esc(t.name)}" style="flex:1;min-width:0">
        <select data-f="mode"><option value="countdown" ${t.mode === 'countdown' ? 'selected' : ''}>Countdown</option><option value="until" ${t.mode === 'until' ? 'selected' : ''}>Until time</option><option value="countup" ${t.mode === 'countup' ? 'selected' : ''}>Count up</option></select>
        ${t.mode === 'countdown' ? `<input data-f="duration" value="${fmtDuration(t.duration || 0)}" style="width:62px" title="minutes:seconds">` : ''}
        ${t.mode === 'until' ? `<input data-f="target" type="time" value="${esc(t.target || '10:00')}" style="width:96px">` : ''}
      </div>
      <div class="tv" data-tv="${esc(t.id)}"></div>
      <div class="acts">
        ${t.mode === 'until' ? '' : `<button class="btn sm" data-a="${t.running ? 'stop' : 'start'}">${t.running ? '⏸ Stop' : '▶ Start'}</button><button class="btn ghost sm" data-a="reset">⟲ Reset</button>`}
        <button class="btn ghost sm" data-a="screen" title="Show full screen on audience screens">⛶ On screen</button>
        <button class="btn ghost sm" data-a="msg" title="Put this timer in the message">✉ In message</button>
        <span class="spacer"></span><button class="btn ghost sm" data-a="del" title="Delete">✕</button>
      </div>
    </div>`).join('') || '<p class="muted small">No timers.</p>';
  tickConsole();
}
export function tickConsole() {
  if (!ctx || !S()) return;
  ctx.$$('[data-tv]').forEach((el) => {
    const t = S().timers.find((x) => x.id === el.dataset.tv);
    el.textContent = t ? timerText(t) : ''; el.classList.toggle('over', !!t && timerOver(t));
  });
  const p = ctx.$('#audioProgress');
  if (p) p.style.width = audio.duration ? `${(audio.currentTime / audio.duration) * 100}%` : '0';
  const tog = ctx.$('#audioToggle'); if (tog) tog.textContent = audio.paused ? '▶' : '⏸';
}

// ---------------------------------------------------------------- message
const recentMsgs = () => { try { return JSON.parse(localStorage.getItem('f8.msgs')) || []; } catch { return []; } };
function renderMessage() {
  const { $, esc } = ctx; const m = S().message || {};
  if (document.activeElement !== $('#msgText')) $('#msgText').value = m.text || '';
  $('#msgStyle').value = m.style || 'lower';
  $('#msgShow').classList.toggle('primary', !!m.visible);
  $('#msgShow').textContent = m.visible ? 'Showing ✓' : 'Show';
  $('#msgRecent').innerHTML = recentMsgs().map((t) => `<button data-t="${esc(t)}">${esc(t.length > 40 ? t.slice(0, 40) + '…' : t)}</button>`).join('');
}
function showMessage(text, style) {
  const t = text.trim(); if (!t) return;
  ctx.push({ message: { text: t, style: style || ctx.$('#msgStyle').value, visible: true } });
  try { localStorage.setItem('f8.msgs', JSON.stringify([t, ...recentMsgs().filter((x) => x !== t)].slice(0, 6))); } catch {}
}

// ---------------------------------------------------------------- props
const POS = { 'top-left': 'Top left', 'top-center': 'Top centre', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right', full: 'Full screen' };
const pushProps = (props) => ctx.push({ props });
function renderProps() {
  const { $, esc } = ctx;
  if ($('#propList').contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text') return;
  const images = ctx.media().filter((m) => m.type !== 'audio');
  $('#propList').innerHTML = (S().props || []).map((p) => `
    <div class="prop-row" data-id="${esc(p.id)}">
      <label class="switch" title="Show"><input type="checkbox" data-f="visible" ${p.visible ? 'checked' : ''}><span></span></label>
      <b>${esc(p.name || (p.kind === 'text' ? p.text : 'Image'))}</b>
      <button class="x" data-a="del" title="Delete">✕</button>
      <div class="cfg">
        ${p.kind === 'text' ? `<input type="text" data-f="text" value="${esc(p.text)}" placeholder="LIVE">`
          : `<select data-f="url"><option value="">Choose image…</option>${images.map((m) => `<option value="${esc(m.url)}" ${m.url === p.url ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`}
        <select data-f="position">${Object.entries(POS).map(([k, v]) => `<option value="${k}" ${k === p.position ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input type="range" data-f="size" min="3" max="60" value="${p.size || 12}" title="Size">
      </div>
    </div>`).join('') || '<p class="muted small">No props yet.</p>';
}

// ---------------------------------------------------------------- announcements
const label = (it) => it.kind === 'media' ? `🖼 ${it.name}` : it.kind === 'text' ? `✎ ${it.title}` : it.kind === 'song' ? `🎵 ${it.title}` : it.kind === 'timer' ? `⏱ ${it.title}` : it.ref ? `📖 ${formatRef(it.ref)}` : 'Slide';
export function addAnnouncement(item) {
  const a = S().announcements || {};
  const { page, pages, highlight, ...clean } = item;
  ctx.push({ announcements: { ...a, items: [...(a.items || []), clean] } });
  ctx.toast('Added to the announcements loop');
}
function renderAnnouncements() {
  const { $, esc } = ctx; const a = S().announcements || {};
  if (document.activeElement !== $('#annSecs')) $('#annSecs').value = a.seconds || 8;
  $('#annList').innerHTML = (a.items || []).map((it, i) => `<li class="${a.playing && i === (a.index || 0) % a.items.length ? 'on' : ''}" data-i="${i}">
    <span>${esc(label(it))}</span><button data-a="up" title="Move up">↑</button><button data-a="del" title="Remove">✕</button></li>`).join('') || '<li class="muted small">Empty — add slides with ⟳.</li>';
  $('#annPlay').classList.toggle('primary', !!a.playing); $('#annPlay').textContent = a.playing ? '▶ Playing' : '▶ Play';
}

// ---------------------------------------------------------------- looks
const LOOK_FIELDS = (c) => { const { id, name, ...rest } = c; return rest; };
export const lookPatch = (lookId) => baseLook(S(), lookId);
function renderLooks() {
  const { $, esc } = ctx;
  $('#lookList').innerHTML = (S().looks || []).map((l) => `<div class="look" data-id="${esc(l.id)}"><button data-a="apply">${esc(l.name)}</button><button data-a="update" title="Save current screens into this look">⟳</button><button data-a="del" title="Delete">✕</button></div>`).join('')
    || '<p class="muted small">Set up the screens, then “Save current”.</p>';
}

// ---------------------------------------------------------------- macros
let editingMacro = null;
function renderMacros() {
  const { $, esc } = ctx;
  $('#macroList').innerHTML = (S().macros || []).map((m) => `<button class="macro" data-id="${esc(m.id)}" style="background:${esc(m.color || '#8b7bff')}">${esc(m.name)}<span class="ed" data-a="edit" title="Edit">✎</span></button>`).join('')
    || '<p class="muted small">No macros yet.</p>';
  $('#mcLook').innerHTML = '<option value="">—</option>' + (S().looks || []).map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  $('#mcTimer').innerHTML = '<option value="">—</option>' + (S().timers || []).map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
}
function openMacro(m) {
  const { $, $$ } = ctx;
  editingMacro = m || { id: uid(), name: '', color: '#8b7bff', actions: {} };
  const a = editingMacro.actions || {};
  $('#macroEditor').hidden = false;
  $('#mcName').value = editingMacro.name; $('#mcColor').value = editingMacro.color || '#8b7bff';
  $('#mcLook').value = a.look || ''; $('#mcTimer').value = a.timer || ''; $('#mcTimerAct').value = a.timerAction || '';
  $('#mcAnn').value = a.announcements || ''; $('#mcGo').value = a.goto || ''; $('#mcMsg').value = a.message || ''; $('#mcDmx').value = a.dmx || '';
  $$('.mc-clears input').forEach((c) => { c.checked = (a.clear || []).includes(c.value); });
  $('#mcDelete').hidden = !m;
}
export async function runMacro(m) {
  const { patch, goto, fadeAudio: fade } = macroPatch(S(), m);
  if (fade) fadeAudio();
  if (m.actions?.dmx) ctx.postJson('/api/dmx', { levels: m.actions.dmx }).catch((e) => ctx.toast(`Lighting: ${e.message}`, true));
  if (Object.keys(patch).length) await ctx.push(patch);
  if (goto) { await ctx.goLive(goto); ctx.setPreview(goto); }
  ctx.toast(`Macro: ${m.name}`);
}

// ---------------------------------------------------------------- wiring
export function onState(s, prev) {
  pending = {};
  syncClock(s.serverNow);
  if (!prev || JSON.stringify(prev.timers) !== JSON.stringify(s.timers)) renderTimers();
  if (!prev || JSON.stringify(prev.message) !== JSON.stringify(s.message)) renderMessage();
  if (!prev || JSON.stringify(prev.props) !== JSON.stringify(s.props)) renderProps();
  if (!prev || JSON.stringify(prev.announcements) !== JSON.stringify(s.announcements)) renderAnnouncements();
  if (!prev || JSON.stringify(prev.looks) !== JSON.stringify(s.looks)) renderLooks();
  if (!prev || JSON.stringify(prev.macros) !== JSON.stringify(s.macros) || JSON.stringify(prev.looks) !== JSON.stringify(s.looks) || JSON.stringify(prev.timers?.map((t) => t.name)) !== JSON.stringify(s.timers?.map((t) => t.name))) renderMacros();
  ctx.$('#clearBar [data-clear="media"]').classList.toggle('on', !!s.clearMedia);
  ctx.$('#clearBar [data-clear="messages"]').classList.toggle('on', !!s.message?.visible);
  ctx.$('#clearBar [data-clear="props"]').classList.toggle('on', (s.props || []).some((p) => p.visible));
}
export const refreshProps = () => S() && renderProps();

export function initShowTools(c0) {
  // Apply every change locally at once, so quick successive clicks build on each other.
  const c = { ...c0, push: (patch) => { pending = { ...pending, ...patch }; return c0.push(patch); } };
  ctx = c;
  const { $, $$ } = c;
  setInterval(tickConsole, 250);

  $('#clearBar').onclick = (e) => { const b = e.target.closest('[data-clear]'); if (b) clearLayer(b.dataset.clear); };

  // timers
  $('#timerAdd').onclick = () => pushTimers([...S().timers, { id: uid(), name: 'Timer', mode: 'countdown', duration: 300, target: '', running: false, startedAt: 0, elapsed: 0 }]);
  $('#timerList').addEventListener('change', (e) => {
    const row = e.target.closest('.timer-row'); const f = e.target.dataset.f; if (!row || !f) return;
    const v = f === 'duration' ? parseDuration(e.target.value) : e.target.value;
    updTimer(row.dataset.id, (t) => ({ ...t, [f]: v, ...(f === 'mode' ? { running: false, elapsed: 0, startedAt: 0 } : {}) }));
  });
  $('#timerList').addEventListener('click', (e) => {
    const row = e.target.closest('.timer-row'); const a = e.target.closest('[data-a]')?.dataset.a; if (!row || !a) return;
    const id = row.dataset.id; const t = S().timers.find((x) => x.id === id);
    if (a === 'start') updTimer(id, startTimer);
    if (a === 'stop') updTimer(id, stopTimer);
    if (a === 'reset') updTimer(id, resetTimer);
    if (a === 'del') pushTimers(S().timers.filter((x) => x.id !== id));
    if (a === 'screen') { const item = { kind: 'timer', timerId: id, title: t.name }; c.goLive(item); c.setPreview(item); }
    if (a === 'msg') { $('#msgText').value = `${$('#msgText').value.trim()} {timer:${t.name}}`.trim(); $('#msgText').focus(); }
  });

  // message
  $('#msgShow').onclick = () => showMessage($('#msgText').value);
  $('#msgHide').onclick = () => clearLayer('messages');
  $('#msgStyle').onchange = () => { const m = S().message || {}; if (m.visible) c.push({ message: { ...m, style: $('#msgStyle').value } }); };
  $('#msgText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); showMessage($('#msgText').value); } });
  $('#msgRecent').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { $('#msgText').value = b.dataset.t; showMessage(b.dataset.t); } };

  // props
  $('#propAddText').onclick = () => pushProps([...(S().props || []), { id: uid(), kind: 'text', name: 'Text', text: 'LIVE', position: 'top-right', size: 12, opacity: 100, visible: true }]);
  $('#propAddMedia').onclick = () => {
    const img = c.media().find((m) => m.type === 'image');
    if (!img) c.toast('Upload a logo image in the Media tab first, then pick it here');
    pushProps([...(S().props || []), { id: uid(), kind: 'media', name: img?.name || 'Logo', url: img?.url || '', position: 'top-right', size: 12, opacity: 100, visible: !!img }]);
  };
  const propChange = (e) => {
    const row = e.target.closest('.prop-row'); const f = e.target.dataset.f; if (!row || !f) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
    pushProps(S().props.map((p) => (p.id === row.dataset.id ? { ...p, [f]: v, ...(f === 'url' ? { name: c.media().find((m) => m.url === v)?.name || p.name } : {}), ...(f === 'text' ? { name: v } : {}) } : p)));
  };
  $('#propList').addEventListener('change', propChange);
  $('#propList').addEventListener('click', (e) => {
    const row = e.target.closest('.prop-row');
    if (row && e.target.closest('[data-a="del"]')) pushProps(S().props.filter((p) => p.id !== row.dataset.id));
  });

  // announcements
  const ann = (patch) => c.push({ announcements: { ...S().announcements, ...patch } });
  $('#annPlay').onclick = () => { if (!S().announcements?.items?.length) return c.toast('Add slides to the loop first (⟳ in Media or Service)', true); ann({ playing: true, startedAt: Date.now() }); };
  $('#annStop').onclick = () => ann({ playing: false });
  $('#annSecs').onchange = (e) => ann({ seconds: Math.max(2, Number(e.target.value) || 8) });
  $('#annList').onclick = (e) => {
    const li = e.target.closest('li[data-i]'); const a = e.target.closest('[data-a]')?.dataset.a; if (!li || !a) return;
    const i = Number(li.dataset.i); const items = [...S().announcements.items];
    if (a === 'del') items.splice(i, 1);
    if (a === 'up' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
    ann({ items, index: 0 });
  };

  // looks
  $('#lookSave').onclick = () => {
    const name = prompt('Name this look (e.g. Worship, Sermon, Pre-service)'); if (!name) return;
    c.push({ looks: [...(S().looks || []), { id: uid(), name: name.trim(), channels: S().channels.map((ch) => ({ id: ch.id, settings: LOOK_FIELDS(ch) })) }] });
  };
  $('#lookList').onclick = (e) => {
    const el = e.target.closest('.look'); const a = e.target.closest('[data-a]')?.dataset.a; if (!el || !a) return;
    const id = el.dataset.id;
    if (a === 'apply') { c.push(lookPatch(id)); c.toast(`Look: ${S().looks.find((l) => l.id === id)?.name}`); }
    if (a === 'update' && confirm('Replace this look with the current screen settings?')) c.push({ looks: S().looks.map((l) => (l.id === id ? { ...l, channels: S().channels.map((ch) => ({ id: ch.id, settings: LOOK_FIELDS(ch) })) } : l)) });
    if (a === 'del' && confirm('Delete this look?')) c.push({ looks: S().looks.filter((l) => l.id !== id) });
  };

  // macros
  $('#macroAdd').onclick = () => openMacro(null);
  $('#mcCancel').onclick = () => { $('#macroEditor').hidden = true; };
  $('#mcSave').onclick = () => {
    const m = { ...editingMacro, name: $('#mcName').value.trim() || 'Macro', color: $('#mcColor').value,
      actions: { look: $('#mcLook').value, clear: $$('.mc-clears input:checked').map((x) => x.value), timer: $('#mcTimer').value, timerAction: $('#mcTimerAct').value,
        announcements: $('#mcAnn').value, goto: $('#mcGo').value, message: $('#mcMsg').value.trim(), dmx: $('#mcDmx').value.trim() } };
    const list = S().macros || [];
    c.push({ macros: list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m] });
    $('#macroEditor').hidden = true;
  };
  $('#mcDelete').onclick = () => { if (confirm('Delete this macro?')) { c.push({ macros: (S().macros || []).filter((x) => x.id !== editingMacro.id) }); $('#macroEditor').hidden = true; } };
  $('#macroList').onclick = (e) => {
    const b = e.target.closest('.macro'); if (!b) return;
    const m = S().macros.find((x) => x.id === b.dataset.id);
    if (e.target.closest('[data-a="edit"]')) openMacro(m); else runMacro(m);
  };

  // audio
  $('#audioToggle').onclick = () => { if (!audio.src) return c.toast('Choose an audio file in the media library (▶)'); audio.paused ? audio.play() : audio.pause(); };
  $('#audioFade').onclick = () => fadeAudio();
  $('#audioLoop').onchange = (e) => { audio.loop = e.target.checked; };
  $('#audioVol').oninput = (e) => { audio.volume = Number(e.target.value); };
  audio.onended = () => { if (!audio.loop) ctx.$('#audioTitle').textContent = 'Nothing playing'; };
}

export { fillTokens, now };
