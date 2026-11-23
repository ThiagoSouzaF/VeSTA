// Agent Mode: the schedule, the form checks, the one-line result and the engine (runs, the clock, catch-up).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const A = require('../electron/shared/agents.cjs');
const Q = require('../electron/shared/quests.cjs');
const { Store } = require('../electron/app/store.cjs');
const { createAgentEngine } = require('../electron/agents/engine.cjs');

// Local times: Wednesday 2026-11-18 10:00.
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const WED_10 = at(2026, 11, 18, 10);

const FORM = {
  name: 'Bom dia',
  prompt: 'Resuma o dia.',
  provider: 'claude',
  schedule: { kind: 'daily', time: '08:30' },
};

test('the four AIs are the same list as the quests', () => {
  assert.deepEqual(A.PROVIDER_IDS, Q.PROVIDER_IDS);
});

test('next run: daily, weekdays, weekly, interval, manual', () => {
  assert.equal(A.nextRun({ kind: 'daily', time: '08:30' }, WED_10), at(2026, 11, 19, 8, 30), 'passed today: tomorrow');
  assert.equal(A.nextRun({ kind: 'daily', time: '22:00' }, WED_10), at(2026, 11, 18, 22), 'later today');
  const fri = at(2026, 11, 20, 9);
  assert.equal(A.nextRun({ kind: 'weekdays', time: '08:30' }, fri), at(2026, 11, 23, 8, 30), 'Friday after: Monday');
  assert.equal(A.nextRun({ kind: 'weekly', time: '20:00', days: [0] }, WED_10), at(2026, 11, 22, 20), 'Sunday');
  assert.equal(
    A.nextRun({ kind: 'weekly', time: '09:00', days: [3, 5] }, WED_10),
    at(2026, 11, 20, 9),
    'Wed passed: Fri'
  );
  assert.equal(A.nextRun({ kind: 'interval', hours: 4 }, WED_10), WED_10 + 4 * 3600000);
  assert.equal(A.nextRun({ kind: 'manual' }, WED_10), null);
  assert.equal(A.nextRun({ kind: 'daily', time: '10:00' }, WED_10), at(2026, 11, 19, 10), 'exactly now: the next one');
});

test('the schedule reads in Portuguese', () => {
  assert.equal(A.describeSchedule({ kind: 'weekdays', time: '08:30' }), 'Dias úteis às 08:30');
  assert.equal(A.describeSchedule({ kind: 'daily', time: '07:00' }), 'Todo dia às 07:00');
  assert.equal(A.describeSchedule({ kind: 'weekly', time: '09:00', days: [5, 1, 3] }), 'Seg, qua e sex às 09:00');
  assert.equal(A.describeSchedule({ kind: 'weekly', time: '20:00', days: [0] }), 'Dom às 20:00');
  assert.equal(A.describeSchedule({ kind: 'interval', hours: 1 }), 'A cada hora');
  assert.equal(A.describeSchedule({ kind: 'interval', hours: 6 }), 'A cada 6 horas');
  assert.equal(A.describeSchedule({}), 'Só quando você pedir');
});

test('the form: name, task and AI are required; the rest has safe defaults', () => {
  assert.throws(() => A.normalizeAgent({ prompt: 'x', provider: 'claude' }), /nome/);
  assert.throws(() => A.normalizeAgent({ name: 'x', provider: 'claude' }), /fazer/);
  assert.throws(() => A.normalizeAgent({ name: 'x', prompt: 'y', provider: 'gemini' }), /IA/);
  assert.throws(
    () => A.normalizeAgent({ name: 'x', prompt: 'y', provider: 'claude', schedule: { kind: 'weekly' } }),
    /dia/
  );
  const a = A.normalizeAgent({ name: '  Bom dia  ', prompt: 'Resuma.', provider: 'codex', mode: 'root' });
  assert.equal(a.name, 'Bom dia');
  assert.equal(a.mode, 'read', 'an unknown mode falls back to Consulta');
  assert.equal(a.memory, true);
  assert.equal(a.skills, true);
  assert.equal(a.enabled, true);
  assert.deepEqual(a.schedule, { kind: 'manual', time: '08:30', days: [], hours: 4 });
});

test('the result line: the "Resumo:" the agent wrote, else the start of its answer', () => {
  assert.equal(
    A.summaryOf('Li 3 commits.\n\n**Resumo:** comece pelo teste do quest-lead.'),
    'comece pelo teste do quest-lead.'
  );
  assert.equal(A.summaryOf('## Feito\nTudo `ok` por aqui.'), 'Feito Tudo ok por aqui.');
  assert.ok(A.summaryOf('a'.repeat(500)).length <= 280);
});

