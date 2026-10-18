const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { WebSocket } = require('ws');
const { createBus } = require('../electron/events.cjs');
const { createLimiter } = require('../electron/remote/limiter.cjs');
const { Pairing, Devices, hashToken, safeEqualHex, newCode, newToken } = require('../electron/remote/tokens.cjs');
const { createCoalescer } = require('../electron/remote/coalesce.cjs');
const { ALLOWED, validateArgs, isAllowed, RemoteError } = require('../electron/remote/allowlist.cjs');
const san = require('../electron/remote/sanitize.cjs');
const net = require('../electron/remote/net.cjs');
const tailscale = require('../electron/remote/tailscale.cjs');
const { createHub } = require('../electron/remote/hub.cjs');
const { createRemoteServer } = require('../electron/remote/server.cjs');
const { createMethods } = require('../electron/methods.cjs');
const { remoteMethods, normalizeRemote } = require('../electron/remote/index.cjs');

// ---- tokens & pairing --------------------------------------------------------------------------------------------
test('codes and tokens carry enough entropy and are unique', () => {
  const codes = new Set(Array.from({ length: 50 }, newCode)),
    tokens = new Set(Array.from({ length: 50 }, newToken));
  assert.equal(codes.size, 50);
  assert.equal(tokens.size, 50);
  assert.ok(Buffer.from(newCode(), 'base64url').length >= 16); // >= 128 bits
  assert.ok(Buffer.from(newToken(), 'base64url').length >= 32); // >= 256 bits
});

test('pairing code is single use', () => {
  const p = new Pairing();
  const { code } = p.create();
  assert.equal(p.redeem('outro'), false);
  assert.equal(p.redeem(code), true);
  assert.equal(p.redeem(code), false);
});

test('pairing code expires after 5 minutes', () => {
  let t = 1000;
  const p = new Pairing({ now: () => t });
  const { code, expiresAt } = p.create();
  assert.equal(expiresAt, 1000 + 5 * 60 * 1000);
  t += 5 * 60 * 1000 - 1;
  assert.equal(p.size, 1);
  t += 2;
  assert.equal(p.redeem(code), false);
  assert.equal(p.size, 0);
});

test('only a few pairing codes stay open at once (the oldest is dropped)', () => {
  const p = new Pairing();
  const first = p.create().code;
  for (let i = 0; i < 5; i++) p.create();
  assert.equal(p.size, 5);
  assert.equal(p.redeem(first), false);
});

test('devices store only the token hash and authenticate by it', () => {
  const list = [];
  let saves = 0;
  const d = new Devices({ list: () => list, save: () => saves++ });
  const { device, token } = d.add('  Pixel <b>8</b> ');
  assert.equal(device.name, 'Pixel b8/b');
  assert.equal(list[0].tokenHash, hashToken(token));
  assert.ok(!JSON.stringify(list).includes(token));
  assert.ok(!('tokenHash' in device));
  assert.equal(d.authenticate(token).id, device.id);
  assert.equal(d.authenticate(token + 'x'), null);
  assert.equal(d.authenticate(''), null);
  assert.equal(d.authenticate(undefined), null);
  assert.equal(d.authenticate('a'.repeat(300)), null);
  assert.ok(saves >= 1);
});

test('revoked and renamed devices', () => {
  const list = [];
  const d = new Devices({ list: () => list, save: () => {} });
  const a = d.add('A'),
    b = d.add('B');
  assert.equal(d.rename(a.device.id, 'Casa'), true);
  assert.equal(list[0].name, 'Casa');
  assert.equal(d.revoke(a.device.id), true);
  assert.equal(d.authenticate(a.token), null);
  assert.equal(d.authenticate(b.token).id, b.device.id);
  assert.equal(d.revoke('nope'), false);
});

test('constant-time comparison helper', () => {
  const h = hashToken('x');
  assert.equal(safeEqualHex(h, hashToken('x')), true);
  assert.equal(safeEqualHex(h, hashToken('y')), false);
  assert.equal(safeEqualHex(h, 'abcd'), false);
  assert.equal(safeEqualHex('', ''), false);
});

// ---- rate limit --------------------------------------------------------------------------------------------------
test('limiter blocks an IP after too many failures, then releases it', () => {
  let t = 0;
  const l = createLimiter({ max: 3, windowMs: 1000, blockMs: 5000, now: () => t });
  assert.equal(l.check('1.1.1.1').allowed, true);
  l.fail('1.1.1.1');
  l.fail('1.1.1.1');
  assert.equal(l.check('1.1.1.1').allowed, true);
  l.fail('1.1.1.1');
  const blocked = l.check('1.1.1.1');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 5000);
  assert.equal(l.check('2.2.2.2').allowed, true);
  t = 5001;
  assert.equal(l.check('1.1.1.1').allowed, true);
});

