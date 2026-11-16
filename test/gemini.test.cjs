// Gemini CLI over ACP (electron/ai/gemini.cjs, drivers/gemini.cjs, parser/gemini.cjs), against a fake `gemini --acp`
// (test/fixtures/fake-gemini.cjs): the turn, permissions per mode, a session that resumes or starts over, the login
// error, and how the CLI is launched (flags, MCP servers over stdin, privacy settings, native terminal).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const drivers = require('../electron/ai/drivers.cjs');
const providers = require('../electron/ai/providers.cjs');
const gemini = require('../electron/ai/gemini.cjs');
const { terminalCommand } = require('../electron/ai/terminal.cjs');
const { BLOCKED_LOGIN_HINT, QUOTA_HINT, BUSY_HINT, hintFor } = require('../electron/ai/drivers/gemini.cjs');
const { authEnv } = require('../electron/ai/auth-env.cjs');
const { createSecrets } = require('../electron/app/secrets.cjs');
const { UserError } = require('../electron/app/errors.cjs');

const FAKE = path.join(__dirname, 'fixtures', 'fake-gemini.cjs');
function turn({ mode = 'normal', resume = null, readOnly = false, allow = true } = {}) {
  const events = [],
    asked = [];
  const ctx = {
    cwd: __dirname,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, FAKE_GEMINI: mode },
    prompt: 'oi',
    attachments: [],
    parse: providers.parser('gemini', (e) => events.push(e)),
    ask: async (r) => (asked.push(r), { allow }),
  };
  const spec = { exe: process.execPath, args: [FAKE, '--skip-trust'], mcpServers: [], readOnly, resume };
  const run = drivers.start('gemini', spec, ctx);
  const within = new Promise((_, reject) => setTimeout(() => reject(new Error('o turno não terminou')), 10000));
  return Promise.race([run.done, within]).then((res) => ({ res, events, asked, text: ctx.parse.text }));
}
const of = (events, type) => events.filter((e) => e.type === type);

test('a turn: text, the command asks the person, its card closes, memory write and tokens are reported', async () => {
  const { res, events, asked, text } = await turn();
  assert.equal(res.code, 0);
  assert.match(text, /^Olá! Recebi: oi\. permissão: proceed_once/);
  assert.doesNotMatch(text, /pensando/, 'thoughts are not the answer');
  assert.deepEqual(
    asked.map((a) => [a.provider, a.tool, a.command]),
    [['gemini', 'command', 'mkdir pasta-nova']]
  );
  const cards = of(events, 'activity');
  assert.ok(cards.some((c) => c.id === 'tc1' && c.kind === 'command' && c.status === 'running'));
  assert.ok(cards.some((c) => c.id === 'tc1' && c.status === 'done' && /saída do comando/.test(c.result)));
  const mcpId = 'mcp_vesta-memory_memory_write_page__call_42';
  assert.ok(cards.some((c) => c.id === mcpId && c.kind === 'memory' && c.label === 'Memória · memory_write_page'));
  assert.ok(cards.some((c) => c.id === mcpId && c.status === 'done'));
  // The arguments come from the title; a comma inside a value does not split it.
  assert.deepEqual(
    of(events, 'memory-write').map((w) => [w.path, w.body]),
    [['notas/x.md', '# Nota\n\nUm, dois']]
  );
  assert.deepEqual(
    of(events, 'session').map((s) => s.sessionId),
    ['new-session']
  );
  const [cost] = of(events, 'cost');
  assert.deepEqual([cost.provider, cost.inputTokens, cost.outputTokens, cost.cacheTokens], ['gemini', 120, 35, 40]);
});

test('denied by the person: the CLI gets reject_once', async () => {
  const { text } = await turn({ allow: false });
  assert.match(text, /permissão: cancel/);
});

test('read mode: requests are refused without asking the person', async () => {
  const { asked, text } = await turn({ readOnly: true });
  assert.deepEqual(asked, []);
  assert.match(text, /permissão: cancel/);
});

test('resume: the chat session is loaded and its replayed history stays out; an unknown one starts over', async () => {
  const resumed = await turn({ resume: 'old-session' });
  assert.doesNotMatch(resumed.text, /RESPOSTA ANTIGA/);
  assert.deepEqual(
    of(resumed.events, 'session').map((s) => s.sessionId),
    ['old-session']
  );
  const gone = await turn({ resume: 'apagada' });
  assert.deepEqual(
    of(gone.events, 'session').map((s) => s.sessionId),
    ['new-session']
  );
});

