// NDI output: renders a channel in a hidden off-screen window and sends its frames as an NDI source
// named "Lumen Ch N". Uses @stagetimerio/grandiose (bundles the NDI SDK); loaded only when needed.
import { BrowserWindow } from 'electron';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const senders = new Map(); // ch -> { win, sender, timer, last }
let grandiose = null;

function lib() {
  if (!grandiose) grandiose = require('@stagetimerio/grandiose');
  return grandiose;
}

export async function startNdi(ch, url, { width = 1920, height = 1080, fps = 30 } = {}) {
  if (senders.has(ch)) return;
  const g = lib();
  const sender = await g.send({ name: `Lumen Ch ${ch}`, clockVideo: false, clockAudio: false });
  const win = new BrowserWindow({
    show: false, width, height, frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setZoomFactor(1);
  win.webContents.setFrameRate(fps);
  win.webContents.setAudioMuted(true);
  const entry = { win, sender, timer: null, last: null, busy: false };
  senders.set(ch, entry);

  const sendFrame = async (image) => {
    if (entry.busy) return;
    const size = image.getSize();
    if (!size.width) return;
    entry.busy = true;
    try {
      await sender.video({
        xres: size.width, yres: size.height,
        frameRateN: fps * 1000, frameRateD: 1000,
        fourCC: g.FOURCC_BGRA,
        pictureAspectRatio: size.width / size.height,
        frameFormatType: g.FORMAT_TYPE_PROGRESSIVE,
        lineStrideBytes: size.width * 4,
        data: image.toBitmap(), // BGRA, keeps alpha for transparent channels
      });
    } catch (e) { console.warn('NDI send failed', e.message); }
    finally { entry.busy = false; }
  };

  win.webContents.on('paint', (_e, _dirty, image) => { entry.last = image; sendFrame(image); });
  // Re-send the last frame regularly so receivers keep the source alive when nothing changes.
  entry.timer = setInterval(() => entry.last && sendFrame(entry.last), 1000 / 5);
  await win.loadURL(url);
}

export async function stopNdi(ch) {
  const e = senders.get(ch);
  if (!e) return;
  senders.delete(ch);
  clearInterval(e.timer);
  e.win.destroy();
  await e.sender.destroy?.().catch(() => {});
}

export const ndiActive = () => [...senders.keys()];
export const stopAllNdi = () => Promise.all([...senders.keys()].map(stopNdi));
