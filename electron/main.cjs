const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net, nativeImage } = require('electron');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs'),
  path = require('node:path');
const { Store } = require('./store.cjs');
const updater = require('./updater.cjs');
const { Permissions } = require('./permissions.cjs');
const { createBus } = require('./events.cjs');
const { createContext } = require('./context.cjs');
const { createMethods } = require('./methods.cjs');
const { createQuestEngine } = require('./quest-engine.cjs');
const { createMemorySessions } = require('./memory-sessions.cjs');
const { createRemote, remoteMethods } = require('./remote/index.cjs');
const { createConfirmer } = require('./remote/confirm.cjs');
const { createBoot, mayReveal, STAGES, BOOT_TIMEOUT_MS } = require('./boot.cjs');
const { createSplash } = require('./splash.cjs');
const { discover } = require('./integrations.cjs');
const { createAttachmentStore } = require('./attachment-store.cjs');
const { IMAGE_EXT } = require('./attachments.cjs');
const bg = require('./background-mode.cjs');
const { createQuestMcp } = require('./quest-mcp.cjs');
const follow = require('./follow.cjs');
const tasksLib = require('./tasks.cjs');
const { applyPendingRestore, PENDING: PENDING_RESTORE } = require('./backup.cjs');
const { createBackups, defaultBackupFolder } = require('./backup-methods.cjs');
const memoryLib = require('./memory.cjs');
const { Memory, redact } = memoryLib;
// Before a restore: an AI Memory server of the previous run still holding the memory dir is ended (by its pid only).
async function stopStaleMemory(dataDir) {
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(path.join(dataDir, 'memory', 'vesta-server.pid'), 'utf8').trim()) || 0;
  } catch {}
  if (pid > 0 && memoryLib.alive(pid) && /ai-memory/i.test(memoryLib.imageOf(pid))) await memoryLib.killPid(pid);
}
app.setName('VeSTA');
app.commandLine.appendSwitch('force-renderer-accessibility');
bg.configureBackgroundMode();
if (process.env.VESTA_DATA_DIR) app.setPath('userData', process.env.VESTA_DATA_DIR);
// Attachments are shown through this scheme only: it resolves inside <userData>/attachments and nowhere else.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vesta-attachment', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
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
    if (
      record.status === 'pending' &&
      ctx.win &&
      !ctx.win.isDestroyed() &&
      !ctx.win.isFocused() &&
      !bg.backgroundMode()
    )
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Test-only: lengthens every boot stage so the splash can be observed (screenshots, e2e). Progress stays real.
const STEP_DELAY_MS = Number(process.env.VESTA_BOOT_STEP_DELAY_MS) || 0;
const createMainWindow = () =>
  new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 1020,
    minHeight: 700,
    frame: false,
    icon: path.join(__dirname, '../assets/vesta.png'),
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    ...bg.backgroundWindowOptions(),
    webPreferences: {
      ...bg.backgroundWebPreferences(),
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
// Opening sequence: store, memory, integrations and the renderer, reported to the splash as each one finishes.
app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  // The text zoom (Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+wheel) belongs to the app: the default menu's native zoom accelerators would add to it.
  Menu.setApplicationMenu(null);
  protocol.handle('vesta-attachment', async (request) => {
    const file = ctx.attachments?.resolve(request.url);
    const mime =
      file && (path.extname(file) === '.png' ? 'image/png' : IMAGE_EXT[path.extname(file).slice(1).toLowerCase()]);
    // Only images are served (documents open in the default program); anything else is a 404.
    if (!mime || !fs.existsSync(file)) return new Response('', { status: 404 });
    const r = await net.fetch(pathToFileURL(file).href);
    return new Response(r.body, {
      headers: { 'content-type': mime, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600' },
    });
  });
  const useSplash = process.env.VESTA_SERVICE_TEST !== '1';
  // The main window is created first (hidden): automation that asks for the first window gets this one, not the splash.
  const win = (ctx.win = createMainWindow());
  let mainReady = false,
    revealed = false,
    watchdog = null,
    splash = null;
  const boot = createBoot({
    onChange: (state) => {
      splash?.update(state);
      maybeReveal();
    },
  });
  // Shows the main window (fading it in) and hands over from the splash.
  async function reveal() {
    if (revealed) return;
    revealed = true;
    clearTimeout(watchdog);
    win.setOpacity(0);
    bg.reveal(win);
    for (let i = 1; i <= 8; i++) {
      win.setOpacity(i / 8);
      await sleep(25);
    }
    await splash?.leave();
    if (process.env.VESTA_NO_UPDATE !== '1') setTimeout(() => checkForUpdate().catch(() => {}), 4000);
  }
  // Everything finished, the window painted, and the splash was up long enough.
  function maybeReveal() {
    if (revealed || !splash?.isOpen()) return;
    const gate = { complete: boot.allDone(), mainReady, shownAt: splash.shownAt() };
    if (mayReveal({ ...gate, now: Date.now() })) reveal();
    else if (gate.complete && gate.mainReady) setTimeout(maybeReveal, Math.max(30, splash.remaining()));
  }
  bus.subscribe((event) => {
    if (!win.isDestroyed()) win.webContents.send('vesta:event', event);
  });
  win.on('focus', () => win.flashFrame(false));
  // Closing the window while chats are followed asks first (they stop being followed; the processes keep running).
  win.on('close', (e) => {
    if (quitting || process.env.VESTA_SERVICE_TEST === '1' || !ctx.follows.size) return;
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
  win.once('ready-to-show', () => {
    mainReady = true;
    if (process.env.VESTA_SERVICE_TEST === '1') return;
    if (splash) return maybeReveal();
    bg.reveal(win);
    if (process.env.VESTA_NO_UPDATE !== '1') setTimeout(() => checkForUpdate().catch(() => {}), 4000);
  });
  win.webContents.on('did-fail-load', (e, code, description, url, isMainFrame) => {
    if (isMainFrame) boot.fail('Não foi possível carregar a interface: ' + description + '.');
  });
  win.webContents.on('render-process-gone', (e, details) =>
    boot.fail('A interface foi encerrada inesperadamente (' + details.reason + ').')
  );
  // The renderer reports once its first state is loaded and painted (or that it could not start).
  ipcMain.on('vesta:ready', (event, payload) => {
    if (event.sender !== win.webContents || revealed) return;
    if (payload?.error)
      boot.fail('A interface não conseguiu iniciar: ' + String(payload.error).slice(0, 400), { canContinue: true });
    else boot.complete('ui');
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
    await ctx.ready;
    return methods[method](args || {});
  });
  app.on('second-instance', () => {
    if (!revealed && splash?.isOpen()) return splash.focus();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  if (useSplash) {
    splash = createSplash({ onQuit: () => app.quit(), onProceed: () => reveal() });
    splash.update(boot.snapshot());
    watchdog = setTimeout(() => {
      const pending = STAGES.filter((s) => !boot.isDone(s.id)).map((s) => s.label.toLowerCase());
      boot.fail('O VeSTA está demorando mais que o esperado para abrir (' + pending.join(', ') + ').', {
        canContinue: true,
      });
    }, BOOT_TIMEOUT_MS);
  }
  // The splash is painted first, then everything else starts: the interface loads in parallel with the store (its
  // first calls wait for `ctx.ready`), and memory and integrations are probed while the splash is up.
  (async () => {
    if (splash) await splash.whenShown;
    if (process.env.VESTA_DEV === '1') win.loadURL('http://127.0.0.1:5173');
    else win.loadFile(path.join(__dirname, '../dist/index.html'));
    try {
      const dataDir = app.getPath('userData'),
        memoryExe = app.isPackaged
          ? path.join(process.resourcesPath, 'ai-memory.exe')
          : path.join(__dirname, '../runtime/ai-memory.exe');
      // A backup chosen in Preferências is put in place now, before anything opens the data or the memory.
      // Checked synchronously: with nothing pending the store still opens in this same tick, as before.
      const restored = fs.existsSync(path.join(dataDir, PENDING_RESTORE))
        ? await applyPendingRestore(dataDir, { exe: memoryExe, stopMemory: () => stopStaleMemory(dataDir) })
        : null;
      const store = (ctx.store = new Store(dataDir));
      if (restored) store.state.backup = { ...store.state.backup, lastRestore: restored };
      // Mark interrupted responses after a crash, without discarding the partial transcript.
      for (const chat of store.state.chats)
        for (const m of chat.messages)
          if (m.status === 'running') {
            m.status = 'cancelled';
            m.error = 'A sessão foi interrompida ao fechar o aplicativo.';
          }
      // Nobody follows the background commands of the previous run anymore.
      for (const chat of store.state.chats) tasksLib.detachRunning(chat);
      // Quests: the engine reacts to finished turns; anything left "running" by a previous run is closed first.
      ctx.quests = createQuestEngine(ctx);
      ctx.questMcp = createQuestMcp(ctx, { engine: () => ctx.quests });
      ctx.quests.recover();
      bus.subscribe((event) => event.type === 'chat-done' && ctx.quests.onChatDone(event));
      store.save();
      // Chat attachments: copies kept under userData; leftovers of unsent drafts and deleted chats are cleaned at start.
      ctx.nativeImage = nativeImage;
      ctx.attachments = createAttachmentStore({ root: path.join(app.getPath('userData'), 'attachments'), nativeImage });
      ctx.attachments.sweep();
      ctx.attachments.prune(store.state.chats.map((c) => c.id));
      // Remote control (phone): off unless the user turned it on in Preferências.
      // Native dialogs approve new devices and full access (the test-only auto answer is ignored when packaged).
      const confirmer = createConfirmer({ dialog, getWindow: () => ctx.win, isPackaged: app.isPackaged });
      ctx.remote = createRemote({ ctx, methods, bus, deps: { confirm: (request) => confirmer.confirm(request) } });
      if (store.state.remote.enabled) ctx.remote.start().catch(() => {});
      ctx.memory = new Memory(memoryExe, path.join(dataDir, 'memory'), {
        // Consolidation reuses the Codex CLI login; the answer excerpt only reaches the store with capture on.
        // The hourly auto-improve reviewer stays off: one consolidation per conversation stretch, nothing more.
        // Always the same environment, so toggling the preference never restarts the server under running agents:
        // the app alone decides whether to call memory_consolidate.
        env: () => ({
          AI_MEMORY_LLM_PROVIDER: 'codex',
          AI_MEMORY_CAPTURE_ASSISTANT: 'true',
          AI_MEMORY_AUTO_IMPROVE__SCHEDULER__ENABLED: 'false',
          // The profile (how the user works) learns from a single project too: VeSTA is one personal assistant.
          AI_MEMORY_PROFILE__MIN_PROJECTS: '1',
        }),
      });
      // VESTA_MEMORY_IDLE_MS only shortens the 30 min idle close for the E2E tests.
      ctx.memorySessions = createMemorySessions(ctx, { idleMs: Number(process.env.VESTA_MEMORY_IDLE_MS) || undefined });
      // Stretches left open by the previous run are closed and consolidated in the background.
      if (store.state.settings.memoryEnabled) ctx.memorySessions.recover();
      // Automatic backups (Preferências → Backup); the E2E data dirs only back up when asked.
      ctx.backups = createBackups(ctx, { defaultFolder: defaultBackupFolder(app) });
      if (!process.env.VESTA_DATA_DIR) ctx.backups.schedule();
      ctx.markReady();
    } catch (e) {
      if (!useSplash) throw e;
      return boot.fail(redact(e.message || String(e)));
    }
    if (STEP_DELAY_MS) await sleep(STEP_DELAY_MS);
    boot.complete('data');
    if (useSplash) {
      // Warm-ups the splash waits for; the renderer's own calls reuse their results. Failures are not fatal here:
      // the app opens and the Memória / Conexões screens explain what is wrong.
      const stage = async (id, work, testDelay) => {
        try {
          await work();
        } catch {}
        if (STEP_DELAY_MS) await sleep(STEP_DELAY_MS * testDelay);
        boot.complete(id);
      };
      ctx.bootDiscovery = discover(ctx);
      stage('memory', () => methods.memoryStatus(), 2);
      stage('ias', () => ctx.bootDiscovery, 3);
    }
    if (process.env.VESTA_VERIFY_PACKAGED === '1' && process.env.VESTA_SERVICE_TEST === '1') {
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
    }
  })();
});
app.on('window-all-closed', () => app.quit());
let remoteDown = false,
  quitting = false;
app.on('before-quit', (event) => {
  quitting = true;
  // Following ends with the app; the processes the user's AIs started keep running.
  for (const s of ctx.follows.values()) ctx.endFollowing(s.chatId, 'quit');
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
  ctx.memorySessions?.dispose();
  ctx.backups?.dispose();
  ctx.questMcp?.close().catch(() => {});
  ctx.memory?.close().catch(() => {});
});
module.exports = { methods, ctx, getState: () => ctx.state() };
