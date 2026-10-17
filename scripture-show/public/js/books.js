import { asciiDigits, customVersion, hanToDigits, packFor, spelledToDigits } from './langs.js';

// Canonical 66-book list (standard 1-66 numbering, shared with the bolls.life API),
// plus a reference parser for typed input and live speech transcripts.

export const BOOKS = [
  [1, 'Genesis', ['gen', 'ge', 'gn'], 50],
  [2, 'Exodus', ['exod', 'exo', 'ex'], 40],
  [3, 'Leviticus', ['lev', 'le', 'lv'], 27],
  [4, 'Numbers', ['num', 'nu', 'nm', 'numb'], 36],
  [5, 'Deuteronomy', ['deut', 'deu', 'dt'], 34],
  [6, 'Joshua', ['josh', 'jos'], 24],
  [7, 'Judges', ['judg', 'jdg', 'jg'], 21],
  [8, 'Ruth', ['rut', 'ru', 'rth'], 4],
  [9, '1 Samuel', ['1 sam', '1sam', '1 sa', '1sa', '1 sm'], 31],
  [10, '2 Samuel', ['2 sam', '2sam', '2 sa', '2sa', '2 sm'], 24],
  [11, '1 Kings', ['1 kgs', '1kgs', '1 ki', '1ki', '1 kin'], 22],
  [12, '2 Kings', ['2 kgs', '2kgs', '2 ki', '2ki', '2 kin'], 25],
  [13, '1 Chronicles', ['1 chron', '1 chr', '1chr', '1 ch', '1ch'], 29],
  [14, '2 Chronicles', ['2 chron', '2 chr', '2chr', '2 ch', '2ch'], 36],
  [15, 'Ezra', ['ezr'], 10],
  [16, 'Nehemiah', ['neh', 'ne'], 13],
  [17, 'Esther', ['esth', 'est', 'es'], 10],
  [18, 'Job', ['jb'], 42],
  [19, 'Psalms', ['psalm', 'ps', 'psa', 'pss', 'psm'], 150],
  [20, 'Proverbs', ['proverb', 'prov', 'pro', 'prv', 'pr'], 31],
  [21, 'Ecclesiastes', ['eccles', 'eccl', 'ecc', 'ec', 'qoh'], 12],
  [22, 'Song of Solomon', ['song of songs', 'songs of solomon', 'song', 'sos', 'sng', 'canticles'], 8],
  [23, 'Isaiah', ['isa', 'is'], 66],
  [24, 'Jeremiah', ['jer', 'je', 'jr'], 52],
  [25, 'Lamentations', ['lam', 'la'], 5],
  [26, 'Ezekiel', ['ezek', 'eze', 'ezk'], 48],
  [27, 'Daniel', ['dan', 'da', 'dn'], 12],
  [28, 'Hosea', ['hos', 'ho'], 14],
  [29, 'Joel', ['jl'], 3],
  [30, 'Amos', ['amo'], 9],
  [31, 'Obadiah', ['obad', 'ob'], 1],
  [32, 'Jonah', ['jnh', 'jon'], 4],
  [33, 'Micah', ['mic', 'mi'], 7],
  [34, 'Nahum', ['nah', 'na'], 3],
  [35, 'Habakkuk', ['hab', 'hb'], 3],
  [36, 'Zephaniah', ['zeph', 'zep', 'zp'], 3],
  [37, 'Haggai', ['hag', 'hg'], 2],
  [38, 'Zechariah', ['zech', 'zec', 'zc'], 14],
  [39, 'Malachi', ['mal', 'ml'], 4],
  [40, 'Matthew', ['matt', 'mat', 'mt'], 28],
  [41, 'Mark', ['mrk', 'mar', 'mk', 'mr'], 16],
  [42, 'Luke', ['luk', 'lk'], 24],
  [43, 'John', ['joh', 'jhn', 'jn'], 21],
  [44, 'Acts', ['act', 'ac'], 28],
  [45, 'Romans', ['rom', 'ro', 'rm'], 16],
  [46, '1 Corinthians', ['1 cor', '1cor', '1 co', '1co'], 16],
  [47, '2 Corinthians', ['2 cor', '2cor', '2 co', '2co'], 13],
  [48, 'Galatians', ['gal', 'ga'], 6],
  [49, 'Ephesians', ['eph', 'ephes'], 6],
  [50, 'Philippians', ['phil', 'php', 'pp'], 4],
  [51, 'Colossians', ['col', 'co'], 4],
  [52, '1 Thessalonians', ['1 thess', '1thess', '1 th', '1th'], 5],
  [53, '2 Thessalonians', ['2 thess', '2thess', '2 th', '2th'], 3],
  [54, '1 Timothy', ['1 tim', '1tim', '1 ti', '1ti'], 6],
  [55, '2 Timothy', ['2 tim', '2tim', '2 ti', '2ti'], 4],
  [56, 'Titus', ['tit', 'ti'], 3],
  [57, 'Philemon', ['philem', 'phm', 'pm'], 1],
  [58, 'Hebrews', ['heb'], 13],
  [59, 'James', ['jas', 'jm'], 5],
  [60, '1 Peter', ['1 pet', '1pet', '1 pe', '1pe', '1 pt', '1pt'], 5],
  [61, '2 Peter', ['2 pet', '2pet', '2 pe', '2pe', '2 pt', '2pt'], 3],
  [62, '1 John', ['1 jn', '1jn', '1 jo', '1jo', '1 jhn', '1john'], 5],
  [63, '2 John', ['2 jn', '2jn', '2 jo', '2jo', '2 jhn', '2john'], 1],
  [64, '3 John', ['3 jn', '3jn', '3 jo', '3jo', '3 jhn', '3john'], 1],
  [65, 'Jude', ['jud', 'jd'], 1],
  [66, 'Revelation', ['revelations', 'rev', 're', 'rv', 'apocalypse'], 22],
].map(([id, name, abbr, chapters]) => ({ id, name, abbr, chapters, testament: id <= 39 ? 'OT' : 'NT' }));

