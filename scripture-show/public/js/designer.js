// Slide editor (console): design custom slides and templates on a 16:9 canvas.
import { FONTS, autoScale, buildSlide, fitSlide } from './render.js';
import { ROLES, hasRole, newDesign, newElement } from './design.js';
import { MOTIONS, attachMotion, motionValue, parseMotion, motionLabel } from './motion.js';

let D; // deps from app.js
let cur = null;      // the design being edited (working copy)
let selId = null;    // selected element id
let saveTimer = null;
let listKey = '';
let drag = null;
let lastEsc = 0;

const clone = (x) => JSON.parse(JSON.stringify(x));
const uid = () => Math.random().toString(36).slice(2, 9);
const round = (v, step = 0.5) => Math.round(v / step) * step;
const S = () => D.getS();
const sel = () => cur?.elements.find((e) => e.id === selId) || null;
export const designItem = (d) => ({ kind: 'design', designId: d.id, name: d.name });

// ---------------------------------------------------------------- saving
function commit() {
  if (!cur) return;
  D.$('#dzSaved').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const list = S().designs || [];
    const designs = list.some((d) => d.id === cur.id) ? list.map((d) => (d.id === cur.id ? clone(cur) : d)) : [...list, clone(cur)];
    D.push({ designs });
    D.$('#dzSaved').textContent = 'Saved';
  }, 350);
}
const flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; const list = S().designs || []; D.push({ designs: list.some((d) => d.id === cur.id) ? list.map((d) => (d.id === cur.id ? clone(cur) : d)) : [...list, clone(cur)] }); } };

// ---------------------------------------------------------------- canvas
function previewChannel() {
  const s = S();
  const ch = s.channels.find((c) => c.id === Number(D.$('#dzCh').value)) || s.channels[0];
  return { ...ch, mode: 'full', template: '' };
}

function draw() {
  const host = D.$('#dzCanvas');
  const el = buildSlide({ kind: 'design', name: cur.name, design: cur }, previewChannel(), S(), { editing: true });
  el.classList.add('dz-slide');
  host.querySelectorAll('.slide').forEach((o) => o.remove());
  host.appendChild(el);
  attachMotion(el);
  fitSlide(el);
  decorate();
}

function decorate() {
  const host = D.$('#dzCanvas');
  host.querySelectorAll('.dz-handle,.dz-role-tag').forEach((n) => n.remove());
  host.querySelectorAll('.dz-edit').forEach((n) => {
    const e = cur.elements.find((x) => x.id === n.dataset.el); if (!e) return;
    n.classList.toggle('sel', e.id === selId);
    if (e.role) n.insertAdjacentHTML('beforeend', `<span class="dz-role-tag">${ROLES.find((r) => r[0] === e.role)?.[1].split(' (')[0] || e.role}</span>`);
    if (e.id === selId) for (const h of ['nw', 'ne', 'sw', 'se', 'e', 's']) n.insertAdjacentHTML('beforeend', `<div class="dz-handle" data-h="${h}"></div>`);
  });
}

function select(id) { selId = id; decorate(); renderProps(); }

// Snap a moving edge set to the canvas centre/edges and other boxes. Returns the shift to apply.
function snap(vals, axis, ignore) {
  if (!D.$('#dzGrid').checked) return { shift: 0, line: null };
  const lines = [0, 50, 100];
  for (const o of cur.elements) if (o.id !== ignore) {
    const a = axis === 'x' ? o.x : o.y, s = axis === 'x' ? o.w : o.h;
    lines.push(a, a + s / 2, a + s);
  }
  let best = { shift: 0, line: null, d: 0.9 };
  for (const v of vals) for (const l of lines) { const d = Math.abs(l - v); if (d < best.d) best = { shift: l - v, line: l, d }; }
  return best;
}

function guides(xl, yl) {
  const host = D.$('#dzCanvas');
  host.querySelectorAll('.dz-guide').forEach((n) => n.remove());
  if (xl != null) host.insertAdjacentHTML('beforeend', `<div class="dz-guide v" style="left:${xl}%"></div>`);
  if (yl != null) host.insertAdjacentHTML('beforeend', `<div class="dz-guide h" style="top:${yl}%"></div>`);
}

