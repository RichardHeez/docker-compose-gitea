import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTimeline, cueIndexAt, formatTime, parseTime, shiftCues } from '../public/js/timeline.js';

test('cueIndexAt picks the slide for a time, skipping uncued slides', () => {
  const cues = [0, 10, null, 25.5];
  assert.equal(cueIndexAt(cues, 0), 0);
  assert.equal(cueIndexAt(cues, 9.99), 0);
  assert.equal(cueIndexAt(cues, 10), 1);
  assert.equal(cueIndexAt(cues, 20), 1);
  assert.equal(cueIndexAt(cues, 30), 3);
  assert.equal(cueIndexAt([5], 1), -1);
  assert.equal(cueIndexAt([], 1), -1);
});

test('times format, parse and shift', () => {
  assert.equal(formatTime(65.25), '1:05.3');
  assert.equal(formatTime(null), '–:––');
  assert.equal(parseTime('1:05.5'), 65.5);
  assert.equal(parseTime('12'), 12);
  assert.equal(parseTime(''), null);
  assert.ok(Number.isNaN(parseTime('abc')));
  assert.deepEqual(shiftCues([0, 1, null, 3], -0.5), [0, 0.5, null, 2.5]);
});

test('cleanTimeline keeps good data and rejects bad', () => {
  assert.deepEqual(cleanTimeline({ audio: '/media/a.mp3', cues: [0, '12.345', 'x', null, -3] }),
    { audio: '/media/a.mp3', audioName: 'a.mp3', cues: [0, 12.35, null, null, 0], next: false });
  assert.equal(cleanTimeline({ audio: 'javascript:alert(1)', cues: [1] }), null);
  assert.equal(cleanTimeline({ audio: '', cues: [] }), null);
  assert.equal(cleanTimeline(null), null);
});
