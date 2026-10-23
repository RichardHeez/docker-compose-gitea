// Motion backgrounds: animated backgrounds drawn live (no video files), like ProPresenter's motion loops.
// A background value looks like "motion:aurora:royal:1" = effect : colour palette : speed.
// Effects run on a shared clock (server time), so every screen — and every projector in an
// edge-blended span — shows the same moment. They draw at a modest resolution and are scaled up,
// which keeps them smooth even on 4K outputs; they are soft by nature, so this costs no sharpness
// where it matters.
import { now } from './timers.js';

export const MOTIONS = [
  ['aurora', 'Aurora'], ['rays', 'Light rays'], ['bokeh', 'Bokeh lights'], ['particles', 'Floating dust'],
  ['embers', 'Rising embers'], ['waves', 'Waves'], ['stars', 'Starfield'], ['smoke', 'Soft clouds'],
  ['flow', 'Colour flow'], ['plexus', 'Connected lines'],
];
export const PALETTES = {
  royal: ['#0d0626', '#7b5cff', '#3fa9ff', '#ff6bd6'],
  gold: ['#100a02', '#ffcf6b', '#ff9e2c', '#fff2c4'],
  ocean: ['#021320', '#1fb6ff', '#0affc2', '#3a6bff'],
  fire: ['#120300', '#ff6a00', '#ffb000', '#ff2d2d'],
  forest: ['#03130a', '#2ee59d', '#a7f36b', '#0fb9b1'],
  rose: ['#1a0612', '#ff5fa2', '#ffb3c7', '#b06bff'],
  sunrise: ['#1a0a12', '#ff7a59', '#ffd36b', '#c86bff'],
  mono: ['#050608', '#ffffff', '#b8c2d8', '#7d8aa6'],
};
export const PALETTE_NAMES = { royal: 'Royal purple', gold: 'Gold', ocean: 'Ocean', fire: 'Fire', forest: 'Forest', rose: 'Rose', sunrise: 'Sunrise', mono: 'White / silver' };
const DEFAULT_PALETTE = { aurora: 'royal', rays: 'gold', bokeh: 'royal', particles: 'gold', embers: 'fire', waves: 'ocean', stars: 'mono', smoke: 'royal', flow: 'sunrise', plexus: 'ocean' };

export function parseMotion(value) {
  const [kind, effect, palette, speed] = String(value || '').split(':');
  if (kind !== 'motion' || !MOTIONS.some(([id]) => id === effect)) return null;
  return { effect, palette: PALETTES[palette] ? palette : DEFAULT_PALETTE[effect], speed: Math.min(3, Math.max(0.1, Number(speed) || 1)) };
}
export const motionValue = (effect, palette, speed = 1) => `motion:${effect}:${palette || DEFAULT_PALETTE[effect]}:${speed}`;
export const motionLabel = (value) => { const m = parseMotion(value); return m ? `✨ ${MOTIONS.find(([id]) => id === m.effect)[1]} · ${PALETTE_NAMES[m.palette]}` : ''; };

// ---------------------------------------------------------------- helpers
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const wrap = (v, m) => ((v % m) + m) % m;

