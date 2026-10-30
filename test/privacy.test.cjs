// No telemetry and safe data at rest: the environment of every program VeSTA starts, Chromium's background traffic and
// permissions, leftovers in the temp folder, sealed secrets and password-protected backups.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const P = require('../electron/app/privacy.cjs');
const C = require('../electron/backup/crypto.cjs');
const B = require('../electron/backup/archive.cjs');
const { createSecrets, sealedFile } = require('../electron/app/secrets.cjs');
const providers = require('../electron/ai/providers.cjs');
const { UserError } = require('../electron/app/errors.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-priv-'));
// A keychain stand-in: reversible, but never the plain text.
const keychain = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(s).reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString(),
});

test('child processes get every opt-out, and the person’s environment cannot turn telemetry back on', () => {
  const env = P.childEnv(
    { VESTA_X: '1' },
    { PATH: 'p', DISABLE_TELEMETRY: '0', CLAUDE_CODE_ENABLE_TELEMETRY: '1', DO_NOT_TRACK: '0' }
  );
  assert.equal(env.PATH, 'p');
  assert.equal(env.VESTA_X, '1');
  for (const [k, v] of Object.entries(P.PRIVATE_ENV)) assert.equal(env[k], v, k);
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, '0');
  assert.equal(env.OPENCODE_DISABLE_SHARE, '1');
});

test('Codex is started with analytics off (chats and the usage reader)', () => {
  const spec = providers.command({ provider: 'codex', mode: 'edit' }, 'codex.exe', null);
  assert.deepEqual(spec.args.slice(0, 3), ['app-server', ...P.CODEX_PRIVATE_ARGS]);
  assert.deepEqual(P.CODEX_PRIVATE_ARGS, ['-c', 'analytics.enabled=false']);
  const src = fs.readFileSync(path.join(__dirname, '../electron/ai/rate-limits.cjs'), 'utf8');
  assert.match(src, /args = \['app-server', \.\.\.CODEX_PRIVATE_ARGS\]/);
});

test('every place that starts a program goes through childEnv (no raw process.env spread)', () => {
  const dir = path.join(__dirname, '../electron');
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.cjs') && /\.\.\.process\.env\b/.test(fs.readFileSync(p, 'utf8'))) offenders.push(p);
    }
  };
  walk(dir);
  assert.deepEqual(
    offenders.map((p) => path.relative(dir, p)),
    []
  );
});

test('Chromium: background networking off, features merged with the ones already disabled', () => {
  const switches = new Map([['disable-features', 'CalculateNativeWinOcclusion']]);
  const app = {
    commandLine: {
      appendSwitch: (k, v = '') => switches.set(k, v),
      getSwitchValue: (k) => switches.get(k) || '',
    },
  };
  P.hardenChromium(app);
  for (const s of ['disable-background-networking', 'disable-component-update', 'no-pings'])
    assert.ok(switches.has(s), s);
  const off = switches.get('disable-features').split(',');
  assert.ok(off.includes('CalculateNativeWinOcclusion'));
  for (const f of P.CHROMIUM_OFF) assert.ok(off.includes(f), f);
});

test('Chromium: spell-check off and only clipboard writes are allowed', () => {
  const calls = {};
  P.hardenSession({
    setSpellCheckerEnabled: (v) => (calls.spell = v),
    setPermissionRequestHandler: (fn) => (calls.request = fn),
    setPermissionCheckHandler: (fn) => (calls.check = fn),
  });
  assert.equal(calls.spell, false);
  const answer = (p) => {
    let out;
    calls.request(null, p, (v) => (out = v));
    return out;
  };
  assert.equal(answer('clipboard-sanitized-write'), true);
  for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal'])
    assert.equal(answer(p), false, p);
  assert.equal(calls.check(null, 'media'), false);
});

test('temp leftovers of a crashed run are removed; fresh ones and other folders stay', () => {
  const dir = tmp();
  const old = Date.now() - 2 * 3600e3;
  for (const n of ['vesta-drael-abc', 'vesta-update-xyz', 'outro-app', 'vesta-drael-recente'])
    fs.mkdirSync(path.join(dir, n));
  fs.writeFileSync(path.join(dir, 'vesta-drael-abc', 'oauth.json'), '{}');
  for (const n of ['vesta-drael-abc', 'vesta-update-xyz', 'outro-app'])
    fs.utimesSync(path.join(dir, n), new Date(old), new Date(old));
  assert.equal(P.sweepTemp({ dir }), 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['outro-app', 'vesta-drael-recente']);
});

