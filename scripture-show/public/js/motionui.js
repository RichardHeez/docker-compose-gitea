// Console: AI motion maker, saved motions, and getting motion loops from stock libraries and church stores.
import { MOTIONS, attachMotion, cleanSpec } from './motion.js';

let C;
let draft = null; // AI result not saved yet
let stockList = [];

export const SITES = [
  { name: 'Church Motion Graphics', url: 'https://www.churchmotiongraphics.com', note: 'Big library of worship loops and series packs', tag: 'Paid · free stills' },
  { name: 'Motion Worship', url: 'https://www.motionworship.com', note: 'Loops, countdowns, mini-movies; some free', tag: 'Paid · some free' },
  { name: 'Sharefaith', url: 'https://www.sharefaith.com', note: 'Motion loops, slides and media subscription', tag: 'Subscription' },
  { name: 'CreationSwap', url: 'https://www.creationswap.com', note: 'Buy from independent Christian artists', tag: 'Paid · some free' },
  { name: 'WorshipHouse Media', url: 'https://www.worshiphousemedia.com', note: 'Motion backgrounds, countdowns, mini-movies', tag: 'Paid' },
  { name: 'Igniter Media', url: 'https://www.ignitermedia.com', note: 'Countdowns, backgrounds and sermon videos', tag: 'Paid' },
  { name: 'Centerline New Media', url: 'https://www.centerlinenewmedia.com', note: 'Worship motion loops and stills', tag: 'Paid' },
  { name: 'Shift Worship', url: 'https://shiftworship.com/motions', note: 'Motion backgrounds for church media', tag: 'Paid' },
  { name: 'Pixel Preacher', url: 'https://www.pixelpreacher.com', note: 'Free worship motion loops', tag: 'Free', free: true },
  { name: 'Pexels Videos', url: 'https://www.pexels.com/videos/', note: 'Free stock video — search it here too', tag: 'Free', free: true },
  { name: 'Pixabay Videos', url: 'https://pixabay.com/videos/', note: 'Free stock video — search it here too', tag: 'Free', free: true },
];

const chOptions = () => (C.getS()?.channels || []).map((c) => `<option value="${c.id}">Ch ${c.id} · ${C.esc(c.name)}</option>`).join('');
const useSelect = (label = 'Use as background…') => `<select data-use><option value="">${label}</option><option value="all">All full-screen channels</option>${chOptions()}</select>`;
const describe = (spec) => spec.layers.map((l) => `${MOTIONS.find(([id]) => id === l.effect)?.[1] || l.effect}${l.speed < 0.8 ? ' (slow)' : l.speed > 1.3 ? ' (lively)' : ''}`).join(' + ');

function useAsBackground(value, target, label) {
  const S = C.getS();
  C.push({ channels: S.channels.map((c) => ((target === 'all' ? c.mode === 'full' : c.id === Number(target)) ? { ...c, background: value } : c)) });
  C.toast(`${label} set as background`);
}

// ---------------------------------------------------------------- AI maker
async function create(prompt) {
  const btn = C.$('#aimForm button'); btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const r = await C.postJson('/api/ai/motion', { prompt });
    draft = r.spec;
    C.$('#aimResult').hidden = false;
    C.$('#aimPrev').innerHTML = `<canvas data-motion-spec="${C.esc(JSON.stringify(draft))}"></canvas>`;
    attachMotion(C.$('#aimPrev'));
    C.$('#aimName').value = draft.name;
    C.$('#aimInfo').textContent = `${describe(draft)} · ${r.ai ? 'designed by AI' : r.note || 'made with the built-in designer (add ANTHROPIC_API_KEY for AI)'}`;
  } catch (e) { C.toast(e.message, true); }
  btn.disabled = false; btn.textContent = 'Create';
}

function renderMine() {
  const list = C.getS()?.motions || [];
  C.$('#myMotionsBox').hidden = !list.length;
  const key = JSON.stringify(list) + chOptions();
  if (C.$('#myMotions').dataset.key === key) return;
  C.$('#myMotions').dataset.key = key;
  C.$('#myMotions').innerHTML = list.map((m) => `<div class="mb" data-id="${C.esc(m.id)}"><div class="mb-prev"><canvas data-motion-spec="${C.esc(JSON.stringify(m))}"></canvas></div>
    <b title="${C.esc(m.prompt)}">${C.esc(m.name)}</b><div class="mb-acts">${useSelect()}<button class="x" data-del title="Delete">✕</button></div></div>`).join('');
  attachMotion(C.$('#myMotions'));
}

