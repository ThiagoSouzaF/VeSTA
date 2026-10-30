// E2E: Google Drive backups (against scripts/fake-google.cjs, never a real account) and preferences changed by chats.
//   1. client JSON fields -> sign-in (browser simulated, PKCE, loopback) -> backup now also uploads to the Drive
//   2. list the Drive backups -> restore one: download, confirmation, safety copy, staged for the next start
//   3. (ai) real chats: Claude changes theme and zoom, Codex hides the mascot, a "Só consulta" chat changes nothing
// Usage: npx electron scripts/test-drive-e2e.cjs [ai] [claude-model]
const path = require('node:path'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const withAi = process.argv.includes('ai');
const model = process.argv.slice(2).find((a) => a.startsWith('claude-')) || 'claude-haiku-5-5';
const data = require('./test-scratch.cjs')('drive');
fs.writeFileSync(
  path.join(data, 'vesta.json'),
  JSON.stringify({
    version: 4,
    projects: [],
    chats: [
      {
        id: 'antigo',
        title: 'Conversa antiga',
        provider: 'claude',
        mode: 'edit',
        createdAt: Date.now(),
        messages: [{ id: 'u', role: 'user', text: 'oi', createdAt: Date.now() }],
      },
    ],
    memories: [],
  })
);
process.env.VESTA_DATA_DIR = data;
process.env.VESTA_SERVICE_TEST = '1';
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
const { app } = require('electron');
const { methods, ctx, getState } = require('../electron/main.cjs');
const { createDrive } = require('../electron/gdrive.cjs');
const { createFakeGoogle, browse } = require('./fake-google.cjs');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await delay(500);
  }
  throw new Error('Tempo esgotado: ' + what);
};
const turn = async (chatId, text) => {
  await methods.send({ chatId, text });
  await until('resposta', () => !getState().running.includes(chatId));
  return getState()
    .chats.find((c) => c.id === chatId)
    .messages.at(-1);
};

app.whenReady().then(async () => {
  const google = createFakeGoogle();
  const { relaunch, quit } = app;
  try {
    await methods.bootstrap();
    await until('backups', () => ctx.backups && ctx.drive, 20000);
    // ---- 1. connect and upload ----------------------------------------------------------------------------------------
    const urls = await google.listen();
    ctx.drive = createDrive({ file: path.join(data, 'google-drive.json'), urls, openExternal: browse });
    let s = await methods.driveSetClient({ clientId: google.clientId, clientSecret: google.clientSecret });
    assert.equal(s.cloud.configured, true);
    s = await methods.driveConnect();
    assert.equal(s.cloud.connected, true);
    assert.equal(s.cloud.email, 'pessoa@exemplo.com');
    s = await methods.backupNow();
    assert.ok(s.driveAt >= s.lastAt, 'enviado depois do backup local: ' + (s.driveError || ''));
    const uploaded = [...google.files.values()].find((f) => f.name === path.basename(s.lastFile));
    assert.ok(uploaded, 'o .zip chegou ao Drive');
    assert.deepEqual(uploaded.content, fs.readFileSync(s.lastFile), 'os mesmos bytes');
    console.log('Enviado ao Drive:', uploaded.name, uploaded.content.length, 'bytes');
    // Sending off: the next backup stays local.
    await methods.backupSettings({ drive: false });
    await delay(61000 - (Date.now() % 60000)); // a new minute, a new file name
    s = await methods.backupNow();
    assert.equal([...google.files.values()].filter((f) => /^VeSTA-backup-/.test(f.name)).length, 1);
    await methods.backupSettings({ drive: true });
    // ---- 2. restore from the Drive ----------------------------------------------------------------------------------
    const list = await methods.driveBackups();
    assert.equal(list.length, 1);
    let asked = null,
      restarted = 0;
    ctx.dialog = {
      ...ctx.dialog,
      showMessageBox: async (_w, o) => ((asked = o), { response: 0 }),
    };
    app.relaunch = () => restarted++;
    app.quit = () => restarted++;
    // Data changed after the backup: the restore brings back the backed-up state.
    ctx.store.state.chats = [];
    assert.equal(await methods.driveRestore({ id: list[0].id }), true);
    assert.match(asked.detail, /Do Google Drive, feito no computador /);
    assert.equal(restarted, 2, 'relaunch + quit');
    const pending = path.join(data, 'restore-pending');
    assert.ok(fs.existsSync(path.join(pending, 'pronto.json')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(pending, 'vesta.json'), 'utf8')).chats.length, 1);
    assert.ok(!fs.readdirSync(path.join(data, 'downloads')).length, 'o download temporário foi apagado');
    fs.rmSync(pending, { recursive: true, force: true });
    app.relaunch = relaunch;
    app.quit = quit;
    console.log('PASS: Google Drive (conectar, enviar, listar, restaurar)');
    // ---- 3. preferences through real chats ----------------------------------------------------------------------------
    if (withAi) {
      await methods.refreshConnections();
      const c = (await methods.createChat({ provider: 'claude', model, mode: 'edit' })).chats[0];
      const m1 = await turn(c.id, 'Mude o tema do VeSTA para Papel e o zoom do texto para 120%.');
      console.log('Claude:', m1.status, JSON.stringify(m1.text.slice(0, 160)));
      assert.equal(getState().settings.theme, 'paper');
      assert.equal(getState().settings.fontScale, 1.2);
      const x = (await methods.createChat({ provider: 'codex', mode: 'edit' })).chats[0];
      const m2 = await turn(x.id, 'Esconda a mascote do VeSTA.');
      console.log('Codex:', m2.status, JSON.stringify(m2.text.slice(0, 160)));
      assert.equal(getState().settings.mascot, false);
      const r = (await methods.createChat({ provider: 'claude', model, mode: 'read' })).chats[0];
      const m3 = await turn(r.id, 'Mude o tema do VeSTA para Aurora.');
      console.log('Só consulta:', m3.status, JSON.stringify(m3.text.slice(0, 160)));
      assert.equal(getState().settings.theme, 'paper', 'chat em Só consulta não altera');
      console.log('PASS: preferências pelos chats');
    }
  } catch (e) {
    console.error('FAIL:', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    app.relaunch = relaunch;
    app.quit = quit;
    await google.close();
    app.quit();
  }
});
