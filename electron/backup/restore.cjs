// Restoring a backup: reading it (decrypting a protected one), checking it is a VeSTA backup, extracting restaurar/
// beside the data, and putting it in place at the next start, before the store or the memory server open anything.
const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
const fflate = require('fflate');
const { UserError } = require('../app/errors.cjs');
const { writeAtomic } = require('../util/sys.cjs');
const crypto = require('./crypto.cjs');

// Version of the archive layout; a newer one is refused (the app must be updated first).
const FORMAT = 1;
const PENDING = 'restore-pending';

const safeEntry = (name) =>
  !name.includes('..') && !path.isAbsolute(name) && !/^[a-z]:/i.test(name) && !name.includes('\\');

// The entries of a backup whose name passes `filter`; a protected one is decrypted first (UserError with code
// 'needs-password' / 'wrong-password' when that fails).
function readZip(file, filter, password = '') {
  let data = fs.readFileSync(file);
  if (crypto.isEncrypted(data)) data = crypto.decrypt(data, password);
  try {
    return fflate.unzipSync(data, { filter: (f) => filter(f.name) });
  } catch (e) {
    throw new UserError('Este arquivo não é um backup do VeSTA válido (' + (e.code || e.message) + ')');
  }
}
function manifestOf(entries) {
  const raw = entries['restaurar/manifesto.json'];
  if (!raw) throw new UserError('Este arquivo não é um backup do VeSTA');
  const manifest = JSON.parse(fflate.strFromU8(raw));
  if (manifest.format > FORMAT) throw new UserError('Backup feito por uma versão mais nova do VeSTA: atualize o app');
  return manifest;
}
// Is this backup protected by a password? (reads only its first bytes)
function isProtected(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(crypto.MAGIC.length + 1);
    return fs.readSync(fd, head, 0, head.length, 0) === head.length && crypto.isEncrypted(head);
  } finally {
    fs.closeSync(fd);
  }
}
// The manifest of a backup (throws a UserError when it is not one, or the password is missing/wrong).
const inspectBackup = (file, { password = '' } = {}) =>
  manifestOf(readZip(file, (n) => n === 'restaurar/manifesto.json', password));
// Extracts restaurar/ next to the data; applyPendingRestore() puts it in place at the next start.
function stageRestore(file, dataDir, { password = '' } = {}) {
  const entries = readZip(file, (n) => n.startsWith('restaurar/') && safeEntry(n), password);
  const manifest = manifestOf(entries);
  let parsed;
  try {
    parsed = JSON.parse(fflate.strFromU8(entries['restaurar/vesta.json']));
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
  writeAtomic(storeFile, JSON.stringify(incoming, null, 2));
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

module.exports = { FORMAT, PENDING, readZip, isProtected, inspectBackup, stageRestore, applyPendingRestore };
