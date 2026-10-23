// Slide designs: free-form slides and templates made of positioned boxes, like ProPresenter's slide editor.
// A design = { id, name, background: '' | '#rrggbb' | media URL, elements: [...] }.
// Element positions are % of the screen (x, y, w, h), so a design looks the same on any resolution.
// Text sizes are pixels on a 1920-wide screen and scale with the output.
// A text box with a `role` (body | reference | title) is filled with the live scripture / lyrics / text
// when the design is used as a channel template.

import { motionCanvas } from './motion.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d, lo = -Infinity, hi = Infinity) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const color = (v, d) => (/^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? v : d);
const uid = () => Math.random().toString(36).slice(2, 9);

export const ROLES = [['', 'Fixed text'], ['body', 'Main text (verse / lyrics)'], ['reference', 'Reference / credit'], ['title', 'Title (song or slide title)']];

export function newElement(type, extra = {}) {
  const base = { id: uid(), type, x: 10, y: 35, w: 80, h: 30, rotate: 0, opacity: 100 };
  if (type === 'text') return { ...base, text: 'Double-click to edit', role: '', font: '', size: 80, color: '#ffffff', align: 'center', valign: 'middle', bold: false, italic: false, upper: false, shadow: true, outline: 0, fit: true, lineHeight: 1.2, fill: '', radius: 0, padding: 2, ...extra };
  if (type === 'image') return { ...base, src: '', fit: 'contain', radius: 0, ...extra };
  return { ...base, type: 'shape', fill: '#1b2350', radius: 0, border: 0, borderColor: '#ffffff', ...extra, opacity: extra.opacity ?? 60 };
}

export function newDesign(name = 'New slide') { return { id: uid(), name, background: '', elements: [] }; }

export const STARTER_DESIGNS = [
  { id: 'tpl-lower-bar', name: 'Lower third bar', background: '', elements: [
    { id: 'bar', type: 'shape', x: 0, y: 72, w: 100, h: 28, rotate: 0, opacity: 70, fill: '#0b1020', radius: 0, border: 0, borderColor: '#ffffff' },
    { id: 'accent', type: 'shape', x: 4, y: 75, w: 0.6, h: 22, rotate: 0, opacity: 100, fill: '#f5b94a', radius: 0, border: 0, borderColor: '#ffffff' },
    { ...newElement('text'), id: 'body', role: 'body', x: 6, y: 74, w: 88, h: 18, size: 64, align: 'left', text: 'For God so loved the world…' },
    { ...newElement('text'), id: 'ref', role: 'reference', x: 6, y: 92, w: 88, h: 6, size: 34, align: 'left', color: '#f5b94a', fit: true, text: 'John 3:16 KJV' },
  ] },
  { id: 'tpl-title-body', name: 'Title over text', background: '', elements: [
    { ...newElement('text'), id: 'title', role: 'title', x: 8, y: 8, w: 84, h: 14, size: 72, bold: true, color: '#f5b94a', text: 'Title' },
    { ...newElement('text'), id: 'body', role: 'body', x: 8, y: 25, w: 84, h: 58, size: 96, text: 'Main text' },
    { ...newElement('text'), id: 'ref', role: 'reference', x: 8, y: 86, w: 84, h: 7, size: 36, color: '#cfd6ff', text: 'Reference' },
  ] },
  { id: 'welcome', name: 'Welcome slide', background: '', elements: [
    { ...newElement('text'), id: 'w1', x: 10, y: 30, w: 80, h: 22, size: 150, bold: true, text: 'Welcome' },
    { ...newElement('text'), id: 'w2', x: 15, y: 54, w: 70, h: 10, size: 54, color: '#f5b94a', text: 'We’re glad you’re here' },
    { id: 'line', type: 'shape', x: 40, y: 66, w: 20, h: 0.5, rotate: 0, opacity: 100, fill: '#ffffff', radius: 0, border: 0, borderColor: '#ffffff' },
  ] },
];

