// Activity selector: memoization, filters, counters and derivation cost with many chats and tasks.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const lib = () => import('../src/lib/activity.js');
const stream = () => import('../src/lib/streamBuffer.js');

const NOW = 1_800_000_000_000;
const providers = ['claude', 'codex', 'opencode'];
// A chat whose last assistant message has `tasks` tasks (subagents with steps, commands, background commands).
function chat(i, { tasks = 50, running = true, ago = 0 } = {}) {
  const activities = [],
    subagents = [];
  let n = 0;
  for (let s = 0; n < tasks && s < 5; s++) {
    const steps = [];
    for (let k = 0; k < 4 && n < tasks; k++, n++)
      steps.push({
        id: 's' + s + 'k' + k,
        kind: 'command',
        label: 'Usando Bash',
        detail: 'ls ' + k,
        status: 'done',
        startedAt: NOW - ago - 9000,
        endedAt: NOW - ago - 8000,
      });
    subagents.push({
      toolUseId: 'sub' + s,
      subagentType: 'Explore',
      label: 'Subagente ' + s,
      status: running && s === 0 ? 'running' : 'done',
      background: true,
      startedAt: NOW - ago - 10000,
      endedAt: running && s === 0 ? undefined : NOW - ago - 5000,
      steps,
    });
    n++;
  }
  for (; n < tasks; n++)
    activities.push({
      id: 'a' + n,
      kind: n % 7 === 0 ? 'command' : 'file',
      background: n % 7 === 0,
      taskId: n % 7 === 0 ? 't' + n : undefined,
      label: 'Atividade ' + n,
      status: running && n === tasks - 1 ? 'running' : 'done',
      startedAt: NOW - ago - 4000,
      endedAt: running && n === tasks - 1 ? undefined : NOW - ago - 3000,
    });
  return {
    id: 'c' + i,
    title: 'Chat ' + i,
    provider: providers[i % 3],
    projectId: null,
    messages: [
      { id: 'u' + i, role: 'user', text: 'oi', createdAt: NOW - ago - 20000 },
      {
        id: 'a' + i,
        role: 'assistant',
        text: 'ok',
        createdAt: NOW - ago - 19000,
        status: running ? 'running' : 'done',
        activities,
        subagents,
      },
    ],
  };
}

test('groups: live first, counts per kind, stale running turns do not count', async () => {
  const A = await lib();
  const chats = [chat(0, { tasks: 12, running: false, ago: 60000 }), chat(1, { tasks: 12 }), chat(2, { tasks: 12 })];
  const groups = A.activityGroups(chats, ['c1']);
  assert.deepEqual(
    groups.map((g) => g.chatId),
    ['c1', 'c2', 'c0'],
    'live first, then newest activity'
  );
  assert.equal(groups[0].live, true);
  assert.ok(groups[0].counts.running >= 1);
  assert.equal(groups[1].counts.running, 0, 'c2 is marked running but no job exists for it: interrupted');
  assert.equal(groups[1].turns[0].status, 'stopped');
  const sum = A.summarize(groups);
  assert.equal(sum.working, 1);
  assert.equal(sum.subagents, 1);
  assert.ok(sum.background >= 0 && sum.running === groups[0].counts.running);
  const rc = A.runningCounts(groups);
  assert.deepEqual(Object.keys(rc.byChat), ['c1']);
  assert.equal(rc.total, groups[0].counts.running);
});

test('filters: Rodando vs Tudo (last 30 min) and by AI', async () => {
  const A = await lib();
  const chats = [
    chat(0, { tasks: 6, running: false, ago: 5 * 60000 }), // codex? i%3 -> claude
    chat(1, { tasks: 6, running: false, ago: 90 * 60000 }), // too old
    chat(2, { tasks: 6 }), // live
  ];
  const groups = A.activityGroups(chats, ['c2']);
  const ids = (o) => A.filterGroups(groups, { now: NOW, ...o }).map((g) => g.chatId);
  assert.deepEqual(ids({ scope: 'running' }), ['c2']);
  assert.deepEqual(ids({ scope: 'all' }), ['c2', 'c0']);
  assert.deepEqual(ids({ scope: 'all', provider: 'claude' }), ['c0']);
  assert.deepEqual(ids({ scope: 'all', provider: 'codex' }), []);
});

