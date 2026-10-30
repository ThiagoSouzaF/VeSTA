// VeSTA's main process: the opening sequence (splash, window, services), the IPC entry point and the way out.
// Each piece lives in its own module: app/window.cjs, app/services.cjs, app/update-flow.cjs, app/privacy.cjs.
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  protocol,
  net,
  nativeImage,
  safeStorage,
  session,
} = require('electron');
const fs = require('node:fs'),
  path = require('node:path');
const privacy = require('./app/privacy.cjs');
const bg = require('./app/background-mode.cjs');
const { createBus } = require('./app/events.cjs');
const { createContext } = require('./app/context.cjs');
const { createMethods } = require('./app/methods.cjs');
const { createPermissionBridge } = require('./app/permission-bridge.cjs');
const { createUpdateFlow } = require('./app/update-flow.cjs');
const { createMainWindow, guardWindow, loadApp, wireWindow } = require('./app/window.cjs');
const { openServices, closeServices } = require('./app/services.cjs');
const { createBoot, mayReveal, STAGES, BOOT_TIMEOUT_MS } = require('./app/boot.cjs');
const { createSplash } = require('./app/splash.cjs');
const { remoteMethods } = require('./remote/index.cjs');
const { discover } = require('./ai/integrations.cjs');
const attachmentScheme = require('./attachments/protocol.cjs');
const { redact } = require('./memory/redact.cjs');

app.setName('VeSTA');
app.commandLine.appendSwitch('force-renderer-accessibility');
bg.configureBackgroundMode();
privacy.hardenChromium(app);
if (process.env.VESTA_DATA_DIR) app.setPath('userData', process.env.VESTA_DATA_DIR);
attachmentScheme.registerScheme(protocol);

const bus = createBus();
const ctx = createContext({ app, dialog, shell, bus });
ctx.permissions = createPermissionBridge(ctx);
const methods = { ...createMethods(ctx), ...remoteMethods(ctx) };
const updates = createUpdateFlow(ctx, { app, dialog });
ctx.checkForUpdate = updates.check;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Test-only: lengthens every boot stage so the splash can be observed (screenshots, e2e). Progress stays real.
const STEP_DELAY_MS = Number(process.env.VESTA_BOOT_STEP_DELAY_MS) || 0;
let quitting = false;

// Opening sequence: store, memory, integrations and the renderer, reported to the splash as each one finishes.
app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  // The text zoom (Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+wheel) belongs to the app: the default menu's native zoom accelerators would add to it.
  Menu.setApplicationMenu(null);
  privacy.hardenSession(session.defaultSession);
  setTimeout(() => privacy.sweepTemp(), 10000).unref?.();
  attachmentScheme.handleScheme(protocol, net, (url) => ctx.attachments?.resolve(url));
  const useSplash = process.env.VESTA_SERVICE_TEST !== '1';
  // The main window is created first (hidden): automation that asks for the first window gets this one, not the splash.
  const win = (ctx.win = createMainWindow(BrowserWindow, __dirname));
  guardWindow(win);
  wireWindow(win, { ctx, app, dialog, isQuitting: () => quitting });
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
    updates.schedule();
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
  win.once('ready-to-show', () => {
    mainReady = true;
    if (process.env.VESTA_SERVICE_TEST === '1') return;
    if (splash) return maybeReveal();
    bg.reveal(win);
    updates.schedule();
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
  // The only door from the renderer: named methods of `methods`, from this window only.
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
    loadApp(win, __dirname);
    try {
      await openServices(ctx, { electron: { app, dialog, shell, safeStorage, nativeImage }, bus, methods });
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
    if (process.env.VESTA_VERIFY_PACKAGED === '1' && process.env.VESTA_SERVICE_TEST === '1') await verifyPackaged();
  })();
});
// Release check (VESTA_VERIFY_PACKAGED): the installed build opens its services and reports, then quits.
async function verifyPackaged() {
  const out = path.join(app.getPath('userData'), 'verification.json');
  try {
    const opened = await methods.bootstrap(),
      status = await methods.memoryStatus();
    const providers = Object.fromEntries(Object.entries(opened.integrations).map(([id, p]) => [id, p.installed]));
    fs.writeFileSync(out, JSON.stringify({ packaged: app.isPackaged, memory: status.connected, providers }, null, 2));
  } catch (e) {
    fs.writeFileSync(out, JSON.stringify({ error: e.message }));
  } finally {
    app.quit();
  }
}
app.on('window-all-closed', () => app.quit());
let remoteDown = false;
app.on('before-quit', (event) => {
  quitting = true;
  // Following ends with the app; the processes the user's AIs started keep running.
  for (const s of ctx.follows.values()) ctx.endFollowing(s.chatId, 'quit');
  for (const task of ctx.jobs.values()) {
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
  closeServices(ctx);
});
module.exports = { methods, ctx, getState: () => ctx.state() };