function onPointerDown(ev) {
  if (ev.target.closest('[contenteditable=true]')) return;
  const node = ev.target.closest('.dz-edit');
  if (!node) { select(null); return; }
  const e = cur.elements.find((x) => x.id === node.dataset.el); if (!e) return;
  if (e.id !== selId) select(e.id);
  const rect = D.$('#dzCanvas').getBoundingClientRect();
  drag = { id: e.id, handle: ev.target.dataset?.h || null, sx: ev.clientX, sy: ev.clientY, rect, start: { ...e }, moved: false };
  D.$('#dzCanvas').setPointerCapture(ev.pointerId);
  ev.preventDefault();
}

function onPointerMove(ev) {
  if (!drag) return;
  const e = cur.elements.find((x) => x.id === drag.id); if (!e) return;
  const dx = ((ev.clientX - drag.sx) / drag.rect.width) * 100, dy = ((ev.clientY - drag.sy) / drag.rect.height) * 100;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 0.3) return;
  drag.moved = true;
  const s = drag.start, h = drag.handle;
  let gx = null, gy = null;
  if (!h) {
    let x = round(s.x + dx), y = round(s.y + dy);
    const sx = snap([x, x + s.w / 2, x + s.w], 'x', e.id), sy = snap([y, y + s.h / 2, y + s.h], 'y', e.id);
    if (sx.line != null) { x += sx.shift; gx = sx.line; }
    if (sy.line != null) { y += sy.shift; gy = sy.line; }
    Object.assign(e, { x: +x.toFixed(2), y: +y.toFixed(2) });
  } else {
    let { x, y, w, h: hh } = s;
    if (h.includes('e')) { let r = round(s.x + s.w + dx); const sn = snap([r], 'x', e.id); if (sn.line != null) { r += sn.shift; gx = sn.line; } w = r - x; }
    if (h.includes('w')) { let l = round(s.x + dx); const sn = snap([l], 'x', e.id); if (sn.line != null) { l += sn.shift; gx = sn.line; } w = s.x + s.w - l; x = l; }
    if (h.includes('s')) { let b = round(s.y + s.h + dy); const sn = snap([b], 'y', e.id); if (sn.line != null) { b += sn.shift; gy = sn.line; } hh = b - y; }
    if (h === 'nw' || h === 'ne') { let t = round(s.y + dy); const sn = snap([t], 'y', e.id); if (sn.line != null) { t += sn.shift; gy = sn.line; } hh = s.y + s.h - t; y = t; }
    if (w < 1) { if (h.includes('w')) x -= 1 - w; w = 1; }
    if (hh < 0.5) { if (h === 'nw' || h === 'ne') y -= 0.5 - hh; hh = 0.5; }
    Object.assign(e, { x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2), h: +hh.toFixed(2) });
  }
  const node = D.$(`#dzCanvas .dz-edit[data-el="${e.id}"]`);
  if (node) {
    Object.assign(node.style, { left: `${e.x}%`, top: `${e.y}%`, width: `${e.w}%`, height: `${e.h}%` });
    if (h && e.type === 'text') fitSlide(node.closest('.slide'));
  }
  guides(gx, gy);
  updateGeomFields();
}

function onPointerUp() {
  if (!drag) return;
  const moved = drag.moved; drag = null;
  guides(null, null);
  if (moved) { commit(); draw(); }
}

function startTextEdit(ev) {
  // pointer capture retargets the dblclick to the canvas, so look up what is under the pointer
  const node = (document.elementFromPoint(ev.clientX, ev.clientY) || ev.target).closest('.dz-edit.dz-text'); if (!node) return;
  const e = cur.elements.find((x) => x.id === node.dataset.el); if (!e) return;
  select(e.id);
  const t = D.$(`#dzCanvas .dz-edit[data-el="${e.id}"] .dz-t`);
  t.contentEditable = 'true'; t.focus();
  document.getSelection().selectAllChildren(t);
  const done = () => {
    t.removeEventListener('blur', done);
    e.text = t.innerText.replace(/\n$/, '');
    commit(); draw(); renderProps();
  };
  t.addEventListener('blur', done);
  t.addEventListener('keydown', (k) => { if (k.key === 'Escape') { k.preventDefault(); lastEsc = Date.now(); t.blur(); } k.stopPropagation(); });
}