test('limiter forgets old failures and can be reset', () => {
  let t = 0;
  const l = createLimiter({ max: 2, windowMs: 1000, blockMs: 5000, now: () => t });
  l.fail('a');
  t = 1500;
  l.fail('a');
  assert.equal(l.check('a').allowed, true);
  l.fail('a');
  assert.equal(l.check('a').allowed, false);
  l.reset('a');
  assert.equal(l.check('a').allowed, true);
});

// ---- coalescer ---------------------------------------------------------------------------------------------------
test('coalescer joins consecutive text deltas of one message and keeps the order of the rest', () => {
  const out = [];
  let fire = null;
  const c = createCoalescer({
    onFlush: (b) => out.push(b),
    setTimer: (fn) => ((fire = fn), { unref() {} }),
    clearTimer: () => (fire = null),
  });
  c.push({ type: 'text', chatId: 'c', messageId: 'm', text: 'Olá' });
  c.push({ type: 'text', chatId: 'c', messageId: 'm', text: ', ' });
  c.push({ type: 'text', chatId: 'c', messageId: 'm', text: 'mundo' });
  c.push({ type: 'activity', chatId: 'c', messageId: 'm', activity: { label: 'x' } });
  c.push({ type: 'text', chatId: 'c', messageId: 'm', text: '!' });
  c.push({ type: 'text', chatId: 'c', messageId: 'other', text: '?' });
  assert.equal(out.length, 0);
  fire();
  assert.equal(out.length, 1);
  assert.deepEqual(
    out[0].map((e) => e.type + ':' + (e.text ?? '')),
    ['text:Olá, mundo', 'activity:', 'text:!', 'text:?']
  );
});

test('coalescer: urgent events flush the queue at once, in order; the source event is not mutated', () => {
  const out = [];
  const c = createCoalescer({ onFlush: (b) => out.push(b), setTimer: () => ({ unref() {} }), clearTimer() {} });
  const first = { type: 'text', chatId: 'c', messageId: 'm', text: 'a' };
  c.push(first);
  c.push({ type: 'text', chatId: 'c', messageId: 'm', text: 'b' });
  c.push({ type: 'permission', chatId: 'c' }, { urgent: true });
  assert.equal(out.length, 1);
  assert.deepEqual(
    out[0].map((e) => e.text ?? e.type),
    ['ab', 'permission']
  );
  assert.equal(first.text, 'a');
  assert.equal(c.size, 0);
});

// ---- allowlist ---------------------------------------------------------------------------------------------------
test('allowlist contains exactly the intended operations', () => {
  assert.deepEqual(Object.keys(ALLOWED).sort(), [
    'answerPermission',
    'bootstrap',
    'cancelQuest',
    'createChat',
    'createQuest',
    'pauseQuest',
    'refreshUsage',
    'replan',
    'resumeQuest',
    'retryStep',
    'send',
    'skipStep',
    'startQuest',
    'stop',
    'stopTask',
    'updateChat',
    'usage',
  ]);
});

test('every desktop-only method is refused with 403', () => {
  const desktop = Object.keys({ ...createMethods({}), ...remoteMethods({}) }).filter((n) => !isAllowed(n));
  for (const forbidden of [
    'addProject',
    'openData',
    'openTerminal',
    'openProject',
    'openInstructions',
    'window',
    'saveSettings',
    'deleteChat',
    'deleteMemory',
    'saveMemory',
    'searchMemory',
    'exportChat',
    'checkUpdates',
    'openLink',
    'remoteConfigure',
    'remotePairing',
    'remoteRevokeDevice',
    'remoteStatus',
    'deleteQuest',
    'updateQuest',
    'renameChat',
    'switchProvider',
  ])
    assert.ok(desktop.includes(forbidden), forbidden + ' should be a desktop method');
  assert.ok(desktop.length > 20);
  for (const name of [...desktop, 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'nope', '']) {
    assert.equal(isAllowed(name), false, name);
    assert.throws(
      () => validateArgs(name, {}),
      (e) => e instanceof RemoteError && e.status === 403,
      name
    );
  }
  assert.equal(isAllowed(undefined), false);
  assert.equal(isAllowed({ toString: () => 'send' }), false);
});

