// "Acompanhando": limits and registry (follow.cjs), the Claude driver staying alive for background tasks (drivers.cjs)
// and the chat flow on top of it (send.cjs): a new assistant message when the CLI returns by itself, the user's message
// going to the same process, stop following, time limit. A fake CLI replays what the real one was seen to do.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const F = require('../electron/follow.cjs');
const providers = require('../electron/providers.cjs');
const drivers = require('../electron/drivers.cjs');
const tasksLib = require('../electron/tasks.cjs');

const fake = path.join(__dirname, 'fixtures', 'fake-claude.cjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await wait(15);
  }
  throw new Error('timeout: ' + fn);
};

// ---- pure rules -------------------------------------------------------------------------------------------------
test('limits: defaults, clamping and the chat cap', () => {
  assert.deepEqual(F.limits({}), { minutes: 120, maxChats: 3 });
  assert.deepEqual(F.limits({ followMinutes: 1, followMax: 99 }), { minutes: F.MIN_MINUTES, maxChats: F.MAX_CHATS });
  assert.deepEqual(F.limits({ followMinutes: 'abc', followMax: 0 }), { minutes: 120, maxChats: 1 });
  const s = { followMax: 2 };
  assert.equal(F.shouldFollow({ tasks: [{}], count: 0, settings: s }), true);
  assert.equal(F.shouldFollow({ tasks: [{}], count: 1, settings: s }), true);
  assert.equal(F.shouldFollow({ tasks: [{}], count: 2, settings: s }), false, 'at the cap the turn ends as before');
  assert.equal(F.shouldFollow({ tasks: [], count: 0, settings: s }), false, 'nothing running, nothing to follow');
  assert.equal(F.shouldFollow({ tasks: [{}], count: 0, settings: s, enabled: false }), false);
});

test('the registry arms a deadline per chat and drops cleanly', () => {
  const expired = [];
  const timers = [];
  const reg = F.createFollows({
    settings: () => ({ followMinutes: 15 }),
    onExpire: (id) => expired.push(id),
    now: () => 1000,
    setTimer: (fn, ms) => {
      const h = { fn, ms, cleared: false };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => (h.cleared = true),
  });
  const s = { tasks: [{ taskId: 'a', description: 'servidor' }] };
  reg.add('c1', s);
  assert.equal(timers[0].ms, 15 * 60000);
  assert.equal(s.follow.deadline, 1000 + 15 * 60000);
  assert.equal(reg.size, 1);
  assert.deepEqual(reg.snapshot(), [{ chatId: 'c1', since: 1000, deadline: s.follow.deadline, tasks: s.tasks }]);
  assert.equal(F.expired(s.follow, 1000), false);
  assert.equal(F.expired(s.follow, s.follow.deadline), true);
  timers[0].fn();
  assert.deepEqual(expired, ['c1']);
  reg.drop('c1');
  assert.equal(timers[0].cleared, true);
  assert.equal(reg.size, 0);
  assert.match(F.timeoutNotice(15), /15 min/);
  assert.match(F.closeWarning(2), /2 conversas estão/);
  assert.match(F.nudgeText([{ description: 'build' }]), /build/);
});

test('parser: background_tasks_changed is authoritative; subagents are not follow tasks', () => {
  const seen = [];
  const p = providers.parser('claude', (e) => seen.push(e));
  p.accept({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [
      { task_id: 'b1', task_type: 'local_bash', description: 'dev server' },
      { task_id: 'a1', task_type: 'local_agent', description: 'revisor' },
    ],
  });
  assert.deepEqual(p.followTasks(), [{ taskId: 'b1', type: 'local_bash', description: 'dev server' }]);
  assert.equal(seen.at(-1).type, 'tasks');
  p.accept({ type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'completed' });
  assert.deepEqual(p.followTasks(), []);
  p.accept({
    type: 'system',
    subtype: 'task_started',
    task_id: 'b2',
    is_backgrounded: true,
    task_type: 'monitor',
    description: 'm',
  });
  assert.equal(p.followTasks().length, 1);
  p.accept({ type: 'system', subtype: 'background_tasks_changed', tasks: [] });
  assert.equal(p.followTasks().length, 0);
});

test('parser.nextTurn restarts the text of a new turn', () => {
  const p = providers.parser('claude', () => {});
  const delta = (t) => ({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } },
  });
  p.accept(delta('um'));
  assert.equal(p.text, 'um');
  p.nextTurn();
  assert.equal(p.text, '');
  p.accept(delta('dois'));
  assert.equal(p.text, 'dois');
});