test('without a login the turn says where to save the key; a refused Google login says why', async () => {
  const { res, events } = await turn({ mode: 'auth' });
  assert.notEqual(res.code, 0);
  assert.match(of(events, 'provider-error')[0].message, /Conexões → Gemini/);
  const blocked = await turn({ mode: 'blocked' });
  assert.equal(of(blocked.events, 'provider-error')[0].message, BLOCKED_LOGIN_HINT);
});

test('launch: node + script, flags per mode, MCP servers in session/new (token never on the line), privacy file', () => {
  const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-gem-')), 'gemini.js');
  fs.writeFileSync(script, '');
  const endpoint = { mcp: 'http://127.0.0.1:9/mcp', token: 'segredo-123' };
  const spec = (chat) => providers.command({ provider: 'gemini', ...chat }, script, endpoint);
  const ask = spec({ mode: 'ask', model: 'gemini-3.8-flash' });
  assert.equal(ask.args[0], script);
  assert.ok(ask.args.includes('--acp') && ask.args.includes('--skip-trust') && ask.args.includes('--policy'));
  assert.ok(!ask.args.includes('--approval-mode'), 'ask = the CLI default (asks)');
  assert.deepEqual(ask.args.slice(-2), ['--model', 'gemini-3.8-flash']);
  assert.equal(ask.readOnly, false);
  assert.ok(!JSON.stringify(ask.args).includes('segredo-123'));
  assert.deepEqual(ask.mcpServers[0].headers, [{ name: 'Authorization', value: 'Bearer segredo-123' }]);
  assert.ok(spec({ mode: 'edit' }).args.join(' ').includes('--approval-mode yolo'));
  assert.equal(spec({ mode: 'read' }).readOnly, true);
  assert.ok(!spec({ mode: 'ask', model: 'auto' }).args.includes('--model'), '"auto" = the CLI picks');
  // Every rule names its server and "*" (the CLI rejects a rule without toolName, and then allows nothing).
  const policy = fs.readFileSync(ask.args[ask.args.indexOf('--policy') + 1], 'utf8');
  for (const s of gemini.OWN_SERVERS)
    assert.match(policy, new RegExp('mcpName = "' + s + '"\\ntoolName = "\\*"\\ndecision = "allow"'));
  // Native terminal: same script, the chat's session and mode (its home and key come from auth-env, as in the chat).
  const t = terminalCommand({ id: 'gemini', exe: script, chat: { mode: 'read', sessionId: 's-1' }, cwd: os.tmpdir() });
  const line = Buffer.from(t.args.at(-1), 'base64').toString('utf16le');
  assert.match(line, /'--resume' 's-1'/);
  assert.match(line, /'--approval-mode' 'plan'/);
});

test('settings in Gemini’s own home: privacy always on top, the key’s auth and free model, the CLI’s own keys kept', () => {
  const plain = gemini.settingsFor({}, false);
  assert.equal(plain.privacy.usageStatisticsEnabled, false);
  assert.equal(plain.telemetry.enabled, false);
  assert.equal(plain.general.enableAutoUpdate, false);
  assert.equal(plain.general.maxAttempts, 3, 'a busy or over-quota model fails in seconds, not minutes');
  assert.equal(plain.security, undefined, 'no key: the login stays the CLI’s business');
  // A login made in the terminal and a model the person picked there survive; privacy cannot be turned back on.
  const theirs = {
    security: { auth: { selectedType: 'oauth-personal' } },
    model: { name: 'gemini-3.8-flash' },
    privacy: { usageStatisticsEnabled: true },
    ui: { theme: 'x' },
  };
  assert.equal(gemini.settingsFor(theirs, false).security.auth.selectedType, 'oauth-personal');
  assert.equal(gemini.settingsFor(theirs, false).privacy.usageStatisticsEnabled, false);
  assert.equal(gemini.settingsFor(theirs, false).ui.theme, 'x');
  const keyed = gemini.settingsFor(theirs, true);
  assert.equal(keyed.security.auth.selectedType, 'gemini-api-key');
  assert.equal(keyed.model.name, 'gemini-3.8-flash', 'a chosen model is kept');
  assert.equal(gemini.settingsFor({}, true).model.name, gemini.FREE_MODEL, 'else the one the free tier serves');
});

