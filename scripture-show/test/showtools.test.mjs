import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTokens, formatMs, resetTimer, startTimer, stopTimer, timerValue } from '../public/js/timers.js';
import { arrangeSections, groupColor, parseLyrics, sectionNames } from '../public/js/songs.js';

test('countdown, count-up and pause/resume', () => {
  const t0 = { id: 'a', name: 'Count', mode: 'countdown', duration: 300, running: false, startedAt: 0, elapsed: 0 };
  assert.equal(formatMs(timerValue(t0)), '5:00');
  const running = { ...t0, running: true, startedAt: Date.now() - 61_000 };
  assert.equal(formatMs(timerValue(running)), '3:59');
  const paused = stopTimer(running);
  assert.equal(paused.running, false); assert.ok(paused.elapsed >= 61_000);
  assert.equal(formatMs(timerValue(paused)), '3:59');
  assert.equal(formatMs(timerValue({ ...t0, running: true, startedAt: Date.now() - 305_000 })), '−0:05'); // overrun
  const up = { id: 'b', name: 'Sermon', mode: 'countup', running: true, startedAt: Date.now() - 3_725_000, elapsed: 0 };
  assert.equal(formatMs(timerValue(up)), '1:02:05');
  assert.deepEqual(resetTimer(up), { ...up, running: false, startedAt: 0, elapsed: 0 });
  assert.equal(startTimer(up), up); // already running
});

test('count down to a time of day', () => {
  const at = new Date(); at.setHours(9, 55, 0, 0);
  const t = { id: 'c', name: 'Service starts', mode: 'until', target: '10:00' };
  assert.equal(formatMs(timerValue(t, at.getTime())), '5:00');
});

test('message tokens', () => {
  const at = new Date(); at.setHours(9, 55, 0, 0);
  const timers = [{ id: 'c', name: 'Service starts', mode: 'until', target: '10:00' }];
  assert.equal(fillTokens('Starts in {timer:service starts}', timers, at.getTime()), 'Starts in 5:00');
  assert.equal(fillTokens('Starts in {timer}', timers, at.getTime()), 'Starts in 5:00');
});

test('song arrangement and group colours', () => {
  const s = parseLyrics('[Verse 1]\na\n\n[Chorus]\nb\n\n[Verse 2]\nc\n\n[Bridge]\nd');
  assert.deepEqual(sectionNames(s), ['Verse 1', 'Chorus', 'Verse 2', 'Bridge']);
  assert.deepEqual(arrangeSections(s, ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Bridge', 'chorus', 'Chorus']).map((x) => x.label),
    ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Bridge', 'Chorus', 'Chorus']);
  assert.deepEqual(arrangeSections(s, []).map((x) => x.label), ['Verse 1', 'Chorus', 'Verse 2', 'Bridge']);
  assert.notEqual(groupColor('Verse 1'), groupColor('Chorus'));
  assert.equal(groupColor('Pre-Chorus'), '#f2994a');
});

test('a time that has long passed counts down to tomorrow', () => {
  const at = new Date(); at.setHours(23, 30, 0, 0);
  const t = { id: 'c', name: 'Service starts', mode: 'until', target: '10:00' };
  assert.equal(formatMs(timerValue(t, at.getTime())), '10:30:00');
  const just = new Date(); just.setHours(10, 5, 0, 0);
  assert.equal(formatMs(timerValue(t, just.getTime())), '−5:00'); // just passed: shows overrun
});