// ---------------------------------------------------------------- elements
function addElement(kind) {
  const roles = { body: { role: 'body', text: 'Main text — the verse or lyrics go here', x: 8, y: 20, w: 84, h: 56, size: 96 },
    reference: { role: 'reference', text: 'John 3:16 KJV', x: 8, y: 82, w: 84, h: 8, size: 40, color: '#ffd27a' },
    title: { role: 'title', text: 'Title', x: 8, y: 6, w: 84, h: 12, size: 72, bold: true } };
  let e;
  if (kind in roles) e = newElement('text', roles[kind]);
  else if (kind === 'text') e = newElement('text', { text: 'Your text', x: 25, y: 40, w: 50, h: 20 });
  else if (kind === 'image') e = newElement('image', { x: 35, y: 30, w: 30, h: 40, src: D.media().find((m) => m.type === 'image')?.url || '' });
  else e = newElement('shape', { x: 0, y: 70, w: 100, h: 30 });
  cur.elements.push(e);
  commit(); draw(); select(e.id);
}

function duplicateSel() {
  const e = sel(); if (!e) return;
  const c = { ...clone(e), id: uid(), x: e.x + 2, y: e.y + 2 };
  cur.elements.splice(cur.elements.indexOf(e) + 1, 0, c);
  commit(); draw(); select(c.id);
}
function deleteSel() {
  const e = sel(); if (!e) return;
  cur.elements = cur.elements.filter((x) => x !== e);
  selId = null; commit(); draw(); renderProps();
}
function order(dir) {
  const e = sel(); if (!e) return;
  const a = cur.elements; const i = a.indexOf(e); a.splice(i, 1);
  const j = dir === 'front' ? a.length : dir === 'back' ? 0 : Math.max(0, Math.min(a.length, i + (dir === 'up' ? 1 : -1)));
  a.splice(j, 0, e); commit(); draw(); renderProps();
}

// ---------------------------------------------------------------- properties panel
const opts = (list, v) => list.map(([k, l]) => `<option value="${D.esc(k)}" ${String(k) === String(v ?? '') ? 'selected' : ''}>${D.esc(l)}</option>`).join('');
const numF = (p, label, v, step = 0.5) => `<label>${label}<input type="number" data-p="${p}" step="${step}" value="${v}"></label>`;
const rangeF = (p, label, v, min, max, step = 1) => `<label>${label} <input type="range" data-p="${p}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
const checkF = (p, label, on) => `<label class="check"><input type="checkbox" data-p="${p}" ${on ? 'checked' : ''}> ${label}</label>`;
const segF = (p, v, list) => `<div class="seg2">${list.map(([k, l]) => `<button type="button" data-p="${p}" data-v="${k}" class="${v === k ? 'on' : ''}" title="${k}">${l}</button>`).join('')}</div>`;

function updateGeomFields() {
  const e = sel(); if (!e) return;
  for (const k of ['x', 'y', 'w', 'h']) { const f = D.$(`#dzProps [data-p="${k}"]`); if (f && document.activeElement !== f) f.value = e[k]; }
}

