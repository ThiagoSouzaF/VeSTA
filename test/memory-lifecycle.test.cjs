// AI Memory integration: data-dir lock and orphans, the hook spool, lifecycle events through /hook/batch (real agent
// name, stable ingest_key), the cross-project profile, the briefing, the hint per chat mode. The ones marked with the
// binary start a real `ai-memory serve` on a temporary data dir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const M = require('../electron/memory/client.cjs');
const { memoryHint } = require('../electron/ai/providers.cjs');
const { createMemorySessions } = require('../electron/memory/sessions.cjs');

const exe = path.join(__dirname, '../runtime/ai-memory.exe');
const real = { skip: !fs.existsSync(exe) && 'ai-memory.exe ausente', timeout: 90000 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-memlc-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- reclaim (no binary) ---------------------------------------------------------------------------------------------
function dirWith(files) {
  const dir = tmp();
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
const deps = (o = {}) => {
  const ended = [];
  return {
    ended,
    isAlive: () => true,
    image: () => 'ai-memory.exe',
    end: async (pid) => ended.push(pid),
    probe: async () => false,
    ...o,
  };
};

test('reclaim: a dead pid in the lock holder is stale and the file is removed', async () => {
  const dir = dirWith({ '.serve.lock.holder': 'pid=424242\n' });
  const out = await M.reclaim(dir, deps({ isAlive: () => false }));
  assert.deepEqual(out.stale, [424242]);
  assert.equal(fs.existsSync(path.join(dir, '.serve.lock.holder')), false);
});

test('reclaim: a live pid that is not ai-memory (pid reuse) is never touched, only the stale file goes', async () => {
  const dir = dirWith({ '.serve.lock.holder': 'pid=777\n', 'vesta-server.pid': '777' });
  const d = deps({ image: () => 'chrome.exe' });
  const out = await M.reclaim(dir, d);
  assert.deepEqual(out.stale, [777]);
  assert.deepEqual(d.ended, [], 'nobody was killed');
  assert.equal(fs.existsSync(path.join(dir, '.serve.lock.holder')), false);
  assert.equal(fs.existsSync(path.join(dir, 'vesta-server.pid')), false);
});

test('reclaim: a live ai-memory that answers with our identity is adopted, one that does not is ended', async () => {
  const dir = dirWith({ '.serve.lock.holder': 'pid=555\n' });
  const a = await M.reclaim(dir, { ...deps({ probe: async () => true }), identity: { port: 5, token: 't', url: 'u' } });
  assert.deepEqual(a.adopted, { pid: 555 });
  assert.ok(fs.existsSync(path.join(dir, '.serve.lock.holder')), 'a healthy server keeps its files');
  const d = deps({ probe: async () => false });
  const k = await M.reclaim(dir, { ...d, identity: { port: 5, token: 't', url: 'u' } });
  assert.deepEqual(k.killed, [555]);
  assert.deepEqual(d.ended, [555]);
  assert.equal(fs.existsSync(path.join(dir, '.serve.lock.holder')), false);
});

test('explainStartError turns the lock message into something actionable', () => {
  const m = M.explainStartError(
    'Error: another ai-memory serve process appears to be using C:\\x (pid=12345)',
    'C:\\x'
  );
  assert.match(m, /pid 12345/);
  assert.match(m, /feche o ai-memory\.exe/);
  assert.equal(M.explainStartError('boom\nlast line'), 'last line');
});

// ---- reclaim with two real servers in one data dir ------------------------------------------------------------------
test(
  'two serve processes on one data dir: the second is refused with the lock message; reclaim frees it',
  real,
  async () => {
    const dir = tmp();
    const a = new M.Memory(exe, dir);
    await a.agentEndpoint();
    const apid = a.server.pid;
    // The raw conflict (what failed silently every turn on 27/10).
    const port = 41000 + Math.floor(Math.random() * 2000);
    const second = spawn(exe, ['--data-dir', dir, 'serve', '--transport', 'http', '--bind', '127.0.0.1:' + port], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AI_MEMORY_AUTH_TOKEN: 'x' },
    });
    let log = '';
    second.stdout.on('data', (b) => (log += b));
    second.stderr.on('data', (b) => (log += b));
    await new Promise((r) => second.on('exit', r));
    assert.match(log, /another ai-memory serve process appears to be using/i);
    assert.match(M.explainStartError(log, dir), /pid \d+/);
    // The first one stops answering with our identity (token changed on disk): the next start ends it and takes over.
    fs.writeFileSync(
      path.join(dir, 'vesta-server.json'),
      JSON.stringify({ port: a.endpoint.url.split(':').pop() * 1, token: 'another-token-another-token' })
    );
    a.server.removeAllListeners('exit');
    a.server = null;
    a.client = null;
    a.endpoint = null;
    const b = new M.Memory(exe, dir);
    try {
      await b.agentEndpoint();
      assert.notEqual(b.server.pid, apid);
      assert.throws(() => process.kill(apid, 0), 'the unresponsive server was ended');
      assert.match(
        await b.call('memory_status', { workspace: 'vesta', project: 'inbox' }).catch((e) => e.message),
        /./
      );
    } finally {
      await b.close();
      try {
        process.kill(apid);
      } catch {}
    }
  }
);

