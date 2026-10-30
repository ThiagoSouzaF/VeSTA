const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemorySessions, notesFrom, agentOf } = require('../electron/memory/sessions.cjs');

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await tick();
};
const REPLY = JSON.stringify({
  outcomes: [
    { path: 'sessions/x.md', new_title: 'Sessão', new_body_markdown: 'resumo' },
    { path: '_rules/use-ms.md', new_title: 'Use _MS', new_body_markdown: 'regra' },
    { path: 'gotchas/ttl.md', new_title: 'TTL', new_body_markdown: 'armadilha', dry_run: true },
  ],
});

function harness({ settings = {}, idleMs = 60000, consolidate } = {}) {
  const events = [];
  const chat = { id: 'c1', provider: 'claude', projectId: 'p1', memory: true, messages: [] };
  const ctx = {
    store: {
      state: {
        settings: { memoryEnabled: true, capture: true, memoryConsolidate: 'codex', ...settings },
        chats: [chat],
        memories: [{ id: 'old', path: '_rules/use-ms.md', projectId: 'p1', kind: 'insight', title: 'antiga' }],
      },
      save() {},
    },
    sync() {},
    workdir: () => 'C:/proj',
    memory: {
      hook: async (event, agent, payload, projectId) => events.push({ event, agent, payload, projectId }),
      stopWithAnswer: async (agent, payload) => events.push({ event: 'stop+answer', agent, payload }),
      call: async (name, args) => {
        events.push({ event: 'call:' + name, args });
        return consolidate ? consolidate() : REPLY;
      },
    },
  };
  const sessions = createMemorySessions(ctx, { idleMs, settleMs: 0 });
  return { ctx, chat, events, sessions, names: () => events.map((e) => e.event) };
}
const answer = (text = 'feito', extra = {}) => ({
  status: 'done',
  text,
  activities: [
    { kind: 'memory', label: 'Memória compartilhada consultada' },
    { kind: 'tool', label: 'Bash', detail: 'npm test', status: 'done' },
  ],
  ...extra,
});

test('a turn opens a session in vesta/<project> and records prompt, tools and the answer', async () => {
  const h = harness();
  await h.sessions.turnStart(h.chat, 'corrija o login, api_key=sk-abcdefghijklmnopqrstu');
  await h.sessions.turnEnd(h.chat, answer());
  assert.deepEqual(h.names(), ['session-start', 'user-prompt', 'post-tool-use', 'stop+answer']);
  const [start, prompt, tool, stop] = h.events;
  assert.equal(start.agent, 'claude-code');
  assert.equal(start.projectId, 'p1');
  assert.equal(start.payload.cwd, 'C:/proj');
  assert.match(start.payload.session_id, /^[0-9a-f-]{36}$/);
  assert.ok(h.events.every((e) => !e.payload || e.payload.session_id === start.payload.session_id));
  assert.doesNotMatch(prompt.payload.prompt, /sk-abc/, 'secrets are redacted before leaving the app');
  assert.equal(tool.payload.tool_name, 'Bash', 'memory lookups are not reported as tools');
  assert.equal(stop.payload.last_assistant_message, 'feito');
  assert.equal(h.chat.memorySession.turns, 1);
  h.sessions.dispose();
});

test('a second turn reuses the session; idle closes and consolidates it into the Memória notes', async () => {
  const h = harness({ idleMs: 5 });
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  await h.sessions.turnStart(h.chat, 'b');
  await h.sessions.turnEnd(h.chat, answer());
  assert.equal(h.names().filter((n) => n === 'session-start').length, 1);
  await new Promise((r) => setTimeout(r, 30));
  await settle();
  assert.ok(h.names().includes('session-end'));
  const call = h.events.find((e) => e.event === 'call:memory_consolidate');
  assert.equal(call.args.multi_page, true);
  assert.equal(h.chat.memorySession, undefined);
  const mem = h.ctx.store.state.memories;
  assert.deepEqual(
    mem.map((m) => [m.path, m.kind, m.title]),
    [
      ['sessions/x.md', 'session', 'Sessão'],
      ['_rules/use-ms.md', 'insight', 'Use _MS'],
    ],
    'the new version of a page replaces the old one; dry runs are ignored'
  );
  assert.equal(h.sessions.status.lastConsolidation.pages, 2);
});

test('switching AI or project closes the old stretch and opens a new one', async () => {
  const h = harness();
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  const first = h.chat.memorySession.id;
  h.chat.provider = 'codex';
  await h.sessions.turnStart(h.chat, 'b');
  await settle();
  assert.notEqual(h.chat.memorySession.id, first);
  assert.equal(h.chat.memorySession.provider, 'codex');
  const end = h.events.find((e) => e.event === 'session-end');
  assert.equal(end.payload.session_id, first);
  assert.equal(end.payload.reason, 'switch');
  assert.equal(h.events.at(-1).agent, 'codex');
  h.sessions.dispose();
});

