// The main window: how it is created (hidden, sandboxed renderer, no spell-check) and what it may do. It only ever
// shows the app itself (links open in the browser), and closing it while chats are followed asks first.
const path = require('node:path');
const bg = require('./background-mode.cjs');
const follow = require('../chat/follow.cjs');

const DEV_SERVER = 'http://127.0.0.1:5173/';
const devMode = () => process.env.VESTA_DEV === '1';

function createMainWindow(BrowserWindow, electronDir) {
  return new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 1020,
    minHeight: 700,
    frame: false,
    icon: path.join(electronDir, '../assets/vesta.png'),
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    ...bg.backgroundWindowOptions(),
    webPreferences: {
      ...bg.backgroundWebPreferences(),
      preload: path.join(electronDir, 'preload.cjs'),
      spellcheck: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}

// No new windows, no navigation away from the app, no <webview>, no pinch zoom; DevTools only in development.
function guardWindow(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const stay = (e, url) => {
    if (!devMode() || !url.startsWith(DEV_SERVER)) e.preventDefault();
  };
  wc.on('will-navigate', stay);
  wc.on('will-redirect', stay);
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setVisualZoomLevelLimits(1, 1);
  if (devMode())
    wc.on('before-input-event', (e, i) => {
      if (i.type === 'keyDown' && (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i')))
        wc.toggleDevTools();
    });
}

function loadApp(win, electronDir) {
  if (devMode()) win.loadURL(DEV_SERVER);
  else win.loadFile(path.join(electronDir, '../dist/index.html'));
}

// Window behaviour tied to the app: attention, closing while following, mouse back/forward buttons.
function wireWindow(win, { ctx, app, dialog, isQuitting }) {
  win.on('focus', () => win.flashFrame(false));
  // Closing the window while chats are followed asks first (they stop being followed; the processes keep running).
  win.on('close', (e) => {
    if (isQuitting() || process.env.VESTA_SERVICE_TEST === '1' || !ctx.follows.size) return;
    e.preventDefault();
    dialog
      .showMessageBox(win, {
        type: 'warning',
        title: 'Acompanhando processos',
        message: 'Fechar o VeSTA?',
        detail: follow.closeWarning(ctx.follows.size),
        buttons: ['Fechar mesmo assim', 'Continuar aberto'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => response === 0 && app.quit())
      .catch(() => {});
  });
  // The mouse's back / forward buttons (and the keyboard's browser keys) reach Windows apps as app commands.
  win.on('app-command', (e, command) => {
    if (command !== 'browser-backward' && command !== 'browser-forward') return;
    e.preventDefault();
    if (!win.isDestroyed())
      win.webContents.send('vesta:event', { type: 'nav', dir: command === 'browser-backward' ? -1 : 1 });
  });
}

module.exports = { createMainWindow, guardWindow, loadApp, wireWindow };
