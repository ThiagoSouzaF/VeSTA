const { test } = require('node:test'),
  assert = require('node:assert/strict');
const Q = require('../electron/quests.cjs');
const { readChat, runningTasks } = require('../electron/quest-tools.cjs');

const installed = {
  claude: { models: ['haiku', 'sonnet'] },
  codex: { models: [] },
  drael: { models: [] },
};
const mk = (id, deps = [], extra = {}) =>
  Q.normalizeStep({ id, title: 'Etapa ' + id, instructions: 'faça ' + id, dependsOn: deps, ...extra });
const quest = (steps, extra = {}) =>
  Q.normalizeQuest({ id: 'q1', title: 'Q', goal: 'G', steps, status: 'running', maxParallel: 2, ...extra });
const refuses = (fn, re) => assert.throws(fn, (e) => e.name === 'UserError' && e.userSafe && re.test(e.message));

// ---- updateStep --------------------------------------------------------------------------------------------------
test('updateStep: a pending step changes AI, model and mode; the others and its own bookkeeping stay', () => {
  const q = quest([mk('a'), mk('b', ['a'], { provider: 'claude', model: 'haiku', mode: 'edit' })]);
  const before = JSON.stringify(q.steps[0]);
  const { step, changes } = Q.updateStep(q, 'b', { provider: 'codex', mode: 'read' }, installed, 5, 'chat da quest');
  assert.equal(step.provider, 'codex');
  assert.equal(step.model, '', 'a model from the old AI does not follow the step');
  assert.equal(step.mode, 'read');
  assert.deepEqual(step.dependsOn, ['a']);
  assert.equal(JSON.stringify(q.steps[0]), before, 'the other steps are untouched');
  assert.equal(changes.length, 3);
  assert.match(q.log.at(-1).text, /alterada \(chat da quest\): IA claude → codex/);
});

test('updateStep: validates AI, model, mode, title and instructions before touching anything', () => {
  const q = quest([mk('a', [], { model: 'haiku' })]);
  const snapshot = JSON.stringify(q);
  refuses(() => Q.updateStep(q, 'a', { provider: 'opencode' }, installed), /não está instalada/);
  refuses(() => Q.updateStep(q, 'a', { provider: 'gpt' }, installed), /IA desconhecida/);
  refuses(() => Q.updateStep(q, 'a', { model: 'inexistente' }, installed), /não existe em claude/);
  refuses(() => Q.updateStep(q, 'a', { mode: 'root' }, installed), /Modo inválido/);
  refuses(() => Q.updateStep(q, 'a', { provider: 'drael', mode: 'ask' }, installed), /Drael não aceita/);
  refuses(() => Q.updateStep(q, 'a', { title: '  ' }, installed), /título/);
  refuses(() => Q.updateStep(q, 'a', { instructions: '' }, installed), /instruções/);
  refuses(() => Q.updateStep(q, 'zz', { title: 'x' }, installed), /não encontrada/);
  assert.equal(JSON.stringify(q), snapshot);
  assert.equal(Q.updateStep(q, 'a', { model: 'sonnet' }, installed).step.model, 'sonnet');
  assert.equal(
    Q.updateStep(q, 'a', { model: 'claude-opus-9-9' }, installed).step.model,
    'claude-opus-9-9',
    'claude ids pass'
  );
  refuses(
    () => Q.updateStep(q, 'a', { provider: 'codex', model: 'gpt-x' }, { codex: { models: ['gpt-5'] } }),
    /não existe em codex/
  );
  assert.equal(Q.updateStep(q, 'a', { provider: 'drael' }, installed).step.model, '', 'drael has no model');
});

test('updateStep: a step already in progress, finished or skipped is refused with a clear reason', () => {
  const q = quest([mk('a'), mk('b'), mk('c'), mk('d')]);
  Q.beginStep(q, 'a', 'chatA');
  Q.finishStep(q, 'b', 'ok');
  Q.skipStep(q, 'c');
  Q.beginStep(q, 'd', 'chatD');
  refuses(() => Q.updateStep(q, 'a', { provider: 'codex' }, installed), /está rodando/);
  q.steps[0].status = 'done';
  refuses(() => Q.updateStep(q, 'a', { provider: 'codex' }, installed), /já foi concluída/);
  refuses(() => Q.updateStep(q, 'b', { provider: 'codex' }, installed), /já foi concluída/);
  refuses(() => Q.updateStep(q, 'c', { provider: 'codex' }, installed), /foi pulada/);
  refuses(() => Q.updateStep(q, 'd', { provider: 'codex' }, installed), /está rodando/);
  assert.equal(q.steps[3].chatId, 'chatD');
  for (const status of ['done', 'cancelled', 'failed'])
    refuses(() => Q.updateStep(quest([mk('a')], { status }), 'a', { title: 'x' }, installed), /já terminou/);
});

