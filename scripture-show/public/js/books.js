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

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let aliasCache = new Map();
function aliasTable(extraNames) {
  const key = extraNames ? Object.keys(extraNames).length + ':' + Object.keys(extraNames).slice(0, 3).join() : 'base';
  if (aliasCache.has(key)) return aliasCache.get(key);
  const map = new Map();
  for (const b of BOOKS) {
    const names = [b.name, ...b.abbr];
    for (const n of names) {
      const k = norm(n);
      map.set(k, b.id);
      const m = k.match(/^([123]) (.+)$/);
      if (m) map.set(m[1] + m[2], b.id); // "1john"
    }
  }
  if (extraNames) for (const [n, id] of Object.entries(extraNames)) {
    const k = norm(n);
    if (k.length >= 2 && !map.has(k)) map.set(k, Number(id));
    const m = k.match(/^([123]) ?(.+)$/);
    if (m) { map.set(m[1] + ' ' + m[2], Number(id)); map.set(m[1] + m[2], Number(id)); }
  }
  const alts = [...map.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
  const re = new RegExp(
    `(?:^|[^\\p{L}\\d])(${alts})\\s*(\\d{1,3})(?:\\s*(?::|\\.|,|\\s+verses?\\s+|\\s+vv?\\s+|\\s+)\\s*(\\d{1,3}))?` +
    `(?:\\s*(?:-|–|—|to|through|thru|and)\\s*(\\d{1,3}))?(?=$|[^\\p{L}\\d])`,
    'giu');
  const entry = { map, re };
  aliasCache.set(key, entry);
  return entry;
}

function prepare(text) {
  let t = ' ' + text + ' ';
  t = t.replace(/\b(first|1st)\b/gi, '1').replace(/\b(second|2nd)\b/gi, '2').replace(/\b(third|3rd)\b/gi, '3');
  t = t.replace(/\b(I{1,3})\s+(?=(samuel|kings|chronicles|corinthians|thessalonians|timothy|peter|john)\b)/gi, (m, r) => r.length + ' ');
  t = wordsToNumbers(t);
  t = t.replace(/\b(the\s+)?(book\s+of|gospel\s+(according\s+)?(to|of)\s+(saint\s+|st\.?\s+)?)/gi, ' ');
  t = t.replace(/\b(chapter|chapters|chap|ch)\b\.?/gi, ' ');
  t = t.replace(/\s+/g, ' ');
  return norm(t);
}

// Returns [{book, chapter, verseStart, verseEnd}] found in the text, in order.
export function parseReferences(text, extraNames) {
  if (!text) return [];
  const { map, re } = aliasTable(extraNames);
  const t = prepare(text);
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

export function formatRef(ref, bookName) {
  if (!ref) return '';
  const name = bookName || bookById(ref.book)?.name || `Book ${ref.book}`;
  if (!ref.verseStart) return `${name} ${ref.chapter}`;
  return `${name} ${ref.chapter}:${ref.verseStart}${ref.verseEnd && ref.verseEnd !== ref.verseStart ? '–' + ref.verseEnd : ''}`;
}

export const refKey = (r) => r ? `${r.book}.${r.chapter}.${r.verseStart || 0}.${r.verseEnd || 0}` : '';
