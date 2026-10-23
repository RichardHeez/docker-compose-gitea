import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTIONS, cleanSpec, findSpec, motionCanvas, motionValue, parseMotion, suggestMotion } from '../public/js/motion.js';
import { pickFile } from '../lib/stock.mjs';

test('built-in motion values parse with defaults and limits', () => {
  assert.deepEqual(parseMotion('motion:embers'), { effect: 'embers', palette: 'fire', speed: 1 });
  assert.deepEqual(parseMotion('motion:rays:ocean:9'), { effect: 'rays', palette: 'ocean', speed: 3 });
  assert.equal(parseMotion('motion:evil'), null);
  assert.equal(parseMotion('/media/x.mp4'), null);
  assert.equal(motionValue('waves', 'gold', 0.5), 'motion:waves:gold:0.5');
  assert.equal(MOTIONS.length, 10);
});

test('custom specs are cleaned', () => {
  const s = cleanSpec({ name: 'x', dim: 5, layers: [{ effect: 'rays', colors: ['#000000', '#ffcc00', '#ff9900', '#ffffff'], speed: 0.4, opacity: 2 },
    { effect: 'hack', colors: [] }, { effect: 'particles', colors: ['red', 'url(x)'] }, { effect: 'stars' }, { effect: 'bokeh' }] });
  assert.equal(s.dim, 0.7);
  assert.deepEqual(s.layers.map((l) => l.effect), ['rays', 'particles', 'stars']); // max 3, unknown dropped
  assert.equal(s.layers[0].opacity, 1);
  assert.equal(s.layers[1].colors.length, 4); // bad colours → default palette
  assert.equal(cleanSpec({ layers: [] }), null);
});

test('describing a background picks fitting effects and colours', () => {
  assert.equal(suggestMotion('Pentecost fire').layers[0].effect, 'embers');
  const easter = suggestMotion('slow golden light for Easter morning');
  assert.equal(easter.layers[0].effect, 'rays'); assert.equal(easter.layers[0].speed, 0.5); assert.equal(easter.layers[0].colors[1], '#ffcf6b');
  assert.equal(suggestMotion('blue starfield for Christmas').layers[0].colors[1], '#1fb6ff');
  assert.ok(suggestMotion('anything at all').layers.length >= 1);
});

test('saved motions render as a canvas carrying their spec (escaped)', () => {
  const spec = cleanSpec({ id: 'abc', name: '"><script>', layers: [{ effect: 'flow' }] });
  const html = motionCanvas('mymotion:abc', { motions: [spec] });
  assert.ok(html.startsWith('<canvas') && html.includes('data-motion-spec'));
  assert.ok(!html.includes('<script>'));
  assert.equal(findSpec({ motions: [spec] }, 'mymotion:nope'), null);
  assert.equal(motionCanvas('mymotion:nope', { motions: [] }), '');
});

test('stock downloads pick the right size', () => {
  const files = [{ w: 640, url: 'a', type: 'video/mp4' }, { w: 1920, url: 'b', type: 'video/mp4' }, { w: 3840, url: 'c', type: 'video/mp4' }, { w: 2560, url: 'd', type: 'video/webm' }];
  assert.equal(pickFile(files, 1920).url, 'b');
  assert.equal(pickFile(files, 3840).url, 'c');
  assert.equal(pickFile([{ w: 1280, url: 'e' }], 1920).url, 'e'); // best available
  assert.equal(pickFile([], 1920), null);
});
