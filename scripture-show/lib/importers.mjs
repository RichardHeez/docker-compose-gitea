// Song importers for other worship / presentation software.
// Every importer returns songs as { title, artist, ccli, copyright, sections: [{ label, lines }], source }.
//
// Supported: EasyWorship 6/7 (Songs.db + SongWords.db), ProPresenter 4/5/6 (.pro4/.pro5/.pro6 XML),
// ProPresenter 7 (.pro / .probundle, best effort), OpenLyrics XML (OpenLP, FreeWorship, Worship Extreme …),
// OpenLP database (songs.sqlite), OpenSong, CCLI SongSelect (.usr / .txt), ChordPro, PowerPoint (.pptx),
// Word (.docx), plain text, and .zip files containing any of these.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseLyrics } from '../public/js/songs.js';

// ---------------------------------------------------------------- small helpers
const isZip = (b) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;
const isSqlite = (b) => b.length > 16 && b.toString('latin1', 0, 15) === 'SQLite format 3';
const clean = (s) => String(s ?? '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
const baseName = (f) => path.basename(f).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
const cp1252 = (code) => CP1252[code] || String.fromCharCode(code);

// Text files: UTF-8, UTF-16 (BOM) or Windows-1252.
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  const utf8 = buf.toString('utf8').replace(/^﻿/, '');
  if (!utf8.includes('�')) return utf8;
  return [...buf].map((c) => (c < 0x80 ? String.fromCharCode(c) : cp1252(c))).join('');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeXml = (s) => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m);
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag); return m ? decodeXml(m[2] ?? m[3]) : ''; };
const tagText = (xml, tag) => { const m = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i').exec(xml); return m ? decodeXml(m[1].replace(/<[^>]+>/g, '')) : ''; };

// ---------------------------------------------------------------- zip (stored + deflate)
export function unzip(buf) {
  const files = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a readable zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    try { files.set(name, method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null); } catch { /* skip broken entry */ }
  }
  return files;
}

