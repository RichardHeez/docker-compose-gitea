// Song lyrics: parse raw lyrics into labelled sections and split them into projection slides.
// Shared by the browser and the server.

const LABEL_WORDS = 'verse|chorus|refrain|pre[- ]?chorus|bridge|tag|intro|outro|ending|coda|hook|interlude|vamp|instrumental|post[- ]?chorus|chant|outro chorus|final chorus';
const LABEL_RE = new RegExp(`^\\s*[\\[(]?\\s*((?:${LABEL_WORDS})(?:\\s*\\d+[a-z]?)?)\\s*[\\])]?\\s*(?:[:.\\-–]\\s*)?(?:[x×]\\s*\\d+)?\\s*$`, 'i');
const REPEAT_RE = /\s*(?:[([]\s*(?:x|×|repeat)\s*\d*\s*[)\]]|\s(?:x|×)\s*\d+|\s+repeat)\s*$/i; // (x2) [repeat] x3

const tidy = (s) => s.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '') // LRC timestamps
  .replace(/\s+/g, ' ').trim();
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Pre ?-?chorus/i, 'Pre-Chorus');
const stanzaKey = (lines) => lines.map((l) => l.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).join('|');

// "lyrics text" -> [{ label, lines }]
export function parseLyrics(text) {
  const rawLines = String(text || '').replace(/\r/g, '').split('\n').map(tidy);
  const stanzas = []; // { label|null, lines }
  let cur = null;
  const flush = () => { if (cur && cur.lines.length) stanzas.push(cur); cur = null; };
  for (const line of rawLines) {
    if (!line) { flush(); continue; }
    const m = LABEL_RE.exec(line);
    if (m) { flush(); cur = { label: titleCase(m[1].replace(/\s+/g, ' ')), lines: [] }; continue; }
    if (/^\(?(?:x|×)\s*\d+\)?$/i.test(line)) continue; // stray "(x2)"
    if (!cur) cur = { label: null, lines: [] };
    cur.lines.push(line.replace(REPEAT_RE, '') || line);
  }
  flush();
  if (!stanzas.length) return [];

  // Unlabelled lyrics: a stanza that appears more than once is the chorus, the rest are verses.
  const counts = new Map();
  stanzas.forEach((s) => counts.set(stanzaKey(s.lines), (counts.get(stanzaKey(s.lines)) || 0) + 1));
  let verse = 0;
  const labelFor = new Map();
  for (const s of stanzas) {
    if (s.label) { labelFor.set(stanzaKey(s.lines), s.label); continue; }
    const key = stanzaKey(s.lines);
    if (labelFor.has(key)) { s.label = labelFor.get(key); continue; }
    s.label = counts.get(key) > 1 ? 'Chorus' : `Verse ${++verse}`;
    labelFor.set(key, s.label);
  }
  // Labelled-once sections ("Chorus" written out the first time only) keep their label for repeats.
  return stanzas.map((s) => ({ label: s.label, lines: s.lines }));
}

// Sections back to editable text with [Label] markers.
export const lyricsToText = (sections) => sections.map((s) => `[${s.label}]\n${s.lines.join('\n')}`).join('\n\n');

// Split one section into balanced chunks of at most `max` lines (7 lines, max 4 -> 4+3; 6 lines -> 3+3).
function chunk(lines, max) {
  const n = Math.max(1, Math.ceil(lines.length / max));
  const size = Math.ceil(lines.length / n);
  const out = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}

// Very long lines count double so a slide never gets crowded.
function weight(lines) { return lines.reduce((w, l) => w + (l.length > 48 ? 2 : 1), 0); }

