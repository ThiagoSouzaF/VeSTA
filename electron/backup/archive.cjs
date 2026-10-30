// Backups of everything VeSTA keeps, as one .zip that is readable anywhere and restores the app:
//   VeSTA-backup-AAAA-MM-DD-HHMM.zip
//     LEIA-ME.md                          what is inside and how to restore
//     conversas/<projeto>/*.md            every conversation, in Markdown
//     preferencias.md                     what the AIs learned about you + your own preferences and notes
//     memoria-ia/<projeto>/**.md          the AI Memory wiki (sessions, decisions, rules...), by project name
//     restaurar/manifesto.json            format, date, counts
//     restaurar/vesta.json                the app data (without the phone pairing, which stays on this computer)
//     restaurar/ai-memory.tar.gz          snapshot taken by the AI Memory server itself (consistent while it runs)
//     restaurar/anexos/**                 chat attachments
// Here: creating, listing and rotating backups. The Markdown views live in readable.cjs, restoring in restore.cjs.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const fflate = require('fflate');
const { UserError } = require('../app/errors.cjs');
const crypto = require('./crypto.cjs');
const { writeAtomic } = require('../util/sys.cjs');
const { slug } = require('../util/text.cjs');
const { chatMarkdown, preferencesMarkdown, wikiFiles, walkFiles, readme } = require('./readable.cjs');
const { FORMAT } = require('./restore.cjs');

const PREFIX = 'VeSTA-backup-';
// .zip, or .vesta when protected by a password (crypto.cjs).
const NAME = /^VeSTA-backup-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.(zip|vesta)$/;
const INTERVALS = { off: 0, daily: 24 * 3600e3, weekly: 7 * 24 * 3600e3 };
const KEEP = [3, 5, 10, 20, 30];
// drive: also send each backup to Google Drive when it is connected (see gdrive.cjs).
const DEFAULTS = { folder: '', auto: 'daily', keep: 10, drive: true };

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) =>
  d.getFullYear() +
  '-' +
  pad(d.getMonth() + 1) +
  '-' +
  pad(d.getDate()) +
  '-' +
  pad(d.getHours()) +
  pad(d.getMinutes());

function settings(state) {
  const b = state.backup || {};
  return {
    folder: typeof b.folder === 'string' ? b.folder : DEFAULTS.folder,
    auto: b.auto in INTERVALS ? b.auto : DEFAULTS.auto,
    keep: KEEP.includes(b.keep) ? b.keep : DEFAULTS.keep,
    drive: typeof b.drive === 'boolean' ? b.drive : DEFAULTS.drive,
  };
}
// Is an automatic backup due? `last` = time of the last successful one.
const due = (auto, last, now = Date.now()) => !!INTERVALS[auto] && (!last || now - last >= INTERVALS[auto]);

// ---- create --------------------------------------------------------------------------------------------------------
const zipAsync = (files) =>
  new Promise((resolve, reject) => fflate.zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data))));

// memory: { profile(), backupTo(file) } or null. Returns { file, size, counts, memoryError }.
async function createBackup({
  state,
  dataDir,
  memory,
  folder,
  keep = DEFAULTS.keep,
  appVersion = '',
  now = new Date(),
  password = '',
}) {
  if (!folder) throw new UserError('Escolha a pasta do backup');
  fs.mkdirSync(folder, { recursive: true });
  const u8 = (s) => fflate.strToU8(s);
  const projectName = (id) =>
    id === 'inbox' ? 'pessoal' : state.projects.find((p) => p.id === id)?.name || 'projeto-removido';
  const files = {};
  // Conversations, by project (quest steps included: they are conversations too).
  const chats = state.chats || [];
  const used = new Set();
  for (const chat of chats) {
    const project = chat.projectId ? projectName(chat.projectId) : 'pessoal';
    const date = new Date(chat.createdAt || 0);
    let name = 'conversas/' + slug(project, 40) + '/' + date.toISOString().slice(0, 10) + '-' + slug(chat.title);
    if (used.has(name)) name += '-' + String(chat.id).slice(0, 6);
    used.add(name);
    files[name + '.md'] = u8(chatMarkdown(chat, project));
  }
  let profile = null,
    memoryError = '';
  const tmp = path.join(os.tmpdir(), 'vesta-memory-' + process.pid + '-' + Date.now() + '.tar.gz');
  if (memory) {
    try {
      profile = await memory.profile();
    } catch {}
    try {
      await memory.backupTo(tmp);
      files['restaurar/ai-memory.tar.gz'] = [fs.readFileSync(tmp), { level: 0 }];
    } catch (e) {
      memoryError = e.message || String(e);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } else memoryError = 'memória desligada';
  files['preferencias.md'] = u8(preferencesMarkdown(state, profile));
  const wiki = wikiFiles(path.join(dataDir, 'memory', 'wiki'), projectName);
  Object.assign(files, wiki);
  // Restorable data. The phone pairing (device hashes) never leaves this computer.
  const { remote, ...store } = state;
  files['restaurar/vesta.json'] = u8(JSON.stringify(store));
  const attachmentsDir = path.join(dataDir, 'attachments');
  const attachments = walkFiles(attachmentsDir, (r) => r === '_staging');
  for (const r of attachments)
    files['restaurar/anexos/' + r] = [
      fs.readFileSync(path.join(attachmentsDir, r)),
      { level: /\.(png|jpe?g|gif|webp|zip|pdf)$/i.test(r) ? 0 : 6 },
    ];
  const manifest = {
    format: FORMAT,
    createdAt: now.getTime(),
    appVersion,
    counts: {
      chats: chats.length,
      wikiPages: Object.keys(wiki).length,
      attachments: attachments.length,
      profile: profile?.length ?? null,
    },
    memory: !!files['restaurar/ai-memory.tar.gz'],
    ...(memoryError ? { memoryError } : {}),
  };
  files['restaurar/manifesto.json'] = u8(JSON.stringify(manifest, null, 2));
  files['LEIA-ME.md'] = u8(readme(manifest));
  const zipped = await zipAsync(files);
  const data = password ? crypto.encrypt(zipped, password) : zipped;
  const ext = password ? '.vesta' : '.zip';
  let file = path.join(folder, PREFIX + stamp(now) + ext);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(folder, PREFIX + stamp(now) + '-' + i + ext);
  // Written beside and renamed: a sync client (Drive, OneDrive) never uploads half a file.
  writeAtomic(file, data, { suffix: '.parcial' });
  prune(folder, keep);
  return { file, size: data.length, counts: manifest.counts, memoryError, encrypted: !!password };
}

// Keeps the `keep` most recent backups of the folder (only files named by VeSTA are ever deleted).
function prune(folder, keep) {
  const ours = list(folder);
  for (const b of ours.slice(keep)) fs.rmSync(path.join(folder, b.name), { force: true });
  return ours.slice(keep).map((b) => b.name);
}
function list(folder) {
  if (!folder || !fs.existsSync(folder)) return [];
  return fs
    .readdirSync(folder)
    .filter((n) => NAME.test(n))
    .map((name) => ({ name, ...statOf(path.join(folder, name)) }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
}
const statOf = (f) => {
  const s = fs.statSync(f);
  return { size: s.size, mtime: s.mtimeMs };
};

module.exports = {
  PREFIX,
  INTERVALS,
  KEEP,
  DEFAULTS,
  settings,
  due,
  stamp,
  createBackup,
  prune,
  list,
  // Kept here so callers have one entry point for backups.
  ...require('./restore.cjs'),
  ...require('./readable.cjs'),
};
