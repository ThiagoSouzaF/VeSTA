// Security hardening of the remote control: token expiry, desktop confirmation, default modes, no LAN mode,
// rate limiting behind a proxy, connection budget, Tailscale detection/serve ownership, generic errors, health.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  nodeNet = require('node:net'),
  { EventEmitter } = require('node:events');
const { WebSocket } = require('ws');
const { createBus } = require('../electron/events.cjs');
const { createLimiter } = require('../electron/remote/limiter.cjs');
const { Pairing, Devices, IDLE_TTL_MS, ABSOLUTE_TTL_MS } = require('../electron/remote/tokens.cjs');
const { createConfirmer, autoAnswer } = require('../electron/remote/confirm.cjs');
const { createConnectionGate } = require('../electron/remote/connections.cjs');
const { createHub } = require('../electron/remote/hub.cjs');
const { createRemoteServer } = require('../electron/remote/server.cjs');
const { createRemote, normalizeRemote } = require('../electron/remote/index.cjs');
const { createStateDiffer } = require('../electron/remote/sanitize.cjs');
const { RemoteError } = require('../electron/remote/allowlist.cjs');
const tailscale = require('../electron/remote/tailscale.cjs');

const DAY = 24 * 60 * 60 * 1000;
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
};
const freePort = () =>
  new Promise((resolve) => {
    const s = nodeNet.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

// ---- real server on localhost with a stubbed dispatch --------------------------------------------------------------
async function startServer(extra = {}) {
  const bus = createBus();
  const list = [];
  const clock = { t: 1_000_000 };
  const devices = new Devices({ list: () => list, save: () => {}, now: () => clock.t });
  const pairing = new Pairing();
  const hub = createHub({ bus, getState: () => ({}), differ: createStateDiffer() });
  hub.start();
  const calls = [],
    logs = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-sec-'));
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><title>m</title><script type="module" src="a.js"></script>'
  );
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
  const call = (token, method, args, headers = {}) =>
    post('/api/call', { method, args }, { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers });
  const pair = async (name = 'Teste') => {
    const { code } = pairing.create();
    const r = await post('/api/pair', { code, name });
    return { r, ...(r.ok ? await r.json() : {}) };
  };
  return {
    bus,
    hub,
    server,
    devices,
    pairing,
    calls,
    logs,
    list,
    clock,
    base,
    port,
    post,
    call,
    pair,
    async close() {
      await server.close();
      hub.stop();
    },
  };
}
const wsOpen = (url, headers) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.messages = [];
    ws.on('message', (m) => ws.messages.push(JSON.parse(m.toString())));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });

// ---- 1. token expiry -----------------------------------------------------------------------------------------------
test('device tokens expire after 30 days idle or 180 days absolute; use renews the idle clock', () => {
  assert.equal(IDLE_TTL_MS, 30 * DAY);
  assert.equal(ABSOLUTE_TTL_MS, 180 * DAY);
  let t = 0;
  const list = [];
  const d = new Devices({ list: () => list, save: () => {}, now: () => t });
  const a = d.add('A');
  t += 29 * DAY;
  assert.ok(d.authenticate(a.token), 'still valid after 29 days idle');
  d.touch(list[0]); // implicit renewal of "last seen"
  t += 29 * DAY;
  assert.ok(d.authenticate(a.token), 'the use renewed the idle window');
  assert.equal(d.inspect(a.token).expired, false);
  // idle expiry
  t += 31 * DAY;
  assert.equal(d.authenticate(a.token), null);
  const seen = d.inspect(a.token);
  assert.equal(seen.expired, true);
  assert.ok(seen.device, 'inspect still tells it is a known (expired) device');
  assert.equal(d.view()[0].expired, true);
  // absolute expiry: kept alive by constant use, it still dies 180 days after pairing
  t = 0;
  list.length = 0;
  const b = d.add('B');
  for (let day = 1; day <= 179; day++) {
    t = day * DAY;
    assert.ok(d.authenticate(b.token), 'day ' + day);
    d.touch(list[0]);
  }
  t = 181 * DAY;
  d.touch(list[0]);
  assert.equal(d.authenticate(b.token), null);
});

test('expired devices free their slot when a new one pairs', () => {
  let t = 0;
  const list = [];
  const d = new Devices({ list: () => list, save: () => {}, now: () => t });
  const old = d.add('Velho');
  t += 40 * DAY;
  const fresh = d.add('Novo');
  assert.deepEqual(
    list.map((x) => x.name),
    ['Novo']
  );
  assert.equal(d.inspect(old.token).device, null);
  assert.ok(d.authenticate(fresh.token));
});

test('server: an expired device gets a clear 401 and must pair again; the WebSocket closes with 4410', async () => {
  const s = await startServer();
  try {
    const { token } = await s.pair('Pixel');
    assert.equal((await s.call(token, 'usage')).status, 200);
    s.clock.t += 31 * DAY;
    const r = await s.call(token, 'usage');
    assert.equal(r.status, 401);
    const body = await r.json();
    assert.equal(body.code, 'expired');
    assert.match(body.error, /expirou/);
    assert.match(body.error, /Pareie de novo/);
    const ws = await wsOpen('ws://127.0.0.1:' + s.port + '/ws');
    const closed = new Promise((res) => ws.on('close', (code) => res(code)));
    ws.send(JSON.stringify({ t: 'auth', token }));
    assert.equal(await closed, 4410);
    assert.equal(ws.messages.find((m) => m.t === 'auth').code, 'expired');
    assert.equal(s.hub.size, 0);
    // pairing again works
    const again = await s.pair('Pixel');
    assert.equal((await s.call(again.token, 'usage')).status, 200);
  } finally {
    await s.close();
  }
});

test('server: a socket that stays open past the expiry date is closed at the next heartbeat', async () => {
  const realSetInterval = global.setInterval;
  let tick;
  global.setInterval = (fn) => ((tick = fn), { unref() {} });
  let s;
  try {
    s = await startServer();
  } finally {
    global.setInterval = realSetInterval;
  }
  try {
    const { token } = await s.pair('Pixel');
    const ws = await wsOpen('ws://127.0.0.1:' + s.port + '/ws');
    ws.send(JSON.stringify({ t: 'auth', token }));
    await until(() => ws.messages.find((m) => m.t === 'ready'));
    const closed = new Promise((res) => ws.on('close', (code) => res(code)));
    s.clock.t += 181 * DAY;
    tick();
    assert.equal(await closed, 4410);
  } finally {
    await s.close();
  }
});

