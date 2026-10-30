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
// A restore is staged next to the data and applied at the next start, before the store or the memory server open.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { execFileSync } = require('node:child_process');
const fflate = require('fflate');
const { UserError } = require('./errors.cjs');

const PREFIX = 'VeSTA-backup-';
const NAME = /^VeSTA-backup-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.zip$/;
const FORMAT = 1;
const PENDING = 'restore-pending';
const INTERVALS = { off: 0, daily: 24 * 3600e3, weekly: 7 * 24 * 3600e3 };
const KEEP = [3, 5, 10, 20, 30];
// drive: also send each backup to Google Drive when it is connected (see gdrive.cjs).
const DEFAULTS = { folder: '', auto: 'daily', keep: 10, drive: true };
const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', drael: 'Drael' };

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
const when = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
// File names that open everywhere (Windows, Drive, phones): ASCII, no reserved characters.
const slug = (t, max = 60) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'sem-titulo';

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

// ---- readable part ---------------------------------------------------------------------------------------------------
function chatMarkdown(chat, projectName) {
  // Answers given before a switch of AI carry their own provider and model; the others are the chat's current ones.
  const author = (m) => {
    if (m.role === 'user') return 'Você';
    const provider = m.provider || chat.provider,
      model = m.model || (provider === chat.provider ? chat.model : '');
    return (PROVIDER_NAMES[provider] || provider) + (model ? ' (' + model + ')' : '');
  };
  const head = [
    '# ' + (chat.title || 'Conversa'),
    '',
    '- IA: ' + (PROVIDER_NAMES[chat.provider] || chat.provider) + (chat.model ? ' · ' + chat.model : ''),
    '- Projeto: ' + projectName,
    '- Criada em: ' + when(chat.createdAt),
    ...(chat.updatedAt ? ['- Última mensagem: ' + when(chat.updatedAt)] : []),
  ];
  const body = (chat.messages || [])
    .filter((m) => m.text || m.attachments?.length || m.error)
    .map((m) =>
      [
        '## ' + author(m) + ' · ' + when(m.createdAt),
        '',
        m.text || '',
        ...(m.attachments?.length ? ['', 'Anexos: ' + m.attachments.map((a) => a.name).join(', ')] : []),
        ...(m.error && m.status !== 'done' ? ['', '> ' + m.error] : []),
      ].join('\n')
    );
  return head.join('\n') + '\n\n' + body.join('\n\n') + '\n';
}

// "How you like to work": the profile the AIs learned plus the preferences and notes written in the app.
function preferencesMarkdown(state, profile) {
  const out = ['# Suas preferências', ''];
  out.push('## Aprendidas pelas IAs', '');
  if (profile === null)
    out.push('_O AI Memory não respondeu durante o backup; o arquivo restaurar/ai-memory.tar.gz as contém._');
  else if (!profile.length) out.push('_Nenhuma ainda._');
  else for (const p of profile) out.push('- **' + (p.category || 'geral') + '**: ' + p.statement.replace(/\n+/g, ' '));
  const own = (state.memories || []).filter((m) => m.kind === 'preference' || m.kind === 'note' || !m.kind);
  out.push('', '## Escritas por você', '');
  if (!own.length) out.push('_Nenhuma._');
  for (const m of own) {
    const where =
      m.kind === 'preference' ? 'todas as IAs' : state.projects.find((p) => p.id === m.projectId)?.name || 'pessoal';
    out.push('### ' + m.title + ' (' + where + ')', '', m.body || '', '');
  }
  return out.join('\n') + '\n';
}

