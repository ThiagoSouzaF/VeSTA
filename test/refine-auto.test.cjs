// Refining on its own: the signals (no AI), the hidden-chat turn, the automatic review on its schedule and the test
// of a skill proposal (A/B with a blind judge, and the description picking the skill).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const R = require('../electron/shared/refine.cjs');
const { createAsker, parseJson } = require('../electron/refine/ask.cjs');
const { createAutoRefiner, normalizeAuto } = require('../electron/refine/auto.cjs');
const T = require('../electron/refine/trial.cjs');
const { createSkills } = require('../electron/skills/engine.cjs');
const { createRefiner } = require('../electron/refine/engine.cjs');
const { createAgentEngine } = require('../electron/agents/engine.cjs');
const { Store } = require('../electron/app/store.cjs');

const dirs = [];
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const SKILL = (name, desc, body = 'Faça com cuidado.') => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;
const chat = (id, messages, extra = {}) => ({ id, title: id, messages, ...extra });
const user = (text, createdAt) => ({ role: 'user', text, createdAt });
const reply = (text, extra = {}) => ({ role: 'assistant', text, status: 'done', ...extra });

test('signals: uses, corrections and errors since the last review; hidden chats do not count', () => {
  const chats = [
    chat('ok', [user('/x faça', 1000), reply('feito'), user('obrigado', 5000)]),
    chat('fix', [user('/x faça', 1000), reply('feito'), user('Não, era em português', 5000)]),
    chat('err', [user('/x faça', 1000), reply('', { status: 'error', error: 'falhou' })]),
    chat('hid', [user('/x', 1000), reply('a'), user('não', 2000)], { refineRun: true }),
  ];
  const recent = ['ok', 'fix', 'err', 'hid', 'gone'].map((chatId) => ({ chatId, at: 1500 }));
  assert.deepEqual(R.skillSignals({ recent }, chats), { since: 0, uses: 3, corrections: 1, errors: 1 });
  assert.equal(R.skillSignals({ recent, reviewedAt: 2000 }, chats).uses, 0, 'already reviewed');
  assert.ok(R.isCorrection('Na verdade, quero outra coisa') && !R.isCorrection('Nossa, ótimo'));

  const agent = {
    reviewedAt: 10,
    runs: [
      { at: 50, status: 'error', chatId: null },
      { at: 40, status: 'ok', chatId: 'run' },
      { at: 5, status: 'error' },
    ],
    lessons: [
      { status: 'pending', at: 30 },
      { status: 'pending', at: 1 },
      { status: 'kept', at: 30 },
    ],
  };
  const runChat = chat('run', [user('tarefa', 40), reply('feito'), user('Errado, use a pasta certa', 60)]);
  assert.deepEqual(R.agentSignals(agent, [runChat]), { since: 10, runs: 2, errors: 1, corrections: 1, pending: 1 });

  assert.equal(R.reviewWeight('skill', { enabled: true }, { uses: 4, corrections: 0, errors: 0 }), 0);
  assert.equal(R.reviewWeight('skill', { enabled: true }, { uses: 5, corrections: 0, errors: 0 }), 1, 'much use');
  assert.equal(R.reviewWeight('skill', { enabled: false }, { uses: 9, corrections: 3, errors: 0 }), 0);
  assert.equal(R.reviewWeight('skill', { proposal: {} }, { uses: 9, corrections: 3, errors: 0 }), 0, 'one at a time');
  const list = R.candidates({
    skills: [
      { name: 'x', enabled: true, recent },
      { name: 'quieta', enabled: true, recent: [] },
    ],
    agents: [{ id: 'a', name: 'Agent', ...agent }],
    chats: [...chats, runChat],
  });
  assert.deepEqual(
    list.map((c) => c.label),
    ['/x', 'Agent'],
    'the most urgent first; nothing for the quiet one'
  );
});

