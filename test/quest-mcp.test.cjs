const { test, after } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const Q = require('../electron/shared/quests.cjs');
const { Store } = require('../electron/app/store.cjs');
const { createQuestEngine } = require('../electron/quests/engine.cjs');
const { createQuestMcp, TOOLS } = require('../electron/quests/mcp.cjs');

// Real engine and real server; only the AI turn (`send`) is fake.
function setup() {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-qmcp-')));
  const sent = [],
    stoppedChats = [],
    stoppedTasks = [];
  const ctx = {
    store,
    sync() {},
    jobs: new Map(),
    integrations: {
      claude: { installed: true, models: ['haiku', 'sonnet'] },
      codex: { installed: true, models: [] },
    },
    project: () => null,
    stopChat: (id) => (ctx.jobs.has(id) ? (stoppedChats.push(id), true) : false),
    stopTask: (chatId, taskId) => (stoppedTasks.push([chatId, taskId]), true),
  };
  const engine = createQuestEngine(ctx, {
    send: async (_, { chatId, text }) => {
      const chat = store.chat(chatId);
      chat.messages.push({ role: 'user', text }, { role: 'assistant', text: '', status: 'running' });
      sent.push({ chatId, text });
      ctx.jobs.set(chatId, {});
    },
  });
  const mcp = createQuestMcp(ctx, { engine });
  const steps = [
    { id: 's1', title: 'Criar', instructions: 'crie', provider: 'claude' },
    { id: 's2', title: 'Revisar', instructions: 'revise', provider: 'claude', dependsOn: ['s1'] },
  ];
  const finish = (chatId, text) => {
    const m = store.chat(chatId).messages.at(-1);
    Object.assign(m, { text, status: 'done' });
    ctx.jobs.delete(chatId);
    engine.onChatDone({ chatId, status: 'done' });
  };
  return { store, ctx, engine, mcp, sent, stoppedChats, stoppedTasks, steps, finish };
}
const all = [];
after(async () => {
  for (const s of all) await s.mcp.close();
});
async function connect(s, chat, token) {
  const ep = await s.mcp.endpointFor(chat);
  const transport = new StreamableHTTPClientTransport(new URL(ep.mcp), {
    requestInit: { headers: { Authorization: 'Bearer ' + (token ?? ep.token) } },
  });
  const client = new Client({ name: 't', version: '1' });
  await client.connect(transport);
  return {
    client,
    ep,
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      const text = r.content[0].text;
      return { error: !!r.isError, text, json: r.isError ? null : JSON.parse(text) };
    },
  };
}
const twoQuests = async () => {
  const s = setup();
  all.push(s);
  const a = s.engine.createQuest({ title: 'A', goal: 'ga', steps: s.steps });
  const b = s.engine.createQuest({ title: 'B', goal: 'gb', steps: s.steps });
  return { s, a, b, leadA: s.store.chat(a.leadChatId), leadB: s.store.chat(b.leadChatId) };
};

test('server: wrong or missing token is 401, other paths and hosts are refused, only lead chats get an endpoint', async () => {
  const { s, a, leadA } = await twoQuests();
  const ep = await s.mcp.endpointFor(leadA);
  assert.match(ep.mcp, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.ok(/^[0-9a-f]{48}$/.test(ep.token));
  const post = (headers, url = ep.mcp) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
  assert.equal((await post({})).status, 401, 'no token');
  assert.equal((await post({ authorization: 'Bearer nope' })).status, 401, 'wrong token');
  assert.equal((await post({ authorization: 'Bearer ' + ep.token.slice(0, -1) })).status, 401, 'truncated token');
  assert.equal((await post({ authorization: 'Basic ' + ep.token })).status, 401);
  const ok = await post({ authorization: 'Bearer ' + ep.token });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).result.tools.length, TOOLS.length);
  assert.equal((await post({ authorization: 'Bearer ' + ep.token }, ep.url + '/outra')).status, 404);
  const get = await fetch(ep.mcp, { headers: { authorization: 'Bearer ' + ep.token } });
  assert.equal(get.status, 405);
  // A step chat or a normal chat never gets a credential.
  s.engine.startQuest({ id: a.id });
  await new Promise((r) => setImmediate(r));
  assert.equal(await s.mcp.endpointFor(s.store.chat(s.sent[0].chatId)), null);
  assert.equal(await s.mcp.endpointFor(s.store.addChat({ provider: 'claude' })), null);
  // Tokens are per chat and per run; the same chat keeps its token.
  const other = await s.mcp.endpointFor(s.store.chat(s.store.state.quests[0].leadChatId));
  assert.notEqual(other.token, ep.token);
  assert.equal((await s.mcp.endpointFor(leadA)).token, ep.token);
  // Deleting the chat revokes the token.
  s.store.state.chats = s.store.state.chats.filter((c) => c.id !== leadA.id);
  assert.equal((await post({ authorization: 'Bearer ' + ep.token })).status, 401);
});