test('updateStep: works in draft and while paused or running; an error step that changes AI forgets its chat', () => {
  for (const status of ['draft', 'paused', 'running'])
    assert.equal(
      Q.updateStep(quest([mk('a')], { status }), 'a', { provider: 'codex' }, installed).step.provider,
      'codex'
    );
  const q = quest([mk('a'), mk('b', ['a'])]);
  Q.beginStep(q, 'a', 'oldChat');
  Q.failStep(q, 'a', 'boom');
  const s = q.steps[0];
  assert.equal(s.attempts, 1);
  Q.updateStep(q, 'a', { model: 'sonnet' }, installed);
  assert.equal(s.chatId, 'oldChat', 'same AI: the conversation is kept');
  Q.updateStep(q, 'a', { provider: 'codex' }, installed);
  assert.equal(s.chatId, null, 'new AI: the next try opens a fresh chat');
  assert.equal(s.status, 'error', 'changing does not retry by itself');
  assert.equal(s.result, 'boom');
  assert.equal(s.attempts, 1);
  Q.retryStep(q, 'a');
  assert.equal(q.steps[0].status, 'pending');
});

test('updateStep: dependencies are checked for existence, self reference and cycles', () => {
  const q = quest([mk('a'), mk('b', ['a']), mk('c', ['b'])]);
  refuses(() => Q.updateStep(q, 'a', { dependsOn: ['a'] }, installed), /dela mesma/);
  refuses(() => Q.updateStep(q, 'a', { dependsOn: ['zz'] }, installed), /não existe/);
  refuses(() => Q.updateStep(q, 'a', { dependsOn: ['c'] }, installed), /ciclo/);
  refuses(() => Q.updateStep(q, 'a', { dependsOn: 'b' }, installed), /lista/);
  assert.deepEqual(q.steps[0].dependsOn, []);
  Q.updateStep(q, 'c', { dependsOn: ['a'] }, installed);
  assert.deepEqual(q.steps[2].dependsOn, ['a']);
  const logs = q.log.length;
  assert.deepEqual(Q.updateStep(q, 'c', { dependsOn: ['a'] }, installed).changes, [], 'no change, no journal entry');
  assert.equal(q.log.length, logs);
});

// ---- addStep -----------------------------------------------------------------------------------------------------
test('addStep: appends a pending step with a fresh id, validated; refuses finished quests and the 12-step cap', () => {
  const q = quest([mk('s1'), mk('s2', ['s1'])]);
  const s = Q.addStep(
    q,
    { title: 'Nova', instructions: 'faça', provider: 'codex', dependsOn: ['s2'] },
    installed,
    1,
    'x'
  );
  assert.equal(s.id, 's3');
  assert.equal(s.status, 'pending');
  assert.equal(s.chatId, null);
  assert.equal(s.mode, 'edit');
  assert.deepEqual(
    q.steps.map((x) => x.id),
    ['s1', 's2', 's3']
  );
  assert.match(q.log.at(-1).text, /adicionada \(x\)/);
  q.steps.push(mk('s4'));
  assert.equal(Q.addStep(q, { title: 'T', instructions: 'i' }, installed).id, 's5', 'ids never collide');
  refuses(() => Q.addStep(q, { title: 'T', instructions: 'i', dependsOn: ['nope'] }, installed), /não existe/);
  refuses(() => Q.addStep(q, { title: 'T', instructions: '' }, installed), /instruções/);
  refuses(() => Q.addStep(q, { title: 'T', instructions: 'i', provider: 'opencode' }, installed), /não está instalada/);
  refuses(() => Q.addStep(q, { title: 'T', instructions: 'i', mode: 'zzz' }, installed), /Modo inválido/);
  while (q.steps.length < Q.MAX_STEPS) q.steps.push(mk('x' + q.steps.length));
  refuses(() => Q.addStep(q, { title: 'T', instructions: 'i' }, installed), /No máximo/);
  refuses(
    () => Q.addStep(quest([mk('a')], { status: 'done' }), { title: 'T', instructions: 'i' }, installed),
    /já terminou/
  );
});