test('parseJson: a json block, or the first object or list in the text', () => {
  assert.deepEqual(parseJson('Aqui:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('resultado [{"pedido":1}] fim'), [{ pedido: 1 }]);
  assert.deepEqual(parseJson('[{"a":1},{"b":2}]'), [{ a: 1 }, { b: 2 }]);
  assert.equal(parseJson('nada aqui'), null);
});

test('ask: one turn in a hidden chat (no memory, out of the lists), the chat goes when it ends', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-ask-'));
  dirs.push(dir);
  const store = new Store(dir);
  const ctx = { store };
  let seen;
  const asker = createAsker(ctx, {
    installed: () => true,
    send: async (_ctx, { chatId, text }) => {
      seen = store.chat(chatId);
      assert.equal(text, 'pergunta');
      setImmediate(() => {
        seen.messages.push(reply('resposta'));
        asker.onChatDone({ chatId, status: 'done' });
      });
    },
  });
  const answer = await asker.ask({ provider: 'claude', refine: { kind: 'skill', name: 'x' } }, 'pergunta');
  assert.equal(answer, 'resposta');
  assert.equal(seen.refineRun, true);
  assert.equal(seen.memory, false);
  assert.equal(seen.mode, 'read');
  assert.deepEqual(seen.refine, { kind: 'skill', name: 'x' });
  assert.equal(store.state.chats.length, 0, 'the hidden chat is gone');
  const failing = createAsker(ctx, {
    installed: () => true,
    send: async (_ctx, { chatId }) => setImmediate(() => failing.onChatDone({ chatId, status: 'error' })),
  });
  await assert.rejects(failing.ask({ provider: 'claude' }, 'x'), /parou/);
  await assert.rejects(
    createAsker(ctx, { installed: () => false }).ask({ provider: 'codex' }, 'x'),
    /não está instalada/
  );
  store.state.chats.push({ id: 'left', refineRun: true, messages: [] }, { id: 'mine', messages: [] });
  asker.recover();
  assert.deepEqual(
    store.state.chats.map((c) => c.id),
    ['mine']
  );
});

// A store with the library, an agent engine, the refiner and a fake AI behind `ask` (answers by the title it gets).
function setup(answer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-auto-'));
  dirs.push(dir);
  const store = new Store(dir);
  const ctx = { store, sync() {}, state: () => store.state };
  ctx.skills = createSkills(ctx, {
    root: path.join(dir, 'skills'),
    deps: { native: () => ({ claude: [], codex: [], opencode: [] }) },
  });
  ctx.agents = createAgentEngine(ctx, { installed: () => true, send: async () => {}, setInterval: () => null });
  ctx.refiner = createRefiner(ctx, { installed: () => true, send: async () => {} });
  const asked = [];
  ctx.refineAsker = {
    ask: async (opts, text) => {
      asked.push({ opts, text });
      return answer(opts, text, ctx);
    },
  };
  return { ctx, store, lib: ctx.skills.lib, asked };
}

test('automatic review: the item with signals goes to the AI; what it proposes waits; it counts as reviewed', async () => {
  let t = new Date(2026, 10, 24, 10, 0).getTime();
  const { ctx, store, lib, asked } = setup((opts, _text, c) => {
    // The AI proposes for the skill and finds nothing to change in the agent.
    if (opts.refine.kind === 'skill')
      c.refiner.propose(
        { refine: opts.refine, refineRun: true, provider: opts.provider },
        { texto: SKILL('x', 'Faz X. Use quando Y.', 'Em português.'), mudancas: ['Pede português'] }
      );
    return 'ok';
  });
  lib.install({ name: 'x', text: SKILL('x', 'Faz X.') });
  lib.install({ name: 'quieta', text: SKILL('quieta', 'Quieta.') });
  // The request, the use of the skill (recorded now) and, a minute later, the person's correction.
  const at = Date.now();
  store.state.chats.push(chat('fix', [user('/x', at - 10), reply('done'), user('Não, em português', at + 60000)]));
  lib.used('x', 'fix');
  const id = ctx.agents.create({ name: 'Revisor', prompt: 'Revise.', provider: 'claude' });
  store.state.agents[0].runs = [{ id: 'r', at: Date.now(), status: 'error', error: 'falhou', chatId: null }];
  const auto = createAutoRefiner(ctx, { now: () => t, installed: () => true, setInterval: () => null });
  auto.recover();
  assert.deepEqual(normalizeAuto(store.state.refineAuto).enabled, false, 'off until the person turns it on');
  assert.deepEqual(
    auto.candidates().map((c) => c.label),
    ['/x', 'Revisor']
  );
  auto.runNow();
  await auto.idle();
  const run = store.state.refineAuto.runs[0];
  assert.equal(run.status, 'ok');
  assert.equal(run.reviewed, 2);
  assert.equal(run.proposed, 1);
  assert.match(asked[0].text, /Revisão automática[\s\S]*Não faça perguntas/);
  assert.equal(asked[0].opts.title, 'Revisão automática · /x');
  const p = lib.get('x').proposal;
  assert.equal(p.from, 'auto');
  assert.equal(p.chatId, null, 'the hidden chat goes; there is no chat to open');
  assert.match(lib.read('x').text, /Faz X\.\n/, 'nothing in use changed');
  assert.ok(lib.get('x').reviewedAt > 0 && store.state.agents[0].reviewedAt > 0);
  assert.deepEqual(auto.candidates(), [], 'reviewed: the same signals do not bring them back');
  assert.throws(() => auto.runNow(), /Nada para revisar/);

  // The schedule only runs when turned on.
  auto.configure({ enabled: true, schedule: { kind: 'daily', time: '11:00' } });
  assert.equal(store.state.refineAuto.nextRunAt, new Date(2026, 10, 24, 11, 0).getTime());
  store.state.agents[0].runs.unshift({ id: 'r2', at: Date.now() + 1, status: 'error', error: 'de novo' });
  t = new Date(2026, 10, 24, 11, 1).getTime();
  auto.tick();
  await auto.idle();
  assert.equal(store.state.refineAuto.runs[0].trigger, 'schedule');
  assert.equal(store.state.refineAuto.runs[0].reviewed, 1);
  assert.ok(ctx.refiner.proposal({ kind: 'agent', id }) === null, 'no reason, no proposal');
  auto.configure({ enabled: false });
  assert.equal(store.state.refineAuto.nextRunAt, null);
});

test('trial: blind A/B order mapped back, the description routing scored, the plan read', () => {
  const cases = [{ pedido: 'p1' }, { pedido: 'p2' }, { pedido: 'p3' }];
  const answers = cases.map(() => ({ atual: 'resposta antiga', proposta: 'resposta nova' }));
  const flips = [true, false, false];
  const prompt = T.judgePrompt(cases, answers, flips);
  assert.match(prompt, /Pedido 1\np1[\s\S]*Resposta A\nresposta nova/, 'the proposal is A when flipped');
  assert.doesNotMatch(prompt, /proposta|atual/i, 'the judge is not told which is which');
  const judged = T.readJudge(
    '```json\n[{"pedido":1,"vencedor":"A","motivo":"m"},{"pedido":2,"vencedor":"A"},{"pedido":3,"vencedor":"empate"}]\n```',
    cases,
    flips
  );
  assert.deepEqual(
    judged.map((c) => c.winner),
    ['proposta', 'atual', 'empate']
  );
  const triggers = [
    { pedido: 'faça um commit', deve: true },
    { pedido: 'explique o git', deve: false },
  ];
  assert.match(T.routePrompt([{ name: 'commit', description: 'Commits.' }], triggers), /- commit: Commits\./);
  assert.deepEqual(T.readRoute('[{"pedido":1,"skill":"/commit"},{"pedido":2,"skill":"commit"}]', triggers, 'commit'), [
    true,
    false,
  ]);
  const plan = T.readPlan(
    '{"testes":[{"pedido":"a","esperado":"b"}],"gatilhos":[{"pedido":"g","deve":true},{"pedido":""}]}',
    { tests: true, triggers: true }
  );
  assert.deepEqual(plan, { tests: [{ pedido: 'a', esperado: 'b' }], triggers: [{ pedido: 'g', deve: true }] });
  assert.match(T.trialPrompt(SKILL('x', 'X.', 'Corpo da skill'), 'faça'), /Corpo da skill[\s\S]*Pedido: faça/);
});

test('trial engine: both versions answer each request, the judge decides, the result stays on the proposal', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { ctx, lib, asked } = setup(async (opts, text) => {
    const title = opts.title.split(' · ').pop();
    if (title === 'plano')
      return '```json\n{"gatilhos":[{"pedido":"faça um commit","deve":true},{"pedido":"oi","deve":false}]}\n```';
    if (title === 'atual' || title === 'proposta') return title + ': ' + text.slice(-20);
    if (title === 'juiz') {
      await gate;
      // whichever is the proposal wins (the judge sees it in the answer text here)
      const order = [...text.matchAll(/### Resposta A\n(\w+)/g)].map((m) => m[1]);
      return JSON.stringify(order.map((who, i) => ({ pedido: i + 1, vencedor: who === 'proposta' ? 'A' : 'B' })));
    }
    if (title === 'descrição')
      return text.includes('Use quando pedir commit')
        ? '[{"pedido":1,"skill":"x"},{"pedido":2,"skill":null}]'
        : '[{"pedido":1,"skill":null},{"pedido":2,"skill":null}]';
    throw new Error('unexpected ' + title);
  });
  lib.install({ name: 'x', text: SKILL('x', 'Faz X.') });
  lib.setProposal('x', {
    text: SKILL('x', 'Faz X. Use quando pedir commit.', 'Nova'),
    changes: ['a'],
    provider: 'claude',
    tests: [
      { pedido: 'teste um', esperado: 'e1' },
      { pedido: 'teste dois', esperado: 'e2' },
    ],
  });
  const trials = T.createTrials(ctx, { random: () => 0.9 });
  assert.throws(() => trials.start({ name: 'nada' }), /não encontrada/);
  trials.start({ name: 'x' });
  assert.throws(() => trials.start({ name: 'x' }), /já está sendo testada/);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(lib.get('x').proposal.test.status, 'running');
  release();
  for (let i = 0; i < 50 && lib.get('x').proposal.test.status === 'running'; i++)
    await new Promise((r) => setTimeout(r, 10));
  const result = lib.get('x').proposal.test;
  assert.equal(result.status, 'done', result.error);
  assert.deepEqual(result.wins, { proposta: 2, atual: 0, empate: 0 });
  assert.equal(result.cases[0].pedido, 'teste um', 'the tests the proposal brought');
  assert.deepEqual(
    { total: result.triggers.total, atual: result.triggers.atual, proposta: result.triggers.proposta },
    { total: 2, atual: 1, proposta: 2 },
    'the new description makes the AI pick it'
  );
  const titles = asked.map((a) => a.opts.title.split(' · ').pop());
  assert.equal(titles.filter((t) => t === 'atual').length, 2);
  assert.equal(titles.filter((t) => t === 'proposta').length, 2);
  assert.ok(
    asked.every((a) => !a.opts.refine),
    'the test chats get no refine tools'
  );

  // A proposal replaced while its test runs: the result is not written on the new one.
  lib.setProposal('x', { text: SKILL('x', 'Outra.', 'Outra'), changes: ['b'], tests: [{ pedido: 't' }] });
  let resolveSlow;
  ctx.refineAsker.ask = () => new Promise((r) => (resolveSlow = r));
  trials.start({ name: 'x' });
  await new Promise((r) => setTimeout(r, 10));
  lib.setProposal('x', { text: SKILL('x', 'Terceira.', 'T'), changes: ['c'] });
  resolveSlow('qualquer');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(lib.get('x').proposal.test, undefined);
});