test('scope: the quest comes from the token; ids from another quest are refused and nothing there changes', async () => {
  const { s, a, b, leadA } = await twoQuests();
  s.engine.startQuest({ id: b.id });
  await new Promise((r) => setImmediate(r));
  const chatOfB = s.store.chat(b.steps[0].chatId);
  const t = await connect(s, leadA);
  // quest_get shows A only
  const got = (await t.call('quest_get')).json;
  assert.equal(got.id, a.id);
  assert.equal(got.titulo, 'A');
  assert.deepEqual(
    got.etapas.map((x) => x.id),
    ['s1', 's2']
  );
  assert.ok(got.etapas.every((x) => x.status === 'pending'));
  // The model cannot name another quest: an `id` argument is dropped, never used.
  const sneaky = (await t.call('quest_get', { id: b.id })).json;
  assert.equal(sneaky.id, a.id);
  const upd = await t.call('step_update', { id: b.id, stepId: 's1', title: 'invadida' });
  assert.equal(upd.json.etapa.titulo, 'invadida');
  assert.equal(a.steps[0].title, 'invadida', 'applied to the caller quest');
  assert.equal(b.steps[0].title, 'Criar', 'the other quest is untouched');
  // A's s1 has no chat yet; B's chat id is outside this quest.
  for (const [name, args] of [
    ['chat_read', { chatId: chatOfB.id }],
    ['chat_read', { stepId: 's1' }],
    ['chat_send', { stepId: 's1', mensagem: 'oi' }],
    ['task_stop', { chatId: chatOfB.id, taskId: 't1' }],
    ['chat_stop', { stepId: 's1' }],
    ['chat_read', { chatId: leadA.id }],
    ['chat_read', { chatId: b.leadChatId }],
  ]) {
    const r = await t.call(name, args);
    assert.ok(r.error, name + ' ' + JSON.stringify(args) + ' should be refused');
  }
  assert.match((await t.call('chat_read', { chatId: chatOfB.id })).text, /não pertence a nenhuma etapa desta quest/);
  assert.equal(s.sent.filter((x) => x.chatId === chatOfB.id).length, 1, 'only the step prompt reached B');
  assert.equal(s.stoppedTasks.length, 0);
  assert.equal(b.steps[0].status, 'running');
  // A step id that exists only in the other quest.
  await t.call('step_add', { title: 'extra', instructions: 'x' });
  const extra = a.steps.at(-1).id;
  assert.equal(
    b.steps.some((x) => x.id === extra),
    false
  );
  const outsider = await t.call('step_update', { stepId: 's9', title: 'x' });
  assert.ok(outsider.error);
  assert.match(outsider.text, /não encontrada nesta quest/);
});

