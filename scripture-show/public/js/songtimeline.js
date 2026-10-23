// Song timeline player (console): plays a track on this computer and moves the live song slides on cue.
import { cleanTimeline, cueIndexAt, formatTime, parseTime, shiftCues } from './timeline.js';

let C;            // deps from app.js
let run = null;   // { item, cues, last, recording, follow }
let tick = null;

const S = () => C.getS();
const audio = () => C.audio();
const song = () => C.getSong();
const slides = () => C.getSlides();

export const isRecording = () => !!run?.recording;
export const isRunning = () => !!run;

function timeline() {
  const sg = song(); if (!sg) return null;
  const n = slides().length;
  const tl = sg.timeline || { audio: '', audioName: '', cues: [], next: false };
  const cues = Array.from({ length: n }, (_, i) => (tl.cues?.[i] ?? null));
  return { ...tl, cues };
}
function setTimeline(tl) {
  const sg = song(); if (!sg) return;
  sg.timeline = cleanTimeline(tl);
  render(); C.onChange();
}

const sameSong = (live, item) => live?.kind === 'song' && (live.songId || '') === (item.songId || '') && live.title === item.title;

function loop() {
  const a = audio(); if (!run) return;
  C.$('#tlTime').textContent = formatTime(a.currentTime);
  if (run.recording) { if (a.ended) stop(); return; }
  if (a.paused && !a.ended && a.currentTime > 0 && !run.waiting) { finish(false); return; }
  const live = S().live;
  if (run.follow && !sameSong(live, run.item)) { run.follow = false; C.toast('Timeline paused following: something else went live. The track keeps playing.'); }
  const idx = cueIndexAt(run.cues, a.currentTime);
  if (run.follow && idx >= 0 && idx !== run.last && live) {
    run.last = idx;
    if ((live.page || 0) !== idx) C.push({ live: { ...live, page: idx, highlight: [] } });
  }
  markCue(idx);
  if (a.ended) finish(true);
}

function startAudio(tl) {
  const a = audio();
  C.playAudio({ url: tl.audio, name: tl.audioName || 'Timeline track' }, { loop: false, from: 0 });
  run.waiting = true;
  a.addEventListener('playing', () => { if (run) run.waiting = false; }, { once: true });
  clearInterval(tick); tick = setInterval(loop, 50);
}

// Play an item's timeline (from the song editor or the service list).
export async function play(item) {
  const tl = item?.timeline;
  if (!tl?.audio) return C.toast('Pick a track for this song’s timeline first', true);
  if (!tl.cues?.some((c) => c !== null)) return C.toast('Record the cues first (⏺ Record)', true);
  stop(true);
  run = { item, cues: tl.cues, last: -1, recording: false, follow: true, next: !!tl.next };
  await C.goLive({ ...item, page: 0 });
  startAudio(tl);
  setButtons();
}

export async function record() {
  const tl = timeline(); const sg = song();
  if (!sg || !slides().length) return C.toast('Add lyrics first', true);
  if (!tl.audio) return C.toast('Choose the track first', true);
  stop(true);
  const cues = slides().map(() => null); cues[0] = 0;
  const item = C.songItem(sg, 0);
  run = { item, cues, last: 0, recording: true, follow: true };
  await C.goLive(item);
  startAudio(tl);
  document.activeElement?.blur?.();
  setButtons(); render();
}

// While recording: the next slide comes up now.
export function tap() {
  if (!run?.recording) return;
  const i = run.last + 1;
  if (i >= run.cues.length) { stop(); return; }
  run.cues[i] = Math.round(audio().currentTime * 100) / 100;
  run.last = i;
  const live = S().live;
  if (sameSong(live, run.item)) C.push({ live: { ...live, page: i, highlight: [] } });
  render(); markCue(i);
  if (i === run.cues.length - 1) C.toast('Last slide cued — press ■ Stop when the song ends');
}

function finish(ended) {
  const next = run?.next && ended;
  stop(true);
  if (next) C.nextServiceItem();
}