test('argument validation: required, types, sizes; unknown fields are dropped', () => {
  assert.deepEqual(validateArgs('send', { chatId: 'abc-1', text: 'oi', extra: 1, __proto__: { x: 1 } }), {
    chatId: 'abc-1',
    text: 'oi',
  });
  const code = (fn) => {
    try {
      fn();
    } catch (e) {
      return e.status;
    }
  };
  assert.equal(
    code(() => validateArgs('send', { chatId: 'a' })),
    400
  );
  assert.equal(
    code(() => validateArgs('send', { chatId: 'a', text: '   ' })),
    400
  );
  assert.equal(
    code(() => validateArgs('send', { chatId: 'a', text: 'x'.repeat(50001) })),
    400
  );
  assert.equal(
    code(() => validateArgs('send', { chatId: '../etc', text: 'x' })),
    400
  );
  assert.equal(
    code(() => validateArgs('send', { chatId: 5, text: 'x' })),
    400
  );
  assert.equal(
    code(() => validateArgs('send', [])),
    400
  );
  assert.equal(
    code(() => validateArgs('send', 'x')),
    400
  );
  assert.equal(
    code(() => validateArgs('answerPermission', { id: 'p', decision: 'maybe' })),
    400
  );
  assert.deepEqual(validateArgs('answerPermission', { id: 'p', decision: 'deny' }), { id: 'p', decision: 'deny' });
  assert.equal(
    code(() => validateArgs('createChat', { provider: 'rm -rf' })),
    400
  );
  assert.deepEqual(validateArgs('createChat', { provider: 'claude', projectId: null, mode: 'ask' }), {
    provider: 'claude',
    projectId: null,
    mode: 'ask',
  });
  assert.equal(
    code(() => validateArgs('updateChat', { id: 'a', mode: 'root' })),
    400
  );
  assert.equal(
    code(() => validateArgs('createQuest', { title: 'x', maxParallel: 99 })),
    400
  );
  assert.equal(
    code(() => validateArgs('createQuest', { title: 'x', steps: { a: 1 } })),
    400
  );
  assert.equal(
    code(() => validateArgs('createQuest', { title: 'x', steps: [{ t: 'y'.repeat(200000) }] })),
    400
  );
  assert.deepEqual(validateArgs('usage', undefined), {});
  assert.deepEqual(validateArgs('refreshUsage', { force: true }), { force: true });
  assert.equal(
    code(() => validateArgs('refreshUsage', { force: 'yes' })),
    400
  );
});

// ---- sanitizing --------------------------------------------------------------------------------------------------
const fakeState = () => ({
  settings: { theme: 'obsidian', accent: 'ember', fontScale: 1, memoryEnabled: true },
  projects: [{ id: 'p1', name: 'Proj', path: 'C:\\segredo\\proj' }],
  chats: [
    {
      id: 'c1',
      title: 'Um',
      provider: 'claude',
      model: '',
      mode: 'edit',
      projectId: 'p1',
      sessionId: 'SESSION-SECRET',
      permissionRules: ['cmd:npm'],
      handoffPending: false,
      memory: true,
      createdAt: 1,
      updatedAt: 2,
      messages: Array.from({ length: 100 }, (_, i) => ({ id: 'm' + i, role: 'user', text: 't' + i })),
    },
  ],
  memories: [{ id: 'n', path: 'preferences/n.md', title: 'Segredo', body: 'corpo' }],
  quests: [{ id: 'q', title: 'Q', steps: [] }],
  usage: { rateLimit: {}, daily: {} },
  remote: { enabled: true, devices: [{ id: 'd', tokenHash: 'HASH' }] },
  running: ['c1'],
  appVersion: '1',
});
test('sanitized state leaks no internal paths, session ids, memories or device hashes', () => {
  const out = san.sanitizeState(fakeState());
  const text = JSON.stringify(out);
  for (const secret of ['segredo', 'SESSION-SECRET', 'preferences/n.md', 'Segredo', 'HASH', 'cmd:npm', 'memoryEnabled'])
    assert.ok(!text.includes(secret), secret);
  assert.deepEqual(out.projects, [{ id: 'p1', name: 'Proj' }]);
  assert.equal(out.chats[0].messages.length, san.MAX_MESSAGES);
  assert.equal(out.chats[0].hiddenMessages, 100 - san.MAX_MESSAGES);
  assert.equal(out.chats[0].messages.at(-1).id, 'm99');
  assert.deepEqual(out.running, ['c1']);
  assert.equal(out.quests.length, 1);
});
test('integrations are reduced to public facts (no executable paths)', () => {
  const out = san.sanitizeIntegrations({
    claude: {
      id: 'claude',
      installed: true,
      exe: 'C:\\x\\claude.exe',
      version: '2',
      authenticated: true,
      models: ['a'],
    },
  });
  assert.deepEqual(out.claude, { id: 'claude', installed: true, version: '2', authenticated: true, models: ['a'] });
});
test('state differ sends only the chats that changed', () => {
  const state = fakeState();
  state.chats.push({ ...state.chats[0], id: 'c2', messages: [] });
  const differ = san.createStateDiffer();
  const first = differ.diff(state);
  assert.equal(first.chats.length, 2);
  assert.deepEqual(first.chatIds, ['c1', 'c2']);
  const same = differ.diff(state);
  assert.equal(same.chats.length, 0);
  assert.deepEqual(same.chatIds, ['c1', 'c2']);
  state.chats[1].messages.push({ id: 'z', role: 'assistant', text: 'abc', status: 'running' });
  assert.deepEqual(
    differ.diff(state).chats.map((c) => c.id),
    ['c2']
  );
  state.chats[1].messages.at(-1).text += 'def';
  assert.deepEqual(
    differ.diff(state).chats.map((c) => c.id),
    ['c2']
  );
});

