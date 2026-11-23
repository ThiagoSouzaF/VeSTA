const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemorySessions, agentOf } = require('../electron/memory/sessions.cjs');

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++) await tick();
};
function harness({ settings = {}, idleMs = 60000 } = {}) {
  const events = [];
  const queued = [];
  const forgotten = [];
  const chat = { id: 'c1', provider: 'claude', projectId: 'p1', memory: true, messages: [] };
  const ctx = {
    store: {
      state: { settings: { memoryEnabled: true, capture: true, ...settings }, chats: [chat], memories: [] },
      save() {},
    },
    sync() {},
    workdir: () => 'C:/proj',
    memory: {
      hook: async (event, agent, payload, projectId) => events.push({ event, agent, payload, projectId }),
      stopWithAnswer: async (agent, payload) => events.push({ event: 'stop+answer', agent, payload }),
      call: async (name, args) => events.push({ event: 'call:' + name, args }),
    },
    consolidator: {
      enqueue: (session, chatId) => queued.push({ session, chatId }),
      forgetChat: (chatId) => forgotten.push(chatId),
    },
  };
  const sessions = createMemorySessions(ctx, { idleMs });
  return { ctx, chat, events, queued, forgotten, sessions, names: () => events.map((e) => e.event) };
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

test('a second turn reuses the session; idle closes it, and it waits for the consolidation', async () => {
  const h = harness({ idleMs: 5 });
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  await h.sessions.turnStart(h.chat, 'b');
  await h.sessions.turnEnd(h.chat, answer());
  assert.equal(h.names().filter((n) => n === 'session-start').length, 1);
  const id = h.chat.memorySession.id;
  await new Promise((r) => setTimeout(r, 30));
  await settle();
  assert.ok(h.names().includes('session-end'));
  assert.ok(!h.names().some((n) => n.startsWith('call:')), 'the server never consolidates on its own');
  assert.equal(h.chat.memorySession, undefined);
  assert.deepEqual(
    h.queued.map((q) => [q.session.id, q.session.turns, q.chatId]),
    [[id, 2, 'c1']]
  );
  assert.deepEqual(h.ctx.store.state.memoryPending, []);
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

test('end resolves with the closed session once the server has it', async () => {
  const h = harness();
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  const id = h.chat.memorySession.id;
  assert.equal((await h.sessions.end(h.chat.id)).id, id);
  assert.equal(await h.sessions.end(h.chat.id), null, 'nothing open: nothing to close');
  assert.deepEqual(h.names(), ['session-start', 'user-prompt', 'post-tool-use', 'stop+answer', 'session-end']);
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

test('failed answers close the turn without the answer; empty sessions do not wait for the consolidation', async () => {
  const h = harness();
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer('', { status: 'error', activities: [] }));
  assert.equal(h.names().at(-1), 'stop');
  await h.sessions.end(h.chat.id);
  assert.deepEqual(h.queued, [], 'no finished turn, nothing to consolidate');
});

test('recover closes stretches left open by the previous run; errors are kept for the status', async () => {
  const h = harness();
  h.ctx.memory.hook = async () => {
    throw new Error('servidor fora');
  };
  h.chat.memorySession = { id: 'u', provider: 'claude', projectId: 'p1', startedAt: 1, lastAt: 1, turns: 2 };
  const [result] = await h.sessions.recover();
  assert.equal(result.status, 'rejected');
  assert.match(h.sessions.status.lastError.message, /servidor fora/);
  assert.equal(h.chat.memorySession, undefined);
  assert.equal(h.ctx.store.state.memoryPending.length, 1, 'kept for a retry (persisted with the store)');
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

test('helpers: agent per AI', () => {
  assert.equal(agentOf('claude'), 'claude-code');
  assert.equal(agentOf('codex'), 'codex');
  assert.equal(agentOf('opencode'), 'opencode');
  assert.equal(agentOf('drael'), 'drael');
});

test('a failed close stays queued and is retried on the next start, at most 3 times', async () => {
  const h = harness();
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  const hook = h.ctx.memory.hook;
  let fails = 1;
  h.ctx.memory.hook = async (...a) => {
    if (a[0] === 'session-end' && fails-- > 0) throw new Error('servidor fora');
    return hook(...a);
  };
  await assert.rejects(h.sessions.end(h.chat.id), /servidor fora/);
  assert.equal(h.ctx.store.state.memoryPending.length, 1);
  assert.deepEqual(h.queued, []);
  await h.sessions.recover();
  await settle();
  assert.deepEqual(h.ctx.store.state.memoryPending, []);
  assert.equal(h.queued.length, 1, 'once closed on the server it waits for the consolidation');
});

test('a deleted chat is closed on the server and never waits for the consolidation', async () => {
  const h = harness();
  await h.sessions.turnStart(h.chat, 'a');
  await h.sessions.turnEnd(h.chat, answer());
  const session = h.chat.memorySession;
  h.ctx.store.state.chats = [];
  h.sessions.forget('c1', session);
  await settle();
  assert.equal(h.names().at(-1), 'session-end');
  assert.equal(h.events.at(-1).payload.reason, 'deleted');
  assert.deepEqual(h.queued, []);
  assert.deepEqual(h.forgotten, ['c1'], 'what waited for the consolidation goes too');
  assert.deepEqual(h.ctx.store.state.memoryPending, []);
});