export function stop(silent = false) {
  if (!run) return;
  const wasRec = run.recording, cues = run.cues;
  clearInterval(tick); tick = null;
  run = null;
  const a = audio(); if (!a.paused) C.fadeAudio(silent ? 300 : 1200);
  if (wasRec) {
    setTimeline({ ...timeline(), cues });
    C.toast('Cues recorded — press “Save to library” to keep them');
  }
  setButtons(); markCue(-1);
}

function setButtons() {
  const rec = C.$('#tlRec'); if (!rec) return;
  rec.textContent = run?.recording ? 'Tap ▸ next slide' : '⏺ Record';
  rec.classList.toggle('live', !!run?.recording);
  C.$('#tlPlay').disabled = !!run;
  C.$('#tlStop').disabled = !run;
}

function markCue(idx) {
  C.$$('#tlCues .tl-cue').forEach((el) => el.classList.toggle('on', Number(el.dataset.i) === idx));
}

export function cueBadge(i) {
  const c = song()?.timeline?.cues?.[i];
  return c === null || c === undefined ? '' : `<span class="cue-badge">${formatTime(c)}</span>`;
}

export function render() {
  const box = C.$('#tlCues'); if (!box || !song()) return;
  const tl = timeline();
  const audioList = C.media().filter((m) => m.type === 'audio');
  const known = audioList.some((m) => m.url === tl.audio);
  C.$('#tlAudio').innerHTML = `<option value="">— choose a track (upload in Media) —</option>${audioList.map((m) => `<option value="${C.esc(m.url)}" ${m.url === tl.audio ? 'selected' : ''}>♪ ${C.esc(m.name)}</option>`).join('')}${tl.audio && !known ? `<option value="${C.esc(tl.audio)}" selected>${C.esc(tl.audioName || tl.audio)}</option>` : ''}`;
  C.$('#tlNext').checked = !!tl.next;
  C.$('#tlSummary').textContent = tl.audio ? `· ${tl.cues.filter((c) => c !== null).length}/${tl.cues.length} cued` : '';
  const cues = run?.recording ? run.cues : tl.cues;
  box.innerHTML = slides().map((sl, i) => `<label class="tl-cue" data-i="${i}"><span>${i + 1}. ${C.esc(sl.label)} <small>${C.esc(sl.lines[0] || '')}</small></span>
    <input data-cue="${i}" value="${cues[i] === null ? '' : formatTime(cues[i])}" placeholder="–" inputmode="decimal"></label>`).join('');
  setButtons();
}

export function init(deps) {
  C = deps;
  const $ = C.$;
  $('#tlAudio').onchange = () => { const v = $('#tlAudio').value; setTimeline({ ...timeline(), audio: v, audioName: decodeURIComponent(v.split('/').pop() || '') }); };
  $('#tlNext').onchange = () => setTimeline({ ...timeline(), next: $('#tlNext').checked });
  $('#tlRec').onclick = () => (run?.recording ? tap() : record());
  $('#tlPlay').onclick = () => { const sg = song(); if (sg) play({ ...C.songItem(sg, 0), timeline: timeline() }); };
  $('#tlStop').onclick = () => stop();
  $('#tlClear').onclick = () => { if (confirm('Clear all cue times for this song?')) setTimeline({ ...timeline(), cues: [] }); };
  C.$$('#tlBox [data-shift]').forEach((b) => { b.onclick = () => setTimeline({ ...timeline(), cues: shiftCues(timeline().cues, Number(b.dataset.shift)) }); });
  $('#tlCues').addEventListener('change', (e) => {
    const f = e.target.closest('[data-cue]'); if (!f) return;
    const v = parseTime(f.value);
    if (Number.isNaN(v)) { C.toast('Type a time like 1:05.5 or 65.5', true); render(); return; }
    const tl = timeline(); tl.cues[Number(f.dataset.cue)] = v; setTimeline(tl);
  });
}