export const bookById = (id) => BOOKS.find((b) => b.id === Number(id));

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// "chapter three verse sixteen" -> "chapter 3 verse 16"; "one hundred and nineteen" -> "119".
export function wordsToNumbers(text) {
  const tokens = text.split(/(\s+|-)/);
  const out = [];
  let cur = null; // number being built
  let last = null; // 'one' | 'teen' | 'ten' | 'hundred'
  let pendingAnd = null;
  let pendingWs = '';
  const flush = () => {
    if (cur !== null) out.push(String(cur));
    if (pendingAnd) out.push(pendingAnd);
    out.push(pendingWs);
    cur = null; last = null; pendingAnd = null; pendingWs = '';
  };
  for (const tok of tokens) {
    const w = tok.toLowerCase();
    if (/^\s+$|^-$/.test(tok)) { if (cur === null) out.push(tok); else pendingWs += tok; continue; }
    if (w === 'and' && last === 'hundred') { pendingAnd = ' and '; continue; }
    let kind = null, val = 0;
    if (w in ONES) { kind = 'one'; val = ONES[w]; }
    else if (w in TEENS) { kind = 'teen'; val = TEENS[w]; }
    else if (w in TENS) { kind = 'ten'; val = TENS[w]; }
    else if (w === 'hundred') kind = 'hundred';
    if (!kind) { flush(); out.push(tok); continue; }
    if (cur === null) {
      if (kind === 'hundred') { cur = 100; last = 'hundred'; continue; }
      cur = val; last = kind; continue;
    }
    pendingAnd = null; pendingWs = '';
    if (kind === 'hundred' && (last === 'one')) { cur *= 100; last = 'hundred'; continue; }
    if (kind === 'one' && last === 'ten') { cur += val; last = 'one'; continue; }
    if ((kind === 'one' || kind === 'teen' || kind === 'ten') && last === 'hundred') { cur += val; last = kind; continue; }
    // A new, separate number starts ("three sixteen" -> "3 16")
    const prev = cur; cur = null; last = null;
    out.push(String(prev), ' ');
    if (kind === 'hundred') { cur = 100; last = 'hundred'; } else { cur = val; last = kind; }
  }
  flush();
  return out.join('').replace(/ {2,}/g, ' ');
}