function renderProps() {
  const box = D.$('#dzProps'); const e = sel(); const esc = D.esc;
  const layers = `<h5>Layers (top first)</h5>${[...cur.elements].reverse().map((x) => `<button type="button" class="btn ghost sm" data-layer="${x.id}" style="text-align:left;${x.id === selId ? 'border-color:var(--accent)' : ''}">${x.type === 'text' ? (x.role ? '¶ ' + (ROLES.find((r) => r[0] === x.role)?.[1].split(' (')[0]) : 'T ' + esc(String(x.text).slice(0, 22))) : x.type === 'image' ? '▣ Image' : '■ Shape'}</button>`).join('') || '<p class="muted small">Nothing yet — add a text box.</p>'}`;
  if (!e) {
    const s = S(); const tpl = hasRole(cur, 'body');
    box.innerHTML = `<h5>This design</h5>
      <p class="muted small">${tpl ? 'This is a <b>template</b>: verses, songs and text slides fill the “Main text” box on the outputs that use it.' : 'A custom slide. Add a <b>Main text</b> box to turn it into a template for verses and songs.'}</p>
      ${tpl ? `<h5>Use as template on</h5>${s.channels.map((c) => `<label class="check"><input type="checkbox" data-tpl-ch="${c.id}" ${c.template === cur.id ? 'checked' : ''}> ${c.id}. ${esc(c.name)}</label>`).join('')}` : ''}
      ${layers}`;
    return;
  }
  let html = `<div class="row"><b style="flex:1">${e.type === 'text' ? 'Text box' : e.type === 'image' ? 'Image' : 'Shape'}</b>
    <button class="btn ghost sm" type="button" data-do="dup" title="Duplicate (Ctrl+D)">⧉</button><button class="btn ghost sm" type="button" data-do="del" title="Delete">🗑</button></div>
    <h5>Position (% of screen)</h5>
    <div class="grid4">${numF('x', 'X', e.x)}${numF('y', 'Y', e.y)}${numF('w', 'W', e.w)}${numF('h', 'H', e.h)}</div>
    <div class="row"><button class="btn ghost sm" type="button" data-do="cx">Centre ↔</button><button class="btn ghost sm" type="button" data-do="cy">Centre ↕</button><button class="btn ghost sm" type="button" data-do="fill">Full screen</button></div>
    <div class="grid2">${rangeF('opacity', 'Opacity', e.opacity, 0, 100)}${numF('rotate', 'Rotate °', e.rotate || 0, 1)}</div>
    <div class="seg2"><button type="button" data-do="back" title="Send to back">⤓ Back</button><button type="button" data-do="down">↓</button><button type="button" data-do="up">↑</button><button type="button" data-do="front" title="Bring to front">⤒ Front</button></div>`;
  if (e.type === 'text') {
    html += `<h5>Text</h5>
      <label>Box content<select data-p="role">${opts(ROLES, e.role)}</select></label>
      <label>${e.role ? 'Sample text (replaced live)' : 'Text'}<textarea data-p="text" rows="3">${esc(e.text)}</textarea></label>
      <label>Font<select data-p="font">${opts(Object.entries(FONTS).map(([k, l]) => [k, k ? l : 'Output’s font']), e.font)}</select></label>
      <div class="grid2">${numF('size', 'Size (px @1080p)', e.size, 2)}<label>Colour<input type="color" data-p="color" value="${e.color}"></label></div>
      ${segF('align', e.align, [['left', '⇤'], ['center', '↔'], ['right', '⇥']])}
      ${segF('valign', e.valign, [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']])}
      <div class="grid2">${checkF('bold', 'Bold', e.bold)}${checkF('italic', 'Italic', e.italic)}${checkF('upper', 'CAPS', e.upper)}${checkF('shadow', 'Shadow', e.shadow)}</div>
      ${checkF('fit', 'Shrink text to fit the box', e.fit)}
      <div class="grid2">${rangeF('lineHeight', 'Line spacing', e.lineHeight, 0.8, 2, 0.05)}${rangeF('outline', 'Outline', e.outline, 0, 10)}</div>
      <h5>Box</h5>
      ${checkF('hasFill', 'Fill behind text', !!e.fill)}
      <div class="grid2"><label>Fill colour<input type="color" data-p="fill" value="${e.fill || '#000000'}"></label>${rangeF('padding', 'Padding', e.padding, 0, 10)}</div>
      ${rangeF('radius', 'Rounded corners', e.radius, 0, 20)}`;
  } else if (e.type === 'image') {
    const media = D.media().filter((m) => m.type === 'image' || m.type === 'video');
    const known = media.some((m) => m.url === e.src);
    html += `<h5>Image</h5>
      <label>From media library<select data-p="src">${opts([['', '— choose —'], ...media.map((m) => [m.url, `${m.type === 'video' ? '🎬' : '🖼'} ${m.name}`])], known ? e.src : '')}</select></label>
      <label>…or URL<input data-p="src" value="${known ? '' : esc(e.src)}" placeholder="https://…/logo.png"></label>
      <label>Fit<select data-p="fit">${opts([['contain', 'Show whole image'], ['cover', 'Fill the box']], e.fit)}</select></label>
      ${rangeF('radius', 'Rounded corners', e.radius, 0, 50)}`;
  } else {
    html += `<h5>Shape</h5>
      <label>Colour<input type="color" data-p="fill" value="${e.fill}"></label>
      ${rangeF('radius', 'Rounded corners', e.radius, 0, 50)}
      <div class="grid2">${rangeF('border', 'Border', e.border, 0, 20)}<label>Border colour<input type="color" data-p="borderColor" value="${e.borderColor}"></label></div>`;
  }
  box.innerHTML = html + layers;
}

function onPropInput(ev) {
  const f = ev.target.closest('[data-p]'); const e = sel();
  if (!f || !e || f.tagName === 'BUTTON') return;
  const p = f.dataset.p;
  let v = f.type === 'checkbox' ? f.checked : f.value;
  if (p === 'hasFill') { e.fill = v ? (D.$('#dzProps [data-p="fill"]').value || '#000000') : ''; }
  else if (p === 'fill' && e.type === 'text' && !D.$('#dzProps [data-p="hasFill"]').checked) return;
  else {
    if (f.type === 'number' || f.type === 'range') { v = Number(v); if (!Number.isFinite(v)) return; }
    e[p] = v;
  }
  commit(); draw();
  if (p === 'role' || (p === 'src' && ev.type === 'change')) renderProps();
}