test('a stale holder file does not stop the server from starting', real, async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.serve.lock.holder'), 'pid=999999\n');
  const m = new M.Memory(exe, dir);
  try {
    await m.agentEndpoint();
    assert.ok(m.endpoint.url);
  } finally {
    await m.close();
  }
});

test(
  'the server keeps its port and token between runs (spooled events never point at a dead address)',
  real,
  async () => {
    const dir = tmp();
    const a = new M.Memory(exe, dir);
    const first = await a.agentEndpoint();
    await a.close();
    const b = new M.Memory(exe, dir);
    try {
      const second = await b.agentEndpoint();
      assert.equal(second.url, first.url);
      assert.equal(second.token, first.token);
    } finally {
      await b.close();
    }
  }
);

// ---- hook spool ---------------------------------------------------------------------------------------------------
test('the orphan spool is pointed at the current server and drained to zero', real, async () => {
  const dir = tmp();
  const m = new M.Memory(exe, dir);
  try {
    await m.ensureProject('p1');
    // Events queued while "no server answered": aimed at an old port, with no token.
    for (let i = 0; i < 3; i++) {
      const r = spawnSync(
        exe,
        [
          '--data-dir',
          dir,
          'hook',
          '--event',
          'user-prompt-submit',
          '--agent',
          'claude-code',
          '--server-url',
          'http://127.0.0.1:1',
        ],
        {
          input: JSON.stringify({
            session_id: '11111111-1111-4111-8111-11111111111' + i,
            cwd: 'C:/x',
            prompt: 'oi ' + i,
          }),
          encoding: 'utf8',
          env: { ...process.env, AI_MEMORY_AUTH_TOKEN: 'old' },
          timeout: 30000,
        }
      );
      assert.equal(r.status, 0, r.stderr);
    }
    assert.equal(M.spoolCount(dir), 3);
    const report = await m.drainSpool();
    assert.deepEqual(
      { before: report.before, after: report.after, rewritten: report.rewritten },
      { before: 3, after: 0, rewritten: 3 }
    );
    assert.equal(M.spoolCount(dir), 0);
  } finally {
    await m.close();
  }
});

test('retargetSpool leaves non-loopback events alone', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'hook-spool'));
  const put = (name, url) =>
    fs.writeFileSync(
      path.join(dir, 'hook-spool', name + '.json'),
      JSON.stringify({ url, body: '{}', auth_mode: 'none' })
    );
  put('a', 'http://127.0.0.1:1/hook?event=stop');
  put('b', 'https://memoria.example.com/hook?event=stop');
  assert.equal(M.retargetSpool(dir, 'http://127.0.0.1:5000', 'tok'), 1);
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'hook-spool', 'a.json'), 'utf8'));
  assert.equal(a.url, 'http://127.0.0.1:5000/hook?event=stop');
  assert.deepEqual([a.auth_mode, a.token], ['static', 'tok']);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'hook-spool', 'b.json'), 'utf8')).url.startsWith('https://memoria'),
    true
  );
  assert.equal(M.retargetSpool(dir, 'http://127.0.0.1:5000', 'tok'), 0, 'idempotent');
});

// ---- /hook/batch: real agent, stable key ------------------------------------------------------------------------
test('batch items: canonical event, provenance and a stable 64-hex ingest_key', () => {
  const item = M.batchItem({
    event: 'user-prompt',
    agent: 'opencode',
    projectId: 'p1',
    payload: { session_id: 's-1', cwd: 'C:/x', prompt: 'oi' },
    eventId: 3,
  });
  const q = new URL('http://x' + item.url).searchParams;
  assert.equal(q.get('event'), 'user-prompt-submit');
  assert.equal(q.get('source_event'), 'user-prompt-submit');
  assert.equal(q.get('agent'), 'opencode');
  assert.equal(q.get('extension'), M.PRODUCER);
  assert.equal(q.get('workspace'), 'vesta');
  assert.equal(q.get('project'), 'p1');
  assert.match(q.get('ingest_key'), /^[0-9a-f]{64}$/);
  const again = M.batchItem({
    event: 'user-prompt',
    agent: 'opencode',
    projectId: 'p1',
    payload: { session_id: 's-1', prompt: 'OUTRO TEXTO' },
    eventId: 3,
  });
  assert.equal(
    new URL('http://x' + again.url).searchParams.get('ingest_key'),
    q.get('ingest_key'),
    'content does not change the key'
  );
  const other = M.batchItem({
    event: 'user-prompt',
    agent: 'opencode',
    projectId: 'p1',
    payload: { session_id: 's-1' },
    eventId: 4,
  });
  assert.notEqual(new URL('http://x' + other.url).searchParams.get('ingest_key'), q.get('ingest_key'));
  assert.equal(M.agentName('drael'), 'drael');
  assert.equal(M.agentName('claude'), 'claude-code');
});

