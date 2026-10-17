// Language packs for recognising spoken scripture references in many languages.
// Each pack: chapter/verse words, range words, ordinals ("primera de Corintios"), filler phrases,
// "next verse" phrases, spelled-out numbers and book names. Languages without a full pack still work
// through digits (most speech engines write numbers as digits) plus book names taken from that
// language's Bible translations.

// ---------------------------------------------------------------- number words (1..176)
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

function es(n) {
  const u = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
  const s10 = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve'];
  const s20 = ['veinte', 'veintiuno', 'veintidos', 'veintitres', 'veinticuatro', 'veinticinco', 'veintiseis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const t = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  if (n < 10) return u[n]; if (n < 20) return s10[n - 10]; if (n < 30) return s20[n - 20];
  if (n < 100) return t[Math.floor(n / 10)] + (n % 10 ? ' y ' + u[n % 10] : '');
  return n === 100 ? 'cien' : 'ciento ' + es(n - 100);
}
function pt(n) {
  const u = ['', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const s10 = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const t = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  if (n < 10) return u[n]; if (n < 20) return s10[n - 10];
  if (n < 100) return t[Math.floor(n / 10)] + (n % 10 ? ' e ' + u[n % 10] : '');
  return n === 100 ? 'cem' : 'cento e ' + pt(n - 100);
}
function fr(n, belgian = false) {
  const u = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
  const s10 = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix sept', 'dix huit', 'dix neuf'];
  const t = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', belgian ? 'septante' : '', belgian ? 'huitante' : '', belgian ? 'nonante' : ''];
  if (n < 10) return u[n]; if (n < 20) return s10[n - 10];
  const d = Math.floor(n / 10), r = n % 10;
  if (n < 100 && t[d]) return t[d] + (r === 1 ? ' et un' : r ? ' ' + u[r] : '');
  if (n < 80) return 'soixante ' + (n === 71 ? 'et onze' : s10[n - 70]);
  if (n === 80) return 'quatre vingts';
  if (n < 90) return 'quatre vingt ' + u[n - 80];
  if (n < 100) return 'quatre vingt ' + s10[n - 90];
  return n === 100 ? 'cent' : 'cent ' + fr(n - 100, belgian);
}
function de(n, und = '') {
  const u = ['', 'eins', 'zwei', 'drei', 'vier', 'funf', 'sechs', 'sieben', 'acht', 'neun'];
  const s10 = ['zehn', 'elf', 'zwolf', 'dreizehn', 'vierzehn', 'funfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
  const t = ['', '', 'zwanzig', 'dreissig', 'vierzig', 'funfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
  if (n < 10) return u[n]; if (n < 20) return s10[n - 10];
  if (n < 100) return (n % 10 ? (n % 10 === 1 ? 'ein' : u[n % 10]) + 'und' : '') + t[Math.floor(n / 10)];
  return n === 100 ? 'hundert' : 'hundert' + und + de(n - 100);
}
function it(n) {
  const u = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove'];
  const s10 = ['dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
  const t = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
  if (n < 10) return u[n]; if (n < 20) return s10[n - 10];
  const r = n % 10, ten = t[Math.floor(n / 10)];
  if (n < 100) return r === 1 || r === 8 ? ten.slice(0, -1) + u[r] : ten + u[r];
  return n === 100 ? 'cento' : 'cento' + it(n - 100);
}

// Builds { "words": value } for 1..176 with common spelling variants.
function numberTable(gens, variants = []) {
  const map = new Map();
  for (const g of gens) for (const n of range(176)) {
    const w = g(n); if (!w) continue;
    map.set(w, n);
    for (const [a, b] of variants) if (w.includes(a)) map.set(w.split(a).join(b), n);
  }
  return map;
}

// ---------------------------------------------------------------- book names
// Index = book id - 1; '|' separates alternatives. Numbered books are written "1 name".
const B = (s) => s.split(',').map((x) => x.trim().split('|'));

const ES = B(`Genesis,Exodo,Levitico,Numeros,Deuteronomio,Josue,Jueces,Rut,1 Samuel,2 Samuel,1 Reyes,2 Reyes,1 Cronicas,2 Cronicas,Esdras,Nehemias,Ester,Job,Salmos|Salmo,Proverbios,Eclesiastes,Cantares|Cantar de los Cantares|Cantico de los Canticos,Isaias,Jeremias,Lamentaciones,Ezequiel,Daniel,Oseas,Joel,Amos,Abdias,Jonas,Miqueas,Nahum,Habacuc,Sofonias,Hageo,Zacarias,Malaquias,Mateo,Marcos,Lucas,Juan,Hechos|Hechos de los Apostoles,Romanos,1 Corintios,2 Corintios,Galatas,Efesios,Filipenses,Colosenses,1 Tesalonicenses,2 Tesalonicenses,1 Timoteo,2 Timoteo,Tito,Filemon,Hebreos,Santiago,1 Pedro,2 Pedro,1 Juan,2 Juan,3 Juan,Judas,Apocalipsis`);
const PT = B(`Genesis,Exodo,Levitico,Numeros,Deuteronomio,Josue,Juizes,Rute,1 Samuel,2 Samuel,1 Reis,2 Reis,1 Cronicas,2 Cronicas,Esdras,Neemias,Ester,Jo,Salmos|Salmo,Proverbios,Eclesiastes,Canticos|Cantares|Cantico dos Canticos,Isaias,Jeremias,Lamentacoes,Ezequiel,Daniel,Oseias,Joel,Amos,Obadias,Jonas,Miqueias,Naum,Habacuque,Sofonias,Ageu,Zacarias,Malaquias,Mateus,Marcos,Lucas,Joao,Atos|Atos dos Apostolos,Romanos,1 Corintios,2 Corintios,Galatas,Efesios,Filipenses,Colossenses,1 Tessalonicenses,2 Tessalonicenses,1 Timoteo,2 Timoteo,Tito,Filemom,Hebreus,Tiago,1 Pedro,2 Pedro,1 Joao,2 Joao,3 Joao,Judas,Apocalipse`);
const FR = B(`Genese,Exode,Levitique,Nombres,Deuteronome,Josue,Juges,Ruth,1 Samuel,2 Samuel,1 Rois,2 Rois,1 Chroniques,2 Chroniques,Esdras,Nehemie,Esther,Job,Psaumes|Psaume,Proverbes,Ecclesiaste,Cantique des cantiques|Cantique,Esaie|Isaie,Jeremie,Lamentations,Ezechiel,Daniel,Osee,Joel,Amos,Abdias,Jonas,Michee,Nahum,Habacuc,Sophonie,Aggee,Zacharie,Malachie,Matthieu,Marc,Luc,Jean,Actes|Actes des Apotres,Romains,1 Corinthiens,2 Corinthiens,Galates,Ephesiens,Philippiens,Colossiens,1 Thessaloniciens,2 Thessaloniciens,1 Timothee,2 Timothee,Tite,Philemon,Hebreux,Jacques,1 Pierre,2 Pierre,1 Jean,2 Jean,3 Jean,Jude,Apocalypse`);
const DE = B(`1 Mose|Genesis,2 Mose|Exodus,3 Mose|Levitikus,4 Mose|Numeri,5 Mose|Deuteronomium,Josua,Richter,Rut|Ruth,1 Samuel,2 Samuel,1 Konige,2 Konige,1 Chronik,2 Chronik,Esra,Nehemia,Ester|Esther,Hiob|Ijob,Psalmen|Psalm,Spruche|Sprichworter,Prediger|Kohelet,Hoheslied|Hohelied,Jesaja,Jeremia,Klagelieder,Hesekiel|Ezechiel,Daniel,Hosea,Joel,Amos,Obadja,Jona,Micha,Nahum,Habakuk,Zefanja|Zephanja,Haggai,Sacharja,Maleachi,Matthaus,Markus,Lukas,Johannes,Apostelgeschichte,Romer,1 Korinther,2 Korinther,Galater,Epheser,Philipper,Kolosser,1 Thessalonicher,2 Thessalonicher,1 Timotheus,2 Timotheus,Titus,Philemon,Hebraer,Jakobus,1 Petrus,2 Petrus,1 Johannes,2 Johannes,3 Johannes,Judas,Offenbarung`);
const IT = B(`Genesi,Esodo,Levitico,Numeri,Deuteronomio,Giosue,Giudici,Rut,1 Samuele,2 Samuele,1 Re,2 Re,1 Cronache,2 Cronache,Esdra,Neemia,Ester,Giobbe,Salmi|Salmo,Proverbi,Ecclesiaste|Qoelet,Cantico dei Cantici|Cantico,Isaia,Geremia,Lamentazioni,Ezechiele,Daniele,Osea,Gioele,Amos,Abdia,Giona,Michea,Naum,Abacuc,Sofonia,Aggeo,Zaccaria,Malachia,Matteo,Marco,Luca,Giovanni,Atti|Atti degli Apostoli,Romani,1 Corinzi,2 Corinzi,Galati,Efesini,Filippesi,Colossesi,1 Tessalonicesi,2 Tessalonicesi,1 Timoteo,2 Timoteo,Tito,Filemone,Ebrei,Giacomo,1 Pietro,2 Pietro,1 Giovanni,2 Giovanni,3 Giovanni,Giuda,Apocalisse`);

const books = (list) => Object.fromEntries(list.flatMap((names, i) => names.map((n) => [n, i + 1])));

// ---------------------------------------------------------------- packs
export const PACKS = {
  en: { chapter: ['chapter', 'chapters', 'chap', 'ch'], verse: ['verse', 'verses', 'vs', 'v'], range: ['to', 'through', 'thru'],
    next: ['next verse', 'following verse', 'verse after that'], prev: ['previous verse', 'last verse', 'verse before'] },
  es: { chapter: ['capitulo', 'capitulos', 'cap'], verse: ['versiculo', 'versiculos', 'verso', 'versos', 'vers'], range: ['a', 'al', 'hasta'],
    ord: [['primera', 'primero', 'primer', '1ra', '1ro', '1era', '1a', '1o'], ['segunda', 'segundo', '2da', '2do', '2a', '2o'], ['tercera', 'tercero', 'tercer', '3ra', '3ro', '3era', '3a', '3o']],
    filler: ['carta', 'epistola', 'libro', 'de', 'del', 'a', 'los', 'las', 'el', 'san', 'pablo'],
    strip: ['el libro de los', 'el libro de', 'libro de los', 'libro de', 'evangelio segun san', 'evangelio segun', 'evangelio de', 'el evangelio de'],
    next: ['siguiente versiculo', 'versiculo siguiente', 'proximo versiculo'], prev: ['versiculo anterior'],
    numbers: numberTable([es], [['uno', 'un'], ['uno', 'una'], ['veintiun', 'veintiun']]), books: books(ES) },
  pt: { chapter: ['capitulo', 'capitulos', 'cap'], verse: ['versiculo', 'versiculos', 'verso', 'versos', 'vers'], range: ['a', 'ao', 'ate'],
    ord: [['primeira', 'primeiro', '1a', '1o'], ['segunda', 'segundo', '2a', '2o'], ['terceira', 'terceiro', '3a', '3o']],
    filler: ['carta', 'epistola', 'livro', 'de', 'do', 'dos', 'da', 'aos', 'as', 'a', 'o', 'sao', 'paulo'],
    strip: ['o livro de', 'livro de', 'livro dos', 'evangelho segundo sao', 'evangelho segundo', 'evangelho de'],
    next: ['proximo versiculo', 'versiculo seguinte'], prev: ['versiculo anterior'],
    numbers: numberTable([pt], [['um', 'uma'], ['dois', 'duas'], ['catorze', 'quatorze'], ['dezesseis', 'dezasseis'], ['dezessete', 'dezassete'], ['dezenove', 'dezanove']]), books: books(PT) },
  fr: { chapter: ['chapitre', 'chapitres', 'chap'], verse: ['verset', 'versets', 'vers', 'v'], range: ['a', 'au', 'jusqu a', 'jusqua'],
    ord: [['premiere', 'premier', '1re', '1ere', '1er'], ['deuxieme', 'seconde', 'second', '2e', '2eme', '2nd'], ['troisieme', '3e', '3eme']],
    filler: ['epitre', 'lettre', 'livre', 'de', 'des', 'du', 'aux', 'aux', 'a', 'l', 'la', 'le', 'les', 'saint', 'paul'],
    strip: ['le livre des', 'livre des', 'le livre de', 'livre de', 'evangile selon saint', 'evangile selon', 'evangile de'],
    next: ['verset suivant', 'prochain verset'], prev: ['verset precedent'],
    numbers: numberTable([fr, (n) => fr(n, true)], [['quatre vingts', 'quatre vingt']]), books: books(FR) },
  de: { chapter: ['kapitel', 'kap'], verse: ['vers', 'verse', 'versen'], range: ['bis'],
    ord: [['erste', 'erster', 'ersten', 'erstes'], ['zweite', 'zweiter', 'zweiten', 'zweites'], ['dritte', 'dritter', 'dritten', 'drittes']],
    filler: ['brief', 'buch', 'an', 'die', 'der', 'des', 'den', 'paulus'],
    strip: ['das buch', 'das evangelium nach', 'evangelium nach', 'das evangelium des', 'evangelium des'],
    next: ['nachste vers', 'nachsten vers', 'nachster vers', 'folgende vers', 'folgenden vers'], prev: ['vorherige vers', 'vorherigen vers', 'vorheriger vers'],
    numbers: numberTable([de, (n) => de(n, 'und'), (n) => n >= 100 ? 'ein' + de(n) : '', (n) => (n === 1 ? 'ein' : '')]), books: books(DE) },
  it: { chapter: ['capitolo', 'capitoli', 'cap'], verse: ['versetto', 'versetti', 'verso', 'versi', 'vers'], range: ['a', 'al', 'fino a'],
    ord: [['prima', 'primo', '1a', '1o'], ['seconda', 'secondo', '2a', '2o'], ['terza', 'terzo', '3a', '3o']],
    filler: ['lettera', 'epistola', 'libro', 'ai', 'agli', 'alle', 'dei', 'degli', 'di', 'delle', 'a', 'san', 'paolo'],
    strip: ['il libro dei', 'libro dei', 'il libro di', 'libro di', 'vangelo secondo', 'vangelo di', 'il vangelo di'],
    next: ['versetto successivo', 'prossimo versetto', 'versetto seguente'], prev: ['versetto precedente'],
    numbers: numberTable([it, (n) => (n > 100 && [1, 8].includes(n % 100) ? 'cent' + it(n - 100) : '')]), books: books(IT) },
  nl: { chapter: ['hoofdstuk', 'hoofdstukken'], verse: ['vers', 'verzen'], range: ['tot'], next: ['volgende vers'], prev: ['vorige vers'] },
  ru: { chapter: ['глава', 'главе', 'главу', 'главы', 'гл'], verse: ['стих', 'стихи', 'стиха', 'стихе', 'ст'], range: ['по', 'до'], next: ['следующий стих'], prev: ['предыдущий стих'] },
  uk: { chapter: ['розділ', 'розділі', 'глава'], verse: ['вірш', 'вірші', 'віршi'], range: ['по', 'до'], next: ['наступний вірш'], prev: ['попередній вірш'] },
  pl: { chapter: ['rozdzial', 'rozdziale'], verse: ['werset', 'wersety', 'wers'], range: ['do'], next: ['nastepny werset'], prev: ['poprzedni werset'] },
  ro: { chapter: ['capitolul', 'capitol'], verse: ['versetul', 'versetele', 'verset'], range: ['la', 'pana la'], next: ['versetul urmator'], prev: ['versetul anterior'] },
  sw: { chapter: ['sura', 'mlango'], verse: ['mstari', 'mistari', 'aya'], range: ['hadi', 'mpaka'], next: ['mstari unaofuata'], prev: ['mstari uliotangulia'] },
  yo: { chapter: ['ori'], verse: ['ese'], range: ['si'], next: ['ese to kan'], prev: [] },
  ig: { chapter: ['isi'], verse: ['amaokwu'], range: ['ruo'], next: ['amaokwu na-esote', 'amaokwu nke ozo'], prev: [] },
  ha: { chapter: ['sura', 'babi'], verse: ['aya', 'ayar'], range: ['zuwa'], next: ['aya ta gaba'], prev: [] },
  af: { chapter: ['hoofstuk'], verse: ['vers', 'verse'], range: ['tot'], next: ['volgende vers'], prev: ['vorige vers'] },
  tl: { chapter: ['kabanata'], verse: ['talata', 'bersikulo'], range: ['hanggang'], next: ['susunod na talata'], prev: [] },
  id: { chapter: ['pasal'], verse: ['ayat'], range: ['sampai', 'hingga'], next: ['ayat berikutnya'], prev: ['ayat sebelumnya'] },
  ms: { chapter: ['pasal', 'bab'], verse: ['ayat'], range: ['hingga', 'sampai'], next: ['ayat seterusnya'], prev: [] },
  vi: { chapter: ['chuong'], verse: ['cau'], range: ['den', 'toi'], next: ['cau tiep theo'], prev: [] },
  hi: { chapter: ['अध्याय'], verse: ['पद', 'वचन'], range: ['से', 'तक'], next: ['अगला पद'], prev: [] },
  ar: { chapter: ['الاصحاح', 'الإصحاح', 'اصحاح', 'الفصل'], verse: ['العدد', 'الاية', 'الآية', 'اية', 'آية', 'عدد'], range: ['الى', 'إلى', 'حتى'], next: ['الاية التالية', 'العدد التالي'], prev: [] },
  fa: { chapter: ['باب', 'فصل'], verse: ['آیه', 'آيه'], range: ['تا'], next: ['آیه بعد'], prev: [] },
  he: { chapter: ['פרק'], verse: ['פסוק', 'פסוקים'], range: ['עד'], next: ['הפסוק הבא'], prev: [] },
  // CJK: the chapter/verse markers come AFTER the number ("3장 16절", "3章16节")
  ko: { postfix: true, chapter: ['장'], verse: ['절'], range: ['부터', '에서', '~'], rangeEnd: ['까지'], next: ['다음 절'], prev: ['이전 절'] },
  zh: { postfix: true, chapter: ['章'], verse: ['节', '節'], range: ['到', '至', '~'], next: ['下一节', '下一節'], prev: ['上一节', '上一節'], hanNumbers: true },
  ja: { postfix: true, chapter: ['章'], verse: ['節'], range: ['から', '〜', '~'], rangeEnd: ['まで'], next: ['次の節'], prev: ['前の節'], hanNumbers: true },
};

export function packFor(lang) {
  const code = String(lang || 'en').toLowerCase().split(/[-_]/)[0];
  return { code, ...(PACKS[code] || { chapter: [], verse: [], range: [], next: [], prev: [] }) };
}

// 三十六 / 一百一十九 / 两 -> digits
const HAN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function hanToDigits(text) {
  return text.replace(/[零〇一二两兩三四五六七八九十百]+/g, (s) => {
    let total = 0, cur = 0;
    for (const ch of s) {
      if (ch in HAN) cur = HAN[ch];
      else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
      else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    }
    return String(total + cur);
  });
}

// Any script's digits (Arabic-Indic, Persian, Devanagari, Bengali, Thai, full-width …) -> ASCII.
const ZEROS = [0x0660, 0x06F0, 0x07C0, 0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66, 0x0DE6, 0x0E50, 0x0ED0, 0x0F20, 0x1040, 0x1090, 0x17E0, 0x1810, 0x1946, 0xFF10];
export function asciiDigits(text) {
  return text.replace(/\p{Nd}/gu, (d) => {
    const cp = d.codePointAt(0);
    if (cp < 128) return d;
    const z = ZEROS.find((z0) => cp >= z0 && cp < z0 + 10);
    return z === undefined ? d : String(cp - z);
  });
}

// Replace spelled-out numbers using a pack's table (longest phrase first).
export function spelledToDigits(text, table) {
  if (!table) return text;
  const maxWords = 6;
  const toks = text.split(/\s+/);
  const out = [];
  for (let i = 0; i < toks.length;) {
    let hit = null;
    for (let n = Math.min(maxWords, toks.length - i); n >= 1; n--) {
      const phrase = toks.slice(i, i + n).join(' ');
      if (table.has(phrase)) { hit = [table.get(phrase), n]; break; }
    }
    if (hit) { out.push(String(hit[0])); i += hit[1]; } else out.push(toks[i++]);
  }
  return out.join(' ');
}