// The AI Memory wiki is stored under <workspace-id>/<scope-id>/: each scope's _meta.md names its project.
function wikiFiles(wikiDir, projectName) {
  const files = {};
  if (!fs.existsSync(wikiDir)) return files;
  const labels = new Map();
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name),
        r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        const meta = path.join(abs, '_meta.md');
        if (fs.existsSync(meta)) {
          const m = /^project:\s*(.+)$/m.exec(fs.readFileSync(meta, 'utf8'));
          if (m) labels.set(r, slug(projectName(m[1].trim()), 40));
          else labels.set(r, null); // workspace level: dropped from the path
        }
        walk(abs, r);
      } else if (e.isFile() && e.name.endsWith('.md') && e.name !== '_meta.md') {
        const parts = r.split('/');
        const out = [];
        let prefix = '';
        for (const [i, part] of parts.entries()) {
          prefix = prefix ? prefix + '/' + part : part;
          if (i < parts.length - 1 && labels.has(prefix)) {
            const label = labels.get(prefix);
            if (label) out.push(label);
          } else out.push(part);
        }
        files['memoria-ia/' + out.join('/')] = fs.readFileSync(abs);
      }
    }
  };
  walk(wikiDir, '');
  return files;
}

function walkFiles(root, skip = () => false) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (skip(r)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(root, '');
  return out;
}

function readme(manifest) {
  return `# Backup do VeSTA

Feito em ${when(manifest.createdAt)} pelo VeSTA ${manifest.appVersion}.

Tudo aqui abre em qualquer editor de texto, sem o VeSTA:

- **conversas/** — ${manifest.counts.chats} conversas em Markdown, uma pasta por projeto.
- **preferencias.md** — como você gosta de trabalhar: o que as IAs aprenderam e o que você escreveu.
- **memoria-ia/** — ${manifest.counts.wikiPages} páginas do AI Memory (resumos de sessões, decisões, regras e armadilhas), por projeto.

A pasta **restaurar/** serve para o VeSTA voltar a este ponto: em Preferências → Backup → "Restaurar de um backup",
escolha este .zip. O pareamento do celular não vai no backup (pareie de novo depois de restaurar).
${manifest.memoryError ? '\n> A memória (AI Memory) não respondeu durante este backup: ' + manifest.memoryError + '\n' : ''}`;
}

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
  const data = await zipAsync(files);
  let file = path.join(folder, PREFIX + stamp(now) + '.zip');
  for (let i = 2; fs.existsSync(file); i++) file = path.join(folder, PREFIX + stamp(now) + '-' + i + '.zip');
  // Written beside and renamed: a sync client (Drive, OneDrive) never uploads half a file.
  fs.writeFileSync(file + '.parcial', data);
  fs.renameSync(file + '.parcial', file);
  prune(folder, keep);
  return { file, size: data.length, counts: manifest.counts, memoryError };
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

// ---- restore -------------------------------------------------------------------------------------------------------
const safeEntry = (name) =>
  !name.includes('..') && !path.isAbsolute(name) && !/^[a-z]:/i.test(name) && !name.includes('\\');

function readZip(file, filter) {
  let data;
  try {
    data = fs.readFileSync(file);
    return fflate.unzipSync(data, { filter: (f) => filter(f.name) });
  } catch (e) {
    throw new UserError('Este arquivo não é um backup do VeSTA válido (' + (e.code || e.message) + ')');
  }
}
// The manifest of a backup .zip (throws a UserError when it is not one).
function inspectBackup(file) {
  const entries = readZip(file, (n) => n === 'restaurar/manifesto.json');
  const raw = entries['restaurar/manifesto.json'];
  if (!raw) throw new UserError('Este .zip não é um backup do VeSTA');
  const manifest = JSON.parse(fflate.strFromU8(raw));
  if (manifest.format > FORMAT) throw new UserError('Backup feito por uma versão mais nova do VeSTA: atualize o app');
  return manifest;
}
// Extracts restaurar/ next to the data; applyPendingRestore() puts it in place at the next start.
function stageRestore(file, dataDir) {
  const manifest = inspectBackup(file);
  const entries = readZip(file, (n) => n.startsWith('restaurar/') && safeEntry(n));
  const store = entries['restaurar/vesta.json'];
  let parsed;
  try {
    parsed = JSON.parse(fflate.strFromU8(store));
  } catch {
    throw new UserError('O backup está incompleto: faltam os dados do app');
  }
  if (!Array.isArray(parsed.chats)) throw new UserError('O backup está incompleto: faltam as conversas');
  const dir = path.join(dataDir, PENDING);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const target = path.join(dir, name.slice('restaurar/'.length));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  // Written last: a half-extracted folder is never applied.
  fs.writeFileSync(path.join(dir, 'pronto.json'), JSON.stringify({ from: file, manifest }));
  return manifest;
}

