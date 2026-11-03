'use strict';
// StickManUp on a PC: the same game as everywhere else, in its own window.
const { app, BrowserWindow, Menu, ipcMain, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const GAME = path.join(__dirname, 'game');
const HOME = 'app://game/index.html';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};
// Set only by the automatic build: start, take pictures, write down how it went, and leave.
const SMOKE = process.env.SMU_SMOKE || '';

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

// Only the game's own files ever load in here (see below), so it may use the slow software graphics as a last resort.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('io.stickmanup.desktop');

let win = null, authCode = '', authReady = false, leaving = false;

// Signing in happens in the real browser, which comes back through stickmanup://auth?code=...
function takeLink(args) {
  for (const a of args) {
    if (!String(a).startsWith('stickmanup://auth')) continue;
    let code = '';
    try { code = new URL(a).searchParams.get('code') || ''; } catch (e) { continue; }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(code)) continue;
    authCode = code;
    sendAuth();
  }
}
function sendAuth() {
  if (!authCode || !authReady || !win || win.isDestroyed()) return;
  win.webContents.send('auth', authCode);
  authCode = '';
}

// Whether the game was last in fullscreen.
const prefsFile = () => path.join(app.getPath('userData'), 'window.json');
function wasFull() {
  try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')).full === true; } catch (e) { return false; }
}
function toggleFull() {
  if (!win) return;
  const full = !win.isFullScreen();
  win.setFullScreen(full);
  try { fs.writeFileSync(prefsFile(), JSON.stringify({ full })); } catch (e) { /* it just won't be remembered */ }
}

function checkUpdates() {
  if (!app.isPackaged || SMOKE) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.on('error', (e) => console.error('update check failed:', e && e.message));
  autoUpdater.on('update-downloaded', () => { if (win && !win.isDestroyed()) win.webContents.send('update-ready'); });
  autoUpdater.checkForUpdates().catch(() => {});
}

function makeWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 450,
    show: false,
    title: 'StickManUp',
    backgroundColor: '#03060a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Someone hosting a room keeps it running with another window in front.
      backgroundThrottling: false,
    },
  });
  if (wasFull()) win.setFullScreen(true);
  else win.maximize();
  win.once('ready-to-show', () => win.show());

  // This window only ever shows the game. Links open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://game/')) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && (i.key === 'F11' || (i.alt && i.key === 'Enter'))) {
      e.preventDefault();
      toggleFull();
    }
  });
  win.webContents.once('did-finish-load', checkUpdates);

  // Give the game a moment to send what it hasn't yet.
  win.on('close', (e) => {
    if (leaving || SMOKE) return;
    e.preventDefault();
    leaving = true;
    const done = () => { if (win && !win.isDestroyed()) win.destroy(); };
    setTimeout(done, 2500);
    win.webContents.executeJavaScript('window.SMU_leave ? window.SMU_leave() : 0', true).then(done, done);
  });
  win.on('closed', () => { win = null; });

  if (SMOKE) smoke();
  win.loadURL(HOME);
}

// The build has no way to know the app works but to run it.
function smoke() {
  const out = { errors: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (s) => win.webContents.executeJavaScript(s, true);
  const shot = async (name) => fs.writeFileSync(`${SMOKE}-${name}.png`, (await win.webContents.capturePage()).toPNG());
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) out.errors.push(String(e.message).slice(0, 300)); });
  win.webContents.on('render-process-gone', (e, d) => { out.gone = d.reason; finish(1); });
  const finish = (code) => {
    fs.writeFileSync(`${SMOKE}.json`, JSON.stringify(out, null, 1));
    app.exit(code);
  };
  setTimeout(() => { out.timeout = true; finish(1); }, 240000);
  win.webContents.once('did-finish-load', async () => {
    try {
      for (let i = 0; i < 200; i++) {
        await wait(1000);
        if (await js('!!(window.SMU && SMU.pool && SMU.pool.warm === 0)')) break;
      }
      await wait(2000);
      out.screen = await js('SMU.screen');
      out.gpu = await js('SMU.renderer.gpu');
      out.language = await js('navigator.language');
      out.desktop = await js('typeof window.Desktop');
      await shot('title');
      await js('SMU.startSolo(0, 0, null)');
      await wait(8000);
      out.game = await js('SMU.screen');
      await shot('game');
      out.ok = !!out.screen && out.game === 'game' && out.desktop === 'object';
      finish(out.ok ? 0 : 1);
    } catch (e) {
      out.failed = String(e && e.message);
      finish(1);
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, args) => {
    takeLink(args);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  takeLink(process.argv);

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    if (app.isPackaged && !SMOKE) app.setAsDefaultProtocolClient('stickmanup');
    protocol.handle('app', async (req) => {
      const u = new URL(req.url), rel = path.normalize(decodeURIComponent(u.pathname)).replace(/^[\\/]+/, '') || 'index.html';
      const file = path.join(GAME, rel);
      if (u.host !== 'game' || !file.startsWith(GAME + path.sep)) return new Response('', { status: 404 });
      try {
        return new Response(await fs.promises.readFile(file), { headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' } });
      } catch (e) {
        return new Response('', { status: 404 });
      }
    });
    ipcMain.on('quit', () => { if (win) win.close(); else app.quit(); });
    ipcMain.on('fullscreen', toggleFull);
    ipcMain.on('auth-ready', () => { authReady = true; sendAuth(); });
    makeWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
