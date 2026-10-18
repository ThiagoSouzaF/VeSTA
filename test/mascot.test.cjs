// State of the mascot: pure function, the clock is always injected.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const lib = () => import('../src/lib/mascot.js');

const T0 = new Date(2026, 9, 18, 14, 0, 0).getTime(); // 14:00, daytime
let n = 0;
const msg = (role, extra = {}) => ({ id: 'm' + ++n, role, text: '', createdAt: T0 - 60_000, ...extra });
const chat = (id, messages = [], extra = {}) => ({
  id,
  title: 'Chat ' + id,
  provider: 'claude',
  messages,
  updatedAt: 0,
  ...extra,
});
const data = (chats = [], running = [], quests = []) => ({ chats, running, quests });
const step = (status, endedAt, extra = {}) => ({ id: 's' + ++n, title: 's', status, endedAt, ...extra });
const quest = (steps, extra = {}) => ({
  id: 'q' + ++n,
  title: 'Quest',
  status: 'running',
  steps,
  updatedAt: 0,
  ...extra,
});
// an assistant turn that finished `ago` ms before T0
const finished = (status, ago, extra = {}) => msg('assistant', { status, text: 'x', endedAt: T0 - ago, ...extra });
const awake = { awakeSince: T0 - 1000 };
const state = async (d, now = T0, opts = awake, groups) => (await lib()).mascotState(d, now, opts, groups);

test('idle: nothing happening, recently awake', async () => {
  const r = await state(data());
  assert.equal(r.state, 'idle');
  assert.equal(r.count, 0);
  assert.match(r.phrase, /calmo/);
});

test('thinking: an AI running without text or tools yet', async () => {
  const c = chat('a', [msg('user', { text: 'oi' }), msg('assistant', { status: 'running' })]);
  const r = await state(data([c], ['a']));
  assert.equal(r.state, 'thinking');
  assert.equal(r.phrase, 'Pensando no seu pedido…');
  assert.equal(r.count, 1);
});

test('thinking: a pending permission request wins over working', async () => {
  const asst = msg('assistant', {
    status: 'running',
    text: 'x',
    activities: [{ id: 'a1', status: 'running', label: 'Bash' }],
    permissions: [{ id: 'p', status: 'pending', createdAt: T0 }],
  });
  const c = chat('a', [msg('user'), asst]);
  const r = await state(data([c], ['a']));
  assert.equal(r.state, 'thinking');
  assert.equal(r.phrase, 'Aguardando a sua permissão');
  const other = {
    ...asst,
    id: 'z',
    permissions: [{ id: 'q', status: 'pending', createdAt: T0 }],
  };
  const two = chat('b', [msg('user'), other]);
  const r2 = await state(data([c, two], ['a', 'b']));
  assert.equal(r2.count, 2);
  assert.equal(r2.phrase, '2 pedidos aguardando permissão');
  // an answered request does not count
  const answered = { ...asst, permissions: [{ id: 'p', status: 'allowed', createdAt: T0 }] };
  const r3 = await state(data([chat('a', [msg('user'), answered])], ['a']));
  assert.notEqual(r3.phrase, 'Aguardando a sua permissão');
});

test('working: running tools/subagents count as tasks; an AI already writing is working too', async () => {
  const act = (id, status) => ({ id, status, kind: 'command', label: 'Bash', startedAt: T0 - 5000 });
  const c = chat('a', [
    msg('user'),
    msg('assistant', { status: 'running', activities: [act('1', 'running'), act('2', 'running'), act('3', 'done')] }),
  ]);
  const r = await state(data([c], ['a']));
  assert.equal(r.state, 'working');
  assert.equal(r.count, 2);
  assert.equal(r.phrase, '2 tarefas em andamento');
  const one = chat('a', [msg('user'), msg('assistant', { status: 'running', activities: [act('1', 'running')] })]);
  assert.equal((await state(data([one], ['a']))).phrase, '1 tarefa em andamento');
  const writing = chat('a', [msg('user'), msg('assistant', { status: 'running', text: 'Olá, vou' })]);
  const w = await state(data([writing], ['a']));
  assert.equal(w.state, 'working');
  assert.equal(w.phrase, 'Escrevendo a resposta…');
  // one AI writing and another still thinking: working
  const thinking = chat('b', [msg('user'), msg('assistant', { status: 'running' })]);
  assert.equal((await state(data([writing, thinking], ['a', 'b']))).state, 'working');
});

test('success: finished well in the last 6 s, then idle', async () => {
  const c = chat('a', [msg('user'), finished('done', 2000)]);
  assert.equal((await state(data([c]))).state, 'success');
  assert.equal((await state(data([c]))).phrase, 'Tudo pronto!');
  assert.equal((await state(data([c]), T0 + 4001)).state, 'idle'); // 6001 ms after it ended
  const edge = chat('a', [msg('user'), finished('done', 5999)]);
  assert.equal((await state(data([edge]))).state, 'success');
  // stopped by the person is not a success
  const stopped = chat('a', [msg('user'), finished('cancelled', 1000)]);
  assert.equal((await state(data([stopped]))).state, 'idle');
  // a finished quest also celebrates
  assert.equal((await state(data([], [], [quest([], { status: 'done', updatedAt: T0 - 1000 })]))).state, 'success');
});

test('success never hides work still running', async () => {
  const finishedChat = chat('a', [msg('user'), finished('done', 1000)]);
  const running = chat('b', [msg('user'), msg('assistant', { status: 'running' })]);
  assert.equal((await state(data([finishedChat, running], ['b']))).state, 'thinking');
});