// ---------------------------------------------------------------- stock
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
async function search() {
  const q = C.$('#stockQ').value.trim() || 'worship background loop'; const src = C.$('#stockSrc').value;
  C.$('#stockResults').innerHTML = '<p class="muted small">Searching…</p>';
  try {
    stockList = (await C.api(`/api/stock/search?src=${src}&q=${encodeURIComponent(q)}`)).results;
    C.$('#stockCredit').innerHTML = src === 'pexels' ? 'Videos provided by <a href="https://www.pexels.com" target="_blank" rel="noopener">Pexels</a>' : 'Videos from <a href="https://pixabay.com" target="_blank" rel="noopener">Pixabay</a>';
    C.$('#stockResults').innerHTML = stockList.length ? stockList.map((v, i) => `<div class="stock" data-i="${i}">
      <div class="thumb" style="background-image:url('${C.esc(v.thumb)}')" title="Click to preview"><span class="dur">${fmtDur(v.duration)}${v.maxWidth >= 3840 ? ' · 4K' : ''}</span></div>
      <span class="by">${C.esc(v.title)}${v.author ? ` · ${C.esc(v.author)}` : ''}</span>
      <button class="btn sm" type="button" data-import>⬇ Import</button></div>`).join('') : '<p class="muted small">Nothing found — try other words.</p>';
  } catch (e) { C.$('#stockResults').innerHTML = `<p class="muted small">${C.esc(e.message)}</p>`; }
}

export function onState(s, prev) {
  if (!prev || JSON.stringify(prev.motions) !== JSON.stringify(s.motions) || JSON.stringify(prev.channels?.map((c) => c.name)) !== JSON.stringify(s.channels.map((c) => c.name))) renderMine();
}

export function init(deps) {
  C = deps;
  const { $ } = C;
  $('#aimForm').onsubmit = (e) => { e.preventDefault(); const p = $('#aimPrompt').value.trim(); if (!p) return C.toast('Describe the background first', true); create(p); };
  $('#aimAgain').onclick = () => create($('#aimPrompt').value.trim() || draft?.prompt || 'worship background');
  $('#aimSave').onclick = () => {
    if (!draft) return;
    const spec = cleanSpec({ ...draft, id: Math.random().toString(36).slice(2, 9), name: $('#aimName').value.trim() || draft.name });
    C.push({ motions: [...(C.getS().motions || []), spec] });
    C.toast(`Saved “${spec.name}” — pick it under Your motions, an output’s background or a slide design`);
    $('#aimResult').hidden = true; draft = null;
  };
  $('#myMotions').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-use]'); if (!sel?.value) return;
    const m = (C.getS().motions || []).find((x) => x.id === e.target.closest('.mb').dataset.id);
    if (m) useAsBackground(`mymotion:${m.id}`, sel.value, m.name); sel.value = '';
  });
  $('#myMotions').addEventListener('click', (e) => {
    if (!e.target.closest('[data-del]')) return;
    const id = e.target.closest('.mb').dataset.id; const m = (C.getS().motions || []).find((x) => x.id === id);
    if (!m || !confirm(`Delete “${m.name}”?`)) return;
    const S = C.getS();
    C.push({ motions: S.motions.filter((x) => x.id !== id), channels: S.channels.map((c) => (c.background === `mymotion:${id}` ? { ...c, background: '' } : c)) });
  });

  $('#stockSites').innerHTML = SITES.map((s) => `<a class="stock-site" href="${s.url}" target="_blank" rel="noopener"><b>${C.esc(s.name)}</b><small>${C.esc(s.note)}</small><span class="tag ${s.free ? 'free' : ''}">${C.esc(s.tag)}</span></a>`).join('');
  C.api('/api/stock/status').then((st) => {
    $('#stockSetup').hidden = st.pexels || st.pixabay;
    if (!st.pexels && st.pixabay) $('#stockSrc').value = 'pixabay';
  }).catch(() => {});
  $('#stockForm').onsubmit = (e) => { e.preventDefault(); search(); };
  $('#stockResults').addEventListener('click', async (e) => {
    const card = e.target.closest('.stock'); if (!card) return;
    const v = stockList[Number(card.dataset.i)];
    if (e.target.closest('.thumb') && v.preview) {
      const th = card.querySelector('.thumb');
      if (!th.querySelector('video')) th.insertAdjacentHTML('afterbegin', `<video src="${C.esc(v.preview)}" autoplay muted loop playsinline></video>`);
      return;
    }
    const b = e.target.closest('[data-import]'); if (!b) return;
    b.disabled = true; b.textContent = 'Downloading…';
    try {
      const r = await C.postJson('/api/stock/import', { src: v.source, id: v.id, quality: $('#stock4k').checked ? '4k' : 'hd' });
      b.textContent = '✓ In Media'; C.toast(`Imported “${r.file}”${r.author ? ` (by ${r.author})` : ''} — set it as a background in the Media library`);
      C.reloadMedia();
    } catch (err) { b.disabled = false; b.textContent = '⬇ Import'; C.toast(err.message, true); }
  });
}
