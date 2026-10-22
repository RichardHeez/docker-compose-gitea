// Hardware control in the console: MIDI (Web MIDI), Stream Deck / Companion URLs, and Art-Net lighting setup.
import { api, postJson } from './render.js';

let ctx = null; let midi = null; let learning = null; let lastAudioCmd = null;
const S = () => ctx.getS();

const actionOptions = () => [
  ['next', 'Next'], ['prev', 'Previous'], ['clear/all', 'Clear all'], ['clear/slide', 'Clear slide'], ['clear/media', 'Clear media'],
  ['clear/props', 'Clear props'], ['clear/messages', 'Clear message'], ['clear/audio', 'Fade audio'], ['black', 'Black'], ['logo', 'Logo'],
  ['announcements/play', 'Announcements ▶'], ['announcements/stop', 'Announcements ■'],
  ...(S().macros || []).map((m) => [`macro/${m.name}`, `Macro: ${m.name}`]),
  ...(S().looks || []).map((l) => [`look/${l.name}`, `Look: ${l.name}`]),
  ...(S().timers || []).map((t) => [`timer/${t.name}/toggle`, `Timer ▶/⏸: ${t.name}`]),
  ...S().service.map((_, i) => [`service/${i + 1}`, `Service item ${i + 1}`]),
];

export const trigger = (action) => postJson(`/api/trigger/${action.split('/').map(encodeURIComponent).join('/')}`, {}).catch((e) => ctx.toast(e.message, true));

function msgKey(data) {
  const type = data[0] & 0xf0, n = data[1], v = data[2];
  if (type === 0x90 && v > 0) return `note:${n}`;
  if (type === 0xb0 && v > 0) return `cc:${n}`;
  if (type === 0xc0) return `pc:${n}`;
  return null;
}

function onMidi(e) {
  const key = msgKey(e.data); if (!key) return;
  ctx.$('#midiLast').textContent = `Last: ${key}`;
  if (learning !== null) {
    const map = [...(S().midiMap || [])]; map[learning] = { ...map[learning], msg: key };
    learning = null; ctx.push({ midiMap: map }); return;
  }
  const hit = (S().midiMap || []).find((m) => m.msg === key && m.action);
  if (hit) trigger(hit.action);
}

async function enableMidi() {
  if (!navigator.requestMIDIAccess) return ctx.toast('MIDI needs Chrome or Edge', true);
  try {
    midi = await navigator.requestMIDIAccess();
    const hook = () => { for (const input of midi.inputs.values()) input.onmidimessage = onMidi; ctx.$('#midiDevices').textContent = [...midi.inputs.values()].map((i) => i.name).join(', ') || 'No MIDI devices found'; };
    midi.onstatechange = hook; hook();
    ctx.$('#midiEnable').textContent = 'MIDI on ✓';
  } catch (e) { ctx.toast(`MIDI: ${e.message}`, true); }
}

function renderMidi() {
  const { $, esc } = ctx; const opts = actionOptions();
  $('#midiMap').innerHTML = (S().midiMap || []).map((m, i) => `<div class="midi-row" data-i="${i}">
      <button class="btn ghost sm" data-a="learn">${learning === i ? 'Press a key…' : esc(m.msg || 'Learn')}</button>
      <select data-a="action">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === m.action ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <button class="x" data-a="del">✕</button></div>`).join('') || '<p class="muted small">No MIDI mappings yet.</p>';
}

async function renderUrls() {
  const { $, esc } = ctx;
  const base = location.origin;
  try {
    const { actions } = await api('/api/trigger');
    $('#trigUrls').innerHTML = actions.map((a) => `<div><code>${esc(base + a.url)}</code> <span class="muted">${esc(a.what)}</span></div>`).join('');
  } catch { /* offline */ }
}

export function onState(s, prev) {
  if (!prev || JSON.stringify(prev.midiMap) !== JSON.stringify(s.midiMap) || JSON.stringify(prev.macros) !== JSON.stringify(s.macros) || prev.service.length !== s.service.length) renderMidi();
  if (!prev || JSON.stringify(prev.dmx) !== JSON.stringify(s.dmx)) {
    if (document.activeElement !== ctx.$('#dmxHost')) ctx.$('#dmxHost').value = s.dmx?.host || '';
    if (document.activeElement !== ctx.$('#dmxUni')) ctx.$('#dmxUni').value = s.dmx?.universe ?? 0;
  }
  // Audio fades requested by triggers / macros run elsewhere.
  if (s.audioCmd && s.audioCmd.id !== lastAudioCmd) {
    const first = lastAudioCmd === null; lastAudioCmd = s.audioCmd.id;
    if (!first && s.audioCmd.action === 'fade') ctx.fadeAudio();
  } else if (lastAudioCmd === null) lastAudioCmd = s.audioCmd?.id ?? 0;
}

export function initTriggers(c) {
  ctx = c; const { $ } = c;
  $('#midiEnable').onclick = enableMidi;
  $('#midiAdd').onclick = () => ctx.push({ midiMap: [...(S().midiMap || []), { msg: '', action: 'next' }] });
  $('#midiMap').onclick = (e) => {
    const row = e.target.closest('.midi-row'); const a = e.target.closest('[data-a]')?.dataset.a; if (!row || !a) return;
    const i = Number(row.dataset.i);
    if (a === 'learn') { if (!midi) enableMidi(); learning = i; renderMidi(); }
    if (a === 'del') ctx.push({ midiMap: S().midiMap.filter((_, j) => j !== i) });
  };
  $('#midiMap').onchange = (e) => {
    const row = e.target.closest('.midi-row'); if (!row || e.target.dataset.a !== 'action') return;
    ctx.push({ midiMap: S().midiMap.map((m, j) => (j === Number(row.dataset.i) ? { ...m, action: e.target.value } : m)) });
  };
  $('#dmxHost').onchange = (e) => ctx.push({ dmx: { ...S().dmx, host: e.target.value.trim() } });
  $('#dmxUni').onchange = (e) => ctx.push({ dmx: { ...S().dmx, universe: Number(e.target.value) || 0 } });
  $('#dmxTest').onclick = () => postJson('/api/dmx', { levels: $('#dmxTestLevels').value }).then((r) => ctx.toast(`Sent ${r.sent} channel(s)`)).catch((e) => ctx.toast(e.message, true));
  renderUrls();
}