test('tasks: followed background tasks stay running; the rest is detached; detachRunning closes orphans', () => {
  const mk = () => ({
    id: 'm',
    status: 'running',
    activities: [
      { id: 'a', status: 'running', background: true, taskId: 't1', kind: 'command' },
      { id: 'b', status: 'running', background: true, taskId: 't2', kind: 'command' },
    ],
    subagents: [],
  });
  const m = mk();
  tasksLib.settleMessage(m, 'done', { keep: new Set(['t1']) });
  assert.equal(m.activities[0].status, 'running');
  assert.ok(!m.activities[0].detached);
  assert.equal(m.activities[1].detached, true);
  m.status = 'done';
  assert.equal(tasksLib.detachRunning({ messages: [m] }), 1);
  assert.equal(m.activities[0].detached, true);
  const legacy = mk();
  tasksLib.settleMessage(legacy, 'done', 9000);
  assert.ok(
    legacy.activities.every((a) => a.detached),
    'old numeric signature still works'
  );
});

// ---- the driver against the fake CLI -----------------------------------------------------------------------------
function start({ mode = 'auto', delay = 250, nudgeMs = 0, allow = () => true, prompt = 'oi' } = {}) {
  const log = { follow: 0, auto: [], tasks: [], events: [] };
  const parse = providers.parser('claude', (e) => log.events.push(e));
  const spec = { exe: process.execPath, args: [fake] };
  const prev = { FAKE_MODE: process.env.FAKE_MODE, FAKE_DELAY: process.env.FAKE_DELAY };
  process.env.FAKE_MODE = mode;
  process.env.FAKE_DELAY = String(delay);
  const run = drivers.start('claude', spec, {
    cwd: __dirname,
    env: { ...process.env },
    prompt,
    parse,
    ask: async () => ({ allow: true }),
    lingerMs: 50,
    follow: { allow, nudgeMs, nudgeText: F.nudgeText },
    onFollow: (list) => {
      log.follow++;
      log.lastTasks = list;
    },
    onAutoTurn: (info) => log.auto.push({ ...info, textBefore: parse.text }),
    onTasks: (t) => log.tasks.push(t),
  });
  for (const [k, v] of Object.entries(prev)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  return { run, log, parse };
}

test('driver: the turn ends with a background task, the process stays and the CLI returns by itself', async () => {
  const { run, log, parse } = start();
  await until(() => log.follow === 1);
  assert.equal(parse.text, 'iniciado');
  assert.equal(log.lastTasks[0].taskId, 't1');
  assert.equal(run.following(), true);
  await until(() => log.auto.length === 1);
  assert.equal(log.auto[0].nudged, false);
  assert.equal(log.auto[0].textBefore, '', 'the new turn starts with an empty text');
  const res = await run.done;
  assert.equal(res.code, 0);
  assert.match(parse.text, /PRONTO-123/);
  assert.equal(log.follow, 1, 'no more tasks after the return: the process settled');
});

test('driver: a user message while following goes to the same process', async () => {
  const { run, log, parse } = start({ delay: 5000 });
  await until(() => log.follow === 1);
  assert.equal(run.sendUser('mais uma pergunta', []), true);
  await until(() => /resposta 2/.test(parse.text));
  assert.ok(/pid (\d+)/.exec(parse.text)[1], 'answered by the fake CLI process');
  assert.equal(log.auto.length, 0, 'a user turn is not an automatic return');
  run.stop();
  await run.done;
});

test('driver: stopFollowing closes stdin and ends the process', async () => {
  const { run, log } = start({ delay: 60000 });
  await until(() => log.follow === 1);
  assert.equal(run.stopFollowing(), true);
  const res = await run.done;
  assert.equal(res.code, 0);
  assert.equal(run.following(), false);
});

test('driver: when the CLI does not return by itself VeSTA nudges it with a short message', async () => {
  const { run, log, parse } = start({ mode: 'quiet', nudgeMs: 120 });
  await until(() => log.auto.length === 1);
  assert.equal(log.auto[0].nudged, true);
  await until(() => /resposta 2/.test(parse.text));
  assert.match(parse.text, /terminou/, 'the nudge text reached the CLI');
  await run.done;
});

test('driver: over the chat limit the turn ends as before', async () => {
  const { run, log } = start({ allow: () => false });
  const res = await run.done;
  assert.equal(res.code, 0);
  assert.equal(log.follow, 0);
});

// ---- send(): messages, routing and limits --------------------------------------------------------------------------
function chatHarness({ settings = {} } = {}) {
  const { createContext } = require('../electron/context.cjs');
  const { createBus } = require('../electron/events.cjs');
  const { send } = require('../electron/send.cjs');
  const bus = createBus();
  const events = [];
  bus.subscribe((e) => events.push(e));
  const ctx = createContext({ app: { getVersion: () => 't', getPath: () => __dirname }, dialog: {}, shell: {}, bus });
  const chat = {
    id: 'c1',
    title: 'Novo chat',
    provider: 'claude',
    model: '',
    projectId: null,
    mode: 'edit',
    messages: [],
    memory: false,
    sessionId: null,
    createdAt: 1,
    updatedAt: 1,
  };
  ctx.store = {
    state: {
      settings: { memoryEnabled: false, followMinutes: 120, followMax: 3, ...settings },
      chats: [chat],
      memories: [],
      projects: [],
      usage: { rateLimit: {}, daily: {} },
    },
    chat: () => chat,
    save() {},
  };
  ctx.integrations = { claude: { exe: process.execPath, installed: true } };
  ctx.workdir = () => __dirname;
  ctx.permissions = { cancelChat() {}, ask: async () => ({ allow: true }) };
  ctx.followNudgeMs = 0;
  // The CLI under test is the fake one.
  const real = drivers.start;
  drivers.start = (provider, spec, c) =>
    real(provider, { ...spec, exe: process.execPath, args: [fake] }, { ...c, lingerMs: 50 });
  return { ctx, chat, events, send, restore: () => (drivers.start = real) };
}
const withEnv = (env, fn) => {
  const prev = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) prev[k] === undefined ? delete process.env[k] : (process.env[k] = prev[k]);
  }
};
const slow = { FAKE_MODE: 'auto', FAKE_DELAY: '60000' };

