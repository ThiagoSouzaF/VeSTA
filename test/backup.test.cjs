// Backups: the .zip (readable Markdown + restorable data), rotation, staging and applying a restore, destinations,
// the schedule and that the phone never reaches these operations.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const fflate = require('fflate');
const B = require('../electron/backup.cjs');
const { isAllowed } = require('../electron/remote/allowlist.cjs');
const { UserError } = require('../electron/errors.cjs');

const tmp = (p = 'vesta-bk-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const T0 = new Date(2026, 9, 29, 14, 5).getTime();

function fixture() {
  const dataDir = tmp();
  const state = {
    version: 4,
    settings: { theme: 'ink' },
    projects: [{ id: 'p1', name: 'Café Ação', path: 'C:/x' }],
    chats: [
      {
        id: 'c1aaaaaa',
        title: 'Plano do café',
        provider: 'claude',
        model: 'claude-sonnet-5-5',
        projectId: 'p1',
        createdAt: T0,
        messages: [
          { id: 'm1', role: 'user', text: 'Como fica o cardápio?', createdAt: T0, attachments: [{ name: 'menu.png' }] },
          {
            id: 'm2',
            role: 'assistant',
            provider: 'claude',
            text: 'Assim: **três itens**.',
            status: 'done',
            createdAt: T0,
          },
        ],
      },
      { id: 'c2bbbbbb', title: 'Plano do café', provider: 'codex', createdAt: T0, messages: [] },
    ],
    memories: [
      { id: 'n1', kind: 'preference', title: 'Idioma', body: 'Sempre em português.' },
      { id: 'n2', kind: 'session', title: 'Sessão', body: 'resumo', projectId: 'p1' },
    ],
    remote: { enabled: true, devices: [{ id: 'd', tokenHash: 'SEGREDO' }] },
  };
  const wiki = path.join(dataDir, 'memory', 'wiki', 'ws1');
  fs.mkdirSync(path.join(wiki, 'sc1', 'decisions'), { recursive: true });
  fs.mkdirSync(path.join(wiki, 'sc2', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'memory', 'wiki', '.git'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'memory', 'wiki', '.git', 'HEAD'), 'ref');
  fs.writeFileSync(path.join(wiki, '_meta.md'), '---\nworkspace: vesta\ntype: Scope Manifest\n---\n');
  fs.writeFileSync(path.join(wiki, 'sc1', '_meta.md'), '---\nproject: p1\ntype: Scope Manifest\n---\n');
  fs.writeFileSync(path.join(wiki, 'sc2', '_meta.md'), '---\nproject: inbox\ntype: Scope Manifest\n---\n');
  fs.writeFileSync(path.join(wiki, 'sc1', 'decisions', 'porta.md'), '# Porta\n\nUsar 8080.');
  fs.writeFileSync(path.join(wiki, 'sc2', 'sessions', 's.md'), '# Sessão');
  const att = path.join(dataDir, 'attachments');
  fs.mkdirSync(path.join(att, 'c1aaaaaa'), { recursive: true });
  fs.mkdirSync(path.join(att, '_staging'), { recursive: true });
  fs.writeFileSync(path.join(att, 'c1aaaaaa', 'ab-menu.png'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(att, '_staging', 'rascunho.txt'), 'x');
  const memory = {
    profile: async () => [{ path: 'profile/habits/idioma.md', category: 'habits', statement: 'Respostas curtas.' }],
    backupTo: async (file) => fs.writeFileSync(file, 'TARBALL'),
  };
  return { dataDir, state, memory };
}
const entries = (file) => fflate.unzipSync(fs.readFileSync(file));
const text = (e, name) => fflate.strFromU8(e[name]);

test('createBackup: one .zip with readable conversations, preferences and memory plus the restore data', async () => {
  const { dataDir, state, memory } = fixture();
  const folder = path.join(tmp(), 'Meu Drive', 'VeSTA');
  const r = await B.createBackup({ state, dataDir, memory, folder, appVersion: '0.11.0', now: new Date(T0) });
  assert.equal(path.basename(r.file), 'VeSTA-backup-2026-10-29-1405.zip');
  assert.equal(r.size, fs.statSync(r.file).size);
  assert.ok(!fs.existsSync(r.file + '.parcial'));
  const e = entries(r.file);
  const names = Object.keys(e).sort();
  // Conversations by project, Markdown, same-titled chats do not overwrite each other.
  assert.ok(names.includes('conversas/cafe-acao/2026-10-29-plano-do-cafe.md'), names.join('\n'));
  assert.ok(names.some((n) => /^conversas\/pessoal\/2026-10-29-plano-do-cafe(-c2bbbb)?\.md$/.test(n)));
  const chat = text(e, 'conversas/cafe-acao/2026-10-29-plano-do-cafe.md');
  assert.match(chat, /^# Plano do café/);
  assert.match(chat, /## Você · .*\n\nComo fica o cardápio\?\n\nAnexos: menu\.png/);
  assert.match(chat, /## Claude \(claude-sonnet-5-5\)/);
  assert.match(chat, /\*\*três itens\*\*/);
  // Preferences: learned by the AIs + written by the user; sessions are not repeated there.
  const prefs = text(e, 'preferencias.md');
  assert.match(prefs, /Respostas curtas\./);
  assert.match(prefs, /### Idioma \(todas as IAs\)\n\nSempre em português\./);
  assert.doesNotMatch(prefs, /Sessão/);
  // The AI Memory wiki by project name, without ids, manifests or git internals.
  assert.ok(names.includes('memoria-ia/cafe-acao/decisions/porta.md'));
  assert.ok(names.includes('memoria-ia/pessoal/sessions/s.md'));
  assert.ok(!names.some((n) => n.includes('_meta.md') || n.includes('.git') || n.includes('ws1')));
  // Restore data: store without the phone pairing, the memory snapshot, attachments (not drafts).
  const store = JSON.parse(text(e, 'restaurar/vesta.json'));
  assert.equal(store.chats.length, 2);
  assert.equal(store.remote, undefined);
  assert.doesNotMatch(fflate.strFromU8(fs.readFileSync(r.file)), /SEGREDO/);
  assert.equal(text(e, 'restaurar/ai-memory.tar.gz'), 'TARBALL');
  assert.ok(names.includes('restaurar/anexos/c1aaaaaa/ab-menu.png'));
  assert.ok(!names.some((n) => n.includes('_staging')));
  const manifest = JSON.parse(text(e, 'restaurar/manifesto.json'));
  assert.deepEqual(manifest.counts, { chats: 2, wikiPages: 2, attachments: 1, profile: 1 });
  assert.equal(manifest.memory, true);
  assert.match(text(e, 'LEIA-ME.md'), /2 conversas em Markdown/);
});

test('createBackup: memory down still produces a backup, with the reason in the manifest', async () => {
  const { dataDir, state } = fixture();
  const memory = {
    profile: async () => {
      throw new Error('fora do ar');
    },
    backupTo: async () => {
      throw new Error('servidor não respondeu');
    },
  };
  const r = await B.createBackup({ state, dataDir, memory, folder: tmp(), now: new Date(T0) });
  const e = entries(r.file);
  assert.equal(r.memoryError, 'servidor não respondeu');
  assert.ok(!e['restaurar/ai-memory.tar.gz']);
  assert.ok(e['memoria-ia/cafe-acao/decisions/porta.md'], 'the wiki files are still copied from disk');
  assert.match(text(e, 'LEIA-ME.md'), /não respondeu/);
  assert.match(text(e, 'preferencias.md'), /não respondeu durante o backup/);
  await assert.rejects(B.createBackup({ state, dataDir, memory, folder: '' }), UserError);
});

test('rotation keeps the newest N and never touches other files', async () => {
  const folder = tmp();
  fs.writeFileSync(path.join(folder, 'minha-planilha.zip'), 'x');
  fs.writeFileSync(path.join(folder, 'VeSTA-backup-antigo.zip'), 'x');
  for (let i = 0; i < 5; i++) {
    const f = path.join(folder, 'VeSTA-backup-2026-10-2' + i + '-1200.zip');
    fs.writeFileSync(f, 'x');
    fs.utimesSync(f, new Date(T0 + i * 1000), new Date(T0 + i * 1000));
  }
  const removed = B.prune(folder, 3);
  assert.deepEqual(removed.sort(), ['VeSTA-backup-2026-10-20-1200.zip', 'VeSTA-backup-2026-10-21-1200.zip']);
  assert.deepEqual(
    fs.readdirSync(folder).sort(),
    [
      'VeSTA-backup-2026-10-22-1200.zip',
      'VeSTA-backup-2026-10-23-1200.zip',
      'VeSTA-backup-2026-10-24-1200.zip',
      'VeSTA-backup-antigo.zip',
      'minha-planilha.zip',
    ].sort()
  );
  assert.equal(B.list(folder)[0].name, 'VeSTA-backup-2026-10-24-1200.zip');
  // Two backups in the same minute get distinct names.
  const { dataDir, state, memory } = fixture();
  const a = await B.createBackup({ state, dataDir, memory, folder, keep: 30, now: new Date(T0) });
  const b = await B.createBackup({ state, dataDir, memory, folder, keep: 30, now: new Date(T0) });
  assert.notEqual(a.file, b.file);
  assert.match(b.file, /-1405-2\.zip$/);
});

test('restore: staged from the zip, applied at start keeping this computer’s pairing and backup settings', async () => {
  const { dataDir, state, memory } = fixture();
  const r = await B.createBackup({ state, dataDir, memory, folder: tmp(), now: new Date(T0) });
  // The current data moved on after the backup.
  const target = tmp();
  fs.writeFileSync(
    path.join(target, 'vesta.json'),
    JSON.stringify({
      chats: [],
      remote: { enabled: true, devices: ['meu-celular'] },
      backup: { folder: 'G:\\Meu Drive\\VeSTA' },
    })
  );
  fs.mkdirSync(path.join(target, 'attachments', 'velho'), { recursive: true });
  const manifest = B.stageRestore(r.file, target);
  assert.equal(manifest.counts.chats, 2);
  assert.ok(fs.existsSync(path.join(target, 'restore-pending', 'pronto.json')));
  const calls = [];
  let stopped = 0;
  const result = await B.applyPendingRestore(target, {
    exe: 'ai-memory.exe',
    stopMemory: async () => stopped++,
    run: (exe, args) => calls.push([exe, ...args]),
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.createdAt, T0);
  const restored = JSON.parse(fs.readFileSync(path.join(target, 'vesta.json'), 'utf8'));
  assert.equal(restored.chats.length, 2);
  assert.deepEqual(restored.remote.devices, ['meu-celular']);
  assert.equal(restored.backup.folder, 'G:\\Meu Drive\\VeSTA');
  assert.ok(fs.existsSync(path.join(target, 'vesta.antes-de-restaurar.json')));
  assert.equal(stopped, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['ai-memory.exe', '--data-dir', path.join(target, 'memory')]);
  assert.deepEqual(calls[0].slice(3, 5), ['restore', '--from']);
  assert.ok(calls[0].includes('--force'));
  assert.ok(fs.existsSync(path.join(target, 'attachments', 'c1aaaaaa', 'ab-menu.png')));
  assert.ok(fs.existsSync(path.join(target, 'attachments.antes-de-restaurar', 'velho')));
  assert.ok(!fs.existsSync(path.join(target, 'restore-pending')));
  // Nothing pending: nothing happens.
  assert.equal(await B.applyPendingRestore(target, { exe: 'x', run: () => assert.fail('no restore') }), null);
});

test('restore: a half-extracted folder is never applied; a memory failure is reported, the rest still restored', async () => {
  const target = tmp();
  fs.mkdirSync(path.join(target, 'restore-pending'), { recursive: true });
  fs.writeFileSync(path.join(target, 'restore-pending', 'vesta.json'), '{"chats":[]}');
  assert.equal(await B.applyPendingRestore(target, { exe: 'x' }), null);
  assert.ok(!fs.existsSync(path.join(target, 'restore-pending')), 'the leftover is cleaned');
  const { dataDir, state, memory } = fixture();
  const r = await B.createBackup({ state, dataDir, memory, folder: tmp(), now: new Date(T0) });
  B.stageRestore(r.file, target);
  const result = await B.applyPendingRestore(target, {
    exe: 'x',
    run: () => {
      throw new Error('arquivo em uso\nstack');
    },
  });
  assert.deepEqual(result.errors, ['memória: arquivo em uso']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'vesta.json'), 'utf8')).chats.length, 2);
});

test('restore refuses files that are not VeSTA backups or try to escape the data folder', () => {
  const dir = tmp();
  const write = (name, files) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, fflate.zipSync(files));
    return f;
  };
  const u8 = fflate.strToU8;
  assert.throws(() => B.inspectBackup(write('outro.zip', { 'a.txt': u8('x') })), /não é um backup do VeSTA/);
  fs.writeFileSync(path.join(dir, 'lixo.zip'), 'não é zip');
  assert.throws(() => B.inspectBackup(path.join(dir, 'lixo.zip')), UserError);
  const newer = write('novo.zip', { 'restaurar/manifesto.json': u8('{"format":99}') });
  assert.throws(() => B.inspectBackup(newer), /versão mais nova/);
  const noChats = write('vazio.zip', {
    'restaurar/manifesto.json': u8('{"format":1,"counts":{}}'),
    'restaurar/vesta.json': u8('{}'),
  });
  assert.throws(() => B.stageRestore(noChats, tmp()), /faltam as conversas/);
  const target = tmp();
  const evil = write('mal.zip', {
    'restaurar/manifesto.json': u8('{"format":1,"counts":{}}'),
    'restaurar/vesta.json': u8('{"chats":[]}'),
    'restaurar/../../fora.txt': u8('x'),
  });
  B.stageRestore(evil, target);
  assert.ok(!fs.existsSync(path.join(target, '..', 'fora.txt')));
  assert.ok(!fs.existsSync(path.join(path.dirname(target), 'fora.txt')));
});

test('Google Drive for desktop is found as a drive letter or a profile folder', () => {
  const present = new Set(['G:\\Meu Drive', path.join('C:\\Users\\a', 'My Drive')]);
  const found = B.googleDriveFolders({ exists: (p) => present.has(p), home: 'C:\\Users\\a', platform: 'win32' });
  assert.deepEqual(found, [path.join('G:\\Meu Drive', 'VeSTA'), path.join('C:\\Users\\a', 'My Drive', 'VeSTA')]);
  const broken = B.googleDriveFolders({
    exists: () => {
      throw new Error('drive offline');
    },
    home: 'C:\\Users\\a',
    platform: 'win32',
  });
  assert.deepEqual(broken, []);
});

test('schedule and settings: due by interval, defaults for missing or invalid values', () => {
  const day = 24 * 3600e3;
  assert.equal(B.due('daily', 0, T0), true);
  assert.equal(B.due('daily', T0 - day + 1000, T0), false);
  assert.equal(B.due('daily', T0 - day, T0), true);
  assert.equal(B.due('weekly', T0 - 3 * day, T0), false);
  assert.equal(B.due('off', 0, T0), false);
  assert.deepEqual(B.settings({}), { folder: '', auto: 'daily', keep: 10 });
  assert.deepEqual(B.settings({ backup: { folder: 'D:\\b', auto: 'hourly', keep: 7 } }), {
    folder: 'D:\\b',
    auto: 'daily',
    keep: 10,
  });
  assert.equal(B.slug('Ação: café / “teste”?'), 'acao-cafe-teste');
  assert.equal(B.slug(''), 'sem-titulo');
});

test('backup operations are desktop only: the phone cannot reach them', () => {
  for (const name of [
    'backupStatus',
    'backupNow',
    'backupSettings',
    'backupChooseFolder',
    'backupOpenFolder',
    'backupRestore',
  ])
    assert.equal(isAllowed(name), false, name);
});
