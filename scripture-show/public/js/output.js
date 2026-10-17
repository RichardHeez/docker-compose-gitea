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

async function render(state) {
  const channel = state.channels.find((c) => c.id === chId) || state.channels[0];
  document.title = `${channel.name} — Ch ${chId} — Lumen`;
  const transparent = channel.mode === 'alpha';
  document.body.classList.toggle('transparent', transparent);
  const flags = { black: state.black || !channel.enabled, clear: state.clear, logo: state.logo };
  const next = state.next ? (state.next.kind === 'scripture' ? formatRef(state.next.ref) : state.next.title) : '';
  const key = JSON.stringify([slideKey(state.live, channel, state), flags, channel, state.logoText, state.stageMessage, next]);
  if (key === lastKey) return;
  lastKey = key;
  const my = ++seq;
  const slide = await resolveSlide(state.live, channel, state);
  if (my !== seq) return; // a newer update arrived while loading
  show(host, buildSlide(slide, channel, state, { ...flags, nextLabel: next }), channel.transition);
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
