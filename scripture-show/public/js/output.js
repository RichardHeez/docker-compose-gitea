// Output window / OBS browser source: /output.html?ch=N
import { formatRef } from './books.js';
import { autoScale, buildSlide, resolveSlide, show, slideKey, updateTimers } from './render.js';
import { fillTokens, syncClock, timerRelevant } from './timers.js';

const params = new URLSearchParams(location.search);
const chId = Number(params.get('ch') || 1);
const host = document.getElementById('host');
const hint = document.getElementById('hint');
autoScale(host);
const overlays = document.createElement('div');
overlays.className = 'overlays';
host.appendChild(overlays);
let S = null;

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

const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Props (logo bugs, watermarks) and operator messages, drawn above whatever slide is showing.
let overlayKey = '';
function renderOverlays(state, channel) {
  const stage = channel.mode === 'stage' || channel.mode === 'confidence';
  const props = channel.showProps === false || stage ? [] : (state.props || []).filter((p) => p.visible && !(state.clearMedia && p.kind === 'media'));
  const msg = state.message || {};
  const showMsg = msg.visible && msg.text && channel.showMessages !== false && !stage && channel.enabled;
  const timers = stage ? (state.timers || []).filter((t) => timerRelevant(t)).slice(0, 3) : [];
  const key = JSON.stringify([props, showMsg && msg, timers.map((t) => t.id), channel.enabled]);
  if (key !== overlayKey) {
    overlayKey = key;
    const propHtml = props.map((p) => {
      const style = `--op:${(Number(p.opacity) || 100) / 100};${p.position === 'full' ? '' : `width:${Number(p.size) || 12}%;`}`;
      if (p.kind === 'text') return `<div class="prop text ${esc(p.position)}" style="--op:${(Number(p.opacity) || 100) / 100};font-size:calc(var(--u) * ${(Number(p.size) || 12) / 7.5})">${esc(p.text)}</div>`;
      const media = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(p.url) ? `<video src="${esc(p.url)}" autoplay muted loop playsinline></video>` : `<img src="${esc(p.url)}" alt="">`;
      return `<div class="prop ${esc(p.position || 'top-right')}" style="${style}">${media}</div>`;
    }).join('');
    const msgHtml = showMsg ? `<div class="msg ${esc(msg.style || 'lower')}" style="--dur:${Math.max(10, String(msg.text).length / 4)}s"><span data-msg></span></div>` : '';
    const timerHtml = timers.length ? `<div class="stage-timers">${timers.map((t) => `<div><small>${esc(t.name)}</small><b data-timer="${esc(t.id)}"></b></div>`).join('')}</div>` : '';
    overlays.innerHTML = propHtml + msgHtml + timerHtml;
  }
  tick();
}

// Once a second: timers, clock tokens in messages.
function tick() {
  if (!S) return;
  updateTimers(host, S);
  const m = overlays.querySelector('[data-msg]');
  if (m) m.textContent = fillTokens(S.message?.text, S.timers);
}
setInterval(tick, 250);

async function render(state) {
  S = state; show.state = state;
  syncClock(state.serverNow);
  const channel0 = state.channels.find((c) => c.id === chId) || state.channels[0];
  // "Clear media" hides backgrounds and media on every screen.
  const channel = state.clearMedia ? { ...channel0, background: '' } : channel0;
  renderOverlays(state, channel);
  document.title = `${channel.name} — Ch ${chId} — F8`;
  const transparent = channel.mode === 'alpha';
  document.body.classList.toggle('transparent', transparent);
  const flags = { black: state.black || !channel.enabled, clear: state.clear, logo: state.logo };
  // Announcement screens loop their own playlist instead of following the live slide.
  let live = state.live;
  if (channel.mode === 'announce') {
    const a = state.announcements || {};
    live = a.playing && a.items?.length ? a.items[(a.index || 0) % a.items.length] : null;
  }
  if (state.clearMedia && live?.kind === 'media') live = null;
  const next = live?.pages > 1 && live.page < live.pages - 1
    ? `${formatRef(live.ref)} — screen ${live.page + 2} of ${live.pages}`
    : state.next ? (state.next.kind === 'scripture' ? formatRef(state.next.ref) : state.next.title || state.next.name) : '';
  const notes = state.live?.notes || '';
  const key = JSON.stringify([slideKey(live, channel, state), flags, channel, state.logoText, state.stageMessage, next, notes]);
  applyMediaCmd(state.mediaCmd);
  if (key === lastKey) return;
  lastKey = key;
  const my = ++seq;
  const slide = await resolveSlide(live, channel, state);
  if (my !== seq) return; // a newer update arrived while loading
  const el = buildSlide(slide, channel, state, { ...flags, nextLabel: next, notes });
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
new BroadcastChannel('f8').onmessage = (e) => {
  if (e.data?.type === 'identify') {
    const el = document.getElementById('ident');
    el.textContent = chId; el.style.display = 'grid';
    setTimeout(() => { el.style.display = 'none'; }, 1800);
  }
};