// ---- 1. pairing needs a yes on the desktop -------------------------------------------------------------------------
test('pairing: the desktop dialog decides (accepted, refused, timeout) and receives name and IP', async () => {
  const seen = [];
  const answers = ['yes', 'no', 'timeout', 'busy'];
  const s = await startServer({
    confirmPairing: async (req) => (seen.push(req), answers.shift()),
  });
  try {
    const attempt = async (name) => {
      const { code } = s.pairing.create();
      return s.post('/api/pair', { code, name });
    };
    const ok = await attempt('Aceito');
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).token);
    assert.deepEqual(seen[0], { name: 'Aceito', ip: '127.0.0.1' });
    const refused = await attempt('Recusado');
    assert.equal(refused.status, 403);
    assert.match((await refused.json()).error, /recusado no desktop/);
    const slow = await attempt('Lento');
    assert.equal(slow.status, 408);
    assert.match((await slow.json()).error, /não respondeu/);
    assert.equal((await attempt('Cheio')).status, 403);
    assert.deepEqual(
      s.list.map((d) => d.name),
      ['Aceito'],
      'only the accepted device exists'
    );
    // the code is spent whatever the answer was
    const { code } = s.pairing.create();
    assert.equal((await s.post('/api/pair', { code, name: 'x' })).status, 403 /* default answer: undefined */);
    assert.equal((await s.post('/api/pair', { code, name: 'x' })).status, 401);
  } finally {
    await s.close();
  }
});

test('pairing: without a confirmation callback nothing pairs; only one request waits at a time and keeps its code', async () => {
  const s0 = await startServer({ confirmPairing: undefined });
  try {
    assert.equal((await s0.pair()).r.status, 403);
    assert.equal(s0.list.length, 0);
  } finally {
    await s0.close();
  }
  const gate = deferred();
  let asked = 0;
  const s = await startServer({ confirmPairing: async () => (asked++, gate.promise) });
  try {
    const first = s.post('/api/pair', { code: s.pairing.create().code, name: 'Primeiro' });
    await until(() => asked === 1);
    const second = s.pairing.create().code;
    const blocked = await s.post('/api/pair', { code: second, name: 'Segundo' });
    assert.equal(blocked.status, 429);
    assert.equal(asked, 1);
    gate.resolve('yes');
    assert.equal((await first).status, 200);
    // the second phone's code was not spent by the refusal: it works now
    assert.equal(s.pairing.size, 1);
    assert.equal((await s.post('/api/pair', { code: second, name: 'Segundo' })).status, 200);
  } finally {
    await s.close();
  }
});

test('confirmer: native dialog, modal to the window, Recusar is the default, errors and silence refuse', async () => {
  const shown = [];
  const flashed = [];
  const win = { flashFrame: (v) => flashed.push(v), isDestroyed: () => false };
  const mk = (showMessageBox, extra = {}) =>
    createConfirmer({ dialog: { showMessageBox }, getWindow: () => win, env: {}, ...extra });
  const yes = mk(async (w, o) => (shown.push([w, o]), { response: 0 }));
  assert.equal(await yes.confirm({ message: "Autorizar o aparelho 'X' (1.2.3.4) a controlar o VeSTA?" }), 'yes');
  const [parent, options] = shown[0];
  assert.equal(parent, win, 'modal to the main window');
  assert.deepEqual(options.buttons, ['Autorizar', 'Recusar']);
  assert.equal(options.defaultId, 1);
  assert.equal(options.cancelId, 1);
  assert.match(options.message, /Autorizar o aparelho 'X'/);
  assert.deepEqual(flashed, [true]);
  assert.equal(await mk(async () => ({ response: 1 })).confirm({ message: 'm' }), 'no');
  assert.equal(await mk(async () => ({ response: 99 })).confirm({ message: 'm' }), 'no');
  assert.equal(
    await mk(async () => {
      throw new Error('boom');
    }).confirm({ message: 'm' }),
    'no'
  );
  // no window yet: the dialog is shown without a parent
  const noParent = [];
  const orphan = createConfirmer({
    dialog: { showMessageBox: async (...a) => (noParent.push(a.length), { response: 0 }) },
    getWindow: () => null,
    env: {},
  });
  assert.equal(await orphan.confirm({ message: 'm' }), 'yes');
  assert.deepEqual(noParent, [1]);
});

test('confirmer: 2-minute timeout counts as refused and closes the dialog; the queue is serial and bounded', async () => {
  let fire, abort;
  const never = new Promise(() => {});
  const c = createConfirmer({
    dialog: {
      showMessageBox: (w, o) => ((abort = o.signal), never),
    },
    env: {},
    getWindow: () => ({ flashFrame() {}, isDestroyed: () => false }),
    setTimer: (fn, ms) => ((fire = fn), assert.equal(ms, 2 * 60 * 1000), 1),
    clearTimer: () => {},
  });
  const pending = c.confirm({ message: 'm' });
  await until(() => fire);
  fire();
  assert.equal(await pending, 'timeout');
  assert.equal(abort.aborted, true, 'the native dialog is aborted');
  // serial queue + bound
  const order = [],
    gates = [deferred(), deferred(), deferred()];
  let n = 0;
  const q = createConfirmer({
    dialog: {
      showMessageBox: async () => {
        const i = n++;
        order.push('open' + i);
        await gates[i].promise;
        order.push('close' + i);
        return { response: 0 };
      },
    },
    env: {},
    maxQueue: 2,
  });
  const p0 = q.confirm({ message: 'a' }),
    p1 = q.confirm({ message: 'b' });
  assert.equal(await q.confirm({ message: 'c' }), 'busy', 'too many waiting dialogs');
  await until(() => order.length === 1);
  assert.deepEqual(order, ['open0'], 'one dialog at a time');
  gates[0].resolve();
  await p0;
  gates[1].resolve();
  assert.equal(await p1, 'yes');
  assert.deepEqual(order, ['open0', 'close0', 'open1', 'close1']);
});

