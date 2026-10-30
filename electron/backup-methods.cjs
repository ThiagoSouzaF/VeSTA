// Backups from the app: the automatic schedule, the Google Drive copy and the Preferências → Backup operations
// (desktop only, never remote; the chats reach a safe subset through app-mcp.cjs).
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { UserError } = require('./errors.cjs');
const B = require('./backup.cjs');

const CHECK_MS = 30 * 60e3,
  FIRST_CHECK_MS = 3 * 60e3;
const longDate = (t) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });

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
  const driveOn = () => conf().drive && !!ctx.drive?.status().connected;
  // The local .zip is the backup; the Drive copy is extra: its failure is reported apart and never undoes the backup.
  async function toDrive(r) {
    if (!driveOn()) return null;
    try {
      const up = await ctx.drive.upload(r.file, { computer: os.hostname() });
      await ctx.drive.prune(conf().keep).catch(() => {});
      record({ driveAt: Date.now(), driveFile: up.name, driveError: '' });
      return up;
    } catch (e) {
      record({ driveError: e.message || String(e), driveErrorAt: Date.now() });
      return null;
    }
  }
  // One backup at a time; a second request while one runs gets the same result.
  // reason: 'manual' | 'auto' | 'chat' | 'safety' (a local copy before a restore: not recorded, not uploaded).
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
      .then(async (r) => {
        if (reason === 'safety') return r;
        record({
          lastAt: Date.now(),
          lastFile: r.file,
          lastSize: r.size,
          lastWarning: r.memoryError || '',
          lastError: '',
        });
        return { ...r, drive: await toDrive(r) };
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
  // Restores a local .zip: confirmation on the desktop, a safety copy of the current data, then a restart into it.
  async function restoreFile(file, { origin = '' } = {}) {
    const manifest = B.inspectBackup(file);
    const answer = await ctx.dialog.showMessageBox(ctx.win, {
      type: 'warning',
      buttons: ['Restaurar e reiniciar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Restaurar backup',
      message: 'Voltar o VeSTA para ' + longDate(manifest.createdAt) + '?',
      detail:
        (origin ? origin + '\n\n' : '') +
        manifest.counts.chats +
        ' conversas e ' +
        manifest.counts.wikiPages +
        ' páginas de memória. As conversas e memórias atuais serão substituídas; antes disso, uma cópia delas é salva em ' +
        folder() +
        '. Respostas em andamento serão interrompidas e o VeSTA reinicia.',
    });
    if (answer.response !== 0) return false;
    for (const id of [...ctx.jobs.keys()]) ctx.stopChat(id);
    await run('safety');
    B.stageRestore(file, ctx.app.getPath('userData'));
    ctx.app.relaunch();
    ctx.app.quit();
    return true;
  }
  return {
    folder,
    run,
    restoreFile,
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
      ...(({ folder: f, auto, keep, drive, ...rest }) => rest)(ctx.store.state.backup || {}),
      ...conf(),
      running: !!running,
      folder: folder(),
      custom: !!conf().folder,
      defaultFolder,
      googleDrive: B.googleDriveFolders(),
      backups: B.list(folder()).slice(0, 5),
      cloud: ctx.drive?.status() || null,
    }),
  };
}

function backupMethods(ctx) {
  const b = () => ctx.backups;
  const drive = () => {
    if (!ctx.drive) throw new UserError('Google Drive indisponível');
    return ctx.drive;
  };
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
      if (typeof input.drive === 'boolean') s.drive = input.drive;
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
      fs.mkdirSync(dir, { recursive: true });
      const error = await ctx.shell.openPath(dir);
      if (error) throw new UserError(error);
      return true;
    },
    backupRestore: async () => {
      const r = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'Restaurar o VeSTA de um backup',
        defaultPath: b().folder(),
        filters: [{ name: 'Backup do VeSTA', extensions: ['zip'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return false;
      return b().restoreFile(r.filePaths[0]);
    },
    // ---- Google Drive ------------------------------------------------------------------------------------------------
    // The OAuth client: pasted ({clientId, clientSecret}) or, without arguments, the JSON picked in a file dialog.
    driveSetClient: async (input) => {
      if (input?.clientId) {
        drive().setClient(input);
        return b().status();
      }
      const r = await ctx.dialog.showOpenDialog(ctx.win, {
        title: 'JSON do cliente OAuth do Google',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return b().status();
      const stat = fs.statSync(r.filePaths[0]);
      if (stat.size > 64 * 1024) throw new UserError('Este arquivo não é o JSON do cliente OAuth do Google');
      drive().setClient(fs.readFileSync(r.filePaths[0], 'utf8'));
      return b().status();
    },
    driveConnect: async () => {
      await drive().connect();
      ctx.sync();
      return b().status();
    },
    driveDisconnect: async () => {
      await drive().disconnect();
      return b().status();
    },
    driveBackups: () => drive().list(),
    // Downloads a backup from the Drive (this or another computer's) and restores it like a local one.
    driveRestore: async ({ id }) => {
      const list = await drive().list();
      const item = list.find((f) => f.id === id);
      if (!item) throw new UserError('Backup não encontrado no Google Drive');
      const dest = path.join(ctx.app.getPath('userData'), 'downloads', item.name.replace(/[^\w.-]/g, '_'));
      await drive().download(item.id, dest);
      try {
        return await b().restoreFile(dest, {
          origin: 'Do Google Drive' + (item.computer ? ', feito no computador ' + item.computer : '') + '.',
        });
      } finally {
        fs.rmSync(dest, { force: true });
      }
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
