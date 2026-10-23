// Record & stream (console). In the desktop app a channel is captured off-screen and encoded by ffmpeg
// directly. In a browser, the operator picks the output window/screen to capture; the video is sent to
// the F8 server, which records it to the Media library and/or streams it to one or more RTMP addresses.
// Sound comes from the mixer: the sound desk input, the captured window's sound and remote guests.
import { getPin } from './render.js';
import { Mixer, audioInputs } from './mixer.js';

let C;
let run = null; // { mode: 'desktop'|'browser', ch, started, id, rec, stream, chain, bytes, error }
let statusTimer = null;
let mixer = null;
let meterRaf = 0;
const desktop = () => window.f8Desktop?.recStart ? window.f8Desktop : null;
const store = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const QUALITY = { '1080p': { width: 1920, height: 1080, bitrate: 8000 }, '4k': { width: 3840, height: 2160, bitrate: 20000 } };
const PRESETS = {
  youtube: { name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2' },
  facebook: { name: 'Facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp' },
  restream: { name: 'Restream', url: 'rtmp://live.restream.io/live' },
  twitch: { name: 'Twitch', url: 'rtmp://live.twitch.tv/app' },
  custom: { name: 'Other (RTMP)', url: '' },
};

// The shared mixer (also used by remote guests). Created on first use, after a click.
export function getMixer() { mixer ||= new Mixer(); return mixer; }

// ---------------------------------------------------------------- destinations (multistream)
let dests = [];
function loadDests() {
  try { dests = JSON.parse(store.get('f8.recDests') || '[]'); } catch { dests = []; }
  const oldUrl = store.get('f8.recUrl'); // settings from before multistream
  if (!dests.length && oldUrl) dests = [{ preset: 'custom', url: oldUrl, key: store.get('f8.recKey'), on: true }];
  if (!dests.length) dests = [{ preset: 'youtube', url: PRESETS.youtube.url, key: '', on: true }];
}
function saveDests() {
  const keep = C.$('#recSaveKey').checked;
  store.set('f8.recDests', JSON.stringify(dests.map((d) => ({ ...d, key: keep ? d.key : '' }))));
  store.set('f8.recKeepKeys', keep ? '1' : '');
}
function renderDests() {
  const box = C.$('#recDests'); const esc = C.esc;
  box.innerHTML = dests.map((d, i) => `<div class="rec-dest" data-i="${i}">
    <label class="switch" title="Stream to this one"><input type="checkbox" data-f="on" ${d.on ? 'checked' : ''}><span></span></label>
    <select data-f="preset">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${k === d.preset ? 'selected' : ''}>${p.name}</option>`).join('')}</select>
    <input data-f="url" value="${esc(d.url)}" placeholder="rtmp://…" spellcheck="false">
    <input data-f="key" type="password" value="${esc(d.key)}" placeholder="Stream key" autocomplete="off" spellcheck="false">
    <button type="button" class="x" data-del title="Remove">✕</button></div>`).join('');
}
function targets() {
  const out = [];
  for (const d of dests.filter((x) => x.on)) {
    const url = String(d.url || '').trim().replace(/\/+$/, ''); const key = String(d.key || '').trim();
    const name = PRESETS[d.preset]?.name || 'Stream';
    if (!/^rtmps?:\/\/\S+$/i.test(url)) throw new Error(`${name}: the server address must start with rtmp:// or rtmps://`);
    if (!key && d.preset !== 'custom') throw new Error(`${name}: paste the stream key from ${name}`);
    out.push(key ? `${url}/${key}` : url);
  }
  return out;
}