test('memoization: an untouched chat keeps the same group and tree objects across deltas', async () => {
  const A = await lib();
  const { applyEvents } = await stream();
  const chats = Array.from({ length: 5 }, (_, i) => chat(i, { tasks: 20 }));
  const run = chats.map((c) => c.id);
  const g1 = A.activityGroups(chats, run);
  const next = applyEvents(chats, [
    {
      type: 'activity',
      chatId: 'c3',
      messageId: 'a3',
      activity: { id: 'new', kind: 'command', label: 'Novo', status: 'running', startedAt: NOW },
    },
  ]);
  assert.notEqual(next, chats);
  const g2 = A.activityGroups(next, run);
  const by = (g, id) => g.find((x) => x.chatId === id);
  for (const id of ['c0', 'c1', 'c2', 'c4']) assert.equal(by(g2, id), by(g1, id), id + ' group identity');
  assert.notEqual(by(g2, 'c3'), by(g1, 'c3'));
  assert.equal(by(g2, 'c3').counts.running, by(g1, 'c3').counts.running + 1);
  // Same chat, same flags: the very same array contents come back from the cache.
  assert.equal(A.chatGroup(next[0], true), A.chatGroup(next[0], true));
  // The message that received the delta grew by exactly one task.
  assert.equal(
    A.messageActivity(next[3], next[3].messages[1], true).tasks.length,
    A.messageActivity(chats[3], chats[3].messages[1], true).tasks.length + 1
  );
});

test('canStopTask: only tracked Claude tasks of a live chat', async () => {
  const A = await lib();
  const t = { status: 'running', taskId: 'x', provider: 'claude', stats: {} };
  assert.equal(A.canStopTask(t, true), true);
  assert.equal(A.canStopTask(t, false), false);
  assert.equal(A.canStopTask({ ...t, provider: 'codex' }, true), false);
  assert.equal(A.canStopTask({ ...t, taskId: undefined }, true), false);
  assert.equal(A.canStopTask({ ...t, status: 'done' }, true), false);
  assert.equal(A.canStopTask({ ...t, stats: { detached: true } }, true), false);
});

test('performance: 20 chats x 50 tasks derive fast, and a delta recomputes only one chat', async () => {
  const A = await lib();
  const { applyEvents } = await stream();
  const chats = Array.from({ length: 20 }, (_, i) => chat(i, { tasks: 50 }));
  const run = chats.map((c) => c.id);
  const ms = (fn, times = 1) => {
    const t0 = process.hrtime.bigint();
    let r;
    for (let i = 0; i < times; i++) r = fn();
    return { r, ms: Number(process.hrtime.bigint() - t0) / 1e6 / times };
  };
  const cold = ms(() => A.activityGroups(chats, run));
  const warm = ms(() => A.activityGroups(chats, run), 200);
  let cur = chats,
    delta = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    cur = applyEvents(cur, [
      {
        type: 'activity',
        chatId: 'c7',
        messageId: 'a7',
        activity: { id: 'd' + i, kind: 'command', label: 'x', status: 'running', startedAt: NOW },
      },
    ]);
    delta += ms(() => A.activityGroups(cur, run)).ms;
  }
  delta /= N;
  const total = cold.r.reduce((s, g) => s + g.turns.reduce((x, t) => x + t.tasks.length, 0), 0);
  console.log(
    `# activity perf: ${cold.r.length} chats, ${total} tasks | cold ${cold.ms.toFixed(2)} ms | unchanged ${warm.ms.toFixed(3)} ms | one-delta ${delta.toFixed(3)} ms`
  );
  assert.ok(total >= 20 * 50);
  assert.ok(cold.ms < 100, 'cold derivation of 1000 tasks under 100 ms, got ' + cold.ms);
  assert.ok(warm.ms < 2, 'unchanged re-derivation under 2 ms, got ' + warm.ms);
  assert.ok(delta < cold.ms, 'a delta must cost less than a cold derivation');
});
