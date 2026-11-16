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
  assert.ok(cards.some((c) => c.id === 'tc2' && c.kind === 'memory' && c.label === 'Memória · memory_write_page'));
  assert.deepEqual(
    of(events, 'memory-write').map((w) => w.path),
    ['notas/x.md']
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

test('without a login the turn fails with how to log in', async () => {
  const { res, events } = await turn({ mode: 'auth' });
  assert.notEqual(res.code, 0);
  assert.match(of(events, 'provider-error')[0].message, /Login with Google/);
});

test('launch: node + script, flags per mode, MCP servers in session/new (token never on the line), privacy file', () => {
  const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-gem-')), 'gemini.js');
  fs.writeFileSync(script, '');
  const endpoint = { mcp: 'http://127.0.0.1:9/mcp', token: 'segredo-123' };
  const spec = (chat) => providers.command({ provider: 'gemini', ...chat }, script, endpoint);
  const ask = spec({ mode: 'ask', model: 'gemini-2.5-pro' });
  assert.equal(ask.args[0], script);
  assert.ok(ask.args.includes('--acp') && ask.args.includes('--skip-trust') && ask.args.includes('--policy'));
  assert.ok(!ask.args.includes('--approval-mode'), 'ask = the CLI default (asks)');
  assert.deepEqual(ask.args.slice(-2), ['--model', 'gemini-2.5-pro']);
  assert.equal(ask.readOnly, false);
  assert.ok(!JSON.stringify(ask.args).includes('segredo-123'));
  assert.deepEqual(ask.mcpServers[0].headers, [{ name: 'Authorization', value: 'Bearer segredo-123' }]);
  assert.ok(spec({ mode: 'edit' }).args.join(' ').includes('--approval-mode yolo'));
  assert.equal(spec({ mode: 'read' }).readOnly, true);
  assert.ok(!spec({ mode: 'ask', model: 'auto' }).args.includes('--model'), '"auto" = the CLI picks');
  const settings = JSON.parse(fs.readFileSync(ask.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, 'utf8'));
  assert.equal(settings.privacy.usageStatisticsEnabled, false);
  assert.equal(settings.telemetry.enabled, false);
  assert.equal(settings.general.enableAutoUpdate, false);
  const policy = fs.readFileSync(ask.args[ask.args.indexOf('--policy') + 1], 'utf8');
  for (const s of gemini.OWN_SERVERS) assert.match(policy, new RegExp('mcpName = "' + s + '"\\ndecision = "allow"'));
  // Native terminal: same script, the chat's session, mode and privacy.
  const t = terminalCommand({ id: 'gemini', exe: script, chat: { mode: 'read', sessionId: 's-1' }, cwd: os.tmpdir() });
  const line = Buffer.from(t.args.at(-1), 'base64').toString('utf16le');
  assert.match(line, /'--resume' 's-1'/);
  assert.match(line, /'--approval-mode' 'plan'/);
  assert.equal(t.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, ask.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH);
});

test('an AI VeSTA does not know never falls into another AI’s path', () => {
  assert.throws(() => drivers.start('mistral', {}, {}), /IA desconhecida/);
  assert.throws(() => providers.parser('mistral', () => {}), /IA desconhecida/);
  assert.throws(() => providers.command({ provider: 'mistral' }, 'x.exe'), /IA desconhecida/);
});

test('login: Google credentials on disk or an API key in the environment', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-gem-home-'));
  assert.equal(gemini.authenticated({}, home), false);
  assert.equal(gemini.authenticated({ GEMINI_API_KEY: 'k' }, home), true);
  fs.mkdirSync(path.join(home, '.gemini'));
  fs.writeFileSync(path.join(home, '.gemini', 'oauth_creds.json'), '{}');
  assert.equal(gemini.authenticated({}, home), true);
});
