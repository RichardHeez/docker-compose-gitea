// Desktop recording & streaming: renders a channel in a hidden off-screen window (like NDI) and pipes
// its frames to ffmpeg at a steady frame rate — no screen picker, works even while the output is on a projector.
import { BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { QUALITY, recordingName, startEncoder } from '../lib/encoder.mjs';

const runs = new Map(); // ch -> { win, enc, timer, last, file }

export async function startCapture(ch, url, { quality = '1080p', record = true, rtmp = '', mediaDir, fps = 30, audio = false, audioDelay = 0 } = {}) {
  if (runs.has(ch)) throw new Error(`Channel ${ch} is already recording or streaming`);
  const q = QUALITY[quality] || QUALITY['1080p'];
  fs.mkdirSync(mediaDir, { recursive: true });
  const file = record ? path.join(mediaDir, recordingName(`Ch${ch}`)) : '';
  const enc = await startEncoder({ input: 'raw', width: q.width, height: q.height, fps, bitrate: q.bitrate, file, rtmp, audio: audio ? 'pcm' : 'none', audioDelay });
  const win = new BrowserWindow({
    show: false, width: q.width, height: q.height, frame: false, backgroundColor: '#000000',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(fps);
  win.webContents.setAudioMuted(true);
  const run = { win, enc, timer: null, last: null, file };
  runs.set(ch, run);
  win.webContents.on('paint', (_e, _dirty, image) => { run.last = image; });
  // Frames are paced by the clock (not by timer ticks, which drift), so the picture stays in step with the
  // sound over a long service: if a tick is late, the last frame is repeated to catch up.
  const black = Buffer.alloc(q.width * q.height * 4);
  const t0 = Date.now(); let sent = 0;
  let cached = null; let cachedFrom = null;
  run.timer = setInterval(() => {
    if (enc.info().ended) { stopCapture(ch); return; }
    if (run.last && run.last !== cachedFrom) {
      let img = run.last; const sz = img.getSize();
      if (sz.width !== q.width || sz.height !== q.height) img = img.resize({ width: q.width, height: q.height });
      cached = img.toBitmap(); cachedFrom = run.last; // BGRA
    }
    const due = Math.floor(((Date.now() - t0) * fps) / 1000) + 1;
    for (let n = 0; sent < due && n < fps; n++, sent++) enc.write(cached || black);
    if (due - sent > fps) sent = due; // far behind (computer too busy): skip rather than pile up
  }, 1000 / fps / 2);
  await win.loadURL(url);
  return { ok: true, file: file ? path.basename(file) : '' };
}

// Sound from the console's mixer (48 kHz stereo 16-bit PCM).
export function captureAudio(ch, buf) { runs.get(ch)?.enc.writeAudio(Buffer.from(buf)); }

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
