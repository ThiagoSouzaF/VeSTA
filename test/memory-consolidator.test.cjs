const test = require('node:test');
const assert = require('node:assert/strict');
const { createConsolidator, normalizeConfig } = require('../electron/memory/consolidator.cjs');
const C = require('../electron/memory/consolidate.cjs');

const HOUR = 3600000;
const T0 = new Date(2026, 10, 23, 10, 0).getTime();
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const msg = (role, text, at, extra = {}) => ({ id: role + at, role, text, createdAt: at, ...extra });
const json = (data) => 'Pronto.\n```json\n' + JSON.stringify(data) + '\n```';

// Two chats with closed stretches (project p1 and the personal space), the memory server and a fake AI.
function setup({ answer, installed = true, consolidation } = {}) {
  let t = T0;
  const sent = [];
  const written = [];
  const chats = [
    {
      id: 'c1',
      title: 'Login mobile',
      projectId: 'p1',
      messages: [
        msg('user', 'o login expira cedo, api_key=sk-abcdefghijklmnopqrstu', T0 - 2000),
        msg('assistant', 'O TTL estava em segundos; passei para milissegundos com _MS.', T0 - 1000, { status: 'done' }),
      ],
    },
    {
      id: 'c2',
      title: 'Ideias',
      projectId: null,
      messages: [msg('user', 'anote: prefiro respostas curtas', T0 - 900)],
    },
  ];
  const state = {
    settings: {},
    projects: [{ id: 'p1', name: 'App mobile' }],
    chats,
    memories: [{ id: 'old', path: '_rules/ttl-em-ms.md', projectId: 'p1', kind: 'insight', title: 'TTL em ms' }],
    consolidation: consolidation || null,
    memoryToConsolidate: [],
  };
  const ctx = {
    store: {
      state,
      save() {},
      addChat(input) {
        const chat = { id: 'h' + (sent.length + chats.length), title: 'Novo chat', messages: [], ...input };
        state.chats.push(chat);
        return chat;
      },
    },
    sync() {},
    memory: { call: async (name, args) => written.push({ name, ...args }) },
  };
  const engine = createConsolidator(ctx, {
    now: () => t,
    installed: () => installed,
    setInterval: () => null,
    send: async (_, { chatId, text }) => {
      const chat = state.chats.find((c) => c.id === chatId);
      sent.push({ chat: { ...chat }, text });
      const reply = typeof answer === 'function' ? answer(text, sent.length) : answer;
      setTimeout(() => {
        if (reply instanceof Error) {
          chat.messages.push({ role: 'assistant', text: '', error: reply.message, status: 'error' });
          engine.onChatDone({ chatId, status: 'error' });
        } else {
          chat.messages.push({ role: 'assistant', text: reply, status: 'done' });
          engine.onChatDone({ chatId, status: 'done' });
        }
      }, 0);
    },
  });
  const close = (chatId, id, projectId) =>
    engine.enqueue({ id, provider: 'claude', projectId, startedAt: T0 - 3000, turns: 1 }, chatId);
  return { state, engine, sent, written, close, at: (ms) => (t = ms) };
}

test('config: Claude by default, daily at 03:00; a bad schedule falls back to it', () => {
  const c = normalizeConfig();
  assert.equal(c.provider, 'claude');
  assert.deepEqual([c.schedule.kind, c.schedule.time], ['daily', '03:00']);
  assert.equal(normalizeConfig({ provider: 'gemini', schedule: { kind: 'weekly', days: [] } }).schedule.kind, 'daily');
  assert.equal(normalizeConfig({ schedule: { kind: 'manual' } }).schedule.kind, 'manual');
  assert.equal(normalizeConfig(null).provider, 'claude', 'a fresh store (consolidation: null)');
});