let overlay = false; // drawing a second/third layer on top: skip background fills
function base(ctx, w, h, pal, glow = 0.18) {
  if (overlay) { ctx.globalCompositeOperation = 'lighter'; return; }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.75);
  g.addColorStop(0, rgba(pal[1], glow)); g.addColorStop(1, rgba(pal[0], 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// Each effect: { res: max internal width, init(rand) -> data, draw(ctx, w, h, t, pal, data) }
const EFFECTS = {
  aurora: { res: 480, draw(ctx, w, h, t, pal) {
    base(ctx, w, h, pal, 0.1);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const col = pal[1 + (i % 3)]; const y0 = h * (0.25 + i * 0.13);
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 48) {
        const y = y0 + Math.sin(x / w * (3 + i) + t * (0.18 + i * 0.05)) * h * 0.09 + Math.sin(x / w * 9 - t * 0.3 + i) * h * 0.025;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath();
      const g = ctx.createLinearGradient(0, y0 - h * 0.15, 0, y0 + h * 0.35);
      g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.35, rgba(col, 0.32)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.fill();
    }
  } },
  rays: { res: 640, draw(ctx, w, h, t, pal) {
    base(ctx, w, h, pal, 0.12);
    ctx.globalCompositeOperation = 'lighter';
    const cx = w * 0.5, cy = -h * 0.25, len = Math.hypot(w, h) * 1.3;
    for (let i = 0; i < 16; i++) {
      const a = Math.PI / 2 + (i - 7.5) * 0.12 + Math.sin(t * 0.08 + i) * 0.05;
      const width = 0.035 + 0.02 * Math.sin(t * 0.3 + i * 1.7);
      const alpha = 0.08 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.5 + i * 2.1));
      const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      g.addColorStop(0, rgba(pal[1 + (i % 2) * 2], alpha * 2)); g.addColorStop(1, rgba(pal[1], 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a - width) * len, cy + Math.sin(a - width) * len);
      ctx.lineTo(cx + Math.cos(a + width) * len, cy + Math.sin(a + width) * len); ctx.closePath(); ctx.fill();
    }
  } },
  bokeh: { res: 640, init: (r) => Array.from({ length: 38 }, () => ({ x: r(), y: r(), s: 0.03 + r() * 0.09, v: (r() - 0.5) * 0.02, p: r() * 6.3, c: 1 + Math.floor(r() * 3) })),
    draw(ctx, w, h, t, pal, d) {
      base(ctx, w, h, pal, 0.15);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of d) {
        const x = wrap(b.x + t * b.v, 1.2) * w - w * 0.1, y = (b.y + Math.sin(t * 0.15 + b.p) * 0.04) * h;
        const r = b.s * w * (0.9 + 0.1 * Math.sin(t * 0.4 + b.p)); const a = 0.18 + 0.12 * Math.sin(t * 0.3 + b.p * 2);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(pal[b.c], a)); g.addColorStop(0.7, rgba(pal[b.c], a * 0.6)); g.addColorStop(1, rgba(pal[b.c], 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill();
      }
    } },
  particles: { res: 1280, init: (r) => Array.from({ length: 170 }, () => ({ x: r(), y: r(), s: 0.6 + r() * 2.2, v: 0.004 + r() * 0.012, p: r() * 6.3, c: 1 + Math.floor(r() * 3) })),
    draw(ctx, w, h, t, pal, d) {
      base(ctx, w, h, pal, 0.2);
      ctx.globalCompositeOperation = 'lighter';
      for (const q of d) {
        const y = wrap(q.y - t * q.v, 1) * h, x = (q.x + Math.sin(t * 0.2 + q.p) * 0.01) * w;
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.3 + q.p * 3));
        ctx.fillStyle = rgba(pal[q.c], a); ctx.beginPath(); ctx.arc(x, y, q.s * w / 1280, 0, 6.29); ctx.fill();
      }
    } },
  embers: { res: 960, init: (r) => Array.from({ length: 130 }, () => ({ x: r(), y: r(), s: 0.8 + r() * 2.4, v: 0.03 + r() * 0.06, p: r() * 6.3, c: 1 + Math.floor(r() * 3) })),
    draw(ctx, w, h, t, pal, d) {
      if (!overlay) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, w, h);
        const g = ctx.createLinearGradient(0, h, 0, h * 0.3); g.addColorStop(0, rgba(pal[1], 0.35)); g.addColorStop(1, rgba(pal[1], 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const e of d) {
        const life = wrap(e.y + t * e.v, 1); const y = h * (1 - life); const x = (e.x + Math.sin(t * 0.8 + e.p) * 0.02 * life) * w;
        const a = (1 - life) * (0.6 + 0.4 * Math.sin(t * 6 + e.p * 5)); const r = e.s * w / 960 * (1.4 - life);
        const gg = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        gg.addColorStop(0, rgba(pal[e.c], a)); gg.addColorStop(1, rgba(pal[e.c], 0));
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r * 3, 0, 6.29); ctx.fill();
      }
    } },
  waves: { res: 960, draw(ctx, w, h, t, pal) {
    base(ctx, w, h, pal, 0.12);
    for (let i = 0; i < 5; i++) {
      const col = pal[1 + (i % 3)]; const y0 = h * (0.5 + i * 0.09);
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 60) ctx.lineTo(x, y0 + Math.sin(x / w * (2.2 + i * 0.6) * Math.PI + t * (0.35 - i * 0.05) + i) * h * (0.045 - i * 0.004));
      ctx.lineTo(w, h); ctx.closePath();
      const g = ctx.createLinearGradient(0, y0 - h * 0.05, 0, h); g.addColorStop(0, rgba(col, 0.28)); g.addColorStop(1, rgba(col, 0.05));
      ctx.fillStyle = g; ctx.fill();
    }
  } },
  stars: { res: 1600, init: (r) => Array.from({ length: 320 }, () => ({ x: r(), y: r(), s: r() < 0.08 ? 1.6 + r() * 1.2 : 0.4 + r() * 0.9, f: 0.5 + r() * 2.5, p: r() * 6.3, c: 1 + Math.floor(r() * 3) })),
    draw(ctx, w, h, t, pal, d) {
      if (!overlay) {
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, pal[0]); g.addColorStop(1, rgba(pal[3], 0.1));
        ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, w, h); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      } else ctx.globalCompositeOperation = 'lighter';
      for (const s of d) {
        const x = wrap(s.x + t * 0.002 * s.s, 1) * w, y = s.y * h; const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.f + s.p));
        ctx.fillStyle = rgba(pal[s.c], a); ctx.beginPath(); ctx.arc(x, y, s.s * w / 1600, 0, 6.29); ctx.fill();
      }
    } },
  smoke: { res: 320, init: (r) => Array.from({ length: 14 }, () => ({ x: r(), y: r(), s: 0.25 + r() * 0.35, vx: (r() - 0.5) * 0.015, vy: (r() - 0.5) * 0.01, p: r() * 6.3, c: 1 + Math.floor(r() * 3) })),
    draw(ctx, w, h, t, pal, d) {
      base(ctx, w, h, pal, 0.05);
      ctx.globalCompositeOperation = 'lighter';
      for (const c of d) {
        const x = wrap(c.x + t * c.vx, 1.4) * w - w * 0.2, y = wrap(c.y + t * c.vy, 1.4) * h - h * 0.2; const r = c.s * w * (1 + 0.15 * Math.sin(t * 0.2 + c.p));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(pal[c.c], 0.13)); g.addColorStop(1, rgba(pal[c.c], 0));
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    } },
  flow: { res: 320, draw(ctx, w, h, t, pal) {
    if (!overlay) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, w, h); }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const x = w * (0.5 + 0.38 * Math.sin(t * (0.07 + i * 0.02) + i * 1.9)), y = h * (0.5 + 0.38 * Math.cos(t * (0.09 + i * 0.015) + i * 2.7));
      const r = Math.max(w, h) * 0.65; const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(pal[1 + (i % 3)], 0.2)); g.addColorStop(1, rgba(pal[1 + (i % 3)], 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    if (!overlay) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, w, h); } // keep words readable
  } },
  plexus: { res: 1280, init: (r) => Array.from({ length: 64 }, () => ({ x: r(), y: r(), vx: (r() - 0.5) * 0.012, vy: (r() - 0.5) * 0.012 })),
    draw(ctx, w, h, t, pal, d) {
      base(ctx, w, h, pal, 0.15);
      const pts = d.map((p) => { const x = wrap(p.x + t * p.vx, 1.2) - 0.1, y = wrap(p.y + t * p.vy, 1.2) - 0.1; return [x * w, y * h]; });
      const max = w * 0.14; ctx.lineWidth = Math.max(1, w / 1280);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const dd = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]); if (dd > max) continue;
        ctx.strokeStyle = rgba(pal[1 + ((i + j) % 3)], (1 - dd / max) * 0.45);
        ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[j][0], pts[j][1]); ctx.stroke();
      }
      for (const [x, y] of pts) { ctx.fillStyle = rgba(pal[2], 0.85); ctx.beginPath(); ctx.arc(x, y, 2.2 * w / 1280, 0, 6.29); ctx.fill(); }
    } },
};

