const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const Q = require('../electron/quests.cjs');
const { Store, STORE_VERSION } = require('../electron/store.cjs');
const { createQuestEngine } = require('../electron/quest-engine.cjs');

const mk = (id, deps = [], extra = {}) =>
  Q.normalizeStep({ id, title: 'Etapa ' + id, instructions: 'faça ' + id, dependsOn: deps, ...extra });
const quest = (steps, extra = {}) =>
  Q.normalizeQuest({ id: 'q1', title: 'Q', goal: 'G', steps, status: 'running', maxParallel: 2, ...extra });
const ids = (list) => list.map((s) => s.id);

// ---- Scheduler ---------------------------------------------------------------------------------------------------
test('scheduler starts only steps whose dependencies are done, in plan order', () => {
  const q = quest([mk('a'), mk('b', ['a']), mk('c')]);
  assert.deepEqual(ids(Q.readySteps(q)), ['a', 'c']);
  Q.beginStep(q, 'a', 'chatA');
  Q.beginStep(q, 'c', 'chatC');
  assert.deepEqual(Q.readySteps(q), [], 'no free slot and b still waits for a');
  Q.finishStep(q, 'a', 'ok');
  assert.deepEqual(ids(Q.readySteps(q)), ['b'], 'a freed one slot while c still runs');
  Q.beginStep(q, 'b', 'chatB');
  assert.deepEqual(Q.readySteps(q), [], 'everything is running or done');
});

test('scheduler respects maxParallel and only runs a running quest', () => {
  const q = quest([mk('a'), mk('b'), mk('c'), mk('d')], { maxParallel: 3 });
  assert.equal(Q.readySteps(q).length, 3);
  q.maxParallel = 1;
  assert.equal(Q.readySteps(q).length, 1);
  q.status = 'paused';
  assert.equal(Q.readySteps(q).length, 0);
  q.status = 'draft';
  assert.equal(Q.readySteps(q).length, 0);
});

test('error pauses the quest; retry and skip bring it back; skipped dependencies release dependents', () => {
  const q = quest([mk('a'), mk('b', ['a']), mk('c')]);
  Q.beginStep(q, 'a', 'x');
  Q.failStep(q, 'a', 'boom');
  assert.equal(q.status, 'paused');
  assert.equal(q.pauseReason, 'error');
  assert.deepEqual(Q.readySteps(q), []);
  Q.retryStep(q, 'a');
  assert.equal(q.status, 'running');
  assert.equal(q.steps[0].status, 'pending');
  assert.equal(q.steps[0].attempts, 1, 'attempts survive a retry');
  Q.beginStep(q, 'a', 'y');
  Q.failStep(q, 'a', 'boom again');
  Q.skipStep(q, 'a');
  assert.equal(q.status, 'running');
  assert.deepEqual(ids(Q.readySteps(q)), ['b', 'c'], 'b no longer waits for the skipped a');
  assert.match(Q.handoff(q, q.steps[1]), /etapa pulada/);
});

test('pause keeps running steps, blocks new ones; resume continues', () => {
  const q = quest([mk('a'), mk('b', ['a'])]);
  Q.beginStep(q, 'a', 'x');
  Q.pause(q);
  assert.equal(q.steps[0].status, 'running');
  Q.finishStep(q, 'a', 'ok');
  assert.deepEqual(Q.readySteps(q), []);
  Q.resume(q);
  assert.deepEqual(ids(Q.readySteps(q)), ['b']);
  assert.throws(() => Q.resume(q), /não está pausada/);
});

test('evaluate: all done -> done with summary; blocked by error -> paused', () => {
  const q = quest([mk('a'), mk('b', ['a'])]);
  Q.beginStep(q, 'a', 'x');
  Q.finishStep(q, 'a', 'feito A');
  Q.beginStep(q, 'b', 'y');
  Q.finishStep(q, 'b', 'feito B');
  Q.evaluate(q);
  assert.equal(q.status, 'done');
  assert.match(q.summary, /2 etapa\(s\) feita\(s\)/);
  assert.match(q.summary, /feito B/);
  const blocked = quest([mk('a'), mk('b', ['a'])], { status: 'running' });
  blocked.steps[0].status = 'error';
  Q.evaluate(blocked);
  assert.equal(blocked.status, 'paused');
});

test('cancel returns the chats to stop and ignores nothing else', () => {
  const q = quest([mk('a'), mk('b')]);
  Q.beginStep(q, 'a', 'chatA');
  assert.deepEqual(Q.cancel(q), ['chatA']);
  assert.equal(q.status, 'cancelled');
  assert.equal(q.steps[0].status, 'skipped');
  assert.equal(q.steps[1].status, 'pending');
  assert.throws(() => Q.cancel(q), /já terminou/);
});

