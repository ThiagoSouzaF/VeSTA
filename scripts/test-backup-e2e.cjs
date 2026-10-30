// E2E (real AI Memory server, temporary data dirs, no AI calls): backup and restore of everything VeSTA keeps.
//   1. data dir A: a conversation, a project note and a learned preference in the AI Memory
//   2. methods.backupNow -> .zip in A/backups with the readable Markdown and the server's snapshot
//   3. the zip is staged into an empty data dir B and applied as at start (real `ai-memory restore`)
//   4. a Memory server opened on B finds the note and the preference; B's store has the conversation
// With from=<data dir> the data is first COPIED from there (never used in place) to measure a real backup.
// Usage: npx electron scripts/test-backup-e2e.cjs [from=<dir>]
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const fflate = require('fflate');
const scratch = require('./test-scratch.cjs');
const from = (process.argv.slice(2).find((a) => a.startsWith('from=')) || '').slice(5);
const A = scratch('backup-a'),
  Bdir = scratch('backup-b');
if (from) {
  for (const name of ['vesta.json', 'attachments', 'memory'])
    if (fs.existsSync(path.join(from, name)))
      fs.cpSync(path.join(from, name), path.join(A, name), {
        recursive: true,
        filter: (src) => !/hook-spool|[\\/]logs[\\/]?|vesta-server\.(pid|json)|\.serve\.lock/.test(src),
      });
} else
  fs.writeFileSync(
    path.join(A, 'vesta.json'),
    JSON.stringify({
      version: 4,
      projects: [{ id: 'proj', name: 'Projeto Teste', path: A, createdAt: Date.now() }],
      chats: [
        {
          id: 'chat-1',
          title: 'Conversa de backup',
          provider: 'claude',
          projectId: 'proj',
          mode: 'edit',
          createdAt: Date.now(),
          messages: [
            { id: 'u1', role: 'user', text: 'Qual a senha do cofre do teste?', createdAt: Date.now() },
            { id: 'a1', role: 'assistant', text: 'É LANTERNA-77.', status: 'done', createdAt: Date.now() },
          ],
        },
      ],
      memories: [],
      remote: { enabled: false, devices: [{ id: 'celular', hash: 'NAO-SAI-DAQUI' }] },
    })
  );
process.env.VESTA_DATA_DIR = A;
process.env.VESTA_SERVICE_TEST = '1';
const { app } = require('electron');
const { methods, ctx } = require('../electron/main.cjs');
const { Memory } = require('../electron/memory/client.cjs');
const B = require('../electron/backup/archive.cjs');
const exe = path.join(__dirname, '../runtime/ai-memory.exe');

app.whenReady().then(async () => {
  let other;
  try {
    await methods.bootstrap();
    while (!ctx.backups) await new Promise((r) => setTimeout(r, 100));
    if (!from) {
      await ctx.memory.ensureProject('proj');
      await ctx.memory.write({
        path: 'decisions/cofre.md',
        title: 'Cofre do teste',
        kind: 'note',
        projectId: 'proj',
        body: 'A senha do cofre do teste é LANTERNA-77.',
      });
      await methods.saveProfile({
        category: 'comunicacao',
        subject: 'Idioma',
        statement: 'Responder sempre em português.',
      });
    }
    // ---- 2. backup ------------------------------------------------------------------------------------------------
    const t0 = Date.now();
    const status = await methods.backupNow();
    const ms = Date.now() - t0;
    console.log('Backup:', status.lastFile, (status.lastSize / 1048576).toFixed(2) + ' MB', ms + ' ms');
    assert.equal(status.lastWarning, '', 'a memória entrou no backup');
    assert.ok(status.lastFile.startsWith(path.join(A, 'backups')));
    const entries = fflate.unzipSync(fs.readFileSync(status.lastFile));
    const names = Object.keys(entries);
    const manifest = JSON.parse(fflate.strFromU8(entries['restaurar/manifesto.json']));
    console.log('Manifesto:', JSON.stringify(manifest.counts), 'arquivos no zip:', names.length);
    assert.ok(entries['restaurar/ai-memory.tar.gz'].length > 1000);
    if (!from) {
      const chat = names.find((n) => n.startsWith('conversas/projeto-teste/'));
      assert.match(fflate.strFromU8(entries[chat]), /LANTERNA-77/);
      assert.match(fflate.strFromU8(entries['preferencias.md']), /Responder sempre em português/);
      assert.ok(
        names.some(
          (n) => n.startsWith('memoria-ia/projeto-teste/') && /LANTERNA-77/.test(fflate.strFromU8(entries[n]))
        ),
        'a nota do AI Memory legível por projeto'
      );
      assert.doesNotMatch(Buffer.from(fs.readFileSync(status.lastFile)).toString('latin1'), /NAO-SAI-DAQUI/);
    } else {
      const store = JSON.parse(fs.readFileSync(path.join(A, 'vesta.json'), 'utf8'));
      assert.equal(manifest.counts.chats, store.chats.length);
    }
    // ---- 3. restore into an empty data dir (as the next start would) ------------------------------------------------
    B.stageRestore(status.lastFile, Bdir);
    const result = await B.applyPendingRestore(Bdir, { exe });
    console.log('Restauração:', JSON.stringify(result.errors));
    assert.deepEqual(result.errors, []);
    const restored = JSON.parse(fs.readFileSync(path.join(Bdir, 'vesta.json'), 'utf8'));
    assert.equal(restored.chats.length, manifest.counts.chats);
    // ---- 4. the restored memory answers -----------------------------------------------------------------------------
    other = new Memory(exe, path.join(Bdir, 'memory'));
    const profile = await other.profile();
    if (!from) {
      const found = await other.query('senha cofre LANTERNA', 'proj');
      assert.match(found, /LANTERNA-77/);
      assert.ok(profile.some((p) => /português/.test(p.statement)));
    } else console.log('Perfil restaurado:', profile.length, 'entradas');
    console.log('PASS: backup e restauração completos');
  } catch (e) {
    console.error('FAIL:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    await other?.close();
    app.quit();
  }
});