// ---- removeStep --------------------------------------------------------------------------------------------------
test('removeStep: only pending steps; dependents inherit the removed step dependencies', () => {
  const q = quest([mk('a'), mk('b', ['a']), mk('c', ['b']), mk('d', ['b', 'a'])]);
  Q.removeStep(q, 'b', 1, 'x');
  assert.deepEqual(
    q.steps.map((s) => s.id),
    ['a', 'c', 'd']
  );
  assert.deepEqual(q.steps[1].dependsOn, ['a'], 'c now waits for what b waited for');
  assert.deepEqual(q.steps[2].dependsOn, ['a'], 'no duplicates');
  assert.equal(Q.cycleIds(q.steps).length, 0);
  assert.match(q.log.at(-1).text, /removida \(x\)/);
});

test('removeStep: refuses running, done, error and skipped steps, the last step and finished quests', () => {
  const q = quest([mk('a'), mk('b'), mk('c'), mk('d'), mk('e')]);
  Q.beginStep(q, 'a', 'chatA');
  Q.finishStep(q, 'b', 'ok');
  Q.skipStep(q, 'c');
  Q.failStep(q, 'd', 'boom');
  refuses(() => Q.removeStep(q, 'a'), /Só dá para remover etapas pendentes.*rodando/);
  refuses(() => Q.removeStep(q, 'b'), /feita/);
  refuses(() => Q.removeStep(q, 'c'), /pulada/);
  refuses(() => Q.removeStep(q, 'd'), /com problema.*pule-a/);
  refuses(() => Q.removeStep(q, 'zz'), /não encontrada/);
  assert.equal(q.steps.length, 5);
  const one = quest([mk('a')]);
  refuses(() => Q.removeStep(one, 'a'), /ao menos uma etapa/);
  refuses(() => Q.removeStep(quest([mk('a'), mk('b')], { status: 'cancelled' }), 'a'), /já terminou/);
});

// ---- Lead brief --------------------------------------------------------------------------------------------------
test('lead brief explains the vesta-quest tools, unless they are unavailable', () => {
  const q = quest([mk('a')]);
  const withTools = Q.buildLeadBrief(q);
  for (const t of ['quest_get', 'chat_read', 'chat_send', 'step_update', 'task_stop', 'activity_get'])
    assert.match(withTools, new RegExp(t));
  assert.match(withTools, /reorganizar a quest/);
  assert.match(
    Q.buildLeadBrief(q, () => undefined, { tools: false }),
    /indisponíveis/
  );
});

// ---- chat views --------------------------------------------------------------------------------------------------
test('readChat pages through the whole history, even a very long answer, without losing a character', () => {
  const long = 'x'.repeat(30000);
  const chat = {
    id: 'c',
    title: 'T',
    provider: 'claude',
    messages: [
      { role: 'user', text: 'pergunta' },
      {
        role: 'assistant',
        text: long,
        status: 'done',
        provider: 'claude',
        activities: [{ kind: 'command', label: 'Bash', detail: 'ls', status: 'done' }],
        subagents: [],
      },
      { role: 'user', text: 'outra' },
      { role: 'assistant', text: 'fim', status: 'done', activities: [], subagents: [] },
    ],
  };
  let cursor = { desde: 0, deslocamento: 0 },
    pages = 0,
    got = '';
  const seen = [];
  while (cursor) {
    const page = readChat(chat, cursor);
    pages++;
    assert.ok(pages < 20);
    for (const m of page.mensagens) {
      seen.push(m.index);
      if (m.index === 1) got += m.texto;
    }
    cursor = page.proximo;
  }
  assert.equal(got, long);
  assert.ok(pages >= 3);
  assert.deepEqual([...new Set(seen)], [0, 1, 2, 3]);
  const first = readChat(chat, { desde: 1 });
  assert.match(first.mensagens[0].atividades.itens[0], /command · Bash — ls/);
  assert.equal(first.total, 4);
});

test('runningTasks lists what is still running in the last answer', () => {
  const chat = {
    id: 'c',
    provider: 'claude',
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        status: 'running',
        text: '',
        createdAt: 1,
        activities: [{ kind: 'command', label: 'Bash', detail: 'npm test', status: 'running', taskId: 't1' }],
        subagents: [{ toolUseId: 'u1', label: 'Revisor', status: 'running', taskId: 't2', steps: [] }],
      },
    ],
  };
  const list = runningTasks(chat, true);
  assert.deepEqual(list.map((t) => t.tipo).sort(), ['command', 'resposta', 'subagent']);
  assert.equal(list.find((t) => t.tipo === 'command').taskId, 't1');
  assert.equal(list.find((t) => t.tipo === 'resposta').encerravel, false);
  assert.deepEqual(runningTasks(chat, false), [], 'a chat with no live job has nothing running');
});