test('reopening the app: running steps without a live chat become errors and the quest pauses', () => {
  const q = quest([mk('a'), mk('b'), mk('c', ['a'])]);
  Q.beginStep(q, 'a', 'dead');
  Q.beginStep(q, 'b', 'alive');
  assert.equal(Q.reconcile(q, ['alive']), true);
  assert.equal(q.steps[0].status, 'error');
  assert.equal(q.steps[1].status, 'running', 'a chat that is still running is left alone');
  assert.equal(q.status, 'paused');
  const idle = quest([mk('a')]);
  assert.equal(Q.reconcile(idle, []), true, 'a running quest with nothing in flight is paused too');
  assert.equal(idle.status, 'paused');
  const done = quest([mk('a')], { status: 'done' });
  assert.equal(Q.reconcile(done, []), false);
  const planning = Q.normalizeQuest({ status: 'draft', planning: { status: 'running', chatId: 'p' } });
  assert.equal(Q.reconcile(planning, []), true);
  assert.equal(planning.planning.status, 'error');
});

// ---- Prompt ------------------------------------------------------------------------------------------------------
test('step prompt carries goal, guidelines, instructions and the handoff of its dependencies only', () => {
  const q = quest([mk('a'), mk('b'), mk('c', ['a', 'b'])], { guidelines: 'sem emoji' });
  Q.finishStep(q, 'a', 'resultado do A');
  Q.finishStep(q, 'b', 'resultado do B');
  const p = Q.buildStepPrompt(q, q.steps[2]);
  for (const part of ['G', 'sem emoji', 'faça c', 'resultado do A', 'resultado do B', '## Resultado'])
    assert.ok(p.includes(part), part);
  const first = Q.buildStepPrompt(q, q.steps[0]);
  assert.ok(!first.includes('handoff') && !first.includes('resultado do B'));
});

// ---- Result ------------------------------------------------------------------------------------------------------
test('extractResult takes the last "## Resultado" section, stops at the next heading, falls back to the tail', () => {
  const t = 'blá\n## Resultado\nantigo\n\nmais trabalho\n\n## Resultado\nCriei nota.txt\n- ok\n\n## Notas\nignore';
  assert.equal(Q.extractResult(t), 'Criei nota.txt\n- ok');
  assert.equal(Q.extractResult('### **Resultado**\nfeito'), 'feito');
  assert.equal(Q.extractResult('só texto'), 'só texto');
  const long = 'x'.repeat(5000) + 'FIM';
  const r = Q.extractResult(long, 100);
  assert.equal(r.length, 100);
  assert.ok(r.endsWith('FIM') && r.startsWith('…'));
  assert.equal(Q.extractResult(''), '');
});

// ---- Plan parser -------------------------------------------------------------------------------------------------
const INSTALLED = { claude: { models: ['claude-haiku-5-5'] }, codex: { models: [] } };
const plan = (steps) => '```json\n' + JSON.stringify({ steps }) + '\n```';
test('plan: valid JSON in a fenced block, with noise around it', () => {
  const reply =
    'Claro! Aqui vai:\n' +
    plan([
      { id: 'impl', title: 'Implementar', instructions: 'faça', provider: 'claude', model: 'claude-haiku-5-5' },
      { id: 'rev', title: 'Revisar', instructions: 'revise', provider: 'codex', kind: 'review', dependsOn: ['impl'] },
    ]) +
    '\nQualquer ajuste, avise.';
  const r = Q.parsePlan(reply, INSTALLED);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(ids(r.steps), ['s1', 's2']);
  assert.deepEqual(r.steps[1].dependsOn, ['s1']);
  assert.equal(r.steps[1].kind, 'review');
  assert.equal(r.steps[1].mode, 'read', 'reviews default to read');
  assert.equal(r.steps[0].mode, 'edit');
});

test('plan: bare JSON, array form, trailing comma and unknown provider/model are normalized', () => {
  const bare = Q.parsePlan(
    'texto {"steps":[{"title":"A","instructions":"i","provider":"gemini","model":"inexistente"},],} fim',
    INSTALLED
  );
  assert.equal(bare.ok, true, bare.error);
  assert.equal(bare.steps[0].provider, 'claude', 'falls back to an installed AI');
  assert.ok(bare.warnings.length);
  const arr = Q.parsePlan(
    '[{"title":"A","instructions":"i","provider":"claude","model":"claude-haiku-5-5"}]',
    INSTALLED
  );
  assert.equal(arr.ok, true);
  assert.equal(arr.steps[0].model, 'claude-haiku-5-5');
  const badModel = Q.parsePlan(plan([{ title: 'A', instructions: 'i', provider: 'claude', model: 'nope' }]), INSTALLED);
  assert.equal(badModel.steps[0].model, '');
});