test('secrets are sealed by the keychain; without one nothing is stored', () => {
  const dir = tmp();
  const s = createSecrets(keychain());
  const file = sealedFile(path.join(dir, 'k.json'), s);
  file.set('minha senha forte');
  assert.equal(file.get(), 'minha senha forte');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'k.json'), 'utf8'), /minha senha/);
  assert.equal(s.unseal('plain:minha senha'), '', 'plain text is never accepted back');
  file.clear();
  assert.equal(file.has(), false);
  const none = sealedFile(path.join(dir, 'n.json'), createSecrets(keychain(false)));
  assert.throws(() => none.set('x'), UserError);
  assert.ok(!fs.existsSync(path.join(dir, 'n.json')));
});

test('backup encryption: AES-GCM with a password; wrong password and tampering are refused', () => {
  const data = Buffer.from('PK conteúdo do backup');
  const enc = C.encrypt(data, 'senha-boa-123');
  assert.ok(C.isEncrypted(enc));
  assert.ok(!enc.includes(data));
  assert.deepEqual(C.decrypt(enc, 'senha-boa-123'), data);
  assert.throws(
    () => C.decrypt(enc, ''),
    (e) => e.code === 'needs-password'
  );
  assert.throws(
    () => C.decrypt(enc, 'senha-errada-1'),
    (e) => e.code === 'wrong-password'
  );
  const tampered = Buffer.from(enc);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(
    () => C.decrypt(tampered, 'senha-boa-123'),
    (e) => e.code === 'wrong-password'
  );
  assert.throws(() => C.encrypt(data, 'curta'), /pelo menos 8/);
  assert.notDeepEqual(C.encrypt(data, 'senha-boa-123'), enc, 'fresh salt and iv every time');
});

test('a protected backup is a .vesta file nobody can read without the password, and restores with it', async () => {
  const dataDir = tmp();
  const state = {
    projects: [],
    chats: [
      {
        id: 'c1',
        title: 'Segredo',
        provider: 'claude',
        createdAt: 0,
        messages: [{ role: 'user', text: 'SENHA-DO-COFRE-99' }],
      },
    ],
    memories: [],
  };
  const r = await B.createBackup({ state, dataDir, memory: null, folder: tmp(), password: 'senha-boa-123' });
  assert.match(r.file, /\.vesta$/);
  assert.equal(r.encrypted, true);
  assert.doesNotMatch(fs.readFileSync(r.file).toString('latin1'), /SENHA-DO-COFRE|Segredo|conversas\//);
  assert.equal(B.isProtected(r.file), true);
  assert.throws(
    () => B.inspectBackup(r.file),
    (e) => e.code === 'needs-password'
  );
  assert.throws(
    () => B.inspectBackup(r.file, { password: 'outra-senha-1' }),
    (e) => e.code === 'wrong-password'
  );
  assert.equal(B.inspectBackup(r.file, { password: 'senha-boa-123' }).counts.chats, 1);
  const target = tmp();
  B.stageRestore(r.file, target, { password: 'senha-boa-123' });
  assert.ok(fs.existsSync(path.join(target, 'restore-pending', 'pronto.json')));
  assert.equal(B.list(path.dirname(r.file))[0].name, path.basename(r.file), '.vesta files are listed and rotated');
});

test('providers are found where their installers put them (paths keep their backslashes)', () => {
  const { DEFAULT_NODE_DIR } = require('../electron/ai/providers/locate.cjs');
  assert.equal(DEFAULT_NODE_DIR, 'C:' + String.fromCharCode(92) + 'Program Files' + String.fromCharCode(92) + 'nodejs');
  const dir = tmp();
  const exe = path.join(dir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  const saved = { PATH: process.env.PATH, NODE_EXE: process.env.NODE_EXE };
  try {
    process.env.PATH = '';
    process.env.NODE_EXE = path.join(dir, 'node.exe');
    assert.equal(providers.locate('opencode'), exe);
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.NODE_EXE === undefined) delete process.env.NODE_EXE;
    else process.env.NODE_EXE = saved.NODE_EXE;
  }
});