// ---------------------------------------------------------------- RTF -> text
const SKIP_DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'listtable', 'listoverridetable', 'expandedcolortbl', 'themedata', 'latentstyles', 'datastore', 'xmlnstbl', 'rsidtbl', 'generator', 'mmathPr', 'fldinst']);
export function rtfToText(rtf) {
  rtf = String(rtf || '');
  if (!rtf.trimStart().startsWith('{\\rtf')) return rtf;
  let out = '', i = 0, uc = 1, skipChars = 0;
  const stack = []; let skip = false;
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') { stack.push({ skip, uc }); i++; if (rtf.startsWith('\\*', i)) { skip = true; } continue; }
    if (ch === '}') { const s = stack.pop(); if (s) { skip = s.skip; uc = s.uc; } i++; continue; }
    if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') { if (!skip) out += next; i += 2; continue; }
      if (next === '~') { if (!skip) out += ' '; i += 2; continue; }
      if (next === '\n' || next === '\r') { if (!skip) out += '\n'; i += 2; continue; }
      if (next === "'") { const code = parseInt(rtf.substr(i + 2, 2), 16); if (!skip) { if (skipChars > 0) skipChars--; else out += cp1252(code); } i += 4; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (!m) { i++; continue; }
      i += m[0].length;
      const word = m[1], arg = m[2] !== undefined ? Number(m[2]) : null;
      if (SKIP_DEST.has(word)) { skip = true; continue; }
      if (skip) continue;
      if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') out += '\n';
      else if (word === 'tab') out += ' ';
      else if (word === 'uc') uc = arg ?? 1;
      else if (word === 'u') { out += String.fromCharCode(arg < 0 ? arg + 65536 : arg); skipChars = uc; }
      else if (word === 'emdash') out += '—'; else if (word === 'endash') out += '–';
      else if (word === 'lquote') out += '‘'; else if (word === 'rquote') out += '’';
      else if (word === 'ldblquote') out += '“'; else if (word === 'rdblquote') out += '”';
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (!skip) { if (skipChars > 0) skipChars--; else out += ch; }
    i++;
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

// Lines of text -> sections; blank lines separate stanzas, labels detected by parseLyrics.
const textToSections = (text) => parseLyrics(String(text || '').replace(/\r/g, ''));
const linesOf = (text) => String(text || '').replace(/\r/g, '').split('\n').map(clean).filter(Boolean);

// OpenLyrics / OpenLP / OpenSong section codes: v1 -> Verse 1, c -> Chorus, b2 -> Bridge 2 …
const CODE = { v: 'Verse', c: 'Chorus', b: 'Bridge', p: 'Pre-Chorus', t: 'Tag', e: 'Ending', i: 'Intro', o: 'Other', r: 'Refrain' };
export function codeLabel(code) {
  const m = /^([a-z]+)\s*(\d*)([a-z]?)$/i.exec(String(code || '').trim());
  if (!m) return String(code || 'Verse');
  const word = CODE[m[1][0].toLowerCase()] && m[1].length <= 2 ? CODE[m[1][0].toLowerCase()] : m[1][0].toUpperCase() + m[1].slice(1);
  const num = m[2] ? ` ${m[2]}${m[3] || ''}` : (word === 'Verse' ? ' 1' : '');
  return word + num;
}

// Arrange sections by an order like "v1 c v2 c b c" (names matched case-insensitively).
function arrange(sections, order) {
  const names = String(order || '').trim().split(/[\s,]+/).filter(Boolean);
  if (!names.length) return sections.map(({ label, lines }) => ({ label, lines }));
  const byName = new Map(sections.map((s) => [s.name.toLowerCase(), s]));
  const out = names.map((n) => byName.get(n.toLowerCase()) || byName.get(`${n}1`.toLowerCase())).filter(Boolean);
  return (out.length ? out : sections).map(({ label, lines }) => ({ label, lines }));
}

// ---------------------------------------------------------------- formats
export function parseOpenLyrics(xml, file) {
  const title = tagText(xml, 'title') || baseName(file);
  const authors = [...xml.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi)].map((m) => decodeXml(m[1]).trim()).filter(Boolean);
  const sections = [...xml.matchAll(/<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi)].map((m) => {
    const name = attr(m[1], 'name') || 'v1';
    const body = m[2].replace(/<br\s*\/?>/gi, '\n').replace(/<\/lines>/gi, '\n').replace(/<comment\b[\s\S]*?<\/comment>/gi, '').replace(/<[^>]+>/g, '');
    return { name, label: codeLabel(name), lines: linesOf(decodeXml(body)) };
  }).filter((s) => s.lines.length);
  return [{ title, artist: authors.join(', '), ccli: tagText(xml, 'ccliNo'), copyright: tagText(xml, 'copyright'),
    sections: arrange(sections, tagText(xml, 'verseOrder')), source: 'OpenLyrics' }];
}

export function parseOpenSong(xml, file) {
  const title = tagText(xml, 'title') || baseName(file);
  const lyrics = tagText(xml, 'lyrics');
  const sections = []; let cur = null;
  for (const raw of lyrics.replace(/\r/g, '').split('\n')) {
    const head = /^\s*\[([^\]]+)\]/.exec(raw);
    if (head) { cur = { name: head[1].trim(), label: codeLabel(head[1].trim()), lines: [] }; sections.push(cur); continue; }
    if (/^[.;]/.test(raw)) continue; // chord / comment lines
    const text = clean(raw.replace(/^\d\s?/, '').replace(/\|\|?/g, '\n').replace(/_/g, ''));
    if (!text) continue;
    if (!cur) { cur = { name: 'V1', label: 'Verse 1', lines: [] }; sections.push(cur); }
    cur.lines.push(...text.split('\n').map(clean).filter(Boolean));
  }
  return [{ title, artist: tagText(xml, 'author'), ccli: tagText(xml, 'ccli'), copyright: tagText(xml, 'copyright'),
    sections: arrange(sections.filter((s) => s.lines.length), tagText(xml, 'presentation')), source: 'OpenSong' }];
}

