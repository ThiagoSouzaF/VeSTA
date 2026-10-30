// What send() hands the AI about memory: the profile always, the briefing at the start of a conversation (query as the
// fallback), the hint of the chat's mode, and the capture owner in the agent's environment.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const drivers = require('../electron/drivers.cjs');
const providers = require('../electron/providers.cjs');
const { createContext } = require('../electron/context.cjs');
const { createBus } = require('../electron/events.cjs');
const { send } = require('../electron/send.cjs');

const fake = path.join(__dirname, 'fixtures', 'fake-claude.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await wait(15);
  }
  throw new Error('timeout');
};
function harness({ mode = 'edit', briefing, profile } = {}) {
  const bus = createBus();
  const ctx = createContext({ app: { getVersion: () => 't', getPath: () => __dirname }, dialog: {}, shell: {}, bus });
  const chat = {
    id: 'c1',
    title: 'Novo chat',
    provider: 'claude',
    model: '',
    projectId: null,
    mode,
    messages: [],
    memory: true,
    sessionId: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const used = [];
  ctx.store = {
    state: {
      settings: { memoryEnabled: true, memoryTools: true, followMax: 3, followMinutes: 120 },
      chats: [chat],
      memories: [{ kind: 'preference', title: 'Local', body: 'só se o perfil falhar' }],
      projects: [],
      usage: { rateLimit: {}, daily: {} },
    },
    chat: () => chat,
    save() {},
  };
  ctx.memory = {
    agentEndpoint: async () => ({
      url: 'http://127.0.0.1:9',
      mcp: 'http://127.0.0.1:9/mcp',
      token: 'tok-tok-tok-tok-tok',
    }),
    ensureProject: async () => {},
    profile:
      profile ||
      (async () => [
        { category: 'habits', statement: 'Prefiro respostas curtas, em português.', path: 'profile/habits/idioma.md' },
      ]),
    briefing:
      briefing ||
      (async () => {
        used.push('briefing');
        return 'Projeto inbox: 3 páginas.';
      }),
    query: async () => {
      used.push('query');
      return 'resultado da busca';
    },
  };
  ctx.integrations = { claude: { exe: process.execPath, installed: true } };
  ctx.workdir = () => __dirname;
  ctx.permissions = { cancelChat() {}, ask: async () => ({ allow: true }) };
  const dump = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-sm-')), 'dump.jsonl');
  process.env.FAKE_DUMP = dump;
  process.env.FAKE_MODE = 'auto';
  process.env.FAKE_DELAY = '60000';
  const real = drivers.start;
  drivers.start = (p, spec, c) => real(p, { ...spec, exe: process.execPath, args: [fake] }, { ...c, lingerMs: 50 });
  const done = () => !ctx.jobs.has('c1') && chat.messages.at(-1)?.status !== 'running';
  const dumped = () =>
    fs
      .readFileSync(dump, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  const stop = async () => {
    ctx.endFollowing('c1', 'quit');
    drivers.start = real;
    delete process.env.FAKE_DUMP;
  };
  return { ctx, chat, used, done, dumped, stop };
}

test('first message: profile + briefing + the hint of the mode, and the capture owner for the agent', async () => {
  const h = harness();
  try {
    await send(h.ctx, { chatId: 'c1', text: 'olá' });
    await until(h.done);
    const [first] = h.dumped();
    assert.match(first.text, /Preferências do usuário \(perfil\)/);
    assert.match(first.text, /Prefiro respostas curtas, em português\./);
    assert.match(first.text, /Projeto inbox: 3 páginas\./);
    assert.doesNotMatch(first.text, /só se o perfil falhar/, 'the local copy is only a fallback');
    assert.match(first.text, /Antes de delegar a um subagente/);
    assert.match(first.text, /scope "profile"/);
    assert.equal(first.owner, 'vesta.desktop');
    assert.deepEqual(h.used, ['briefing']);
  } finally {
    await h.stop();
  }
});

test('a briefing that fails falls back to the search', async () => {
  const h = harness({
    briefing: async () => {
      throw new Error('sem briefing');
    },
  });
  try {
    await send(h.ctx, { chatId: 'c1', text: 'olá' });
    await until(h.done);
    assert.deepEqual(h.used, ['query']);
    assert.match(h.dumped()[0].text, /resultado da busca/);
  } finally {
    await h.stop();
  }
});

test('consult mode: the hint does not ask to write; the profile is still read', async () => {
  const h = harness({ mode: 'read' });
  try {
    await send(h.ctx, { chatId: 'c1', text: 'olá' });
    await until(h.done);
    const t = h.dumped()[0].text;
    assert.match(t, /Modo consulta/);
    assert.doesNotMatch(t, /grave-a no perfil/);
    assert.match(t, /Prefiro respostas curtas/);
  } finally {
    await h.stop();
  }
});

test('agent writes to the profile are reported by every provider parser, once per call', () => {
  const seen = [];
  const claude = providers.parser('claude', (e) => e.type === 'memory-write' && seen.push(e));
  claude.accept({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 't1',
          name: 'mcp__vesta-memory__memory_write_page',
          input: { path: 'habits/idioma.md', scope: 'profile', body: '# Idioma\n\nCurto.' },
        },
      ],
    },
  });
  assert.equal(seen[0].scope, 'profile');
  assert.equal(seen[0].path, 'habits/idioma.md');
  const codex = providers.parser('codex', (e) => e.type === 'memory-write' && seen.push(e));
  codex.accept({
    method: 'item/started',
    params: {
      threadId: 'th',
      item: {
        id: 'i1',
        type: 'mcpToolCall',
        server: providers.MEMORY_SERVER,
        tool: 'memory_write_page',
        arguments: { path: 'tools/pnpm.md', scope: 'profile', body: 'x' },
      },
    },
  });
  assert.equal(seen[1].path, 'tools/pnpm.md');
  const opencode = providers.parser('opencode', (e) => e.type === 'memory-write' && seen.push(e));
  const part = (status) => ({
    type: 'tool_use',
    part: {
      tool: providers.MEMORY_SERVER + '_memory_write_page',
      callID: 'c9',
      state: { status, input: { path: 'style/x.md', scope: 'profile' } },
    },
  });
  opencode.accept(part('running'));
  opencode.accept(part('completed'));
  assert.equal(seen.length, 3, 'one event per call, not per update');
});

test('a profile write during a turn is stored with its origin in the app state', async () => {
  const h = harness();
  try {
    // The fake CLI cannot call tools: feed the parser callback the way the driver would.
    await send(h.ctx, { chatId: 'c1', text: 'olá' });
    await until(h.done);
    const session = h.ctx.follows.get('c1');
    session.parse.accept({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't9',
            name: 'mcp__vesta-memory__memory_write_page',
            input: { path: 'habits/idioma.md', scope: 'profile', body: '# Idioma\n\nCurto.' },
          },
        ],
      },
    });
    const meta = h.ctx.store.state.profileMeta['profile/habits/idioma.md'];
    assert.equal(meta.provider, 'claude');
    assert.equal(meta.chatId, 'c1');
    assert.ok(meta.at > 0);
  } finally {
    await h.stop();
  }
});
