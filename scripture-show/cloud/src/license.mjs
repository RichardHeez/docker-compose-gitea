// Licences: a small signed note ("this computer belongs to Grace Chapel, Pro plan, valid until …").
// Signed with Ed25519; the F8 app checks it with the public key, so it keeps working offline until it expires.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function loadSigningKey({ privatePem, dataDir }) {
  let pem = privatePem;
  if (!pem) {
    const file = path.join(dataDir, 'license-signing-key.pem');
    if (fs.existsSync(file)) pem = fs.readFileSync(file, 'utf8');
    else {
      // First run without LICENSE_PRIVATE_KEY: make one and keep it. Back this file up — losing it means
      // every installed app needs a new public key.
      pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, pem, { mode: 0o600 });
      console.warn(`Created a licence signing key at ${file} — back it up, or set LICENSE_PRIVATE_KEY.`);
    }
  }
  const privateKey = createPrivateKey(pem);
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  return { privateKey, publicPem };
}

export function signLicense(privateKey, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `f8l1.${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`;
}

export function verifyLicense(token, publicPem, now = Date.now()) {
  const [tag, body, sig] = String(token || '').split('.');
  if (tag !== 'f8l1' || !body || !sig) return null;
  try {
    if (!verify(null, Buffer.from(body), createPublicKey(publicPem), Buffer.from(sig, 'base64url'))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp * 1000 > now ? p : null;
  } catch { return null; }
}