// ProPresenter 4/5/6: XML with base64 RTF/plain text per text element, grouped in RVSlideGrouping.
export function parseProPresenterXml(xml, file) {
  const root = /<RVPresentationDocument\b[^>]*>/i.exec(xml)?.[0] || '';
  const title = attr(root, 'CCLISongTitle') || baseName(file);
  const groups = [];
  for (const g of xml.matchAll(/<RVSlideGrouping\b([^>]*)>([\s\S]*?)<\/RVSlideGrouping>/gi)) {
    const slides = [];
    for (const sl of g[2].matchAll(/<RVDisplaySlide\b[^>]*>([\s\S]*?)<\/RVDisplaySlide>/gi)) {
      const texts = [];
      for (const el of sl[1].matchAll(/<RVTextElement\b([^>]*)>([\s\S]*?)<\/RVTextElement>|<RVTextElement\b([^>]*)\/>/gi)) {
        const tag = el[1] || el[3] || ''; const inner = el[2] || '';
        const b64 = /<NSString[^>]*rvXMLIvarName="PlainText"[^>]*>([^<]*)</i.exec(inner)?.[1] || attr(tag, 'PlainText')
          || /<NSString[^>]*rvXMLIvarName="RTFData"[^>]*>([^<]*)</i.exec(inner)?.[1] || attr(tag, 'RTFData');
        if (!b64) continue;
        const decoded = Buffer.from(b64.trim(), 'base64').toString('utf8');
        texts.push(decoded.trimStart().startsWith('{\\rtf') ? rtfToText(decoded) : decoded);
      }
      const lines = linesOf(texts.join('\n'));
      if (lines.length) slides.push(lines);
    }
    if (slides.length) groups.push({ id: attr(g[1], 'uuid'), name: attr(g[1], 'name') || 'Verse', slides });
  }
  // First arrangement (if any) gives the sung order.
  const arr = /<RVSongArrangement\b[^>]*>([\s\S]*?)<\/RVSongArrangement>/i.exec(xml);
  let ordered = groups;
  if (arr) {
    const ids = [...arr[1].matchAll(/<NSString[^>]*>([^<]+)<\/NSString>/gi)].map((m) => m[1].trim());
    const list = ids.map((id) => groups.find((g) => g.id === id)).filter(Boolean);
    if (list.length) ordered = list;
  }
  const sections = ordered.flatMap((g) => g.slides.map((lines) => ({ label: g.name, lines })));
  return [{ title, artist: attr(root, 'CCLIArtistCredits') || attr(root, 'CCLIAuthor'), ccli: attr(root, 'CCLISongNumber'),
    copyright: [attr(root, 'CCLICopyrightYear'), attr(root, 'CCLIPublisher')].filter(Boolean).join(' '), sections, source: 'ProPresenter' }];
}

// ProPresenter 7 (.pro is binary protobuf): pull out each slide's RTF text in order (best effort).
export function parseProPresenter7(buf, file) {
  const s = buf.toString('latin1');
  const slides = []; const seen = new Set();
  let i = 0;
  while ((i = s.indexOf('{\\rtf', i)) >= 0) {
    let depth = 0, j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) break;
    }
    const rtf = Buffer.from(s.slice(i, j + 1), 'latin1').toString('utf8');
    const text = linesOf(rtfToText(rtf)).join('\n');
    if (text && !seen.has(text)) { seen.add(text); slides.push(text); }
    i = j + 1;
  }
  if (!slides.length) throw new Error('No slide text found in this ProPresenter 7 file');
  return [{ title: baseName(file), artist: '', ccli: '', copyright: '', sections: textToSections(slides.join('\n\n')), source: 'ProPresenter 7' }];
}

export function parseSongSelectUsr(text, file) {
  const kv = {};
  for (const line of text.replace(/\r/g, '').split('\n')) { const m = /^(\w+)=(.*)$/.exec(line); if (m) kv[m[1].toLowerCase()] = m[2]; }
  const fields = (kv.fields || '').split('/t'); const words = (kv.words || '').split('/t');
  const sections = words.map((w, n) => ({ label: clean(fields[n]) || `Verse ${n + 1}`, lines: w.split('/n').map(clean).filter(Boolean) })).filter((x) => x.lines.length);
  const ccli = /\[S\s*A?(\d+)\]/i.exec(text)?.[1] || kv.ccli || '';
  return [{ title: clean(kv.title) || baseName(file), artist: clean((kv.author || '').replace(/\s*\|\s*/g, ', ')), ccli, copyright: clean(kv.copyright), sections, source: 'SongSelect' }];
}

