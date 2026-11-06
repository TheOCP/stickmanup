'use strict';
// All the game can ask of the PC app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('Desktop', {
  quit: () => ipcRenderer.send('quit'),
  fullscreen: () => ipcRenderer.send('fullscreen'),
  windowSize: (w, h) => ipcRenderer.send('window-size', w, h),
  onAuth: (f) => {
    ipcRenderer.on('auth', (e, code) => f(String(code)));
    ipcRenderer.send('auth-ready');
  },
  onUpdate: (f) => {
    ipcRenderer.on('update-ready', () => f());
    ipcRenderer.send('update-listen');
  },
  installUpdate: () => ipcRenderer.send('install-update'),
});
