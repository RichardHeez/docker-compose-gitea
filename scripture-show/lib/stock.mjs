// Free motion backgrounds from stock libraries with open APIs: Pexels and Pixabay (free API keys,
// free for church use). Search results are normalised; imports download the video into the Media library.
// The file address is always looked up again on the server from the item id, so a page can't make the
// server download from anywhere else.
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const PEXELS = () => ({ key: process.env.PEXELS_API_KEY || '', base: (process.env.PEXELS_API || 'https://api.pexels.com').replace(/\/+$/, '') });
const PIXABAY = () => ({ key: process.env.PIXABAY_API_KEY || '', base: (process.env.PIXABAY_API || 'https://pixabay.com/api').replace(/\/+$/, '') });
export const stockStatus = () => ({ pexels: !!PEXELS().key, pixabay: !!PIXABAY().key });

const ALLOWED_HOSTS = (process.env.STOCK_HOSTS || 'pexels.com,pixabay.com,vimeocdn.com').split(',').map((s) => s.trim());
const allowedUrl = (u) => {
  try { const x = new URL(u); return (x.protocol === 'https:' || process.env.STOCK_ALLOW_HTTP === '1') && ALLOWED_HOSTS.some((h) => x.hostname === h || x.hostname.endsWith(`.${h}`)); } catch { return false; }
};

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('The stock site refused the API key — check it in .env'), { status: 502 });
  if (r.status === 429) throw Object.assign(new Error('Too many searches — wait a minute'), { status: 429 });
  if (!r.ok) throw Object.assign(new Error(`Stock site error ${r.status}`), { status: r.status === 404 ? 404 : 502 });
  return r.json();
}

// Pexels moved its video endpoints under /v1; try that first, then the older path.
async function pexels(path) {
  const { key, base } = PEXELS();
  try { return await getJson(`${base}/v1/videos${path}`, { authorization: key }); }
  catch (e) { if (e.status !== 404) throw e; return getJson(`${base}/videos${path}`, { authorization: key }); }
}

const titleFromUrl = (u) => decodeURIComponent(String(u || '').split('/').filter(Boolean).pop() || '').replace(/-\d+$/, '').replace(/-/g, ' ').trim();

function fromPexels(v) {
  const files = (v.video_files || []).filter((f) => f.link && f.width >= f.height).map((f) => ({ w: f.width, h: f.height, url: f.link, type: f.file_type }));
  const small = [...files].sort((a, b) => a.w - b.w)[0];
  return { source: 'pexels', id: String(v.id), title: titleFromUrl(v.url) || `Pexels video ${v.id}`, author: v.user?.name || '', authorUrl: v.user?.url || '', pageUrl: v.url || '',
    duration: v.duration || 0, thumb: v.image || '', preview: small?.url || '', maxWidth: Math.max(0, ...files.map((f) => f.w)), files };
}
function fromPixabay(v) {
  const vids = v.videos || {};
  const files = ['large', 'medium', 'small', 'tiny'].map((k) => vids[k]).filter((f) => f?.url).map((f) => ({ w: f.width, h: f.height, url: f.url, type: 'video/mp4' }));
  return { source: 'pixabay', id: String(v.id), title: String(v.tags || `Pixabay video ${v.id}`), author: v.user || '', authorUrl: v.user ? `https://pixabay.com/users/${v.user}-${v.user_id}/` : '', pageUrl: v.pageURL || '',
    duration: v.duration || 0, thumb: vids.medium?.thumbnail || vids.small?.thumbnail || (v.picture_id ? `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg` : ''),
    preview: vids.tiny?.url || vids.small?.url || '', maxWidth: Math.max(0, ...files.map((f) => f.w)), files };
}

export async function stockSearch(source, q, page = 1) {
  const query = String(q || '').trim().slice(0, 100) || 'abstract background loop';
  if (source === 'pexels') {
    if (!PEXELS().key) throw Object.assign(new Error('Add a free PEXELS_API_KEY to .env to search Pexels'), { status: 400 });
    const j = await pexels(`/search?query=${encodeURIComponent(query)}&orientation=landscape&per_page=24&page=${page}`);
    return (j.videos || []).map(fromPexels);
  }
  if (source === 'pixabay') {
    const { key, base } = PIXABAY();
    if (!key) throw Object.assign(new Error('Add a free PIXABAY_API_KEY to .env to search Pixabay'), { status: 400 });
    const j = await getJson(`${base}/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&safesearch=true&per_page=24&page=${page}`);
    return (j.hits || []).map(fromPixabay);
  }
  throw Object.assign(new Error('Unknown stock library'), { status: 400 });
}

async function stockItem(source, id) {
  if (!/^\d{1,15}$/.test(String(id))) throw Object.assign(new Error('Bad id'), { status: 400 });
  if (source === 'pexels') return fromPexels(await pexels(`/videos/${id}`));
  if (source === 'pixabay') {
    const { key, base } = PIXABAY();
    const j = await getJson(`${base}/videos/?key=${encodeURIComponent(key)}&id=${id}`);
    if (!j.hits?.[0]) throw Object.assign(new Error('Video not found'), { status: 404 });
    return fromPixabay(j.hits[0]);
  }
  throw Object.assign(new Error('Unknown stock library'), { status: 400 });
}

// Pick the file closest to the wanted width (1920 for HD, 3840 for 4K), never smaller than needed when possible.
export function pickFile(files, want = 1920) {
  const ok = files.filter((f) => f.url && (!f.type || /mp4/i.test(f.type)));
  const atLeast = ok.filter((f) => f.w >= want).sort((a, b) => a.w - b.w);
  return atLeast[0] || ok.sort((a, b) => b.w - a.w)[0] || null;
}

// Download into `dir` as `name`. Returns { file, item, width }.
export async function stockImport(source, id, { dir, quality = 'hd', nameFor }) {
  const item = await stockItem(source, id);
  const f = pickFile(item.files, quality === '4k' ? 3840 : 1920);
  if (!f) throw Object.assign(new Error('No downloadable video file'), { status: 404 });
  if (!allowedUrl(f.url)) throw Object.assign(new Error('Refusing to download from an unexpected address'), { status: 400 });
  const r = await fetch(f.url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!r.ok || !r.body) throw Object.assign(new Error(`Download failed (${r.status})`), { status: 502 });
  const file = nameFor(item, f);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(`${dir}/${file}`));
  return { file, item, width: f.w };
}