// ---- network helpers ---------------------------------------------------------------------------------------------
test('interface detection: only a trusted source counts as Tailscale (CLI, or an interface named Tailscale)', () => {
  assert.equal(net.isTailscaleIp('100.64.0.1'), true);
  assert.equal(net.isTailscaleIp('100.127.255.254'), true);
  assert.equal(net.isTailscaleIp('100.128.0.1'), false);
  assert.equal(net.isTailscaleIp('100.63.0.1'), false);
  assert.equal(net.isTailscaleIp('nope'), false);
  const ifaces = {
    Ethernet: [{ family: 'IPv4', address: '192.168.0.12', internal: false }],
    Tailscale: [{ family: 'IPv4', address: '100.101.102.103', internal: false }],
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  };
  const a = net.detectAddresses(ifaces);
  assert.deepEqual(a, { tailscale: '100.101.102.103' });
  assert.equal(net.defaultBind(a), 'tailscale');
  assert.equal(net.defaultBind({ tailscale: null }), 'localhost');
  assert.deepEqual(net.BINDS, ['tailscale', 'localhost']); // no LAN mode
  for (const bind of net.BINDS) {
    const r = net.resolveBind(bind, a);
    assert.ok(r.hosts.length > 0 && !r.hosts.includes('0.0.0.0') && !r.hosts.includes('::'), bind);
  }
  assert.deepEqual(net.resolveBind('tailscale', a).hosts, ['100.101.102.103', '127.0.0.1']);
  assert.ok(net.resolveBind('tailscale', { tailscale: null }).error);
  assert.ok(net.resolveBind('lan', { lan: '192.168.0.12' }).error, 'LAN no longer exists');
  assert.ok(net.resolveBind('0.0.0.0', a).error);
});
test('Tailscale detection never trusts a bare 100.64/10 address (WSL, Docker, carrier NAT)', () => {
  const cgnat = (name) => ({ [name]: [{ family: 'IPv4', address: '100.100.1.2', internal: false }] });
  for (const name of ['vEthernet (WSL)', 'docker0', 'Wi-Fi', 'Ethernet 2', 'wwan0'])
    assert.deepEqual(net.detectAddresses(cgnat(name)), { tailscale: null }, name);
  // a Tailscale-named interface with a non-CGNAT address or an IPv6 one does not count either
  assert.deepEqual(net.detectAddresses({ Tailscale: [{ family: 'IPv4', address: '192.168.1.5', internal: false }] }), {
    tailscale: null,
  });
  assert.deepEqual(net.detectAddresses(cgnat('tailscale0')), { tailscale: '100.100.1.2' });
});
test('Tailscale detection with the CLI: its answer is final', () => {
  const docker = { eth0: [{ family: 'IPv4', address: '100.90.0.1', internal: false }] };
  const ok = { installed: true, running: true, ips: ['fd7a:115c:a1e0::1', '100.80.1.2'] };
  assert.deepEqual(net.detectAddresses(docker, ok), { tailscale: '100.80.1.2' });
  // CLI present but stopped / logged out / without a CGNAT IPv4: no address, whatever the interfaces say
  assert.deepEqual(net.detectAddresses(docker, { ...ok, running: false }), { tailscale: null });
  assert.deepEqual(net.detectAddresses(docker, { ...ok, ips: ['192.168.1.2'] }), { tailscale: null });
  assert.deepEqual(
    net.detectAddresses(
      { Tailscale: [{ family: 'IPv4', address: '100.70.0.1', internal: false }] },
      { installed: true }
    ),
    { tailscale: null }
  );
  // no CLI: the interface-name rule applies
  assert.deepEqual(net.detectAddresses(docker, { installed: false }), { tailscale: null });
});
test('host header guard accepts IPs, localhost and ts.net only', () => {
  for (const ok of ['127.0.0.1:47900', 'localhost', '100.1.2.3:1', 'pc.tail1234.ts.net', '[::1]:5'])
    assert.equal(net.hostAllowed(ok), true, ok);
  for (const bad of ['evil.com', 'evil.com:80', 'x.ts.net.evil.com', '', undefined, 'a'.repeat(300)])
    assert.equal(net.hostAllowed(bad), false, String(bad));
  assert.equal(net.validPort(47900), true);
  assert.equal(net.validPort(80), false);
  assert.equal(net.validPort('47900'), false);
});
test('remote config is normalized', () => {
  const n = normalizeRemote({
    enabled: 'yes',
    bind: '0.0.0.0',
    port: 5,
    devices: [{ id: 1 }, { id: 'a', tokenHash: 'h' }],
  });
  assert.equal(n.enabled, false);
  assert.equal(n.bind, null);
  assert.equal(n.port, 47900);
  assert.equal(n.devices.length, 1);
  assert.equal(normalizeRemote(undefined).enabled, false);
});

