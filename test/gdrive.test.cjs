// Google Drive for the backups, against a local stand-in for Google (scripts/fake-google.cjs): client JSON, sign-in
// with PKCE through the loopback redirect, sealed secrets, folder, upload, list, trash rotation, download, errors.
const { test, after } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { createDrive, parseClient, checkClient, explain } = require('../electron/backup/gdrive.cjs');
const { createFakeGoogle, browse } = require('../scripts/fake-google.cjs');
const { UserError } = require('../electron/app/errors.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-gd-'));
const google = createFakeGoogle();
let urls;
after(() => google.close());
const seal = (v) => 'sealed:' + Buffer.from(v).toString('base64');
const unseal = (v) => Buffer.from(v.slice(7), 'base64').toString();
async function connected(dir = tmp()) {
  urls ||= await google.listen();
  const opened = [];
  const d = createDrive({
    file: path.join(dir, 'google-drive.json'),
    seal,
    unseal,
    urls,
    openExternal: async (u) => {
      opened.push(u);
      await browse(u);
    },
  });
  d.setClient({ clientId: google.clientId, clientSecret: google.clientSecret });
  await d.connect();
  return { d, dir, opened };
}
const zip = (dir, name, bytes = 'PK zip ' + name) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, bytes);
  return f;
};

test('client: the downloaded "Desktop app" JSON or pasted fields; web clients and junk are refused', () => {
  const json = JSON.stringify({
    installed: { client_id: 'abc-1.apps.googleusercontent.com', client_secret: 'GOCSPX-x1y2z3w4v5' },
  });
  assert.deepEqual(parseClient(json), {
    clientId: 'abc-1.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-x1y2z3w4v5',
  });
  assert.throws(() => parseClient(JSON.stringify({ web: { client_id: 'x' } })), /App para computador/);
  assert.throws(() => parseClient('{nope'), UserError);
  assert.throws(() => checkClient({ clientId: 'abc', clientSecret: 'GOCSPX-x1y2z3w4v5' }), /googleusercontent/);
  assert.throws(() => checkClient({ clientId: 'a.apps.googleusercontent.com', clientSecret: 'x' }), /Chave/);
});

test('sign-in: browser + loopback + PKCE; secrets sealed on disk; only the drive.file scope is asked', async () => {
  const { d, dir, opened } = await connected();
  const s = d.status();
  assert.equal(s.connected, true);
  assert.equal(s.email, 'pessoa@exemplo.com');
  const auth = new URL(opened[0]);
  assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.match(auth.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  const disk = fs.readFileSync(path.join(dir, 'google-drive.json'), 'utf8');
  assert.doesNotMatch(disk, new RegExp(google.clientSecret));
  assert.doesNotMatch(disk, /"rt-/);
  assert.match(disk, /sealed:/);
  // One folder, marked, reused.
  const folders = [...google.files.values()].filter((f) => f.appProperties?.vesta === 'backups');
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, 'VeSTA backups');
});

test('upload, list (newest first, with the computer), trash beyond keep, download the same bytes', async () => {
  const { d } = await connected();
  const local = tmp();
  for (const n of [
    'VeSTA-backup-2026-10-27-0900.zip',
    'VeSTA-backup-2026-10-28-0900.zip',
    'VeSTA-backup-2026-10-29-0900.zip',
  ])
    await d.upload(zip(local, n), { computer: 'DESKTOP-1' });
  const list = await d.list();
  assert.deepEqual(
    list.map((f) => f.name),
    ['VeSTA-backup-2026-10-29-0900.zip', 'VeSTA-backup-2026-10-28-0900.zip', 'VeSTA-backup-2026-10-27-0900.zip']
  );
  assert.equal(list[0].computer, 'DESKTOP-1');
  assert.equal(list[0].size, 'PK zip VeSTA-backup-2026-10-29-0900.zip'.length);
  assert.deepEqual(await d.prune(2), ['VeSTA-backup-2026-10-27-0900.zip']);
  assert.equal((await d.list()).length, 2);
  assert.ok(
    [...google.files.values()].some((f) => f.trashed),
    'moved to the trash, not deleted'
  );
  const dest = path.join(local, 'baixado', 'b.zip');
  await d.download(list[0].id, dest);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'PK zip VeSTA-backup-2026-10-29-0900.zip');
  await assert.rejects(d.download('../../etc', dest), /inválido/);
});

test('another computer with the same client and account sees the same backups', async () => {
  const a = await connected();
  await a.d.upload(zip(tmp(), 'VeSTA-backup-2026-10-30-1000.zip'), { computer: 'NOTEBOOK' });
  const b = await connected(); // fresh data dir: no folder id saved, found by its mark
  assert.ok((await b.d.list()).some((f) => f.name === 'VeSTA-backup-2026-10-30-1000.zip' && f.computer === 'NOTEBOOK'));
});

test('expired access is refreshed; revoked access asks to connect again; disconnect revokes', async () => {
  const { d } = await connected();
  google.expireAccess();
  assert.ok(Array.isArray(await d.list()), 'refreshed with the saved refresh token');
  google.revokeAll();
  google.expireAccess();
  await assert.rejects(d.list(), /expirou ou foi revogado/);
  assert.equal(d.status().connected, false);
  assert.match(d.status().error, /Conecte de novo/);
  const c = await connected();
  const out = await c.d.disconnect();
  assert.equal(out.connected, false);
  assert.equal(out.configured, true, 'the client stays: reconnecting is one click');
  await assert.rejects(c.d.list(), /Conecte o Google Drive/);
});

test('sign-in refused by the person, API disabled in the project: clear messages', async () => {
  urls ||= await google.listen();
  const d = createDrive({ file: path.join(tmp(), 'g.json'), urls, openExternal: browse });
  await assert.rejects(d.connect(), /Primeiro informe o cliente/);
  d.setClient({ clientId: google.clientId, clientSecret: google.clientSecret });
  google.deny(true);
  await assert.rejects(d.connect(), /não autorizou/);
  google.deny(false);
  google.disableApi(true);
  try {
    await assert.rejects(d.connect(), /Google Drive API está desativada/);
  } finally {
    google.disableApi(false);
  }
  assert.match(explain(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } }), /cheio/);
});

test('sign-in: a request without this sign-in’s state is ignored instead of ending the sign-in', async () => {
  urls ||= await google.listen();
  const statuses = [];
  const d = createDrive({
    file: path.join(tmp(), 'g.json'),
    seal,
    unseal,
    urls,
    openExternal: async (u) => {
      const redirect = new URL(u).searchParams.get('redirect_uri');
      // Another local program pokes the loopback port first (no state, then a forged one).
      statuses.push((await fetch(redirect + '/')).status);
      statuses.push((await fetch(redirect + '/?code=forjado&state=outro')).status);
      await browse(u);
    },
  });
  d.setClient({ clientId: google.clientId, clientSecret: google.clientSecret });
  const s = await d.connect();
  assert.deepEqual(statuses, [400, 400]);
  assert.equal(s.connected, true);
});