test('send: follows the background task, returns as a NEW message, updates the old task card, ends clean', async () => {
  const h = chatHarness();
  try {
    withEnv({ FAKE_MODE: 'auto', FAKE_DELAY: '700' }, () =>
      h.send(h.ctx, { chatId: 'c1', text: 'rode em segundo plano' })
    );
    await until(() => h.ctx.follows.has('c1'));
    // The chat is free (not "responding") while it follows; the first message is complete.
    assert.equal(h.ctx.jobs.has('c1'), false);
    const [, first] = h.chat.messages;
    assert.equal(first.status, 'done');
    assert.equal(first.text, 'iniciado');
    const task = first.activities.find((a) => a.id === 'toolu_1');
    assert.equal(task.status, 'running', 'the background command is still running (not detached)');
    assert.ok(!task.detached);
    assert.equal(h.ctx.state().following[0].chatId, 'c1');
    assert.equal(h.ctx.state().following[0].tasks[0].taskId, 't1');
    // The CLI returns on its own: a new assistant message, marked as automatic.
    const auto = await until(() => h.chat.messages.find((m) => m.auto && m.status === 'done'));
    assert.equal(auto.auto, 'background');
    assert.match(auto.text, /PRONTO-123/);
    assert.equal(h.chat.messages.length, 3);
    assert.equal(
      first.activities.find((a) => a.id === 'toolu_1').status,
      'done',
      'the card on the OLD message was closed by the notification'
    );
    await until(() => !h.ctx.follows.has('c1'));
    assert.equal(h.ctx.jobs.has('c1'), false);
    assert.equal(h.events.filter((e) => e.type === 'chat-done').length, 2, 'one per finished turn');
    assert.ok(
      h.events.some((e) => e.type === 'text' && e.messageId === auto.id),
      'streamed into the new message'
    );
  } finally {
    h.restore();
  }
});

