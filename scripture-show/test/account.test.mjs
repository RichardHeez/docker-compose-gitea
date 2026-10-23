import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createAccount, verifyLicense } from '../lib/account.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const lic = (payload) => { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `f8l1.${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`; };
const pro = (device, days = 14) => lic({ v: 1, org: 'o1', orgName: 'Grace Chapel', plan: 'pro', device, limits: { outputs: 8 }, features: ['ndi', 'record', 'stream', 'timelines'], watermark: false, iat: 0, exp: Math.floor(Date.now() / 1000) + days * 86400 });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'f8acct-'));

test('without F8 Cloud everything is unlocked (open mode)', () => {
  const a = createAccount({ dataDir: tmp() });
  assert.equal(a.status().mode, 'open'); assert.ok(a.can('ndi')); a.stop();
});

test('licensed copy without sign-in is on the Free plan', () => {
  const a = createAccount({ cloudUrl: 'http://cloud', publicKey: PUB, dataDir: tmp() });
  const s = a.status(); assert.equal(s.plan, 'free'); assert.equal(s.watermark, true); assert.equal(s.limits.outputs, 2);
  assert.equal(a.can('ndi'), false); assert.equal(a.can('designer'), true); a.stop();
});

test('sign in with a code, refresh, removal and tampering', async () => {
  const dir = tmp(); let polls = 0; let removed = false;
  const fetchImpl = async (url, opts) => {
    const p = new URL(url).pathname; const b = JSON.parse(opts.body);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (p === '/api/device/start') return json({ device_code: 'dc', user_code: 'ABCD-EFGH', verify_url: 'http://cloud/activate?code=ABCD-EFGH', interval: 0.01, expires_in: 60 });
    if (p === '/api/device/poll') return ++polls < 2 ? json({ pending: true }) : json({ device_id: 'dev1', refresh_token: 'rt', license: pro('dev1'), public_key: PUB });
    if (p === '/api/license/refresh') return removed ? json({ error: 'This computer was removed' }, 401) : (assert.equal(b.refresh_token, 'rt'), json({ license: pro('dev1', 20) }));
    return json({}, 404);
  };
  const changes = [];
  const a = createAccount({ cloudUrl: 'http://cloud', publicKey: PUB, dataDir: dir, fetchImpl, onChange: (s) => changes.push(s) });
  const s0 = await a.signIn({ name: 'Booth' });
  assert.equal(s0.pending.user_code, 'ABCD-EFGH');
  await new Promise((r) => setTimeout(r, 100));
  let s = a.status();
  assert.equal(s.plan, 'pro'); assert.equal(s.church, 'Grace Chapel'); assert.equal(s.signedIn, true); assert.equal(s.pending, null);
  assert.ok(a.can('ndi')); assert.equal(s.watermark, false);
  // survives a restart (saved to disk)
  const b = createAccount({ cloudUrl: 'http://cloud', publicKey: PUB, dataDir: dir, fetchImpl }); assert.equal(b.status().plan, 'pro');
  await a.refresh(); assert.ok(a.status().validUntil > Date.now() + 19 * 864e5);
  // a licence for another computer is not accepted here
  const file = path.join(dir, 'account.json'); const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...saved, license: pro('someone-else') }));
  assert.equal(createAccount({ cloudUrl: 'http://cloud', publicKey: PUB, dataDir: dir }).status().plan, 'free');
  fs.writeFileSync(file, JSON.stringify(saved));
  // clock turned back by days: not trusted
  assert.equal(createAccount({ cloudUrl: 'http://cloud', publicKey: PUB, dataDir: dir, now: () => Date.now() - 5 * 864e5 }).status().plan, 'free');
  // removed from the church on the website → back to Free
  removed = true; await a.refresh();
  s = a.status(); assert.equal(s.plan, 'free'); assert.equal(s.signedIn, false);
  assert.ok(changes.length >= 2);
  a.stop(); b.stop();
});

test('licences signed with another key are rejected', () => {
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(verifyLicense(pro('d'), other), null);
  assert.ok(verifyLicense(pro('d'), PUB));
});
