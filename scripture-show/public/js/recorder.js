// Record & stream (console). In the desktop app a channel is captured off-screen and encoded by ffmpeg
// directly. In a browser, the operator picks the output window/screen to capture; the video is sent to
// the F8 server, which records it to the Media library and/or streams it to an RTMP address.
import { getPin } from './render.js';

let C;
let run = null; // { mode: 'desktop'|'browser', ch, started, id, rec, stream, chain, bytes, error }
let statusTimer = null;
const desktop = () => window.f8Desktop?.recStart ? window.f8Desktop : null;
const store = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const QUALITY = { '1080p': { width: 1920, height: 1080, bitrate: 8000 }, '4k': { width: 3840, height: 2160, bitrate: 20000 } };

function rtmpTarget() {
  if (!C.$('#recStream').checked) return '';
  const url = C.$('#recUrl').value.trim().replace(/\/+$/, ''); const key = C.$('#recKey').value.trim();
  if (!url) throw new Error('Enter the stream server address (rtmp://…) from YouTube, Facebook, etc.');
  if (!/^rtmps?:\/\//i.test(url)) throw new Error('The stream address must start with rtmp:// or rtmps://');
  return key ? `${url}/${key}` : url;
}

const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);
const fmtTime = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`; };

function render() {
  const on = !!run;
  C.$('#recStart').hidden = on; C.$('#recStop').hidden = !on;
  ['#recCh', '#recQuality', '#recRecord', '#recStream', '#recUrl', '#recKey'].forEach((s) => { C.$(s).disabled = on; });
  const st = C.$('#recStatus');
  if (!on) { st.innerHTML = ''; return; }
  const what = [run.rec ? 'Recording' : '', run.stream ? 'Streaming' : ''].filter(Boolean).join(' + ');
  st.innerHTML = `<span class="rec-dot"></span><b>${what}</b> · ${fmtTime(Date.now() - run.started)}${run.bytes ? ` · ${fmtBytes(run.bytes)}` : ''}${run.error ? `<div class="err">${C.esc(run.error)}</div>` : ''}`;
}

async function start() {
  let rtmp;
  try { rtmp = rtmpTarget(); } catch (e) { return C.toast(e.message, true); }
  const record = C.$('#recRecord').checked;
  if (!record && !rtmp) return C.toast('Tick Record, Stream or both', true);
  const quality = C.$('#recQuality').value; const ch = Number(C.$('#recCh').value);
  store.set('f8.recUrl', C.$('#recUrl').value.trim()); store.set('f8.recQuality', quality);
  if (C.$('#recSaveKey').checked) store.set('f8.recKey', C.$('#recKey').value.trim()); else store.set('f8.recKey', '');
  const d = desktop();
  if (d) {
    const r = await d.recStart(ch, { quality, record, rtmp });
    if (r?.error) return C.toast(r.error, true);
    run = { mode: 'desktop', ch, started: Date.now(), rec: record, stream: !!rtmp, file: r.file };
  } else {
    if (!navigator.mediaDevices?.getDisplayMedia) return C.toast('This browser cannot capture the screen — use Chrome or Edge, or the desktop app', true);
    const q = QUALITY[quality];
    let media;
    try {
      C.toast(`Choose the output window for channel ${ch} (or the projector screen)`);
      const ask = (audio) => navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: { ideal: q.width }, height: { ideal: q.height } }, audio, selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', systemAudio: 'include' });
      try { media = await ask(true); }
      catch (e) { if (e.name === 'NotAllowedError') throw e; media = await ask(false); } // sound can't be captured here: video only
    } catch (e) { return C.toast(e.name === 'NotAllowedError' ? 'Screen capture was cancelled' : e.message, true); }
    const hasAudio = media.getAudioTracks().length > 0;
    let s;
    try { s = await C.postJson('/api/rec/start', { quality, record, rtmp, hasAudio, label: `Ch${ch}` }); }
    catch (e) { media.getTracks().forEach((t) => t.stop()); return C.toast(e.message, true); }
    const types = hasAudio ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'] : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
    const rec = new MediaRecorder(media, { mimeType: types.find((t) => MediaRecorder.isTypeSupported(t)) || '', videoBitsPerSecond: q.bitrate * 1500 });
    run = { mode: 'browser', ch, started: Date.now(), id: s.id, rec: record, stream: !!rtmp, media, recorder: rec, chain: Promise.resolve(), bytes: 0, error: '', file: s.file };
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
  if (r.mode === 'desktop') result = await desktop().recStop(r.ch);
  else {
    await new Promise((ok) => { r.recorder.addEventListener('stop', ok, { once: true }); try { r.recorder.stop(); } catch { ok(); } });
    r.media.getTracks().forEach((t) => t.stop());
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
  $('#recUrl').value = store.get('f8.recUrl');
  $('#recKey').value = store.get('f8.recKey');
  $('#recSaveKey').checked = !!store.get('f8.recKey');
  $('#recQuality').value = QUALITY[store.get('f8.recQuality')] ? store.get('f8.recQuality') : '1080p'; // older 720p setting → 1080p
  $('#recHow').textContent = desktop()
    ? 'The desktop app captures the chosen channel by itself — even while it is on a projector.'
    : 'Open the channel’s output window first (Outputs → Open). When you press Start, pick that window (or the projector screen) in the box that appears.';
  $('#recStream').onchange = () => { $('#recStreamBox').hidden = !$('#recStream').checked; };
  $('#recStreamBox').hidden = !$('#recStream').checked;
  $('#recStart').onclick = start;
  $('#recStop').onclick = stop;
  window.addEventListener('beforeunload', (e) => { if (run?.mode === 'browser') { e.preventDefault(); e.returnValue = ''; } });
}