// Make a design safe to store and render (it arrives from any console on the network).
export function cleanDesign(d) {
  if (!d || typeof d !== 'object') return null;
  const out = { id: String(d.id || uid()).slice(0, 40), name: String(d.name || 'Slide').slice(0, 120), background: String(d.background || '').slice(0, 500), elements: [] };
  for (const e of Array.isArray(d.elements) ? d.elements.slice(0, 60) : []) {
    const type = ['text', 'image', 'shape'].includes(e?.type) ? e.type : null;
    if (!type) continue;
    const el = { id: String(e.id || uid()).slice(0, 40), type, x: num(e.x, 0, -50, 150), y: num(e.y, 0, -50, 150), w: num(e.w, 10, 0.1, 200), h: num(e.h, 10, 0.1, 200), rotate: num(e.rotate, 0, -360, 360), opacity: num(e.opacity, 100, 0, 100) };
    if (type === 'text') Object.assign(el, { text: String(e.text ?? '').slice(0, 5000), role: ['body', 'reference', 'title'].includes(e.role) ? e.role : '', font: String(e.font || '').slice(0, 60),
      size: num(e.size, 80, 8, 600), color: color(e.color, '#ffffff'), align: ['left', 'right', 'center'].includes(e.align) ? e.align : 'center', valign: ['top', 'bottom', 'middle'].includes(e.valign) ? e.valign : 'middle',
      bold: !!e.bold, italic: !!e.italic, upper: !!e.upper, shadow: e.shadow !== false, outline: num(e.outline, 0, 0, 10), fit: e.fit !== false, lineHeight: num(e.lineHeight, 1.2, 0.8, 2.5),
      fill: e.fill ? color(e.fill, '') : '', radius: num(e.radius, 0, 0, 50), padding: num(e.padding, 2, 0, 20) });
    if (type === 'image') Object.assign(el, { src: String(e.src || '').slice(0, 500), fit: e.fit === 'cover' ? 'cover' : 'contain', radius: num(e.radius, 0, 0, 50) });
    if (type === 'shape') Object.assign(el, { fill: color(e.fill, '#000000'), radius: num(e.radius, 0, 0, 50), border: num(e.border, 0, 0, 20), borderColor: color(e.borderColor, '#ffffff') });
    out.elements.push(el);
  }
  return out;
}

export const findDesign = (state, id) => (id ? (state?.designs || []).find((d) => d.id === id) || null : null);
export const hasRole = (design, role) => !!design?.elements?.some((e) => e.type === 'text' && e.role === role);

const isVideo = (u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);
const safeUrl = (u) => (/^(https?:|\/|data:image\/)/i.test(u) && !/["'()\\]/.test(u) ? u : '');

function backgroundHtml(bg, state) {
  if (!bg) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(bg)) return `<div class="dz-bg" style="background:${bg}"></div>`;
  if (/^(my)?motion:/.test(bg)) return motionCanvas(bg, state, 'dz-bg');
  const u = safeUrl(bg); if (!u) return '';
  return isVideo(u) ? `<video class="dz-bg" src="${esc(u)}" autoplay muted loop playsinline></video>` : `<div class="dz-bg" style="background-image:url('${esc(u)}')"></div>`;
}

function boxStyle(e) {
  let s = `left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%;opacity:${e.opacity / 100};`;
  if (e.rotate) s += `transform:rotate(${e.rotate}deg);`;
  return s;
}

// content: { body, reference, title } as HTML strings (already escaped) — used for role boxes.
export function elementHtml(e, content = null, { editing = false } = {}) {
  const attrs = `class="dz dz-${e.type}${editing ? ' dz-edit' : ''}" data-el="${esc(e.id)}"`;
  if (e.type === 'shape') {
    return `<div ${attrs} style="${boxStyle(e)}background:${e.fill};border-radius:${e.radius}vmin;${e.border ? `box-shadow:inset 0 0 0 calc(var(--u) * ${e.border / 19.2}) ${e.borderColor};` : ''}"></div>`;
  }
  if (e.type === 'image') {
    const u = safeUrl(e.src);
    const inner = !u ? (editing ? '<div class="dz-empty">Pick an image</div>' : '')
      : isVideo(u) ? `<video src="${esc(u)}" style="object-fit:${e.fit}" autoplay muted loop playsinline></video>` : `<img src="${esc(u)}" style="object-fit:${e.fit}" alt="">`;
    return `<div ${attrs} style="${boxStyle(e)}border-radius:${e.radius}vmin;overflow:hidden">${inner}</div>`;
  }
  const filled = e.role && content ? content[e.role] : null;
  const html = filled != null ? filled : esc(e.text).replace(/\n/g, '<br>');
  const font = e.font ? `font-family:'${esc(e.font).replace(/'/g, '')}', Georgia, sans-serif;` : '';
  const shadow = e.shadow ? 'text-shadow:0 calc(var(--u) * .12) calc(var(--u) * .5) rgba(0,0,0,.65);' : '';
  const outline = e.outline ? `-webkit-text-stroke:calc(var(--u) * ${e.outline * 0.03}) #000;paint-order:stroke fill;` : '';
  const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[e.valign];
  const style = `${boxStyle(e)}justify-content:${justify};text-align:${e.align};color:${e.color};${font}${shadow}${outline}`
    + `font-weight:${e.bold ? 700 : 400};font-style:${e.italic ? 'italic' : 'normal'};${e.upper ? 'text-transform:uppercase;' : ''}line-height:${e.lineHeight};`
    + `padding:calc(var(--u) * ${e.padding / 2});${e.fill ? `background:${e.fill};` : ''}border-radius:${e.radius}vmin;`;
  return `<div ${attrs} data-role="${e.role}" data-size="${e.size}" style="${style}"><div class="dz-t${e.fit ? ' dz-fit' : ''}" style="font-size:calc(var(--u) * ${(e.size / 19.2).toFixed(3)})">${html}</div></div>`;
}

export function designHtml(design, content = null, opts = {}) {
  if (!design) return '';
  return `<div class="design-layer">${backgroundHtml(design.background, opts.state)}${design.elements.map((e) => elementHtml(e, content, opts)).join('')}</div>`;
}