test('tools: the quest chat swaps a step AI, adds, removes, skips and controls the quest; the journal says who', async () => {
  const { s, a, leadA } = await twoQuests();
  const t = await connect(s, leadA);
  const upd = await t.call('step_update', { stepId: 's2', provider: 'codex', mode: 'read' });
  assert.equal(upd.json.etapa.ia, 'codex');
  assert.equal(a.steps[1].provider, 'codex');
  assert.equal(a.steps[1].model, '');
  assert.match(a.log.at(-1).text, /\(chat da quest\): IA claude → codex/);
  const bad = await t.call('step_update', { stepId: 's2', provider: 'opencode' });
  assert.ok(bad.error);
  assert.match(bad.text, /não está instalada/);
  const added = await t.call('step_add', {
    title: 'Extra',
    instructions: 'faça extra',
    dependsOn: ['s2'],
    provider: 'claude',
    model: 'haiku',
  });
  assert.equal(added.json.etapa.id, 's3');
  assert.equal((await t.call('step_remove', { stepId: 's3' })).json.restantes.length, 2);
  assert.ok((await t.call('step_remove', { stepId: 's9' })).error);
  assert.equal((await t.call('quest_start')).json.situacao, 'running');
  await new Promise((r) => setImmediate(r));
  assert.equal(s.sent.length, 1, 'quest started by the quest chat runs s1');
  assert.equal((await t.call('step_update', { stepId: 's1', provider: 'codex' })).error, true, 'running step refused');
  assert.equal(
    (await t.call('step_update', { stepId: 's2', provider: 'claude' })).json.etapa.ia,
    'claude',
    'pending step changes while running'
  );
  assert.equal((await t.call('quest_pause')).json.situacao, 'paused');
  assert.equal((await t.call('quest_resume')).json.situacao, 'running');
  assert.equal((await t.call('step_skip', { stepId: 's2' })).json.etapa.status, 'skipped');
  assert.ok(a.log.some((e) => /Chat da quest: pausou/.test(e.text)));
  s.finish(a.steps[0].chatId, 'feito\n## Resultado\nresultado real da etapa 1');
  await new Promise((r) => setImmediate(r));
  assert.equal(a.status, 'done');
});

test('chat_read returns the step history; chat_send, activity_get, task_stop and chat_stop act on step chats of this quest', async () => {
  const { s, a, leadA } = await twoQuests();
  const t = await connect(s, leadA);
  s.engine.startQuest({ id: a.id });
  await new Promise((r) => setImmediate(r));
  const chatId = a.steps[0].chatId;
  const chat = s.store.chat(chatId);
  chat.messages.at(-1).activities = [
    { kind: 'command', label: 'Bash', detail: 'npm test', status: 'running', taskId: 'task-9' },
  ];
  const act = (await t.call('activity_get')).json;
  assert.equal(act.chats.length, 1);
  assert.equal(act.chats[0].etapa, 's1');
  assert.equal(act.chats[0].respondendo, true);
  assert.ok(act.chats[0].tarefas.some((x) => x.taskId === 'task-9' && x.encerravel));
  const busy = await t.call('chat_send', { stepId: 's1', mensagem: 'oi' });
  assert.ok(busy.error);
  assert.match(busy.text, /respondendo agora/);
  assert.equal((await t.call('task_stop', { chatId, taskId: 'task-9' })).json.encerrada, true);
  assert.deepEqual(s.stoppedTasks, [[chatId, 'task-9']]);
  assert.equal((await t.call('chat_stop', { stepId: 's1' })).json.interrompida, true);
  assert.deepEqual(s.stoppedChats, [chatId]);
  s.finish(chatId, 'Conteúdo longo da etapa 1\n## Resultado\nArquivo nota.txt criado');
  await new Promise((r) => setImmediate(r));
  const read = (await t.call('chat_read', { stepId: 's1' })).json;
  assert.equal(read.etapa, 's1');
  assert.equal(read.respondendo, false);
  assert.equal(read.total, 2);
  assert.match(read.mensagens[1].texto, /Arquivo nota\.txt criado/);
  assert.equal(read.proximo, null);
  assert.equal((await t.call('chat_read', { chatId })).json.mensagens.length, 2, 'by chat id as well');
  const sent = (await t.call('chat_send', { stepId: 's1', mensagem: 'Pode detalhar?' })).json;
  assert.equal(sent.enviada, true);
  assert.equal(s.sent.at(-1).text, 'Pode detalhar?');
  assert.ok(a.log.some((e) => /Mensagem enviada ao chat da etapa/.test(e.text)));
});