test('the prompt carries the rules of working alone, the last result and the task', () => {
  const p = A.buildPrompt(
    { name: 'Bom dia', prompt: 'Resuma o dia.', skills: true, runs: [{ status: 'ok', summary: 'Ontem: nada.' }] },
    { now: WED_10, projectName: 'VeSTA' }
  );
  assert.match(p, /agent "Bom dia"/);
  assert.match(p, /memória do projeto VeSTA e as skills/);
  assert.match(p, /Não publique nada fora deste computador/);
  assert.match(p, /## Última execução que deu certo\nOntem: nada\./);
  assert.match(p, /linha "Lição: …"/);
  assert.doesNotMatch(p, /## O que você já aprendeu|## Execuções que falharam|## Skills deste agent/);
  assert.match(p, /## Tarefa\nResuma o dia\.$/);
});

test('what the agent learned: its "Lição:" lines, a suggested task, the failures since the last success', () => {
  assert.deepEqual(
    A.lessonsOf(
      'Feito.\n**Lição:** rode o build antes dos testes\n- Lição: o teste X é instável\nLição: terceira\nResumo: ok'
    ),
    ['rode o build antes dos testes', 'o teste X é instável'],
    'two at most, bold or in a list'
  );
  assert.deepEqual(A.lessonsOf('Lição: …\n```\nLição: dentro de código\n```'), [], 'not the instruction, not code');
  assert.equal(A.suggestionOf('x\nPedido sugerido: Rode npm test e o build.\nResumo: y'), 'Rode npm test e o build.');
  assert.equal(A.suggestionOf('Resumo: nada'), '');
  assert.ok(A.sameLesson('Rode  o build', 'rode o **build**'));
  const agent = {
    name: 'Testes',
    prompt: 'Rode os testes.',
    skills: true,
    lessons: [
      { text: 'Use npm test, não npx', status: 'kept' },
      { text: 'Ainda não aprovada', status: 'pending' },
    ],
    runs: [
      { status: 'error', at: WED_10, error: 'Electron não abriu' },
      { status: 'error', at: WED_10 - 86400000, error: '', summary: 'travou no build' },
      { status: 'ok', summary: 'Tudo verde.' },
      { status: 'error', at: 0, error: 'antiga' },
    ],
  };
  assert.deepEqual(
    A.recentErrors(agent).map((r) => r.error || r.summary),
    ['Electron não abriu', 'travou no build']
  );
  const p = A.buildPrompt(agent, { now: WED_10, skills: [{ name: 'depurar-testes', body: 'Isole o teste.' }] });
  assert.match(p, /## O que você já aprendeu \(aprovado pela pessoa\)\n- Use npm test, não npx\n\n/);
  assert.doesNotMatch(p, /Ainda não aprovada/, 'pending lessons wait for the yes');
  assert.match(p, /falharam desde a última que deu certo\n- .+: Electron não abriu\n- .+: travou no build\n/);
  assert.doesNotMatch(p, /antiga/);
  assert.match(p, /## Última execução que deu certo\nTudo verde\./);
  assert.match(p, /<skill nome="depurar-testes">\nIsole o teste\.\n<\/skill>\n\n## Tarefa/);
  assert.deepEqual(
    A.normalizeAgent({ ...FORM, skillNames: ['a', 'a', '', 'b'] }).skillNames,
    ['a', 'b'],
    'own skills: unique names'
  );
});

// ---- engine -------------------------------------------------------------------------------------------------------
// Every store dir goes away when the file ends.
const dirs = [];
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
function setup({ installed = true, skills = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-agents-'));
  dirs.push(dir);
  const store = new Store(dir);
  let t = WED_10;
  const sent = [];
  const ctx = { store, sync() {} };
  const engine = createAgentEngine(ctx, {
    now: () => t,
    installed: () => installed,
    send: async (_ctx, args) => sent.push(args),
    skill: (name) => (skills[name] ? { name, body: skills[name] } : null),
    setInterval: () => null,
  });
  ctx.agents = engine;
  const answer = (chatId, text, status = 'done') => {
    store.chat(chatId).messages.push({ role: 'assistant', text });
    engine.onChatDone({ chatId, status });
  };
  return { dir, store, engine, sent, answer, clock: (v) => (t = v), now: () => t };
}

test('create schedules the next time; disabling clears it', () => {
  const { store, engine } = setup();
  const id = engine.create(FORM);
  const a = store.state.agents[0];
  assert.equal(a.id, id);
  assert.equal(a.nextRunAt, at(2026, 11, 19, 8, 30));
  engine.toggle({ id, enabled: false });
  assert.equal(a.nextRunAt, null);
  engine.update({ id, enabled: true, schedule: { kind: 'interval', hours: 2 } });
  assert.equal(store.state.agents[0].nextRunAt, WED_10 + 2 * 3600000);
});

test('a run: its own chat outside Conversas, the prompt, then the result and the badge', async () => {
  const { store, engine, sent, answer } = setup();
  const id = engine.create({ ...FORM, mode: 'ask', skills: false, memory: false });
  const { chatId } = engine.runNow({ id });
  await new Promise((r) => setImmediate(r));
  const chat = store.chat(chatId);
  assert.equal(chat.agentId, id);
  assert.equal(chat.mode, 'ask');
  assert.equal(chat.memory, false);
  assert.equal(chat.skills, false);
  assert.match(sent[0].text, /## Tarefa\nResuma o dia\./);
  assert.throws(() => engine.runNow({ id }), /já está rodando/);
  answer(chatId, 'Feito.\nResumo: 2 PRs abertos.');
  const a = store.state.agents[0];
  assert.equal(a.runs[0].status, 'ok');
  assert.equal(a.runs[0].summary, '2 PRs abertos.');
  assert.equal(a.unseen, 1);
  engine.seen();
  assert.equal(a.unseen, 0);
});

test('a run that fails or never starts ends as an error', async () => {
  const { store, engine } = setup();
  const id = engine.create(FORM);
  const { chatId } = engine.runNow({ id });
  store.chat(chatId).messages.push({ role: 'assistant', text: '', error: 'Limite do plano atingido' });
  engine.onChatDone({ chatId, status: 'error' });
  assert.equal(store.state.agents[0].runs[0].status, 'error');
  assert.match(store.state.agents[0].runs[0].error, /Limite/);
  const broken = setup({ installed: false });
  const id2 = broken.engine.create(FORM);
  assert.throws(() => broken.engine.runNow({ id: id2 }), /não está instalada/);
});

test('the clock runs what is due, once, and schedules the next time', async () => {
  const { store, engine, sent, clock } = setup();
  engine.create(FORM);
  engine.tick();
  assert.equal(sent.length, 0, 'not yet');
  clock(at(2026, 11, 19, 8, 31));
  engine.tick();
  engine.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1, 'once, even with two ticks while it runs');
  const a = store.state.agents[0];
  assert.equal(a.runs[0].trigger, 'schedule');
  assert.equal(a.nextRunAt, at(2026, 11, 20, 8, 30));
});

test('opening VeSTA: an interrupted run is closed, a missed time runs once (or is skipped)', async () => {
  const { dir, store, engine } = setup();
  const id = engine.create(FORM);
  engine.create({ ...FORM, name: 'Sem recuperar', catchUp: false });
  engine.runNow({ id });
  store.save();
  // VeSTA reopens the next day at 09:00: both 08:30 times were missed.
  const again = new Store(dir);
  const sent = [];
  const ctx = { store: again, sync() {} };
  const e2 = createAgentEngine(ctx, {
    now: () => at(2026, 11, 19, 9),
    installed: () => true,
    send: async (_c, args) => sent.push(args),
    setInterval: () => null,
  });
  e2.startClock();
  const late = again.state.agents.find((a) => a.id === id);
  const skip = again.state.agents.find((a) => a.name === 'Sem recuperar');
  assert.equal(late.runs.length, 1, 'only the interrupted run so far');
  assert.equal(late.runs[0].status, 'error');
  assert.match(late.runs[0].error, /fechou/);
  assert.equal(skip.nextRunAt, at(2026, 11, 20, 8, 30), 'no catch-up: straight to the next time');
  e2.tick();
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.equal(late.runs[0].trigger, 'catch-up');
  assert.equal(late.nextRunAt, at(2026, 11, 20, 8, 30));
});

test('removing an agent gives its chats back to Conversas; a running one cannot be removed', async () => {
  const { store, engine, answer } = setup();
  const id = engine.create(FORM);
  const { chatId } = engine.runNow({ id });
  assert.throws(() => engine.remove({ id }), /terminar/);
  answer(chatId, 'Resumo: ok');
  engine.remove({ id });
  assert.equal(store.state.agents.length, 0);
  assert.equal(store.chat(chatId).agentId, undefined);
});

test('learning: lessons wait for a yes, a suggested task replaces the prompt only when accepted', async () => {
  const { store, engine, sent, answer } = setup({ skills: { 'depurar-testes': 'Isole o teste.' } });
  const id = engine.create({ ...FORM, skillNames: ['depurar-testes', 'apagada'] });
  let { chatId } = engine.runNow({ id });
  await new Promise((r) => setImmediate(r));
  assert.match(sent[0].text, /<skill nome="depurar-testes">/, 'its own skill goes whole');
  assert.doesNotMatch(sent[0].text, /apagada/, 'a skill gone from the library is left out');
  answer(
    chatId,
    'Feito.\nLição: rode o build antes dos testes\nPedido sugerido: Rode o build e depois os testes.\nResumo: verde'
  );
  const a = store.state.agents[0];
  assert.deepEqual(
    a.lessons.map((l) => [l.text, l.status, l.from]),
    [['rode o build antes dos testes', 'pending', 'run']]
  );
  assert.equal(a.suggestion.text, 'Rode o build e depois os testes.');
  // The person corrects the agent in the run's chat: what it learns there also waits.
  store.chat(chatId).messages.push({ role: 'user', text: 'Use a pasta dist, não build' });
  answer(chatId, 'Entendido.\nLição: a saída fica em dist\nLição: Rode o build antes dos testes');
  assert.deepEqual(
    a.lessons.map((l) => [l.text, l.from]),
    [
      ['a saída fica em dist', 'chat'],
      ['rode o build antes dos testes', 'run'],
    ],
    'a lesson it already has is not added again'
  );
  ({ chatId } = engine.runNow({ id }));
  await new Promise((r) => setImmediate(r));
  assert.doesNotMatch(sent[1].text, /aprovado pela pessoa/, 'nothing approved yet');
  answer(chatId, 'Resumo: ok');
  engine.lesson({ id, lessonId: a.lessons[1].id, action: 'keep' });
  engine.lesson({ id, lessonId: a.lessons[0].id, action: 'drop' });
  engine.lesson({ id, action: 'add', text: '  Nunca  rode o deploy ' });
  assert.throws(() => engine.lesson({ id, action: 'add', text: 'nunca rode o deploy' }), /já tem/);
  assert.deepEqual(
    a.lessons.map((l) => [l.text, l.status, l.from]),
    [
      ['Nunca rode o deploy', 'kept', 'person'],
      ['a saída fica em dist', 'dropped', 'chat'],
      ['rode o build antes dos testes', 'kept', 'run'],
    ]
  );
  assert.deepEqual(
    A.pendingLessons(a)
      .concat(A.keptLessons(a))
      .map((l) => l.text),
    ['Nunca rode o deploy', 'rode o build antes dos testes'],
    'a dropped lesson is neither pending nor kept'
  );
  engine.suggestion({ id, accept: true });
  assert.equal(a.prompt, 'Rode o build e depois os testes.');
  assert.equal(a.suggestion, null);
  ({ chatId } = engine.runNow({ id }));
  await new Promise((r) => setImmediate(r));
  assert.match(sent[2].text, /aprovado pela pessoa\)\n- Nunca rode o deploy\n- rode o build antes dos testes/);
  assert.match(sent[2].text, /## Tarefa\nRode o build e depois os testes\.$/);
  assert.doesNotMatch(sent[2].text, /dist/, 'the dropped lesson never reaches a run');
  answer(chatId, 'Lição: A saída fica em dist\nResumo: ok\nPedido sugerido: outra coisa');
  assert.equal(A.pendingLessons(a).length, 0, 'a dropped lesson is not proposed again');
  engine.lesson({ id, action: 'add', text: 'a saída fica em dist' });
  assert.equal(a.lessons.filter((l) => A.sameLesson(l.text, 'a saída fica em dist')).length, 1);
  assert.equal(a.lessons[0].status, 'kept', 'the person can still teach it');
  engine.suggestion({ id, accept: false });
  assert.equal(a.prompt, 'Rode o build e depois os testes.', 'declined: the prompt stays');
  assert.equal(a.suggestion, null);
});

test('a failure reaches the next run, until one works', async () => {
  const { store, engine, sent, answer } = setup();
  const id = engine.create(FORM);
  let { chatId } = engine.runNow({ id });
  store.chat(chatId).messages.push({ role: 'assistant', text: '', error: 'Limite do plano atingido' });
  engine.onChatDone({ chatId, status: 'error' });
  ({ chatId } = engine.runNow({ id }));
  await new Promise((r) => setImmediate(r));
  assert.match(sent.at(-1).text, /falharam desde a última que deu certo\n- .+: Limite do plano atingido/);
  answer(chatId, 'Resumo: voltou');
  engine.runNow({ id });
  await new Promise((r) => setImmediate(r));
  assert.doesNotMatch(sent.at(-1).text, /falharam/);
});