test('plan: chatgpt means codex; dependencies by number or unknown key are mapped or dropped', () => {
  const r = Q.parsePlan(
    plan([
      { id: 'x', title: 'A', instructions: 'i', provider: 'chatgpt' },
      { id: 'y', title: 'B', instructions: 'i', provider: 'claude', dependsOn: ['x', 'fantasma', 'y'] },
    ]),
    INSTALLED
  );
  assert.equal(r.steps[0].provider, 'codex');
  assert.deepEqual(r.steps[1].dependsOn, ['s1']);
});

test('plan: dependencies pointing forward are reordered so dependencies come first', () => {
  const r = Q.parsePlan(
    plan([
      { id: 'b', title: 'B', instructions: 'i', dependsOn: ['a'] },
      { id: 'a', title: 'A', instructions: 'i' },
    ]),
    INSTALLED
  );
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(
    r.steps.map((s) => s.title),
    ['A', 'B']
  );
  assert.equal(Q.validateSteps(r.steps), null);
});

test('plan: invalid JSON, empty plan, missing instructions and cycles are rejected with a reason', () => {
  assert.equal(Q.parsePlan('sem json nenhum', INSTALLED).ok, false);
  assert.equal(Q.parsePlan('```json\n{ quebrado\n```', INSTALLED).ok, false);
  assert.equal(Q.parsePlan(plan([]), INSTALLED).ok, false);
  const noText = Q.parsePlan(plan([{ title: 'A' }]), INSTALLED);
  assert.equal(noText.ok, false);
  assert.match(noText.error, /instruções/);
  const cyc = Q.parsePlan(
    plan([
      { id: 'a', title: 'A', instructions: 'i', dependsOn: ['b'] },
      { id: 'b', title: 'B', instructions: 'i', dependsOn: ['a'] },
    ]),
    INSTALLED
  );
  assert.equal(cyc.ok, false);
  assert.match(cyc.error, /ciclo/);
});

test('plan: at most 12 steps', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: 's' + i, title: 'T' + i, instructions: 'i' }));
  const r = Q.parsePlan(plan(many), INSTALLED);
  assert.equal(r.steps.length, 12);
  assert.ok(r.warnings.some((w) => /12/.test(w)));
});