test('VESTA_TEST_AUTO_CONFIRM answers without UI in tests only; the packaged app ignores it', async () => {
  assert.equal(autoAnswer({ env: { VESTA_TEST_AUTO_CONFIRM: '1' }, isPackaged: false }), 'yes');
  assert.equal(autoAnswer({ env: { VESTA_TEST_AUTO_CONFIRM: 'deny' }, isPackaged: false }), 'no');
  assert.equal(autoAnswer({ env: { VESTA_TEST_AUTO_CONFIRM: 'true' }, isPackaged: false }), null);
  assert.equal(autoAnswer({ env: {}, isPackaged: false }), null);
  for (const v of ['1', 'deny'])
    assert.equal(autoAnswer({ env: { VESTA_TEST_AUTO_CONFIRM: v }, isPackaged: true }), null);
  let dialogCalls = 0;
  const packaged = createConfirmer({
    dialog: { showMessageBox: async () => (dialogCalls++, { response: 1 }) },
    isPackaged: true,
    env: { VESTA_TEST_AUTO_CONFIRM: '1' },
  });
  assert.equal(await packaged.confirm({ message: 'm' }), 'no', 'the real dialog was used and refused');
  assert.equal(dialogCalls, 1);
  const dev = createConfirmer({
    dialog: { showMessageBox: async () => (dialogCalls++, { response: 1 }) },
    isPackaged: false,
    env: { VESTA_TEST_AUTO_CONFIRM: '1' },
  });
  assert.equal(await dev.confirm({ message: 'm' }), 'yes');
  assert.equal(dialogCalls, 1, 'no dialog in test mode');
  // the variable is read in one place only
  const dir = path.join(__dirname, '../electron');
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.cjs'));
  const readers = files.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('VESTA_TEST_AUTO_CONFIRM'));
  assert.deepEqual(
    readers.map((f) => String(f).replace(/\\/g, '/')),
    ['remote/confirm.cjs']
  );
});

// ---- createRemote with a fake desktop ------------------------------------------------------------------------------
// A computer without Tailscale: tests must never run the real CLI of the machine they run on.
const offlineCli = {
  status: async () => ({ installed: false, running: false, serving: false, httpsUrl: null }),
  serve: async () => ({ changed: false }),
  unserve: async () => ({ changed: false }),
};
function fakeDesktop({
  remote = {},
  chats = [],
  quests = [],
  confirmAnswers = [],
  deps = {},
  methodsOverride = {},
} = {}) {
  const bus = createBus();
  const notices = [];
  bus.subscribe((e) => e.type === 'remote-notice' && notices.push(e.message));
  const store = {
    state: { remote, chats, quests },
    saves: 0,
    save() {
      this.saves++;
    },
  };
  const ctx = {
    store,
    bus,
    integrations: { claude: { installed: true } },
    state: () => ({ settings: {}, projects: [], chats: store.state.chats, quests: store.state.quests }),
  };
  const done = [];
  const methods = {
    createChat: async (args) => (done.push(['createChat', args]), { chats: [{ id: 'new', ...args, messages: [] }] }),
    updateChat: async (args) => (done.push(['updateChat', args]), {}),
    createQuest: async (args) => {
      done.push(['createQuest', args]);
      store.state.quests.unshift({
        id: 'q-new',
        title: args.title,
        status: 'draft',
        steps: args.steps.map((s, i) => ({ id: 's' + i, status: 'pending', title: 't' + i, ...s })),
      });
    },
    startQuest: async (args) => done.push(['startQuest', args]),
    resumeQuest: async (args) => done.push(['resumeQuest', args]),
    ...methodsOverride,
  };
  const asked = [];
  const confirm = async (req) => (asked.push(req), confirmAnswers.length ? confirmAnswers.shift() : 'yes');
  const remoteApi = createRemote({
    ctx,
    methods,
    bus,
    staticRoot: os.tmpdir(),
    deps: { confirm, log: () => {}, addresses: () => ({ tailscale: null }), tailscale: offlineCli, ...deps },
  });
  return { remote: remoteApi, ctx, store, methods, done, asked, notices, bus };
}
const phone = { id: 'd1', name: 'Pixel 8' };

test('chats created from a phone are born asking for permission (Drael reads); no prompt for ask/read', async () => {
  const d = fakeDesktop();
  await d.remote.dispatch('createChat', { provider: 'claude' }, { device: phone, ip: '100.64.0.9' });
  await d.remote.dispatch('createChat', { provider: 'codex', mode: 'read' }, { device: phone });
  await d.remote.dispatch('createChat', { provider: 'drael' }, { device: phone });
  assert.deepEqual(
    d.done.map(([, a]) => a.mode),
    ['ask', 'read', 'read']
  );
  assert.equal(d.asked.length, 0);
});

test('full access from a phone needs the desktop: createChat edit, updateChat edit, quest steps in edit', async () => {
  const d = fakeDesktop({
    chats: [
      { id: 'c-ask', title: 'Pedir', mode: 'ask' },
      { id: 'c-edit', title: 'Livre', mode: 'edit' },
    ],
    confirmAnswers: ['yes', 'no', 'timeout', 'yes', 'yes'],
  });
  const ctx = { device: phone, ip: '100.64.0.9' };
  // createChat edit: accepted
  const created = await d.remote.dispatch('createChat', { provider: 'claude', mode: 'edit' }, ctx);
  assert.equal(created.chat.mode, 'edit');
  assert.match(d.asked[0].message, /Pixel 8/);
  assert.match(d.asked[0].message, /100\.64\.0\.9/);
  assert.match(d.asked[0].message, /acesso completo/);
  // updateChat edit: refused -> 403 and the method is not called
  const before = d.done.length;
  await assert.rejects(
    d.remote.dispatch('updateChat', { id: 'c-ask', mode: 'edit' }, ctx),
    (e) => e instanceof RemoteError && e.status === 403 && /recusado no desktop/.test(e.message)
  );
  // timeout -> 403 with its own message
  await assert.rejects(
    d.remote.dispatch('updateChat', { id: 'c-ask', mode: 'edit' }, ctx),
    (e) => e.status === 403 && /não respondeu a tempo/.test(e.message)
  );
  assert.equal(d.done.length, before, 'nothing changed without a yes');
  assert.match(d.asked[1].message, /ao chat "Pedir"/);
  // accepted
  await d.remote.dispatch('updateChat', { id: 'c-ask', mode: 'edit' }, ctx);
  assert.deepEqual(d.done.at(-1), ['updateChat', { id: 'c-ask', mode: 'edit' }]);
  // already in edit, or moving to a safer mode: no prompt
  const asks = d.asked.length;
  await d.remote.dispatch('updateChat', { id: 'c-edit', mode: 'edit' }, ctx);
  await d.remote.dispatch('updateChat', { id: 'c-edit', mode: 'read' }, ctx);
  await d.remote.dispatch('updateChat', { id: 'c-edit', model: 'x' }, ctx);
  assert.equal(d.asked.length, asks);
  // quests: steps without a mode become 'ask'; explicit edit asks
  await d.remote.dispatch('createQuest', { title: 'Q1', steps: [{ title: 'a' }, { title: 'b', mode: 'read' }] }, ctx);
  assert.deepEqual(
    d.done.at(-1)[1].steps.map((s) => s.mode),
    ['ask', 'read']
  );
  assert.equal(d.asked.length, asks, 'no prompt without edit steps');
  await d.remote.dispatch('createQuest', { title: 'Q2', steps: [{ title: 'a', mode: 'edit' }] }, ctx);
  assert.equal(d.asked.length, asks + 1);
  assert.match(d.asked.at(-1).message, /quest "Q2"/);
});