export function parseSongSelectTxt(text, file) {
  const lines = text.replace(/\r/g, '').split('\n');
  const title = clean(lines.find((l) => clean(l))) || baseName(file);
  let body = lines.slice(lines.findIndex((l) => clean(l)) + 1);
  const ccliAt = body.findIndex((l) => /CCLI\s*Song\s*#?/i.test(l));
  let ccli = '', artist = '', copyright = '';
  if (ccliAt >= 0) {
    const tail = body.slice(ccliAt).map(clean).filter(Boolean);
    ccli = /(\d{3,})/.exec(tail[0])?.[1] || '';
    artist = tail[1] && !/©|copyright/i.test(tail[1]) ? tail[1].replace(/\s*\|\s*/g, ', ') : '';
    copyright = tail.find((l) => /©|copyright/i.test(l)) || '';
    body = body.slice(0, ccliAt);
  }
  return [{ title, artist, ccli, copyright, sections: textToSections(body.join('\n')), source: 'SongSelect' }];
}

export function parseChordPro(text, file) {
  let title = '', artist = '', ccli = '', copyright = '';
  const out = []; let pendingLabel = null;
  const SECTION = { soc: 'Chorus', start_of_chorus: 'Chorus', sov: 'Verse', start_of_verse: 'Verse', sob: 'Bridge', start_of_bridge: 'Bridge' };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (/^\s*#/.test(raw)) continue;
    const d = /^\s*\{\s*([\w_]+)\s*(?::\s*(.*?))?\s*\}\s*$/.exec(raw);
    if (d) {
      const k = d[1].toLowerCase(), v = clean(d[2] || '');
      if (k === 'title' || k === 't') title = v;
      else if (['artist', 'subtitle', 'st', 'composer', 'lyricist'].includes(k) && !artist) artist = v;
      else if (k === 'ccli') ccli = v;
      else if (k === 'copyright') copyright = v;
      else if (SECTION[k]) { out.push(''); pendingLabel = v || SECTION[k]; }
      else if (['comment', 'c', 'ci', 'comment_italic'].includes(k) && v) { out.push(''); pendingLabel = v; }
      else if (/^end_of_|^eo[cvb]$/.test(k)) out.push('');
      continue;
    }
    const line = clean(raw.replace(/\[[^\]]*\]/g, ''));
    if (line && pendingLabel) { out.push(`[${pendingLabel}]`); pendingLabel = null; }
    out.push(line);
  }
  return [{ title: title || baseName(file), artist, ccli, copyright, sections: textToSections(out.join('\n')), source: 'ChordPro' }];
}

