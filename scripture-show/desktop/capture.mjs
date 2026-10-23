// Desktop recording & streaming: renders a channel in a hidden off-screen window (like NDI) and pipes
// its frames to ffmpeg at a steady frame rate — no screen picker, works even while the output is on a projector.
import { BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { QUALITY, recordingName, startEncoder } from '../lib/encoder.mjs';

const runs = new Map(); // ch -> { win, enc, timer, last, file }

export async function startCapture(ch, url, { quality = '1080p', record = true, rtmp = '', mediaDir, fps = 30 } = {}) {
  if (runs.has(ch)) throw new Error(`Channel ${ch} is already recording or streaming`);
  const q = QUALITY[quality] || QUALITY['1080p'];
  fs.mkdirSync(mediaDir, { recursive: true });
  const file = record ? path.join(mediaDir, recordingName(`Ch${ch}`)) : '';
  const enc = await startEncoder({ input: 'raw', width: q.width, height: q.height, fps, bitrate: q.bitrate, file, rtmp });
  const win = new BrowserWindow({
    show: false, width: q.width, height: q.height, frame: false, backgroundColor: '#000000',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(fps);
  win.webContents.setAudioMuted(true);
  const run = { win, enc, timer: null, last: null, file };
  runs.set(ch, run);
  win.webContents.on('paint', (_e, _dirty, image) => { run.last = image; });
  run.timer = setInterval(() => {
    if (!run.last) return;
    if (enc.info().ended) { stopCapture(ch); return; }
    let img = run.last; const s = img.getSize();
    if (s.width !== q.width || s.height !== q.height) img = img.resize({ width: q.width, height: q.height });
    enc.write(img.toBitmap()); // BGRA
  }, 1000 / fps);
  await win.loadURL(url);
  return { ok: true, file: file ? path.basename(file) : '' };
}

export async function stopCapture(ch) {
  const run = runs.get(ch); if (!run) return { ok: true };
  runs.delete(ch);
  clearInterval(run.timer);
  run.win.destroy();
  const info = await run.enc.stop();
  return { ok: true, file: run.file ? path.basename(run.file) : '', error: info.error };
}

export const captureStatus = () => [...runs.entries()].map(([ch, r]) => ({ ch, ...r.enc.info(), file: r.file ? path.basename(r.file) : '' }));
export const stopAllCaptures = () => Promise.all([...runs.keys()].map(stopCapture));