test('an AI VeSTA does not know never falls into another AI’s path', () => {
  assert.throws(() => drivers.start('mistral', {}, {}), /IA desconhecida/);
  assert.throws(() => providers.parser('mistral', () => {}), /IA desconhecida/);
  assert.throws(() => providers.command({ provider: 'mistral' }, 'x.exe'), /IA desconhecida/);
});

test('login: a key in the environment or a Google login in VeSTA’s Gemini home (never ~/.gemini)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-gem-home-'));
  const ctx = { app: { getPath: () => dir } };
  assert.equal(gemini.authenticated(ctx, {}), false);
  assert.equal(gemini.authenticated(ctx, { GEMINI_API_KEY: 'k' }), true);
  fs.mkdirSync(path.join(dir, 'gemini-home', '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'gemini-home', '.gemini', 'oauth_creds.json'), '{}');
  assert.equal(gemini.authenticated(ctx, {}), true);
});

test('API key: sealed on this computer, refused when malformed, handed over only through the environment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-gem-key-'));
  const keychain = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s).reverse(),
    decryptString: (b) => Buffer.from(b).reverse().toString(),
  };
  const ctx = { app: { getPath: () => dir }, secrets: createSecrets(keychain) };
  const home = path.join(dir, 'gemini-home');
  const settings = () => JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'settings.json'), 'utf8'));
  assert.deepEqual(authEnv('gemini', ctx), { GEMINI_CLI_HOME: home }, 'no key: its own home, its own login');
  assert.equal(settings().telemetry.enabled, false, 'privacy is written before any launch');
  assert.equal(gemini.hasKey(ctx), false);
  assert.throws(() => gemini.saveKey(ctx, 'curta demais'), UserError);
  const key = 'AIzaSyTESTE_chave-de-exemplo-0123456789';
  gemini.saveKey(ctx, '  ' + key + '\n');
  assert.equal(gemini.hasKey(ctx), true);
  assert.ok(!fs.readFileSync(path.join(dir, 'gemini-key.json'), 'utf8').includes(key), 'never in plain text');
  const env = authEnv('gemini', ctx);
  assert.deepEqual(env, { GEMINI_CLI_HOME: home, GEMINI_API_KEY: key });
  assert.equal(settings().security.auth.selectedType, 'gemini-api-key');
  assert.equal(settings().model.name, gemini.FREE_MODEL);
  assert.equal(gemini.authenticated(ctx, {}), true);
  assert.deepEqual(authEnv('claude', ctx), {});
  // AI Studio's newer keys have dots; its quick-start curl can be pasted whole (the input field joins its lines).
  const dotted = 'AQ.Ab8RN6TESTE_falsa-0123456789abcdefghijklmnopqrstuvw';
  assert.equal(gemini.keyFrom(dotted), dotted);
  const curl =
    'curl "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent" \\' +
    "  -H 'Content-Type: application/json' \\" +
    "  -H 'X-goog-api-key: " +
    dotted +
    "' \\  -X POST";
  assert.equal(gemini.keyFrom(curl), dotted);
  assert.equal(gemini.keyFrom('curl https://example.com/?q=1'), '');
  gemini.saveKey(ctx, curl);
  assert.equal(authEnv('gemini', ctx).GEMINI_API_KEY, dotted);
  gemini.apiKey(ctx).clear();
  assert.deepEqual(authEnv('gemini', ctx), { GEMINI_CLI_HOME: home });
});

test('Google errors become what to do: over quota, busy model, refused login', () => {
  assert.equal(
    hintFor('Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-4-argon'),
    QUOTA_HINT + ' (modelo: gemini-4-argon)'
  );
  assert.equal(hintFor('{"code":429,"status":"RESOURCE_EXHAUSTED"}'), QUOTA_HINT);
  assert.equal(hintFor('This model is currently experiencing high demand. (503 UNAVAILABLE)'), BUSY_HINT);
  assert.equal(hintFor('IneligibleTierError: This client is no longer supported'), BLOCKED_LOGIN_HINT);
  assert.equal(hintFor('outra coisa'), 'outra coisa');
});