test('prompt and reply: stretches by project, secrets out, pages to their folders, existing paths kept', () => {
  const { state, close } = setup();
  close('c1', 's1', 'p1');
  close('c2', 's2', null);
  const chatOf = (id) => state.chats.find((c) => c.id === id);
  const batches = C.batchesOf(state.memoryToConsolidate, chatOf, { memories: state.memories });
  assert.deepEqual(
    batches.map((b) => [b.projectId, b.stretches.map((s) => s.item.sessionId), b.pages.map((n) => n.id)]),
    [
      ['p1', ['s1'], ['old']],
      [null, ['s2'], []],
    ],
    'a project with new material also sends its memories'
  );
  const prompt = C.buildConsolidationPrompt({ projectName: 'App mobile', ...batches[0] });
  assert.match(prompt, /projeto "App mobile"/);
  assert.match(prompt, /<conversa id="s1"[^>]*titulo="Login mobile"/);
  assert.match(prompt, /<memoria path="_rules\/ttl-em-ms\.md" titulo="TTL em ms">/);
  assert.doesNotMatch(prompt, /sk-abc/, 'secrets never reach the AI');
  const out = C.parseConsolidationReply(
    json({
      pages: [
        { type: 'rule', title: 'TTL em ms', body: 'Use _MS.', path: '_rules/ttl-em-ms.md' },
        { type: 'gotcha', title: 'TTL em segundos', body: 'Expirava cedo.', path: '../fora.md' },
        { type: 'nonsense', title: 'x', body: 'y' },
        { type: 'decision', title: 'sem corpo', body: '' },
      ],
      sessions: [
        { id: 's1', title: 'Login', summary: 'Corrigiu o TTL.' },
        { id: 'outra', summary: 'não é deste lote' },
      ],
    }),
    { sessionIds: ['s1'], pages: state.memories }
  );
  assert.deepEqual(
    out.pages.map((p) => p.path),
    ['_rules/ttl-em-ms.md', 'gotchas/ttl-em-segundos.md'],
    'an unknown path is never trusted: the page goes to its folder'
  );
  assert.deepEqual(
    out.sessions.map((s) => s.path),
    ['sessions/s1.md']
  );
  assert.throws(() => C.parseConsolidationReply('sem json'), /JSON/);
  assert.deepEqual(C.parseConsolidationReply('{"pages":[]}').pages, []);
});

