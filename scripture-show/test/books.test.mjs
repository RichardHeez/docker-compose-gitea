import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReferences, wordsToNumbers } from '../public/js/books.js';

const one = (s, names) => parseReferences(s, names)[0];

test('typed references', () => {
  assert.deepEqual(one('jn 3:16'), { book: 43, chapter: 3, verseStart: 16, verseEnd: 16 });
  assert.deepEqual(one('1co13:4-7'), { book: 46, chapter: 13, verseStart: 4, verseEnd: 7 });
  assert.deepEqual(one('Ps 23'), { book: 19, chapter: 23, verseStart: null, verseEnd: null });
  assert.deepEqual(one('Jude 3'), { book: 65, chapter: 1, verseStart: 3, verseEnd: 3 });
});

test('spoken references', () => {
  assert.deepEqual(one('turn with me to John chapter three verse sixteen'), { book: 43, chapter: 3, verseStart: 16, verseEnd: 16 });
  assert.deepEqual(one('first corinthians thirteen four through seven'), { book: 46, chapter: 13, verseStart: 4, verseEnd: 7 });
  assert.deepEqual(one('Psalm one hundred and nineteen verse one hundred and five'), { book: 19, chapter: 119, verseStart: 105, verseEnd: 105 });
});

test('translated book names', () => {
  assert.deepEqual(one('Juan 3:16', { Juan: 43 }), { book: 43, chapter: 3, verseStart: 16, verseEnd: 16 });
});

test('multiple references and no false positives', () => {
  assert.equal(parseReferences('Romans 8:28 and Jude 3').length, 2);
  assert.equal(parseReferences('I have three dogs and two cats').length, 0);
  assert.equal(wordsToNumbers('twenty-three'), '23');
});