// ---------------------------------------------------------------- custom motions (AI maker)
// spec = { name, dim: 0..0.7, layers: [{ effect, colors: [background, c1, c2, c3], speed, opacity }] } (1–3 layers)
const HEX = /^#[0-9a-f]{6}$/i;
export function cleanSpec(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const layers = (Array.isArray(spec.layers) ? spec.layers : []).filter((l) => EFFECTS[l?.effect]).slice(0, 3).map((l) => {
    if (!EFFECTS[l?.effect]) return null;
    const colors = (Array.isArray(l.colors) ? l.colors : []).filter((c) => HEX.test(c)).slice(0, 4);
    const pal = colors.length === 4 ? colors : PALETTES[DEFAULT_PALETTE[l.effect]];
    return { effect: l.effect, colors: pal, speed: Math.min(3, Math.max(0.1, Number(l.speed) || 1)), opacity: Math.min(1, Math.max(0.1, Number(l.opacity) || 1)) };
  }).filter(Boolean);
  if (!layers.length) return null;
  return { id: String(spec.id || Math.random().toString(36).slice(2, 9)).slice(0, 40), name: String(spec.name || 'My motion').slice(0, 60),
    prompt: String(spec.prompt || '').slice(0, 300), dim: Math.min(0.7, Math.max(0, Number(spec.dim) || 0)), layers };
}
export const findSpec = (state, value) => (String(value || '').startsWith('mymotion:') ? (state?.motions || []).find((m) => m.id === value.slice(9)) || null : null);