// ---- tailscale ---------------------------------------------------------------------------------------------------
test('tailscale: CLI lookup, status parsing and the serve command (never executed here)', async () => {
  assert.equal(tailscale.findCli({ env: { PATH: '' }, exists: () => false, platform: 'win32' }), null);
  const exe = tailscale.findCli({
    env: { PATH: 'C:\\bin' },
    exists: (f) => f.endsWith('tailscale.exe') && f.startsWith('C:\\bin'),
    platform: 'win32',
  });
  assert.ok(exe.endsWith('tailscale.exe'));
  assert.deepEqual(tailscale.serveArgs(47900), ['serve', '--bg', '--https=443', 'http://127.0.0.1:47900']);
  assert.deepEqual(tailscale.unserveArgs(), ['serve', '--https=443', 'off']);
  const parsed = tailscale.parseStatus({
    BackendState: 'Running',
    Self: { DNSName: 'pc.tail1.ts.net.', TailscaleIPs: ['100.1.1.1'] },
  });
  assert.deepEqual(parsed.running, true);
  assert.equal(parsed.dnsName, 'pc.tail1.ts.net');
  const serving = { Web: { 'pc.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:47900' } } } } };
  assert.equal(tailscale.parseServe(serving, 47900), 'https://pc.tail1.ts.net');
  assert.equal(tailscale.parseServe(serving, 5000), null);
  assert.equal(tailscale.parseServe('not json', 47900), null);
  const calls = [];
  const exec = async (e, args) => {
    calls.push(args.join(' '));
    return args[0] === 'status'
      ? JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.t.ts.net.', TailscaleIPs: ['100.99.9.9'] } })
      : JSON.stringify(serving);
  };
  const st = await tailscale.status({ port: 47900, exe: 'x', exec });
  assert.equal(st.installed, true);
  assert.equal(st.running, true);
  assert.equal(st.serving, true);
  assert.equal(st.serveState, 'ours');
  assert.deepEqual(st.ips, ['100.99.9.9']);
  assert.equal(st.httpsUrl, 'https://pc.tail1.ts.net');
  assert.deepEqual(calls, ['status --json', 'serve status --json']);
  assert.deepEqual(await tailscale.status({ port: 1, exe: null }), {
    installed: false,
    running: false,
    serving: false,
    httpsUrl: null,
  });
});