function onPropClick(ev) {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.layer) return select(b.dataset.layer);
  const e = sel();
  if (b.dataset.p && b.dataset.v && e) { e[b.dataset.p] = b.dataset.v; commit(); draw(); renderProps(); return; }
  const act = b.dataset.do; if (!act || !e) return;
  if (act === 'dup') return duplicateSel();
  if (act === 'del') return deleteSel();
  if (['front', 'back', 'up', 'down'].includes(act)) return order(act);
  if (act === 'cx') e.x = +(50 - e.w / 2).toFixed(2);
  if (act === 'cy') e.y = +(50 - e.h / 2).toFixed(2);
  if (act === 'fill') Object.assign(e, { x: 0, y: 0, w: 100, h: 100 });
  commit(); draw(); updateGeomFields();
}

function onTplToggle(ev) {
  const f = ev.target.closest('[data-tpl-ch]'); if (!f) return;
  const id = Number(f.dataset.tplCh);
  flush();
  D.push({ channels: S().channels.map((c) => (c.id === id ? { ...c, template: f.checked ? cur.id : (c.template === cur.id ? '' : c.template) } : c)) });
}

// ---------------------------------------------------------------- open / pick
function fillPickers() {
  const s = S();
  D.$('#dzPick').innerHTML = opts((s.designs || []).map((d) => [d.id, d.name]).concat(cur && !(s.designs || []).some((d) => d.id === cur.id) ? [[cur.id, cur.name]] : []), cur?.id);
  D.$('#dzCh').innerHTML = opts(s.channels.map((c) => [c.id, `${c.id}. ${c.name}`]), D.$('#dzCh').value || 1);
  const media = D.media().filter((m) => m.type === 'image' || m.type === 'video');
  const bg = cur?.background || '';
  const isColor = /^#/.test(bg);
  const motions = [...MOTIONS.map(([id]) => { const v = parseMotion(bg)?.effect === id ? bg : motionValue(id); return [v, motionLabel(v)]; }),
    ...(S().motions || []).map((m) => [`mymotion:${m.id}`, `✨ ${m.name} (yours)`])];
  D.$('#dzBg').innerHTML = opts([['', 'Output’s background'], ['color', 'Solid colour'], ...motions, ...media.map((m) => [m.url, `${m.type === 'video' ? '🎬' : '🖼'} ${m.name}`])], isColor ? 'color' : bg);
  D.$('#dzBgColor').hidden = !isColor;
  if (isColor) D.$('#dzBgColor').value = bg.length === 7 ? bg : '#000000';
}

export function openDesigner(id) {
  const s = S();
  let d = (s.designs || []).find((x) => x.id === id);
  if (!d) { d = newDesign(`Slide ${(s.designs || []).length + 1}`); cur = d; commit(); }
  cur = clone(d); selId = null;
  D.$('#dzName').value = cur.name;
  D.$('#dzSaved').textContent = '';
  fillPickers();
  const dlg = D.$('#designer');
  if (!dlg.open) dlg.showModal();
  draw(); renderProps();
}

function close() { if (saveTimer) flush(); D.$('#designer').close(); }

// ---------------------------------------------------------------- Show tab list
function renderList() {
  const s = S(); const list = s.designs || [];
  const ch = { ...s.channels[0], mode: 'full', template: '' };
  const key = JSON.stringify([list, ch.background, ch.theme, ch.fontFamily]);
  if (key === listKey) return; listKey = key;
  const box = D.$('#dzList');
  box.innerHTML = list.map((d) => `<div class="dz-card" data-id="${D.esc(d.id)}"><div class="stage-host" data-pv title="Preview">${hasRole(d, 'body') ? '<span class="tag">TEMPLATE</span>' : ''}</div>
    <div class="dz-card-foot"><b title="${D.esc(d.name)}">${D.esc(d.name)}</b>
    <button data-a="edit" title="Edit">✎</button><button data-a="svc" title="Add to service">＋</button><button data-a="live" title="Go live">▶</button></div></div>`).join('') || '<p class="muted small">No slides yet.</p>';
  box.querySelectorAll('.dz-card').forEach((card) => {
    const d = list.find((x) => x.id === card.dataset.id); const host = card.querySelector('[data-pv]');
    autoScale(host);
    const el = buildSlide({ kind: 'design', name: d.name, design: d }, ch, s, { preview: true });
    host.appendChild(el); attachMotion(el); requestAnimationFrame(() => fitSlide(el));
  });
}