test('quest created with edit steps is approved once; edit steps that appear later (planner) ask at start', async () => {
  const d = fakeDesktop({ confirmAnswers: ['yes', 'no', 'yes'] });
  const ctx = { device: phone, ip: '100.64.0.9' };
  await d.remote.dispatch('createQuest', { title: 'Q', steps: [{ title: 'a', mode: 'edit' }] }, ctx);
  assert.equal(d.asked.length, 1);
  await d.remote.dispatch('startQuest', { id: 'q-new' }, ctx); // same steps: already approved
  assert.equal(d.asked.length, 1);
  // the quest changes (the planning AI added an edit step): approval no longer matches
  d.store.state.quests[0].steps.push({ id: 'sx', title: 'planner', mode: 'edit', status: 'pending' });
  await assert.rejects(d.remote.dispatch('startQuest', { id: 'q-new' }, ctx), (e) => e.status === 403);
  assert.equal(d.asked.length, 2);
  assert.equal(d.done.filter(([n]) => n === 'startQuest').length, 1, 'refused: not started');
  await d.remote.dispatch('resumeQuest', { id: 'q-new' }, ctx);
  assert.equal(d.asked.length, 3);
  await d.remote.dispatch('resumeQuest', { id: 'q-new' }, ctx);
  assert.equal(d.asked.length, 3, 'approved now');
  // steps already finished do not count
  const q = d.store.state.quests[0];
  q.steps.forEach((s) => (s.status = 'done'));
  await d.remote.dispatch('startQuest', { id: 'q-new' }, ctx);
  assert.equal(d.asked.length, 3);
});

test('desktop notices: every pairing and the first use of each device session', async () => {
  let t = 1_000_000;
  const port = await freePort();
  const d = fakeDesktop({
    remote: { enabled: true, bind: 'localhost', port },
    confirmAnswers: ['yes'],
    deps: { now: () => t },
  });
  await d.remote.start();
  try {
    const { code } = await d.remote.createPairing();
    const base = 'http://127.0.0.1:' + port;
    const post = (p, body, headers = {}) =>
      fetch(base + p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const paired = await post('/api/pair', { code, name: 'Pixel 8' });
    assert.equal(paired.status, 200);
    const { token } = await paired.json();
    assert.match(d.asked[0].message, /^Autorizar o aparelho 'Pixel 8' \(127\.0\.0\.1\) a controlar o VeSTA\?$/);
    assert.equal(d.notices.length, 1);
    assert.match(d.notices[0], /Pixel 8.*pareado/);
    const use = () => post('/api/call', { method: 'bootstrap' }, { Authorization: 'Bearer ' + token });
    assert.equal((await use()).status, 200);
    assert.equal(d.notices.length, 1, 'same session right after pairing: no repeat');
    t += 16 * 60 * 1000;
    assert.equal((await use()).status, 200);
    assert.equal(d.notices.length, 2);
    assert.match(d.notices[1], /começou a usar/);
    assert.equal((await use()).status, 200);
    assert.equal(d.notices.length, 2);
  } finally {
    await d.remote.stop();
  }
});

// ---- 2. no LAN mode ------------------------------------------------------------------------------------------------
test('LAN mode is gone: saved LAN configs turn the remote off with a warning, and it cannot be selected', async () => {
  const n = normalizeRemote({ enabled: true, bind: 'lan', port: 47900, devices: [] });
  assert.equal(n.enabled, false);
  assert.equal(n.bind, null);
  assert.match(n.notice, /Rede local \(LAN\)/);
  assert.match(n.notice, /Tailscale/);
  assert.equal(normalizeRemote({ enabled: true, bind: 'tailscale' }).enabled, true);
  assert.equal(normalizeRemote({ enabled: true, bind: 'tailscale' }).notice, '');
  assert.equal(normalizeRemote(undefined).serveOwnedPort, null);
  assert.equal(normalizeRemote({ serveOwnedPort: 47900 }).serveOwnedPort, 47900);
  assert.equal(normalizeRemote({ serveOwnedPort: 80 }).serveOwnedPort, null);
  const d = fakeDesktop({ remote: { enabled: true, bind: 'lan', port: await freePort() } });
  let s = await d.remote.status();
  assert.equal(s.enabled, false);
  assert.equal(s.running, false);
  assert.match(s.notice, /LAN/);
  assert.equal('lan' in s.addresses, false);
  await assert.rejects(d.remote.configure({ bind: 'lan' }), /Interface inválida/);
  s = await d.remote.configure({ bind: 'localhost' });
  assert.equal(s.notice, '', 'the next change dismisses the warning');
  assert.equal(s.bind, 'localhost');
});

test('the Preferências screen has no LAN option and explains Tailscale', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/components/RemoteSettings.jsx'), 'utf8');
  assert.ok(!/Rede local \(LAN\)|'lan'/.test(src));
  assert.match(src, /https:\/\/tailscale\.com\/download/);
  assert.match(src, /gratuito/);
  assert.match(src, /criptografad/);
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  assert.ok(!/\*\*Rede local \(LAN\)\*\*: um endereço/.test(readme));
});

