import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchSequence, pcoClient, planToService } from '../lib/pco.mjs';

const plan = JSON.parse(readFileSync(new URL('./fixtures/pco-plan.json', import.meta.url)));

test('sequence names map onto lyric sections', () => {
  const sections = [{ label: 'Verse 1' }, { label: 'Chorus' }, { label: 'Verse 2' }, { label: 'Bridge' }, { label: 'Pre-Chorus' }];
  assert.deepEqual(matchSequence(sections, ['Verse 1', 'Chorus 1', 'V2', 'C', 'PC', 'B', 'Nope']), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Pre-Chorus', 'Bridge']);
});

test('a plan becomes a service', () => {
  const { service, songs, skipped } = planToService(plan, { songLines: 2 });
  const kinds = service.map((x) => x.kind);
  assert.deepEqual(kinds, ['text', 'song', 'scripture', 'scripture', 'text', 'text']);
  assert.equal(service[0].title, 'Welcome & Announcements');
  assert.match(service[0].notes, /\[Pre-service\].*youth retreat/);
  const song = service[1];
  assert.equal(song.title, 'Amazing Grace (My Chains Are Gone)');
  assert.deepEqual(song.slides.map((s) => s.label), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Bridge']);
  assert.equal(songs[0].ccli, '4768151');
  assert.deepEqual(service[2].ref, { book: 19, chapter: 23, verseStart: 1, verseEnd: 3 });
  assert.equal(service[2].heading, 'Scripture Reading');
  assert.equal(service[3].ref.book, 45);
  assert.equal(service[3].heading, undefined);
  assert.match(service[4].title, /Song without lyrics/);
  assert.deepEqual(skipped, ['Song without lyrics (no lyrics)']);
  assert.match(service[5].title, /Offering video/);
});

test('client sends basic auth and follows pages', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push([url, opts.headers.authorization]);
    if (url.includes('/items')) {
      const page2 = url.includes('offset=1');
      return new Response(JSON.stringify({ data: [plan.data[page2 ? 1 : 0]], included: [], links: page2 ? {} : { next: 'https://x/services/v2/service_types/9/plans/7/items?offset=1' } }));
    }
    return new Response(JSON.stringify({ data: { id: '7', attributes: { title: 'Sunday', dates: 'Oct 26' } } }));
  };
  const c = pcoClient({ appId: 'id', secret: 'sec', base: 'https://x', fetchImpl });
  const r = await c.plan('9', '7');
  assert.equal(r.data.length, 2);
  assert.equal(calls[0][1], `Basic ${Buffer.from('id:sec').toString('base64')}`);
});