export function onState(s) {
  renderList();
  if (D.$('#designer').open && !drag) fillPickers();
}

export function initDesigner(deps) {
  D = deps;
  const { $ } = D;
  autoScale($('#dzCanvas'));
  $('#dzNew').onclick = () => openDesigner(null);
  $('#dzList').addEventListener('click', (ev) => {
    const card = ev.target.closest('.dz-card'); if (!card) return;
    const d = (S().designs || []).find((x) => x.id === card.dataset.id); if (!d) return;
    const a = ev.target.closest('button')?.dataset.a;
    if (a === 'edit') openDesigner(d.id);
    else if (a === 'svc') { D.addToService(designItem(d)); D.toast(`Added “${d.name}” to the service`); }
    else if (a === 'live') D.goLive(designItem(d));
    else D.setPreview(designItem(d));
  });
  $('#dzList').addEventListener('dblclick', (ev) => { const card = ev.target.closest('.dz-card'); if (card) openDesigner(card.dataset.id); });

  const canvas = $('#dzCanvas');
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('dblclick', startTextEdit);
  D.$$('#designer [data-add]').forEach((b) => { b.onclick = () => addElement(b.dataset.add); });
  $('#dzProps').addEventListener('input', onPropInput);
  $('#dzProps').addEventListener('change', (ev) => { if (ev.target.closest('[data-tpl-ch]')) onTplToggle(ev); else if (ev.target.tagName === 'SELECT') onPropInput(ev); });
  $('#dzProps').addEventListener('click', onPropClick);
  $('#dzName').oninput = () => { cur.name = $('#dzName').value || 'Slide'; commit(); };
  $('#dzName').onchange = () => fillPickers();
  $('#dzPick').onchange = () => { flush(); openDesigner($('#dzPick').value); };
  $('#dzCh').onchange = () => draw();
  $('#dzGrid').onchange = () => {};
  $('#dzBg').onchange = () => { const v = $('#dzBg').value; cur.background = v === 'color' ? $('#dzBgColor').value : v; fillPickers(); commit(); draw(); };
  $('#dzBgColor').oninput = () => { cur.background = $('#dzBgColor').value; commit(); draw(); };
  $('#dzDup').onclick = () => { flush(); const c = { ...clone(cur), id: uid(), name: `${cur.name} copy` }; D.push({ designs: [...(S().designs || []), c] }); openDesignerWith(c); };
  $('#dzDel').onclick = () => {
    if (!confirm(`Delete “${cur.name}”?`)) return;
    clearTimeout(saveTimer); saveTimer = null;
    const designs = (S().designs || []).filter((d) => d.id !== cur.id);
    D.push({ designs, channels: S().channels.map((c) => (c.template === cur.id ? { ...c, template: '' } : c)) });
    close();
  };
  $('#dzClose').onclick = close;
  // Esc: finish typing, then deselect, then close the editor.
  $('#designer').addEventListener('cancel', (ev) => {
    ev.preventDefault();
    if (document.activeElement?.isContentEditable) document.activeElement.blur();
    else if (Date.now() - lastEsc < 400) { /* that Esc already ended text editing */ }
    else if (selId) select(null);
    else close();
  });
  $('#dzPreview').onclick = () => { flush(); D.setPreview(designItem(cur)); };
  $('#dzLive').onclick = () => { flush(); D.goLive(designItem(cur)); D.toast(`“${cur.name}” is live`); };
  $('#dzService').onclick = () => { flush(); D.addToService(designItem(cur)); D.toast(`Added “${cur.name}” to the service`); };
  $('#designer').addEventListener('keydown', (ev) => {
    const a = document.activeElement;
    if (a && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName))) return;
    const e = sel();
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicateSel(); return; }
    if (!e) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSel(); return; }
    const step = ev.shiftKey ? 5 : 0.5;
    const mv = { ArrowLeft: ['x', -step], ArrowRight: ['x', step], ArrowUp: ['y', -step], ArrowDown: ['y', step] }[ev.key];
    if (mv) { ev.preventDefault(); e[mv[0]] = +(e[mv[0]] + mv[1]).toFixed(2); commit(); draw(); updateGeomFields(); }
  });
}

// Open a design that may not be in state yet (just duplicated).
function openDesignerWith(d) {
  cur = clone(d); selId = null;
  D.$('#dzName').value = cur.name;
  fillPickers(); draw(); renderProps();
}