// Sections -> slides [{ label, lines }] with at most `maxLines` (weighted) lines each.
export function slidesFor(sections, maxLines = 4) {
  const max = Math.max(1, Math.min(12, Number(maxLines) || 4));
  const slides = [];
  for (const s of sections) {
    let parts = chunk(s.lines, max);
    if (parts.some((p) => weight(p) > max)) parts = chunk(s.lines, Math.max(1, Math.floor(max / 2)));
    parts.forEach((lines, i) => slides.push({ label: parts.length > 1 ? `${s.label} (${i + 1}/${parts.length})` : s.label, lines }));
  }
  return slides;
}

export const songSummary = (song) => [song.artist, song.ccli ? `CCLI ${song.ccli}` : ''].filter(Boolean).join(' · ');

// Many songs pasted at once (copied from any program, website or document).
// Songs start with "# Title" or "Title: …", or are separated by a line of --- / ===.
// Optional lines right after the title: "Artist: …", "Author: …", "CCLI: 1234567", "Copyright: …".
const META_RE = /^\s*(artist|author|authors|by|writer|writers|words|music|ccli(?:\s*song)?(?:\s*(?:#|no\.?|number))?|copyright|©)\s*[:#]?\s*(.*)$/i;
export function splitPastedSongs(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = []; let cur = null;
  const start = (title) => { cur = { title: title || '', body: [] }; blocks.push(cur); };
  for (const line of lines) {
    const hash = /^\s*#{1,3}\s+(.+)$/.exec(line) || /^\s*title\s*:\s*(.+)$/i.exec(line);
    if (hash) { start(hash[1].trim()); continue; }
    if (/^\s*([-=_*])\1{2,}\s*$/.test(line)) { start(''); continue; }
    if (!cur) start('');
    cur.body.push(line);
  }
  return blocks.map((b) => {
    let body = b.body; let title = b.title;
    while (body.length && !body[0].trim()) body = body.slice(1);
    if (!title && body.length) { title = body[0].trim(); body = body.slice(1); }
    const meta = { artist: '', ccli: '', copyright: '' };
    while (body.length) {
      const m = META_RE.exec(body[0]);
      if (!body[0].trim()) { body = body.slice(1); continue; }
      if (!m) break;
      const key = m[1].toLowerCase(), val = m[2].trim();
      if (key.startsWith('ccli')) meta.ccli = val.replace(/\D/g, '');
      else if (key === 'copyright' || key === '©') meta.copyright = val;
      else meta.artist = meta.artist ? `${meta.artist}, ${val}` : val;
      body = body.slice(1);
    }
    const sections = parseLyrics(body.join('\n'));
    return { title: title.replace(/^["“]|["”]$/g, '').trim(), ...meta, lyrics: lyricsToText(sections), sections: sections.length, source: 'Pasted' };
  }).filter((s) => s.title && s.sections);
}

// ProPresenter-style group colours for song sections.
const GROUP_COLORS = [
  [/^pre[- ]?chorus/i, '#f2994a'], [/^chorus|^refrain/i, '#e5484d'], [/^verse/i, '#3e8bff'], [/^bridge/i, '#a06cf2'],
  [/^tag|^vamp|^hook|^chant/i, '#30a46c'], [/^intro|^outro|^ending|^coda|^interlude|^instrumental/i, '#8a93ad'],
];
export const groupColor = (label) => (GROUP_COLORS.find(([re]) => re.test(String(label || ''))) || [null, '#c9a227'])[1];

// Unique section names in the order they first appear.
export const sectionNames = (sections) => [...new Set(sections.map((s) => s.label))];

// Apply an arrangement (list of section names, may repeat) to parsed sections.
export function arrangeSections(sections, arrangement) {
  const order = (Array.isArray(arrangement) ? arrangement : String(arrangement || '').split(/\s*,\s*/)).map((x) => String(x).trim()).filter(Boolean);
  if (!order.length) return sections;
  const byName = new Map(); for (const s of sections) if (!byName.has(s.label.toLowerCase())) byName.set(s.label.toLowerCase(), s);
  const out = order.map((n) => byName.get(n.toLowerCase())).filter(Boolean);
  return out.length ? out : sections;
}