// ---- 3. rate limiting behind tailscale serve -----------------------------------------------------------------------
test('rate limit key: X-Forwarded-For is trusted only when the socket is loopback; the last entry wins', async () => {
  const s = await startServer();
  try {
    const req = (remoteAddress, xff) => ({
      socket: { remoteAddress },
      headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    });
    assert.equal(s.server.clientIp(req('127.0.0.1', '100.64.0.7')), '100.64.0.7');
    assert.equal(s.server.clientIp(req('::1', '100.64.0.7')), '100.64.0.7');
    assert.equal(
      s.server.clientIp(req('::ffff:127.0.0.1', '9.9.9.9, 100.64.0.8')),
      '100.64.0.8',
      'a forged first entry is ignored'
    );
    assert.equal(s.server.clientIp(req('127.0.0.1', 'not-an-ip')), '127.0.0.1');
    assert.equal(s.server.clientIp(req('127.0.0.1')), '127.0.0.1');
    assert.equal(s.server.clientIp(req('100.64.0.2', '1.2.3.4')), '100.64.0.2', 'not a proxy: header ignored');
    assert.equal(s.server.clientIp(req('::ffff:192.168.0.5', '1.2.3.4')), '192.168.0.5');
  } finally {
    await s.close();
  }
});

test('rate limit behind the proxy: failures count per forwarded client; a valid token is never blocked', async () => {
  let t = 0;
  const s = await startServer({
    pairLimiter: createLimiter({ max: 3, blockMs: 60000, now: () => t }),
    authLimiter: createLimiter({ max: 3, blockMs: 60000, now: () => t }),
  });
  try {
    const { token } = await s.pair('Dono');
    const as = (ip) => ({ 'X-Forwarded-For': ip });
    const bad = 'z'.repeat(43);
    for (let i = 0; i < 3; i++) assert.equal((await s.call(bad, 'usage', {}, as('100.64.0.66'))).status, 401);
    assert.equal((await s.call(bad, 'usage', {}, as('100.64.0.66'))).status, 429, 'attacker blocked');
    // rotating the (forgeable) leftmost entry does not help: the proxy-appended last entry is the key
    assert.equal((await s.call(bad, 'usage', {}, as('1.1.1.1, 100.64.0.66'))).status, 429);
    // another client behind the same proxy is unaffected
    assert.equal((await s.call(bad, 'usage', {}, as('100.64.0.77'))).status, 401);
    // the owner with a valid token is served even from the blocked address
    assert.equal((await s.call(token, 'usage', {}, as('100.64.0.66'))).status, 200);
    // the blocked address cannot pair either, even with a valid code
    const { code } = s.pairing.create();
    for (let i = 0; i < 3; i++) await s.post('/api/pair', { code: 'x' + i }, as('100.64.0.66'));
    assert.equal((await s.post('/api/pair', { code, name: 'x' }, as('100.64.0.66'))).status, 429);
    // WebSocket: a valid token connects from the blocked address; a bad one is told 4429
    const ws = await wsOpen('ws://127.0.0.1:' + s.port + '/ws', as('100.64.0.66'));
    ws.send(JSON.stringify({ t: 'auth', token }));
    await until(() => ws.messages.find((m) => m.t === 'ready'));
    ws.close();
    const ws2 = await wsOpen('ws://127.0.0.1:' + s.port + '/ws', as('100.64.0.66'));
    const closed = new Promise((res) => ws2.on('close', (code) => res(code)));
    ws2.send(JSON.stringify({ t: 'auth', token: bad }));
    assert.equal(await closed, 4429);
    t = 61000;
    assert.equal((await s.call(bad, 'usage', {}, as('100.64.0.66'))).status, 401, 'block expired');
  } finally {
    await s.close();
  }
});

test('rate limit per device: a runaway device is slowed down, others are not', async () => {
  const s = await startServer({ deviceLimiter: createLimiter({ max: 4, blockMs: 30000 }) });
  try {
    const a = await s.pair('A'),
      b = await s.pair('B');
    for (let i = 0; i < 4; i++) assert.equal((await s.call(a.token, 'usage')).status, 200);
    const limited = await s.call(a.token, 'usage');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await s.call(b.token, 'usage')).status, 200);
  } finally {
    await s.close();
  }
});

// ---- 4. connection budget ------------------------------------------------------------------------------------------
const fakeSocket = (ip) =>
  Object.assign(new EventEmitter(), {
    remoteAddress: ip,
    destroyed: false,
    idle: null,
    destroy() {
      this.destroyed = true;
      this.emit('close');
    },
    setTimeout(ms) {
      this.idle = ms;
    },
  });
test('connection gate: per-IP pre-auth cap, room kept for authenticated devices, quick idle cut', () => {
  const gate = createConnectionGate({ perIp: 3, preAuthMax: 5, totalMax: 7, idleMs: 1000 });
  const a = [1, 2, 3].map(() => fakeSocket('100.64.0.5'));
  for (const s of a) assert.equal(gate.accept(s), true);
  const over = fakeSocket('100.64.0.5');
  assert.equal(gate.accept(over), false);
  assert.equal(over.destroyed, true, 'fourth pre-auth socket of one IP is dropped');
  assert.equal(gate.accept(fakeSocket('::ffff:100.64.0.5')), false, 'IPv4-mapped form counts as the same IP');
  assert.equal(gate.accept(fakeSocket('100.64.0.6')), true, 'other IPs are fine');
  // an authenticated connection stops counting as pre-auth and is never cut as idle
  assert.equal(a[0].idle, 1000);
  gate.authed(a[0]);
  assert.equal(a[0].idle, 0);
  a[0].emit('timeout');
  assert.equal(a[0].destroyed, false);
  assert.equal(gate.accept(fakeSocket('100.64.0.5')), true, 'its slot was freed');
  // unauthenticated idle sockets are closed
  a[1].emit('timeout');
  assert.equal(a[1].destroyed, true);
  // global pre-auth ceiling leaves room: authenticated sockets still count only toward the total
  const g2 = createConnectionGate({ perIp: 100, preAuthMax: 2, totalMax: 4 });
  const auth = [fakeSocket('1.1.1.1'), fakeSocket('1.1.1.2')];
  for (const s of auth) g2.accept(s), g2.authed(s);
  assert.equal(g2.accept(fakeSocket('2.2.2.1')), true);
  assert.equal(g2.accept(fakeSocket('2.2.2.2')), true);
  assert.equal(g2.accept(fakeSocket('2.2.2.3')), false, 'pre-auth share is full');
  assert.equal(g2.stats.total, 4);
  assert.equal(g2.stats.preAuth, 2);
  auth[0].destroy();
  assert.equal(g2.stats.total, 3);
  assert.equal(g2.stats.preAuth, 2, 'closing an authenticated socket does not touch the pre-auth count');
  // loopback (the tailscale serve proxy) is not capped per IP, only by the shared ceiling
  const g3 = createConnectionGate({ perIp: 1, preAuthMax: 50 });
  for (let i = 0; i < 10; i++) assert.equal(g3.accept(fakeSocket('127.0.0.1')), true);
  // hold/release: a request waiting for the desktop dialog is not cut
  const h = fakeSocket('100.64.0.9');
  g3.accept(h);
  g3.hold(h);
  assert.equal(h.idle, 0);
  g3.release(h);
  assert.equal(h.idle, 10_000);
});