test('hub relays only allowed events, batched, and flags slow sockets for a resync', () => {
  const bus = createBus();
  const timers = [];
  const hub = createHub({
    bus,
    getState: () => fakeState(),
    differ: san.createStateDiffer(),
    maxBuffered: 100,
    setTimer: (fn) => (timers.push(fn), { unref() {} }),
    clearTimer() {},
  });
  hub.start();
  const fast = {
    deviceId: 'f',
    sent: [],
    send(t) {
      this.sent.push(JSON.parse(t));
    },
    buffered: () => 0,
  };
  let backlog = 1000;
  const slow = {
    deviceId: 's',
    sent: [],
    send(t) {
      this.sent.push(JSON.parse(t));
    },
    buffered: () => backlog,
  };
  hub.add(fast);
  hub.add(slow);
  bus.emit({ type: 'update', status: 'downloading' }); // desktop only
  bus.emit({ type: 'text', chatId: 'c1', messageId: 'm', text: 'a' });
  bus.emit({ type: 'text', chatId: 'c1', messageId: 'm', text: 'b' });
  assert.equal(fast.sent.length, 0);
  timers.pop()();
  assert.equal(fast.sent.length, 1);
  assert.deepEqual(fast.sent[0].events, [{ type: 'text', chatId: 'c1', messageId: 'm', text: 'ab' }]);
  assert.equal(slow.sent.length, 0); // too slow: dropped, marked stale
  backlog = 10;
  bus.emit({ type: 'permission', chatId: 'c1', permission: { id: 'p' } });
  assert.equal(slow.sent[0].t, 'resync');
  assert.equal(slow.sent[1].events[0].type, 'permission');
  bus.emit({ type: 'state', state: fakeState() });
  const st = fast.sent.at(-1).events[0];
  assert.equal(st.type, 'state');
  assert.equal(st.partial, true);
  assert.ok(!JSON.stringify(st).includes('SESSION-SECRET'));
  hub.stop();
  bus.emit({ type: 'permission', chatId: 'c1' });
  assert.equal(fast.sent.length, 3);
});

// ---- the real server (HTTP + WebSocket on localhost, stubbed dispatch) -------------------------------------------
async function startServer(extra = {}) {
  const bus = createBus();
  const list = [];
  const devices = new Devices({ list: () => list, save: () => {} });
  const pairing = new Pairing();
  const hub = createHub({ bus, getState: () => fakeState(), differ: san.createStateDiffer() });
  hub.start();
  const calls = [],
    logs = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-static-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>m</title>' + 'x'.repeat(2000));
  fs.writeFileSync(path.join(root, 'assets', 'a.js'), 'console.log(1)');
  fs.writeFileSync(path.join(path.dirname(root), 'vesta-secret.txt'), 'segredo');
  const server = createRemoteServer({
    devices,
    pairing,
    hub,
    staticRoot: root,
    dispatch: async (name, args) => (calls.push([name, args]), { ok: true }),
    confirmPairing: async () => 'yes',
    log: (...a) => logs.push(a.join(' ')),
    ...extra,
  });
  const port = await server.listen(['127.0.0.1'], 0);
  const base = 'http://127.0.0.1:' + port;
  const post = (p, body, headers = {}) =>
    fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const pair = async (name = 'Teste') => {
    const { code } = pairing.create();
    const r = await post('/api/pair', { code, name });
    return { r, ...(r.ok ? await r.json() : {}) };
  };
  const call = (token, method, args) =>
    post('/api/call', { method, args }, token ? { Authorization: 'Bearer ' + token } : {});
  return {
    bus,
    hub,
    server,
    devices,
    pairing,
    calls,
    logs,
    base,
    port,
    root,
    post,
    pair,
    call,
    list,
    async close() {
      await server.close();
      hub.stop();
    },
  };
}