// ---------------------------------------------------------------- running
const running = new Set(); // { canvas, ctx, layers: [{ fx, pal, speed, opacity, data }], dim, res }
let raf = 0; let last = 0;

function frame(ts) {
  raf = requestAnimationFrame(frame);
  if (ts - last < 32) return; // ~30 fps is plenty for slow backgrounds and saves the computer
  last = ts;
  const t = now() / 1000;
  for (const r of running) {
    if (!r.canvas.isConnected) { running.delete(r); continue; }
    const cw = r.canvas.clientWidth, ch = r.canvas.clientHeight; if (!cw || !ch) continue;
    const w = Math.round(Math.min(cw, r.res)), h = Math.max(1, Math.round(w * ch / cw));
    if (r.canvas.width !== w || r.canvas.height !== h) { r.canvas.width = w; r.canvas.height = h; }
    r.layers.forEach((l, i) => {
      overlay = i > 0; r.ctx.globalAlpha = l.opacity;
      l.fx.draw(r.ctx, w, h, (t % 100000) * l.speed, l.pal, l.data);
    });
    overlay = false; r.ctx.globalAlpha = 1;
    if (r.dim) { r.ctx.globalCompositeOperation = 'source-over'; r.ctx.fillStyle = `rgba(0,0,0,${r.dim})`; r.ctx.fillRect(0, 0, w, h); }
  }
  if (!running.size) { cancelAnimationFrame(raf); raf = 0; }
}

const layerOf = (effect, pal, speed, opacity = 1) => {
  const fx = EFFECTS[effect];
  return { fx, pal, speed, opacity, data: fx.init ? fx.init(seeded(7 + effect.length * 131)) : null };
};

function run(canvas, layers, dim = 0) {
  if (!layers.length || !canvas.getContext) return;
  running.add({ canvas, ctx: canvas.getContext('2d'), layers, dim, res: Math.max(...layers.map((l) => l.fx.res)) });
  if (!raf) raf = requestAnimationFrame(frame);
}

export function startMotion(canvas, value) {
  const m = parseMotion(value); if (!m) return;
  run(canvas, [layerOf(m.effect, PALETTES[m.palette], m.speed)]);
}
export function startSpec(canvas, spec) {
  const s = cleanSpec(spec); if (!s) return;
  run(canvas, s.layers.map((l) => layerOf(l.effect, l.colors, l.speed, l.opacity)), s.dim);
}

