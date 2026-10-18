const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('node:fs'),
  path = require('node:path');
const { Store } = require('./store.cjs');
const { Memory, redact } = require('./memory.cjs');
const updater = require('./updater.cjs');
const { Permissions } = require('./permissions.cjs');
const { createBus } = require('./events.cjs');
const { createContext } = require('./context.cjs');
const { createMethods } = require('./methods.cjs');
const { createQuestEngine } = require('./quest-engine.cjs');
const { createRemote, remoteMethods } = require('./remote/index.cjs');
const { createConfirmer } = require('./remote/confirm.cjs');
app.setName('VeSTA');
app.commandLine.appendSwitch('force-renderer-accessibility');
if (process.env.VESTA_DATA_DIR) app.setPath('userData', process.env.VESTA_DATA_DIR);
const bus = createBus();
const ctx = createContext({ app, dialog, shell, bus });
const { jobs, emit } = ctx;
ctx.permissions = new Permissions({
  rules: (chatId) => {
    const c = ctx.store.state.chats.find((x) => x.id === chatId);
    if (!c) return null;
    c.permissionRules = c.permissionRules || [];
    return c.permissionRules;
  },
  onUpdate: (chatId, record) => {
    const msg = jobs.get(chatId)?.assistant;
    if (msg) {
      msg.permissions = msg.permissions || [];
      const i = msg.permissions.findIndex((x) => x.id === record.id);
      if (i >= 0) msg.permissions[i] = { ...record };
      else msg.permissions.push({ ...record });
      msg.permissions = msg.permissions.slice(-60);
    }
    emit({ type: 'permission', chatId, messageId: msg?.id, permission: { ...record } });
    // Someone has to answer: draw attention when the window is in the background.
    if (record.status === 'pending' && ctx.win && !ctx.win.isDestroyed() && !ctx.win.isFocused())
      ctx.win.flashFrame(true);
    if (record.status === 'always') ctx.store.save();
  },
});
const methods = { ...createMethods(ctx), ...remoteMethods(ctx) };
// Asks before updating; on yes downloads the verified installer, quits, and the installer reopens the app.
let updating = false;
async function checkForUpdate({ interactive = false } = {}) {
  const kind = updater.installKind(app);
  if (kind !== 'installed')
    return {
      status: 'unsupported',
      message:
        kind === 'portable'
          ? 'A versão portátil não se atualiza sozinha. Use o instalador.'
          : 'Atualização automática só funciona na versão instalada.',
    };
  if (updating) return { status: 'updating', message: 'A atualização já está em andamento.' };
  const info = await updater.check(app.getVersion());
  if (!info.available)
    return {
      status: info.reason ? 'error' : 'current',
      message: info.reason || 'Você já está na versão mais recente (' + app.getVersion() + ').',
    };
  const busy = jobs.size ? '\n\nHá respostas em andamento; elas serão interrompidas.' : '';
  const { response } = await dialog.showMessageBox(ctx.win, {
    type: 'info',
    title: 'Atualização disponível',
    message: 'VeSTA ' + info.version + ' está disponível',
    detail:
      'Você está na versão ' +
      app.getVersion() +
      '. Ao atualizar, o VeSTA fecha, instala a nova versão e abre de novo. Seus chats e memórias são mantidos.' +
      busy +
      (info.notes ? '\n\nNovidades:\n' + info.notes : ''),
    buttons: ['Atualizar agora', 'Agora não'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { status: 'declined', message: 'Atualização adiada.' };
  updating = true;
  emit({ type: 'update', status: 'downloading', message: 'Baixando o VeSTA ' + info.version + '…' });
  ctx.win?.setProgressBar(2);
  try {
    const file = await updater.download(info);
    updater.launchInstaller(file);
    setTimeout(() => app.quit(), 300);
    return { status: 'installing', message: 'Instalando o VeSTA ' + info.version + '…' };
  } catch (e) {
    updating = false;
    ctx.win?.setProgressBar(-1);
    const message = 'Não foi possível atualizar: ' + redact(e.message).split('\n')[0];
    emit({ type: 'update', status: 'error', message });
    return { status: 'error', message };
  }
}
ctx.checkForUpdate = checkForUpdate;
app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  // The text zoom (Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+wheel) belongs to the app: the default menu's native zoom accelerators would add to it.
  Menu.setApplicationMenu(null);
  const store = (ctx.store = new Store(app.getPath('userData')));
  // Mark interrupted responses after a crash, without discarding the partial transcript.
  for (const chat of store.state.chats)
    for (const m of chat.messages)
      if (m.status === 'running') {
        m.status = 'cancelled';
        m.error = 'A sessão foi interrompida ao fechar o aplicativo.';
      }
  // Quests: the engine reacts to finished turns; anything left "running" by a previous run is closed first.
  ctx.quests = createQuestEngine(ctx);
  ctx.quests.recover();
  bus.subscribe((event) => event.type === 'chat-done' && ctx.quests.onChatDone(event));
  store.save();
  // Remote control (phone): off unless the user turned it on in Preferências.
  // Native dialogs approve new devices and full access (the test-only auto answer is ignored when packaged).
  const confirmer = createConfirmer({ dialog, getWindow: () => ctx.win, isPackaged: app.isPackaged });
  ctx.remote = createRemote({ ctx, methods, bus, deps: { confirm: (request) => confirmer.confirm(request) } });
  if (store.state.remote.enabled) ctx.remote.start().catch(() => {});
  ctx.memory = new Memory(
    app.isPackaged
      ? path.join(process.resourcesPath, 'ai-memory.exe')
      : path.join(__dirname, '../runtime/ai-memory.exe'),
    path.join(app.getPath('userData'), 'memory')
  );
  const win = (ctx.win = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 1020,
    minHeight: 700,
    frame: false,
    icon: path.join(__dirname, '../assets/vesta.png'),
    backgroundColor: '#101014',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }));
  bus.subscribe((event) => {
    if (!win.isDestroyed()) win.webContents.send('vesta:event', event);
  });
  win.on('focus', () => win.flashFrame(false));
  win.once('ready-to-show', () => {
    if (process.env.VESTA_SERVICE_TEST === '1') return;
    win.show();
    if (process.env.VESTA_NO_UPDATE !== '1') setTimeout(() => checkForUpdate().catch(() => {}), 4000);
  });
  win.webContents.setVisualZoomLevelLimits(1, 1);
  if (process.env.VESTA_DEV === '1')
    win.webContents.on('before-input-event', (e, i) => {
      if (i.type === 'keyDown' && (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i')))
        win.webContents.toggleDevTools();
    });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://127.0.0.1:5173')) e.preventDefault();
  });
  ipcMain.handle('vesta:call', async (event, method, args) => {
    if (event.sender !== win.webContents || !Object.hasOwn(methods, method)) throw new Error('Operação não permitida');
    return methods[method](args || {});
  });
  if (process.env.VESTA_DEV === '1') win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  if (process.env.VESTA_VERIFY_PACKAGED === '1' && process.env.VESTA_SERVICE_TEST === '1') {
    (async () => {
      try {
        const boot = await methods.bootstrap(),
          status = await methods.memoryStatus();
        fs.writeFileSync(
          path.join(app.getPath('userData'), 'verification.json'),
          JSON.stringify(
            {
              packaged: app.isPackaged,
              memory: status.connected,
              providers: Object.fromEntries(Object.entries(boot.integrations).map(([id, p]) => [id, p.installed])),
            },
            null,
            2
          )
        );
      } catch (e) {
        fs.writeFileSync(path.join(app.getPath('userData'), 'verification.json'), JSON.stringify({ error: e.message }));
      } finally {
        app.quit();
      }
    })();
  }
});
app.on('window-all-closed', () => app.quit());
let remoteDown = false;
app.on('before-quit', (event) => {
  for (const task of jobs.values()) {
    task.cancelled = true;
    task.run?.stop();
  }
  // Take our `tailscale serve` publication down before leaving: quitting is paused until it is done (bounded).
  if (ctx.remote && !remoteDown) {
    remoteDown = true;
    event.preventDefault();
    ctx.remote
      .shutdown()
      .catch(() => {})
      .finally(() => app.quit());
    return;
  }
  ctx.memory?.close().catch(() => {});
});
module.exports = { methods, ctx, getState: () => ctx.state() };
