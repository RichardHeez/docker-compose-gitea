// Planning Center Online (Services) sync: list upcoming plans and turn a plan into an F8 service.
// Auth is a Personal Access Token from https://api.planningcenteronline.com/oauth/applications
// (Application ID + Secret, sent as HTTP Basic). Set PCO_APP_ID and PCO_SECRET in .env.
import { parseReferences } from '../public/js/books.js';
import { arrangeSections, parseLyrics, slidesFor } from '../public/js/songs.js';

export function pcoClient({ appId, secret, base = 'https://api.planningcenteronline.com', fetchImpl = fetch } = {}) {
  const auth = `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`;
  async function get(path) {
    const r = await fetchImpl(`${base.replace(/\/$/, '')}/services/v2${path}`, { headers: { authorization: auth, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (r.status === 401) throw new Error('Planning Center refused the token — check PCO_APP_ID and PCO_SECRET');
    if (r.status === 429) throw new Error('Planning Center rate limit — wait a few seconds and try again');
    if (!r.ok) throw new Error(`Planning Center error ${r.status}`);
    return r.json();
  }
  // Follow `links.next` for long lists (items in a big plan).
  async function getAll(path, max = 5) {
    const first = await get(path);
    const data = [...(first.data || [])]; const included = [...(first.included || [])];
    let next = first.links?.next; let pages = 1;
    while (next && pages < max) {
      const rel = next.replace(/^.*\/services\/v2/, '');
      const page = await get(rel); data.push(...(page.data || [])); included.push(...(page.included || []));
      next = page.links?.next; pages++;
    }
    return { data, included };
  }

  return {
    async plans({ perType = 6 } = {}) {
      const types = (await get('/service_types?per_page=50')).data || [];
      const out = [];
      for (const t of types) {
        const plans = (await get(`/service_types/${t.id}/plans?filter=future&order=sort_date&per_page=${perType}`)).data || [];
        for (const p of plans) out.push({ serviceTypeId: t.id, serviceType: t.attributes?.name || 'Service', planId: p.id,
          title: p.attributes?.title || '', dates: p.attributes?.dates || '', sortDate: p.attributes?.sort_date || '', items: p.attributes?.items_count ?? null });
      }
      return out.sort((a, b) => String(a.sortDate).localeCompare(String(b.sortDate)));
    },
    async plan(serviceTypeId, planId) {
      const st = encodeURIComponent(serviceTypeId), pl = encodeURIComponent(planId);
      const plan = await get(`/service_types/${st}/plans/${pl}`);
      const items = await getAll(`/service_types/${st}/plans/${pl}/items?include=song,arrangement&per_page=100`);
      return { plan: plan.data, ...items };
    },
  };
}

// "Chorus 1" → "Chorus", "V1" → "Verse 1", "PC" → "Pre-Chorus"…: match PCO sequence names to the lyric sections.
const SHORT = { v: 'Verse', c: 'Chorus', pc: 'Pre-Chorus', b: 'Bridge', t: 'Tag', i: 'Intro', e: 'Ending', o: 'Outro', it: 'Interlude', vamp: 'Vamp' };
export function matchSequence(sections, sequence) {
  const labels = sections.map((s) => s.label);
  const has = (n) => labels.find((l) => l.toLowerCase() === n.toLowerCase());
  return (sequence || []).map((raw) => {
    const n = String(raw || '').trim(); if (!n) return null;
    if (has(n)) return has(n);
    const noOne = n.replace(/\s+1$/, ''); if (has(noOne)) return has(noOne);
    const withOne = `${n} 1`; if (has(withOne)) return has(withOne);
    const m = n.toLowerCase().match(/^([a-z]+)\s*(\d*)$/);
    if (m && SHORT[m[1]]) { const full = `${SHORT[m[1]]}${m[2] ? ` ${m[2]}` : ''}`; return has(full) || has(SHORT[m[1]]) || has(`${SHORT[m[1]]} 1`) || null; }
    return null;
  }).filter(Boolean);
}

const rel = (item, name, included) => {
  const r = item.relationships?.[name]?.data; if (!r) return null;
  return included.find((x) => x.type === r.type && x.id === r.id) || null;
};
const clean = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Turn a plan's items into { service, songs, skipped } — songs are also returned so the server can keep them in the library.
export function planToService({ data = [], included = [] }, { songLines = 4 } = {}) {
  const service = []; const songs = []; const skipped = [];
  const sorted = [...data].sort((a, b) => (a.attributes?.sequence ?? 0) - (b.attributes?.sequence ?? 0));
  let header = '';
  for (const it of sorted) {
    const a = it.attributes || {}; const title = clean(a.title); const desc = clean(a.description);
    const type = a.item_type || 'item';
    if (type === 'header') { header = title; continue; }
    const notes = [header ? `[${header}]` : '', desc].filter(Boolean).join(' ');
    header = '';
    if (type === 'song') {
      const song = rel(it, 'song', included); const arr = rel(it, 'arrangement', included);
      const lyrics = String(arr?.attributes?.lyrics || '').replace(/\r/g, '');
      const sTitle = clean(song?.attributes?.title) || title || 'Song';
      if (!lyrics.trim()) { service.push({ kind: 'text', title: `🎵 ${sTitle}`, body: 'No lyrics in Planning Center — open the song in Songs', notes }); skipped.push(`${sTitle} (no lyrics)`); continue; }
      const sections = parseLyrics(lyrics);
      const arrangement = matchSequence(sections, arr?.attributes?.sequence);
      const libSong = { pcoSongId: song?.id || '', title: sTitle, artist: clean(song?.attributes?.author), ccli: String(song?.attributes?.ccli_number || ''),
        lyrics, arrangement, source: 'planning-center' };
      songs.push(libSong);
      service.push({ kind: 'song', songId: '', pcoSongId: libSong.pcoSongId, title: sTitle, artist: libSong.artist, ccli: libSong.ccli,
        slides: slidesFor(arrangeSections(sections, arrangement), songLines), page: 0, ...(notes ? { notes } : {}) });
      continue;
    }
    const refs = parseReferences(`${title} ${desc}`);
    if (refs.length) {
      refs.forEach((ref, i) => service.push({ kind: 'scripture', ref, ...(i === 0 && title && !parseReferences(title).length ? { heading: title } : {}), ...(notes ? { notes } : {}) }));
      continue;
    }
    if (type === 'media') { service.push({ kind: 'text', title: `🎬 ${title}`, body: 'Media from Planning Center — add the file in Media', notes }); continue; }
    if (title) service.push({ kind: 'text', title, body: '', ...(notes ? { notes } : {}) });
  }
  return { service, songs, skipped };
}
