// Exposes desktop-only features (screens, full-screen outputs, NDI) to the console page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('f8Desktop', {
  displays: () => ipcRenderer.invoke('displays'),
  openOutput: (ch, displayId) => ipcRenderer.invoke('open-output', ch, displayId),
  closeOutput: (ch) => ipcRenderer.invoke('close-output', ch),
  ndi: (ch, on) => ipcRenderer.invoke('ndi', ch, on),
  ndiStatus: () => ipcRenderer.invoke('ndi-status'),
});
