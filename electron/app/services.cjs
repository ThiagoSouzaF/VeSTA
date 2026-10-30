// Everything the app runs on, opened in order while the splash is up and stored on `ctx`: a pending restore first,
// then the data (store), quests and their tools, attachments, the phone remote, the AI Memory, backups and Drive.
const fs = require('node:fs'),
  path = require('node:path');
const { Store } = require('./store.cjs');
const { createSecrets } = require('./secrets.cjs');
const tasksLib = require('../shared/tasks.cjs');
const { createQuestEngine } = require('../quests/engine.cjs');
const { createQuestMcp } = require('../quests/mcp.cjs');
const { createAppMcp } = require('../mcp/app.cjs');
const { createAttachmentStore } = require('../attachments/store.cjs');
const { createRemote } = require('../remote/index.cjs');
const { createConfirmer } = require('../remote/confirm.cjs');
const { Memory } = require('../memory/client.cjs');
const { stopStale } = require('../memory/server-lock.cjs');
const { createMemorySessions } = require('../memory/sessions.cjs');
const { applyPendingRestore, PENDING } = require('../backup/archive.cjs');
const { createBackups, defaultBackupFolder } = require('../backup/methods.cjs');
const { createDrive } = require('../backup/gdrive.cjs');

// The AI Memory server: the binary shipped with the app (or the dev copy in runtime/).
const memoryExe = (app) =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'ai-memory.exe')
    : path.join(__dirname, '../../runtime/ai-memory.exe');

// electron: { app, dialog, shell, safeStorage, nativeImage }; methods: the full method table (remote and vesta-app).
async function openServices(ctx, { electron, bus, methods }) {
  const { app, dialog, shell, safeStorage, nativeImage } = electron;
  const dataDir = app.getPath('userData'),
    exe = memoryExe(app);
  // A backup chosen in Preferências is put in place now, before anything opens the data or the memory.
  // Checked synchronously: with nothing pending the store still opens in this same tick.
  const restored = fs.existsSync(path.join(dataDir, PENDING))
    ? await applyPendingRestore(dataDir, { exe, stopMemory: () => stopStale(dataDir) })
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
  ctx.appMcp = createAppMcp(ctx, { methods: () => methods });
  ctx.quests.recover();
  bus.subscribe((event) => event.type === 'chat-done' && ctx.quests.onChatDone(event));
  store.save();
  // Chat attachments: copies kept under userData; leftovers of unsent drafts and deleted chats are cleaned at start.
  ctx.nativeImage = nativeImage;
  ctx.attachments = createAttachmentStore({ root: path.join(dataDir, 'attachments'), nativeImage });
  ctx.attachments.sweep();
  ctx.attachments.prune(store.state.chats.map((c) => c.id));
  // Remote control (phone): off unless the user turned it on in Preferências.
  // Native dialogs approve new devices and full access (the test-only auto answer is ignored when packaged).
  const confirmer = createConfirmer({ dialog, getWindow: () => ctx.win, isPackaged: app.isPackaged });
  ctx.remote = createRemote({ ctx, methods, bus, deps: { confirm: (request) => confirmer.confirm(request) } });
  if (store.state.remote.enabled) ctx.remote.start().catch(() => {});
  ctx.memory = new Memory(exe, path.join(dataDir, 'memory'), {
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
  // Keys kept on this computer (backup password, Google Drive) are sealed by the OS keychain, never plain text.
  ctx.secrets = createSecrets(safeStorage);
  ctx.backups = createBackups(ctx, { defaultFolder: defaultBackupFolder(app), secrets: ctx.secrets });
  ctx.drive = createDrive({
    file: path.join(dataDir, 'google-drive.json'),
    seal: ctx.secrets.seal,
    unseal: ctx.secrets.unseal,
    openExternal: (url) => shell.openExternal(url),
  });
  // Automatic backups (Preferências → Backup); the E2E data dirs only back up when asked.
  if (!process.env.VESTA_DATA_DIR) ctx.backups.schedule();
}

// Everything that holds a process, a port or a timer, in the order it must stop (synchronous first: before-quit does
// not wait for promises).
function closeServices(ctx) {
  ctx.memorySessions?.dispose();
  ctx.backups?.dispose();
  ctx.questMcp?.close().catch(() => {});
  ctx.appMcp?.close().catch(() => {});
  ctx.memory?.close().catch(() => {});
}

module.exports = { openServices, closeServices, memoryExe };
