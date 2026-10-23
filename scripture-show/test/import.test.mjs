import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { importSongFiles, rtfToText } from '../lib/importers.mjs';

// Invented test lyrics only.
const V1 = ['Morning light is breaking through', 'Every shadow fades away'];
const CH = ['Lift your voice and lift your hands', 'He is faithful, He is near'];
const V2 = ['Rivers run and mountains bow', 'Ocean waves declare His name'];
const rtf = (lines) => `{\\rtf1\\ansi\\ansicpg1252{\\fonttbl\\f0\\fswiss Helvetica;}{\\colortbl;\\red255\\green255\\blue255;}\\f0\\fs96 ${lines.join('\\\n')}}`;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const one = async (name, data) => importSongFiles([{ name, buf: Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8') }]);
const labels = (song) => song.sections.map((s) => s.label);

// Minimal zip writer (stored entries) for .pptx/.docx/.zip fixtures.
function zip(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content); const nm = Buffer.from(name); const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, data); central.push(ch, nm); offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

async function sqliteFile(sql) {
  const { DatabaseSync } = await import('node:sqlite');
  const f = path.join(os.tmpdir(), `f8-test-${Math.random().toString(36).slice(2)}.db`);
  const db = new DatabaseSync(f); db.exec(sql); db.close();
  const buf = fs.readFileSync(f); fs.unlinkSync(f); return buf;
}

test('RTF to text', () => {
  assert.equal(rtfToText(rtf(V1)).trim(), V1.join('\n'));
  assert.equal(rtfToText('{\\rtf1\\uc1 Caf\\u233?\\par na\\\'efve}').trim(), 'Café\nnaïve');
});

test('OpenLyrics (OpenLP, FreeWorship, Worship Extreme)', async () => {
  const xml = `<?xml version="1.0"?><song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9"><properties><titles><title>Morning Light</title></titles>
  <authors><author>Test Writer</author></authors><ccliNo>1234567</ccliNo><verseOrder>v1 c v2 c</verseOrder></properties><lyrics>
  <verse name="v1"><lines>${V1.join('<br/>')}</lines></verse><verse name="c"><lines><chord name="G"/>${CH.join('<br/>')}</lines></verse><verse name="v2"><lines>${V2.join('<br/>')}</lines></verse></lyrics></song>`;
  const { songs } = await one('morning.xml', xml);
  assert.equal(songs[0].title, 'Morning Light'); assert.equal(songs[0].artist, 'Test Writer'); assert.equal(songs[0].ccli, '1234567');
  assert.deepEqual(labels(songs[0]), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);
  assert.deepEqual(songs[0].sections[1].lines, CH);
});

test('OpenSong', async () => {
  const xml = `<?xml version="1.0"?><song><title>Morning Light</title><author>Test Writer</author><presentation>V1 C V2 C</presentation><lyrics>[V1]
.G       D
 ${V1[0]}
 ${V1[1]}
[C]
 ${CH[0]}|${CH[1]}
[V2]
; a comment
 ${V2.join('\n ')}</lyrics></song>`;
  const { songs } = await one('Morning Light', xml);
  assert.deepEqual(labels(songs[0]), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);
  assert.deepEqual(songs[0].sections[1].lines, CH);
});

test('ProPresenter 6 (.pro6) with arrangement', async () => {
  const el = (lines) => `<RVTextElement><NSString rvXMLIvarName="RTFData">${b64(rtf(lines))}</NSString></RVTextElement>`;
  const xml = `<RVPresentationDocument CCLISongTitle="Morning Light" CCLIArtistCredits="Test Writer" CCLISongNumber="7654321"><array rvXMLIvarName="groups">
    <RVSlideGrouping name="Verse 1" uuid="A"><array rvXMLIvarName="slides"><RVDisplaySlide><array rvXMLIvarName="displayElements">${el(V1)}</array></RVDisplaySlide></array></RVSlideGrouping>
    <RVSlideGrouping name="Chorus" uuid="B"><array rvXMLIvarName="slides"><RVDisplaySlide><array rvXMLIvarName="displayElements">${el(CH)}</array></RVDisplaySlide></array></RVSlideGrouping>
    <RVSlideGrouping name="Verse 2" uuid="C"><array rvXMLIvarName="slides"><RVDisplaySlide><array rvXMLIvarName="displayElements"><RVTextElement RTFData="${b64(rtf(V2))}"/></array></RVDisplaySlide></array></RVSlideGrouping>
  </array><array rvXMLIvarName="arrangements"><RVSongArrangement name="Main"><array rvXMLIvarName="groupIDs"><NSString>A</NSString><NSString>B</NSString><NSString>C</NSString><NSString>B</NSString></array></RVSongArrangement></array></RVPresentationDocument>`;
  const { songs } = await one('Morning Light.pro6', xml);
  assert.equal(songs[0].title, 'Morning Light'); assert.equal(songs[0].ccli, '7654321');
  assert.deepEqual(labels(songs[0]), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);
  assert.deepEqual(songs[0].sections[2].lines, V2);
});

test('ProPresenter 7 (.pro binary) best effort', async () => {
  const junk = Buffer.from([0x0a, 0x24, 0x12, 0x01, 0x9a, 0x02, 0x00, 0x22]);
  const buf = Buffer.concat([junk, Buffer.from(rtf(V1)), junk, Buffer.from(rtf(CH)), junk, Buffer.from(rtf(V2)), junk, Buffer.from(rtf(CH))]);
  const { songs } = await one('Morning Light.pro', buf);
  assert.equal(songs[0].title, 'Morning Light');
  assert.deepEqual(songs[0].sections.map((s) => s.lines), [V1, CH, V2]);
});

test('EasyWorship 6/7 (Songs.db + SongWords.db)', async () => {
  const songsDb = await sqliteFile(`CREATE TABLE song (rowid INTEGER PRIMARY KEY, title TEXT, author TEXT, copyright TEXT, reference_number TEXT);
    INSERT INTO song VALUES (1, 'Morning Light', 'Test Writer', '2024 Test', '1234567'), (2, 'Second Song', '', '', '');`);
  const words = (t) => rtf(t.split('\n')).replace(/'/g, "''");
  const wordsDb = await sqliteFile(`CREATE TABLE word (rowid INTEGER PRIMARY KEY, song_id INTEGER, words TEXT);
    INSERT INTO word VALUES (1, 1, '${words(`Verse 1\n${V1.join('\n')}\n\nChorus\n${CH.join('\n')}`)}'), (2, 2, '${words(V2.join('\n'))}');`);
  const { songs, errors } = await importSongFiles([{ name: 'Songs.db', buf: songsDb }, { name: 'SongWords.db', buf: wordsDb }]);
  assert.deepEqual(errors, []);
  assert.equal(songs.length, 2);
  assert.equal(songs[0].title, 'Morning Light'); assert.equal(songs[0].ccli, '1234567');
  assert.deepEqual(labels(songs[0]), ['Verse 1', 'Chorus']);
  const half = await importSongFiles([{ name: 'Songs.db', buf: songsDb }]);
  assert.match(half.errors[0].error, /SongWords\.db/);
});

test('OpenLP database (songs.sqlite)', async () => {
  const lyr = `<?xml version='1.0' encoding='UTF-8'?><song version="1.0"><lyrics><verse label="1" type="v"><![CDATA[${V1.join('\n')}]]></verse><verse label="1" type="c"><![CDATA[${CH.join('\n')}]]></verse></lyrics></song>`;
  const db = await sqliteFile(`CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT, lyrics TEXT, verse_order TEXT, ccli_number TEXT, copyright TEXT);
    CREATE TABLE authors (id INTEGER PRIMARY KEY, display_name TEXT); CREATE TABLE authors_songs (author_id INTEGER, song_id INTEGER);
    INSERT INTO songs VALUES (1, 'Morning Light', '${lyr.replace(/'/g, "''")}', 'v1 c1 v1 c1', '42', '');
    INSERT INTO authors VALUES (1, 'Test Writer'); INSERT INTO authors_songs VALUES (1, 1);`);
  const { songs } = await one('songs.sqlite', db);
  assert.equal(songs[0].artist, 'Test Writer');
  assert.deepEqual(labels(songs[0]), ['Verse 1', 'Chorus 1', 'Verse 1', 'Chorus 1']);
});

test('CCLI SongSelect .usr and .txt', async () => {
  const usr = `[File]\r\nType=SongSelect Import File\r\nVersion=3.0\r\n[S A1234567]\r\nTitle=Morning Light\r\nAuthor=Test Writer | Other Writer\r\nCopyright=2024 Test\r\nFields=Verse 1/tChorus\r\nWords=${V1.join('/n')}/t${CH.join('/n')}\r\n`;
  const a = (await one('morning.usr', usr)).songs[0];
  assert.equal(a.title, 'Morning Light'); assert.equal(a.ccli, '1234567'); assert.equal(a.artist, 'Test Writer, Other Writer');
  assert.deepEqual(labels(a), ['Verse 1', 'Chorus']);
  const txt = `Morning Light\n\nVerse 1\n${V1.join('\n')}\n\nChorus\n${CH.join('\n')}\n\nCCLI Song # 1234567\nTest Writer\n© 2024 Test Music\nFor use solely with the SongSelect® Terms of Use. All rights reserved.\nCCLI License # 99999`;
  const b = (await one('morning-light.txt', txt)).songs[0];
  assert.equal(b.title, 'Morning Light'); assert.equal(b.ccli, '1234567'); assert.equal(b.artist, 'Test Writer');
  assert.deepEqual(labels(b), ['Verse 1', 'Chorus']);
  assert.ok(!b.sections.flatMap((s) => s.lines).some((l) => /SongSelect|License/.test(l)));
});

test('ChordPro chord charts (chords removed)', async () => {
  const cho = `{title: Morning Light}\n{artist: Test Writer}\n{comment: Verse 1}\n[G]Morning light is [D]breaking through\nEvery [Em]shadow fades away\n\n{soc}\n[C]Lift your voice and lift your hands\nHe is faithful, He is near\n{eoc}`;
  const { songs } = await one('morning.cho', cho);
  assert.equal(songs[0].title, 'Morning Light');
  assert.deepEqual(songs[0].sections.map((s) => [s.label, s.lines]), [['Verse 1', V1], ['Chorus', CH]]);
});

test('PowerPoint (.pptx) and Word (.docx)', async () => {
  const slide = (lines) => `<p:sld><p:cSld><p:spTree><p:sp><p:txBody>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const pptx = zip({ 'ppt/slides/slide1.xml': slide(['Morning Light']), 'ppt/slides/slide2.xml': slide(V1), 'ppt/slides/slide3.xml': slide(CH), 'ppt/slides/slide10.xml': slide(CH), 'ppt/slides/slide4.xml': slide(V2) });
  const p = (await one('Sunday songs.pptx', pptx)).songs[0];
  assert.equal(p.title, 'Morning Light');
  assert.deepEqual(p.sections.map((s) => s.lines), [V1, CH, V2, CH]);
  const para = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const docx = zip({ 'word/document.xml': `<w:document><w:body>${[...V1, '', ...CH].map(para).join('')}</w:body></w:document>` });
  const d = (await one('Morning Light.docx', docx)).songs[0];
  assert.equal(d.title, 'Morning Light');
  assert.deepEqual(d.sections.map((s) => s.lines), [V1, CH]);
});

test('zip of mixed files, plain text, and unknown files', async () => {
  const z = zip({ 'songs/a.txt': `${V1.join('\n')}\n\n${CH.join('\n')}`, 'songs/b.cho': `{title: Two}\n${V2.join('\n')}`, '__MACOSX/._a.txt': 'x' });
  const { songs, errors } = await one('export.zip', z);
  assert.deepEqual(errors, []);
  assert.deepEqual(songs.map((s) => s.title).sort(), ['Two', 'a']);
  const bin = await one('weird.bin', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]));
  assert.equal(bin.songs.length, 0); assert.equal(bin.errors.length, 1);
});

// ---- EasyWorship 2009 (Paradox .DB + .MB), built to the Paradox layout
function paradox(rows) {
  const fields = [{ name: 'Title', type: 1, size: 60 }, { name: 'Author', type: 1, size: 40 }, { name: 'Song Number', type: 1, size: 12 }, { name: 'Words', type: 0x0c, size: 20 }];
  const recordSize = fields.reduce((n, f) => n + f.size, 0), headerSize = 2048;
  const head = Buffer.alloc(headerSize);
  head.writeUInt16LE(recordSize, 0); head.writeUInt16LE(headerSize, 2); head.writeUInt8(1, 5); head.writeUInt16LE(1, 14); head.writeUInt16LE(fields.length, 33);
  fields.forEach((f, i) => { head.writeUInt8(f.type, 120 + i * 2); head.writeUInt8(f.size, 121 + i * 2); });
  Buffer.from(`\0\0${fields.map((f) => f.name).join('\0')}\0`, 'latin1').copy(head, 385 + 6 * fields.length);
  const block = Buffer.alloc(1024); block.writeUInt16LE(0, 0); block.writeInt16LE((rows.length - 1) * recordSize, 4);
  // memo file: block 1 holds a sub-allocated (type 3) memo, later blocks are whole (type 2)
  const mb = Buffer.alloc(256 * (rows.length + 8));
  rows.forEach((r, i) => {
    let p = 6 + i * recordSize;
    for (const f of fields) {
      if (f.type === 1) Buffer.from(r[f.name] || '', 'latin1').copy(block, p);
      else {
        const words = Buffer.from(r.Words, 'latin1');
        let offset;
        if (i === 0) { // sub-allocated: index entry 2 points at 16-byte unit 4
          const at = 256; mb.writeUInt8(3, at); mb.writeUInt8(4, at + 12 + 5 * 2); words.copy(mb, at + 4 * 16); offset = at | 2;
        } else { const at = 256 * (i + 4); mb.writeUInt8(2, at); words.copy(mb, at + 9); offset = at; }
        block.writeUInt32LE(offset, p + f.size - 10); block.writeUInt32LE(words.length, p + f.size - 6);
      }
      p += f.size;
    }
  });
  return { db: Buffer.concat([head, block]), mb };
}

test('EasyWorship 2009 (Songs.DB + Songs.MB)', async () => {
  const { db, mb } = paradox([
    { Title: 'Morning Light', Author: 'Test Writer', 'Song Number': '1234567', Words: rtf(['Verse 1', ...V1, '', 'Chorus', ...CH]) },
    { Title: 'River Song', Author: '', 'Song Number': '', Words: rtf(V2) },
  ]);
  const { songs, errors } = await importSongFiles([{ name: 'Songs.DB', buf: db }, { name: 'Songs.MB', buf: mb }]);
  assert.deepEqual(errors, []);
  assert.equal(songs.length, 2);
  assert.equal(songs[0].title, 'Morning Light'); assert.equal(songs[0].ccli, '1234567'); assert.equal(songs[0].source, 'EasyWorship 2009');
  assert.deepEqual(songs[0].sections.map((s) => [s.label, s.lines]), [['Verse 1', V1], ['Chorus', CH]]);
  assert.deepEqual(songs[1].sections[0].lines, V2);
  const half = await importSongFiles([{ name: 'Songs.DB', buf: db }]);
  assert.match(half.errors[0].error, /Songs\.MB/);
});

// ---- SongShow Plus (.sbsong)
function ssp(blocks) {
  const parts = [];
  for (const b of blocks) {
    const key = Buffer.alloc(4); key.writeUInt32LE(b.key); parts.push(key);
    if (b.num !== undefined) parts.push(Buffer.from([0, b.num]));
    if (b.name !== undefined) parts.push(Buffer.from([0, b.name.length]), Buffer.from(b.name, 'latin1'));
    const data = Buffer.from(b.data, 'latin1');
    if (data.length > 200) { const l = Buffer.alloc(5); l.writeUInt8(12, 0); l.writeUInt32LE(data.length, 1); parts.push(l); }
    else parts.push(Buffer.from([1, data.length]));
    parts.push(data);
  }
  return Buffer.concat(parts);
}

test('SongShow Plus (.sbsong)', async () => {
  const buf = ssp([
    { key: 1, data: 'Morning Light' }, { key: 2, data: 'Test Writer/Other Writer' }, { key: 5, data: '1234567' },
    { key: 12, num: 1, data: V1.join('\r\n') }, { key: 20, num: 1, data: CH.join('\r\n') }, { key: 37, name: 'Tag', data: 'Every promise ever stands' },
  ]);
  const { songs } = await one('Morning Light.sbsong', buf);
  assert.equal(songs[0].title, 'Morning Light'); assert.equal(songs[0].artist, 'Test Writer, Other Writer'); assert.equal(songs[0].ccli, '1234567');
  assert.deepEqual(songs[0].sections.map((s) => [s.label, s.lines]), [['Verse 1', V1], ['Chorus 1', CH], ['Tag', ['Every promise ever stands']]]);
});