test('server: pairing flow, auth, allowlist and validation over real HTTP', async () => {
  const s = await startServer();
  try {
    // no token -> 401 (even for a forbidden method), wrong token -> 401
    assert.equal((await s.call(null, 'send', { chatId: 'a', text: 'x' })).status, 401);
    assert.equal((await s.call(null, 'addProject')).status, 401);
    assert.equal((await s.call('x'.repeat(43), 'usage')).status, 401);
    // pairing: wrong code refused, right code works once
    assert.equal((await s.post('/api/pair', { code: 'nope', name: 'x' })).status, 401);
    const { code } = s.pairing.create();
    const ok = await s.post('/api/pair', { code, name: 'Meu celular' });
    assert.equal(ok.status, 200);
    const { token, device } = await ok.json();
    assert.ok(token.length >= 43);
    assert.equal(device.name, 'Meu celular');
    assert.equal((await s.post('/api/pair', { code, name: 'Outro' })).status, 401, 'code reuse');
    assert.equal(s.list.length, 1);
    assert.ok(!JSON.stringify(s.list).includes(token));
    // authorized call goes through, with cleaned arguments
    const good = await s.call(token, 'send', { chatId: 'c1', text: 'olá', evil: true });
    assert.equal(good.status, 200);
    assert.deepEqual(s.calls.at(-1), ['send', { chatId: 'c1', text: 'olá' }]);
    assert.deepEqual((await good.json()).result, { ok: true });
    // forbidden methods -> 403 and never dispatched
    const before = s.calls.length;
    for (const m of [
      'addProject',
      'openData',
      'openTerminal',
      'saveSettings',
      'deleteChat',
      'exportChat',
      'checkUpdates',
      'remoteConfigure',
      'nope',
      '__proto__',
    ])
      assert.equal((await s.call(token, m, {})).status, 403, m);
    assert.equal((await s.post('/api/call', {}, { Authorization: 'Bearer ' + token })).status, 403);
    assert.equal(s.calls.length, before);
    // invalid args -> 400
    assert.equal((await s.call(token, 'send', { chatId: 'c1' })).status, 400);
    assert.equal((await s.call(token, 'send', { chatId: 'c1', text: 'x'.repeat(60000) })).status, 400);
    // token is not accepted from the query string or other places
    assert.equal(
      (
        await fetch(s.base + '/api/call?token=' + token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"method":"usage"}',
        })
      ).status,
      401
    );
    // wrong content type / method / size
    assert.equal(
      (
        await fetch(s.base + '/api/call', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain' },
          body: '{}',
        })
      ).status,
      415
    );
    assert.equal((await fetch(s.base + '/api/call', { headers: { Authorization: 'Bearer ' + token } })).status, 405);
    assert.equal(
      (
        await s
          .post('/api/call', 'x'.repeat(300 * 1024), { Authorization: 'Bearer ' + token })
          .catch(() => ({ status: 413 }))
      ).status,
      413
    );
    assert.equal((await s.post('/api/call', '{bad', { Authorization: 'Bearer ' + token })).status, 400);
    // revoked token stops working at once
    s.devices.revoke(device.id);
    assert.equal((await s.call(token, 'usage')).status, 401);
  } finally {
    await s.close();
  }
});

test('server: pairing and bad-token attempts are rate limited per IP', async () => {
  let t = 0;
  const s = await startServer({
    pairLimiter: createLimiter({ max: 3, blockMs: 60000, now: () => t }),
    authLimiter: createLimiter({ max: 3, blockMs: 60000, now: () => t }),
  });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await s.post('/api/pair', { code: 'x' + i })).status, 401);
    const blocked = await s.post('/api/pair', { code: 'y' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    // even a valid code is refused while blocked
    const { code } = s.pairing.create();
    assert.equal((await s.post('/api/pair', { code })).status, 429);
    for (let i = 0; i < 3; i++) assert.equal((await s.call('z'.repeat(43), 'usage')).status, 401);
    assert.equal((await s.call('z'.repeat(43), 'usage')).status, 429);
    t = 61000; // block over
    assert.equal((await s.post('/api/pair', { code })).status, 200);
  } finally {
    await s.close();
  }
});

test('server: security headers, host and origin checks, static files and traversal', async () => {
  const s = await startServer();
  try {
    const r = await fetch(s.base + '/', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.status, 200);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.ok(!csp.includes('unsafe-eval') && !/script-src[^;]*unsafe-inline/.test(csp));
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.match(await r.text(), /<title>m<\/title>/);
    assert.equal(
      (await fetch(s.base + '/assets/a.js')).headers.get('cache-control'),
      'public, max-age=31536000, immutable'
    );
    // traversal and odd paths never leave the folder
    for (const p of [
      '/../vesta-secret.txt',
      '/%2e%2e/vesta-secret.txt',
      '/..%2fvesta-secret.txt',
      '/assets/..%5c..%5cvesta-secret.txt',
      '/vesta.json',
      '/%00',
    ])
      assert.ok([400, 403, 404].includes((await fetch(s.base + p)).status), p);
    const raw = await new Promise((resolve) => {
      const sock = require('node:net').connect(s.port, '127.0.0.1', () =>
        sock.write('GET /../vesta-secret.txt HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
      );
      let d = '';
      sock.on('data', (x) => (d += x));
      sock.on('close', () => resolve(d));
    });
    assert.ok(!raw.includes('segredo'));
    // DNS rebinding: a foreign Host is refused
    const rebinding = await new Promise((resolve) => {
      const req = require('node:http').request(
        { host: '127.0.0.1', port: s.port, path: '/', headers: { Host: 'evil.example.com' } },
        (res) => resolve(res.statusCode)
      );
      req.end();
    });
    assert.equal(rebinding, 421);
    // cross-origin requests are refused (CORS stays closed)
    assert.equal((await s.post('/api/pair', { code: 'x' }, { Origin: 'https://evil.example.com' })).status, 403);
    assert.equal((await fetch(s.base + '/', { headers: { Origin: 'https://evil.example.com' } })).status, 403);
    assert.equal((await fetch(s.base + '/', { method: 'OPTIONS' })).status, 405);
    assert.equal((await fetch(s.base + '/', { method: 'DELETE' })).status, 405);
  } finally {
    await s.close();
  }
});

const wsOpen = (url, headers) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.messages = [];
    ws.on('message', (m) => ws.messages.push(JSON.parse(m.toString())));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', (_, res) =>
      reject(Object.assign(new Error('http ' + res.statusCode), { status: res.statusCode }))
    );
  });
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
};

