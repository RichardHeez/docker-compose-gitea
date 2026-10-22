import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lyricsToText, parseLyrics, slidesFor } from '../public/js/songs.js';

test('labelled lyrics keep their section names', () => {
  const s = parseLyrics('[Verse 1]\nLine a\nLine b\n\n[Chorus]\nSing c\nSing d\n\nChorus:\nSing c\nSing d\n\n(Bridge)\nRise e');
  assert.deepEqual(s.map((x) => x.label), ['Verse 1', 'Chorus', 'Chorus', 'Bridge']);
  assert.deepEqual(s[1].lines, ['Sing c', 'Sing d']);
});

test('unlabelled lyrics: repeated stanza becomes the chorus, others numbered verses', () => {
  const s = parseLyrics('one a\none b\n\nchorus x\nchorus y\n\ntwo a\ntwo b\n\nChorus X\nchorus y!');
  assert.deepEqual(s.map((x) => x.label), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus']);
});

test('LRC timestamps and repeat marks are cleaned', () => {
  const s = parseLyrics('[00:12.34] Hello there\n[00:15.00] Second line (x2)');
  assert.deepEqual(s[0].lines, ['Hello there', 'Second line']);
  const r = parseLyrics('Out of the box\nSing it again x2\nOne more time [repeat]\nGod is my rock')[0].lines;
  assert.deepEqual(r, ['Out of the box', 'Sing it again', 'One more time', 'God is my rock']);
});

test('slides are balanced and never exceed the line limit', () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);
  const per = (n, max) => slidesFor([{ label: 'Verse 1', lines: lines(n) }], max).map((x) => x.lines.length);
  assert.deepEqual(per(4, 4), [4]);
  assert.deepEqual(per(6, 4), [3, 3]);
  assert.deepEqual(per(7, 4), [4, 3]);
  assert.deepEqual(per(9, 4), [3, 3, 3]);
  assert.deepEqual(per(5, 2), [2, 2, 1]);
  const labels = slidesFor([{ label: 'Verse 1', lines: lines(6) }], 4).map((x) => x.label);
  assert.deepEqual(labels, ['Verse 1 (1/2)', 'Verse 1 (2/2)']);
});

test('very long lines get fewer lines per slide', () => {
  const long = 'This is a very long lyric line that goes on and on and on well past fifty characters';
  const slides = slidesFor([{ label: 'Verse 1', lines: [long, long, long, long] }], 4);
  assert.ok(slides.every((x) => x.lines.length <= 2));
});

test('round trip to editable text', () => {
  const text = lyricsToText(parseLyrics('[Verse 1]\nA\nB\n\n[Chorus]\nC'));
  assert.equal(text, '[Verse 1]\nA\nB\n\n[Chorus]\nC');
});

test('many pasted songs are split into separate songs', async () => {
  const { splitPastedSongs } = await import('../public/js/songs.js');
  const text = '# Morning Light\nArtist: Test Worship\nCCLI Song # 1234567\n\nline a\nline b\n\nchorus c\nchorus d\n\n# River Song\nriver line\n---\nGentle Rain\nAuthor: Test Writer\n\nVerse 1\nrain line';
  const songs = splitPastedSongs(text);
  assert.deepEqual(songs.map((s) => [s.title, s.artist, s.ccli, s.sections]), [
    ['Morning Light', 'Test Worship', '1234567', 2], ['River Song', '', '', 1], ['Gentle Rain', 'Test Writer', '', 1]]);
  assert.match(songs[2].lyrics, /^\[Verse 1\]\nrain line$/);
});
