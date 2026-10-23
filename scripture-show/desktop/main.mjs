// F8 desktop app: runs the server in-process, opens the console, puts output channels
// full screen on chosen displays (remembered between runs) and can send channels as NDI sources.
import { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNdi, stopNdi, ndiActive, stopAllNdi } from './ndi.mjs';
import { startCapture, stopCapture, captureStatus, stopAllCaptures } from './capture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_DIR ||= path.join(app.getPath('userData'), 'data');
process.env.PORT ||= '4848';

// Video backgrounds should play with sound on outputs without a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const SETTINGS = path.join(app.getPath('userData'), 'desktop.json');
const settings = (() => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return { outputs: {}, ndi: [] }; } })();
const saveSettings = () => fs.writeFile(SETTINGS, JSON.stringify(settings, null, 2), () => {});

let base = '';
let consoleWin = null;
const outputs = new Map(); // channel -> BrowserWindow

const displayInfo = () => screen.getAllDisplays().map((d, i) => ({
  id: d.id, label: d.label || `Display ${i + 1}`, width: d.size.width, height: d.size.height,
  primary: d.id === screen.getPrimaryDisplay().id,
}));

function openOutput(ch, displayId) {
  outputs.get(ch)?.destroy();
  const display = screen.getAllDisplays().find((d) => d.id === displayId);
  const b = display ? display.bounds : { width: 960, height: 540 };
  const win = new BrowserWindow({
    ...(display ? { x: b.x, y: b.y } : {}), width: b.width, height: b.height,
    fullscreen: !!display, frame: !display, backgroundColor: '#000000', autoHideMenuBar: true,
    title: `F8 — Channel ${ch}`,
    webPreferences: { backgroundThrottling: false },
  });
  win.loadURL(`${base}/output.html?ch=${ch}&embed`);
  win.on('closed', () => { if (outputs.get(ch) === win) outputs.delete(ch); });
  outputs.set(ch, win);
  if (display) settings.outputs[ch] = { displayId, label: display.label };
  else delete settings.outputs[ch];
  saveSettings();
  return { ok: true };
}

function restoreOutputs() {
  for (const [ch, o] of Object.entries(settings.outputs || {})) {
    if (screen.getAllDisplays().some((d) => d.id === o.displayId)) openOutput(Number(ch), o.displayId);
  }
}

async function setNdi(ch, on) {
  try {
    if (on) await startNdi(ch, `${base}/output.html?ch=${ch}&embed&ndi`);
    else await stopNdi(ch);
    settings.ndi = ndiActive();
    saveSettings();
    return { ok: true };
  } catch (e) {
    return { error: `NDI unavailable: ${e.message}. Install the NDI runtime and run “npm install” (needs @stagetimerio/grandiose).` };
  }
}

ipcMain.handle('displays', () => displayInfo());
ipcMain.handle('open-output', (_e, ch, displayId) => openOutput(ch, displayId));
ipcMain.handle('close-output', (_e, ch) => { outputs.get(ch)?.destroy(); delete settings.outputs[ch]; saveSettings(); });
ipcMain.handle('ndi', (_e, ch, on) => setNdi(ch, on));
ipcMain.handle('ndi-status', () => ndiActive());
ipcMain.handle('rec-start', async (_e, ch, opts = {}) => {
  try { return await startCapture(ch, `${base}/output.html?ch=${ch}&embed`, { ...opts, mediaDir: path.join(process.env.DATA_DIR, 'media') }); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('rec-stop', (_e, ch) => stopCapture(ch));
ipcMain.handle('rec-status', () => captureStatus());

function buildMenu(channels) {
  const outputMenu = Array.from({ length: channels }, (_, i) => ({
    label: `Channel ${i + 1}`,
    submenu: [
      ...displayInfo().map((d) => ({ label: `Full screen on ${d.label} (${d.width}×${d.height})`, click: () => openOutput(i + 1, d.id) })),
      { label: 'In a window', click: () => openOutput(i + 1, null) },
      { label: 'Close', click: () => { outputs.get(i + 1)?.destroy(); delete settings.outputs[i + 1]; saveSettings(); } },
    ],
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'Outputs', submenu: [...outputMenu, { type: 'separator' }, { label: 'Close all outputs', click: () => outputs.forEach((w) => w.destroy()) }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'Open console in browser (for live listening)', click: () => shell.openExternal(base) },
      { label: 'Phone remote address…', click: () => dialog.showMessageBox({ message: 'Open this on a phone on the same Wi-Fi:', detail: lanRemote() }) },
      { label: 'Open data folder', click: () => shell.openPath(process.env.DATA_DIR) },
    ] },
  ]));
}

function lanRemote() {
  const nets = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  const port = new URL(base).port;
  return nets.map((n) => `http://${n.address}:${port}/remote`).join('\n') || `${base}/remote`;
}

app.whenReady().then(async () => {
  // Cameras/capture cards for live video, and the microphone for listening: allow without prompts.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(['media', 'midi', 'midiSysex', 'fullscreen', 'window-management'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ['media', 'midi', 'window-management'].includes(permission));
  const server = await import(path.join(here, '..', 'server.mjs'));
  const port = await server.ready;
  base = `http://localhost:${port}`;
  const info = await fetch(`${base}/api/info`).then((r) => r.json()).catch(() => ({ channels: 8 }));
  buildMenu(info.channels);
  screen.on('display-added', () => { buildMenu(info.channels); restoreOutputs(); });
  screen.on('display-removed', () => buildMenu(info.channels));

  consoleWin = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1024, minHeight: 640, backgroundColor: '#0b0d17', title: 'F8 Scripture Presenter',
    webPreferences: { preload: path.join(here, 'preload.cjs') },
  });
  consoleWin.loadURL(base);
  consoleWin.webContents.setWindowOpenHandler(({ url }) => {
    const m = /output\.html\?ch=(\d+)/.exec(url);
    if (m) { openOutput(Number(m[1]), null); return { action: 'deny' }; }
    shell.openExternal(url); return { action: 'deny' };
  });
  consoleWin.on('closed', () => app.quit());

  restoreOutputs();
  for (const ch of settings.ndi || []) await setNdi(ch, true);
});

app.on('before-quit', () => { stopAllNdi(); stopAllCaptures(); });
app.on('window-all-closed', () => app.quit());