test('server: sockets beyond the pre-auth ceiling are dropped and idle pre-auth sockets are closed fast', async () => {
  const gate = createConnectionGate({ preAuthMax: 2, idleMs: 250 });
  const s = await startServer({ gate });
  const open = () =>
    new Promise((resolve, reject) => {
      const sock = nodeNet.connect(s.port, '127.0.0.1', () => resolve(sock));
      sock.closed = new Promise((res) => sock.on('close', res));
      sock.on('error', () => {});
    });
  try {
    const a = await open(),
      b = await open();
    const c = await open();
    await Promise.race([
      c.closed,
      new Promise((_, rej) => setTimeout(() => rej(new Error('third socket stayed open')), 1500)),
    ]);
    // idle sockets are cut after idleMs (well before the 15 s header timeout)
    const t0 = Date.now();
    await Promise.race([
      a.closed,
      new Promise((_, rej) => setTimeout(() => rej(new Error('idle socket stayed open')), 2000)),
    ]);
    assert.ok(Date.now() - t0 < 1800);
    b.destroy();
    await until(() => gate.stats.preAuth === 0);
    // the server still answers normally afterwards
    assert.equal((await fetch(s.base + '/api/health')).status, 200);
  } finally {
    await s.close();
  }
});

test('server: a pairing request waiting for the desktop dialog is not cut by the idle timeout', async () => {
  const gate = createConnectionGate({ idleMs: 150 });
  const s = await startServer({ gate, confirmPairing: () => new Promise((r) => setTimeout(() => r('yes'), 600)) });
  try {
    assert.equal((await s.pair('Lento')).r.status, 200);
  } finally {
    await s.close();
  }
});

test('server: a valid token marks its connection as authenticated', async () => {
  const gate = createConnectionGate({ idleMs: 5000 });
  const s = await startServer({ gate });
  try {
    const { token } = await s.pair();
    const ws = await wsOpen('ws://127.0.0.1:' + s.port + '/ws');
    const before = gate.stats.preAuth;
    ws.send(JSON.stringify({ t: 'auth', token }));
    await until(() => ws.messages.find((m) => m.t === 'ready'));
    assert.equal(gate.stats.preAuth, before - 1);
    ws.close();
  } finally {
    await s.close();
  }
});

