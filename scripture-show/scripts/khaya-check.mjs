// Checks your Khaya (GhanaNLP) key with a real recording and shows exactly what comes back.
//   npm run khaya-check -- path/to/recording.wav [language]
// Record yourself on a phone saying e.g. "Yohane ti abiɛsa nkyekyɛm dunsia" (wav, mp3, m4a, ogg or webm).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReferences, parseFollowUp, formatRef } from '../public/js/books.js';

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, '..', '.env')); } catch { /* no .env */ }

const [file, lang = 'twi'] = process.argv.slice(2);
const key = process.env.KHAYA_API_KEY;
const url = process.env.KHAYA_ASR_URL || 'https://translation-api.ghananlp.org/asr/v1/transcribe';
const header = process.env.KHAYA_KEY_HEADER || 'Ocp-Apim-Subscription-Key';
const param = process.env.KHAYA_LANG_PARAM || 'language';
const TYPES = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm' };

if (!key) { console.error('✗ KHAYA_API_KEY is not set. Put it in the .env file next to docker-compose.yml.'); process.exit(1); }
if (!file || !fs.existsSync(file)) { console.error('Usage: npm run khaya-check -- recording.wav [twi|fat|ewe|gaa|...]'); process.exit(1); }

const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
const target = `${url}${url.includes('?') ? '&' : '?'}${param}=${encodeURIComponent(lang)}`;
console.log(`→ POST ${target}\n  ${header}: ${key.slice(0, 4)}…${key.slice(-4)}   content-type: ${type}   ${fs.statSync(file).size} bytes`);

const t0 = Date.now();
let r;
try { r = await fetch(target, { method: 'POST', headers: { [header]: key, 'content-type': type }, body: fs.readFileSync(file) }); }
catch (e) { console.error(`✗ Could not reach Khaya: ${e.cause?.code || e.message}. Check the internet connection / firewall.`); process.exit(1); }
const raw = await r.text();
console.log(`← ${r.status} ${r.statusText} in ${Date.now() - t0} ms   content-type: ${r.headers.get('content-type')}`);
console.log(`  body: ${raw.slice(0, 800)}`);

if (!r.ok) {
  const hints = {
    401: 'The key was refused: check it was copied fully, and that your account is subscribed to the speech-to-text (ASR) product.',
    403: 'Access denied: your subscription may not include speech-to-text, or the quota is used up.',
    404: 'Wrong address: GhanaNLP may have changed the ASR URL. Set KHAYA_ASR_URL in .env to the one shown in their portal.',
    415: 'Audio format not accepted: try a .wav or .mp3 file.',
    400: 'Request not accepted: check the language code and audio format (try .wav or .mp3).',
    429: 'Too many requests / quota reached: wait a bit or check your plan.',
  };
  console.log(`\n✗ ${hints[r.status] || 'Khaya returned an error.'}\n  Send this output (without the key) to whoever maintains F8.`);
  process.exit(1);
}

let text = raw;
try { const j = JSON.parse(raw); text = typeof j === 'string' ? j : j.text ?? j.transcription ?? j.transcript ?? j.result ?? j.output ?? j.data?.text ?? raw; } catch { /* plain text */ }
console.log(`\n✓ Transcript: “${text}”`);
const refs = parseReferences(String(text), undefined, 'ak-GH');
const follow = refs.length ? null : parseFollowUp(String(text), 'ak-GH');
console.log(refs.length ? `✓ F8 would show: ${refs.map((x) => formatRef(x)).join(' ; ')}`
  : follow ? `✓ F8 hears a follow-up: ${JSON.stringify(follow)}`
  : '• No scripture reference recognised in that transcript. If the words are right but not understood, add them under AI · Voice → Custom words, or send the transcript to whoever maintains F8.');
