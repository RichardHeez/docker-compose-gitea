// F8 account on this computer: sign in with a code (approved on the F8 Cloud website), keep a signed
// licence, refresh it in the background, and answer "is this feature included in the plan?".
//
// F8_CLOUD_URL not set → "open" mode: everything is unlocked (self-hosting and development, as before).
// F8_CLOUD_URL set     → the plan in the licence decides; without a valid licence the Free plan applies.
import { createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const FREE = { plan: 'free', limits: { outputs: 2, devices: 1, seats: 2 }, features: ['designer', 'remote'], watermark: true };
export const FEATURE_NAMES = { ndi: 'NDI output', record: 'Recording', stream: 'Live streaming', ai: 'AI verse detection', khaya: 'Twi/Akan voice (Khaya)',
  pco: 'Planning Center', stock: 'Motion library search', aiMotion: 'AI motion maker', timelines: 'Song timelines', edgeBlend: 'Edge blending & masks',
  remote: 'Phone remote', designer: 'Slide designer' };

export function verifyLicense(token, publicPem, now = Date.now()) {
  const [tag, body, sig] = String(token || '').split('.');
  if (tag !== 'f8l1' || !body || !sig || !publicPem) return null;
  try {
    if (!verify(null, Buffer.from(body), createPublicKey(publicPem), Buffer.from(sig, 'base64url'))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp * 1000 > now ? p : null;
  } catch { return null; }
}

export function createAccount({ cloudUrl = '', publicKey = '', dataDir, fetchImpl = fetch, onChange = () => {}, now = () => Date.now() } = {}) {
  const file = path.join(dataDir, 'account.json');
  const cloud = String(cloudUrl || '').replace(/\/+$/, '');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not signed in */ }
  let pending = null; // { user_code, verify_url, expires }
  let pollTimer = null; let lastError = '';
  const save = () => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(saved, null, 1), { mode: 0o600 }); };
  const key = () => (publicKey || saved.public_key || '').replace(/\\n/g, '\n');

  function license() {
    if (!cloud) return null;
    const t = now();
    // Clock turned back to stretch an offline licence? Then don't trust it.
    if (saved.lastSeen && t < saved.lastSeen - 86400_000) return null;
    const p = verifyLicense(saved.license, key(), t);
    if (p && saved.device_id && p.device !== saved.device_id) return null;
    return p;
  }

  function status() {
    if (!cloud) return { mode: 'open', plan: 'open', features: Object.keys(FEATURE_NAMES), limits: { outputs: 999 }, watermark: false };
    const p = license();
    const base = p ? { plan: p.plan, limits: p.limits, features: p.features, watermark: p.watermark } : FREE;
    return { mode: 'licensed', ...base, signedIn: !!saved.device_id, church: p?.orgName || saved.orgName || '', validUntil: p ? p.exp * 1000 : null,
      sub: p?.sub || null, pending: pending && pending.expires > now() ? { user_code: pending.user_code, verify_url: pending.verify_url } : null,
      error: lastError, accountUrl: `${cloud}/account`, pricingUrl: `${cloud}/#pricing` };
  }
  const can = (feature) => { const s = status(); return s.mode === 'open' || s.features.includes(feature); };

  async function post(p, body) {
    const r = await fetchImpl(`${cloud}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `F8 Cloud error ${r.status}`), { status: r.status });
    return j;
  }

  function take(j) {
    const pk = publicKey || j.public_key || saved.public_key;
    const p = verifyLicense(j.license, pk.replace(/\\n/g, '\n'), now());
    if (!p) throw new Error('The licence from F8 Cloud could not be checked');
    saved = { ...saved, license: j.license, orgName: p.orgName, lastSeen: Math.max(now(), saved.lastSeen || 0), ...(j.device_id ? { device_id: j.device_id, refresh_token: j.refresh_token } : {}), ...(!publicKey && j.public_key ? { public_key: j.public_key } : {}) };
    save(); lastError = ''; onChange(status());
  }

  async function signIn({ name = 'F8 computer', platform = process.platform } = {}) {
    if (!cloud) throw new Error('This copy of F8 is not connected to F8 Cloud');
    clearTimeout(pollTimer);
    const s = await post('/api/device/start', { name, platform });
    pending = { ...s, expires: now() + s.expires_in * 1000 };
    onChange(status());
    const poll = async () => {
      if (!pending || pending.expires < now()) { pending = null; onChange(status()); return; }
      try {
        const r = await post('/api/device/poll', { device_code: pending.device_code });
        if (r.pending) { pollTimer = setTimeout(poll, (pending.interval || 5) * 1000); return; }
        pending = null; take(r);
      } catch (e) { lastError = e.message; pending = null; onChange(status()); }
    };
    pollTimer = setTimeout(poll, (s.interval || 5) * 1000);
    return status();
  }

  async function refresh() {
    if (!cloud || !saved.device_id) return status();
    try { take(await post('/api/license/refresh', { device_id: saved.device_id, refresh_token: saved.refresh_token })); }
    catch (e) {
      lastError = e.status ? e.message : 'Offline — using the saved licence';
      if (e.status === 401) { saved = { public_key: saved.public_key }; save(); } // computer removed from the church
      onChange(status());
    }
    return status();
  }

  function signOut() { clearTimeout(pollTimer); pending = null; saved = saved.public_key ? { public_key: saved.public_key } : {}; save(); onChange(status()); return status(); }

  // Refresh at start and every 6 hours.
  const timer = setInterval(refresh, 6 * 3600_000); timer.unref?.();
  if (cloud && saved.device_id) setTimeout(refresh, 2000).unref?.();

  return { status, can, signIn, signOut, refresh, stop: () => { clearInterval(timer); clearTimeout(pollTimer); } };
}