// Start every motion canvas under `root` (called when a slide is shown).
export function attachMotion(root) {
  root.querySelectorAll('canvas[data-motion]:not([data-on]), canvas[data-motion-spec]:not([data-on])').forEach((c) => {
    c.dataset.on = '1';
    if (c.dataset.motionSpec) { try { startSpec(c, JSON.parse(c.dataset.motionSpec)); } catch { /* bad spec */ } }
    else startMotion(c, c.dataset.motion);
  });
}

// HTML for a background canvas (built-in "motion:…" or a saved "mymotion:<id>").
export function motionCanvas(value, state, cls = 'bg-media motion') {
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (parseMotion(value)) return `<canvas class="${cls}" data-motion="${esc(value)}"></canvas>`;
  const spec = findSpec(state, value);
  return spec ? `<canvas class="${cls}" data-motion-spec="${esc(JSON.stringify(spec))}"></canvas>` : '';
}

// ---------------------------------------------------------------- describe → motion (works without AI)
// Used when no AI key is set, and as the AI's starting point: theme words choose the effects,
// colour words choose the palette.
const THEMES = [
  [/fire|flame|pentecost|spirit|revival|burn|ember/, ['embers', 'flow'], 'fire'],
  [/easter|resurrect|risen|glory|heaven|light|dawn|morning|sun/, ['rays', 'particles'], 'gold'],
  [/christmas|advent|bethlehem|star|night|galaxy|space|nativity/, ['stars', 'bokeh'], 'royal'],
  [/water|baptis|river|ocean|sea|wave|living water|rain/, ['waves', 'particles'], 'ocean'],
  [/peace|calm|prayer|pray|communion|quiet|still|reflect|soft|cloud|mist|smoke/, ['smoke', 'flow'], 'royal'],
  [/love|valentine|mother|women|wedding|rose|heart/, ['bokeh', 'flow'], 'rose'],
  [/nature|creation|harvest|forest|garden|green|spring|leaf/, ['aurora', 'particles'], 'forest'],
  [/youth|modern|tech|connect|network|digital|conference|future/, ['plexus', 'flow'], 'ocean'],
  [/worship|praise|celebrat|joy|party|festive|concert/, ['bokeh', 'aurora'], 'royal'],
  [/sunset|sunrise|warm|thanksgiving|autumn|fall/, ['flow', 'rays'], 'sunrise'],
];
const COLOR_WORDS = [[/gold|yellow|amber/, 'gold'], [/blue|ocean|teal|aqua|cyan/, 'ocean'], [/red|orange|fire/, 'fire'], [/green|emerald/, 'forest'],
  [/pink|rose|magenta/, 'rose'], [/purple|violet|royal/, 'royal'], [/white|silver|grey|gray|black and white|mono/, 'mono'], [/sunset|peach|coral/, 'sunrise']];

export function suggestMotion(prompt) {
  const p = String(prompt || '').toLowerCase();
  const theme = THEMES.find(([re]) => re.test(p));
  let effects = theme ? theme[1] : ['aurora', 'particles'];
  const named = MOTIONS.filter(([id, name]) => p.includes(id) || p.includes(name.toLowerCase().split(' ')[0])).map(([id]) => id);
  if (named.length) effects = [...new Set([...named, ...effects])].slice(0, 2);
  const palette = (COLOR_WORDS.find(([re]) => re.test(p)) || [null, theme ? theme[2] : 'royal'])[1];
  const speed = /slow|calm|gentle|soft|still|peace/.test(p) ? 0.5 : /fast|lively|energ|party|celebrat/.test(p) ? 1.6 : 1;
  const name = String(prompt || 'My motion').trim().replace(/\s+/g, ' ').slice(0, 40) || 'My motion';
  return cleanSpec({ name, prompt, dim: /bright|vivid/.test(p) ? 0.05 : 0.15,
    layers: effects.map((e, i) => ({ effect: e, colors: PALETTES[palette], speed, opacity: i === 0 ? 1 : 0.7 })) });
}
