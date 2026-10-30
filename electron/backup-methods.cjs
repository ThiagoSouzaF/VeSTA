// Backups from the app: the automatic schedule and the Preferências → Backup operations (desktop only, never remote).
const path = require('node:path');
const { UserError } = require('./errors.cjs');
const B = require('./backup.cjs');

const CHECK_MS = 30 * 60e3,
  FIRST_CHECK_MS = 3 * 60e3;

function createBackups(ctx, { defaultFolder }) {
  let running = null,
    timers = [];
  const conf = () => B.settings(ctx.store.state);
  const folder = () => conf().folder || defaultFolder;
  const record = (patch) => {
    ctx.store.state.backup = { ...ctx.store.state.backup, ...patch };
    ctx.store.save();
    ctx.sync();
  };
  const memory = () => (ctx.store.state.settings.memoryEnabled === false ? null : ctx.memory);
  // One backup at a time; a second request while one runs gets the same result.
  const run = (reason = 'manual', target = folder()) => {
    if (running) return running;
    running = B.createBackup({
      state: ctx.store.state,
      dataDir: ctx.app.getPath('userData'),
      memory: memory(),
      folder: target,
      keep: conf().keep,
      appVersion: ctx.app.getVersion(),
    })
      .then((r) => {
        // `last*` describe the destination the user configured; a safety copy before a restore does not count.
        if (reason !== 'safety')
          record({
            lastAt: Date.now(),
            lastFile: r.file,
            lastSize: r.size,
            lastWarning: r.memoryError || '',
            lastError: '',
          });
        return r;
      })
      .catch((e) => {
        if (reason !== 'safety') record({ lastError: e.message || String(e), lastErrorAt: Date.now() });
        throw e;
      })
      .finally(() => (running = null));
    return running;
  };
  const check = () => {
    const b = ctx.store.state.backup || {};
    if (!running && B.due(conf().auto, b.lastAt)) run('auto').catch(() => {});
  };
  return {
    folder,
    run,
    // Automatic backups: shortly after the opening (never during it) and every half hour while open.
    schedule() {
      timers.push(setTimeout(check, FIRST_CHECK_MS), setInterval(check, CHECK_MS));
      for (const t of timers) t.unref?.();
    },
    dispose() {
      for (const t of timers) clearTimeout(t), clearInterval(t);
      timers = [];
    },
    status: () => ({
      ...conf(),
      ...(({ folder: f, auto, keep, ...rest }) => rest)(ctx.store.state.backup || {}),
      running: !!running,
      folder: folder(),
      custom: !!conf().folder,
      defaultFolder,
      googleDrive: B.googleDriveFolders(),
      backups: B.list(folder()).slice(0, 5),
    }),
  };
}

function backupMethods(ctx) {
  const b = () => ctx.backups;
  return {
    backupStatus: () => b().status(),
    backupNow: async () => {
      await b().run('manual');
      return b().status();
    },
    backupSettings: (input) => {
      const s = (ctx.store.state.backup ||= {});
      if (input.auto in B.INTERVALS) s.auto = input.auto;
      if (B.KEEP.includes(input.keep)) s.keep = input.keep;
      ctx.store.save();
      ctx.sync();
      return b().status();
    },
    // target: 'default' | a folder from status().googleDrive | undefined (asks with the native folder picker).
    backupChooseFolder: async ({ target } = {}) => {
      const s = (ctx.store.state.backup ||= {});
      if (target === 'default') s.folder = '';
      else if (target) {
        if (!B.googleDriveFolders().includes(target)) throw new UserError('Pasta não reconhecida');
        s.folder = target;
      } else {
        const r = await ctx.dialog.showOpenDialog(ctx.win, {
          title: 'Onde guardar os backups do VeSTA',
          defaultPath: b().folder(),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (r.canceled || !r.filePaths[0]) return b().status();
        s.folder = r.filePaths[0];
      }
      ctx.store.save();
      ctx.sync();
      return b().status();
    },
    backupOpenFolder: async () => {
      const dir = b().folder();
      require('node:fs').mkdirSync(dir, { recursive: true });
      const error = await ctx.shell.openPath(dir);
      if (error) throw new UserError(error);
      return true;
    },
    // Picks a backup, confirms, saves a safety copy of the current data and restarts into the restored one.
    backupRestore: async () => {
      const r = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Restaurar o VeSTA de um backup',
        defaultPath: b().folder(),
        filters: [{ name: 'Backup do VeSTA', extensions: ['zip'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return false;
      const file = r.filePaths[0];
      const manifest = B.inspectBackup(file);
      const date = new Date(manifest.createdAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
      const answer = await ctx.dialog.showMessageBox(ctx.win, {
        type: 'warning',
        buttons: ['Restaurar e reiniciar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        title: 'Restaurar backup',
        message: 'Voltar o VeSTA para ' + date + '?',
        detail:
          manifest.counts.chats +
          ' conversas e ' +
          manifest.counts.wikiPages +
          ' páginas de memória. As conversas e memórias atuais serão substituídas; antes disso, uma cópia delas é salva em ' +
          b().folder() +
          '. Respostas em andamento serão interrompidas e o VeSTA reinicia.',
      });
      if (answer.response !== 0) return false;
      if (ctx.jobs.size) for (const id of [...ctx.jobs.keys()]) ctx.stopChat(id);
      await b().run('safety');
      B.stageRestore(file, ctx.app.getPath('userData'));
      ctx.app.relaunch();
      ctx.app.quit();
      return true;
    },
  };
}

// Default destination: Documentos\VeSTA-backups (a test data dir keeps its backups inside itself).
function defaultBackupFolder(app) {
  return process.env.VESTA_DATA_DIR
    ? path.join(app.getPath('userData'), 'backups')
    : path.join(app.getPath('documents'), 'VeSTA-backups');
}

module.exports = { createBackups, backupMethods, defaultBackupFolder };