// Runs at start, before the store and the memory server. `stopMemory()` ends a server still holding the memory dir.
// Returns null (nothing pending) or { at, from, createdAt, errors[] }.
async function applyPendingRestore(dataDir, { exe, stopMemory = async () => {}, run = execFileSync } = {}) {
  const dir = path.join(dataDir, PENDING),
    ready = path.join(dir, 'pronto.json');
  if (!fs.existsSync(ready)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  const { from, manifest } = JSON.parse(fs.readFileSync(ready, 'utf8'));
  const errors = [];
  // App data: the backup's, keeping what belongs to this computer (phone pairing, where backups go).
  const storeFile = path.join(dataDir, 'vesta.json');
  const incoming = JSON.parse(fs.readFileSync(path.join(dir, 'vesta.json'), 'utf8'));
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    fs.copyFileSync(storeFile, path.join(dataDir, 'vesta.antes-de-restaurar.json'));
  } catch {}
  if (current.remote) incoming.remote = current.remote;
  if (current.backup) incoming.backup = { ...incoming.backup, ...current.backup };
  fs.writeFileSync(storeFile + '.tmp', JSON.stringify(incoming, null, 2), 'utf8');
  fs.renameSync(storeFile + '.tmp', storeFile);
  // Memory: the AI Memory's own restore swaps wiki/ and db/ into place (the hook spool and identity are kept).
  const tar = path.join(dir, 'ai-memory.tar.gz');
  if (fs.existsSync(tar))
    try {
      await stopMemory();
      run(exe, ['--data-dir', path.join(dataDir, 'memory'), 'restore', '--from', tar, '--force'], {
        windowsHide: true,
        timeout: 180000,
        stdio: 'ignore',
      });
    } catch (e) {
      errors.push('memória: ' + (e.message || e).toString().split('\n')[0]);
    }
  // Attachments: the previous folder is kept aside until the next restore.
  const anexos = path.join(dir, 'anexos'),
    attachments = path.join(dataDir, 'attachments'),
    previous = path.join(dataDir, 'attachments.antes-de-restaurar');
  try {
    fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(attachments)) fs.renameSync(attachments, previous);
    if (fs.existsSync(anexos)) fs.renameSync(anexos, attachments);
  } catch (e) {
    errors.push('anexos: ' + e.message);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { at: Date.now(), from, createdAt: manifest?.createdAt || 0, errors };
}

// ---- destinations ----------------------------------------------------------------------------------------------------
// Google Drive for desktop exposes "My Drive" as a drive letter (G:\My Drive) or, in mirror mode, a folder in the
// profile. Whatever lands in there is uploaded by it.
function googleDriveFolders({ exists = fs.existsSync, home = os.homedir(), platform = process.platform } = {}) {
  const names = ['Meu Drive', 'My Drive', 'Mi unidad'];
  const found = [];
  if (platform === 'win32')
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ')
      for (const n of names) if (safeExists(exists, letter + ':\\' + n)) found.push(letter + ':\\' + n);
  for (const n of [...names, 'Google Drive'])
    if (safeExists(exists, path.join(home, n))) found.push(path.join(home, n));
  return [...new Set(found)].map((dir) => path.join(dir, 'VeSTA'));
}
const safeExists = (exists, p) => {
  try {
    return exists(p);
  } catch {
    return false;
  }
};

module.exports = {
  PREFIX,
  PENDING,
  INTERVALS,
  KEEP,
  DEFAULTS,
  settings,
  due,
  slug,
  stamp,
  chatMarkdown,
  preferencesMarkdown,
  wikiFiles,
  createBackup,
  prune,
  list,
  inspectBackup,
  stageRestore,
  applyPendingRestore,
  googleDriveFolders,
};
