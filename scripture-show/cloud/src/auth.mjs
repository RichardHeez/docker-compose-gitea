// Passwords (scrypt), random tokens and their hashes. Only hashes of tokens are stored.
import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);
const N = 16384, R = 8, P = 1, LEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, n, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(String(password), Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

// Short code a person types on the website to approve a computer: 8 letters, no look-alikes.
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function userCode() {
  const b = randomBytes(8); let s = '';
  for (let i = 0; i < 8; i++) s += ALPHA[b[i] % ALPHA.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
export function passwordProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 8) return 'Use at least 8 characters for the password';
  if (pw.length > 200) return 'That password is too long';
  return '';
}