test(
  'batch: every provider is stored under its own agent, and a retry with the same key is a replay',
  real,
  async () => {
    const dir = tmp();
    const m = new M.Memory(exe, dir);
    try {
      await m.ensureProject('p1');
      for (const provider of ['claude', 'codex', 'opencode', 'drael']) {
        const agent = M.agentName(provider);
        const payload = { session_id: require('node:crypto').randomUUID(), cwd: 'C:/x' };
        const r1 = await m.hook('session-start', agent, { ...payload, source: 'startup' }, 'p1', 'session-start');
        assert.equal(r1.results[0].outcome, 'stored', provider);
        const r2 = await m.hook('session-start', agent, { ...payload, source: 'startup' }, 'p1', 'session-start');
        assert.equal(r2.results[0].outcome, 'replayed', provider + ' retried with the same key');
      }
      const status = JSON.parse(await m.call('memory_status', { workspace: 'vesta', project: 'p1' }));
      assert.equal(status.counts.sessions, 4);
    } finally {
      await m.close();
    }
  }
);

test('batch failures are visible (not accepted / HTTP error)', async () => {
  const m = new M.Memory('nada', tmp());
  m.start = async () => ({ url: 'http://127.0.0.1:1', token: 't' });
  await assert.rejects(m.batch([{ event: 'stop', agent: 'codex', projectId: 'p', payload: { session_id: 's' } }]));
});

test('call() reports failures that come as JSON payloads', () => {
  assert.match(M.payloadError('{"error":"página recusada"}'), /recusada/);
  assert.match(M.payloadError('{"ok":false,"message":"não gravou"}'), /não gravou/);
  assert.match(M.payloadError('{"reason":"precondition_failed"}'), /mudou/);
  assert.equal(M.payloadError('{"page_id":"x","path":"a.md"}'), '');
  assert.equal(M.payloadError('texto livre'), '');
});

// ---- profile and briefing -----------------------------------------------------------------------------------------
test('profile: written with scope profile, listed, edited in place and removed', real, async () => {
  const dir = tmp();
  const m = new M.Memory(exe, dir);
  try {
    const p = await m.profileWrite({
      category: 'habits',
      subject: 'Idioma',
      statement: 'Prefiro respostas curtas e sempre em português.',
    });
    assert.equal(p, 'profile/habits/idioma.md');
    let list = await m.profile();
    assert.equal(list.length, 1);
    assert.equal(list[0].statement, 'Prefiro respostas curtas e sempre em português.');
    assert.equal(list[0].category, 'habits');
    await m.profileWrite({ path: p, statement: 'Prefiro respostas curtas, em português.' });
    list = await m.profile();
    assert.equal(list.length, 1, 'same path: updated, not duplicated');
    assert.match(list[0].statement, /em português\.$/);
    // Any project's query finds it as a global hit.
    await m.ensureProject('p2');
    assert.match(await m.query('respostas', 'p2'), /habits\/idioma\.md/);
    await m.profileRemove(p);
    assert.equal((await m.profile()).length, 0);
  } finally {
    await m.close();
  }
});

test('briefing: compact text from memory_briefing', real, async () => {
  const dir = tmp();
  const m = new M.Memory(exe, dir);
  try {
    await m.ensureProject('p1');
    await m.call('memory_write_page', {
      path: 'decisions/db.md',
      body: '# Banco\n\nUsar SQLite.',
      workspace: 'vesta',
      project: 'p1',
    });
    const text = await m.briefing('p1');
    assert.match(text, /Projeto p1/);
    assert.match(text, /decisions\/db\.md/);
    assert.ok(text.length < 3001);
  } finally {
    await m.close();
  }
});

test('briefingText tolerates non-JSON', () => {
  assert.equal(M.briefingText('texto'), 'texto');
  assert.match(
    M.briefingText(
      '{"counts":{"pages_latest":2,"sessions":1},"scope":{"project":"x"},"rules":[{"title":"R","path":"_rules/r.md"}]}'
    ),
    /Regra: R/
  );
});