// Lowercase, strip Latin accents (keeps other scripts intact), tidy dots: "Gén. 3.16" -> "gen 3:16".
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
  .replace(/ß/g, 'ss').replace(/ɛ/g, 'e').replace(/ɔ/g, 'o').replace(/ŋ/g, 'ng').replace(/[’'`´]/g, ' ').replace(/(\d)\.(\d)/g, '$1:$2').replace(/\./g, ' ').replace(/(\p{L})[-‐](?=\p{L})/gu, '$1 ')
  .replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CJK = '\\p{sc=Han}\\p{sc=Hangul}\\p{sc=Hiragana}\\p{sc=Katakana}';
// A whole word in any script (\b only understands ASCII).
const W = (words) => `(?<![\\p{L}\\p{N}])(?:${words.map((w) => esc(norm(w))).sort((x, y) => y.length - x.length).join('|')})(?![\\p{L}\\p{N}])`;

const aliasCache = new Map();
const extraKeys = new WeakMap();
function aliasTable(extraNames, lang) {
  const pack = packFor(lang);
  let ek = 'none';
  if (extraNames) { if (!extraKeys.has(extraNames)) extraKeys.set(extraNames, Math.random().toString(36)); ek = extraKeys.get(extraNames); }
  const key = `${pack.code}|${ek}|${customVersion}`;
  if (aliasCache.has(key)) return aliasCache.get(key);
  const map = new Map();
  const add = (name, id) => {
    const k = norm(name);
    if (k.length < 2) return;
    if (!map.has(k)) map.set(k, Number(id));
    const m = k.match(/^([123]) ?(.+)$/);
    if (m) { if (!map.has(m[1] + ' ' + m[2])) map.set(m[1] + ' ' + m[2], Number(id)); if (!map.has(m[1] + m[2])) map.set(m[1] + m[2], Number(id)); }
  };
  // In other languages, short English abbreviations ("is", "la", "es") are ordinary words — leave them out.
  for (const b of BOOKS) for (const n of [b.name, ...b.abbr.filter((a) => pack.code === 'en' || norm(a).replace(/\d|\s/g, '').length >= 4)]) add(n, b.id);
  for (const [n, id] of Object.entries(pack.books || {})) add(n, id);
  if (extraNames) for (const [n, id] of Object.entries(extraNames)) add(n, id);
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
  const re = new RegExp(
    `(?:^|[^\\p{L}\\d]|(?<=[${CJK}]))(${alts})\\s*(\\d{1,3})(?:\\s*(?::|,|\\s+verses?\\s+|\\s+vv?\\s+|\\s+)\\s*(\\d{1,3}))?` +
    `(?:\\s*(?:-|–|—|to|through|thru|and)\\s*(\\d{1,3}))?(?=$|[^\\p{L}\\d]|[${CJK}])`,
    'giu');
  const entry = { map, re };
  aliasCache.set(key, entry);
  return entry;
}

// Shared first steps: any-script digits, Han numerals, accents, spelled-out numbers.
function base(text, pack) {
  let t = ' ' + asciiDigits(String(text)) + ' ';
  if (pack.hanNumbers) t = hanToDigits(t);
  if (pack.code === 'en' || pack.english) { // English, or a language where preachers often switch to English
    t = t.replace(/\b(first|1st)\b/gi, '1').replace(/\b(second|2nd)\b/gi, '2').replace(/\b(third|3rd)\b/gi, '3');
    t = t.replace(/\b(I{1,3})\s+(?=(samuel|kings|chronicles|corinthians|thessalonians|timothy|peter|john)\b)/gi, (m, r) => r.length + ' ');
    t = wordsToNumbers(t);
  }
  t = ' ' + norm(t) + ' ';
  // ordinal after the book name: "korintofo a edi kan" -> "1 korintofo" (runs before numbers turn "abien" into 2)
  (pack.ordAfter || []).forEach((phrases, i) => {
    t = t.replace(new RegExp(`(\\p{L}+)\\s+${W(phrases)}`, 'gu'), `${i + 1} $1`);
  });
  if (pack.code !== 'en') t = ' ' + spelledToDigits(t.trim(), pack.numbers) + ' ';
  // ordinals: "primera carta a los Corintios" -> "1 corintios", "erster Brief an die Korinther" -> "1 korinther"
  (pack.ord || []).forEach((words, i) => {
    const filler = pack.filler?.length ? `(?:\\s+${W(pack.filler)})*` : '';
    t = t.replace(new RegExp(`${W(words)}${filler}\\s+`, 'gu'), `${i + 1} `);
  });
  // "1 de Corintios" (left after ordinals given as digits)
  if (pack.filler?.length) t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}:])([123])(?:\\s+${W(pack.filler)})+\\s+(?=\\p{L})`, 'gu'), '$1 ');
  for (const phrase of pack.strip || []) t = t.replace(new RegExp(W([phrase]), 'gu'), ' ');
  return t;
}

function prepare(text, lang) {
  const pack = packFor(lang);
  let t = base(text, pack);
  if (pack.code === 'en') {
    t = t.replace(/\b(the\s+)?(book\s+of|gospel\s+(according\s+)?(to|of)\s+(saint\s+|st\s+)?)/gi, ' ');
    t = t.replace(/\b(chapter|chapters|chap|ch)\b/gi, ' ');
  } else {
    const range = [...(pack.range || [])];
    if (pack.postfix) {
      // "3장 16절부터 18절까지" / "3章16节到18节"
      if (range.length) t = t.replace(new RegExp(`(\\d)\\s*(?:${[...pack.verse].map(esc).join('|')})?\\s*(?:${range.map(esc).join('|')})\\s*(?=\\d)`, 'gu'), '$1-');
      t = t.replace(new RegExp(`(\\d)\\s*(?:${[...pack.chapter, ...pack.verse, ...(pack.rangeEnd || [])].map(esc).join('|')})`, 'gu'), '$1 ');
    } else {
      if (range.length) t = t.replace(new RegExp(`(\\d)\\s+(?:${W(pack.verse)}\\s*)?${W(range)}\\s+(?:${W(pack.verse)}\\s*)?(?=\\d)`, 'gu'), '$1-');
      // "trece del cuatro al siete" / "13 vom 4 bis 7": a "from" word between chapter and verse
      t = t.replace(new RegExp(`(\\d)\\s+${W(['de', 'del', 'desde', 'do', 'du', 'von', 'vom', 'dal', 'da', 'ab', 'od', 'от', 'з', 'kutoka'])}\\s+(?=\\d)`, 'gu'), '$1 ');
      const words = [...pack.chapter, ...pack.verse];
      if (words.length) t = t.replace(new RegExp(`${W(words)}\\s*(?=\\d)`, 'gu'), ' ');
    }
  }
  return t.replace(/\s+/g, ' ');
}

// Returns [{book, chapter, verseStart, verseEnd}] found in the text, in order.
// `lang` (e.g. "es-ES") enables that language's book names, numbers and chapter/verse words.
export function parseReferences(text, extraNames, lang = 'en') {
  if (!text) return [];
  const { map, re } = aliasTable(extraNames, lang);
  const t = prepare(text, lang);
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(t))) {
    const id = map.get(m[1]);
    const book = bookById(id);
    if (!book) continue;
    const chapter = Number(m[2]);
    if (book.chapters === 1 && !m[3]) { // "Jude 3" means verse 3
      out.push({ book: id, chapter: 1, verseStart: chapter, verseEnd: Math.max(chapter, Number(m[4] || chapter)) });
      continue;
    }
    if (chapter < 1 || chapter > book.chapters) continue;
    let verseStart = m[3] ? Number(m[3]) : null;
    let verseEnd = m[4] ? Number(m[4]) : verseStart;
    if (verseStart && verseEnd < verseStart) verseEnd = verseStart;
    if (verseStart && verseEnd - verseStart > 40) verseEnd = verseStart + 40;
    out.push({ book: id, chapter, verseStart, verseEnd });
  }
  return out;
}

// Follow-ups that refer to the passage already in use, in the preacher's language:
// "verse 17", "versículos 18 al 20", "chapitre 4 verset 2", "3장 16절", "next verse" / "siguiente versículo".
// Returns { kind: 'next'|'prev'|'chapter'|'verse', chapter?, verseStart?, verseEnd? } or null.
export function parseFollowUp(text, lang = 'en') {
  const pack = packFor(lang);
  const en = packFor('en');
  const t = base(text, pack);
  const has = (phrases) => phrases.length && new RegExp(W(phrases), 'u').test(t);
  if (has([...(pack.next || []), ...en.next])) return { kind: 'next' };
  if (has([...(pack.prev || []), ...en.prev])) return { kind: 'prev' };
  const chapterW = [...pack.chapter, ...(pack.code === 'en' ? [] : en.chapter.slice(0, 2))];
  const verseW = [...pack.verse, ...(pack.code === 'en' ? [] : en.verse.slice(0, 2))];
  const rangeW = [...(pack.range || []), 'to', 'through'];
  let m;
  if (pack.postfix) {
    const alt = (ws) => ws.map(esc).join('|');
    const rg = `(?:\\s*(?:${alt(rangeW)}|-)\\s*(\\d{1,3})\\s*(?:${alt(verseW)})?)?`;
    m = new RegExp(`(\\d{1,3})\\s*(?:${alt(chapterW)})\\s*(\\d{1,3})\\s*(?:${alt(verseW)})${rg}`, 'u').exec(t);
    if (m) return { kind: 'chapter', chapter: +m[1], verseStart: +m[2], verseEnd: Math.max(+m[2], +(m[3] || m[2])) };
    m = new RegExp(`(\\d{1,3})\\s*(?:${alt(verseW)})${rg}`, 'u').exec(t);
    if (m) return { kind: 'verse', verseStart: +m[1], verseEnd: Math.max(+m[1], +(m[2] || m[1])) };
    return null;
  }
  const rg = `(?:\\s*(?:-|${W(rangeW)})\\s*(?:${W(verseW)}\\s*)?(\\d{1,3}))?`;
  m = new RegExp(`${W(chapterW)}\\s*(\\d{1,3})\\s*(?:,|${W(['and', 'y', 'e', 'et', 'und', 'i', 'na'])})?\\s*(?:${W(verseW)}\\s*|:)\\s*(\\d{1,3})${rg}`, 'u').exec(t);
  if (m) return { kind: 'chapter', chapter: +m[1], verseStart: +m[2], verseEnd: Math.max(+m[2], +(m[3] || m[2])) };
  m = new RegExp(`${W(verseW)}\\s*(\\d{1,3})${rg}`, 'u').exec(t);
  if (m) return { kind: 'verse', verseStart: +m[1], verseEnd: Math.max(+m[1], Math.min(+m[1] + 20, +(m[2] || m[1]))) };
  return null;
}

export function formatRef(ref, bookName) {
  if (!ref) return '';
  const name = bookName || bookById(ref.book)?.name || `Book ${ref.book}`;
  if (!ref.verseStart) return `${name} ${ref.chapter}`;
  return `${name} ${ref.chapter}:${ref.verseStart}${ref.verseEnd && ref.verseEnd !== ref.verseStart ? '–' + ref.verseEnd : ''}`;
}

export const refKey = (r) => r ? `${r.book}.${r.chapter}.${r.verseStart || 0}.${r.verseEnd || 0}` : '';
