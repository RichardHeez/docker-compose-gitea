// Protected build for selling F8: bundles the app and scrambles ("obfuscates") the code so it can't
// simply be read, copied or edited. Output: build/app — the desktop installer is made from this,
// never from the readable source.
//
//   npm run build:secure      (npm run dist runs it first)
import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'build', 'app');
const t0 = Date.now();

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// Packages that stay as separate files (native code, binaries, Electron itself).
const external = ['electron', '@stagetimerio/grandiose', 'ffmpeg-static', '@anthropic-ai/sdk'];
const banner = '/* F8 Scripture Presenter — © F8. All rights reserved. Unauthorised copying, modification or distribution is prohibited. */';

// 1. Server and desktop app (Node).
await build({ entryPoints: { server: path.join(root, 'server.mjs') }, outdir: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outExtension: { '.js': '.mjs' }, external, minify: true, legalComments: 'none', banner: { js: banner }, logLevel: 'warning' });
await build({ entryPoints: { 'desktop/main': path.join(root, 'desktop/main.mjs') }, outdir: out, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outExtension: { '.js': '.mjs' }, external, minify: true, legalComments: 'none', banner: { js: banner }, logLevel: 'warning' });
fs.copyFileSync(path.join(root, 'desktop/preload.cjs'), path.join(out, 'desktop/preload.cjs'));
for (const f of ['cloud.json']) if (fs.existsSync(path.join(root, 'desktop', f))) fs.copyFileSync(path.join(root, 'desktop', f), path.join(out, 'desktop', f));

// 2. Pages (browser): one bundle per page, same file names so the HTML is unchanged.
const pages = ['app', 'output', 'remote'];
await build({ entryPoints: Object.fromEntries(pages.map((p) => [`public/js/${p}`, path.join(root, `public/js/${p}.js`)])), outdir: out, bundle: true,
  platform: 'browser', format: 'esm', target: 'es2022', minify: true, legalComments: 'none', banner: { js: banner }, logLevel: 'warning' });
for (const f of fs.readdirSync(path.join(root, 'public'))) {
  if (f === 'js') continue;
  fs.cpSync(path.join(root, 'public', f), path.join(out, 'public', f), { recursive: true });
}

// 3. Data the app ships with.
for (const d of ['songs', 'bibles']) if (fs.existsSync(path.join(root, d))) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });

// 4. Scramble every script. Settings chosen to keep the screens smooth (no control-flow flattening).
const obf = (file, target) => {
  const code = fs.readFileSync(file, 'utf8');
  const res = JavaScriptObfuscator.obfuscate(code, {
    target, sourceType: 'module', compact: true, simplify: true,
    identifierNamesGenerator: 'hexadecimal', renameGlobals: false,
    stringArray: true, stringArrayThreshold: 0.8, stringArrayEncoding: ['base64'], stringArrayRotate: true, stringArrayShuffle: true,
    stringArrayWrappersCount: 1, stringArrayWrappersType: 'variable',
    controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false, debugProtection: false,
    numbersToExpressions: false, splitStrings: false, transformObjectKeys: false, unicodeEscapeSequence: false,
  });
  fs.writeFileSync(file, `${banner}\n${res.getObfuscatedCode()}`);
};
for (const f of ['server.mjs', 'desktop/main.mjs']) obf(path.join(out, f), 'node');
for (const p of pages) obf(path.join(out, `public/js/${p}.js`), 'browser');

const size = (f) => `${Math.round(fs.statSync(path.join(out, f)).size / 1024)} KB`;
console.log(`Protected build ready in build/app (${((Date.now() - t0) / 1000).toFixed(1)} s): server ${size('server.mjs')}, console ${size('public/js/app.js')}, outputs ${size('public/js/output.js')}`);
