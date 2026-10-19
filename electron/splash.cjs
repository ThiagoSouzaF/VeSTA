// The opening window: frameless, centred, off the taskbar, ink background. It only shows state sent by the boot
// (see boot.cjs); it can fade out, and it shows a readable error instead of vanishing if the boot fails.
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { MIN_SPLASH_MS, splashRemaining } = require('./boot.cjs');

const FADE_MS = 280;
const SIZE = { width: 460, height: 660 };

function createSplash({ onQuit, onProceed }) {
  const win = new BrowserWindow({
    ...SIZE,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../assets/vesta.png'),
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  let resolveShown;
  // Resolves when the splash is on screen (or after a grace period, so a slow paint never stalls the boot).
  const whenShown = new Promise((resolve) => (resolveShown = resolve));
  setTimeout(resolveShown, 2500);
  let last = null,
    pageReady = false,
    shownAt = 0,
    closed = false;
  const push = () => {
    if (pageReady && last && !win.isDestroyed())
      win.webContents.send('splash:state', { ...last, version: app.getVersion() });
  };
  const mine = (event) => event.sender === win.webContents;
  const on = (channel, handler) => {
    const listener = (event) => mine(event) && handler();
    ipcMain.on(channel, listener);
    win.once('closed', () => ipcMain.removeListener(channel, listener));
  };
  on('splash:ready', () => {
    pageReady = true;
    push();
  });
  on('splash:quit', () => onQuit());
  on('splash:proceed', () => onProceed());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => {
    shownAt = Date.now();
    win.show();
    resolveShown();
  });
  win.once('closed', () => (closed = true));
  if (process.env.VESTA_DEV === '1') win.loadURL('http://127.0.0.1:5173/splash.html');
  else win.loadFile(path.join(__dirname, '../dist/splash.html'));
  return {
    win,
    whenShown,
    update(state) {
      last = state;
      push();
    },
    // Milliseconds the splash must still stay up so it does not flash.
    remaining: (minMs = MIN_SPLASH_MS) => splashRemaining(shownAt, Date.now(), minMs),
    shownAt: () => shownAt,
    isOpen: () => !closed && !win.isDestroyed(),
    focus: () => !win.isDestroyed() && win.focus(),
    // Fades the page out and closes the window.
    async leave() {
      if (!this.isOpen()) return;
      win.webContents.send('splash:leave');
      await new Promise((r) => setTimeout(r, FADE_MS));
      if (!win.isDestroyed()) win.close();
    },
    close() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}

module.exports = { createSplash, FADE_MS };