// ---- 5. Tailscale detection through the CLI (simulated output) -----------------------------------------------------
function fakeCli(initial = {}) {
  const state = {
    backend: 'Running',
    ips: ['100.88.1.2', 'fd7a:115c:a1e0::1'],
    serve: {},
    log: [],
    ipFails: false,
    ...initial,
  };
  const exec = async (exe, args) => {
    state.log.push(args.join(' '));
    const cmd = args.join(' ');
    if (cmd === 'status --json')
      return JSON.stringify({
        BackendState: state.backend,
        Self: { DNSName: 'pc.tail1.ts.net.', TailscaleIPs: state.statusIps ?? state.ips },
      });
    if (cmd === 'ip -4') {
      if (state.ipFails) throw new Error('no');
      return state.ips.filter((x) => !x.includes(':')).join('\r\n') + '\r\n';
    }
    if (cmd === 'serve status --json') return JSON.stringify(state.serve);
    if (args[0] === 'serve' && args.includes('--bg')) {
      const port = args.at(-1).split(':').pop();
      state.serve = {
        TCP: { 443: { HTTPS: true } },
        Web: { 'pc.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:' + port } } } },
      };
      return '';
    }
    if (cmd === 'serve --https=443 off') {
      state.serve = {};
      return '';
    }
    throw new Error('unexpected tailscale command: ' + cmd);
  };
  const api = {
    status: (o) => tailscale.status({ ...o, exe: 'ts', exec }),
    serve: (port) => tailscale.serve(port, { exe: 'ts', exec }),
    unserve: (port) => tailscale.unserve(port, { exe: 'ts', exec }),
  };
  return { state, exec, api };
}
const FOREIGN = { Web: { 'pc.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } };

test('Tailscale status from the CLI: addresses come from TailscaleIPs, `tailscale ip -4` is the fallback', async () => {
  const cli = fakeCli();
  let st = await cli.api.status({ port: 47900 });
  assert.deepEqual(st.ips.slice(0, 1), ['100.88.1.2']);
  assert.deepEqual(cli.state.log, ['status --json', 'serve status --json'], 'no fallback needed');
  assert.deepEqual(require('../electron/remote/net.cjs').detectAddresses({}, st), { tailscale: '100.88.1.2' });
  // status without IPs -> asks `tailscale ip -4`
  const cli2 = fakeCli({ statusIps: [] });
  st = await cli2.api.status({ port: 47900 });
  assert.ok(cli2.state.log.includes('ip -4'));
  assert.deepEqual(st.ips, ['100.88.1.2']);
  // stopped: not running, no serve query, no address
  const cli3 = fakeCli({ backend: 'Stopped' });
  st = await cli3.api.status({ port: 47900 });
  assert.equal(st.running, false);
  assert.deepEqual(cli3.state.log, ['status --json']);
  assert.deepEqual(require('../electron/remote/net.cjs').detectAddresses({ eth0: [] }, st), { tailscale: null });
  // a Docker/WSL 100.64/10 address elsewhere never becomes "the Tailscale address" when the CLI says otherwise
  const cli4 = fakeCli({ statusIps: [], ipFails: true, ips: [] });
  st = await cli4.api.status({ port: 47900 });
  const docker = { eth0: [{ family: 'IPv4', address: '100.100.0.2', internal: false }] };
  assert.deepEqual(require('../electron/remote/net.cjs').detectAddresses(docker, st), { tailscale: null });
});

test('createRemote finds the Tailscale address through the CLI and listens on it only when it is real', async () => {
  const cli = fakeCli({ backend: 'Stopped' });
  const d = fakeDesktop({
    remote: { enabled: true, bind: 'tailscale', port: await freePort() },
    deps: { tailscale: cli.api, addresses: undefined },
  });
  await d.remote.start();
  let s = await d.remote.status();
  assert.equal(s.running, false);
  assert.match(s.error, /Tailscale não detectado/);
  assert.deepEqual(s.addresses, { tailscale: null });
  assert.equal(s.tailscale.running, false);
});

test('findCli: the official absolute path wins over PATH; PATH is the last resort', () => {
  const official = path.win32.join('C:\\Program Files', 'Tailscale', 'tailscale.exe');
  const planted = 'C:\\evil\\tailscale.exe';
  const exists = (f) => f === official || f === planted;
  assert.equal(
    tailscale.findCli({ env: { ProgramFiles: 'C:\\Program Files', PATH: 'C:\\evil' }, exists, platform: 'win32' }),
    official
  );
  assert.equal(
    tailscale.findCli({ env: { PATH: 'C:\\evil' }, exists: (f) => f === planted, platform: 'win32' }),
    planted
  );
  assert.equal(
    tailscale.findCli({
      env: { ProgramFiles: 'D:\\Apps', PATH: '' },
      exists: (f) => f === 'D:\\Apps\\Tailscale\\tailscale.exe',
      platform: 'win32',
    }),
    'D:\\Apps\\Tailscale\\tailscale.exe'
  );
  assert.equal(tailscale.findCli({ env: { PATH: '' }, exists: () => false, platform: 'win32' }), null);
  assert.equal(
    tailscale.findCli({ env: { PATH: '/opt/bin' }, exists: (f) => f === '/usr/bin/tailscale', platform: 'linux' }),
    '/usr/bin/tailscale'
  );
});

// ---- 6. tailscale serve: ours only ---------------------------------------------------------------------------------
test('inspectServe tells free, ours and foreign configurations apart', () => {
  const ours = { Web: { 'pc.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:47900' } } } } };
  assert.deepEqual(tailscale.inspectServe({}, 47900), { state: 'free' });
  assert.deepEqual(tailscale.inspectServe('', 47900), { state: 'free' });
  assert.deepEqual(tailscale.inspectServe(ours, 47900), { state: 'ours', url: 'https://pc.ts.net' });
  assert.equal(tailscale.inspectServe(ours, 47901).state, 'foreign', 'same proxy, different port');
  assert.equal(tailscale.inspectServe(FOREIGN, 47900).state, 'foreign');
  assert.equal(tailscale.inspectServe('{bad json', 47900).state, 'foreign', 'unreadable: do not touch');
  // a path/text handler, a different path or a TCP forward on 443 is somebody else's
  assert.equal(
    tailscale.inspectServe({ Web: { 'pc.ts.net:443': { Handlers: { '/': { Path: 'C:\\site' } } } } }, 47900).state,
    'foreign'
  );
  assert.equal(
    tailscale.inspectServe(
      {
        Web: {
          'pc.ts.net:443': {
            Handlers: { '/': ours.Web['pc.ts.net:443'].Handlers['/'], '/api': { Proxy: 'http://127.0.0.1:9' } },
          },
        },
      },
      47900
    ).state,
    'foreign'
  );
  assert.equal(tailscale.inspectServe({ TCP: { 443: { TCPForward: '127.0.0.1:22' } } }, 47900).state, 'foreign');
  // other ports are not our business
  assert.equal(
    tailscale.inspectServe({ Web: { 'pc.ts.net:8443': FOREIGN.Web['pc.tail1.ts.net:443'] } }, 47900).state,
    'free'
  );
});

test('tailscale.serve never overwrites a foreign configuration; unserve only removes ours', async () => {
  const cli = fakeCli({ serve: FOREIGN });
  await assert.rejects(
    cli.api.serve(47900),
    (e) => e instanceof tailscale.ServeConflict && /porta 443/.test(e.message) && /não vai alterá-la/.test(e.message)
  );
  assert.deepEqual(await cli.api.unserve(47900), { changed: false, state: 'foreign' });
  assert.deepEqual(cli.state.serve, FOREIGN, 'untouched');
  assert.ok(!cli.state.log.some((c) => c.includes('--bg') || c.includes(' off')), cli.state.log.join(' | '));
  // free -> publishes; the second call is a no-op; unserve removes it
  const free = fakeCli();
  assert.deepEqual(await free.api.serve(47900), { changed: true });
  assert.deepEqual(await free.api.serve(47900), { changed: false, url: 'https://pc.tail1.ts.net' });
  assert.equal(free.state.log.filter((c) => c.includes('--bg')).length, 1);
  assert.deepEqual(await free.api.unserve(47900), { changed: true });
  assert.deepEqual(free.state.serve, {});
  assert.deepEqual(await free.api.unserve(47900), { changed: false, state: 'free' });
});

