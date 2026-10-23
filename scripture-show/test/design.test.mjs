import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DESIGNS, cleanDesign, designHtml, elementHtml, hasRole, newElement } from '../public/js/design.js';

test('starter designs survive cleaning unchanged in shape', () => {
  for (const d of STARTER_DESIGNS) {
    const c = cleanDesign(d);
    assert.equal(c.elements.length, d.elements.length);
    assert.equal(c.name, d.name);
  }
  assert.ok(hasRole(STARTER_DESIGNS[0], 'body'));
  assert.ok(!hasRole(STARTER_DESIGNS[2], 'body'));
});

test('cleanDesign drops junk and clamps values', () => {
  const c = cleanDesign({ name: 'x', elements: [
    { type: 'script', x: 1 },
    { type: 'text', x: 'abc', y: 9999, w: -5, size: 1e6, color: 'red;background:url(x)', role: 'evil', align: 'justify' },
    { type: 'shape', fill: 'url(javascript:alert(1))' },
  ] });
  assert.equal(c.elements.length, 2);
  const [t, s] = c.elements;
  assert.equal(t.x, 0); assert.equal(t.y, 150); assert.equal(t.w, 0.1); assert.equal(t.size, 600);
  assert.equal(t.color, '#ffffff'); assert.equal(t.role, ''); assert.equal(t.align, 'center');
  assert.equal(s.fill, '#000000');
  assert.equal(cleanDesign(null), null);
});

test('text is escaped and role boxes take live content', () => {
  const e = newElement('text', { text: '<img src=x onerror=alert(1)>', role: '' });
  const html = elementHtml(e);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  const body = newElement('text', { role: 'body', text: 'sample' });
  const filled = elementHtml(body, { body: '<span class="ln">Amazing grace</span>', reference: '', title: '' });
  assert.ok(filled.includes('Amazing grace') && !filled.includes('sample'));
  assert.ok(elementHtml(body).includes('sample')); // editor shows the sample text
});

test('unsafe image and background URLs are not rendered', () => {
  const img = newElement('image', { src: 'javascript:alert(1)' });
  assert.ok(!elementHtml(img).includes('javascript'));
  const html = designHtml({ background: "x');background:url(evil", elements: [] });
  assert.ok(!html.includes('evil'));
  assert.ok(designHtml({ background: '/media/a.mp4', elements: [] }).includes('<video'));
  assert.ok(designHtml({ background: '#112233', elements: [] }).includes('#112233'));
});
