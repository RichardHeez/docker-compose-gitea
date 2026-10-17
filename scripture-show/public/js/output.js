// Output window / OBS browser source: /output.html?ch=N
import { formatRef } from './books.js';
import { autoScale, buildSlide, resolveSlide, show, slideKey } from './render.js';

const params = new URLSearchParams(location.search);
const chId = Number(params.get('ch') || 1);
const host = document.getElementById('host');
const hint = document.getElementById('hint');
autoScale(host);

let lastKey = '';
let seq = 0;
let lastCmd = null;
let soundUnlocked = false;

// Browsers block autoplay with sound until the page is clicked once; fall back to muted.
function startVideos() {
  host.querySelectorAll('.slide:not(.leaving) video.live-media').forEach((v) => {
    if (v.muted) return;
    v.play().catch(() => {
      v.muted = true; v.play().catch(() => {});
      if (!soundUnlocked) { hint.textContent = 'Click once to enable video sound'; hint.style.opacity = 1; }
    });
  });
}
document.addEventListener('click', () => {
  soundUnlocked = true; hint.style.opacity = 0;
  host.querySelectorAll('video.live-media[data-sound]').forEach((v) => { v.muted = false; });
});

function applyMediaCmd(cmd) {
  if (!cmd || lastCmd === null) { lastCmd = cmd?.id ?? 0; return; } // ignore the command that was current when we connected
  if (cmd.id === lastCmd) return;
  lastCmd = cmd.id;
  const v = host.querySelector('.slide:not(.leaving) video.live-media');
  if (!v) return;
  if (cmd.action === 'restart') { v.currentTime = 0; v.play().catch(() => {}); }
  if (cmd.action === 'toggle') v.paused ? v.play().catch(() => {}) : v.pause();
}

async function render(state) {
  const channel = state.channels.find((c) => c.id === chId) || state.channels[0];
  document.title = `${channel.name} — Ch ${chId} — Lumen`;
  const transparent = channel.mode === 'alpha';
  document.body.classList.toggle('transparent', transparent);
  const flags = { black: state.black || !channel.enabled, clear: state.clear, logo: state.logo };
  const live = state.live;
  const next = live?.pages > 1 && live.page < live.pages - 1
    ? `${formatRef(live.ref)} — screen ${live.page + 2} of ${live.pages}`
    : state.next ? (state.next.kind === 'scripture' ? formatRef(state.next.ref) : state.next.title || state.next.name) : '';
  const key = JSON.stringify([slideKey(state.live, channel, state), flags, channel, state.logoText, state.stageMessage, next]);
  applyMediaCmd(state.mediaCmd);
  if (key === lastKey) return;
  lastKey = key;
  const my = ++seq;
  const slide = await resolveSlide(state.live, channel, state);
  if (my !== seq) return; // a newer update arrived while loading
  const el = buildSlide(slide, channel, state, { ...flags, nextLabel: next });
  el.querySelectorAll('video.live-media:not([muted])').forEach((v) => v.setAttribute('data-sound', ''));
  show(host, el, channel.transition);
  startVideos();
}

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => { document.getElementById('offline').style.display = 'none'; render(JSON.parse(e.data)); });
  es.onerror = () => { document.getElementById('offline').style.display = 'block'; };
}
connect();

// Fullscreen + cursor handling
const toggleFs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
document.addEventListener('dblclick', toggleFs);
document.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFs(); });
let cursorTimer;
document.addEventListener('mousemove', () => {
  document.body.classList.remove('hide-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 2000);
});
setTimeout(() => { hint.style.opacity = 0; }, 3500);
if (params.has('embed')) hint.remove();

// "Identify" flash sent from the console
new BroadcastChannel('lumen').onmessage = (e) => {
  if (e.data?.type === 'identify') {
    const el = document.getElementById('ident');
    el.textContent = chId; el.style.display = 'grid';
    setTimeout(() => { el.style.display = 'none'; }, 1800);
  }
};