test('error: a failed turn or quest step in the last 20 s, with the chat name', async () => {
  const c = chat('a', [msg('user'), finished('error', 5000)], { title: 'Refatorar o backend' });
  const r = await state(data([c]));
  assert.equal(r.state, 'error');
  assert.equal(r.phrase, 'Algo deu errado em Refatorar o backend');
  assert.equal((await state(data([c]), T0 + 14_999)).state, 'error'); // 19 999 ms after
  assert.equal((await state(data([c]), T0 + 15_001)).state, 'idle'); // 20 001 ms after
  const long = chat('a', [msg('user'), finished('error', 1000)], { title: 'x'.repeat(80) });
  assert.ok((await state(data([long]))).phrase.length < 50);
  const q = quest([step('error', T0 - 2000)], { title: 'Migrar banco' });
  const rq = await state(data([], [], [q]));
  assert.equal(rq.state, 'error');
  assert.match(rq.phrase, /Migrar banco/);
});

test('error wins over every other state; the most recent failure names the chat', async () => {
  const bad = chat('a', [msg('user'), finished('error', 1000)]);
  const newer = chat('n', [msg('user'), finished('error', 500)], { title: 'Mais novo' });
  const running = chat('b', [msg('user'), msg('assistant', { status: 'running', text: 'x' })]);
  const r = await state(data([bad, newer, running], ['b']));
  assert.equal(r.state, 'error');
  assert.match(r.phrase, /Mais novo/);
});

test('sleeping: 15 minutes with nothing running, or offline', async () => {
  const c = chat('a', [msg('user'), finished('done', 20 * 60_000)], { updatedAt: T0 - 20 * 60_000 });
  const opts = { awakeSince: T0 - 30 * 60_000 };
  const r = await state(data([c]), T0, opts);
  assert.equal(r.state, 'sleeping');
  assert.equal(r.phrase, 'Descansando — chame quando precisar');
  const recent = chat('a', [msg('user'), finished('done', 14 * 60_000)], { updatedAt: T0 - 14 * 60_000 });
  assert.equal((await state(data([recent]), T0, opts)).state, 'idle');
  // exactly at the limit
  const lim = chat('a', [msg('user'), finished('done', 15 * 60_000)], { updatedAt: T0 - 15 * 60_000 });
  assert.equal((await state(data([lim]), T0, opts)).state, 'sleeping');
  // opening the app counts as being awake: no instant nap with an old history
  assert.equal((await state(data([c]), T0, { awakeSince: T0 - 1000 })).state, 'idle');
  // the phone is offline
  assert.equal((await state(data([c]), T0, { ...opts, online: false })).phrase, 'Sem conexão com o computador');
  assert.equal((await state(data(), T0, { online: false })).state, 'sleeping');
});

test('sleeping at night (0h-6h) after a quiet minute; running work keeps her awake', async () => {
  const night = new Date(2026, 9, 18, 3, 0, 0).getTime();
  const opts = { awakeSince: night - 120_000 };
  assert.equal((await state(data(), night, opts)).state, 'sleeping');
  assert.equal((await state(data(), night, { awakeSince: night - 30_000 })).state, 'idle', 'activity within a minute');
  const running = chat('a', [msg('user'), msg('assistant', { status: 'running' })]);
  assert.equal((await state(data([running], ['a']), night, opts)).state, 'thinking');
  const sixAm = new Date(2026, 9, 18, 6, 0, 0).getTime();
  assert.equal((await state(data(), sixAm, { awakeSince: sixAm - 120_000 })).state, 'idle', '6h is already day');
  const midnight = new Date(2026, 9, 18, 0, 0, 0).getTime();
  assert.equal((await state(data(), midnight, { awakeSince: midnight - 120_000 })).state, 'sleeping');
});

test('a chat that was running when the app closed (message still "running") is not live work', async () => {
  const stale = chat('a', [msg('user'), msg('assistant', { status: 'running', createdAt: T0 - 3_600_000 })], {
    updatedAt: T0 - 3_600_000,
  });
  assert.equal((await state(data([stale]), T0, { awakeSince: T0 - 1000 })).state, 'idle');
});

test('nextChangeAt schedules the next time boundary and nothing while busy', async () => {
  const { scan, nextChangeAt, ERROR_MS, SUCCESS_MS, SLEEP_MS } = await lib();
  const ok = scan(data([chat('a', [msg('user'), finished('done', 2000)])]));
  assert.equal(nextChangeAt(ok, T0, awake), T0 - 2000 + SUCCESS_MS);
  const bad = scan(data([chat('a', [msg('user'), finished('error', 2000)])]));
  assert.equal(nextChangeAt(bad, T0, awake), T0 - 2000 + ERROR_MS);
  const quiet = scan(data());
  assert.ok(nextChangeAt(quiet, T0, awake) <= T0 - 1000 + SLEEP_MS);
  assert.equal(nextChangeAt(quiet, T0, { online: false }), Infinity);
  const running = scan(data([chat('a', [msg('user'), msg('assistant', { status: 'running' })])], ['a']));
  assert.equal(nextChangeAt(running, T0, awake), Infinity);
});

test('scan recomputes only the chat that changed', async () => {
  const { scan } = await lib();
  const a = chat('a', [msg('user'), finished('done', 1000)]);
  const b1 = chat('b', [msg('user'), msg('assistant', { status: 'running' })]);
  const b2 = { ...b1, messages: [b1.messages[0], { ...b1.messages[1], text: 'abc' }] };
  const f1 = scan(data([a, b1], ['b'])),
    f2 = scan(data([a, b2], ['b']));
  assert.equal(f1.thinkingChats, 1);
  assert.equal(f2.thinkingChats, 0);
  assert.deepEqual(f1.success, f2.success);
});