export function parsePptx(files, file) {
  const slides = [...files.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  const stanzas = slides.map((n) => {
    const xml = files.get(n).toString('utf8');
    return [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((p) => clean(decodeXml([...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join('')))).filter(Boolean);
  }).filter((x) => x.length);
  if (!stanzas.length) throw new Error('No text found on the slides');
  // A first slide with one or two short lines is usually the title slide.
  let title = baseName(file);
  if (stanzas.length > 1 && stanzas[0].length <= 2 && stanzas[0][0].length < 60) title = stanzas.shift()[0];
  return [{ title, artist: '', ccli: '', copyright: '', sections: textToSections(stanzas.map((s) => s.join('\n')).join('\n\n')), source: 'PowerPoint' }];
}

export function parseDocx(files, file) {
  const xml = files.get('word/document.xml')?.toString('utf8');
  if (!xml) throw new Error('Not a Word document');
  const paras = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => clean(decodeXml(p[0].replace(/<w:br\/>/g, '\n').replace(/<w:tab\/>/g, ' ')
    .match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|\n/g)?.map((t) => (t === '\n' ? '\n' : t.replace(/<[^>]+>/g, ''))).join('') || '')));
  return [{ title: baseName(file), artist: '', ccli: '', copyright: '', sections: textToSections(paras.join('\n')), source: 'Word' }];
}

export function parsePlainText(text, file) {
  return [{ title: baseName(file), artist: '', ccli: '', copyright: '', sections: textToSections(text), source: 'Text file' }];
}

// ---------------------------------------------------------------- EasyWorship 2009 (Paradox Songs.DB + Songs.MB)
// Paradox tables keep fixed-size records in blocks; long text (the song words, RTF) lives in the .MB memo file.
const latin = (b) => [...b].map((c) => (c < 0x80 ? String.fromCharCode(c) : cp1252(c))).join('');
export function readParadox(db, mb) {
  const recordSize = db.readUInt16LE(0), headerSize = db.readUInt16LE(2), blockSize = db.readUInt8(5) * 1024;
  const firstBlock = db.readUInt16LE(14), numFields = db.readUInt16LE(33);
  if (!recordSize || !headerSize || !blockSize || !numFields || numFields > 255 || headerSize > db.length) throw new Error('Not a Paradox table');
  const fields = [];
  for (let i = 0; i < numFields; i++) fields.push({ type: db.readUInt8(120 + i * 2), size: db.readUInt8(121 + i * 2) });
  // Field names are a run of NUL-separated strings near the end of the header; find the run of the right length.
  const tokens = db.subarray(120 + numFields * 2, headerSize).toString('latin1').split('\0');
  let names = null;
  for (let i = 0; i + numFields <= tokens.length && !names; i++) {
    const win = tokens.slice(i, i + numFields);
    if (win.every((t) => /^[\x20-\x7e]{1,40}$/.test(t)) && win.some((t) => /^title$/i.test(t))) names = win;
  }
  if (!names) throw new Error('Could not read the table columns');
  fields.forEach((f, i) => { f.name = names[i]; });

  const memo = (bytes) => {
    if (!mb || bytes.length < 10) return '';
    const tail = bytes.subarray(bytes.length - 10);
    let offset = tail.readUInt32LE(0); const length = tail.readUInt32LE(4);
    if (!offset || !length) return latin(bytes.subarray(0, bytes.length - 10)).replace(/\0+$/, '');
    const sub = offset & 0xff; offset &= ~0xff;
    if (offset >= mb.length) return '';
    const kind = mb.readUInt8(offset);
    let start;
    if (kind === 2) start = offset + 9;
    else if (kind === 3) { if (sub > 63) return ''; start = offset + mb.readUInt8(offset + 12 + 5 * sub) * 16; }
    else return '';
    return latin(mb.subarray(start, start + length));
  };
  const rows = [];
  const visited = new Set();
  for (let block = firstBlock; block && !visited.has(block); ) {
    visited.add(block);
    const at = headerSize + (block - 1) * blockSize;
    if (at + 6 > db.length) break;
    const next = db.readUInt16LE(at), addSize = db.readInt16LE(at + 4);
    const count = addSize < 0 ? 0 : Math.floor(addSize / recordSize) + 1;
    for (let r = 0; r < count; r++) {
      let p = at + 6 + r * recordSize; const row = {};
      for (const f of fields) {
        const bytes = db.subarray(p, p + f.size); p += f.size;
        if (f.type === 0x01) row[f.name] = latin(bytes).replace(/\0[\s\S]*$/, '').trim();
        else if ([0x0c, 0x0d, 0x0e].includes(f.type)) row[f.name] = memo(bytes);
      }
      rows.push(row);
    }
    block = next;
  }
  return rows;
}

export function parseEasyWorship2009(dbBuf, mbBuf) {
  const rows = readParadox(dbBuf, mbBuf);
  const get = (row, ...names) => { for (const n of names) { const k = Object.keys(row).find((x) => x.toLowerCase() === n); if (k && row[k]) return row[k]; } return ''; };
  return rows.map((r) => ({
    title: clean(get(r, 'title')) || 'Untitled', artist: clean(get(r, 'author')), copyright: clean(get(r, 'copyright')),
    ccli: clean(get(r, 'song number', 'ccli', 'ccli number')).replace(/\D/g, ''),
    sections: textToSections(rtfToText(get(r, 'words'))), source: 'EasyWorship 2009',
  })).filter((s) => s.sections.length);
}

// ---------------------------------------------------------------- SongShow Plus (.sbsong)
// A sequence of blocks: 4-byte key, then (for verses) a verse number or custom name, a length descriptor, then data.
const SSP = { TITLE: 1, AUTHOR: 2, COPYRIGHT: 3, CCLI: 5, VERSE: 12, CHORUS: 20, BRIDGE: 24, CUSTOM: 37 };
export function parseSongShowPlus(buf, file) {
  const song = { title: '', artist: '', ccli: '', copyright: '', sections: [], source: 'SongShow Plus' };
  let p = 0;
  while (p + 5 <= buf.length) {
    const key = buf.readUInt32LE(p); p += 4;
    let label = null;
    if (key === SSP.VERSE || key === SSP.CHORUS || key === SSP.BRIDGE) {
      const n = buf.readUInt8(p + 1); p += 2;
      label = `${key === SSP.VERSE ? 'Verse' : key === SSP.CHORUS ? 'Chorus' : 'Bridge'}${n ? ` ${n}` : key === SSP.VERSE ? ' 1' : ''}`;
    } else if (key === SSP.CUSTOM) {
      const len = buf.readUInt8(p + 1); p += 2;
      label = latin(buf.subarray(p, p + len)).trim() || 'Verse'; p += len;
    }
    if (p >= buf.length) break;
    const lenSize = buf.readUInt8(p); p += 1;
    let len;
    if (lenSize === 12 || lenSize === 20) { len = buf.readUInt32LE(p); p += 4; }
    else if (lenSize === 2) len = 1;
    else if (lenSize === 9) len = 0;
    else { len = buf.readUInt8(p); p += 1; }
    const data = latin(buf.subarray(p, p + len)); p += len;
    if (key === SSP.TITLE) song.title = clean(data);
    else if (key === SSP.AUTHOR) song.artist = clean(data.replace(/\s*[/;]\s*/g, ', '));
    else if (key === SSP.COPYRIGHT) song.copyright = clean(data);
    else if (key === SSP.CCLI) song.ccli = clean(data).replace(/\D/g, '');
    else if (label) { const lines = linesOf(data); if (lines.length) song.sections.push({ label, lines }); }
  }
  if (!song.sections.length) throw new Error('No lyrics found in this SongShow Plus file');
  song.title ||= baseName(file);
  return [song];
}

// ---------------------------------------------------------------- SQLite databases (EasyWorship, OpenLP)
async function withDb(buf, fn) {
  const { DatabaseSync } = await import('node:sqlite');
  const tmp = path.join(os.tmpdir(), `f8-import-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  await fs.writeFile(tmp, buf);
  const db = new DatabaseSync(tmp, { readOnly: true });
  try { return fn(db); } finally { db.close(); await fs.unlink(tmp).catch(() => {}); }
}
const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const columns = (db, t) => db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name.toLowerCase());

export async function sniffDb(buf) {
  return withDb(buf, (db) => {
    const t = tables(db).map((x) => x.toLowerCase());
    if (t.includes('word') && columns(db, 'word').includes('words')) return 'ew-words';
    if (t.includes('song') && columns(db, 'song').includes('title')) return 'ew-songs';
    if (t.includes('songs') && columns(db, 'songs').includes('lyrics')) return 'openlp';
    return 'unknown';
  });
}

export async function parseEasyWorship(songsBuf, wordsBuf) {
  const meta = await withDb(songsBuf, (db) => {
    const cols = columns(db, 'song');
    const pick = (...names) => names.find((n) => cols.includes(n));
    const q = `SELECT rowid AS id, ${['title', pick('author'), pick('copyright'), pick('reference_number', 'ccli_number')].filter(Boolean).map((c) => `"${c}"`).join(', ')} FROM song`;
    return db.prepare(q).all();
  });
  const words = await withDb(wordsBuf, (db) => {
    const map = new Map();
    for (const r of db.prepare('SELECT song_id, words FROM word').all()) map.set(Number(r.song_id), String(r.words || ''));
    return map;
  });
  return meta.map((m) => ({
    title: clean(m.title) || 'Untitled', artist: clean(m.author), ccli: clean(m.reference_number || m.ccli_number), copyright: clean(m.copyright),
    sections: textToSections(rtfToText(words.get(Number(m.id)) || '')), source: 'EasyWorship',
  })).filter((s) => s.sections.length);
}

export async function parseOpenLPDb(buf) {
  return withDb(buf, (db) => {
    const authors = new Map();
    try {
      for (const r of db.prepare('SELECT s.song_id AS sid, a.display_name AS name FROM authors_songs s JOIN authors a ON a.id = s.author_id').all()) {
        authors.set(r.sid, [...(authors.get(r.sid) || []), r.name]);
      }
    } catch { /* older schema */ }
    const cols = columns(db, 'songs');
    const rows = db.prepare(`SELECT id, title, lyrics${cols.includes('verse_order') ? ', verse_order' : ''}${cols.includes('ccli_number') ? ', ccli_number' : ''}${cols.includes('copyright') ? ', copyright' : ''} FROM songs`).all();
    return rows.map((r) => {
      const xml = String(r.lyrics || '');
      const sections = [...xml.matchAll(/<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi)].map((m) => {
        const type = attr(m[1], 'type') || 'v', label = attr(m[1], 'label') || '1';
        return { name: `${type}${label}`, label: codeLabel(`${type}${label}`), lines: linesOf(decodeXml(m[2]).replace(/\[---\]|\[--\}\{--\]/g, '')) };
      }).filter((s) => s.lines.length);
      return { title: clean(r.title) || 'Untitled', artist: (authors.get(r.id) || []).join(', '), ccli: clean(r.ccli_number), copyright: clean(r.copyright),
        sections: arrange(sections, r.verse_order), source: 'OpenLP' };
    }).filter((s) => s.sections.length);
  });
}

// ---------------------------------------------------------------- dispatcher
// files: [{ name, buf }] -> { songs, errors: [{ file, error }] }
export async function importSongFiles(input) {
  const songs = []; const errors = [];
  // Expand zips (.zip, .probundle) one level deep, but keep Office files (also zips) intact.
  const files = [];
  for (const f of input) {
    const ext = path.extname(f.name).toLowerCase();
    if (isZip(f.buf) && !['.pptx', '.docx', '.ppsx'].includes(ext)) {
      try { for (const [name, buf] of unzip(f.buf)) if (buf) files.push({ name: `${f.name}/${name}`, buf }); }
      catch (e) { errors.push({ file: f.name, error: e.message }); }
    } else files.push(f);
  }

  // EasyWorship 2009: Paradox Songs.DB with its Songs.MB memo file.
  const paradox = files.filter((x) => /\.db$/i.test(x.name) && !isSqlite(x.buf) && x.buf.length > 128 && x.buf.readUInt16LE(2) >= 2048 && x.buf.readUInt8(5) > 0 && x.buf.readUInt8(5) <= 32);
  for (const f of paradox) {
    const stem = f.name.replace(/\.db$/i, '').toLowerCase();
    const mbFile = files.find((x) => x.name.toLowerCase() === `${stem}.mb`);
    try {
      if (!/songs$/i.test(stem)) continue; // only the song table
      if (!mbFile) { errors.push({ file: f.name, error: 'EasyWorship 2009 needs Songs.MB as well as Songs.DB — add both files' }); continue; }
      songs.push(...parseEasyWorship2009(f.buf, mbFile.buf));
    } catch (e) { errors.push({ file: f.name, error: `EasyWorship 2009: ${e.message}` }); }
  }
  const handled = new Set(paradox.flatMap((f) => [f.name.toLowerCase(), f.name.replace(/\.db$/i, '.mb').toLowerCase()]));
  const otherEw2009 = files.filter((x) => !handled.has(x.name.toLowerCase()) && /\.(mb|px|db)$/i.test(x.name) && !isSqlite(x.buf));
  otherEw2009.forEach((x) => handled.add(x.name.toLowerCase()));

  // SQLite databases: pair EasyWorship Songs.db with SongWords.db.
  const dbs = { songs: [], words: [] };
  for (const f of files.filter((x) => isSqlite(x.buf))) {
    try {
      const kind = await sniffDb(f.buf);
      if (kind === 'ew-songs') dbs.songs.push(f);
      else if (kind === 'ew-words') dbs.words.push(f);
      else if (kind === 'openlp') songs.push(...await parseOpenLPDb(f.buf));
      else if (!/\.(db|sqlite)$/i.test(f.name) || !/(media|history|layout|settings)/i.test(f.name)) errors.push({ file: f.name, error: 'Database not recognised as an EasyWorship or OpenLP song database' });
    } catch (e) { errors.push({ file: f.name, error: e.message }); }
  }
  if (dbs.songs.length || dbs.words.length) {
    if (!dbs.songs.length || !dbs.words.length) errors.push({ file: (dbs.songs[0] || dbs.words[0]).name, error: 'EasyWorship needs both Songs.db and SongWords.db (from the Databases\\Data folder) — add the other file too' });
    else {
      try { songs.push(...await parseEasyWorship(dbs.songs[0].buf, dbs.words[0].buf)); }
      catch (e) { errors.push({ file: dbs.songs[0].name, error: e.message }); }
    }
  }

  for (const f of files.filter((x) => !isSqlite(x.buf) && !handled.has(x.name.toLowerCase()))) {
    const ext = path.extname(f.name).toLowerCase();
    try {
      if (ext === '.sbsong') { songs.push(...parseSongShowPlus(f.buf, f.name)); continue; }
      if (ext === '.pptx' || ext === '.ppsx') { songs.push(...parsePptx(unzip(f.buf), f.name)); continue; }
      if (ext === '.docx') { songs.push(...parseDocx(unzip(f.buf), f.name)); continue; }
      if (/\.(ews|ewsx)$/i.test(ext)) { errors.push({ file: f.name, error: 'EasyWorship schedule files are not supported: import the song database (Songs.db + SongWords.db, or Songs.DB + Songs.MB for EasyWorship 2009)' }); continue; }
      const head = f.buf.subarray(0, 4000).toString('utf8');
      if (ext === '.pro' && !/<RVPresentationDocument/i.test(head) && !/^\s*\{/.test(head)) { songs.push(...parseProPresenter7(f.buf, f.name)); continue; }
      const text = decodeText(f.buf);
      if (/<RVPresentationDocument/i.test(text)) songs.push(...parseProPresenterXml(text, f.name));
      else if (/openlyrics\.info|<song\b[^>]*xmlns="http:\/\/openlyrics/i.test(text) || (/<song\b/i.test(text) && /<verse\b[^>]*name=/i.test(text))) songs.push(...parseOpenLyrics(text, f.name));
      else if (/<song\b/i.test(text) && /<lyrics\b/i.test(text)) songs.push(...parseOpenSong(text, f.name));
      else if (ext === '.usr' || /Type=SongSelect Import File/i.test(text)) songs.push(...parseSongSelectUsr(text, f.name));
      else if (/^\s*\{\s*(title|t|start_of_|soc|c|comment)\b/im.test(text) || ['.cho', '.chordpro', '.chopro', '.crd'].includes(ext)) songs.push(...parseChordPro(text, f.name));
      else if (/CCLI\s*Song\s*#/i.test(text)) songs.push(...parseSongSelectTxt(text, f.name));
      else if (['.txt', '.text', ''].includes(ext) || !/[\x00-\x08]/.test(head)) songs.push(...parsePlainText(text, f.name));
      else errors.push({ file: f.name, error: 'Unknown file type' });
    } catch (e) { errors.push({ file: f.name, error: e.message }); }
  }
  return { songs: songs.filter((s) => s.sections?.length), errors };
}