test('plan prompt lists only installed AIs with strengths and asks for a json block', () => {
  const p = Q.buildPlanPrompt({ goal: 'Meta', guidelines: 'g' }, INSTALLED);
  assert.match(p, /claude:/);
  assert.match(p, /codex:/);
  assert.ok(!/opencode:/.test(p));
  assert.match(p, /```json/);
  assert.match(p, /DIFERENTE/);
});

test('validateSteps catches missing dependency, duplicates and cycles', () => {
  assert.match(Q.validateSteps([mk('a', ['zzz'])]), /não existe/);
  assert.match(Q.validateSteps([mk('a', ['b']), mk('b', ['a'])]), /ciclo/);
  assert.match(Q.validateSteps([mk('a'), mk('a')]), /mesmo/);
  assert.equal(Q.validateSteps([mk('a'), mk('b', ['a'])]), null);
  assert.deepEqual(Q.cycleIds([mk('a'), mk('b', ['a'])]), []);
});

test('progress and board columns', () => {
  const q = quest([mk('a'), mk('b'), mk('c'), mk('d', [], { provider: 'codex' })]);
  Q.beginStep(q, 'a', 'x');
  Q.finishStep(q, 'a', 'r');
  Q.beginStep(q, 'b', 'y');
  q.steps[2].status = 'error';
  const p = Q.progress(q);
  assert.deepEqual([p.total, p.done, p.running, p.errors, p.pct], [4, 1, 1, 1, 25]);
  assert.deepEqual(p.providers.sort(), ['claude', 'codex']);
  const c = Q.columns(q);
  assert.deepEqual([c.pending.length, c.running.length, c.done.length, c.problems.length], [1, 1, 1, 1]);
});

// ---- Store migration ---------------------------------------------------------------------------------------------
test('store migration: old files get quests: [], broken quests get defaults, valid ones survive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-quests-'));
  fs.writeFileSync(path.join(dir, 'vesta.json'), JSON.stringify({ version: 2, chats: [] }));
  const old = new Store(dir);
  assert.deepEqual(old.state.quests, []);
  assert.equal(old.state.version, STORE_VERSION);
  fs.writeFileSync(
    path.join(dir, 'vesta.json'),
    JSON.stringify({
      version: 3,
      quests: [
        null,
        {
          id: 'k',
          title: 'Salva',
          status: 'running',
          maxParallel: 99,
          steps: [{ title: 'x', provider: 'xx', status: 'zzz' }],
        },
      ],
    })
  );
  const s = new Store(dir);
  assert.equal(s.state.quests.length, 2);
  const k = s.state.quests[1];
  assert.equal(k.status, 'running');
  assert.equal(k.maxParallel, 6);
  assert.deepEqual(
    [k.steps[0].provider, k.steps[0].status, k.steps[0].mode, k.steps[0].attempts],
    ['claude', 'pending', 'edit', 0]
  );
  assert.equal(s.state.quests[0].status, 'draft');
  assert.deepEqual(Q.normalizeQuests(undefined), []);
});

// ---- Engine (fake send) ------------------------------------------------------------------------------------------
function harness({ memory } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-engine-'));
  const store = new Store(dir);
  store.state.settings.memoryEnabled = !!memory;
  const sent = [],
    stopped = [];
  const ctx = {
    store,
    sync() {},
    jobs: new Map(),
    integrations: { claude: { installed: true, models: [] }, codex: { installed: true, models: [] } },
    project: () => null,
    stopChat: (id) => stopped.push(id),
    memory,
  };
  const engine = createQuestEngine(ctx, {
    send: async (_, { chatId, text }) => {
      const chat = store.chat(chatId);
      if (chat.provider === 'codex' && ctx.codexMissing) throw new Error('Instale codex');
      chat.messages.push({ role: 'user', text }, { role: 'assistant', text: '', status: 'running' });
      sent.push({ chatId, text, provider: chat.provider, model: chat.model, mode: chat.mode });
      ctx.jobs.set(chatId, {});
    },
  });
  const finish = (chatId, text, status = 'done') => {
    const chat = store.chat(chatId);
    const m = chat.messages.at(-1);
    m.text = text;
    if (status === 'error') m.error = text;
    m.status = status;
    ctx.jobs.delete(chatId);
    engine.onChatDone({ chatId, status });
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return { store, ctx, engine, sent, stopped, finish, tick };
}
const manual = [
  { id: 's1', title: 'Criar', instructions: 'crie', provider: 'claude' },
  { id: 's2', title: 'Revisar', instructions: 'revise', provider: 'codex', kind: 'review', dependsOn: ['s1'] },
  { id: 's3', title: 'Resumir', instructions: 'resuma', provider: 'claude', dependsOn: ['s1', 's2'] },
];

test('engine runs a 3-step quest end to end, passing handoffs and recording memory', async () => {
  const notes = [];
  const h = harness({ memory: { ensureProject: async () => {}, write: async (n) => notes.push(n) } });
  const q = h.engine.createQuest({ title: 'Demo', goal: 'Meta', steps: manual });
  assert.equal(q.status, 'draft');
  assert.equal(h.sent.length, 0, 'nothing runs before Iniciar');
  h.engine.startQuest({ id: q.id });
  await h.tick();
  assert.equal(h.sent.length, 1);
  assert.match(h.store.chat(h.sent[0].chatId).title, /^Quest: Demo — Criar/);
  h.finish(h.sent[0].chatId, 'texto\n## Resultado\ncriei nota.txt');
  await h.tick();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].provider, 'codex');
  assert.match(h.sent[1].text, /criei nota\.txt/);
  assert.equal(h.sent[1].mode, 'read');
  h.finish(h.sent[1].chatId, '## Resultado\nrevisão ok');
  await h.tick();
  assert.equal(h.sent.length, 3);
  assert.match(h.sent[2].text, /criei nota\.txt/);
  assert.match(h.sent[2].text, /revisão ok/);
  h.finish(h.sent[2].chatId, '## Resultado\nresumo final');
  await h.tick();
  assert.equal(q.status, 'done');
  assert.match(q.summary, /resumo final/);
  assert.deepEqual(
    notes.map((n) => n.path),
    ['quests/' + q.id + '/s1.md', 'quests/' + q.id + '/s2.md', 'quests/' + q.id + '/s3.md']
  );
  assert.equal(h.store.state.memories.filter((m) => m.kind === 'quest').length, 3);
});

test('engine: independent steps run in parallel up to maxParallel', async () => {
  const h = harness();
  const q = h.engine.createQuest({
    title: 'P',
    goal: 'g',
    maxParallel: 2,
    steps: [1, 2, 3].map((i) => ({ id: 's' + i, title: 'T' + i, instructions: 'x' })),
  });
  h.engine.startQuest({ id: q.id });
  await h.tick();
  assert.equal(h.sent.length, 2);
  h.finish(h.sent[0].chatId, 'ok');
  await h.tick();
  assert.equal(h.sent.length, 3);
});

test('engine: an error pauses; retry runs the step again; cancel stops live chats', async () => {
  const h = harness();
  const q = h.engine.createQuest({
    title: 'E',
    goal: 'g',
    steps: manual.slice(0, 2).map((s) => ({ ...s, provider: 'claude' })),
  });
  h.engine.startQuest({ id: q.id });
  await h.tick();
  h.finish(h.sent[0].chatId, 'quebrou', 'error');
  assert.equal(q.status, 'paused');
  assert.equal(q.steps[0].status, 'error');
  h.engine.retryStep({ id: q.id, stepId: 's1' });
  await h.tick();
  assert.equal(q.status, 'running');
  assert.equal(h.sent.length, 2);
  assert.equal(q.steps[0].attempts, 2);
  h.engine.cancelQuest({ id: q.id });
  assert.deepEqual(h.stopped, [h.sent[1].chatId]);
  h.finish(h.sent[1].chatId, 'tarde demais', 'cancelled');
  assert.equal(q.status, 'cancelled');
  assert.equal(q.steps[0].status, 'skipped', 'a late chat-done does not resurrect a cancelled step');
});

test('engine: a send that throws fails the step, pauses, and skip lets the quest finish', async () => {
  const h = harness();
  h.ctx.codexMissing = true;
  const q = h.engine.createQuest({ title: 'S', goal: 'g', steps: manual });
  h.engine.startQuest({ id: q.id });
  await h.tick();
  h.finish(h.sent[0].chatId, '## Resultado\nA');
  await h.tick();
  assert.equal(q.steps[1].status, 'error');
  assert.match(q.steps[1].result, /Instale codex/);
  assert.equal(q.status, 'paused');
  h.engine.skipStep({ id: q.id, stepId: 's2' });
  await h.tick();
  assert.equal(h.sent.length, 2);
  h.finish(h.sent[1].chatId, '## Resultado\nB');
  await h.tick();
  assert.equal(q.status, 'done');
});

test('engine: pause blocks new steps; recover closes steps left running', async () => {
  const h = harness();
  const q = h.engine.createQuest({ title: 'R', goal: 'g', steps: manual.map((s) => ({ ...s, provider: 'claude' })) });
  h.engine.startQuest({ id: q.id });
  await h.tick();
  h.engine.pauseQuest({ id: q.id });
  h.finish(h.sent[0].chatId, 'ok');
  await h.tick();
  assert.equal(h.sent.length, 1, 'paused: s2 not started');
  h.engine.resumeQuest({ id: q.id });
  await h.tick();
  assert.equal(h.sent.length, 2);
  h.ctx.jobs.clear(); // the app was closed: no chat is alive any more
  assert.equal(h.engine.recover(), true);
  assert.equal(q.steps[1].status, 'error');
  assert.equal(q.status, 'paused');
});

test('engine: AI planning fills the draft plan; bad replies are reported without losing the quest', async () => {
  const h = harness();
  const q = h.engine.createQuest({ title: 'Plan', goal: 'g', plan: { provider: 'claude' } });
  await h.tick();
  assert.equal(q.planning.status, 'running');
  assert.equal(h.store.chat(q.planning.chatId).questRole, 'plan');
  assert.equal(h.store.chat(q.planning.chatId).mode, 'read');
  h.finish(q.planning.chatId, plan([{ title: 'A', instructions: 'i', provider: 'claude' }]));
  assert.equal(q.planning.status, 'done');
  assert.equal(q.steps.length, 1);
  h.engine.replan({ id: q.id, provider: 'codex' });
  await h.tick();
  h.finish(q.planning.chatId, 'não sei');
  assert.equal(q.planning.status, 'error');
  assert.equal(q.steps.length, 1, 'a failed replan keeps the previous plan');
  assert.throws(() => h.engine.createQuest({ title: 'x', goal: '' }), /objetivo/);
  assert.throws(
    () =>
      h.engine.updateQuest({
        id: q.id,
        steps: [
          { id: 'a', title: 'a', instructions: 'b', dependsOn: ['b'] },
          { id: 'b', title: 'b', instructions: 'b', dependsOn: ['a'] },
        ],
      }),
    /ciclo/
  );
});