// ---------------------------------------------------------------- sound
async function fillInputs() {
  const sel = C.$('#recInput'); const cur = sel.value || store.get('f8.recInput');
  let list = [];
  try { list = await audioInputs(); } catch { /* no permission or no devices */ }
  sel.innerHTML = `<option value="">No sound input</option>${list.map((d) => `<option value="${C.esc(d.id)}">${C.esc(d.label)}</option>`).join('')}`;
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
async function applyInput() {
  const id = C.$('#recInput').value; store.set('f8.recInput', id);
  const m = getMixer(); await m.resume();
  try {
    const label = await m.setInput(id, Number(C.$('#recVol').value));
    if (label) C.toast(`Sound from “${label}”`);
  } catch (e) { C.toast(`Sound input: ${e.message}`, true); C.$('#recInput').value = ''; }
  meter();
}
function meter() {
  cancelAnimationFrame(meterRaf);
  const bar = C.$('#recMeter'); if (!mixer) return;
  let shown = 0;
  const tick = () => {
    shown = Math.max(mixer.level(), shown * 0.9); // fast up, smooth fall like a desk meter
    const db = shown > 0.0001 ? 20 * Math.log10(shown) : -90;
    bar.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
    bar.className = db > -3 ? 'hot' : db > -12 ? 'warm' : '';
    meterRaf = requestAnimationFrame(tick);
  };
  tick();
}
export const startMeter = meter;

// ---------------------------------------------------------------- status
const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);
const fmtTime = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`; };

function render() {
  const on = !!run;
  C.$('#recStart').hidden = on; C.$('#recStop').hidden = !on;
  C.$$('#recCh, #recQuality, #recRecord, #recStream, #recDests input, #recDests select, #recAddDest, #recDelay').forEach((el) => { el.disabled = on; });
  const st = C.$('#recStatus');
  if (!on) { st.innerHTML = ''; return; }
  const what = [run.rec ? 'Recording' : '', run.stream ? `Streaming${run.stream > 1 ? ` to ${run.stream}` : ''}` : ''].filter(Boolean).join(' + ');
  st.innerHTML = `<span class="rec-dot"></span><b>${what}</b> · ${fmtTime(Date.now() - run.started)}${run.bytes ? ` · ${fmtBytes(run.bytes)}` : ''}${run.silent ? ' · <span class="warn">no sound</span>' : ''}${run.error ? `<div class="err">${C.esc(run.error)}</div>` : ''}`;
}

// ---------------------------------------------------------------- start / stop
async function start() {
  let rtmp = [];
  try { if (C.$('#recStream').checked) rtmp = targets(); } catch (e) { return C.toast(e.message, true); }
  const record = C.$('#recRecord').checked;
  if (C.$('#recStream').checked && !rtmp.length) return C.toast('Switch on at least one stream destination', true);
  if (!record && !rtmp.length) return C.toast('Tick Record, Stream or both', true);
  const quality = C.$('#recQuality').value; const ch = Number(C.$('#recCh').value);
  const audioDelay = Number(C.$('#recDelay').value) || 0;
  store.set('f8.recQuality', quality); saveDests();
  const m = getMixer(); await m.resume();
  const d = desktop();
  if (d) {
    const withSound = m.sources.size > 0;
    const r = await d.recStart(ch, { quality, record, rtmp, audio: withSound, audioDelay });
    if (r?.error) return C.toast(r.error, true);
    run = { mode: 'desktop', ch, started: Date.now(), rec: record, stream: rtmp.length, file: r.file, silent: !withSound };
    if (withSound) run.stopPcm = await m.pcm((buf) => d.recAudio(ch, buf));
  } else {
    if (!navigator.mediaDevices?.getDisplayMedia) return C.toast('This browser cannot capture the screen — use Chrome or Edge, or the desktop app', true);
    const q = QUALITY[quality];
    const wantTab = C.$('#recTabAudio').checked;
    let media;
    try {
      C.toast(`Choose the output window for channel ${ch} (or the projector screen)`);
      const ask = (audio) => navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: { ideal: q.width }, height: { ideal: q.height } }, audio, selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', systemAudio: 'include' });
      try { media = await ask(wantTab); }
      catch (e) { if (e.name === 'NotAllowedError' || !wantTab) throw e; media = await ask(false); } // that sound can't be captured here
    } catch (e) { return C.toast(e.name === 'NotAllowedError' ? 'Screen capture was cancelled' : e.message, true); }
    if (media.getAudioTracks().length) m.add('display', new MediaStream(media.getAudioTracks()), 1);
    const hasAudio = m.sources.size > 0;
    let s;
    try { s = await C.postJson('/api/rec/start', { quality, record, rtmp, hasAudio, audioDelay, label: `Ch${ch}` }); }
    catch (e) { m.remove('display'); media.getTracks().forEach((t) => t.stop()); return C.toast(e.message, true); }
    const tracks = [media.getVideoTracks()[0], ...(hasAudio ? [m.track] : [])];
    const types = hasAudio ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'] : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: types.find((t) => MediaRecorder.isTypeSupported(t)) || '', videoBitsPerSecond: q.bitrate * 1500, audioBitsPerSecond: 192000 });
    run = { mode: 'browser', ch, started: Date.now(), id: s.id, rec: record, stream: rtmp.length, media, recorder: rec, chain: Promise.resolve(), bytes: 0, error: '', file: s.file, silent: !hasAudio };
    const r0 = run;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      r0.chain = r0.chain.then(() => fetch(`/api/rec/chunk?id=${r0.id}`, { method: 'POST', headers: { 'x-f8-pin': getPin() }, body: e.data })
        .then(async (res) => { const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error || `Upload failed (${res.status})`); r0.bytes = j.bytes || r0.bytes; })
        .catch((err) => { r0.error = err.message; }));
    };
    media.getVideoTracks()[0].addEventListener('ended', () => { if (run === r0) stop(); }); // "Stop sharing"
    rec.start(1000);
    if (!s.ffmpeg && record) C.toast('No ffmpeg on the server: saving the recording as WebM');
  }
  if (run.silent) C.toast('No sound input chosen — the stream will be silent', true);
  clearInterval(statusTimer); statusTimer = setInterval(poll, 1000);
  render();
}

async function poll() {
  if (!run) return;
  if (run.mode === 'desktop') {
    const list = await desktop().recStatus().catch(() => []);
    const me = list.find((x) => x.ch === run.ch);
    if (!me) { const r = run; run = null; finish(r, { error: 'Recording stopped' }); return; }
    run.bytes = me.bytes; run.error = me.error || '';
  }
  render();
}

async function stop() {
  const r = run; if (!r) return;
  run = null; clearInterval(statusTimer); render();
  let result = {};
  r.stopPcm?.();
  if (r.mode === 'desktop') result = await desktop().recStop(r.ch);
  else {
    await new Promise((ok) => { r.recorder.addEventListener('stop', ok, { once: true }); try { r.recorder.stop(); } catch { ok(); } });
    r.media.getTracks().forEach((t) => t.stop());
    mixer?.remove('display');
    await r.chain;
    result = await C.postJson('/api/rec/stop', { id: r.id }).catch((e) => ({ error: e.message }));
  }
  finish(r, result);
}

function finish(r, result) {
  clearInterval(statusTimer); render();
  const file = result.file || r.file;
  if (result.error && !file) C.toast(result.error, true);
  else C.toast(`${r.rec && file ? `Saved “${file}” to the Media library` : 'Stream ended'}${result.error ? ` (${result.error})` : ''}`);
  C.reloadMedia();
}

export function onState(s) {
  const sel = C.$('#recCh'); if (!sel || !s) return;
  const v = sel.value || '1';
  const html = s.channels.map((c) => `<option value="${c.id}">${c.id}. ${C.esc(c.name)}</option>`).join('');
  if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; sel.value = v; }
}

export function init(deps) {
  C = deps;
  const { $ } = C;
  loadDests();
  $('#recSaveKey').checked = !!store.get('f8.recKeepKeys') || !!store.get('f8.recKey');
  renderDests();
  $('#recQuality').value = QUALITY[store.get('f8.recQuality')] ? store.get('f8.recQuality') : '1080p'; // older 720p setting → 1080p
  $('#recDelay').value = store.get('f8.recDelay') || 0; $('#recDelayLabel').textContent = `${$('#recDelay').value} ms`;
  $('#recHow').textContent = desktop()
    ? 'The desktop app captures the chosen channel by itself — even while it is on a projector.'
    : 'Open the channel’s output window first (Outputs → Open). When you press Start, pick that window (or the projector screen) in the box that appears.';
  $('#recTabAudioRow').hidden = !!desktop();
  $('#recStream').onchange = () => { $('#recStreamBox').hidden = !$('#recStream').checked; };
  $('#recStreamBox').hidden = !$('#recStream').checked;
  $('#recDests').addEventListener('change', (e) => {
    const row = e.target.closest('.rec-dest'); const f = e.target.dataset.f; if (!row || !f) return;
    const d = dests[Number(row.dataset.i)];
    if (f === 'on') d.on = e.target.checked;
    else if (f === 'preset') { d.preset = e.target.value; d.url = PRESETS[d.preset].url || d.url; renderDests(); }
    else d[f] = e.target.value;
    saveDests();
  });
  $('#recDests').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (!b) return; dests.splice(Number(b.closest('.rec-dest').dataset.i), 1); renderDests(); saveDests(); });
  $('#recAddDest').onclick = () => { const used = new Set(dests.map((d) => d.preset)); const preset = ['facebook', 'youtube', 'restream', 'twitch'].find((p) => !used.has(p)) || 'custom'; dests.push({ preset, url: PRESETS[preset].url, key: '', on: true }); renderDests(); saveDests(); };
  $('#recSaveKey').onchange = saveDests;
  $('#recInput').onchange = applyInput;
  // Browsers start sound paused until a click; any click in this panel wakes the mixer (and its meter).
  document.querySelector('.rec-card').addEventListener('pointerdown', () => { if (mixer) mixer.resume(); });
  $('#recFindInputs').onclick = fillInputs;
  $('#recVol').oninput = () => mixer?.setVolume('input', Number($('#recVol').value));
  $('#recDelay').oninput = () => { $('#recDelayLabel').textContent = `${$('#recDelay').value} ms`; store.set('f8.recDelay', $('#recDelay').value); };
  $('#recStart').onclick = start;
  $('#recStop').onclick = stop;
  window.addEventListener('beforeunload', (e) => { if (run?.mode === 'browser') { e.preventDefault(); e.returnValue = ''; } });
}