test('a new message never waits for a slow consolidation', async () => {
  let release;
  const h = harness({ consolidate: () => new Promise((r) => (release = () => r(REPLY))) });
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  const ending = h.sessions.end(h.chat.id, 'idle');
  await settle();
  assert.ok(release, 'consolidation started');
  await h.sessions.turnStart(h.chat, 'b');
  assert.ok(h.chat.memorySession, 'the next turn opened a new session while the old one consolidates');
  release();
  await ending;
  h.sessions.dispose();
});

test('consolidation off: the session stays local (rule-based page), no LLM call', async () => {
  const h = harness({ settings: { memoryConsolidate: 'off' } });
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  await h.sessions.end(h.chat.id);
  assert.deepEqual(h.names(), ['session-start', 'user-prompt', 'post-tool-use', 'stop+answer', 'session-end']);
  assert.deepEqual(h.ctx.store.state.memoryPending, []);
});

test('nothing is recorded with memory off, capture off or a chat outside the memory', async () => {
  for (const settings of [{ memoryEnabled: false }, { capture: false }]) {
    const h = harness({ settings });
    await h.sessions.turnStart(h.chat, 'a');
    await h.sessions.turnEnd(h.chat, answer());
    assert.deepEqual(h.events, []);
  }
  const h = harness();
  h.chat.memory = false; // quest chat, for example
  await h.sessions.turnStart(h.chat, 'a');
  assert.deepEqual(h.events, []);
});

test('failed answers close the turn without the answer; empty sessions are not consolidated', async () => {
  const h = harness();
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer('', { status: 'error', activities: [] }));
  assert.equal(h.names().at(-1), 'stop');
  const h2 = harness();
  await h2.sessions.turnStart(h2.chat, 'a');
  await h2.sessions.end(h2.chat.id);
  assert.ok(!h2.names().includes('call:memory_consolidate'), 'no finished turn, nothing to consolidate');
});

test('recover closes stretches left open by the previous run; errors are kept for the status', async () => {
  const h = harness({
    consolidate: async () => {
      throw new Error('cota esgotada');
    },
  });
  h.chat.memorySession = { id: 'u', provider: 'claude', projectId: 'p1', startedAt: 1, lastAt: 1, turns: 2 };
  const [result] = await h.sessions.recover();
  assert.equal(result.status, 'rejected');
  assert.equal(h.events[0].payload.reason, 'app-restart');
  assert.match(h.sessions.status.lastError.message, /cota esgotada/);
  assert.equal(h.chat.memorySession, undefined);
});

test('a hook failure does not block the next events of the chat', async () => {
  const h = harness();
  let fail = true;
  const hook = h.ctx.memory.hook;
  h.ctx.memory.hook = async (...a) => {
    if (fail) {
      fail = false;
      throw new Error('servidor fora');
    }
    return hook(...a);
  };
  await assert.rejects(h.sessions.turnStart(h.chat, 'a'), /servidor fora/);
  await h.sessions.turnStart(h.chat, 'b');
  assert.equal(h.names().at(-1), 'user-prompt');
  h.sessions.dispose();
});

test('helpers: agent per AI and parsing of the consolidation reply', () => {
  assert.equal(agentOf('claude'), 'claude-code');
  assert.equal(agentOf('codex'), 'codex');
  assert.equal(agentOf('opencode'), 'opencode');
  assert.equal(agentOf('drael'), 'drael');
  assert.deepEqual(notesFrom('não é json', {}), []);
  const notes = notesFrom(REPLY, { projectId: null, chatId: 'c', now: 5 });
  assert.equal(notes.length, 2);
  assert.equal(notes[1].kind, 'insight');
  assert.equal(notes[1].projectId, null);
});

test('a failed consolidation stays queued and is retried on the next close, at most 3 times', async () => {
  let fails = 1;
  const h = harness({
    consolidate: async () => {
      if (fails-- > 0) throw new Error('codex deslogado');
      return REPLY;
    },
  });
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  await assert.rejects(h.sessions.end(h.chat.id), /codex deslogado/);
  assert.equal(h.ctx.store.state.memoryPending.length, 1, 'kept for a retry (persisted with the store)');
  assert.equal(h.ctx.store.state.memoryPending[0].ended, true, 'session-end is not sent twice');
  await h.sessions.recover();
  await settle();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(h.ctx.store.state.memoryPending, []);
  assert.equal(h.names().filter((n) => n === 'session-end').length, 1);
  assert.equal(h.names().filter((n) => n === 'call:memory_consolidate').length, 2);
  assert.ok(h.ctx.store.state.memories.some((m) => m.path === '_rules/use-ms.md' && m.title === 'Use _MS'));
});

test('a deleted chat is closed on the server without consolidation, and its pending work is dropped', async () => {
  const h = harness();
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  const session = h.chat.memorySession;
  h.ctx.store.state.chats = [];
  h.sessions.forget('c1', session);
  await settle();
  assert.equal(h.names().at(-1), 'session-end');
  assert.equal(h.events.at(-1).payload.reason, 'deleted');
  assert.ok(!h.names().includes('call:memory_consolidate'));
  assert.deepEqual(h.ctx.store.state.memoryPending, []);
});
