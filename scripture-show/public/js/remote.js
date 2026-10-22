// Phone/tablet remote: step through verses and the service, go live by reference, black/clear/logo.
import { formatRef, parseReferences } from './books.js';
import { api, autoScale, bookName, books, buildSlide, postJson, resolveSlide, show, updateTimers } from './render.js';
import * as control from './control.js';
import { clearPatch, macroPatch } from './macros.js';
import { syncClock } from './timers.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let S = null;
let names = {};
const mon = $('#mon');
autoScale(mon);
setInterval(() => S && updateTimers(mon, S), 500);

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
const run = (p) => p.catch((e) => toast(e.message));
const label = async (it) => !it ? 'Nothing live' : it.kind === 'song' ? `🎵 ${it.title} · ${it.slides?.[it.page || 0]?.label || ''} · ${(it.page || 0) + 1}/${it.slides?.length || 1}` : it.kind === 'scripture' ? formatRef(it.ref, await bookName(S.translation, it.ref.book)) + (it.pages > 1 ? ` · ${it.page + 1}/${it.pages}` : '') : it.title || it.name || '';

let seq = 0;
async function render(prev) {
  $('#tr').textContent = S.translation;
  $('#liveLabel').textContent = await label(S.live);
  ['black', 'clear', 'logo'].forEach((k) => $('#' + k).classList.toggle('on', !!S[k]));
  syncClock(S.serverNow); show.state = S;
  $('#macroWrap').hidden = !(S.macros || []).length;
  $('#macros').innerHTML = (S.macros || []).map((m) => `<button data-id="${esc(m.id)}" style="background:${esc(m.color || '#8b7bff')}">${esc(m.name)}</button>`).join('');
  $('#msgHide').hidden = !S.message?.visible;
  const ch = { ...S.channels[0], mode: 'full', mediaAudio: false };
  const my = ++seq;
  const slide = await resolveSlide(S.live, ch, S);
  if (my === seq) show(mon, buildSlide(slide, ch, S, { black: S.black, clear: S.clear, logo: S.logo, preview: true }), 'cut');
  if (!prev || JSON.stringify(prev.service) !== JSON.stringify(S.service) || !control.sameItem(prev.live, S.live)) {
    $('#service').innerHTML = S.service.length ? S.service.map((it, i) => `<li data-i="${i}" class="${control.sameItem(it, S.live) ? 'live' : ''}"><span class="n">${i + 1}</span><div><b>${esc(it.kind === 'scripture' ? formatRef(it.ref) : it.kind === 'song' ? `🎵 ${it.title}` : it.title || it.name)}</b><small>${esc(it.heading || (it.kind === 'text' ? it.body : it.kind === 'media' ? 'Media' : it.kind === 'song' ? `Song · ${it.slides?.length || 0} slides` : 'Scripture'))}</small></div></li>`).join('')
      : '<li class="muted">The service is empty — build it on the console.</li>';
  }
}

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', async (e) => {
    const prev = S; S = JSON.parse(e.data); $('#dot').classList.remove('off');
    if (!prev || prev.translation !== S.translation) names = Object.fromEntries((await books(S.translation).catch(() => [])).map((b) => [b.name, b.id]));
    render(prev);
  });
  es.onerror = () => $('#dot').classList.add('off');
}

$('#next').onclick = () => run(control.step(S, 1));
$('#prev').onclick = () => run(control.step(S, -1));
$('#black').onclick = () => run(control.push({ black: !S.black }));
$('#clear').onclick = () => run(control.push({ clear: !S.clear }));
$('#logo').onclick = () => run(control.push({ logo: !S.logo }));
$('#quick').onsubmit = (e) => {
  e.preventDefault();
  const r = parseReferences($('#ref').value, names)[0];
  if (!r) return toast('No reference found');
  run(control.goLive(S, { kind: 'scripture', ref: { ...r, verseStart: r.verseStart || 1, verseEnd: r.verseEnd || r.verseStart || 1 } }));
  $('#ref').blur();
};
$('#service').onclick = (e) => { const li = e.target.closest('li[data-i]'); if (li) run(control.goLive(S, S.service[Number(li.dataset.i)])); };
$('#clearAll').onclick = () => run(control.push(clearPatch('all', S)));
$('#macros').onclick = async (e) => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  const m = S.macros.find((x) => x.id === b.dataset.id); const { patch, goto } = macroPatch(S, m);
  if (Object.keys(patch).length) await run(control.push(patch));
  if (goto) await run(control.goLive(S, goto));
  toast(`Macro: ${m.name}`);
};
$('#msgForm').onsubmit = (e) => { e.preventDefault(); const t = $('#msgText').value.trim(); if (t) run(control.push({ message: { text: t, style: S.message?.style || 'lower', visible: true } })); $('#msgText').blur(); };
$('#msgHide').onclick = () => run(control.push(clearPatch('messages', S)));
$('#stage').onsubmit = (e) => { e.preventDefault(); run(control.push({ stageMessage: $('#msg').value })); toast($('#msg').value ? 'Sent to stage' : 'Stage message cleared'); };

api('/api/info').then((info) => info.pinRequired ? postJson('/api/pin', {}) : null).catch(() => {}).finally(connect);