test('a run writes the pages of each project in a hidden chat and empties the queue', async () => {
  const h = setup({
    answer: (text) =>
      text.includes('App mobile')
        ? json({
            pages: [
              { type: 'rule', title: 'TTL em ms', body: 'Todo TTL em milissegundos.', path: '_rules/ttl-em-ms.md' },
            ],
            sessions: [{ id: 's1', title: 'Login', summary: 'Corrigiu o TTL.' }],
          })
        : json({ pages: [{ type: 'concept', title: 'Respostas curtas', body: 'A pessoa prefere.' }], sessions: [] }),
  });
  assert.throws(() => h.engine.runNow(), /Nada para consolidar/, 'one memory and nothing new: nothing to do');
  h.close('c1', 's1', 'p1');
  h.close('c2', 's2', null);
  h.close('c2', 's2', null);
  assert.equal(h.state.memoryToConsolidate.length, 2, 'a stretch waits once');
  h.engine.runNow();
  assert.throws(() => h.engine.runNow(), /já está rodando/);
  await h.engine.idle();
  assert.equal(h.sent.length, 2, 'one turn per project');
  assert.ok(h.sent.every((s) => s.chat.mode === 'read' && s.chat.memory === false && s.chat.memoryConsolidation));
  assert.ok(!h.state.chats.some((c) => c.memoryConsolidation), 'hidden chats are deleted');
  assert.deepEqual(
    h.written.map((w) => [w.name, w.path, w.project, w.tier]),
    [
      ['memory_write_page', '_rules/ttl-em-ms.md', 'p1', 'semantic'],
      ['memory_write_page', 'sessions/s1.md', 'p1', 'episodic'],
      ['memory_write_page', 'concepts/respostas-curtas.md', 'inbox', 'semantic'],
    ]
  );
  assert.match(h.written[0].body, /^# TTL em ms\n\nTodo TTL em milissegundos\./);
  const mem = h.state.memories;
  assert.equal(mem.filter((m) => m.path === '_rules/ttl-em-ms.md').length, 1, 'the new version replaces the old');
  assert.equal(mem.find((m) => m.path === 'sessions/s1.md').chatId, 'c1');
  assert.deepEqual(h.state.memoryToConsolidate, []);
  const [run] = h.state.consolidation.runs;
  assert.deepEqual(
    [run.status, run.trigger, run.stretches, run.reviewed, run.pages, run.removed],
    ['ok', 'manual', 2, 1, 3, 0]
  );
});

// Repeated memories of one project, a raw page of the old mode and a note the person wrote.
const seedRepeated = (h) => {
  const page = (id, path, kind, title, body, at = T0 - HOUR) => ({
    id,
    path,
    kind,
    title,
    body,
    projectId: 'p1',
    createdAt: at,
  });
  h.state.memories = [
    page('r1', '_rules/ttl-em-ms.md', 'insight', 'TTL em ms', 'Todo TTL em milissegundos.'),
    page('r2', '_rules/ttl-ms.md', 'insight', 'Use _MS', 'Constantes de TTL terminam com _MS.'),
    page('raw', 'conversas/c1/m1.md', 'session', 'Login mobile', 'Usuário: o login expira... IA: TTL em segundos.'),
    page('mine', 'notas/x.md', 'note', 'Minha nota', 'escrita por mim'),
  ];
};

test('the button merges repeated memories into one concise page and deletes what it replaced', async () => {
  const h = setup({
    answer: json({
      pages: [
        {
          type: 'rule',
          title: 'TTL sempre em ms com _MS',
          body: 'Todo TTL em milissegundos; a constante termina com _MS.',
          replaces: ['_rules/ttl-em-ms.md', '_rules/ttl-ms.md', 'notas/x.md'],
        },
      ],
      remove: ['conversas/c1/m1.md', 'nao/existe.md'],
    }),
  });
  seedRepeated(h);
  h.engine.runNow();
  await h.engine.idle();
  const prompt = h.sent[0].text;
  assert.match(prompt, /Memórias atuais \(3,/);
  assert.doesNotMatch(prompt, /escrita por mim/, 'what the person wrote is never sent');
  assert.doesNotMatch(prompt, /Conversas novas/);
  assert.deepEqual(
    h.written.map((w) => [w.name, w.path]),
    [
      ['memory_write_page', '_rules/ttl-sempre-em-ms-com-ms.md'],
      ['memory_delete_page', '_rules/ttl-em-ms.md'],
      ['memory_delete_page', '_rules/ttl-ms.md'],
      ['memory_delete_page', 'conversas/c1/m1.md'],
    ],
    'only memories of the batch are deleted: never the person note, never an unknown path'
  );
  assert.deepEqual(h.state.memories.map((m) => m.path).sort(), ['_rules/ttl-sempre-em-ms-com-ms.md', 'notas/x.md']);
  const [run] = h.state.consolidation.runs;
  assert.deepEqual([run.status, run.reviewed, run.pages, run.removed], ['ok', 3, 1, 3]);
});

test('an answer that would empty the memories without writing anything changes nothing', async () => {
  const h = setup({
    answer: json({ pages: [], remove: ['_rules/ttl-em-ms.md', '_rules/ttl-ms.md', 'conversas/c1/m1.md'] }),
  });
  seedRepeated(h);
  h.engine.runNow();
  await h.engine.idle();
  assert.equal(h.state.consolidation.runs[0].status, 'error');
  assert.match(h.state.consolidation.runs[0].error, /quase todas/);
  assert.equal(h.written.length, 0);
  assert.equal(h.state.memories.length, 4);
});

test('the schedule reviews a project again only when its memories changed since the last pass', async () => {
  const h = setup({
    answer: json({ pages: [], remove: [] }),
    consolidation: { schedule: { kind: 'interval', hours: 1 } },
  });
  seedRepeated(h);
  h.engine.recover();
  h.at(T0 + HOUR);
  h.engine.tick();
  await h.engine.idle();
  assert.equal(h.sent.length, 1, 'never reviewed: it goes');
  h.at(T0 + 2 * HOUR);
  h.engine.tick();
  await h.engine.idle();
  assert.equal(h.sent.length, 1, 'nothing changed since');
  h.state.memories.push({
    id: 'n',
    path: 'gotchas/novo.md',
    kind: 'insight',
    title: 'Novo',
    body: 'x',
    projectId: 'p1',
    createdAt: T0 + 2 * HOUR + 1,
  });
  h.at(T0 + 3 * HOUR);
  h.engine.tick();
  await h.engine.idle();
  assert.equal(h.sent.length, 2, 'a new memory: reviewed again');
});

test('a failed run keeps the stretches for the next one, at most 3 times; a deleted chat is left out', async () => {
  const h = setup({ answer: new Error('cota esgotada') });
  h.close('c1', 's1', 'p1');
  for (let i = 1; i <= 3; i++) {
    h.engine.runNow();
    await h.engine.idle();
    assert.equal(h.state.consolidation.runs[0].status, 'error');
    assert.match(h.state.consolidation.runs[0].error, /cota esgotada/);
    assert.equal(h.state.memoryToConsolidate.length, i < 3 ? 1 : 0);
  }
  assert.equal(h.written.length, 0);
  h.close('c2', 's2', null);
  h.engine.forgetChat('c2');
  assert.deepEqual(h.state.memoryToConsolidate, []);
});

test('the AI must be installed; settings validate the AI and the schedule', () => {
  const h = setup({ installed: false });
  h.close('c1', 's1', 'p1');
  assert.throws(() => h.engine.runNow(), /não está instalada/);
  assert.throws(() => h.engine.configure({ provider: 'gemini' }), /Escolha a IA/);
  assert.throws(() => h.engine.configure({ schedule: { kind: 'weekly', days: [] } }), /dia da semana/);
  h.engine.configure({ provider: 'codex', model: 'gpt-x', schedule: { kind: 'interval', hours: 6 } });
  assert.deepEqual(
    [h.state.consolidation.provider, h.state.consolidation.model, h.state.consolidation.nextRunAt],
    ['codex', 'gpt-x', T0 + 6 * HOUR]
  );
  h.engine.configure({ provider: 'opencode' });
  assert.equal(h.state.consolidation.model, '', 'another AI forgets the model of the previous one');
  h.engine.configure({ schedule: { kind: 'manual' } });
  assert.equal(h.state.consolidation.nextRunAt, null);
});

test('the clock runs it on time (also a time missed while closed) and skips quietly with nothing waiting', async () => {
  const h = setup({
    answer: json({ pages: [], sessions: [] }),
    consolidation: { schedule: { kind: 'interval', hours: 1 } },
  });
  h.state.chats.push({ id: 'left', memoryConsolidation: 'x', messages: [] });
  h.engine.recover();
  assert.ok(!h.state.chats.some((c) => c.id === 'left'), 'hidden chats of the previous run go');
  assert.equal(h.state.consolidation.nextRunAt, T0 + HOUR);
  h.engine.tick();
  assert.equal(h.sent.length, 0, 'not yet');
  h.at(T0 + HOUR);
  h.engine.tick();
  assert.equal(h.state.consolidation.runs.length, 0, 'nothing waiting: no run recorded');
  assert.equal(h.state.consolidation.nextRunAt, T0 + 2 * HOUR);
  h.close('c1', 's1', 'p1');
  h.at(T0 + 5 * HOUR); // VeSTA was closed past the time
  h.engine.tick();
  await h.engine.idle();
  await settle();
  assert.equal(h.sent.length, 1);
  assert.equal(h.state.consolidation.runs[0].trigger, 'schedule');
  assert.equal(h.state.consolidation.nextRunAt, T0 + 6 * HOUR);
});

test('a run interrupted by closing VeSTA is closed at the next start', () => {
  const h = setup({
    consolidation: { runs: [{ id: 'r', status: 'running', at: 1, trigger: 'manual', stretches: 1, pages: 0 }] },
  });
  h.engine.recover();
  assert.equal(h.state.consolidation.runs[0].status, 'error');
  assert.match(h.state.consolidation.runs[0].error, /fechou/);
});