test('send: a message typed while following uses the same process and keeps following', async () => {
  const h = chatHarness();
  try {
    withEnv(slow, () => h.send(h.ctx, { chatId: 'c1', text: 'rode em segundo plano' }));
    await until(() => h.ctx.follows.has('c1'));
    const session = h.ctx.follows.get('c1');
    await h.send(h.ctx, { chatId: 'c1', text: 'e agora?' });
    assert.equal(h.ctx.follows.has('c1'), false, 'running a turn: not idle');
    assert.equal(h.ctx.jobs.has('c1'), true);
    await until(() => h.chat.messages.at(-1).status === 'done' && h.ctx.follows.has('c1'));
    assert.equal(h.ctx.follows.get('c1'), session, 'same session, same process');
    assert.match(h.chat.messages.at(-1).text, /resposta 2/);
    // The task is still tracked: stop it through the follower, then stop following.
    assert.equal(h.ctx.stopTask('c1', 't1'), true);
    assert.equal(h.ctx.endFollowing('c1', 'user'), true);
    assert.equal(h.chat.notice.reason, 'user');
    assert.ok(h.chat.messages.flatMap((m) => m.activities || []).every((a) => a.status !== 'running' || a.detached));
    await session.run.done;
  } finally {
    h.restore();
  }
});

test('send: the time limit stops following and warns in the chat; a new message clears the notice', async () => {
  const h = chatHarness({ settings: { followMinutes: 5 } });
  try {
    withEnv(slow, () => h.send(h.ctx, { chatId: 'c1', text: 'rode em segundo plano' }));
    await until(() => h.ctx.follows.has('c1'));
    const session = h.ctx.follows.get('c1');
    assert.equal(F.expired(session.follow, session.follow.since + 5 * 60000), true);
    h.ctx.endFollowing('c1', 'timeout');
    assert.match(h.chat.notice.text, /5 min/);
    assert.equal(h.ctx.follows.size, 0);
    await session.run.done;
    withEnv(slow, () => h.send(h.ctx, { chatId: 'c1', text: 'sem processo' }));
    assert.equal(h.chat.notice, undefined);
    await until(() => !h.ctx.jobs.has('c1'));
  } finally {
    h.restore();
  }
});

test('send: at the chat cap the turn ends without following', async () => {
  const h = chatHarness({ settings: { followMax: 1 } });
  try {
    h.ctx.follows.add('other', { tasks: [], run: { stopFollowing() {} } });
    withEnv({ FAKE_MODE: 'auto', FAKE_DELAY: '100' }, () =>
      h.send(h.ctx, { chatId: 'c1', text: 'rode em segundo plano' })
    );
    await until(() => !h.ctx.jobs.has('c1') && h.chat.messages.at(-1)?.status === 'done');
    assert.equal(h.ctx.follows.has('c1'), false);
    assert.ok(h.chat.messages.at(-1).activities.find((a) => a.id === 'toolu_1').detached, 'detached, as before');
    h.ctx.follows.drop('other');
  } finally {
    h.restore();
  }
});

test('send: quitting the app ends following without a notice; the process closes', async () => {
  const h = chatHarness();
  try {
    withEnv(slow, () => h.send(h.ctx, { chatId: 'c1', text: 'rode em segundo plano' }));
    await until(() => h.ctx.follows.has('c1'));
    const session = h.ctx.follows.get('c1');
    for (const s of h.ctx.follows.values()) h.ctx.endFollowing(s.chatId, 'quit');
    assert.equal(h.chat.notice, undefined);
    const res = await session.run.done;
    assert.equal(res.code, 0);
  } finally {
    h.restore();
  }
});