// ---- hint per chat mode ----------------------------------------------------------------------------------------------
test('hint: consult mode never asks to write; edit/ask teach the profile; subagents are covered', () => {
  const read = memoryHint('p-1', { mode: 'read' });
  assert.match(read, /apenas consulte/);
  assert.doesNotMatch(read, /memory_write_page/);
  assert.doesNotMatch(read, /scope "profile" e path/);
  for (const mode of ['edit', 'ask']) {
    const h = memoryHint('p-1', { mode });
    assert.match(h, /project "p-1"/);
    assert.match(h, /scope "profile"/);
    assert.match(h, /expected_page_id/);
    assert.match(h, /create_only/);
    assert.match(h, /tags: \["decisao"\]/, 'tags and entities are documented as arrays');
    assert.match(h, /entities/);
  }
  for (const mode of ['read', 'edit']) {
    const h = memoryHint(null, { mode });
    assert.match(h, /Antes de delegar a um subagente, consulte a memória você mesmo/);
    assert.match(h, /workspace "vesta" e project "inbox"/);
  }
  assert.match(memoryHint('p', { handoff: true }), /memory_handoff_accept/);
  assert.doesNotMatch(memoryHint('p'), /memory_handoff_accept/);
});

// ---- memory sessions: agent per AI, event ids, handoff -----------------------------------------------------------------
function sessionHarness(provider = 'claude') {
  const calls = [];
  const chat = { id: 'c1', title: 'Conversa', provider, projectId: 'p1', memory: true, messages: [] };
  const ctx = {
    store: {
      state: {
        settings: { memoryEnabled: true, capture: true, memoryConsolidate: 'off' },
        chats: [chat],
        memories: [],
      },
      save() {},
    },
    sync() {},
    workdir: () => 'C:/proj',
    memory: {
      hook: async (event, agent, payload, projectId, eventId) =>
        calls.push({ event, agent, payload, projectId, eventId }),
      stopWithAnswer: async (agent, payload) => calls.push({ event: 'stop+answer', agent, payload }),
      handoff: async (o) => calls.push({ event: 'handoff', ...o }),
      call: async () => '{}',
    },
  };
  return { chat, calls, sessions: createMemorySessions(ctx, { idleMs: 60000, settleMs: 0 }) };
}

test('sessions: each provider is recorded under its own agent with stable ids; start/end keys do not depend on a counter', async () => {
  for (const [provider, agent] of [
    ['claude', 'claude-code'],
    ['codex', 'codex'],
    ['opencode', 'opencode'],
    ['drael', 'drael'],
  ]) {
    const h = sessionHarness(provider);
    await h.sessions.turnStart(h.chat, 'oi');
    await h.sessions.turnEnd(h.chat, {
      status: 'done',
      text: 'feito',
      activities: [{ kind: 'tool', label: 'Bash', detail: 'ls' }],
    });
    assert.ok(
      h.calls.every((c) => c.agent === agent),
      provider
    );
    const start = h.calls.find((c) => c.event === 'session-start');
    assert.equal(start.eventId, 'session-start');
    const ids = h.calls.filter((c) => !['session-start', 'stop+answer'].includes(c.event)).map((c) => c.eventId);
    assert.deepEqual(
      ids,
      [1, 2, 3].slice(0, ids.length),
      'a counter that survives (it lives in the persisted session)'
    );
    // Claude and Codex answers are captured by the native hook; the other AIs report a plain stop with the excerpt.
    const stop = h.calls.find((c) => c.event === 'stop' || c.event === 'stop+answer');
    assert.equal(stop.event, provider === 'claude' || provider === 'codex' ? 'stop+answer' : 'stop');
    h.sessions.dispose();
  }
});

test('sessions: the session end keeps the same event id on retry', async () => {
  const h = sessionHarness('codex');
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, { status: 'done', text: 'x', activities: [] });
  await h.sessions.end('c1', 'manual');
  const end = h.calls.find((c) => c.event === 'session-end');
  assert.equal(end.eventId, 'session-end');
  h.sessions.dispose();
});

test('sessions: switching AI leaves a handoff for the next one; memory off does nothing', async () => {
  const h = sessionHarness('codex');
  h.chat.messages = [
    { role: 'user', text: 'refatore o login' },
    { role: 'assistant', text: 'Pronto, refatorei.', status: 'done' },
  ];
  h.chat.provider = 'claude';
  await h.sessions.handoffOnSwitch(h.chat, 'codex');
  const call = h.calls.find((c) => c.event === 'handoff');
  assert.equal(call.projectId, 'p1');
  assert.match(call.summary, /passou de codex para claude/);
  assert.match(call.summary, /refatore o login/);
  assert.equal(call.nextSteps.length, 1);
  const off = sessionHarness('codex');
  off.chat.memory = false;
  await off.sessions.handoffOnSwitch(off.chat, 'claude');
  assert.equal(off.calls.length, 0);
});