test('websocket: first-message auth, batched events, revocation, bad auth', async () => {
  const s = await startServer();
  try {
    const { token, device } = await s.pair();
    const wsUrl = 'ws://127.0.0.1:' + s.port + '/ws';
    // a token in the URL is meaningless: still needs the auth message
    const lazy = await wsOpen(wsUrl + '?token=' + token);
    const closed = new Promise((r) => lazy.on('close', (code) => r(code)));
    lazy.send(JSON.stringify({ t: 'auth', token: 'wrong'.repeat(10) }));
    assert.equal(await closed, 4401);
    assert.equal(s.hub.size, 0);
    // good auth
    const ws = await wsOpen(wsUrl);
    ws.send(JSON.stringify({ t: 'auth', token }));
    await until(() => ws.messages.find((m) => m.t === 'ready'));
    assert.equal(s.hub.size, 1);
    // events arrive batched
    for (const part of ['Olá', ', ', 'mundo']) s.bus.emit({ type: 'text', chatId: 'c1', messageId: 'm', text: part });
    s.bus.emit({ type: 'update', status: 'x' });
    const batch = await until(() => ws.messages.find((m) => m.t === 'events'));
    assert.deepEqual(batch.events, [{ type: 'text', chatId: 'c1', messageId: 'm', text: 'Olá, mundo' }]);
    s.bus.emit({ type: 'permission', chatId: 'c1', messageId: 'm', permission: { id: 'p1', status: 'pending' } });
    await until(() => ws.messages.some((m) => m.events?.[0]?.type === 'permission'));
    // ping -> heartbeat
    ws.send(JSON.stringify({ t: 'ping' }));
    await until(() => ws.messages.find((m) => m.t === 'hb'));
    // revoking the device closes its socket
    const gone = new Promise((r) => ws.on('close', (code) => r(code)));
    s.server.closeDevice(device.id);
    assert.equal(await gone, 4403);
    await until(() => s.hub.size === 0);
    // forbidden origin and wrong path never upgrade
    await assert.rejects(wsOpen(wsUrl, { Origin: 'https://evil.example.com' }), (e) => e.status === 403);
    await assert.rejects(wsOpen('ws://127.0.0.1:' + s.port + '/other'), (e) => e.status === 404);
    // oversize messages are refused by the server
    const big = await wsOpen(wsUrl);
    const bigClosed = new Promise((r) => big.on('close', (code) => r(code)));
    big.send('x'.repeat(10000));
    assert.equal(await bigClosed, 1009);
  } finally {
    await s.close();
  }
});

test('websocket: no auth within the timeout closes the socket', async () => {
  const s = await startServer();
  try {
    const ws = await wsOpen('ws://127.0.0.1:' + s.port + '/ws');
    const code = await new Promise((r) => ws.on('close', (c) => r(c)));
    assert.equal(code, 4401);
  } finally {
    await s.close();
  }
});

// ---- integration with the store and the desktop state ------------------------------------------------------------
test('remote control is off by default and its device hashes never reach the desktop renderer', () => {
  const { Store } = require('../electron/store.cjs');
  const { createContext } = require('../electron/context.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-store-'));
  const store = new Store(dir);
  assert.equal(store.state.remote.enabled, false);
  assert.equal(store.state.remote.port, 47900);
  store.state.remote.devices.push({ id: 'd', name: 'x', tokenHash: 'SECRET-HASH', createdAt: 1, lastSeenAt: 1 });
  store.save();
  const ctx = createContext({
    app: { getVersion: () => '1', getPath: () => dir },
    dialog: {},
    shell: {},
    bus: createBus(),
  });
  ctx.store = store;
  assert.ok(!('remote' in ctx.state()));
  assert.ok(!JSON.stringify(ctx.state()).includes('SECRET-HASH'));
  // the config survives a restart, normalized
  assert.equal(new Store(dir).state.remote.devices[0].tokenHash, 'SECRET-HASH');
});