test('VeSTA undoes only its own publication: on disable, port change and quit; never a foreign one', async () => {
  const port = await freePort();
  const mk = (serve) => {
    const cli = fakeCli({ serve });
    const d = fakeDesktop({ remote: { enabled: true, bind: 'localhost', port }, deps: { tailscale: cli.api } });
    return { cli, d };
  };
  // publish, then quit -> unserve
  let { cli, d } = mk({});
  await d.remote.start();
  await d.remote.setHttps(true);
  assert.equal(d.store.state.remote.serveOwnedPort, port);
  assert.equal((await d.remote.status()).tailscale.serveOwned, true);
  assert.ok(cli.state.serve.Web);
  await d.remote.shutdown();
  assert.deepEqual(cli.state.serve, {}, 'removed on quit');
  assert.equal(d.store.state.remote.serveOwnedPort, null);
  assert.equal(d.remote.server, null);
  // publish, then turn the remote off -> unserve
  ({ cli, d } = mk({}));
  await d.remote.start();
  await d.remote.setHttps(true);
  await d.remote.configure({ enabled: false });
  assert.deepEqual(cli.state.serve, {}, 'removed when turned off');
  // publish, then move to another port -> the old publication goes away
  ({ cli, d } = mk({}));
  await d.remote.start();
  await d.remote.setHttps(true);
  await d.remote.configure({ port: await freePort() });
  assert.deepEqual(cli.state.serve, {}, 'removed on port change');
  await d.remote.stop();
  // a foreign configuration: setHttps refuses, quit and disable leave it alone
  ({ cli, d } = mk(FOREIGN));
  await d.remote.start();
  await assert.rejects(d.remote.setHttps(true), /porta 443/);
  assert.equal(d.store.state.remote.serveOwnedPort, null);
  await assert.rejects(d.remote.setHttps(false), /não foi criada pelo VeSTA/);
  await d.remote.configure({ enabled: false });
  await d.remote.shutdown();
  assert.deepEqual(cli.state.serve, FOREIGN);
  assert.ok(!cli.state.log.some((c) => c.includes('--bg') || c.includes(' off')), cli.state.log.join(' | '));
  assert.equal((await d.remote.status()).tailscale.serveState, 'foreign');
  // an identical publication the USER made before (not recorded as ours) is not removed on quit either
  ({ cli, d } = mk({ Web: { 'pc.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:' + port } } } } }));
  await d.remote.start();
  await d.remote.shutdown();
  assert.ok(cli.state.serve.Web, 'kept');
  // shutdown never hangs on a stuck CLI
  const stuck = {
    status: async () => ({ installed: true, running: true }),
    serve: async () => ({}),
    unserve: () => new Promise(() => {}),
  };
  const s2 = fakeDesktop({
    remote: { enabled: true, bind: 'localhost', port: await freePort(), serveOwnedPort: 47900 },
    deps: { tailscale: stuck },
  });
  await s2.remote.start();
  const t0 = Date.now();
  await s2.remote.shutdown(200);
  assert.ok(Date.now() - t0 < 1500);
});

test('main process pauses quitting until the publication is undone (before-quit wiring)', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const block = main.slice(main.indexOf("app.on('before-quit'"));
  assert.match(block, /event\.preventDefault\(\)/);
  assert.match(block, /ctx\.remote\s*\.shutdown\(\)/);
  assert.match(block, /app\.quit\(\)/);
  assert.match(main, /isPackaged: app\.isPackaged/);
});

// ---- 8, 9, 11: errors, late server errors, health -----------------------------------------------------------------
test('unexpected errors answer a generic message; the detail only goes to the local log', async () => {
  const s = await startServer({
    dispatch: async (name) => {
      if (name === 'usage') throw new Error('ENOENT: C:\\Users\\Maria\\segredo\\token.txt');
      if (name === 'stop') throw new RemoteError(409, 'Mensagem do usuário');
      return {};
    },
  });
  try {
    const { token } = await s.pair();
    const r = await s.call(token, 'usage');
    assert.equal(r.status, 500);
    const text = await r.text();
    assert.ok(!/Maria|segredo|ENOENT|token\.txt/.test(text), text);
    assert.match(JSON.parse(text).error, /Não foi possível concluir/);
    assert.ok(
      s.logs.some((l) => l.includes('segredo')),
      'detail logged locally'
    );
    // known errors keep their own message
    const known = await s.call(token, 'stop', { chatId: 'c' });
    assert.equal(known.status, 409);
    assert.equal((await known.json()).error, 'Mensagem do usuário');
    // malformed JSON is the client's fault and still says so
    assert.equal((await s.post('/api/call', '{bad', { Authorization: 'Bearer ' + token })).status, 400);
  } finally {
    await s.close();
  }
});

test('a late error on the listening server is logged and never thrown', async () => {
  const s = await startServer();
  try {
    const [http1] = s.server.httpServers;
    assert.ok(http1.listenerCount('error') >= 1, 'permanent error listener');
    assert.doesNotThrow(() =>
      http1.emit('error', Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' }))
    );
    assert.ok(s.logs.some((l) => l.includes('EMFILE')));
    assert.equal((await fetch(s.base + '/api/health')).status, 200, 'still serving');
  } finally {
    await s.close();
  }
});

test('/api/health reveals nothing but ok', async () => {
  const s = await startServer();
  try {
    const r = await fetch(s.base + '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  } finally {
    await s.close();
  }
});

// ---- 10. CSP: no eval, no inline scripts ---------------------------------------------------------------------------
test('CSP forbids eval and inline scripts, and the mobile pages carry no inline <script>', async () => {
  const s = await startServer();
  try {
    const r = await fetch(s.base + '/');
    const csp = r.headers.get('content-security-policy');
    const script = /script-src ([^;]*)/.exec(csp)[1];
    assert.equal(script, "'self'");
    assert.ok(!csp.includes('unsafe-eval') && !csp.includes('wasm-unsafe-eval'));
    assert.ok(!/script-src[^;]*('unsafe-inline'|data:|blob:|https?:|\*)/.test(csp));
    assert.match(csp, /object-src 'none'/);
  } finally {
    await s.close();
  }
  const pages = [path.join(__dirname, '../mobile/index.html')];
  const built = path.join(__dirname, '../dist-mobile/index.html');
  if (fs.existsSync(built)) pages.push(built);
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
      assert.ok(/\bsrc=/.test(m[1]) && !m[2].trim(), file + ': inline script ' + m[0].slice(0, 80));
    assert.ok(!/\son\w+\s*=/i.test(html), file + ': inline event handler');
  }
  const sw = fs.readFileSync(path.join(__dirname, '../mobile/sw.template.js'), 'utf8');
  assert.ok(!/\beval\s*\(|new Function\(/.test(sw));
});
