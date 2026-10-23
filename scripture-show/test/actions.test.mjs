import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from '../lib/actions.mjs';
import { artDmxPacket, parseLevels } from '../lib/artnet.mjs';
import { DEFAULT_TIMERS } from '../public/js/timers.js';

const verses = (n) => Array.from({ length: n }, (_, i) => ({ verse: i + 1, text: `verse ${i + 1}` }));
const deps = { getChapter: async () => verses(20) };
const base = () => ({
  translation: 'X', splitChars: 0, live: null, service: [{ kind: 'text', title: 'Welcome' }, { kind: 'scripture', ref: { book: 43, chapter: 3, verseStart: 16, verseEnd: 16 } }],
  timers: DEFAULT_TIMERS, message: { text: '', visible: false }, props: [{ id: 'p', visible: true }], looks: [], announcements: { items: [] },
  macros: [{ id: 'm1', name: 'Sermon', actions: { clear: ['messages', 'audio'], timer: 't3', timerAction: 'restart', dmx: '1=255' } }],
});

test('next / prev through service, scripture and song pages', async () => {
  const s = base();
  let r = await runAction(s, 'next', {}, deps);
  assert.equal(r.patch.live.title, 'Welcome');
  s.live = r.patch.live;
  r = await runAction(s, 'next', {}, deps);
  assert.deepEqual(r.patch.live.ref, { book: 43, chapter: 3, verseStart: 16, verseEnd: 16 });
  s.live = { kind: 'scripture', ref: { book: 43, chapter: 3, verseStart: 20, verseEnd: 20 } }; // not in service, last verse
  r = await runAction(s, 'next', {}, deps);
  assert.deepEqual(r.patch.live.ref, { book: 43, chapter: 4, verseStart: 1, verseEnd: 1 });
  s.live = { kind: 'song', title: 'S', slides: [{}, {}, {}], page: 1, pages: 3 };
  r = await runAction(s, 'prev', {}, deps);
  assert.equal(r.patch.live.page, 0);
});

test('macros, timers, messages, clears and service items by name/number', async () => {
  const s = base();
  let r = await runAction(s, 'macro/sermon', {}, deps);
  assert.equal(r.patch.timers.find((t) => t.id === 't3').running, true);
  assert.equal(r.audio, 'fade'); assert.equal(r.dmx, '1=255');
  r = await runAction(s, 'timer/Countdown/start', {}, deps);
  assert.equal(r.patch.timers.find((t) => t.name === 'Countdown').running, true);
  r = await runAction(s, 'message/show', { text: 'Hello' }, deps);
  assert.deepEqual(r.patch.message, { text: 'Hello', style: 'lower', visible: true });
  r = await runAction(s, 'clear/all', {}, deps);
  assert.equal(r.patch.live, null); assert.equal(r.patch.props[0].visible, false); assert.equal(r.audio, 'fade');
  r = await runAction(s, 'service/2', {}, deps);
  assert.equal(r.patch.live.kind, 'scripture');
  await assert.rejects(runAction(s, 'macro/nope', {}, deps), /No macro/);
  await assert.rejects(runAction(s, 'dance', {}, deps), /Unknown action/);
});

test('Art-Net DMX packets and level parsing', () => {
  assert.deepEqual(parseLevels('1=255, 2=50%, 5-7=10'), { 1: 255, 2: 128, 5: 10, 6: 10, 7: 10 });
  assert.throws(() => parseLevels('600=1'), /1–512/);
  const data = new Uint8Array(512); data[0] = 255; data[511] = 7;
  const pkt = artDmxPacket(3, data);
  assert.equal(pkt.toString('latin1', 0, 8), 'Art-Net\0');
  assert.equal(pkt.readUInt16LE(8), 0x5000); assert.equal(pkt.readUInt16BE(10), 14);
  assert.equal(pkt.readUInt16LE(14), 3); assert.equal(pkt.readUInt16BE(16), 512);
  assert.equal(pkt[18], 255); assert.equal(pkt[18 + 511], 7); assert.equal(pkt.length, 530);
});
