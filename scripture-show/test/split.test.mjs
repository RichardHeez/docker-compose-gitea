import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWords } from '../public/js/render.js';

const words = (t) => t.split(' ').map((w, i) => ({ w, v: i === 0 ? 1 : null }));

test('splits a long verse into balanced screens without losing words', () => {
  const text = 'And it came to pass, when men began to multiply on the face of the earth, and daughters were born unto them, that the sons of God saw the daughters of men that they were fair; and they took them wives of all which they chose.';
  const pages = splitWords(words(text), 3);
  assert.equal(pages.length, 3);
  assert.equal(pages.flat().map((x) => x.w).join(' '), text);
  const lens = pages.map((p) => p.map((x) => x.w).join(' ').length);
  assert.ok(Math.max(...lens) / Math.min(...lens) < 2, `unbalanced: ${lens}`);
  assert.match(pages[0].at(-1).w, /[,;.]$/, 'prefers breaking after punctuation');
});

test('short passages stay on one screen', () => {
  assert.equal(splitWords(words('Jesus wept.'), 3).length, 1);
  assert.equal(splitWords(words('a b c d e f g h i j'), 1).length, 1);
});
